import { ago, el, svg } from "./dom";
import { getOpenRepos } from "./storage";
import type { PrScope, PullRequest, QueueEntry, Settings, Snapshot } from "./types";

type Tone = "green" | "red" | "yellow" | "gray" | "purple";
type Status = "queued" | "ready" | "waiting" | "draft";

const STATUSES: { status: Status; label: string; short: string; tone: Tone }[] = [
  { status: "queued", label: "In merge queue", short: "Queued", tone: "purple" },
  { status: "ready", label: "Can be merged", short: "Mergeable", tone: "green" },
  { status: "waiting", label: "Waiting for review", short: "In review", tone: "yellow" },
  { status: "draft", label: "Draft", short: "Draft", tone: "gray" },
];

const STATUS_ICONS: Record<Status, string> = {
  queued: svg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>', 18, 'class="status-icon"'),
  ready: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 18, 'class="status-icon"'),
  waiting: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 18, 'class="status-icon"'),
  draft: svg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6h.01"/><path d="M18 11h.01"/><path d="M6 9v12"/>', 18, 'class="status-icon"'),
};
const CHEVRON = svg('<path d="m9 18 6-6-6-6"/>', 14, 'class="chevron"');

export function statusOf(pr: PullRequest): Status {
  if (pr.queue) return "queued";
  if (pr.isDraft) return "draft";
  const ciOk = pr.ci === "SUCCESS" || pr.ci === "NONE";
  return pr.review === "APPROVED" && ciOk && pr.mergeable !== "CONFLICTING" ? "ready" : "waiting";
}

function chip(text: string, tone: Tone): HTMLElement {
  return el("span", `chip ${tone}`, text);
}

function queueChip(q: QueueEntry): HTMLElement {
  const base = `Queue #${q.position}`;
  switch (q.state) {
    case "AWAITING_CHECKS": return chip(`${base} · checking`, "purple");
    case "MERGEABLE": return chip(`${base} · merging`, "green");
    case "UNMERGEABLE": return chip(`${base} · blocked`, "red");
    case "LOCKED": return chip(`${base} · locked`, "gray");
    default: return chip(base, "purple");
  }
}

function chipsFor(pr: PullRequest): HTMLElement[] {
  const chips: HTMLElement[] = [];
  if (pr.queue) chips.push(queueChip(pr.queue));

  switch (pr.ci) {
    case "SUCCESS": chips.push(chip("CI passing", "green")); break;
    case "FAILURE":
    case "ERROR": chips.push(chip("CI failing", "red")); break;
    case "PENDING":
    case "EXPECTED": chips.push(chip("CI running", "yellow")); break;
  }

  switch (pr.review) {
    case "APPROVED": chips.push(chip("Approved", "green")); break;
    case "CHANGES_REQUESTED": chips.push(chip("Changes requested", "red")); break;
    case "REVIEW_REQUIRED": if (!pr.queue) chips.push(chip("Review required", "yellow")); break;
  }

  if (pr.mergeable === "CONFLICTING") chips.push(chip("Conflicts", "red"));
  if (pr.unresolvedThreads > 0) {
    chips.push(chip(`${pr.unresolvedThreads} unresolved`, "yellow"));
  }
  return chips;
}

/** Second line of a row; everyone's mode names the author (old snapshots may lack one). */
export function subLine(pr: PullRequest, scope: PrScope): string {
  const login = scope === "all" ? pr.author?.login : undefined;
  return `#${pr.number}${login ? ` · @${login}` : ""} · updated ${ago(pr.updatedAt)}`;
}

/** "Showing N of M" when the repo has more open PRs than were fetched; otherwise nothing. */
export function footerText(shown: number, total: number | undefined): string | null {
  return total !== undefined && total > shown ? `Showing ${shown} of ${total}` : null;
}

interface RowContext {
  scope: PrScope;
  viewerLogin?: string;
}

/** Sub line with a small author avatar before `@login` (everyone's mode). */
function subElement(pr: PullRequest, scope: PrScope): HTMLElement {
  const sub = el("div", "sub");
  const author = scope === "all" ? pr.author : undefined;
  if (author?.avatarUrl) {
    const img = el("img", "author-avatar");
    img.src = author.avatarUrl;
    img.width = 16;
    img.height = 16;
    img.alt = "";
    // Avatar sits before "@login", so split the text around the login.
    const text = subLine(pr, scope);
    const at = text.indexOf("@");
    sub.append(text.slice(0, at), img, text.slice(at));
    return sub;
  }
  sub.textContent = subLine(pr, scope);
  return sub;
}

