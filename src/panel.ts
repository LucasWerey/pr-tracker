import { getInbox, getSettings, getSnapshot } from "./storage";
import { refresh } from "./refresh";
import { ago, el, placeholder } from "./dom";
import { renderPrTab } from "./pr-view";
import { renderInboxTab, visibleUnread } from "./inbox-view";
import type { InboxState, Viewer } from "./types";

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

async function render() {
  const [settings, snapshot, inbox] = await Promise.all([getSettings(), getSnapshot(), getInbox()]);
  const { token, repos } = settings;
  renderProfile(token ? snapshot?.viewer : undefined);
  showTab(tab);
  renderBadge(token ? inbox : undefined);
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
  await renderPrTab({ summary, content }, snapshot, settings);
}

async function reload() {
  refreshBtn.classList.add("spinning");
  updated.textContent = "Refreshing…";
  try {
    await refresh({ fullInbox: true });
    await render();
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
  const { tab: saved } = await chrome.storage.local.get("tab");
  if (saved === "prs" || saved === "inbox") tab = saved;
  await render();
  await reload();
}
void start();
