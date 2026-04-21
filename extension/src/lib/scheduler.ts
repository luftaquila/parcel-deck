import browser from "webextension-polyfill";
import type { MallId } from "@parceldeck/shared";
import { MALL_CONFIGS } from "./mall-config.js";
import { store } from "./store.js";
import {
  markAuthenticated,
  markExpired,
  markUnsupported,
  probeSession,
} from "./session-monitor.js";
import { UnauthenticatedError, UnsupportedError, type MallCollector } from "../collectors/types.js";
import { COLLECTORS } from "../collectors/index.js";
import { delay } from "./util.js";

/**
 * Collection scheduler.
 *  - alarms.create('keepalive-<mall>') runs per-mall keep-alive pings.
 *  - alarms.create('collect-<mall>') runs periodic collection (only when authenticated).
 *  - Tab navigation triggers opportunistic collection via the session monitor.
 *  - Failures use exponential backoff and report to the state machine.
 */

const COLLECT_INTERVAL_MIN = 120;           // default: 2 hours
const COLLECT_MIN_GAP_MIN = 15;              // minimum gap since the last collection
const MAX_RETRIES = 3;

function keyKeepAlive(mall: MallId) { return `keepalive-${mall}`; }
function keyCollect(mall: MallId) { return `collect-${mall}`; }

async function runKeepAlive(mall: MallId) {
  const cfg = MALL_CONFIGS[mall];
  const session = await store.getSession(mall);
  if (session.status !== "authenticated") return;
  try {
    await fetch(cfg.keepAliveUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Swallow — the session monitor catches real problems independently.
  }
}

async function attemptCollect(
  collector: MallCollector,
  sinceMs: number | null
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const orders = await collector.collect({ sinceMs });
      if (orders.length > 0) {
        const items = orders.map((o) => ({
          mall: o.mall,
          mallOrderId: o.mallOrderId,
          orderedAt: o.orderedAt,
          displayName: o.displayName || null,
          trackingNumber: o.trackingNumber,
          carrierCode: o.carrierCode,
          stageHint: o.stageHint,
        }));
        await store.upsertOrders(items).catch((e) => {
          console.warn("[ParcelDeck] upsert failed", e);
        });
      }
      await store.setLastCollectAt(collector.id, Date.now());
      await markAuthenticated(collector.id);
      return;
    } catch (e) {
      lastErr = e;
      if (e instanceof UnauthenticatedError) {
        await markExpired(collector.id, e.reason);
        return;
      }
      if (e instanceof UnsupportedError) {
        await markUnsupported(collector.id, e.reason);
        return;
      }
      if (attempt < MAX_RETRIES) {
        const wait = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        await delay(wait);
        continue;
      }
    }
  }
  console.warn(`[ParcelDeck] collection failed (${collector.id})`, lastErr);
}

export async function collectMall(mall: MallId, opts: { force?: boolean } = {}) {
  const collector = COLLECTORS[mall];
  if (!collector) return;

  // Collection master switch — blocks automatic and manual collections alike.
  const { collectEnabled } = await store.getSettings();
  if (!collectEnabled) return;

  const session = await store.getSession(mall);
  if (session.status === "unsupported") return;
  if (session.status === "refreshing") return;
  if (session.status === "expired") {
    // Even when expired, probe once (the user may have just logged back in).
    const probed = await probeSession(mall);
    if (probed !== "authenticated") return;
  }

  const last = await store.getLastCollectAt(mall);
  const minGapMs = COLLECT_MIN_GAP_MIN * 60 * 1000;
  if (!opts.force && last && Date.now() - last < minGapMs) return;

  await store.setCollecting(mall, true);
  try {
    await attemptCollect(collector, last);
  } finally {
    await store.setCollecting(mall, false);
  }
}

/**
 * Opportunistic trigger — called when the user lands on a mall tab.
 */
export async function opportunisticCollect(mall: MallId) {
  await collectMall(mall, {});
}

export function installAlarms() {
  for (const mall of Object.keys(MALL_CONFIGS) as MallId[]) {
    browser.alarms.create(keyKeepAlive(mall), {
      delayInMinutes: 1,
      periodInMinutes: MALL_CONFIGS[mall].keepAliveIntervalMin,
    });
    browser.alarms.create(keyCollect(mall), {
      delayInMinutes: 2,
      periodInMinutes: COLLECT_INTERVAL_MIN,
    });
  }

  // Also run one collection pass immediately on background startup so that
  // opening the popup right after a data wipe or reload does not leave the
  // user staring at "no orders". The alarm's 2-minute initial delay is kept
  // (it guards against reload storms); this extra run just supplements it.
  for (const mall of Object.keys(MALL_CONFIGS) as MallId[]) {
    collectMall(mall, { force: true }).catch((e) =>
      console.warn(`[ParcelDeck] initial collect failed (${mall})`, e)
    );
  }

  browser.alarms.onAlarm.addListener(async (alarm) => {
    for (const mall of Object.keys(MALL_CONFIGS) as MallId[]) {
      if (alarm.name === keyKeepAlive(mall)) {
        await runKeepAlive(mall);
        return;
      }
      if (alarm.name === keyCollect(mall)) {
        await collectMall(mall, {});
        return;
      }
    }
  });
}
