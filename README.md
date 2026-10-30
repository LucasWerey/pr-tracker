# PR Tracker

A Chrome side panel that shows the state of your open GitHub pull requests, grouped by repository.

- One collapsible section per repo you choose, collapsed by default (your choice is remembered)
- PRs grouped as **In merge queue**, **Can be merged**, **Waiting for review** and **Draft**
- Status chips for CI, review decision, merge conflicts, unresolved threads and merge-queue position
- A badge on the toolbar icon counting PRs that need attention (failing CI, changes requested, conflicts)
- Refreshes every 5 minutes; light and dark mode
- No backend: everything runs in the extension, talking to the GitHub API directly

Only open PRs **you authored** are shown.

## Install

Requires Node 20+ and [pnpm](https://pnpm.io) (npm works too).

```sh
pnpm install
pnpm build
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.
3. Click the PR Tracker icon in the toolbar to open the side panel.

## Set up sign-in (one time)

The extension signs in with GitHub's [device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow), so it needs no server and no client secret.

1. Create an OAuth App at <https://github.com/settings/applications/new>:
   - **Homepage URL** and **Authorization callback URL**: `https://github.com` (the device flow doesn't use them)
   - Tick **Enable Device Flow**
   - Leave **Expire user access tokens** off (the extension doesn't handle refresh tokens)
2. Copy the app's **Client ID** (it is public; you never need the client secret).
3. Open the extension's settings (the sliders icon in the panel header), expand **Advanced**, and paste the Client ID.
4. Click **Sign in with GitHub**. Enter the code it shows on `github.com/login/device`, go through SSO if asked, and authorize.
5. Add the repos to follow, one `owner/name` per line, and save.

### Private repos in an organization

If the org restricts OAuth App access, GitHub hides its data from the app until an org owner approves it
(Org settings → Third-party access → OAuth app policy). Until then the repo's card shows
"GitHub can't see this repo with this sign-in". You can request approval from
<https://github.com/settings/connections/applications>.

The app asks for the `repo` scope, which is the only OAuth scope that reaches private repos. The extension only
runs read queries.

## Development

```sh
pnpm watch       # rebuild on change (reload the extension in chrome://extensions)
pnpm typecheck   # tsc --noEmit
pnpm icons       # regenerate public/icons/*.png from scripts/icons.mjs
```

```
src/
  background.ts   alarm that refreshes every 5 min, opens the panel on icon click
  refresh.ts      fetch -> save snapshot -> update toolbar badge
  github.ts       GraphQL query and mapping to PullRequest
  auth.ts         OAuth device flow
  panel.ts        side panel UI
  options.ts      settings page (sign-in, Client ID, repo list)
  storage.ts      chrome.storage helpers
  types.ts
public/           manifest, HTML, CSS, icons (copied to dist/)
```

## Limitations

- Looks at your 100 most recently updated open PRs, then filters to the configured repos.
- Reads up to 100 review threads per PR.
- Merge-queue info only appears for repos that use GitHub's merge queue.

## Privacy

The access token is stored in `chrome.storage.sync` (it syncs across your signed-in Chrome profiles). The extension
only talks to `github.com` and `api.github.com`.

## License

MIT
