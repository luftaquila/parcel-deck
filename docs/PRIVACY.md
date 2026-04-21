# Privacy Policy

ParcelDeck is a browser extension that **runs entirely on the user's
browser with no backend**. Everything it collects is kept in the local
profile's `storage.local`; nothing is transmitted to or stored on any
server operated by the authors or third parties, with the narrow
exceptions described in Section 3.

## 1. What is stored locally

| Item | Source | Storage | Notes |
|------|--------|---------|------|
| Order metadata (order id, item name, order date) | Signed-in shopping mall pages | `storage.local` | Extracted from mall HTML/JSON responses |
| Tracking number, carrier code | Mall responses | `storage.local` | Used to look up delivery status |
| Delivery and customs event cache | External lookups | Popup memory (per-session) | Cleared when the popup window closes |
| User preferences | Options page input | `storage.local` | UNI-PASS API key, sort mode, mall filter, collection toggle, retention window |
| Mall session state | Local probes | `storage.local` | Tracks login status only — cookies are not copied |
| Per-order "overseas" toggle | Popup control | `storage.local` | Triggers customs lookup |

## 2. What is NOT stored

- Shopping mall login cookies (cookies stay in the browser's cookie jar;
  the extension never copies the values into its own storage).
- Payment information (card numbers, bank accounts, etc.).
- Recipient information (address, phone, name).
- Taxes or billing documents.
- Login credentials (email or password).

## 3. External transmissions

A few features reach out to third-party APIs. What is transmitted is
scoped to exactly what each API needs.

### tracker.delivery (shipment lookup)
- **Endpoint**: `https://apis.tracker.delivery/carriers/{carrierId}/tracks/{trackingNumber}`
- **Sent fields**: tracking number and carrier code — nothing else.
- **When**: background poller runs every ten minutes, and on demand when
  the user opens an order's detail panel.
- **PII sent**: none.

### Korea Customs UNI-PASS (customs lookup, optional)
- **Endpoint**: `https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo`
- **Sent fields**: tracking number (treated as House B/L) and the user's
  own CRKY that they entered in the options page.
- **When**: only when the user turns the "overseas" checkbox on for a
  given order's detail panel.
- **PII sent**: none. The CRKY is issued to the user by Korea Customs
  and is used solely for authentication.

### Shopping mall servers (the user's own account)
The extension visits the user's signed-in Naver Pay, Coupang, and
AliExpress order pages and calls their internal APIs — the same traffic
that would occur if the user opened those pages manually. Cookies and
sessions remain under each mall's control; the extension never forwards
them elsewhere.

## 4. Retention

- **Orders**: removed automatically when the options page retention
  window (default: 14 days) elapses.
- **Delivered orders**: hidden from the popup three days after completion
  and deleted when the retention window passes.
- **Customs cache**: held in popup memory for ten minutes; gone when the
  popup window closes.
- **User preferences**: kept until the user changes or clears them.
- **Reset button**: wipes sessions, orders, and overrides and
  immediately re-collects. **User preferences (including the UNI-PASS
  key) are preserved.**

## 5. Security

- **No server or database**: there is no remote storage path for the
  data to travel to.
- **Transport**: all external API calls go over HTTPS.
- **Cookie handling**: the extension uses the `browser.cookies`
  permission to read only the AliExpress `_m_h5_tk` cookie, which is
  needed to sign MTop requests. The cookie value itself is never stored
  or transmitted.
- **postMessage validation**: `window.message` listeners check
  `event.origin` to reject spoofed messages from other scripts running
  on the same page.

## 6. User rights

- **Access and edit**: all stored data is visible through the options
  page and popup.
- **Delete**: the options page "Reset" button clears collected data
  immediately. Removing the extension deletes `storage.local` along with
  it.
- **Stop collecting**: toggling "collection enabled" off in the options
  page halts all automatic, manual, and post-reset collection.
- **Stop customs lookups**: clearing the UNI-PASS key or unchecking the
  "overseas" box on an order disables UNI-PASS calls.

## 7. Change log

- 2026-04 — Initial version (local-only design).

## 8. Contact

For questions or deletion requests, reach out via the extension's
repository or the contact listed in the install description.
