import { getSettings, getSnapshot } from "./storage";
import { refresh } from "./refresh";
import { ago, el, placeholder } from "./dom";
import { renderPrTab } from "./pr-view";
import type { Snapshot, Viewer } from "./types";

const content = document.getElementById("content")!;
const summary = document.getElementById("summary")!;
const updated = document.getElementById("updated")!;
const refreshBtn = document.getElementById("refresh")!;

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
  const settings = await getSettings();
  const { token, repos } = settings;
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

  await renderPrTab({ summary, content }, snapshot, settings);
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
