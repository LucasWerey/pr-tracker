// Bundles every test/*.test.ts with esbuild and runs them with the Node test runner.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const outdir = join(process.env.TMPDIR ?? tmpdir(), "pr-tracker-tests");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const entryPoints = readdirSync("test")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join("test", f));

await build({
  entryPoints,
  outdir,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
});

const files = readdirSync(outdir)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => join(outdir, f));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
