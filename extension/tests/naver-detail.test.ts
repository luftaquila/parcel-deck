import { describe, it, expect } from "vitest";
import { parseNaverDetail } from "../src/collectors/naver-detail.js";

/**
 * Verifies only the productOrderStatusType values observed in real
 * 2026-04 samples:
 *   "PAYED", "PURCHASE_DECIDED"
 * deliveryCompleteDateTime still upgrades the stage to delivered.
 */

describe("parseNaverDetail — observed states", () => {
  it("maps PAYED to pending", () => {
    const res = {
      code: "00",
      result: {
        order: { orderNo: "ORDER_A", orderDateTime: 1776323137784 },
        productOrders: [
          {
            productOrderNo: "PO_A_1",
            productOrderStatusType: "PAYED",
            exposureStatusType: "상품준비중",
            productName: "샘플 상품",
            deliveryCompleteDateTime: null,
          },
        ],
      },
    };
    const orders = parseNaverDetail(res);
    expect(orders.length).toBe(1);
    expect(orders[0]!.stageHint).toBe("pending");
    expect(orders[0]!.orderNo).toBe("ORDER_A");
    expect(orders[0]!.productOrderNo).toBe("PO_A_1");
  });

  it("maps PURCHASE_DECIDED to delivered", () => {
    const res = {
      code: "00",
      result: {
        order: { orderNo: "ORDER_B", orderDateTime: 1769426334825 },
        productOrders: [
          {
            productOrderNo: "PO_B_1",
            productOrderStatusType: "PURCHASE_DECIDED",
            productName: "구매확정 상품",
            deliveryCompleteDateTime: 1769575020000,
          },
        ],
      },
    };
    const orders = parseNaverDetail(res);
    expect(orders.length).toBe(1);
    expect(orders[0]!.stageHint).toBe("delivered");
  });

  it("promotes unmapped statuses to delivered when deliveryCompleteDateTime exists", () => {
    const res = {
      code: "00",
      result: {
        order: { orderNo: "ORDER_C", orderDateTime: 1760000000000 },
        productOrders: [
          {
            productOrderNo: "PO_C_1",
            productOrderStatusType: "UNKNOWN_STATUS",
            productName: "c",
            deliveryCompleteDateTime: 1761000000000,
          },
        ],
      },
    };
    expect(parseNaverDetail(res)[0]!.stageHint).toBe("delivered");
  });

  it("returns an empty array when code is not 00", () => {
    expect(parseNaverDetail({ code: "99", result: { productOrders: [] } })).toEqual([]);
  });

  it("returns an empty array when required order fields are missing", () => {
    expect(parseNaverDetail({ code: "00", result: { order: {}, productOrders: [{ productOrderNo: "X" }] } })).toEqual([]);
  });
});
