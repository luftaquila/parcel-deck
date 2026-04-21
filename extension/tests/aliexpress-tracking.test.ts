import { describe, it, expect } from "vitest";
import { parseAliTracking } from "../src/collectors/aliexpress-tracking-parse.js";

/**
 * Schema checks based on one real mtop.ae.ld.querydetail response.
 * Seven trackingSecondCode values were observed, and only cpName "Hanjin" was mapped at first.
 */

describe("parseAliTracking", () => {
  const makeResp = (overrides: {
    secondCode?: string;
    cpName?: string;
    mailNo?: string;
    time?: number | null;
    ret?: string[];
  } = {}) => {
    const timeVal = "time" in overrides ? overrides.time : 1776585900000;
    return ({
    api: "mtop.ae.ld.querydetail",
    ret: overrides.ret ?? ["SUCCESS::调用成功"],
    data: {
      module: {
        trackingDetailLineList: [
          {
            mailNo: overrides.mailNo ?? "520648818631",
            originMailNo: overrides.mailNo ?? "520648818631",
            logisticsCarrierName: "AliExpress standard shipping",
            logisticsCpInfo: {
              cpName: overrides.cpName ?? "Hanjin",
              contactCarrierText: `Contact ${overrides.cpName ?? "Hanjin"}`,
            },
            detailList: [
              {
                time: timeVal,
                timeText: "Sun | Apr. 19 17:05",
                trackingName: "In transit",
                trackingDetailDesc: "Awaiting flight",
                trackingSecondCode: overrides.secondCode ?? "AE_LH_HO_AIRLINE",
                trackingPrimaryCode: "AE_LH_HO_AIRLINE",
                fulfillStage: "1400",
              },
            ],
          },
        ],
      },
    },
  });
  };

  it("AE_LH_HO_AIRLINE + Hanjin → in_transit + kr.hanjin", () => {
    const r = parseAliTracking(makeResp());
    expect(r.trackingNumber).toBe("520648818631");
    expect(r.carrierName).toBe("Hanjin");
    expect(r.carrierCode).toBe("kr.hanjin");
    expect(r.stageHint).toBe("in_transit");
    expect(r.lastEventAt).toBe("2026-04-19T08:05:00.000Z");
    expect(r.lastEventDescription).toBe("In transit · Awaiting flight");
  });

  it("AE_ORDER_PLACED → pending", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_ORDER_PLACED" })).stageHint).toBe("pending");
  });

  it("AE_ORDER_PAID → pending", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_ORDER_PAID" })).stageHint).toBe("pending");
  });

  it("AE_ORDER_SHIPPED → at_pickup", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_ORDER_SHIPPED" })).stageHint).toBe("at_pickup");
  });

  it("AE_CC_EX_START_SUCCESS → in_transit", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_CC_EX_START_SUCCESS" })).stageHint).toBe("in_transit");
  });

  it("maps AE_GTMS_SIGNED to delivered", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_GTMS_SIGNED" })).stageHint).toBe("delivered");
  });

  it("AE_GTMS_DELIVERING / AE_GTMS_DO_DEPART → out_for_delivery", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_GTMS_DELIVERING" })).stageHint).toBe("out_for_delivery");
    expect(parseAliTracking(makeResp({ secondCode: "AE_GTMS_DO_DEPART" })).stageHint).toBe("out_for_delivery");
  });

  it("maps AE_GWMS_OUTBOUND to at_pickup", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_GWMS_OUTBOUND" })).stageHint).toBe("at_pickup");
  });

  it("maps AE_CC_IM_START / AE_CC_HO_OUT_SUCCESS to in_transit", () => {
    expect(parseAliTracking(makeResp({ secondCode: "AE_CC_IM_START" })).stageHint).toBe("in_transit");
    expect(parseAliTracking(makeResp({ secondCode: "AE_CC_HO_OUT_SUCCESS" })).stageHint).toBe("in_transit");
  });

  it("maps CJ to kr.cjlogistics", () => {
    const r = parseAliTracking(makeResp({ cpName: "CJ" }));
    expect(r.carrierName).toBe("CJ");
    expect(r.carrierCode).toBe("kr.cjlogistics");
  });

  it("keeps unknown cpName values while leaving carrierCode null", () => {
    const r = parseAliTracking(makeResp({ cpName: "UnknownCarrier" }));
    expect(r.carrierName).toBe("UnknownCarrier");
    expect(r.carrierCode).toBeNull();
  });

  it("returns stageHint undefined for unknown trackingSecondCode values", () => {
    const r = parseAliTracking(makeResp({ secondCode: "AE_UNKNOWN_STATE" }));
    expect(r.trackingNumber).toBe("520648818631");
    expect(r.stageHint).toBeUndefined();
  });

  it("returns an empty result for other APIs", () => {
    const r = parseAliTracking({ api: "other.api", ret: ["SUCCESS"], data: {} });
    expect(r.trackingNumber).toBeNull();
  });

  it("returns an empty result for failed ret values", () => {
    expect(parseAliTracking(makeResp({ ret: ["FAIL::error"] })).trackingNumber).toBeNull();
  });

  it("time null → lastEventAt null", () => {
    expect(parseAliTracking(makeResp({ time: null })).lastEventAt).toBeNull();
  });
});
