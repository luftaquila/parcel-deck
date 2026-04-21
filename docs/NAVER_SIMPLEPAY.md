# Naver Pay SIMPLE_PAYMENT (instantPay) subsystem notes

**Conclusion: Naver Pay's SIMPLE_PAYMENT path never exposes tracking
data. The extension collects list entries but does not chase the
tracking chain for them.**

## Investigation method

1. Fetch the SPA shell HTML at
   `GET https://orders.pay.naver.com/instantPay/detail/<payId>`.
2. Download the JS bundles referenced by the HTML
   (`static/js/42.*.js`, `main.*.js`).
3. Enumerate every `/orderApi/` URL referenced by the bundles
   (`grep -E '/orderApi/'`).
4. Call each endpoint with a live session and inspect the response
   schema.

## Endpoints found (SIMPLE_PAYMENT specific)

- `GET /orderApi/payment/detail/info?paymentId=<payId>&yearMonthFormatDate=<YYYY-MM>` — payment detail.
- `GET /orderApi/payment/invoice/*` — **tax invoice** (unrelated to tracking).
- `/orderApi/payment/diconBuying`, `/orderApi/paymentMethods`,
  `/orderApi/payment/universal` — all about payment or payment methods.

**No tracking, delivery, shipment, courier, carrier, or waybill
endpoints exist.**

## `/orderApi/payment/detail/info` live response schema (2026-04)

```
result: {
  payTypeCode: string,         // "NORMAL"
  type: "Success",
  message: "<localized success string>",
  payment: { id, date, status, purchaserName },
  merchant: { merchantNo, name, url, imageUrl, tel, subMerchant, ... },
  product: { name, count },    // ← count only. No shipping information.
  amount: { totalAmount, discountAmount, ... },
  paymentMethod: { selectedPaymentMethod, easyCard, easyBank },
  refundAmount: object,
  benefit: { ... },
  receipt: { cash, card, cupDeposit },
}
```

`product.count` exists but nothing about tracking, carrier, shipping
address, or delivery state.

## Conclusion and policy

SIMPLE_PAYMENT means Naver only brokers the payment while the actual
order and delivery are owned by an external store. Examples:

- Alipay Plus (AliExpress) — tracked through AliExpress itself.
- Kyobo Book Centre — has its own delivery lookup URL.
- DEGICA (Steam) — digital, no delivery.
- Korea Railroad — train tickets, no delivery.

**ParcelDeck policy**:
- The list parser captures SIMPLE_PAYMENT entries (they are visible in
  the dashboard as payment records).
- The assignments / tracking chain is NOT invoked for them — the URL
  patterns differ and the tracking data is absent.
- `trackingNumber` and `carrierCode` stay `null`.
- To track a specific external store, add its own collector (the
  AliExpress collector is an example).

This document serves as a reference when adding a new external-store
tracking collector in the future (e.g., Kyobo Book Centre).
