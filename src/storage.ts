import type { Settings, Snapshot } from "./types";

export async function getSettings(): Promise<Settings> {
  const { token = "", repos = [], prScope = "mine" } = await chrome.storage.sync.get([
    "token",
    "repos",
    "prScope",
  ]);
  return { token, repos, prScope };
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
