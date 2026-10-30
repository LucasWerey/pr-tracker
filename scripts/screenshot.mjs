// Renders the real side panel in headless Chrome with sample data and saves
// docs/screenshot-light.png and docs/screenshot-dark.png (no private data involved).
// Run with `pnpm screenshot`; set CHROME to override the browser path.
import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const work = join(process.env.TMPDIR ?? tmpdir(), "pr-tracker-demo");

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#4078ff"/>
  </linearGradient></defs>
  <rect width="96" height="96" fill="url(#g)"/>
  <circle cx="48" cy="38" r="16" fill="#fff"/>
  <path d="M16 96c0-20 14-32 32-32s32 12 32 32z" fill="#fff"/>
</svg>`;

// Fake `chrome` APIs and GitHub GraphQL response, injected ahead of the real panel code.
const stub = (avatarUrl) => `
(() => {
  const repos = ["acme/web-app", "acme/payments-api", "acme/mobile"];
  const store = {
    sync: { token: "demo", repos, clientId: "demo" },
    local: { openRepos: repos.slice(0, 2) }, // the third repo stays collapsed, as it is by default
  };
  const area = (name) => ({
    get: async (keys) => {
      const list = typeof keys === "string" ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in store[name]).map((k) => [k, store[name][k]]));
    },
    set: async (items) => Object.assign(store[name], items),
  });
  window.chrome = {
    storage: { sync: area("sync"), local: area("local"), onChanged: { addListener() {} } },
    runtime: { openOptionsPage() {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };

  const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const pr = (repo, number, title, o = {}) => ({
    number, title, url: "https://github.com/" + repo + "/pull/" + number,
    isDraft: false, updatedAt: ago(o.mins ?? 30), mergeable: o.mergeable ?? "MERGEABLE",
    reviewDecision: o.review ?? null, repository: { nameWithOwner: repo },
    mergeQueueEntry: o.queue ?? null,
    reviewThreads: { nodes: Array.from({ length: o.threads ?? 0 }, () => ({ isResolved: false })) },
    commits: { nodes: [{ commit: { statusCheckRollup: o.ci ? { state: o.ci } : null } }] },
    ...(o.draft ? { isDraft: true } : {}),
  });
  const web = "acme/web-app", api = "acme/payments-api", mob = "acme/mobile";
  const nodes = [
    pr(web, 482, "Add dark mode toggle to settings", { review: "APPROVED", ci: "SUCCESS", mins: 12 }),
    pr(web, 479, "Fix flaky checkout test", { review: "APPROVED", ci: "SUCCESS", queue: { position: 2, state: "AWAITING_CHECKS" }, mins: 4 }),
    pr(web, 471, "Migrate authentication to OIDC", { review: "REVIEW_REQUIRED", ci: "PENDING", mins: 95 }),
    pr(web, 466, "Refactor cart reducer to use selectors", { review: "CHANGES_REQUESTED", ci: "FAILURE", threads: 2, mins: 300 }),
    pr(web, 460, "WIP: new onboarding flow", { draft: true, ci: "SUCCESS", mins: 1500 }),
    pr(api, 213, "Retry failed webhooks with exponential backoff", { review: "APPROVED", ci: "SUCCESS", mins: 45 }),
    pr(api, 209, "Add idempotency keys to payment intents", { review: "REVIEW_REQUIRED", ci: "SUCCESS", mergeable: "CONFLICTING", mins: 200 }),
    pr(mob, 98, "Upgrade to React Native 0.76", { draft: true, ci: "PENDING", mins: 2900 }),
  ];
  const data = {
    viewer: {
      login: "octocat", avatarUrl: ${JSON.stringify(avatarUrl)}, url: "https://github.com/octocat",
      pullRequests: { nodes },
    },
  };
  repos.forEach((r, i) => (data["r" + i] = { nameWithOwner: r }));
  window.fetch = async () => new Response(JSON.stringify({ data }), { status: 200 });
})();
`;

await mkdir(join(work, "icons"), { recursive: true });
await mkdir("docs", { recursive: true });
await writeFile(join(work, "avatar.svg"), AVATAR_SVG);

await build({
  entryPoints: ["src/panel.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: join(work, "panel.js"),
  banner: { js: stub(`file://${join(work, "avatar.svg")}`) },
  logLevel: "silent",
});
await cp("public/styles.css", join(work, "styles.css"));
await cp("public/icons", join(work, "icons"), { recursive: true });
// Headless Chrome lays the page out wider than the captured area, so pin the page to the
// capture size and anchor the floating avatar button to it instead of the viewport.
const PAGE = { width: 440, height: 1000 };
const html = (await readFile("public/sidepanel.html", "utf8"))
  .replace(
    '<script type="module" src="panel.js"></script>',
    `<style>
      html, body { width: ${PAGE.width}px; height: ${PAGE.height}px; overflow: hidden; }
      body { position: relative; }
      .fab { position: absolute; }
    </style>
    <script src="panel.js" defer></script>`,
  );
await writeFile(join(work, "sidepanel.html"), html);

for (const [name, scheme] of [["dark", 0], ["light", 1]]) {
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      // Only needed when this script already runs inside another sandbox (Chrome can't nest them).
      ...(process.env.CHROME_NO_SANDBOX ? ["--no-sandbox"] : []),
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${join(work, "profile-" + name)}`,
      "--force-device-scale-factor=2",
      `--window-size=${PAGE.width},${PAGE.height}`,
      "--virtual-time-budget=4000",
      `--blink-settings=preferredColorScheme=${scheme}`,
      `--screenshot=docs/screenshot-${name}.png`,
      `file://${join(work, "sidepanel.html")}`,
    ],
    { stdio: "ignore" },
  );
  console.log(`wrote docs/screenshot-${name}.png`);
}
