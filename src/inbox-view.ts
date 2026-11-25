import { el, ago, placeholder, svg } from "./dom";
import { markDone, markRead, reasonLabel, typeLabel } from "./inbox";
import { getInbox, saveInbox } from "./storage";
import type { InboxItem, InboxState } from "./types";

/** Changes made in this panel that the stored list may not reflect yet (e.g. a refresh was in flight). */
const local = { done: new Set<string>(), read: new Set<string>() };

export function applyLocalChanges(
  items: InboxItem[],
  changes: { done: Set<string>; read: Set<string> },
): InboxItem[] {
  return items
    .filter((i) => !changes.done.has(i.id))
    .map((i) => (i.unread && changes.read.has(i.id) ? { ...i, unread: false } : i));
}

export function unreadCount(items: InboxItem[]): number {
  return items.filter((i) => i.unread).length;
}

/** Unread count as shown in the tab badge: the stored list plus local changes. */
export function visibleUnread(state: InboxState | undefined): number {
  return state ? unreadCount(applyLocalChanges(state.items, local)) : 0;
}

const ICONS: Record<string, string> = {
  PullRequest:
    '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>',
  Issue: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  Release: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1"/>',
  CheckSuite: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  Commit: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
};
const FALLBACK_ICON = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>';

const CHECK = '<path d="M20 6 9 17l-5-5"/>';

function renderItem(item: InboxItem, state: InboxState, token: string, rerender: (failure?: string) => void, onChange: () => void): HTMLElement {
  const row = el("div", item.unread ? "inbox-item unread" : "inbox-item");

  const link = el("a", "inbox-link");
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener";
  const icon = el("span", "type-icon");
  icon.innerHTML = svg(ICONS[item.type] ?? FALLBACK_ICON, 16);
  const body = el("span", "body");
  const title = el("span", "title");
  title.append(el("span", "dot"), document.createTextNode(item.title));
  body.append(
    title,
    el(
      "span",
      "sub",
      `${typeLabel(item.type)} · ${item.repo} · ${reasonLabel(item.reason)} · ${ago(item.updatedAt)}`,
    ),
  );
  link.append(icon, body);

  // The browser opens the link; we only mark the thread read in the background.
  const opened = () => {
    if (!item.unread || local.read.has(item.id)) return;
    local.read.add(item.id);
    row.classList.remove("unread");
    onChange();
    void write(state, () => markRead(token, item.id)).catch(() => local.read.delete(item.id));
  };
  link.addEventListener("click", opened);
  link.addEventListener("auxclick", (e) => {
    if (e.button === 1) opened();
  });

  const done = el("button", "icon-btn done-btn");
  done.type = "button";
  done.title = "Mark as done";
  done.setAttribute("aria-label", "Mark as done");
  done.innerHTML = svg(CHECK, 16);
  done.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    local.done.add(item.id);
    rerender();
    write(state, () => markDone(token, item.id)).catch(() => {
      local.done.delete(item.id);
      rerender("Couldn't mark the notification as done. Try again.");
    });
  });

  row.append(link, done);
  return row;
}

/**
 * Runs a GitHub write. Only a failure of `action` rejects; `afterSuccess` (storage bookkeeping)
 * is best-effort so a storage error never looks like a GitHub failure.
 */
export async function runWrite(action: () => Promise<void>, afterSuccess: () => Promise<void>): Promise<void> {
  await action();
  try {
    await afterSuccess();
  } catch {
    // The server already has the change; the next full fetch reconciles.
  }
}

/** Drops Last-Modified after a write so the next conditional fetch can't return a stale 304. */
function write(state: InboxState, action: () => Promise<void>): Promise<void> {
  return runWrite(action, async () => {
    const current = await getInbox();
    if (current?.account === state.account) await saveInbox({ ...current, lastModified: undefined });
  });
}

/** Renders the inbox. `onChange` runs after local changes so the caller can refresh the unread badge. */
export function renderInboxTab(
  container: HTMLElement,
  state: InboxState | undefined,
  token: string,
  onChange: () => void = () => {},
): void {
  container.replaceChildren();
  if (!token) {
    container.append(
      placeholder("Set up PR Tracker", "Sign in with GitHub and choose the repositories you want to follow.", true),
    );
    return;
  }
  if (!state) {
    container.append(el("div", "skeleton"), el("div", "skeleton"));
    return;
  }
  if (state.errorKind === "fine-grained") {
    container.append(
      placeholder(
        "Inbox unavailable",
        "The inbox needs a classic token or the OAuth App sign-in. Fine-grained tokens can't read notifications.",
        true,
      ),
    );
    return;
  }

  // Forget local changes once the server data agrees with them.
  const byId = new Map(state.items.map((i) => [i.id, i]));
  for (const id of local.done) if (!byId.has(id)) local.done.delete(id);
  for (const id of local.read) if (!byId.get(id)?.unread) local.read.delete(id);

  const rerender = (failure?: string) => {
    renderInboxTab(container, state, token, onChange);
    if (failure) container.prepend(el("div", "notice error", failure));
    onChange();
  };

  const items = applyLocalChanges(state.items, local);
  if (state.error) container.append(el("div", "notice error", state.error));
  if (items.length === 0) {
    if (!state.error) container.append(el("div", "inbox-zero", "Inbox zero 🎉"));
    return;
  }
  const list = el("div", "inbox-list");
  for (const item of items) list.append(renderItem(item, state, token, rerender, onChange));
  container.append(list);
}
