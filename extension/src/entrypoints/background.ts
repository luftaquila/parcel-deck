import browser from "webextension-polyfill";
import type { MallId } from "@parceldeck/shared";
import { initSessionMonitor, onSessionTransition } from "../lib/session-monitor.js";
import { collectMall, installAlarms, opportunisticCollect } from "../lib/scheduler.js";
import { mallFromUrl, MALL_CONFIGS } from "../lib/mall-config.js";
import { ingestOrdersFromContent } from "../lib/content-bridge.js";
import { installPoller } from "../lib/poller.js";
import { store } from "../lib/store.js";

/**
 * Remove legacy non-delivery records that were saved before the filter
 * was added.
 * A "[택배] 운송장번호:..." prefix means a prepaid convenience-store
 * parcel. New collections are filtered by shouldInclude(), but existing
 * saved data still needs a one-time cleanup.
 */
async function cleanupLegacyNonDelivery(): Promise<void> {
  const removed = await store.deleteOrdersWhere((o) =>
    typeof o.displayName === "string" && /^\[택배\]/.test(o.displayName)
  );
  if (removed > 0) console.info(`[ParcelDeck] cleaned up ${removed} legacy non-delivery orders`);
}

// Clicking the action icon keeps at most one detached popup window alive.
// If one already exists, just focus it.
let popupWindowId: number | null = null;
async function openPopupWindow() {
  try {
    if (popupWindowId !== null) {
      try {
        const existing = await browser.windows.get(popupWindowId);
        if (existing) {
          await browser.windows.update(popupWindowId, { focused: true });
          return;
        }
      } catch { /* already closed; open a new one below */ }
    }
    const win = await browser.windows.create({
      url: browser.runtime.getURL("popup.html"),
      type: "popup",
      width: 460,
      height: 660,
    });
    popupWindowId = win.id ?? null;
  } catch (e) {
    console.warn("[ParcelDeck] failed to open popup window", e);
  }
}

export default defineBackground(() => {
  // WXT defineBackground; bundled as a service worker / event page at runtime.
  initSessionMonitor();
  installAlarms();
  installPoller();
  cleanupLegacyNonDelivery().catch((e) => console.warn("[ParcelDeck] legacy cleanup failed", e));

  // default_popup is empty, so onClicked fires.
  const act = (browser as typeof browser & { browserAction?: typeof browser.action }).action
    ?? (browser as typeof browser & { browserAction?: typeof browser.action }).browserAction;
  act?.onClicked.addListener(() => { openPopupWindow(); });

  browser.windows.onRemoved.addListener((id) => {
    if (popupWindowId === id) popupWindowId = null;
  });

  // Opportunistic collection: when a mall tab finishes loading, try collecting.
  browser.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    const mall = mallFromUrl(details.url);
    if (!mall) return;
    // Excessive trigger suppression is handled by the scheduler's MIN_GAP.
    opportunisticCollect(mall).catch(() => {});
  });

  // Receive orders / tracking data scraped by content scripts.
  browser.runtime.onMessage.addListener((msg: unknown) => {
    if (!msg || typeof msg !== "object") return;
    const m = msg as {
      type?: string;
      mall?: MallId;
      orders?: unknown;
      tradeOrderId?: string;
      tracking?: {
        trackingNumber?: string | null;
        carrierCode?: string | null;
        stageHint?: string;
        lastEventAt?: string | null;
        lastEventDescription?: string | null;
      };
      backfillOrderedAt?: string | null;
      backfillDisplayName?: string | null;
    };
    if (m.type === "collect-all") {
      // Popup refresh button: force recollection for every mall, then respond.
      return (async () => {
        const malls = Object.keys(MALL_CONFIGS) as MallId[];
        await Promise.all(
          malls.map((mall) =>
            collectMall(mall, { force: true }).catch((e) =>
              console.warn(`[ParcelDeck] manual recollection failed (${mall})`, e)
            )
          )
        );
        return { ok: true };
      })();
    }
    if (m.type === "content.orders" && m.mall && Array.isArray(m.orders)) {
      ingestOrdersFromContent(m.mall, m.orders as any).catch((e) =>
        console.warn("[ParcelDeck] content.orders handling failed", e)
      );
    } else if (m.type === "content.tracking" && m.mall && m.tradeOrderId && m.tracking) {
      // AE tracking is a single-order update that merges tracking number, carrier, and status into an existing order.
      // orderedAt/displayName are omitted so the existing values remain unchanged.
      ingestOrdersFromContent(m.mall, [{
        mall: m.mall,
        mallOrderId: m.tradeOrderId,
        // If backfill exists, pass it through. Otherwise send an empty-string sentinel so content-bridge preserves the existing value.
        orderedAt: m.backfillOrderedAt ?? "",
        displayName: m.backfillDisplayName ?? "",
        trackingNumber: m.tracking.trackingNumber ?? null,
        carrierCode: m.tracking.carrierCode ?? null,
        stageHint: m.tracking.stageHint as any,
        lastEventAt: m.tracking.lastEventAt ?? null,
        lastEventDescription: m.tracking.lastEventDescription ?? null,
      }]).catch((e) => console.warn("[ParcelDeck] content.tracking handling failed", e));
    }
  });

  // Session-transition notifications.
  onSessionTransition((t) => {
    if (t.to === "expired") {
      browser.notifications?.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("icon/128.png"),
        title: `${t.mall} 재로그인 필요`,
        message: `로그인이 풀렸습니다. 해당 쇼핑몰에 다시 로그인하면 자동으로 재개됩니다.`,
      }).catch(() => {});
    }
  });
});
