# Token Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste a GitHub personal access token in Settings, next to the existing "Sign in with GitHub" button, and use it for every GitHub call.

**Architecture:** The pasted token is checked with `fetchViewerLogin` and saved into the existing `token` key in `chrome.storage.sync`, the same slot the device flow fills, so refresh, background and panel need no change. Only the settings page gains UI and logic; the panel hint and README get wording updates.

**Tech Stack:** TypeScript, esbuild, Chrome MV3 extension APIs, no runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-token-sign-in-design.md`

## Global Constraints

- Token goes in the existing `token` key of `chrome.storage.sync`. No new storage key, no auth-method flag.
- Token input is `type="password"`, `autocomplete="off"`, never pre-filled with the saved token.
- A token GitHub rejects is never saved.
- Device flow, Client ID field and Advanced section stay as they are.
- "Create one" link: `https://github.com/settings/tokens/new?scopes=repo&description=PR%20Tracker`
- Hint copy: "Classic token with the `repo` scope. For an SSO org, click **Configure SSO → Authorize** next to the token."
- No test framework exists in the repo and none is added. Behaviour is checked by a throwaway harness in the session scratchpad (not committed): `SCRATCH=/private/tmp/claude-503/-Users-mathieu-bertin-Ledger-dev-worktrees-pr-tracker-github-oauth-token-auth-5f56fc/bdfbf338-08d8-4deb-a3be-045237a66d9e/scratchpad`.

## Review Focus

1. **Network failure during the check** (`fetch` throws): show "Couldn't reach GitHub. Try again." and save nothing; today `fetchViewerLogin` throws in that case. → scenario `connect-offline`.
2. **Pasted value with spaces or a trailing newline**: trimmed before checking and saving. → `connect-valid`.
3. **Token pasted, then bottom Save clicked instead of Connect**: the token is connected; if GitHub rejects it, nothing is saved, repos included. → `save-with-token`, `save-with-rejected-token`.
4. **Saved token later revoked**: on load the token row shows next to Sign in and Sign out so it can be replaced, field empty. → `saved-token-invalid`.
5. **Connect clicked twice while the check runs**: button disabled until the check ends. → `double-click`.

---

### Task 1: Token field and connect logic on the settings page

**Files:**
- Modify: `public/options.html` (after the `.conn` div, before `#device`)
- Modify: `public/styles.css` (options section, next to `.conn` rules)
- Modify: `src/options.ts`
- Test (scratchpad, not committed): `$SCRATCH/verify-options.mjs`

**Interfaces:**
- Consumes: `fetchViewerLogin(token: string): Promise<string | null>` from `src/github.ts` (throws on network error); `getSettings()`, `saveSettings(settings: Settings)` from `src/storage.ts`.
- Produces: DOM ids `token-row`, `token`, `connect` (used by the harness); `connectToken(raw: string): Promise<boolean>` in `src/options.ts` (module-private).

- [ ] **Step 1: Install dependencies**

Run: `pnpm install --frozen-lockfile`
Expected: `node_modules/esbuild` exists.

- [ ] **Step 2: Write the harness `$SCRATCH/verify-options.mjs`**

Model it on `scripts/screenshot.mjs`. Run from the repo root. Resolve esbuild from the repo, not the scratchpad: `createRequire(join(process.cwd(), "package.json"))("esbuild")`. For each scenario, bundle `src/options.ts` as an IIFE with a banner stub, write `public/options.html` (script tag swapped for the bundle) plus `styles.css` and icons into `$SCRATCH/options-demo/<scenario>/`, run Chrome `--headless=new --dump-dom --virtual-time-budget=4000` (plus `--no-sandbox` when `CHROME_NO_SANDBOX` is set), and read a JSON result the stub writes into `<pre id="result">`.

Stub per scenario: `chrome.storage.sync` backed by an in-memory store seeded from the scenario; `fetch` for `https://api.github.com/user` waits 100 ms, then `Bearer good-token` → 200 `{"login":"octocat"}`, `Bearer offline` → throws `TypeError`, anything else → 401; counts calls in `window.__userCalls`. After 300 ms it runs the scenario's actions, waits 500 ms, then writes `{store, tokenValue, tokenRowHidden, signinHidden, signoutHidden, connText, statusText, statusClass, connectDisabledAfterClick, userCallsDuringAction}`.

Scenarios and assertions (`assert.deepStrictEqual` / `assert.match`; print `PASS <name>` or the failure; exit 1 on any failure):

| Scenario | Seed `{token, repos}` | Actions | Assert |
|---|---|---|---|
| `connect-valid` | `"", ["a/b"]` | `#token` = `"  good-token\n"`, click `#connect` | `store.token === "good-token"`, `tokenValue === ""`, `connText === "Connected as @octocat"`, `tokenRowHidden`, `signinHidden` |
| `connect-rejected` | `"", ["a/b"]` | `#token` = `"bad-token"`, click `#connect` | `store.token === ""`, `statusClass === "error"`, `statusText` matches `/rejected/`, `tokenValue === "bad-token"` |
| `connect-offline` | `"", ["a/b"]` | `#token` = `"offline"`, click `#connect` | `store.token === ""`, `statusText` matches `/reach GitHub/` |
| `connect-empty` | `"", ["a/b"]` | `#token` = `"   "`, click `#connect` | `statusText === "Paste a token first."`, `userCallsDuringAction === 0` |
| `enter-key` | `"", ["a/b"]` | `#token` = `"good-token"`, `keydown` Enter on `#token` | `store.token === "good-token"` |
| `save-with-token` | `"", ["a/b"]` | `#repos` = `"o/r"`, `#token` = `"good-token"`, click `#save` | `store.token === "good-token"`, `store.repos` deep-equals `["o/r"]` |
| `save-with-rejected-token` | `"", ["a/b"]` | `#repos` = `"o/r"`, `#token` = `"bad-token"`, click `#save` | `store.token === ""`, `store.repos` deep-equals `["a/b"]`, `statusClass === "error"` |
| `saved-token-invalid` | `"bad-token", ["a/b"]` | none | `!tokenRowHidden`, `!signoutHidden`, `tokenValue === ""` |
| `connected-on-load` | `"good-token", ["a/b"]` | none | `tokenRowHidden`, `tokenValue === ""` |
| `double-click` | `"", ["a/b"]` | `#token` = `"good-token"`, click `#connect`, read `#connect.disabled` synchronously | `connectDisabledAfterClick === true` |

