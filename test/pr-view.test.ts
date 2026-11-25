import assert from "node:assert/strict";
import { test } from "node:test";
import { footerText, subLine } from "../src/pr-view";
import type { PullRequest } from "../src/types";

const pr = { number: 123, updatedAt: new Date().toISOString(), author: { login: "alice", avatarUrl: "" } } as PullRequest;

test("subLine shows the author in everyone's mode only", () => {
  assert.match(subLine(pr, "all"), /^#123 · @alice · updated /);
  assert.match(subLine(pr, "mine"), /^#123 · updated /);
});

test("subLine tolerates snapshots saved before authors existed", () => {
  assert.match(subLine({ ...pr, author: undefined } as unknown as PullRequest, "all"), /^#123 · updated /);
});

test("footerText only appears when the repo has more PRs than shown", () => {
  assert.equal(footerText(20, 57), "Showing 20 of 57");
  assert.equal(footerText(12, 12), null);
  assert.equal(footerText(3, undefined), null);
});
