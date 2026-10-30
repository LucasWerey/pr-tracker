import { refresh } from "./refresh";

const ALARM = "refresh";

function schedule() {
  chrome.alarms.create(ALARM, { periodInMinutes: 5 });
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
  if (area === "sync" && (changes.token || changes.repos)) void refresh();
});
