import { getSettings, getSnapshot } from "./storage";
import { refresh } from "./refresh";
import type { PullRequest, QueueEntry, Snapshot, Viewer } from "./types";

const content = document.getElementById("content")!;
const summary = document.getElementById("summary")!;
const updated = document.getElementById("updated")!;
const refreshBtn = document.getElementById("refresh")!;

type Tone = "green" | "red" | "yellow" | "gray" | "purple";
type Status = "queued" | "ready" | "waiting" | "draft";

const STATUSES: { status: Status; label: string; short: string; tone: Tone }[] = [
  { status: "queued", label: "In merge queue", short: "Queued", tone: "purple" },
  { status: "ready", label: "Can be merged", short: "Mergeable", tone: "green" },
  { status: "waiting", label: "Waiting for review", short: "In review", tone: "yellow" },
  { status: "draft", label: "Draft", short: "Draft", tone: "gray" },
];

// Static, trusted markup only (no user data is ever interpolated into these).
const svg = (inner: string, size = 16, extra = "") =>
  `<svg ${extra} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const STATUS_ICONS: Record<Status, string> = {
  queued: svg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>', 18, 'class="status-icon"'),
  ready: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 18, 'class="status-icon"'),
  waiting: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', 18, 'class="status-icon"'),
  draft: svg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6h.01"/><path d="M18 11h.01"/><path d="M6 9v12"/>', 18, 'class="status-icon"'),
};
const CHEVRON = svg('<path d="m9 18 6-6-6-6"/>', 14, 'class="chevron"');

function statusOf(pr: PullRequest): Status {
  if (pr.queue) return "queued";
  if (pr.isDraft) return "draft";
  const ciOk = pr.ci === "SUCCESS" || pr.ci === "NONE";
  return pr.review === "APPROVED" && ciOk && pr.mergeable !== "CONFLICTING" ? "ready" : "waiting";
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

function ago(ts: string | number): string {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function prRow(pr: PullRequest, status: Status): HTMLElement {
  const a = el("a", `pr ${status}`);
  a.href = pr.url;
  a.target = "_blank";
  a.insertAdjacentHTML("afterbegin", STATUS_ICONS[status]);

  const body = el("div", "body");
  body.append(
    el("div", "title", pr.title),
    el("div", "sub", `#${pr.number} · updated ${ago(pr.updatedAt)}`),
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

function renderSummary(prs: PullRequest[]) {
  summary.replaceChildren();
  if (prs.length === 0) return;
  for (const { status, short, tone } of STATUSES) {
    const n = prs.filter((p) => statusOf(p) === status).length;
    const stat = el("div", `stat ${tone}${n === 0 ? " zero" : ""}`);
    stat.append(el("b", undefined, String(n)), el("span", undefined, short));
    summary.append(stat);
  }
}

function placeholder(title: string, text: string, withSettings = false): HTMLElement {
  const box = el("div", "placeholder");
  const logo = el("img");
  logo.src = "icons/icon-128.png";
  logo.width = 56;
  logo.height = 56;
  box.append(logo, el("h2", undefined, title), el("p", undefined, text));
  if (withSettings) {
    const btn = el("button", "primary", "Open settings");
    btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
    box.append(btn);
  }
  return box;
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
  const { openRepos = [] } = await chrome.storage.local.get("openRepos");
  const next = (openRepos as string[]).filter((r) => r !== repo);
  if (open) next.push(repo);
  await chrome.storage.local.set({ openRepos: next });
}

function repoSection(
  repo: string,
  prs: PullRequest[],
  inaccessible: boolean,
  open: boolean,
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
        `GitHub can't see ${repo} with this sign-in. Check the repo name, and that ${owner} has approved ` +
          "the OAuth App (Org settings → Third-party access) and SSO is authorized.",
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
    details.append(heading, ...group.map((p) => prRow(p, status)));
  }
  return details;
}

/** Floating avatar (bottom right) that links to the signed-in user's GitHub profile. */
function renderProfile(viewer: Viewer | undefined) {
  const link = document.getElementById("profile") as HTMLAnchorElement;
  link.hidden = !viewer;
  if (!viewer) return;
  const avatar = new URL(viewer.avatarUrl);
  avatar.searchParams.set("s", "96");
  link.href = viewer.url;
  link.title = `@${viewer.login} on GitHub`;
  link.querySelector("img")!.src = avatar.toString();
}

async function render(snapshot: Snapshot | undefined) {
  const { token, repos } = await getSettings();
  content.replaceChildren();
  renderProfile(token ? snapshot?.viewer : undefined);

  if (!token || repos.length === 0) {
    summary.replaceChildren();
    content.append(
      placeholder("Set up PR Tracker", "Sign in with GitHub and choose the repositories you want to follow.", true),
    );
    return;
  }
  if (!snapshot) {
    summary.replaceChildren();
    content.append(el("div", "skeleton"), el("div", "skeleton"));
    return;
  }

  updated.textContent = `Updated ${ago(snapshot.fetchedAt)}`;
  if (snapshot.error) content.append(el("div", "notice error", snapshot.error));

  renderSummary(snapshot.prs);
  const { openRepos = [] } = await chrome.storage.local.get("openRepos");
  for (const repo of repos) {
    const prs = snapshot.prs.filter((p) => p.repo.toLowerCase() === repo.toLowerCase());
    const blocked = (snapshot.inaccessible ?? []).includes(repo);
    content.append(repoSection(repo, prs, blocked, (openRepos as string[]).includes(repo)));
  }
}

async function reload() {
  refreshBtn.classList.add("spinning");
  updated.textContent = "Refreshing…";
  try {
    await render(await refresh());
  } finally {
    refreshBtn.classList.remove("spinning");
  }
}

refreshBtn.addEventListener("click", reload);
document.getElementById("settings")!.addEventListener("click", () => chrome.runtime.openOptionsPage());

// The side panel stays open, so keep it in sync with the background refresh.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.snapshot) void render(changes.snapshot.newValue);
  if (area === "sync") void getSnapshot().then(render);
});

void getSnapshot().then(render);
void reload();
