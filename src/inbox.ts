import type { InboxItem, InboxState } from "./types";

export const INBOX_URL = "https://api.github.com/notifications?all=true&is_done=false&per_page=50";
/** A conditional request can't see items marked done elsewhere, so refetch fully this often. */
export const FULL_FETCH_MS = 5 * 60_000;

const THREAD_URL = "https://api.github.com/notifications/threads/";

export interface Thread {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  subject: { title: string; url: string | null; type: string };
  repository: { full_name: string; html_url: string };
}

// Maps, not plain objects: GitHub-supplied keys like "constructor" must not hit Object.prototype.
const REASONS = new Map([
  ["review_requested", "Review requested"],
  ["mention", "Mentioned"],
  ["team_mention", "Team mentioned"],
  ["assign", "Assigned"],
  ["author", "Author"],
  ["comment", "Commented"],
  ["state_change", "State changed"],
  ["ci_activity", "CI activity"],
  ["subscribed", "Watching"],
  ["manual", "Subscribed"],
]);

export function reasonLabel(reason: string): string {
  const known = REASONS.get(reason);
  if (known) return known;
  const spaced = reason.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const TYPES = new Map([
  ["PullRequest", "PR"],
  ["CheckSuite", "CI"],
]);

export function typeLabel(type: string): string {
  return TYPES.get(type) ?? type;
}

/** Turns a notification subject into a github.com link; never returns an API URL. */
export function browserUrl(subject: { url: string | null; type: string }, repoHtmlUrl: string): string {
  const m = subject.url?.match(/\/(pulls|issues|commits|releases)\/([^/?#]+)$/);
  if (m) {
    const [, kind, ref] = m;
    if (kind === "pulls") return `${repoHtmlUrl}/pull/${ref}`;
    if (kind === "issues") return `${repoHtmlUrl}/issues/${ref}`;
    if (kind === "commits") return `${repoHtmlUrl}/commit/${ref}`;
    return `${repoHtmlUrl}/releases`;
  }
  if (subject.type === "CheckSuite") return `${repoHtmlUrl}/actions`;
  if (subject.type === "Discussion") return `${repoHtmlUrl}/discussions`;
  return repoHtmlUrl;
}

export function toInboxItem(thread: Thread): InboxItem {
  return {
    id: thread.id,
    title: thread.subject.title,
    type: thread.subject.type,
    repo: thread.repository.full_name,
    reason: thread.reason,
    unread: thread.unread,
    updatedAt: thread.updated_at,
    url: browserUrl(thread.subject, thread.repository.html_url),
  };
}

/** Short, non-reversible id of the token's account; lets us discard another account's inbox. */
export async function accountId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The stored inbox if it belongs to `token`'s account. Right after a token change the stored one is
 * still the previous account's: show nothing (skeletons, no count) until the new fetch lands.
 */
export async function inboxFor(token: string, stored: InboxState | undefined): Promise<InboxState | undefined> {
  if (!token || !stored) return undefined;
  return stored.account === (await accountId(token)) ? stored : undefined;
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

const FINE_GRAINED_MESSAGE =
  "Fine-grained tokens can't read notifications. Sign in with GitHub or use a classic token.";

/** Fetches the notifications inbox. Never throws: failures keep the previous items. */
export async function fetchInbox(
  token: string,
  stored: InboxState | undefined,
  now: number,
  forceFull: boolean,
): Promise<InboxState> {
  const account = await accountId(token);
  // Never reuse (or keep on failure) another account's items or Last-Modified.
  const prev = stored?.account === account ? stored : undefined;
  const keep = (error: string, errorKind?: "fine-grained"): InboxState => ({
    account,
    fetchedAt: now,
    fullFetchedAt: prev?.fullFetchedAt ?? 0,
    lastModified: prev?.lastModified,
    items: prev?.items ?? [],
    error,
    errorKind,
  });
  const conditional = !forceFull && prev?.lastModified && now - prev.fullFetchedAt <= FULL_FETCH_MS;
  try {
    const h = headers(token);
    if (conditional) h["If-Modified-Since"] = prev.lastModified!;
    const res = await fetch(INBOX_URL, { headers: h });
    if (res.status === 304 && prev) return { ...prev, fetchedAt: now, error: undefined, errorKind: undefined };
    if (!res.ok) {
      const fineGrained = token.startsWith("github_pat_") && [401, 403, 404].includes(res.status);
      return fineGrained ? keep(FINE_GRAINED_MESSAGE, "fine-grained") : keep(`GitHub API error ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return keep("Unexpected response from GitHub");
    const items = (body as Partial<Thread>[])
      .filter((t): t is Thread => !!t && !!t.subject && !!t.repository)
      .map(toInboxItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      account,
      fetchedAt: now,
      fullFetchedAt: now,
      lastModified: res.headers.get("Last-Modified") ?? undefined,
      items,
    };
  } catch (e) {
    return keep((e as Error).message);
  }
}

/**
 * True when, while a fetch that started from `prev` was running, another fetch saved a newer full
 * result for the same account. Saving `result` then would roll the inbox back (e.g. a 304 that
 * reuses `prev`'s items could bring back threads marked done on github.com).
 */
export function overtaken(result: InboxState, prev: InboxState | undefined, stored: InboxState | undefined): boolean {
  if (stored?.account !== result.account) return false;
  const startedFrom = prev?.account === result.account ? prev.fullFetchedAt : 0;
  return stored.fullFetchedAt > startedFrom && stored.fullFetchedAt > result.fullFetchedAt;
}

async function send(method: string, token: string, id: string): Promise<void> {
  const res = await fetch(`${THREAD_URL}${encodeURIComponent(id)}`, { method, headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
}

export function markRead(token: string, id: string): Promise<void> {
  return send("PATCH", token, id);
}

export function markDone(token: string, id: string): Promise<void> {
  return send("DELETE", token, id);
}
