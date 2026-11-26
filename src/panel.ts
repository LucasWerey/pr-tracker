import { getInbox, getOpenRepos, getSettings, getSnapshot } from "./storage";
import { refresh } from "./refresh";
import { ago, el, latestOnly, placeholder } from "./dom";
import { inboxFor } from "./inbox";
import { renderPrTab } from "./pr-view";
import { renderInboxTab, visibleUnread } from "./inbox-view";
import type { InboxState, Settings, Snapshot, Viewer } from "./types";

type Tab = "prs" | "inbox";

const content = document.getElementById("content")!;
const summary = document.getElementById("summary")!;
const inboxView = document.getElementById("inbox-view")!;
const prsView = document.getElementById("prs-view")!;
const updated = document.getElementById("updated")!;
const refreshBtn = document.getElementById("refresh")!;
const inboxCount = document.getElementById("inbox-count")!;
const tabButtons: Record<Tab, HTMLElement> = {
  prs: document.getElementById("tab-prs")!,
  inbox: document.getElementById("tab-inbox")!,
};

let tab: Tab = "prs";

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

function renderBadge(inbox: InboxState | undefined) {
  const unread = visibleUnread(inbox);
  inboxCount.hidden = unread === 0;
  inboxCount.textContent = String(unread);
}

function showTab(next: Tab) {
  tab = next;
  for (const [name, button] of Object.entries(tabButtons)) {
    button.setAttribute("aria-selected", String(name === tab));
  }
  prsView.hidden = tab !== "prs";
  inboxView.hidden = tab !== "inbox";
}

interface PanelData {
  settings: Settings;
  snapshot: Snapshot | undefined;
  /** Only the current account's inbox; undefined while another account's is still stored. */
  inbox: InboxState | undefined;
  openRepos: string[];
}

async function load(): Promise<PanelData> {
  const [settings, snapshot, stored, openRepos] = await Promise.all([
    getSettings(),
    getSnapshot(),
    getInbox(),
    getOpenRepos(),
  ]);
  return { settings, snapshot, inbox: await inboxFor(settings.token, stored), openRepos };
}

/** Synchronous: every read happened in `load`, so two renders can never interleave their DOM work. */
function paint({ settings, snapshot, inbox, openRepos }: PanelData) {
  const { token, repos } = settings;
  renderProfile(token ? snapshot?.viewer : undefined);
  showTab(tab);
  renderBadge(inbox);
  const fetchedAt = tab === "prs" ? snapshot?.fetchedAt : inbox?.fetchedAt;
  updated.textContent = token && fetchedAt ? `Updated ${ago(fetchedAt)}` : "";

  renderInboxTab(inboxView, inbox, token, () => renderBadge(inbox));

  content.replaceChildren();
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
  if (snapshot.error) content.append(el("div", "notice error", snapshot.error));
  renderPrTab({ summary, content }, snapshot, settings, openRepos);
}

// Storage events, the refresh button and tab clicks often render at the same time: only the latest paints.
const render = latestOnly(load, paint);

async function reload() {
  refreshBtn.classList.add("spinning");
  updated.textContent = "Refreshing…";
  try {
    // refresh() always saves a new snapshot, and the storage listener below re-renders for it.
    await refresh({ fullInbox: true });
  } finally {
    refreshBtn.classList.remove("spinning");
  }
}

async function selectTab(next: Tab) {
  showTab(next);
  try {
    await chrome.storage.local.set({ tab: next });
  } catch {
    // The choice just isn't remembered.
  }
  await render();
}

tabButtons.prs.addEventListener("click", () => void selectTab("prs"));
tabButtons.inbox.addEventListener("click", () => void selectTab("inbox"));
refreshBtn.addEventListener("click", reload);
document.getElementById("settings")!.addEventListener("click", () => chrome.runtime.openOptionsPage());

// The side panel stays open, so keep it in sync with the background refresh.
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && (changes.snapshot || changes.inbox)) || area === "sync") void render();
});

async function start() {
  try {
    const { tab: saved } = await chrome.storage.local.get("tab");
    if (saved === "prs" || saved === "inbox") tab = saved;
  } catch {
    // Default to the Pull requests tab.
  }
  await render();
  await reload();
}
void start();
