import assert from "node:assert/strict";
import { test } from "node:test";
import { addRepo, enterTarget, exactFallback, removeRepo, resultRows } from "../src/repo-picker";

test("addRepo appends and dedupes case-insensitively", () => {
  assert.deepEqual(addRepo(["a/b"], "A/B"), ["a/b"]);
  assert.deepEqual(addRepo(["a/b"], "c/d"), ["a/b", "c/d"]);
});

test("removeRepo is case-insensitive", () => {
  assert.deepEqual(removeRepo(["a/b", "c/d"], "A/B"), ["c/d"]);
});

test("exactFallback offers a typed owner/name that search did not return", () => {
  assert.equal(exactFallback(" LedgerHQ/foo ", [{ nameWithOwner: "LedgerHQ/foobar", isPrivate: false }]), "LedgerHQ/foo");
  assert.equal(exactFallback("LedgerHQ/foo", [{ nameWithOwner: "ledgerhq/FOO", isPrivate: false }]), null);
  assert.equal(exactFallback("foo", []), null);
  assert.equal(exactFallback("a/b/c", []), null);
});

const hits = [
  { nameWithOwner: "LedgerHQ/live-common", isPrivate: false },
  { nameWithOwner: "LedgerHQ/live-secret", isPrivate: true },
];

test("resultRows marks followed hits case-insensitively and keeps privacy", () => {
  const rows = resultRows("LedgerHQ/live", hits, true, ["ledgerhq/LIVE-common"]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.following, r.isPrivate, r.fallback]),
    [
      ["LedgerHQ/live-common", true, false, false],
      ["LedgerHQ/live-secret", false, true, false],
      ["LedgerHQ/live", false, false, true],
    ],
  );
});

test("resultRows offers no fallback while the search is unsettled", () => {
  const rows = resultRows("LedgerHQ/live", hits, false, []);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !r.fallback));
  assert.equal(resultRows("LedgerHQ/live", [], false, []).length, 0);
});

test("resultRows offers the fallback after an error (no hits) and not for an exact hit", () => {
  assert.deepEqual(
    resultRows("a/b", [], true, []).map((r) => [r.name, r.fallback]),
    [["a/b", true]],
  );
  assert.equal(resultRows("ledgerhq/LIVE-common", hits, true, []).some((r) => r.fallback), false);
  assert.equal(resultRows("nope", [], true, []).length, 0);
});

test("enterTarget picks the first addable row and nothing while unsettled", () => {
  const rows = resultRows("LedgerHQ/live", hits, true, ["LedgerHQ/live-common"]);
  assert.equal(enterTarget(rows, true)?.name, "LedgerHQ/live-secret");
  assert.equal(enterTarget(rows, false), null);
  assert.equal(enterTarget(resultRows("x", [], true, []), true), null);
  assert.equal(enterTarget(resultRows("a/b", [], true, []), true)?.name, "a/b");
});
