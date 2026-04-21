# Notes for store reviewers

This document summarizes how ParcelDeck works and why each sensitive
permission or pattern is required. Submit it together with any store
listing so the reviewer has answers ready without having to guess from
the source.

## What the extension does

ParcelDeck reads the user's own order pages on three shopping malls
(Naver Pay, Coupang, AliExpress) and shows a unified popup with
delivery and customs-clearance progress. All data is kept inside the
user's local browser profile (`storage.local`); nothing is sent to any
server operated by the authors or third parties, aside from the narrow
external calls documented in Section 3 of the privacy policy
(`docs/PRIVACY.md`).

The extension is a WXT project that builds both a Chrome MV3 bundle and
a Firefox MV2 bundle from the same source. Source is TypeScript, hand
written, not obfuscated or minified at the source level.

## Permissions

| Permission | Why it is needed |
|------------|------------------|
| `alarms` | Schedules periodic collection (per-mall) and the shipment poller. Set up from `extension/src/lib/scheduler.ts` and `extension/src/lib/poller.ts`. |
| `cookies` | Reads a single AliExpress cookie (`_m_h5_tk`) to sign MTop API requests. See `extension/src/collectors/aliexpress.ts#getH5Token`. The cookie value is never persisted or transmitted. |
| `notifications` | Fires a browser notification when a tracked shipment transitions to out-for-delivery, delivered, or exception. See `extension/src/lib/poller.ts#notifyStageChange`. |
| `storage` | `storage.local` stores orders, session state, and user settings. No sync is used. |
| `tabs` | Used to open the mall's order page when the user clicks a mall chip in the popup. Opens a new tab only. |
| `webNavigation` | Detects when the user lands on a mall page so the extension can run an opportunistic collection pass and update session state. See `extension/src/lib/session-monitor.ts#installNavigationListener`. |

## Host permissions

| Host | Use |
|------|-----|
| `https://*.coupang.com/*` | Coupang order page + keep-alive ping. Skeleton collector only. |
| `https://*.naver.com/*` | Naver Pay order history, order-detail API, assignments API, tracking API. Multiple Naver subdomains are in use (`pay.`, `order.pay.`, `orders.pay.`, `smartstore.`, `www.`). |
| `https://*.aliexpress.com/*`, `https://*.aliexpress.us/*` | AliExpress order list, order tracking, and MTop signing endpoint (`acs.aliexpress.com`). |
| `https://unipass.customs.go.kr/*`, `https://unipass.customs.go.kr:38010/*` | Korea Customs UNI-PASS cargo clearance public API. Called only when the user provides their own CRKY in the options page. |

`apis.tracker.delivery` is used for tracking lookups but is not listed in
`host_permissions` because it serves permissive CORS headers and does
not require extension-level host access. Both hosts are listed in the
privacy policy.

## MAIN-world script injection

`extension/src/public/injected/aliexpress-hook.js` and
`naver-hook.js` are injected into the MAIN world through
`web_accessible_resources`. Reasons:

- AliExpress signs MTop requests with a per-page token stored in
  `window._m_h5_tk` (which also appears in `document.cookie`). The
  MAIN-world hook reuses the page's existing cookie-visible token so the
  extension can call MTop without re-implementing a full OAuth flow.
  See `docs/ALIEXPRESS_MTOP.md` for the full signature spec.
- The scripts only observe and forward data; they never fetch remote
  code, evaluate strings, or modify the page's DOM beyond installing
  `fetch`/`XMLHttpRequest` wrappers.
- Responses are delivered to the isolated-world content script via
  `postMessage`. Both ends validate `ev.source === window` and
  `ev.origin === location.origin` to reject spoofed messages from other
  same-page scripts.

## Third-party code

- `md5()` in `extension/src/collectors/aliexpress.ts` and
  `extension/src/public/injected/aliexpress-hook.js` is Joseph Myers's
  public-domain MD5 reference implementation. Both copies self-test
  against the RFC 1321 vectors (`md5("")` and `md5("abc")`) on module
  load and abort if the result is wrong.
- No other third-party runtime code is bundled. `zod` (validators) and
  `webextension-polyfill` (browser API shim) are declared in
  `package.json` and installed through pnpm.

## No remote code execution

- No `eval`, no `new Function`, no dynamic `import()` of remote URLs.
- `web_accessible_resources` expose only the two hook scripts that ship
  inside the extension bundle; they are not fetched from the network.

## User data handling

- Orders, tracking numbers, carrier codes, and user settings live only
  in `browser.storage.local`.
- Reset (options page) clears collected data but keeps user settings
  such as the UNI-PASS key, sort mode, mall filter, and retention
  window. Implementation: `store.reset()` in
  `extension/src/lib/store.ts`.
- Uninstalling the extension removes all stored data automatically.

## Verification

- `pnpm --filter @parceldeck/extension test` runs the parser unit tests
  (currently 66 tests across 8 files).
- `pnpm --filter @parceldeck/extension typecheck` (or `pnpm build`) runs
  TypeScript's strict checks.
- Manual end-to-end steps are documented in `docs/TESTING.md`.

## Contact

For reviewer follow-up questions please contact the address listed in
the store listing.
