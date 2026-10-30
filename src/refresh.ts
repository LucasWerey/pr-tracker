import { fetchMyPrs, needsAttention } from "./github";
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
      snapshot = { fetchedAt: Date.now(), prs: previous?.prs ?? [], error: (e as Error).message };
    }
  }

  await saveSnapshot(snapshot);
  const attention = snapshot.prs.filter(needsAttention).length;
  await chrome.action.setBadgeText({ text: attention > 0 ? String(attention) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
  return snapshot;
}
