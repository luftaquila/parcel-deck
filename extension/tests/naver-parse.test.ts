import { describe, it, expect, vi } from "vitest";
import { parseNaverHtml, parseNaverListEntries } from "../src/collectors/naver.js";

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
  },
}));

/**
 * Parser tests for pay.naver.com/pc/history list HTML.
 * Based on real samples observed in 2026-04.
 * Observed status.name values: "PAYMENT_COMPLETED", "DELIVERY_PREPARING".
 * Everything else stays intentionally unmapped until verified.
 */

function buildHtml(items: unknown[]): string {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              queryKey: ["PAYMENT_LIST", "1"],
              state: { data: { pages: [{ items }] } },
            },
          ],
        },
      },
    },
  };
  return `<!doctype html><html><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
</body></html>`;
}

describe("parseNaverHtml — __NEXT_DATA__ extraction", () => {
  it("maps ORDER + PAYMENT_COMPLETED to pending and extracts uniqueKey/productName", () => {
    const html = buildHtml([
      {
        _id: "O_SAMPLE_001",
        serviceType: "ORDER",
        status: { name: "PAYMENT_COMPLETED", text: "결제완료" },
        product: { name: "샘플 상품 A" },
        date: 1776323137784,
        additionalData: { uniqueKey: "2026041640889130", productOrderNo: "2026041640889130", orderNo: "2026041633111670" },
      },
    ]);
    const orders = parseNaverHtml(html);
    expect(orders.length).toBe(1);
    const o = orders[0]!;
    expect(o.mallOrderId).toBe("2026041640889130");
    expect(o.displayName).toBe("샘플 상품 A");
    expect(o.stageHint).toBe("pending");
    expect(o.trackingNumber).toBeNull();
  });

  it("PURCHASE_CONFIRMED → delivered", () => {
    const html = buildHtml([
      {
        _id: "X",
        serviceType: "ORDER",
        status: { name: "PURCHASE_CONFIRMED", text: "구매확정완료" },
        product: { name: "X" },
        date: 1776000000000,
        additionalData: { uniqueKey: "K_DELIVERED" },
      },
    ]);
    expect(parseNaverHtml(html)[0]!.stageHint).toBe("delivered");
  });

  it("CANCELLED / PARTIALLY_CANCELLED → exception", () => {
    const html = buildHtml([
      { _id: "A", serviceType: "ORDER", status: { name: "CANCELLED", text: "결제취소" }, product: { name: "A" }, date: 1776000000000, additionalData: { uniqueKey: "A" } },
      { _id: "B", serviceType: "ORDER", status: { name: "PARTIALLY_CANCELLED", text: "부분취소" }, product: { name: "B" }, date: 1776000000000, additionalData: { uniqueKey: "B" } },
    ]);
    const orders = parseNaverHtml(html);
    expect(orders.map((o) => o.stageHint)).toEqual(["exception", "exception"]);
  });

  it("excludes non-delivery serviceType values", () => {
    const html = buildHtml([
      { _id: "T", serviceType: "TRANSIT_CARD", status: { name: "PAYMENT_COMPLETED", text: "결제완료" }, product: { name: "교통카드 충전" }, date: 1776000000000, additionalData: { uniqueKey: "T1" } },
      { _id: "W", serviceType: "WETAX", status: { name: "PAYMENT_COMPLETED", text: "결제완료" }, product: { name: "지방세" }, date: 1776000000000, additionalData: { uniqueKey: "W1" } },
      { _id: "L", serviceType: "LOCALPAY", status: { name: "PURCHASE_CONFIRMED", text: "구매확정완료" }, product: { name: "지역화폐" }, date: 1776000000000, additionalData: { uniqueKey: "L1" } },
      { _id: "BK", serviceType: "BOOKING", status: { name: "PURCHASE_CONFIRMED", text: "구매확정완료" }, product: { name: "예약" }, date: 1776000000000, additionalData: { uniqueKey: "BK1" } },
      // SIMPLE_PAYMENT means an external payment flow, not a Naver-owned order.
      { _id: "SP", serviceType: "SIMPLE_PAYMENT", status: { name: "PAYMENT_COMPLETED", text: "결제완료" }, product: { name: "[택배] 운송장번호:363154469710" }, date: 1776000000000, additionalData: { uniqueKey: "SP1" } },
    ]);
    expect(parseNaverHtml(html)).toEqual([]);
  });

  it("maps DELIVERY_PREPARING to pending", () => {
    const html = buildHtml([
      {
        _id: "ANY",
        serviceType: "ORDER",
        status: { name: "DELIVERY_PREPARING", text: "상품준비중" },
        product: { name: "X" },
        date: 1776000000000,
        additionalData: { uniqueKey: "K1" },
      },
    ]);
    expect(parseNaverHtml(html)[0]!.stageHint).toBe("pending");
  });

  it("excludes CROSSBORDER entries as non-delivery records", () => {
    const html = buildHtml([
      {
        _id: "A",
        serviceType: "CROSSBORDER",
        status: { name: "PAYMENT_COMPLETED", text: "결제완료" },
        product: { name: "주유소 결제" },
        date: 1776000000000,
        additionalData: { uniqueKey: "A1" },
      },
      {
        _id: "B",
        serviceType: "CROSSBORDER",
        status: { name: "PAYMENT_COMPLETED", text: "결제완료" },
        product: { name: "주식회사 비지에프네트웍스" },
        date: 1776000000000,
        additionalData: { uniqueKey: "B1" },
      },
    ]);
    expect(parseNaverHtml(html)).toEqual([]);
  });

  it("excludes products whose name starts with '[택배] 운송장번호:...' regardless of serviceType", () => {
    const html = buildHtml([
      {
        _id: "PARCEL",
        serviceType: "ORDER",
        status: { name: "PAYMENT_COMPLETED", text: "결제완료" },
        product: { name: "[택배] 운송장번호:363183547780" },
        date: 1776000000000,
        additionalData: { uniqueKey: "P1" },
      },
    ]);
    expect(parseNaverHtml(html)).toEqual([]);
  });

  it("still extracts base fields for unmapped status.name values", () => {
    const html = buildHtml([
      {
        _id: "X",
        serviceType: "ORDER",
        status: { name: "NEW_UNKNOWN_STATUS" },
        product: { name: "Y" },
        date: 1776000000000,
        additionalData: { uniqueKey: "U1" },
      },
    ]);
    const o = parseNaverHtml(html)[0]!;
    expect(o.mallOrderId).toBe("U1");
    expect(o.stageHint).toBeUndefined();
  });

  it("returns an empty array when __NEXT_DATA__ is missing", () => {
    expect(parseNaverHtml("<html><body></body></html>")).toEqual([]);
  });

  it("parseNaverListEntries preserves orderNo/productOrderNo metadata for ORDER items", () => {
    const html = buildHtml([
      {
        _id: "O",
        serviceType: "ORDER",
        status: { name: "PURCHASE_CONFIRMED", text: "구매확정완료" },
        product: { name: "상품" },
        date: 1776000000000,
        additionalData: {
          uniqueKey: "PO_ENTRY",
          productOrderNo: "PO_ENTRY",
          orderNo: "ORDER_ENTRY",
        },
      },
    ]);
    const entries = parseNaverListEntries(html);
    expect(entries.length).toBe(1);
    expect(entries[0]!.orderNo).toBe("ORDER_ENTRY");
    expect(entries[0]!.productOrderNo).toBe("PO_ENTRY");
    expect(entries[0]!.serviceType).toBe("ORDER");
    expect(entries[0]!.statusName).toBe("PURCHASE_CONFIRMED");
    expect(entries[0]!.order.mallOrderId).toBe("PO_ENTRY");
    expect(entries[0]!.order.stageHint).toBe("delivered");
  });

  it("returns an empty array when PAYMENT_LIST is not present in queryKey", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { dehydratedState: { queries: [{ queryKey: ["COUPON_COUNT"], state: { data: {} } }] } } },
    })}</script></body></html>`;
    expect(parseNaverHtml(html)).toEqual([]);
  });
});
