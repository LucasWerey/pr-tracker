import assert from "node:assert/strict";
import { test } from "node:test";
import { latestOnly } from "../src/dom";

/** A load whose calls resolve only when the test says so. */
function controlledLoad() {
  const pending: ((value: string) => void)[] = [];
  const load = () => new Promise<string>((resolve) => pending.push(resolve));
  return { load, pending };
}

test("latestOnly: overlapping calls paint once, with the latest load, whatever the order loads finish in", async () => {
  for (const order of [[0, 1], [1, 0]]) {
    const { load, pending } = controlledLoad();
    const painted: string[] = [];
    const render = latestOnly(load, (v) => painted.push(v));
    const calls = [render(), render()];
    for (const i of order) pending[i](`load ${i}`);
    await Promise.all(calls);
    assert.deepEqual(painted, ["load 1"], `loads finishing in order ${order}`);
  }
});

test("latestOnly: calls that don't overlap each paint", async () => {
  const { load, pending } = controlledLoad();
  const painted: string[] = [];
  const render = latestOnly(load, (v) => painted.push(v));
  const first = render();
  pending[0]("a");
  await first;
  const second = render();
  pending[1]("b");
  await second;
  assert.deepEqual(painted, ["a", "b"]);
});
