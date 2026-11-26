import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildPrQuery, fetchPrs, parsePrData } from "../src/github";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function node(repo: string, number: number, author: { login: string; avatarUrl: string } | null = null) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    isDraft: false,
    updatedAt: "2026-01-01T00:00:00Z",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    author,
    repository: { nameWithOwner: repo },
    mergeQueueEntry: null,
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
  };
}

const viewer = { login: "me", avatarUrl: "a", url: "u" };

test("all-mode query asks each repo for its 20 latest open PRs", () => {
  const q = buildPrQuery(["a/b"], "all");
  assert.match(q, /r0: repository\(owner: "a", name: "b"\)/);
  assert.match(q, /pullRequests\(states: OPEN, first: 20, orderBy: \{field: UPDATED_AT, direction: DESC\}\)/);
  assert.match(q, /totalCount/);
  assert.match(q, /author \{ login avatarUrl/);
});

test("mine-mode query keeps the viewer's 100 latest", () => {
  const q = buildPrQuery(["a/b"], "mine");
  assert.match(q, /pullRequests\(states: OPEN, first: 100/);
  assert.doesNotMatch(q, /first: 20/);
});

test("parsePrData mine: filters to followed repos and counts mine", () => {
  const data = {
    r0: { nameWithOwner: "a/b" },
    viewer: { ...viewer, pullRequests: { nodes: [node("a/b", 1, { login: "me", avatarUrl: "a" }), node("x/y", 2)] } },
  };
  const r = parsePrData(data, ["a/b"], "mine");
  assert.deepEqual(r.prs.map((p) => p.repo), ["a/b"]);
  assert.equal(r.myCount, 1);
  assert.equal(r.totals, undefined);
  assert.deepEqual(r.prs[0].author, { login: "me", avatarUrl: "a" });
});

test("parsePrData all: PRs from repo aliases, totals, ghost author, inaccessible", () => {
  const data = {
    r0: {
      nameWithOwner: "a/b",
      pullRequests: {
        totalCount: 57,
        nodes: [node("a/b", 1, { login: "octocat", avatarUrl: "o" }), node("a/b", 2, null)],
      },
    },
    r1: null,
    viewer: {
      ...viewer,
      pullRequests: { nodes: [{ repository: { nameWithOwner: "A/B" } }, { repository: { nameWithOwner: "x/y" } }] },
    },
  };
  const r = parsePrData(data, ["a/b", "c/d"], "all");
  assert.equal(r.prs.length, 2);
  assert.deepEqual(r.prs[1].author, { login: "ghost", avatarUrl: "" });
  assert.deepEqual(r.totals, { "a/b": 57 });
  assert.deepEqual(r.inaccessible, ["c/d"]);
  assert.equal(r.myCount, 1);
});

test("fetchPrs keeps error handling", async () => {
  globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
  await assert.rejects(fetchPrs("t", ["a/b"], "all"), /Invalid GitHub token/);
  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  await assert.rejects(fetchPrs("t", ["a/b"], "all"), /GitHub API error 500/);
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "boom" }] }), { status: 200 })) as typeof fetch;
  await assert.rejects(fetchPrs("t", ["a/b"], "all"), /boom/);
});
