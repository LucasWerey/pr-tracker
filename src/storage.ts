import type { InboxState, Settings, Snapshot } from "./types";

export async function getSettings(): Promise<Settings> {
  const { token = "", repos = [], prScope } = await chrome.storage.sync.get(["token", "repos", "prScope"]);
  // Anything but "all" (missing, corrupted, from a future version) means the default, "mine".
  return { token, repos, prScope: prScope === "all" ? "all" : "mine" };
}

/** Repo sections the user expanded in the panel (collapsed is the default). */
export async function getOpenRepos(): Promise<string[]> {
  const { openRepos = [] } = await chrome.storage.local.get("openRepos");
  return openRepos;
}

export function saveSettings(settings: Partial<Settings>): Promise<void> {
  return chrome.storage.sync.set(settings);
}

/** Client ID of the GitHub OAuth App used for "Sign in with GitHub" (public, not a secret). */
export async function getClientId(): Promise<string> {
  const { clientId = "" } = await chrome.storage.sync.get("clientId");
  return clientId;
}

export function saveClientId(clientId: string): Promise<void> {
  return chrome.storage.sync.set({ clientId });
}

export async function getSnapshot(): Promise<Snapshot | undefined> {
  const { snapshot } = await chrome.storage.local.get("snapshot");
  return snapshot;
}

export function saveSnapshot(snapshot: Snapshot): Promise<void> {
  return chrome.storage.local.set({ snapshot });
}

export async function getInbox(): Promise<InboxState | undefined> {
  const { inbox } = await chrome.storage.local.get("inbox");
  return inbox;
}

export function saveInbox(state: InboxState | undefined): Promise<void> {
  return state ? chrome.storage.local.set({ inbox: state }) : chrome.storage.local.remove("inbox");
}