Also take two screenshots of the `connect-empty` page before actions (`--screenshot`, `preferredColorScheme` 0 and 1, window 640×900) to `$SCRATCH/options-dark.png` and `$SCRATCH/options-light.png`.

- [ ] **Step 3: Run the harness to see it fail**

Run: `CHROME_NO_SANDBOX=1 node $SCRATCH/verify-options.mjs`
Expected: FAIL on every scenario that touches `#token` / `#connect` (elements missing).

- [ ] **Step 4: Add the token row to `public/options.html`**

Inside a `<div id="token-row" class="token-row" hidden>`:
- `<p class="or">or paste a personal access token</p>`
- a `.token-input` flex row with `<input id="token" type="password" placeholder="ghp_…" autocomplete="off" spellcheck="false" aria-label="Personal access token">` and `<button id="connect">Connect</button>`
- `<p class="hint">` with the hint copy from Global Constraints, ending in `<a href="…" target="_blank" rel="noopener">Create one ↗</a>` (URL from Global Constraints)

CSS in `public/styles.css`: `.token-row .or` small muted text with a top margin of about 12px, `.token-input { display: flex; gap: 8px; }`, `.token-input input { flex: 1; min-width: 0; }`.

- [ ] **Step 5: Implement `connectToken(raw: string): Promise<boolean>` in `src/options.ts`**

- Trim `raw`; if empty → `setStatus("Paste a token first.", "error")`, return `false`, no fetch.
- Disable `#connect` for the duration (re-enable in `finally`).
- `fetchViewerLogin(token)` in try/catch: throw → `setStatus("Couldn't reach GitHub. Try again.", "error")`, `false`; `null` → `setStatus("GitHub rejected this token.", "error")`, `false`.
- On success: `saveSettings({ token, repos: current })` with `current` from `getSettings()`, clear `#token`, `setStatus("Token saved ✓", "ok")`, `await showConnection()`, return `true`.

Wire-up:
- `#connect` click and `keydown` Enter on `#token` → `void connectToken(tokenInput.value)`.
- In `showConnection()`, set `tokenRow.hidden = signin.hidden` after the existing branches, so the row follows the Sign in button's rule.
- In the `#save` handler, after repo validation and before saving anything: if `tokenInput.value.trim()` is non-empty, `if (!(await connectToken(tokenInput.value))) return;`.

- [ ] **Step 6: Run the harness to see it pass**

Run: `CHROME_NO_SANDBOX=1 node $SCRATCH/verify-options.mjs`
Expected: `PASS` for all 10 scenarios, exit 0. Open both screenshots: token row sits under "Not connected / Sign in with GitHub", input and Connect on one line, readable in light and dark.

- [ ] **Step 7: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors; `dist/options.html` contains `id="token"`.

- [ ] **Step 8: Commit**

```bash
git add public/options.html public/styles.css src/options.ts
git commit -m "Add personal access token sign-in to settings"
```

---

### Task 2: Panel hint and README

**Files:**
- Modify: `src/panel.ts:185-190` (inaccessible-repo notice)
- Modify: `README.md` ("Set up sign-in (one time)" and "Private repos in an organization")

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing used by other tasks.

- [ ] **Step 1: Update the notice in `src/panel.ts`**

Copy: `` `GitHub can't see ${repo} with this sign-in. Check the repo name. With a token, authorize it for ${owner}'s SSO (token settings → Configure SSO). With the OAuth App, ${owner} must approve it (Org settings → Third-party access).` ``

- [ ] **Step 2: Rewrite the README sign-in section**

"Set up sign-in (one time)" gets two subsections, token first since it needs no org owner:
- **Option A, personal access token:** create a classic token at the "Create one" URL with the `repo` scope; for an SSO org click Configure SSO → Authorize next to it; in Settings paste it under "or paste a personal access token" and click Connect; add repos and Save. Caveats: fine-grained tokens can still need org approval; some orgs block classic tokens, then use Option B.
- **Option B, OAuth App (device flow):** the existing five steps, unchanged.

"Private repos in an organization": say the org-approval requirement applies to the OAuth App route, and that a classic token authorized for SSO avoids it.

Also update step 3 under "Download" to link to the renamed section if its anchor changes.

- [ ] **Step 3: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/panel.ts README.md
git commit -m "Document token sign-in and update repo access hint"
```

---

### Final check

- [ ] Re-run `CHROME_NO_SANDBOX=1 node $SCRATCH/verify-options.mjs`: all 10 PASS.
- [ ] `pnpm typecheck && pnpm build`: clean.
- [ ] Not covered here, for the user: load `dist/` in Chrome and connect with a real token, including an SSO-authorized one on an org repo.
