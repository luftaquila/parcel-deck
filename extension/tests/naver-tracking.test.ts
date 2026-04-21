import { describe, it, expect } from "vitest";
import { parseNaverTracking } from "../src/collectors/naver-tracking.js";

/**
 * Based on real samples observed in 2026-04.
 * Observed values:
 *   deliveryStatusType: "DELIVERING", "ESTIMATED_ARRIVAL", "DELIVERY_COMPLETION"
 *   deliveryCompanyName: only "한진택배" in the initial sample set
 *
 * Carrier-code mapping originally stayed null until the tracker-side catalog was wired in.
 */

describe("parseNaverTracking — observed states", () => {
  it("maps 한진택배 to carrierCode kr.hanjin", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "DELIVERY_COMPLETION",
          completed: true,
          stackTrace: { deliveryCompanyName: "한진택배", invoiceNo: "536302687583" },
        },
      },
    };
    expect(parseNaverTracking(res).carrierCode).toBe("kr.hanjin");
  });

  it("maps 롯데택배 to carrierCode kr.lotte", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "DELIVERY_COMPLETION",
          completed: true,
          stackTrace: { deliveryCompanyName: "롯데택배", invoiceNo: "249943568976" },
        },
      },
    };
    expect(parseNaverTracking(res).carrierCode).toBe("kr.lotte");
  });

  it("keeps invoiceNo and carrierName for DELIVERY_COMPLETION + 한진택배", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "DELIVERY_COMPLETION",
          deliveryCompleteDateTime: "2026-01-28T04:37:00Z",
          trackable: true,
          completed: true,
          stackTrace: {
            deliveryCompanyName: "한진택배",
            invoiceNo: "536302687583",
            completed: true,
            firstDetail: {
              processDateTime: "2026-01-27T13:17:48Z",
              deliveryStatusType: "DELIVERING",
              deliveryStatusName: "배송중(입고)",
              branchName: "Mega-Hub",
            },
            lastDetail: {
              processDateTime: "2026-01-28T04:37:32Z",
              deliveryStatusType: "DELIVERY_COMPLETION",
              deliveryStatusName: "배달완료",
              branchName: "봉명(집)",
            },
          },
        },
      },
    };
    const r = parseNaverTracking(res);
    expect(r.trackingNumber).toBe("536302687583");
    expect(r.carrierName).toBe("한진택배");
    expect(r.carrierCode).toBe("kr.hanjin");
    expect(r.stageHint).toBe("delivered");
    expect(r.completed).toBe(true);
    expect(r.lastEventAt).toBe("2026-01-28T04:37:32Z");
    expect(r.lastEventDescription).toBe("배달완료 · 봉명(집)");
  });

  it("DELIVERING → in_transit", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "DELIVERING",
          completed: false,
          stackTrace: { deliveryCompanyName: "한진택배", invoiceNo: "123456789012" },
        },
      },
    };
    expect(parseNaverTracking(res).stageHint).toBe("in_transit");
  });

  it("maps COLLECT_CARGO to at_pickup", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "COLLECT_CARGO",
          stackTrace: { deliveryCompanyName: "롯데택배", invoiceNo: "249943568976" },
        },
      },
    };
    expect(parseNaverTracking(res).stageHint).toBe("at_pickup");
  });

  it("ESTIMATED_ARRIVAL → out_for_delivery", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "ESTIMATED_ARRIVAL",
          stackTrace: { deliveryCompanyName: "한진택배", invoiceNo: "X" },
        },
      },
    };
    expect(parseNaverTracking(res).stageHint).toBe("out_for_delivery");
  });

  it("uses trace-level status enums even when stackTrace is null", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "DELIVERING",
          completed: false,
          stackTrace: null,
        },
      },
    };
    const r = parseNaverTracking(res);
    expect(r.trackingNumber).toBeNull();
    expect(r.carrierName).toBeNull();
    expect(r.stageHint).toBe("in_transit");
  });

  it("keeps an unmapped carrier name while leaving carrierCode null", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "DELIVERY_COMPLETION",
          stackTrace: { deliveryCompanyName: "알수없는택배", invoiceNo: "x" },
        },
      },
    };
    const r = parseNaverTracking(res);
    expect(r.carrierName).toBe("알수없는택배");
    expect(r.carrierCode).toBeNull();
  });

  it("returns stageHint undefined for unmapped deliveryStatusType", () => {
    const res = {
      code: "00",
      result: {
        deliveryTrace: {
          deliveryStatusType: "SOMETHING_WE_HAVE_NOT_SEEN",
          stackTrace: { deliveryCompanyName: "한진택배", invoiceNo: "X" },
        },
      },
    };
    expect(parseNaverTracking(res).stageHint).toBeUndefined();
  });

  it("returns an empty result when code is not 00", () => {
    const r = parseNaverTracking({ code: "99", message: "error" });
    expect(r.trackingNumber).toBeNull();
    expect(r.stageHint).toBeUndefined();
  });
});
