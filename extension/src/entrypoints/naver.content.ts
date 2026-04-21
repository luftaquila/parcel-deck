import browser from "webextension-polyfill";
import type { MallId } from "@parceldeck/shared";
import {
  fetchNaverTracking,
  parseNaverListEntries,
  type NaverItem,
  type NaverListEntry,
} from "../collectors/naver.js";
import { fetchNaverAssignments } from "../collectors/naver-assignments.js";
import type { CollectedOrder } from "../collectors/types.js";
import { store } from "../lib/store.js";
import { DAY_MS, delay } from "../lib/util.js";

/**
 * Naver Pay order-history content script.
 *
 * Flow:
 *   1. Extract initial orders from the page's `__NEXT_DATA__`
 *   2. Sequentially fetch `?page=N` until the three-month cutoff
 *   3. For ORDER entries, call the assignments API and exclude records without trackDelivery when they are clearly non-delivery
 *   4. If trackDelivery exists, call the tracking API and merge tracking number / carrier / status
 *   5. Send only the final enriched delivery orders to the background
 *
 * The background collector calls the same APIs, but the content script
 * lets the extension update immediately when the user is already on the
 * Naver Pay page.
 */

function extractItemsFlexible(payload: unknown): NaverItem[] {
  if (!payload || typeof payload !== "object") return [];
  const visited = new WeakSet<object>();
  const out: NaverItem[] = [];

  function looksLikeItem(x: unknown): x is NaverItem {
    if (!x || typeof x !== "object") return false;
    const i = x as NaverItem;
    return typeof i.serviceType === "string" && (typeof i._id === "string" || !!i.additionalData?.uniqueKey);
  }

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (visited.has(node as object)) return;
    visited.add(node as object);
    if (Array.isArray(node)) {
      if (node.length > 0 && looksLikeItem(node[0])) {
        for (const el of node) if (looksLikeItem(el)) out.push(el);
        return;
      }
      for (const el of node) walk(el);
      return;
    }
    for (const v of Object.values(node as Record<string, unknown>)) walk(v);
  }

  walk(payload);
  return out;
}

