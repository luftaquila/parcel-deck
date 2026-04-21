/**
 * AliExpress content-script integration test.
 *
 * Verifies the jsdom-only glue code not covered by the unit tests:
 *   - window.postMessage listener wiring
 *   - routing for list/tracking payloads
 *   - parseAliPayload / parseAliTracking calls
 *   - tradeOrderId extraction from the URL
 *   - browser.runtime.sendMessage payload shape
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const sendMessage = vi.fn(() => Promise.resolve());
const getURL = vi.fn((path: string) => `chrome-extension://TESTID${path}`);

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      sendMessage,
      getURL,
    },
  },
}));

let captured: { main: () => void } | null = null;
(globalThis as any).defineContentScript = (cfg: { main: () => void }) => {
  captured = cfg;
  return cfg;
};

function setLocation(url: string) {
  Object.defineProperty(window, "location", { writable: true, value: new URL(url) });
}

/**
 * jsdom dispatches window.postMessage with MessageEvent.source = null,
 * so the content-script guard `ev.source !== window` rejects it. Dispatch
 * a MessageEvent manually to mirror real browser behavior.
 */
function postFromSelf(data: unknown) {
  const ev = new MessageEvent("message", {
    data,
    origin: window.location.origin,
    source: window as unknown as MessageEventSource,
  });
  window.dispatchEvent(ev);
}

describe("aliexpress content script — postMessage routing", () => {
  beforeAll(async () => {
    // Load the content script once so the persistent message listener is registered.
    // injectHook() only appends a <script src="chrome-extension://..."/> tag,
    // which is harmless in jsdom. /p/order/* also queues manual collection,
    // but it does not fire during the test window.
    setLocation("https://www.aliexpress.com/p/order/index.html");
    await import("../src/entrypoints/aliexpress.content.ts");
    if (!captured) throw new Error("defineContentScript wasn't called");
    captured.main();
  });

  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockImplementation(() => Promise.resolve());
  });

  it("order list payload → content.orders with parsed orders", async () => {
    setLocation("https://www.aliexpress.com/p/order/index.html");
    postFromSelf({
      type: "PARCEL_HUB_ALI_DATA",
      payload: {
        source: "order_list",
        data: {
          api: "mtop.aliexpress.trade.buyer.order.list",
          data: {
            data: {
              pc_om_list_order_1: {
                tag: "pc_om_list_order",
                fields: {
                  orderId: "ORDER_INT_1",
                  orderDateText: "Apr 13, 2026",
                  statusText: "Awaiting delivery",
                  orderLines: [{ itemTitle: "통합 테스트" }],
                  utParams: { args: { orderStatus: 8 } },
                },
              },
            },
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0];
    expect(msg.type).toBe("content.orders");
    expect(msg.mall).toBe("aliexpress");
    expect(msg.orders).toHaveLength(1);
    expect(msg.orders[0].mallOrderId).toBe("ORDER_INT_1");
    expect(msg.orders[0].stageHint).toBe("in_transit");
  });

  it("tracking payload on /p/tracking → content.tracking with tradeOrderId from URL", async () => {
    setLocation("https://www.aliexpress.com/p/tracking/index.html?tradeOrderId=INT_TRACK_42");
    postFromSelf({
      type: "PARCEL_HUB_ALI_DATA",
      payload: {
        source: "tracking",
        data: {
          api: "mtop.ae.ld.querydetail",
          ret: ["SUCCESS::ok"],
          data: {
            module: {
              trackingDetailLineList: [
                {
                  mailNo: "520000000001",
                  originMailNo: "520000000001",
                  logisticsCarrierName: "AliExpress standard shipping",
                  logisticsCpInfo: { cpName: "Hanjin" },
                  detailList: [
                    {
                      time: 1776585900000,
                      trackingName: "In transit",
                      trackingDetailDesc: "Awaiting flight",
                      trackingSecondCode: "AE_LH_HO_AIRLINE",
                      trackingPrimaryCode: "AE_LH_HO_AIRLINE",
                      fulfillStage: "1400",
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0];
    expect(msg.type).toBe("content.tracking");
    expect(msg.mall).toBe("aliexpress");
    expect(msg.tradeOrderId).toBe("INT_TRACK_42");
    expect(msg.tracking.trackingNumber).toBe("520000000001");
    expect(msg.tracking.carrierCode).toBe("kr.hanjin");
    expect(msg.tracking.stageHint).toBe("in_transit");
  });

  it("tracking payload without tradeOrderId in URL → nothing sent", async () => {
    setLocation("https://www.aliexpress.com/p/tracking/index.html");
    postFromSelf({
      type: "PARCEL_HUB_ALI_DATA",
      payload: {
        source: "tracking",
        data: {
          api: "mtop.ae.ld.querydetail",
          ret: ["SUCCESS::ok"],
          data: {
            module: {
              trackingDetailLineList: [
                {
                  mailNo: "X",
                  logisticsCpInfo: { cpName: "Hanjin" },
                  detailList: [{ time: 1, trackingSecondCode: "AE_ORDER_PLACED" }],
                },
              ],
            },
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("hook error payload → logs only, no message sent", async () => {
    postFromSelf({ type: "PARCEL_HUB_ALI_DATA", payload: { error: "hook fetch failed" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("unrelated postMessage → ignored", async () => {
    postFromSelf({ type: "SOMETHING_ELSE", payload: { foo: 1 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("empty order list → no message sent (parseAliPayload returns [])", async () => {
    setLocation("https://www.aliexpress.com/p/order/index.html");
    postFromSelf({
      type: "PARCEL_HUB_ALI_DATA",
      payload: {
        source: "order_list",
        data: { data: { data: {} } },
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
