import browser from "webextension-polyfill";
import type { MallId } from "@parceldeck/shared";
import { parseAliPayload } from "../collectors/aliexpress-parse.js";
import { parseAliTracking, type AliTrackingResponse } from "../collectors/aliexpress-tracking-parse.js";
import { store } from "../lib/store.js";

/**
 * Content script for AliExpress order/tracking pages (isolated world).
 *
 * Flow:
 *  1. Inject injected/aliexpress-hook.js into the MAIN world so it can hook MTop fetch/XHR and run auto-collection.
 *  2. On order/tracking pages, send the hook an auto-collect signal so it can call
 *     order.list (pagination) and ae.ld.querydetail (per-order tracking) with the
 *     signature algorithm documented in docs/ALIEXPRESS_MTOP.md.
 *  3. The hook forwards responses via postMessage, and this script parses them and
 *     sends them to the background.
 *
 * tradeOrderId comes either from the tracking-page URL or directly from the hook payload.
 */

export default defineContentScript({
  matches: [
    "https://*.aliexpress.com/p/order/*",
    "https://*.aliexpress.us/p/order/*",
    "https://ko.aliexpress.com/p/order/*",
    "https://*.aliexpress.com/p/tracking/*",
    "https://*.aliexpress.us/p/tracking/*",
    "https://ko.aliexpress.com/p/tracking/*",
  ],
  runAt: "document_idle",
  main() {
    const MSG_TYPE = "PARCEL_HUB_ALI_DATA";
    const AUTO_START = "PARCEL_HUB_ALI_AUTOCOLLECT";

    function injectHook() {
      const id = "parceldeck-ali-hook";
      if (document.getElementById(id)) return;
      const script = document.createElement("script");
      script.id = id;
      script.src = browser.runtime.getURL("/injected/aliexpress-hook.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    }

    function extractTradeOrderIdFromUrl(): string | null {
      try {
        return new URL(location.href).searchParams.get("tradeOrderId");
      } catch {
        return null;
      }
    }

    window.addEventListener("message", (ev) => {
      if (ev.source !== window) return;
      if (ev.origin !== location.origin) return;
      const d = ev.data as {
        type?: string;
        payload?: {
          source?: string;
          data?: unknown;
          error?: string;
          tradeOrderId?: string;
          backfillOrderedAt?: string | null;
          backfillDisplayName?: string | null;
        };
      } | null;
      if (!d || d.type !== MSG_TYPE || !d.payload) return;
      if (d.payload.error) return;

      if (d.payload.source === "order_list" || d.payload.source === "init_callback") {
        const orders = parseAliPayload(d.payload.data);
        if (orders.length === 0) return;
        browser.runtime.sendMessage({
          type: "content.orders",
          mall: "aliexpress" as MallId,
          orders,
        }).catch(() => { /* background unavailable and similar cases */ });
        return;
      }

      if (d.payload.source === "tracking") {
        const tradeOrderId = d.payload.tradeOrderId ?? extractTradeOrderIdFromUrl();
        if (!tradeOrderId) return;
        const tracking = parseAliTracking(d.payload.data as AliTrackingResponse);
        if (!tracking.trackingNumber) return;
        browser.runtime.sendMessage({
          type: "content.tracking",
          mall: "aliexpress" as MallId,
          tradeOrderId,
          tracking,
          backfillOrderedAt: d.payload.backfillOrderedAt ?? null,
          backfillDisplayName: d.payload.backfillDisplayName ?? null,
        }).catch(() => { /* noop */ });
        return;
      }
    });

    injectHook();

    // On order-list pages, tell the hook to start auto-collection.
    if (/\/p\/order\//.test(location.pathname)) {
      setTimeout(async () => {
        const days = (await store.getSettings()).fetchWindowDays;
        window.postMessage({ type: AUTO_START, days }, location.origin);
      }, 1500);
    }
  },
});
