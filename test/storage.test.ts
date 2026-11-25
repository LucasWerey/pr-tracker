import assert from "node:assert/strict";
import { test } from "node:test";
import { getSettings, saveSettings } from "../src/storage";
import { installChromeStub } from "./chrome-stub";

test("getSettings defaults prScope to mine", async () => {
  installChromeStub({ sync: { token: "t", repos: ["a/b"] } });
  assert.deepEqual(await getSettings(), { token: "t", repos: ["a/b"], prScope: "mine" });
});

test("getSettings returns the stored prScope", async () => {
  installChromeStub({ sync: { token: "t", repos: [], prScope: "all" } });
  assert.equal((await getSettings()).prScope, "all");
});

test("saveSettings writes only the given keys", async () => {
  const stub = installChromeStub({ sync: { token: "t", repos: ["a/b"] } });
  await saveSettings({ prScope: "all" });
  assert.deepEqual(stub.sync, { token: "t", repos: ["a/b"], prScope: "all" });
});
