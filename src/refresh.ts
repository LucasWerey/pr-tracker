import { fetchPrs } from "./github";
import { getSettings, getSnapshot, saveSnapshot } from "./storage";
import type { Snapshot } from "./types";

/** The badge counts only the viewer's own open PRs (older snapshots lack myCount). */
export function badgeCount(snapshot: Snapshot): number {
  return snapshot.myCount ?? snapshot.prs.length;
}

/** Fetch PRs, persist the snapshot and update the toolbar badge. */
export async function refresh(_opts: { fullInbox?: boolean } = {}): Promise<Snapshot> {
  const { token, repos, prScope } = await getSettings();
  let snapshot: Snapshot;

  if (!token || repos.length === 0) {
    snapshot = { fetchedAt: Date.now(), prs: [], error: "Open settings to add a token and repositories." };
  } else {
    try {
      snapshot = { fetchedAt: Date.now(), ...(await fetchPrs(token, repos, prScope)) };
    } catch (e) {
      // Keep the previous PR list visible if the fetch failed.
      const previous = await getSnapshot();
      snapshot = {
        fetchedAt: Date.now(),
        viewer: previous?.viewer,
        prs: previous?.prs ?? [],
        myCount: previous?.myCount,
        totals: previous?.totals,
        error: (e as Error).message,
      };
    }
  }

  await saveSnapshot(snapshot);
  const count = badgeCount(snapshot);
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6d5dfc" });
  return snapshot;
}
