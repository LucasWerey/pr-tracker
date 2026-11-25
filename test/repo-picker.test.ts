import assert from "node:assert/strict";
import { test } from "node:test";
import { addRepo, exactFallback, removeRepo } from "../src/repo-picker";

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
