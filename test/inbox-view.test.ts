import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLocalChanges, runWrite, unreadCount } from "../src/inbox-view";
import type { InboxItem } from "../src/types";

const a = { id: "1", unread: true } as InboxItem;
const b = { id: "2", unread: true } as InboxItem;

test("applyLocalChanges drops items marked done", () => {
  const items = applyLocalChanges([a, b], { done: new Set(["1"]), read: new Set() });
  assert.deepEqual(items.map((i) => i.id), ["2"]);
});

test("applyLocalChanges shows locally read items as read", () => {
  const items = applyLocalChanges([a, b], { done: new Set(), read: new Set(["2"]) });
  assert.equal(items[0].unread, true);
  assert.equal(items[1].unread, false);
});

test("unreadCount counts only unread items", () => {
  assert.equal(unreadCount([a, { ...b, unread: false }]), 1);
});

test("runWrite rejects when the GitHub call fails and skips the bookkeeping", async () => {
  let synced = false;
  await assert.rejects(
    runWrite(async () => { throw new Error("GitHub API error 500"); }, async () => { synced = true; }),
    /500/,
  );
  assert.equal(synced, false);
});

test("runWrite ignores storage errors after a successful GitHub call", async () => {
  await runWrite(async () => {}, async () => { throw new Error("storage"); });
});
