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

const REASONS: Record<string, string> = {
  review_requested: "Review requested",
  mention: "Mentioned",
  team_mention: "Team mentioned",
  assign: "Assigned",
  author: "Author",
  comment: "Commented",
  state_change: "State changed",
  ci_activity: "CI activity",
  subscribed: "Watching",
  manual: "Subscribed",
};

export function reasonLabel(reason: string): string {
  const known = REASONS[reason];
  if (known) return known;
  const spaced = reason.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const TYPES: Record<string, string> = { PullRequest: "PR", CheckSuite: "CI" };

export function typeLabel(type: string): string {
  return TYPES[type] ?? type;
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

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
}

const FINE_GRAINED_MESSAGE =
  "Fine-grained tokens can't read notifications. Sign in with GitHub or use a classic token.";

/** Fetches the notifications inbox. Never throws: failures keep the previous items. */
export async function fetchInbox(
  token: string,
  prev: InboxState | undefined,
  now: number,
  forceFull: boolean,
): Promise<InboxState> {
  const keep = (error: string, errorKind?: "fine-grained"): InboxState => ({
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
    const threads = (await res.json()) as Thread[];
    const items = threads.map(toInboxItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      fetchedAt: now,
      fullFetchedAt: now,
      lastModified: res.headers.get("Last-Modified") ?? undefined,
      items,
    };
  } catch (e) {
    return keep((e as Error).message);
  }
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
