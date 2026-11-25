import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  accountId,
  FULL_FETCH_MS,
  INBOX_URL,
  browserUrl,
  fetchInbox,
  markDone,
  markRead,
  reasonLabel,
  toInboxItem,
  typeLabel,
} from "../src/inbox";
import type { InboxItem, InboxState } from "../src/types";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  init: RequestInit;
}
function stubFetch(respond: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
}
const headerOf = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

function thread(id: string, updated: string) {
  return {
    id,
    unread: true,
    reason: "mention",
    updated_at: updated,
    subject: { title: `t${id}`, url: `https://api.github.com/repos/o/r/issues/${id}`, type: "Issue" },
    repository: { full_name: "o/r", html_url: "https://github.com/o/r" },
  };
}
const ACC = await accountId("tok");
const item = (id: string): InboxItem => ({
  id,
  title: "t",
  type: "Issue",
  repo: "o/r",
  reason: "mention",
  unread: true,
  updatedAt: "2026-01-01T00:00:00Z",
  url: "https://github.com/o/r/issues/1",
});

test("browserUrl", () => {
  const repo = "https://github.com/o/r";
  assert.equal(browserUrl({ url: "https://api.github.com/repos/o/r/pulls/12", type: "PullRequest" }, repo), `${repo}/pull/12`);
  assert.equal(browserUrl({ url: "https://api.github.com/repos/o/r/issues/7", type: "Issue" }, repo), `${repo}/issues/7`);
  assert.equal(browserUrl({ url: "https://api.github.com/repos/o/r/commits/abc", type: "Commit" }, repo), `${repo}/commit/abc`);
  assert.equal(browserUrl({ url: "https://api.github.com/repos/o/r/releases/99", type: "Release" }, repo), `${repo}/releases`);
  assert.equal(browserUrl({ url: null, type: "CheckSuite" }, repo), `${repo}/actions`);
  assert.equal(browserUrl({ url: null, type: "Discussion" }, repo), `${repo}/discussions`);
  assert.equal(browserUrl({ url: null, type: "Whatever" }, repo), repo);
});

test("browserUrl never returns an api.github.com link", () => {
  const repo = "https://github.com/o/r";
  assert.equal(browserUrl({ url: "https://api.github.com/repos/o/r/unknown/1", type: "Issue" }, repo), repo);
});

test("labels", () => {
  assert.equal(reasonLabel("review_requested"), "Review requested");
  assert.equal(reasonLabel("mention"), "Mentioned");
  assert.equal(reasonLabel("team_mention"), "Team mentioned");
  assert.equal(reasonLabel("assign"), "Assigned");
  assert.equal(reasonLabel("author"), "Author");
  assert.equal(reasonLabel("comment"), "Commented");
  assert.equal(reasonLabel("state_change"), "State changed");
  assert.equal(reasonLabel("ci_activity"), "CI activity");
  assert.equal(reasonLabel("subscribed"), "Watching");
  assert.equal(reasonLabel("manual"), "Subscribed");
  assert.equal(reasonLabel("security_alert"), "Security alert");
  assert.equal(typeLabel("PullRequest"), "PR");
  assert.equal(typeLabel("CheckSuite"), "CI");
  assert.equal(typeLabel("Issue"), "Issue");
});

test("toInboxItem maps a thread", () => {
  assert.deepEqual(toInboxItem(thread("5", "2026-01-02T00:00:00Z")), {
    id: "5",
    title: "t5",
    type: "Issue",
    repo: "o/r",
    reason: "mention",
    unread: true,
    updatedAt: "2026-01-02T00:00:00Z",
    url: "https://github.com/o/r/issues/5",
  });
});

test("first fetch is unconditional, stores Last-Modified, sorts newest first", async () => {
  const calls = stubFetch(
    () =>
      new Response(JSON.stringify([thread("1", "2026-01-01T00:00:00Z"), thread("2", "2026-01-02T00:00:00Z")]), {
        status: 200,
        headers: { "Last-Modified": "X" },
      }),
  );
  const state = await fetchInbox("tok", undefined, 1000, false);
  assert.equal(calls[0].url, INBOX_URL);
  assert.equal(headerOf(calls[0], "If-Modified-Since"), undefined);
  assert.equal(headerOf(calls[0], "Authorization"), "Bearer tok");
  assert.equal(headerOf(calls[0], "Accept"), "application/vnd.github+json");
  assert.deepEqual(state.items.map((i) => i.id), ["2", "1"]);
  assert.equal(state.lastModified, "X");
  assert.equal(state.fullFetchedAt, 1000);
  assert.equal(state.fetchedAt, 1000);
});