function entriesFromItems(items: NaverItem[]): NaverListEntry[] {
  const synthesized = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [{ queryKey: ["PAYMENT_LIST"], state: { data: { pages: [{ items }] } } }],
        },
      },
    },
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(synthesized)}</script>`;
  return parseNaverListEntries(html);
}

/**
 * Enrich and filter ORDER entries through assignments + tracking.
 *
 * Rules:
 * - If trackDelivery exists, treat it as a delivery order and merge tracking data.
 * - If trackDelivery is missing and status=PURCHASE_CONFIRMED, exclude it as confirmed non-delivery.
 * - If trackDelivery is missing but the order is still in progress, keep it because the tracking number may not exist yet.
 * - If the assignments call itself fails, keep the order and retry on the next collection.
 */
async function enrichAndFilter(entries: NaverListEntry[]): Promise<CollectedOrder[]> {
  const orderEntries = entries.filter((e) => e.serviceType === "ORDER" && e.orderNo);
  const nonOrderEntries = entries.filter((e) => e.serviceType !== "ORDER");
  const orderNos = new Set(orderEntries.map((e) => e.orderNo!));
  const assignmentsByOrderNo = new Map<string, Map<string, { deliveryNo: string | null }>>();
  const assignmentsFailed = new Set<string>();

  for (const orderNo of orderNos) {
    try {
      const map = await fetchNaverAssignments(orderNo);
      assignmentsByOrderNo.set(orderNo, map);
    } catch {
      assignmentsFailed.add(orderNo);
    }
    await delay(150);
  }

  const out: CollectedOrder[] = [];

  for (const entry of orderEntries) {
    // If assignments fails, keep the order and verify it again on the next pass.
    if (assignmentsFailed.has(entry.orderNo!)) {
      out.push(entry.order);
      continue;
    }
    const map = assignmentsByOrderNo.get(entry.orderNo!);
    const asg = map?.get(entry.productOrderNo);
    const hasDelivery = !!asg?.deliveryNo;

    if (!hasDelivery) {
      // PURCHASE_CONFIRMED with no tracking means confirmed non-delivery.
      if (entry.statusName === "PURCHASE_CONFIRMED") continue;
      // In-progress states may still receive a tracking number later, so keep them.
      out.push(entry.order);
      continue;
    }

    // trackDelivery exists: enrich via the tracking API and keep the order.
    try {
      const tracking = await fetchNaverTracking(entry.productOrderNo, asg!.deliveryNo!);
      if (tracking.trackingNumber) entry.order.trackingNumber = tracking.trackingNumber;
      if (tracking.carrierCode) entry.order.carrierCode = tracking.carrierCode;
      if (tracking.stageHint) entry.order.stageHint = tracking.stageHint;
      if (tracking.lastEventAt) entry.order.lastEventAt = tracking.lastEventAt;
      if (tracking.lastEventDescription) entry.order.lastEventDescription = tracking.lastEventDescription;
    } catch { /* retry on the next collection */ }

    out.push(entry.order);
    await delay(150);
  }

  for (const e of nonOrderEntries) out.push(e.order);
  return out;
}

export default defineContentScript({
  matches: ["https://pay.naver.com/pc/history*"],
  runAt: "document_idle",
  main() {
    const HOOK_MSG = "PARCEL_HUB_NAVER_DATA";

    function sendOrders(orders: CollectedOrder[]) {
      if (orders.length === 0) return;
      browser.runtime
        .sendMessage({ type: "content.orders", mall: "naver" as MallId, orders })
        .catch(() => { /* background unavailable and similar cases */ });
    }

    async function processEntries(entries: NaverListEntry[]) {
      if (entries.length === 0) return;
      try {
        const enriched = await enrichAndFilter(entries);
        sendOrders(enriched);
      } catch (e) {
        console.warn("[ParcelDeck naver] enrich failed", e);
      }
    }

    async function extractFromDom() {
      try {
        const el = document.getElementById("__NEXT_DATA__");
        if (!el || !el.textContent) return;
        const html = `<script id="__NEXT_DATA__" type="application/json">${el.textContent}</script>`;
        const entries = parseNaverListEntries(html);
        await processEntries(entries);
      } catch (e) {
        console.warn("[ParcelDeck naver] extractFromDom failed", e);
      }
    }

    function injectHook() {
      const id = "parceldeck-naver-hook";
      if (document.getElementById(id)) return;
      const script = document.createElement("script");
      script.id = id;
      script.src = browser.runtime.getURL("/injected/naver-hook.js");
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    }

    // When the MAIN-world hook forwards fetch responses, extract items and process them.
    window.addEventListener("message", (ev) => {
      if (ev.source !== window) return;
      if (ev.origin !== location.origin) return;
      const d = ev.data as { type?: string; payload?: { url?: string; data?: unknown; error?: string } } | null;
      if (!d || d.type !== HOOK_MSG || !d.payload) return;
      const { data, error } = d.payload;
      if (error) return;
      const items = extractItemsFlexible(data);
      if (items.length === 0) return;
      const entries = entriesFromItems(items);
      processEntries(entries).catch(() => {});
    });

    injectHook();
    extractFromDom();
    setTimeout(() => { extractFromDom(); }, 2000);

    // URL-based pagination (?page=N), matching the real session behavior.
    // Stop when every item on the page is older than the cutoff or when the page is empty.
    let cutoffMs = Date.now() - 90 * DAY_MS;
    const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/;
    const MAX_PAGES = 15;

    type Query = { queryKey?: unknown[]; state?: { data?: { pages?: Array<{ items?: Array<{ date?: number }> }> } } };

    function extractRawItemDates(html: string): number[] {
      const m = html.match(NEXT_DATA_RE);
      if (!m) return [];
      try {
        const data = JSON.parse(m[1]!) as { props?: { pageProps?: { dehydratedState?: { queries?: Query[] } } } };
        const queries = data?.props?.pageProps?.dehydratedState?.queries;
        if (!Array.isArray(queries)) return [];
        const paymentList = queries.find((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "PAYMENT_LIST");
        if (!paymentList) return [];
        const pages = paymentList.state?.data?.pages;
        if (!Array.isArray(pages)) return [];
        const dates: number[] = [];
        for (const p of pages) {
          for (const item of p.items ?? []) {
            if (typeof item.date === "number") dates.push(item.date);
          }
        }
        return dates;
      } catch {
        return [];
      }
    }

    async function fetchPage(page: number): Promise<{ entries: NaverListEntry[]; dates: number[] }> {
      const res = await fetch(`https://pay.naver.com/pc/history?page=${page}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const html = await res.text();
      const wrapMatch = html.match(NEXT_DATA_RE);
      const wrapped = wrapMatch ? `<script id="__NEXT_DATA__" type="application/json">${wrapMatch[1]}</script>` : "";
      const entries = wrapped ? parseNaverListEntries(wrapped) : [];
      const dates = extractRawItemDates(html);
      return { entries, dates };
    }

    async function autoPaginate() {
      for (let page = 2; page <= MAX_PAGES; page++) {
        let result: { entries: NaverListEntry[]; dates: number[] };
        try {
          result = await fetchPage(page);
        } catch (e) {
          console.warn(`[ParcelDeck naver] page ${page} failed`, e);
          return;
        }
        const { entries, dates } = result;
        await processEntries(entries);
        if (dates.length === 0) return;
        if (dates.every((d) => d < cutoffMs)) return;
      }
    }

    setTimeout(async () => {
      const days = (await store.getSettings()).fetchWindowDays;
      cutoffMs = Date.now() - days * DAY_MS;
      autoPaginate().catch((e) => console.warn("[ParcelDeck naver] autoPaginate error", e));
    }, 2500);
  },
});
