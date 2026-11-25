import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { badgeCount, refresh } from "../src/refresh";
import type { PullRequest } from "../src/types";
import { installChromeStub } from "./chrome-stub";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const pr = {} as PullRequest;

function prNode(n: number) {
  return {
    number: n,
    title: "t",
    url: "u",
    isDraft: false,
    updatedAt: "2026-01-01T00:00:00Z",
    mergeable: "MERGEABLE",
    reviewDecision: null,
    author: { login: "o", avatarUrl: "" },
    repository: { nameWithOwner: "a/b" },
    mergeQueueEntry: null,
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
  };
}

test("badgeCount falls back to prs.length for old snapshots", () => {
  assert.equal(badgeCount({ fetchedAt: 0, prs: [pr, pr, pr], myCount: 1 }), 1);
  assert.equal(badgeCount({ fetchedAt: 0, prs: [pr, pr, pr] }), 3);
});

test("refresh sets the badge to myCount", async () => {
  const stub = installChromeStub({ sync: { token: "t", repos: ["a/b"], prScope: "all" } });
  const data = {
    r0: { nameWithOwner: "a/b", pullRequests: { totalCount: 3, nodes: [prNode(1), prNode(2), prNode(3)] } },
    viewer: { login: "me", avatarUrl: "", url: "", pullRequests: { nodes: [{ repository: { nameWithOwner: "a/b" } }] } },
  };
  globalThis.fetch = (async () => new Response(JSON.stringify({ data }), { status: 200 })) as typeof fetch;
  const snap = await refresh();
  assert.equal(snap.prs.length, 3);
  assert.equal(snap.myCount, 1);
  assert.equal(stub.badge.text, "1");
});

test("refresh keeps previous prs, myCount and totals on failure", async () => {
  const prev = { fetchedAt: 1, prs: [pr], myCount: 4, totals: { "a/b": 9 }, viewer: { login: "me", avatarUrl: "", url: "" } };
  installChromeStub({ sync: { token: "t", repos: ["a/b"] }, local: { snapshot: prev } });
  globalThis.fetch = (async () => new Response("", { status: 500 })) as typeof fetch;
  const snap = await refresh();
  assert.equal(snap.error, "GitHub API error 500");
  assert.equal(snap.myCount, 4);
  assert.deepEqual(snap.totals, { "a/b": 9 });
  assert.equal(snap.prs.length, 1);
});
