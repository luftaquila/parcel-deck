# ParcelDeck

A browser extension that pulls your shopping mall orders, delivery
status, and customs clearance progress into a single popup. Everything
runs locally — no server, cloud account, or OAuth required.

## Layout

```
ParcelDeck/
├── extension/   # WXT-based Chrome and Firefox extension (collection + storage + tracking + UI)
└── shared/      # Shared types (zod schemas)
```

## Design principles

- **Serverless**: all data lives in `browser.storage.local`. No login, no account, no billing.
- **No cookie exfiltration**: shopping mall session cookies are used only in the
  page context and are never copied out of the browser.
- **Minimal data**: only order id, item name, tracking number, carrier, and
  delivery state are stored. Addresses, contacts, and payment information
  are not kept.

## Runtime flow

1. Visiting a shopping mall page (Naver Pay / AliExpress) triggers a content
   script that extracts the order list in the page context.
2. The background script writes the orders into `browser.storage.local`.
3. Every ten minutes the extension hits the `tracker.delivery` V1 REST API to
   update tracking status and fires a `browser.notifications` toast on changes.
4. When the overseas checkbox is on in the popup detail card, the extension
   queries Korea Customs UNI-PASS for the clearance timeline (requires the
   user's own CRKY set in the options page).
5. Clicking the extension icon opens a popup with the order list and detail
   timelines.

## Supported malls (as of 2026-04)

| Mall | Source | Collected |
|---|---|---|
| Naver Pay | `pay.naver.com/pc/history` SSR data | order list + tracking |
| AliExpress | MTop JSONP/fetch response hook + direct background calls | order list + shipping detail |
| Coupang | (in progress) | |

## Customs timeline (optional)

If the user provides a Korea Customs UNI-PASS CRKY in the options page,
the extension surfaces the arrival / warehousing / import declaration /
clearance / release events for orders marked as overseas. Without a key
the customs panel stays hidden and the rest of the extension behaves
normally.

## Local development

```bash
pnpm install
pnpm dev                              # Chrome
pnpm --filter @parceldeck/extension dev:firefox
```

## Build

```bash
pnpm build                            # Chrome MV3 and Firefox MV2 zips
```

Output lives under `extension/.output/`:
- `chrome-mv3/` — unpacked Chrome build
- `firefox-mv2/` — unpacked Firefox build
- `parceldeck-0.0.1-{chrome,firefox}.zip`

## Legal note

The extension reads the user's own shopping mall accounts with the user's
consent. Before using it:

- Review each mall's terms of service — some prohibit automated scraping.
- All collected data stays inside the user's browser profile.
