import { describe, it, expect } from "vitest";
import { parseAliPayload } from "../src/collectors/aliexpress-parse.js";

/**
 * Based on a real sample observed in 2026-04.
 * Observed values:
 *   statusText: "Awaiting delivery"
 *   orderStatus (numeric): 8
 * Other statuses and carrier mappings stay intentionally unmapped until real data exists.
 */

describe("parseAliPayload — observed MTop structure", () => {
  it("Awaiting delivery (orderStatus 8) + JSONP wrapper → in_transit", () => {
    const payload = {
      api: "mtop.aliexpress.trade.buyer.order.list",
      data: {
        data: {
          pc_om_list_header_1: { tag: "pc_om_list_header", fields: {} },
          pc_om_list_order_SAMPLE: {
            fields: {
              orderId: "SAMPLE_ORDER_1",
              orderDateText: "Apr 13, 2026",
              statusText: "Awaiting delivery",
              orderLines: [{ itemTitle: "샘플 제품" }],
              utParams: { args: { orderStatus: 8 } },
            },
            tag: "pc_om_list_order",
            type: "pc_om_list_order",
          },
          pc_om_list_footer_1: { tag: "pc_om_list_footer", fields: {} },
        },
      },
      ret: ["SUCCESS::ok"],
    };
    const orders = parseAliPayload(`mtopjsonp1(${JSON.stringify(payload)})`);
    expect(orders.length).toBe(1);
    const o = orders[0]!;
    expect(o.mallOrderId).toBe("SAMPLE_ORDER_1");
    expect(o.displayName).toBe("샘플 제품");
    expect(o.stageHint).toBe("in_transit");
    expect(o.trackingNumber).toBeNull();
    expect(o.orderedAt.startsWith("2026-04-13")).toBe(true);
  });

  it("deduplicates repeated orderId values", () => {
    const payload = {
      data: {
        data: {
          pc_om_list_order_A: {
            fields: {
              orderId: "X",
              orderDateText: "Jan 1, 2026",
              statusText: "Awaiting delivery",
              orderLines: [{ itemTitle: "중복" }],
            },
            tag: "pc_om_list_order",
          },
          pc_om_list_order_B: {
            fields: {
              orderId: "X",
              orderDateText: "Jan 1, 2026",
              statusText: "Awaiting delivery",
              orderLines: [{ itemTitle: "중복2" }],
            },
            tag: "pc_om_list_order",
          },
        },
      },
    };
    expect(parseAliPayload(payload).length).toBe(1);
  });

  it("ignores non-order nodes such as pc_om_list_header", () => {
    const payload = {
      data: {
        data: {
          pc_om_list_header: { tag: "pc_om_list_header", fields: { pageTitle: "Orders" } },
          pc_om_list_footer: { tag: "pc_om_list_footer", fields: {} },
        },
      },
    };
    expect(parseAliPayload(payload)).toEqual([]);
  });

  it("returns an empty array for empty or invalid input", () => {
    expect(parseAliPayload(null)).toEqual([]);
    expect(parseAliPayload({})).toEqual([]);
    expect(parseAliPayload("garbage")).toEqual([]);
  });

  it("maps Completed / orderStatus 9 to delivered", () => {
    const payload = {
      data: {
        data: {
          x: {
            fields: {
              orderId: "COMPLETED_ORDER",
              orderDateText: "Apr 8, 2026",
              statusText: "Completed",
              orderLines: [{ itemTitle: "x" }],
              utParams: { args: { orderStatus: 9 } },
            },
            tag: "pc_om_list_order",
          },
        },
      },
    };
    const orders = parseAliPayload(payload);
    expect(orders[0]!.stageHint).toBe("delivered");
  });

  it("still extracts orderId and orderedAt for unmapped statusText values", () => {
    const payload = {
      data: {
        data: {
          x: {
            fields: {
              orderId: "UNKNOWN_STATUS_ORDER",
              orderDateText: "Mar 3, 2026",
              statusText: "Some new status text",
              orderLines: [{ itemTitle: "t" }],
            },
            tag: "pc_om_list_order",
          },
        },
      },
    };
    const orders = parseAliPayload(payload);
    expect(orders.length).toBe(1);
    expect(orders[0]!.mallOrderId).toBe("UNKNOWN_STATUS_ORDER");
    expect(orders[0]!.stageHint).toBeUndefined();
  });
});
