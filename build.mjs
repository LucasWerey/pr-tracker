import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    background: "src/background.ts",
    panel: "src/panel.ts",
    options: "src/options.ts",
  },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
  sourcemap: true,
  logLevel: "info",
};

async function copyStatic() {
  await mkdir("dist", { recursive: true });
  await cp("public", "dist", { recursive: true });
}

if (watch) {
  await copyStatic();
  const ctx = await context(options);
  await ctx.watch();
} else {
  await rm("dist", { recursive: true, force: true });
  await copyStatic();
  await build(options);
}
