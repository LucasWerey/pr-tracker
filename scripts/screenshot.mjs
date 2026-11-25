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
// SCREENSHOT_SCOPE=all renders everyone's mode and writes to the scratch dir, not docs/.
const SCOPE = process.env.SCREENSHOT_SCOPE === "all" ? "all" : "mine";
const OUT_DIR = SCOPE === "all" ? work : "docs";
// SCREENSHOT_TAB=inbox renders the Inbox tab and writes screenshot-inbox-*.png.
const TAB = process.env.SCREENSHOT_TAB === "inbox" ? "inbox" : "prs";
const FILE_PREFIX = TAB === "inbox" ? "screenshot-inbox" : "screenshot";

const AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#4078ff"/>
  </linearGradient></defs>
  <rect width="96" height="96" fill="url(#g)"/>
  <circle cx="48" cy="38" r="16" fill="#fff"/>
  <path d="M16 96c0-20 14-32 32-32s32 12 32 32z" fill="#fff"/>
</svg>`;

// Fake `chrome` APIs and GitHub GraphQL response, injected ahead of the real panel code.
const stub = (avatarUrl, scope, tab) => `
(() => {
  const repos = ["acme/web-app", "acme/payments-api", "acme/mobile"];
  const store = {
    sync: { token: "demo", repos, clientId: "demo", prScope: ${JSON.stringify(scope)} },
    local: { openRepos: repos.slice(0, 2), tab: ${JSON.stringify(tab)} }, // the third repo stays collapsed, as it is by default
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
    author: { login: o.author ?? "octocat", avatarUrl: ${JSON.stringify(avatarUrl)} },
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

  // "All" mode: each repo alias carries its own latest PRs (a mix of authors) plus a total count.
  const others = ["alice", "bob", "carol"];
  const byRepo = [web, api, mob].map((r) => nodes.filter((n) => n.repository.nameWithOwner === r));
  const allData = {
    viewer: {
      ...data.viewer,
      pullRequests: { nodes: nodes.filter((n) => n.author.login === "octocat").map((n) => ({ repository: n.repository })) },
    },
  };
  repos.forEach((r, i) => {
    const mixed = byRepo[i].map((n, j) => (j % 2 === 1 ? { ...n, author: { ...n.author, login: others[j % 3] } } : n));
    allData["r" + i] = {
      nameWithOwner: r,
      pullRequests: { totalCount: i === 0 ? 57 : mixed.length, nodes: mixed },
    };
  });

  // GitHub-shaped notification threads (two unread).
  const thread = (id, mins, unread, reason, type, title, repo, path) => ({
    id, unread, reason, updated_at: ago(mins),
    subject: { title, type, url: path ? "https://api.github.com/repos/" + repo + path : null },
    repository: { full_name: repo, html_url: "https://github.com/" + repo },
  });
  const threads = [
    thread("1", 6, true, "review_requested", "PullRequest", "Migrate authentication to OIDC", web, "/pulls/471"),
    thread("2", 40, true, "mention", "Issue", "Checkout fails when the cart has a discount code", web, "/issues/455"),
    thread("3", 130, false, "subscribed", "Release", "v2.4.0", api, "/releases/9001"),
    thread("4", 400, false, "ci_activity", "CheckSuite", "CI workflow run failed for main", mob, null),
    thread("5", 1700, false, "comment", "Issue", "Webhook retries are not logged", api, "/issues/201"),
  ];

  window.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/notifications")) {
      return new Response(JSON.stringify(threads), { status: 200, headers: { "Last-Modified": new Date().toUTCString() } });
    }
    const query = init && typeof init.body === "string" ? JSON.parse(init.body).query : "";
    return new Response(JSON.stringify({ data: query.includes("first: 20") ? allData : data }), { status: 200 });
  };
})();
`;

await mkdir(join(work, "icons"), { recursive: true });
await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(work, "avatar.svg"), AVATAR_SVG);

await build({
  entryPoints: ["src/panel.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: join(work, "panel.js"),
  banner: { js: stub(`file://${join(work, "avatar.svg")}`, SCOPE, TAB) },
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
      `--screenshot=${join(OUT_DIR, `${FILE_PREFIX}-${name}.png`)}`,
      `file://${join(work, "sidepanel.html")}`,
    ],
    { stdio: "ignore" },
  );
  console.log(`wrote ${join(OUT_DIR, `${FILE_PREFIX}-${name}.png`)}`);
}