test("recent fetch is conditional and a 304 keeps items", async () => {
  const now = 10 * FULL_FETCH_MS;
  const prev: InboxState = { account: ACC, fetchedAt: 0, fullFetchedAt: now - 60_000, lastModified: "X", items: [item("1")] };
  const calls = stubFetch(() => new Response(null, { status: 304 }));
  const state = await fetchInbox("tok", prev, now, false);
  assert.equal(headerOf(calls[0], "If-Modified-Since"), "X");
  assert.deepEqual(state.items, [item("1")]);
  assert.equal(state.fetchedAt, now);
  assert.equal(state.fullFetchedAt, now - 60_000);
  assert.equal(state.lastModified, "X");
});

test("full fetch when the last one is older than 5 minutes or forced", async () => {
  const now = 10 * FULL_FETCH_MS;
  const calls = stubFetch(() => new Response("[]", { status: 200 }));
  await fetchInbox("tok", { account: ACC, fetchedAt: 0, fullFetchedAt: now - FULL_FETCH_MS - 1, lastModified: "X", items: [] }, now, false);
  assert.equal(headerOf(calls[0], "If-Modified-Since"), undefined);
  await fetchInbox("tok", { account: ACC, fetchedAt: 0, fullFetchedAt: now - 1000, lastModified: "X", items: [] }, now, true);
  assert.equal(headerOf(calls[1], "If-Modified-Since"), undefined);
});

test("fine-grained token gets a dedicated error and keeps items", async () => {
  stubFetch(() => new Response("", { status: 403 }));
  const prev: InboxState = { account: await accountId("github_pat_x"), fetchedAt: 0, fullFetchedAt: 0, items: [item("1")] };
  const state = await fetchInbox("github_pat_x", prev, 5, true);
  assert.equal(state.errorKind, "fine-grained");
  assert.ok(state.error);
  assert.deepEqual(state.items, [item("1")]);
});

test("other failures keep items and report the error", async () => {
  const prev: InboxState = { account: ACC, fetchedAt: 0, fullFetchedAt: 0, items: [item("1")] };
  stubFetch(() => new Response("", { status: 500 }));
  let state = await fetchInbox("tok", prev, 5, true);
  assert.equal(state.error, "GitHub API error 500");
  assert.equal(state.errorKind, undefined);
  assert.deepEqual(state.items, [item("1")]);
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  state = await fetchInbox("tok", prev, 5, true);
  assert.equal(state.error, "offline");
  assert.deepEqual(state.items, [item("1")]);
});

test("markRead and markDone", async () => {
  const calls = stubFetch(() => new Response(null, { status: 205 }));
  await markRead("tok", "42");
  await markDone("tok", "42");
  assert.equal(calls[0].url, "https://api.github.com/notifications/threads/42");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[1].url, "https://api.github.com/notifications/threads/42");
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(headerOf(calls[0], "Authorization"), "Bearer tok");
  stubFetch(() => new Response("", { status: 500 }));
  await assert.rejects(markRead("tok", "42"));
  await assert.rejects(markDone("tok", "42"));
});

test("another account's stored inbox forces a full fetch and is never kept", async () => {
  const now = 10 * FULL_FETCH_MS;
  const old: InboxState = { account: await accountId("old"), fetchedAt: 0, fullFetchedAt: now - 1000, lastModified: "X", items: [item("1")] };
  const calls = stubFetch(() => new Response("", { status: 401 }));
  const state = await fetchInbox("tok", old, now, false);
  assert.equal(headerOf(calls[0], "If-Modified-Since"), undefined);
  assert.deepEqual(state.items, []);
  assert.equal(state.lastModified, undefined);
  assert.equal(state.account, ACC);
  assert.equal(state.error, "GitHub API error 401");
});

test("a non-array body is a clear error", async () => {
  stubFetch(() => new Response(JSON.stringify({ message: "x" }), { status: 200 }));
  const state = await fetchInbox("tok", undefined, 5, true);
  assert.equal(state.error, "Unexpected response from GitHub");
  assert.deepEqual(state.items, []);
});

test("a malformed thread is skipped while the others are kept", async () => {
  const bad = { ...thread("9", "2026-01-03T00:00:00Z"), repository: undefined };
  stubFetch(() => new Response(JSON.stringify([bad, null, thread("1", "2026-01-01T00:00:00Z")]), { status: 200 }));
  const state = await fetchInbox("tok", undefined, 5, true);
  assert.deepEqual(state.items.map((i) => i.id), ["1"]);
  assert.equal(state.error, undefined);
});
