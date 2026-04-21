import browser from "webextension-polyfill";
import type { Order, ShipmentStage } from "@parceldeck/shared";
import { store } from "./store.js";
import {
  TrackerCarrierNotSupported,
  trackShipment,
} from "./tracker.js";
import { DAY_MS } from "./util.js";

/**
 * Local delivery tracking poller.
 *
 * Driven by browser.alarms → hits tracker.delivery → updates the store → fires notifications.
 */

const POLL_ALARM = "parceldeck-tracker-poll";
const RETENTION_ALARM = "parceldeck-retention";

const POLL_INTERVAL_MIN = 10;      // sweep every 10 minutes (per-stage filter runs inside)
const RETENTION_INTERVAL_MIN = 60 * 24;   // once a day

/** Eligible for polling: has tracking number and carrier, and is not in a terminal state yet. */
function isPollable(o: Order): boolean {
  if (!o.trackingNumber || !o.carrierCode) return false;
  if (o.stage === "delivered" || o.stage === "exception") return false;
  return true;
}

/** Simple pacing: skip if the previous poll is too recent (per-stage minimum gap). */
function isDue(o: Order, nowMs: number): boolean {
  const lastMs = Date.parse(o.updatedAt);
  if (!Number.isFinite(lastMs)) return true;
  const gapMs = nowMs - lastMs;
  const minGapMs =
    o.stage === "out_for_delivery" ? 15 * 60 * 1000 :
    o.stage === "in_transit"       ? 45 * 60 * 1000 :
                                     30 * 60 * 1000;
  return gapMs >= minGapMs;
}

const STAGE_LABEL: Record<ShipmentStage, string> = {
  pending: "발송 대기",
  information_received: "송장 등록",
  at_pickup: "집화",
  in_transit: "배송 중",
  out_for_delivery: "배송 출발",
  delivered: "배송 완료",
  exception: "배송 이슈",
  unknown: "확인 중",
};

function notifyStageChange(order: Order, newStage: ShipmentStage, description: string | null) {
  // Keep notifications quiet: only the significant transitions (out-for-delivery, delivered, exception).
  const noisy = newStage === "out_for_delivery" || newStage === "delivered" || newStage === "exception";
  if (!noisy) return;

  const title = `${STAGE_LABEL[newStage]} — ${order.mall}`;
  const message = description ? description : `송장 ${order.trackingNumber ?? ""}`;
  browser.notifications
    ?.create(`parceldeck-${order.id}-${newStage}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("icon/128.png"),
      title,
      message,
    })
    .catch(() => { /* swallow — permission denied or platform lacks notifications */ });
}

async function pollOne(order: Order): Promise<void> {
  try {
    const result = await trackShipment(order.carrierCode!, order.trackingNumber!);
    if (!result) {
      // Tracking number not yet registered — retry on the next tick.
      return;
    }
    const changed = result.stage !== order.stage;
    await store.patchOrder(order.id, {
      stage: result.stage,
      lastEventAt: result.lastEvent?.time ?? order.lastEventAt,
      lastEventDescription: result.lastEvent?.description ?? order.lastEventDescription,
    });
    if (changed) {
      notifyStageChange(order, result.stage, result.lastEvent?.description ?? null);
    }
  } catch (e) {
    if (e instanceof TrackerCarrierNotSupported) {
      console.warn(`[ParcelDeck poller] unsupported carrier: ${order.carrierCode} (orderId=${order.id})`);
      // Polling is pointless until the carrier mapping changes — swallow silently.
      return;
    }
    console.warn(`[ParcelDeck poller] tick failed ${order.id}`, e);
  }
}

async function pollTick(): Promise<void> {
  const orders = await store.listOrders();
  const now = Date.now();
  const due = orders.filter((o) => isPollable(o) && isDue(o, now));
  if (due.length === 0) return;
  // Low concurrency — keep tracker.delivery from being overloaded.
  for (const o of due) {
    await pollOne(o);
  }
}

async function retentionTick(): Promise<void> {
  const { fetchWindowDays } = await store.getSettings();
  const cutoffMs = Date.now() - fetchWindowDays * DAY_MS;
  const removed = await store.deleteOrdersBefore(cutoffMs, true);
  if (removed > 0) console.info(`[ParcelDeck retention] removed ${removed} orders (delivered longer than ${fetchWindowDays} day(s) ago)`);
}

export function installPoller(): void {
  browser.alarms.create(POLL_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: POLL_INTERVAL_MIN,
  });
  browser.alarms.create(RETENTION_ALARM, {
    delayInMinutes: 5,
    periodInMinutes: RETENTION_INTERVAL_MIN,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM) pollTick().catch((e) => console.warn("[ParcelDeck poller] tick error", e));
    else if (alarm.name === RETENTION_ALARM) retentionTick().catch((e) => console.warn("[ParcelDeck retention] tick error", e));
  });
}
