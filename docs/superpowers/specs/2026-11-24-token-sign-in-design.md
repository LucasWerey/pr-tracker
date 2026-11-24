# Sign in with a personal access token: design

## Why

An OAuth App can't see an SSO organization's repos until an org owner approves it
(Org settings → Third-party access). A classic personal access token only needs the user
to authorize it for SSO themselves (Configure SSO → Authorize on the token), so pasting a
token gets org repos working without waiting on an owner.

## Goal

In Settings, paste a GitHub token into a masked field, connect, and the extension uses it
for every GitHub call.

- **Non-goals:** removing the device flow; token refresh or expiry handling; checking the
  token's scopes; remembering which sign-in method was used.
- **Anti-goals:** saving a token GitHub rejects (the minute refresh would silently break);
  ever showing the saved token back in the page.

## Approaches

| Approach | Trade-off |
|---|---|
| **Side by side** (picked) | Token field under the existing "Sign in with GitHub" button. Least change; both routes visible. |
| Token first | Token is the main sign-in, device flow moves under Advanced. Leads with the SSO-friendly route but moves the existing button. |
| Token only | Drop the device flow and Client ID. Simplest code, but removes a route that works for orgs that approved the app. |

## Design

**Storage.** The pasted token goes in the same `token` key in `chrome.storage.sync` that the
device flow fills. Nothing downstream changes: `refresh.ts`, `github.ts`, the background
`storage.onChanged` listener and the panel already read that key. Like today's token, it
syncs across the Chrome profile.

**Settings page** (`public/options.html`, `src/options.ts`), "GitHub account" section.
The token row shows under the same rule as the Sign in button (not connected, or the saved
token is rejected):

```
GitHub account
  Not connected                          [Sign in with GitHub]
  or paste a personal access token
  [••••••••••••••••••••]  [Connect]
  Classic token with the repo scope. For an SSO org, click
  Configure SSO → Authorize next to the token. Create one ↗
```

- Input is `type="password"`, `autocomplete="off"`, never pre-filled with the saved token.
- **Connect** (or Enter in the field): trim, check with `fetchViewerLogin`. Valid → save to
  `token`, clear the field, show "Connected as @login". Rejected → error
  "GitHub rejected this token", nothing saved.
- **Save** (bottom button): if the token field has text, connect it the same way first, and
  stop with the error if GitHub rejects it.
- "Create one" links to
  `https://github.com/settings/tokens/new?scopes=repo&description=PR%20Tracker`.
- When connected, the token row is hidden; **Sign out** clears `token` as today, whichever
  way it was obtained.

**Panel hint** (`src/panel.ts`, inaccessible repo): name both causes, since the extension
doesn't know which sign-in was used: the token isn't authorized for the org's SSO, or the
org hasn't approved the OAuth App.

**README** "Set up sign-in": two options side by side, the token route and the existing
OAuth App route. Caveats: fine-grained tokens can still need org approval; some orgs block
classic tokens, in which case only the OAuth App route works.

## Left to the builder

Exact CSS and wording polish, within the existing `body.options` styles.

## Verification

`pnpm typecheck` and `pnpm build`; render the options page in headless Chrome with stubbed
`chrome` APIs (as `scripts/screenshot.mjs` does) to check both states; a final manual check
in Chrome with a real token.
