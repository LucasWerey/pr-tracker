import { fetchPrs } from "./github";
import { fetchInbox, overtaken } from "./inbox";
import { getInbox, getSettings, getSnapshot, saveInbox, saveSnapshot } from "./storage";
import type { Snapshot } from "./types";

/** The badge counts only the viewer's own open PRs (older snapshots lack myCount). */
export function badgeCount(snapshot: Snapshot): number {
  return snapshot.myCount ?? snapshot.prs.length;
}

async function refreshInbox(token: string, forceFull: boolean): Promise<void> {
  if (!token) return saveInbox(undefined);
  const prev = await getInbox();
  const state = await fetchInbox(token, prev, Date.now(), forceFull);
  // The token changed while fetching: a newer refresh owns the stored inbox.
  if ((await getSettings()).token !== token) return;
  // A concurrent refresh saved a newer full fetch meanwhile: keep it.
  if (overtaken(state, prev, await getInbox())) return;
  await saveInbox(state);
}

/** Fetch PRs and the notifications inbox, persist both and update the toolbar badge. */
export async function refresh(opts: { fullInbox?: boolean } = {}): Promise<Snapshot> {
  const { token } = await getSettings();
  // Isolated so a failure in either never affects the other.
  const [snapshot] = await Promise.all([
    refreshPrs(),
    refreshInbox(token, opts.fullInbox ?? false).catch(() => {}),
  ]);
  return snapshot;
}

async function refreshPrs(): Promise<Snapshot> {
  const { token, repos, prScope } = await getSettings();
  let snapshot: Snapshot;

  if (!token || repos.length === 0) {
    snapshot = { fetchedAt: Date.now(), prs: [], error: "Open settings to add a token and repositories." };
  } else {
    try {
      snapshot = { fetchedAt: Date.now(), scope: prScope, ...(await fetchPrs(token, repos, prScope)) };
    } catch (e) {
      // Keep the previous PR list visible if the fetch failed, unless it was fetched for the other
      // scope (e.g. everyone's PRs must not show up under "Only mine").
      const previous = await getSnapshot();
      const kept = previous && (previous.scope ?? "mine") === prScope ? previous : undefined;
      snapshot = {
        fetchedAt: Date.now(),
        viewer: previous?.viewer,
        scope: prScope,
        prs: kept?.prs ?? [],
        myCount: kept ? kept.myCount : 0,
        totals: kept?.totals,
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