function prRow(pr: PullRequest, status: Status, ctx: RowContext): HTMLElement {
  const own =
    ctx.scope === "all" && !!ctx.viewerLogin && pr.author?.login.toLowerCase() === ctx.viewerLogin.toLowerCase();
  const a = el("a", `pr ${status}${own ? " mine" : ""}`);
  a.href = pr.url;
  a.target = "_blank";
  a.insertAdjacentHTML("afterbegin", STATUS_ICONS[status]);

  const body = el("div", "body");
  body.append(
    el("div", "title", pr.title),
    subElement(pr, ctx.scope),
  );
  const chips = chipsFor(pr);
  if (chips.length > 0) {
    const row = el("div", "chips");
    row.append(...chips);
    body.append(row);
  }
  a.append(body);
  return a;
}

function renderSummary(summary: HTMLElement, prs: PullRequest[]) {
  summary.replaceChildren();
  if (prs.length === 0) return;
  for (const { status, short, tone } of STATUSES) {
    const n = prs.filter((p) => statusOf(p) === status).length;
    const stat = el("div", `stat ${tone}${n === 0 ? " zero" : ""}`);
    stat.append(el("b", undefined, String(n)), el("span", undefined, short));
    summary.append(stat);
  }
}

/** Stable per-repo color so sections are easy to tell apart. */
function avatar(name: string): HTMLElement {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const node = el("span", "avatar", (name[0] ?? "?").toUpperCase());
  node.style.setProperty("--hue", String(hash % 360));
  return node;
}

/** Repos are collapsed by default; the ones the user expanded are remembered across refreshes. */
async function setRepoOpen(repo: string, open: boolean) {
  const next = (await getOpenRepos()).filter((r) => r !== repo);
  if (open) next.push(repo);
  await chrome.storage.local.set({ openRepos: next });
}

function repoSection(
  repo: string,
  prs: PullRequest[],
  inaccessible: boolean,
  open: boolean,
  ctx: RowContext,
  total?: number,
): HTMLElement {
  const [owner, name = ""] = repo.split("/");
  const details = el("details", "repo");
  details.open = open;
  details.addEventListener("toggle", () => {
    if (details.open !== open) void setRepoOpen(repo, details.open);
    open = details.open;
  });

  const head = el("summary");
  head.insertAdjacentHTML("afterbegin", CHEVRON);
  const title = el("span", "repo-name");
  title.append(el("span", "owner", `${owner}/`), name);
  head.append(avatar(name), title, el("span", "badge", String(prs.length)));
  details.append(head);

  if (inaccessible) {
    details.append(
      el(
        "div",
        "notice error",
        `GitHub can't see ${repo} with this sign-in. Check the repo name. With a token, check it has the repo scope ` +
          `and is authorized for ${owner}'s SSO (token settings → Configure SSO). With the OAuth App, ${owner} must approve it ` +
          "(Org settings → Third-party access).",
      ),
    );
    return details;
  }

  if (prs.length === 0) {
    details.append(el("div", "empty", "No open PRs 🎉"));
    return details;
  }

  for (const { status, label } of STATUSES) {
    const group = prs.filter((p) => statusOf(p) === status);
    if (group.length === 0) continue;
    const heading = el("div", `group ${status}`);
    heading.append(el("span", "dot"), el("span", undefined, label), el("span", "n", String(group.length)));
    details.append(heading, ...group.map((p) => prRow(p, status, ctx)));
  }

  const footer = footerText(prs.length, total);
  if (footer) {
    const row = el("div", "repo-footer", `${footer} · `);
    const link = el("a", undefined, "View all on GitHub ↗");
    link.href = `https://github.com/${repo}/pulls`;
    link.target = "_blank";
    row.append(link);
    details.append(row);
  }
  return details;
}

/** Synchronous on purpose: the caller loads everything first, so overlapping renders can't interleave. */
export function renderPrTab(
  els: { summary: HTMLElement; content: HTMLElement },
  snapshot: Snapshot,
  settings: Settings,
  openRepos: string[],
): void {
  renderSummary(els.summary, snapshot.prs);
  for (const repo of settings.repos) {
    const prs = snapshot.prs.filter((p) => p.repo.toLowerCase() === repo.toLowerCase());
    const blocked = (snapshot.inaccessible ?? []).includes(repo);
    const ctx = { scope: settings.prScope, viewerLogin: snapshot.viewer?.login };
    const total = settings.prScope === "all" ? snapshot.totals?.[repo] : undefined;
    els.content.append(repoSection(repo, prs, blocked, openRepos.includes(repo), ctx, total));
  }
}
