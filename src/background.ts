import { refresh } from "./refresh";

const ALARM = "refresh";

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}

// Clicking the toolbar icon opens the side panel (there is no popup).
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(() => {
  schedule();
  void refresh();
});
chrome.runtime.onStartup.addListener(() => {
  schedule();
  void refresh();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refresh();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  // A new token means a different account: never show the old inbox.
  if (changes.token) void refresh({ fullInbox: true });
  else if (changes.repos || changes.prScope) void refresh();
});
