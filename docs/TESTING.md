# Testing Guide

## Unit tests

```bash
pnpm --filter @parceldeck/extension test
```

- `tests/naver-parse.test.ts` — SSR JSON / DOM fallback parser
- `tests/naver-assignments.test.ts` — assignments response parser
- `tests/naver-detail.test.ts` — order detail parser
- `tests/naver-tracking.test.ts` — tracking API parser
- `tests/aliexpress-parse.test.ts` — MTop / init-data recursive extraction
- `tests/aliexpress-tracking.test.ts` — tracking detail parser
- `tests/customs-parse.test.ts` — UNI-PASS cargo clearance XML parser

When a parser fails against real data, shrink the offending HTML/JSON
into a fixture test to prevent regressions.

## Manual E2E (requires a signed-in session)

### Preparation
1. Run the dev build:
   - Chrome: `pnpm --filter @parceldeck/extension dev`
   - Firefox: `pnpm --filter @parceldeck/extension dev:firefox`
2. Load the extension:
   - Chrome: `chrome://extensions` → enable developer mode →
     "Load unpacked" → `extension/.output/chrome-mv3/`
   - Firefox: `about:debugging` → "Load Temporary Add-on" →
     `extension/.output/firefox-mv2/manifest.json`
3. (Optional) Open the options page and enter the UNI-PASS API key
   (CRKY) if you want to exercise the customs panel.

### Naver
1. Visit `https://pay.naver.com/pc/history` and confirm you are signed in.
2. In the popup, the "Naver · connected" chip should appear (if it
   shows "login required" the probe failed).
3. Inspect the background service worker console:
   - `chrome://extensions` → ParcelDeck → "Service worker"
   - Watch the collection triggers in the console.
4. Expected: the popup lists orders.
5. If parsing fails:
   - Flip `DEBUG = true` in `src/collectors/naver.ts` and rebuild.
   - Follow the `[ParcelDeck naver]` logs in the service worker console.
   - If the SSR JSON structure changed, capture a snippet into the
     fixture and update the parser.

### AliExpress
1. Visit `https://www.aliexpress.com/p/order/index.html` and confirm
   you are signed in.
2. The page's devtools console will show the injected hook running
   (`aliexpress-hook.js` is injected in MAIN world once the order page
   loads).
3. The background collector reads the `_m_h5_tk` cookie and calls MTop
   directly, so it works even without the user opening the order page.
4. In the background service worker console, watch for `content.orders`
   and the regular collection logs.
5. Expected: AliExpress orders appear in the popup with the "overseas"
   checkbox on by default.
6. If parsing fails:
   - Copy the payload shape from `window.postMessage` in the page
     console.
   - Add the sample to `tests/aliexpress-parse.test.ts` and fix
     `parseAliPayload`.

### Customs lookup (UNI-PASS)
1. Enter a CRKY in the options page (see the inline guidance for how
   to issue one).
2. Expand an AliExpress order's detail card — the "overseas" checkbox
   is on by default.
3. If the tracking number is registered with UNI-PASS, the arrival /
   warehousing / import-declaration / clearance / release timeline
   renders.
4. Manually check "overseas" on a domestic order — the hint should
   read "no customs record".
5. Clear the CRKY in the options page — the detail card should switch
   to "UNI-PASS API key not set → open settings".

### Session expiry simulation
1. Log out of a mall (or delete its cookies).
2. Open the popup — the mall chip should flip to "login required".
3. Log back in — `cookies.onChanged` should move it back to
   "connected" automatically.
4. The badge count should drop to zero.

### Retention window
1. Shrink the retention window in the options page (e.g. 1 day).
2. Save — the extension will announce how many past orders fell out
   of the window.
3. The background `retentionTick` runs once a day; to exercise it
   immediately, restart the service worker.
4. Restore the default (14 days) afterwards.

### Reset
1. Click the "Reset" button in the options page and confirm.
2. After execution, sessions, orders, and collection flags should be
   empty and the background kicks off a fresh collection.
3. User preferences (UNI-PASS CRKY, sort mode, mall filter, etc.)
   should remain untouched.

## Known limitations

- **Naver Pay history**: the SSR structure occasionally changes. The
  parser has multiple fallbacks; capture a fixture when a regression
  appears.
- **Coupang**: still a skeleton. The real collector will land in a
  follow-up iteration.
- **UNI-PASS**: the public API only supports per-tracking-number
  lookups. A PCCC-based listing endpoint is not published.
