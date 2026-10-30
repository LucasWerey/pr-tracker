import { fetchMyPrs } from "./github";
import { getSettings, getSnapshot, saveSnapshot } from "./storage";
import type { Snapshot } from "./types";

/** Fetch PRs, persist the snapshot and update the toolbar badge. */
export async function refresh(): Promise<Snapshot> {
  const { token, repos } = await getSettings();
  let snapshot: Snapshot;

  if (!token || repos.length === 0) {
    snapshot = { fetchedAt: Date.now(), prs: [], error: "Open settings to add a token and repositories." };
  } else {
    try {
      snapshot = { fetchedAt: Date.now(), ...(await fetchMyPrs(token, repos)) };
    } catch (e) {
      // Keep the previous PR list visible if the fetch failed.
      const previous = await getSnapshot();
      snapshot = {
        fetchedAt: Date.now(),
        viewer: previous?.viewer,
        prs: previous?.prs ?? [],
        error: (e as Error).message,
      };
    }
  }

  await saveSnapshot(snapshot);
  const count = snapshot.prs.length;
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6d5dfc" });
  return snapshot;
}
