# AliExpress MTop API reference (verified 2026-04)

Only behavior verified against live sessions is captured here. Every
key part was validated by reproducing the signature (100% match with
the expected `sign`) before issuing real requests.

## Endpoint

```
GET https://acs.aliexpress.com/h5/<api>/<version>/
```

Query parameters:
```
jsv       = 2.5.1
appKey    = 24815441
t         = millisecond timestamp
sign      = md5(token + "&" + t + "&" + appKey + "&" + dataJson) (lowercase hex)
v         = 1.0
timeout   = 15000
api       = mtop.* API name
type      = originaljson
dataType  = json
data      = URL-encoded JSON body
```

Required cookies: `_m_h5_tk`, `_m_h5_tk_enc`, and the usual AliExpress
session cookies.

## Signing token (`_m_h5_tk`)

Cookie format: `_m_h5_tk=<token>_<expiresMs>`

- `token` is the first argument in the MD5 sign computation.
- `expiresMs` is the expiration epoch in milliseconds.

In practice tokens last around 30–40 minutes. When refresh is handled
properly the user never notices.

## Token refresh mechanism (verified)

1. Sign with the current `_m_h5_tk` and send the request.
2. If expired, the server responds with HTTP 200 but
   `ret: ["FAIL_SYS_TOKEN_EXOIRED::令牌过期"]`.
   The same response carries `Set-Cookie: _m_h5_tk=<newToken>_<newExpires>`
   and `_m_h5_tk_enc=<new>`.
3. Replace the cookie, re-sign, and retry — the second attempt succeeds.

Other `ret` values follow the same pattern: `FAIL_SYS_TOKEN_EMPTY`,
`FAIL_SYS_ILLEGAL_REQUEST`, `ILLEGAL_ACCESS`.

### Two integration paths

**(a) content script hook (`aliexpress-hook.js`)** — when the user opens
an order page, the page's own MTop client has already refreshed the
token, so we just intercept the response through the `mtopjsonp*`
callback and forward the successful payload.

**(b) background collector (`collectors/aliexpress.ts`)** — because the
extension must collect periodically even when the user is not on the
page, it reads `_m_h5_tk` via `browser.cookies`, MD5-signs the request,
and calls MTop directly. A guard branch retries once on
`isTokenErr && attempt === 0`, giving the page a chance to write the
refreshed cookie back with `Set-Cookie` before we re-sign. A full
OPEN_CALL refresh loop is not implemented — the 30–40 minute token
lifetime covers our re-collection cadence.

## Verified APIs

### 1. `mtop.aliexpress.trade.buyer.order.list`

Order list.

Data params:
```json
{
  "statusTab": "" | "processing" | "shipped" | "completed",
  "renderType": "init",
  "clientPlatform": "pc",
  "shipToCountry": "KR",
  "_lang": "en_US" | "ko_KR",
  "_currency": "USD",
  "__inline": "true"
}
```

Key response fields:
- `data.data.pc_om_list_order_<orderId>.fields` per order:
  - `orderId`, `orderDateText`
  - `statusText`, `utParams.args.orderStatus` (numeric)
  - `orderLines[].itemTitle`

Observed `statusText` / `orderStatus`:
- `Awaiting delivery` / 8 → `in_transit`
- `Completed` / 9 → `delivered`

### 2. `mtop.ae.ld.querydetail`

Shipping detail for a single order.

Data params:
```json
{
  "tradeOrderId": "<orderId>",
  "tradeOrderLineId": "<optional>",
  "terminalType": "PC",
  "needPageDisplayInfo": true,
  "timeZone": "GMT+9",
  "__inline": "true",
  "_lang": "en_US",
  "_currency": "USD"
}
```

Key response fields:
- `data.module.trackingDetailLineList[0]`:
  - `mailNo`, `originMailNo` — tracking number
  - `logisticsCarrierName` — service label (e.g. "AliExpress standard shipping")
  - `logisticsCpInfo.cpName` — actual last-mile carrier (e.g. "Hanjin", "CJ")
  - `detailList[]` (newest first): `time` (ms), `timeText`, `trackingName`,
    `trackingDetailDesc`, `trackingSecondCode`, `trackingPrimaryCode`,
    `fulfillStage`
- `data.module.logisticsReceiverInfo` — **recipient PII (address, phone,
  name); excluded from parsing**

## Observed `trackingSecondCode` → `ShipmentStage`

| fulfillStage | Group | Code | Mapping |
|-------------|-------|------|---------|
| – | order | `AE_ORDER_PLACED` | `pending` |
| – | order | `AE_ORDER_PAID` | `pending` |
| – | order | `AE_ORDER_SHIPPED` | `at_pickup` |
| 1000 | warehouse (GWMS) | `AE_GWMS_ACCEPT` / `AE_GWMS_PACKAGE` | `pending` |
| 1000 | warehouse (GWMS) | `AE_GWMS_OUTBOUND` | `at_pickup` |
| 1400 | long haul (LH) | `AE_LH_HO_IN_SUCCESS` | `in_transit` |
| 1400 | long haul (LH) | `AE_LH_HO_AIRLINE` | `in_transit` |
| 1400 | long haul (LH) | `AE_LH_DEPART_SUCCESS` | `in_transit` |
| 1400 | long haul (LH) | `AE_LH_ARRIVE_SUCCESS` | `in_transit` |
| 1600 | customs (CC) | `AE_CC_EX_START_SUCCESS` / `AE_CC_EX_SUCCESS_SUCCESS` | `in_transit` |
| 1600 | customs (CC) | `AE_CC_IM_START` / `AE_CC_IM_SUCCESS` | `in_transit` |
| 1600 | customs (CC) | `AE_CC_HO_OUT_SUCCESS` | `in_transit` |
| 1700 | last-mile (GTMS) | `AE_GTMS_ACCEPT` / `AE_GTMS_SC_*` | `in_transit` |
| 1700 | last-mile (GTMS) | `AE_GTMS_DELIVERING` / `AE_GTMS_DO_DEPART` | `out_for_delivery` |
| 1700 | last-mile (GTMS) | `AE_GTMS_SIGNED` | `delivered` |

## Observed `cpName` → tracker.delivery carrier id

- `"Hanjin"` → `kr.hanjin` (seen on an in-flight order)
- `"CJ"` → `kr.cjlogistics` (seen on a delivered order)

Other carriers (Lotte, Korea Post, Logen, etc.) have not yet appeared
in AliExpress responses. Each unseen carrier logs a `console.warn` when
encountered.
