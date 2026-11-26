import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  buildRepoSearchQuery,
  createDebouncedSearch,
  searchRepos,
  type RepoHit,
} from "../src/repo-search";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

test("buildRepoSearchQuery", () => {
  assert.equal(buildRepoSearchQuery(" l "), null);
  assert.equal(buildRepoSearchQuery("  live "), "live in:name fork:true");
  assert.equal(buildRepoSearchQuery("LedgerHQ/live"), "user:LedgerHQ live in:name fork:true");
  assert.equal(buildRepoSearchQuery("LedgerHQ/"), "user:LedgerHQ fork:true");
  assert.equal(buildRepoSearchQuery("/live"), "live in:name fork:true");
});

function setup(run: (text: string, signal: AbortSignal) => Promise<RepoHit[]>) {
  const results: [string, RepoHit[]][] = [];
  const errors: [string, Error][] = [];
  const search = createDebouncedSearch({
    delayMs: 300,
    minChars: 2,
    run,
    onResults: (t, h) => results.push([t, h]),
    onError: (t, e) => errors.push([t, e]),
  });
  return { search, results, errors };
}

test("runs once, 300 ms after the last keystroke, with the latest text", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  const { search } = setup(async (t) => {
    calls.push(t);
    return [];
  });
  search.input("le");
  mock.timers.tick(200);
  search.input("led");
  mock.timers.tick(299);
  assert.deepEqual(calls, []);
  mock.timers.tick(1);
  assert.deepEqual(calls, ["led"]);
});

test("a newer search aborts the previous one and drops its results", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const signals: AbortSignal[] = [];
  const resolvers: ((h: RepoHit[]) => void)[] = [];
  const { search, results } = setup((_t, signal) => {
    signals.push(signal);
    return new Promise((res) => resolvers.push(res));
  });
  search.input("led");
  mock.timers.tick(300);
  search.input("ledg");
  mock.timers.tick(300);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  resolvers[0]([{ nameWithOwner: "a/old", isPrivate: false }]);
  await Promise.resolve();
  assert.deepEqual(results, []);
  const hits = [{ nameWithOwner: "a/new", isPrivate: false }];
  resolvers[1](hits);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(results, [["ledg", hits]]);
});

test("text under 2 characters cancels and reports no results without running", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let ran = 0;
  const { search, results } = setup(async () => {
    ran++;
    return [];
  });
  search.input("led");
  search.input("l");
  assert.deepEqual(results, [["l", []]]);
  mock.timers.tick(300);
  assert.equal(ran, 0);
});

test("an aborted run that rejects stays silent", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const { search, results, errors } = setup(
    (_t, signal) =>
      new Promise((_res, rej) =>
        signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))),
      ),
  );
  search.input("led");
  mock.timers.tick(300);
  search.input("l");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, []);
  assert.deepEqual(results, [["l", []]]);
});

test("a real failure reaches onError with the original text", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const boom = new Error("boom");
  const { search, errors } = setup(() => Promise.reject(boom));
  search.input("led");
  mock.timers.tick(300);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, [["led", boom]]);
});

test("cancel() mid-flight suppresses a late result", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let resolve!: (h: RepoHit[]) => void;
  let signal!: AbortSignal;
  const { search, results, errors } = setup((_t, s) => {
    signal = s;
    return new Promise((res) => (resolve = res));
  });
  search.input("led");
  mock.timers.tick(300);
  search.cancel();
  assert.equal(signal.aborted, true);
  resolve([{ nameWithOwner: "a/b", isPrivate: false }]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(results, []);
  assert.deepEqual(errors, []);
});

function stubFetch(body: unknown, status = 200) {
  const seen: { init?: RequestInit } = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.init = init;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return seen;
}

test("searchRepos sends the query as a variable and maps nodes", async () => {
  const seen = stubFetch({
    data: { search: { nodes: [{ nameWithOwner: "o/xy", isPrivate: true }, {}] } },
  });
  const hits = await searchRepos("tok", "o/x", new AbortController().signal);
  assert.equal(JSON.parse(String(seen.init?.body)).variables.q, "user:o x in:name fork:true");
  assert.deepEqual(hits, [{ nameWithOwner: "o/xy", isPrivate: true }]);
});

test("searchRepos surfaces GraphQL errors when there are no results", async () => {
  stubFetch({ errors: [{ message: "boom" }] });
  await assert.rejects(searchRepos("tok", "abc", new AbortController().signal), /boom/);
  stubFetch({ data: null, errors: [{ message: "bang" }] });
  await assert.rejects(searchRepos("tok", "abc", new AbortController().signal), /bang/);
});

test("searchRepos keeps partial results: null and non-repo nodes are skipped, node errors ignored", async () => {
  stubFetch({
    data: { search: { nodes: [null, { nameWithOwner: "o/ok", isPrivate: false }, {}, { login: "someone" }, null] } },
    errors: [{ message: "Resource protected by organization SAML enforcement", path: ["search", "nodes", 0] }],
  });
  const hits = await searchRepos("tok", "abc", new AbortController().signal);
  assert.deepEqual(hits, [{ nameWithOwner: "o/ok", isPrivate: false }]);
});

test("searchRepos reports the error when every node failed", async () => {
  stubFetch({ data: { search: { nodes: [null, null] } }, errors: [{ message: "SAML enforcement" }] });
  await assert.rejects(searchRepos("tok", "abc", new AbortController().signal), /SAML enforcement/);
});

test("searchRepos returns no hits for an empty search without errors", async () => {
  stubFetch({ data: { search: { nodes: [] } } });
  assert.deepEqual(await searchRepos("tok", "abc", new AbortController().signal), []);
});

test("searchRepos maps HTTP errors and skips fetch for short text", async () => {
  stubFetch({}, 401);
  await assert.rejects(searchRepos("t", "abc", new AbortController().signal), /Invalid GitHub token/);
  stubFetch({}, 403);
  await assert.rejects(searchRepos("t", "abc", new AbortController().signal), /busy/);
  globalThis.fetch = (() => assert.fail("should not fetch")) as typeof fetch;
  assert.deepEqual(await searchRepos("t", "a", new AbortController().signal), []);
});
