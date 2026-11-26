import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLocalChanges, applyWrite, recordWrite, runWrite, typeIcon, unreadCount } from "../src/inbox-view";
import type { InboxItem, InboxState } from "../src/types";
import { installChromeStub } from "./chrome-stub";

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

test("typeIcon only ever returns static SVG, even for Object.prototype keys", () => {
  const bell = typeIcon("SomethingNew");
  assert.match(bell, /^<svg [^>]*>.*<\/svg>$/);
  assert.notEqual(typeIcon("PullRequest"), bell);
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(typeIcon(key), bell);
  }
});

const stored: InboxState = { account: "acc", fetchedAt: 1, fullFetchedAt: 1, lastModified: "X", items: [a, b] };

test("applyWrite removes a done thread and drops Last-Modified", () => {
  const next = applyWrite(stored, "done", "1");
  assert.deepEqual(next.items.map((i) => i.id), ["2"]);
  assert.equal(next.lastModified, undefined);
  assert.equal(next.fullFetchedAt, 1);
  assert.equal(stored.items.length, 2, "the input is not mutated");
});

test("applyWrite marks a read thread as read and keeps it", () => {
  const next = applyWrite(stored, "read", "2");
  assert.deepEqual(next.items.map((i) => [i.id, i.unread]), [["1", true], ["2", false]]);
  assert.equal(next.lastModified, undefined);
});

test("recordWrite updates the stored inbox of the same account only", async () => {
  const stub = installChromeStub({ local: { inbox: stored } });
  await recordWrite("acc", "done", "1");
  assert.deepEqual((stub.local.inbox as InboxState).items.map((i) => i.id), ["2"]);
  assert.equal((stub.local.inbox as InboxState).lastModified, undefined);

  const other = installChromeStub({ local: { inbox: stored } });
  await recordWrite("someone-else", "done", "1");
  assert.deepEqual(other.local.inbox, stored);

  const empty = installChromeStub();
  await recordWrite("acc", "read", "1");
  assert.equal("inbox" in empty.local, false);
});
