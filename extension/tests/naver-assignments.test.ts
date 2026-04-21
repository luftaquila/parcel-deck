import { describe, it, expect } from "vitest";
import { parseNaverAssignments, extractDeliveryNoFromUrl } from "../src/collectors/naver-assignments.js";

/**
 * Based on two real samples observed in 2026-04.
 *   Endpoint: POST /orderApi/orderSheet/detail/assignments
 *   Body: {"orderNo":"<X>","claimNos":[]}  // confirmed
 *   Response: {code, result: [{productOrderNo, userActions, claims}]}
 *   trackDelivery URL: /order/delivery/tracking/<productOrderNo>/<deliveryNo>
 */

describe("parseNaverAssignments", () => {
  it("extracts deliveryNo from the trackDelivery action", () => {
    const res = {
      code: "00",
      result: [
        {
          productOrderNo: "2025121589921071",
          userActions: [
            { code: "writeAfterUseReview", text: "리뷰", pcUrl: "https://example/review" },
            { code: "trackDelivery", text: "배송조회", pcUrl: "https://orders.pay.naver.com/order/delivery/tracking/2025121589921071/20251216101711083448" },
            { code: "addCart", text: "장바구니" },
          ],
          claims: [],
        },
      ],
    };
    const map = parseNaverAssignments(res);
    expect(map.size).toBe(1);
    expect(map.get("2025121589921071")).toEqual({ deliveryNo: "20251216101711083448" });
  });

  it("returns null when the trackDelivery action is missing", () => {
    const res = {
      code: "00",
      result: [
        {
          productOrderNo: "PO_NO_TRACK",
          userActions: [{ code: "writeReview" }],
          claims: [],
        },
      ],
    };
    expect(parseNaverAssignments(res).get("PO_NO_TRACK")).toEqual({ deliveryNo: null });
  });

  it("returns an empty map when code is not 00", () => {
    expect(parseNaverAssignments({ code: "99" }).size).toBe(0);
  });

  it("extractDeliveryNoFromUrl works on valid and invalid inputs", () => {
    expect(extractDeliveryNoFromUrl("https://orders.pay.naver.com/order/delivery/tracking/111/222")).toBe("222");
    expect(extractDeliveryNoFromUrl("https://other-url")).toBeNull();
    expect(extractDeliveryNoFromUrl(null)).toBeNull();
  });
});
