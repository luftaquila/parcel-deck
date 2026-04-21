import type { MallId } from "@parceldeck/shared";
import type { CollectedOrder } from "../collectors/types.js";
import { store } from "./store.js";
import { markAuthenticated } from "./session-monitor.js";

/**
 * Upserts orders that a content script scraped from a mall page into
 * the local store.
 */
export async function ingestOrdersFromContent(mall: MallId, orders: CollectedOrder[]): Promise<void> {
  if (orders.length === 0) return;

  const items = orders.map((o) => ({
    mall: o.mall,
    mallOrderId: o.mallOrderId,
    // Treat empty strings and the 1970 sentinel as "unknown" and keep the existing value.
    orderedAt: o.orderedAt && !o.orderedAt.startsWith("1970-") ? o.orderedAt : undefined,
    displayName: o.displayName ? o.displayName : undefined,
    trackingNumber: o.trackingNumber,
    carrierCode: o.carrierCode,
    stageHint: o.stageHint,
    lastEventAt: o.lastEventAt ?? undefined,
    lastEventDescription: o.lastEventDescription ?? undefined,
  }));

  try {
    await store.upsertOrders(items);
    await store.setLastCollectAt(mall, Date.now());
    await markAuthenticated(mall);
  } catch (e) {
    console.warn(`[ParcelDeck] ${mall} content ingestion failed`, e);
  }
}
