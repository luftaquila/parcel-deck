import type { ShipmentStage } from "@parceldeck/shared";
import { MALL_CONFIGS } from "../lib/mall-config.js";
import { store } from "../lib/store.js";
import { DAY_MS, delay, isAuthExpired } from "../lib/util.js";
import {
  UnauthenticatedError,
  UnsupportedError,
  type CollectedOrder,
  type MallCollector,
} from "./types.js";
import { parseNaverTracking, type NaverTrackingResponse } from "./naver-tracking.js";
import { fetchNaverAssignments } from "./naver-assignments.js";
import { fetchNaverDetail, parseNaverDetail } from "./naver-detail.js";

/**
 * Naver Pay collector.
 *
 * Flow observed against a real session (verified 2026-04):
 *   1. pay.naver.com/pc/history                         → items[] pulled from __NEXT_DATA__'s PAYMENT_LIST
 *   2. POST /orderApi/orderSheet/detail/assignments     → deliveryNo extracted from each productOrder's trackDelivery URL
 *   3. GET /orderApi/orderSheet/universal/delivery/...  → invoiceNo + deliveryCompanyName + deliveryStatusType
 *
 * Only values seen in real samples are mapped. Unseen values log a
 * console.warn and produce an undefined stageHint.
 */

const DEBUG = false;
function dlog(...args: unknown[]) { if (DEBUG) console.log("[ParcelDeck naver]", ...args); }

const warnedStatuses = new Set<string>();
function warnUnknownStatus(source: string, value: string) {
  const key = `${source}:${value}`;
  if (warnedStatuses.has(key)) return;
  warnedStatuses.add(key);
  console.warn(`[ParcelDeck naver] unmapped status (${source}): ${JSON.stringify(value)} — please add a mapping`);
}

/** Only English enum values observed in real data are mapped. Anything else → undefined + warn. */
const STATUS_NAME_MAP: Record<string, ShipmentStage> = {
  PAYMENT_COMPLETED: "pending",
  DELIVERY_PREPARING: "pending",
  DELIVERING: "in_transit",
  PURCHASE_CONFIRMED: "delivered",
  CANCELLED: "exception",
  PARTIALLY_CANCELLED: "exception",
};

const STATUS_TEXT_MAP: Record<string, ShipmentStage> = {
  "결제완료": "pending",
  "상품준비중": "pending",
  "배송중": "in_transit",
  "구매확정완료": "delivered",
  "결제취소": "exception",
  "부분취소": "exception",
};

const NON_DELIVERY_SERVICE_TYPES = new Set([
  // CROSSBORDER = Naver Pay used for an overseas purchase (convenience-store parcel, AliExpress, etc.).
  // AliExpress orders are captured by our own content script, so on the Naver side we treat them as non-delivery.
  "CROSSBORDER",
  "TRANSIT_CARD",
  "WETAX",
  "LOCALPAY",
  "BOOKING",
  // SIMPLE_PAYMENT = external stores or digital goods paid through Naver Pay (no tracking).
  "SIMPLE_PAYMENT",
]);

/** Statuses where the assignments chain can be skipped (canceled / partially canceled → no trackDelivery). */
const ENRICH_SKIP_STATUSES = new Set(["CANCELLED", "PARTIALLY_CANCELLED"]);

export type NaverItem = {
  _id?: string;
  date?: number;
  serviceType?: "ORDER" | "SIMPLE_PAYMENT" | "CROSSBORDER" | string;
  status?: { name?: string; text?: string };
  product?: { name?: string };
  additionalData?: { uniqueKey?: string; productOrderNo?: string; orderNo?: string };
};

function extractTrackingFromName(name: string): { tracking: string | null; carrier: null } {
  const m = name.match(/운송장번호\s*[:：]\s*(\d{8,})/);
  return { tracking: m ? m[1]! : null, carrier: null };
}

function shouldInclude(item: NaverItem): boolean {
  if (!item.serviceType) return false;
  if (NON_DELIVERY_SERVICE_TYPES.has(item.serviceType)) return false;
  // "[parcel] tracking number:..." indicates a prepaid convenience-store shipment where the user is the sender, not a tracked purchase.
  if (/^\[택배\]/.test(item.product?.name ?? "")) return false;
  return true;
}

/** List item → CollectedOrder + metadata for the enrichment chain. */
export type NaverListEntry = {
  order: CollectedOrder;
  orderNo: string | null;
  productOrderNo: string;
  serviceType: string;
  statusName: string | undefined;
};

function toNaverEntry(item: NaverItem): NaverListEntry | null {
  const mallOrderId = item.additionalData?.uniqueKey || item._id;
  if (!mallOrderId) return null;
  if (typeof item.date !== "number") return null;

  const displayName = (item.product?.name ?? "").trim() || "(제목 없음)";
  const { tracking, carrier } = extractTrackingFromName(displayName);

  const statusName = item.status?.name;
  const statusText = item.status?.text;
  let stageHint: ShipmentStage | undefined;
  if (statusName) {
    if (STATUS_NAME_MAP[statusName]) stageHint = STATUS_NAME_MAP[statusName];
    else warnUnknownStatus("list.status.name", statusName);
  }
  if (!stageHint && statusText) {
    if (STATUS_TEXT_MAP[statusText]) stageHint = STATUS_TEXT_MAP[statusText];
    else warnUnknownStatus("list.status.text", statusText);
  }

  const order: CollectedOrder = {
    mall: "naver",
    mallOrderId,
    orderedAt: new Date(item.date).toISOString(),
    displayName,
    trackingNumber: tracking,
    carrierCode: carrier,
    stageHint,
  };
  return {
    order,
    orderNo: item.additionalData?.orderNo ?? null,
    productOrderNo: item.additionalData?.productOrderNo ?? mallOrderId,
    serviceType: item.serviceType ?? "UNKNOWN",
    statusName,
  };
}

function tryParseFromNextData(html: string): NaverListEntry[] | null {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]!) as {
      props?: { pageProps?: { dehydratedState?: { queries?: Array<{ queryKey?: unknown[]; state?: { data?: unknown } }> } } };
    };
    const queries = data?.props?.pageProps?.dehydratedState?.queries;
    if (!Array.isArray(queries)) return null;
    const paymentList = queries.find((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "PAYMENT_LIST");
    if (!paymentList) return null;
    const stateData = paymentList.state?.data as { pages?: Array<{ items?: NaverItem[] }> } | undefined;
    const pages = stateData?.pages;
    if (!Array.isArray(pages)) return null;

    const out: NaverListEntry[] = [];
    for (const page of pages) {
      for (const item of page.items ?? []) {
        if (!shouldInclude(item)) continue;
        const entry = toNaverEntry(item);
        if (entry) out.push(entry);
      }
    }
    dlog(`pulled ${out.length} orders from __NEXT_DATA__`);
    return out;
  } catch (e) {
    dlog("__NEXT_DATA__ parse failed", e);
    return null;
  }
}

function detectUnauth(res: Response, html?: string): boolean {
  if (res.type === "opaqueredirect" || res.status === 0) return true;
  if (res.status === 401 || res.status === 403) return true;
  if (html && MALL_CONFIGS.naver.loginPageRegex.test(html)) return true;
  if (html && /nidlogin\.login|로그인이 필요/i.test(html)) return true;
  return false;
}

async function fetchHistoryHtml(page = 1): Promise<string> {
  const url = `https://pay.naver.com/pc/history?page=${page}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    headers: { Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.type === "opaqueredirect" || res.status === 0) {
    throw new UnauthenticatedError("naver_redirect");
  }
  if (res.status === 401 || res.status === 403) {
    throw new UnauthenticatedError(`naver_http_${res.status}`);
  }
  if (res.status >= 500) throw new Error(`naver server error: ${res.status}`);

  const text = await res.text();
  if (detectUnauth(res, text)) throw new UnauthenticatedError("naver_login_html");
  if (/captcha|자동입력 ?방지|보안인증/i.test(text)) throw new UnsupportedError("naver_captcha");
  return text;
}

/** Extract the raw item-date array from HTML for cutoff checks. Runs before shouldInclude(). */
function extractRawItemDates(html: string): number[] {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    type Query = { queryKey?: unknown[]; state?: { data?: { pages?: Array<{ items?: Array<{ date?: number }> }> } } };
    const data = JSON.parse(m[1]!) as { props?: { pageProps?: { dehydratedState?: { queries?: Query[] } } } };
    const queries = data?.props?.pageProps?.dehydratedState?.queries;
    if (!Array.isArray(queries)) return [];
    const paymentList = queries.find((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "PAYMENT_LIST");
    if (!paymentList) return [];
    const pages = paymentList.state?.data?.pages;
    if (!Array.isArray(pages)) return [];
    const dates: number[] = [];
    for (const p of pages) for (const item of p.items ?? []) if (typeof item.date === "number") dates.push(item.date);
    return dates;
  } catch { return []; }
}

/** HTML → CollectedOrder[] (for tests and simple callers). */
export function parseNaverHtml(html: string): CollectedOrder[] {
  return (tryParseFromNextData(html) ?? []).map((e) => e.order);
}

/** HTML → NaverListEntry[] (for the enrichment chain — includes metadata such as orderNo). */
export function parseNaverListEntries(html: string): NaverListEntry[] {
  return tryParseFromNextData(html) ?? [];
}

/** Calls the tracking API for a given productOrderNo + deliveryNo. */
export async function fetchNaverTracking(
  productOrderNo: string,
  deliveryNo: string
): Promise<ReturnType<typeof parseNaverTracking>> {
  const url = new URL("https://orders.pay.naver.com/orderApi/orderSheet/universal/delivery/tracking/customer");
  url.searchParams.set("deliveryNo", deliveryNo);
  url.searchParams.set("productOrderNo", productOrderNo);
  const res = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (isAuthExpired(res)) {
    throw new UnauthenticatedError(`naver_tracking_http_${res.status || "redirect"}`);
  }
  if (!res.ok) throw new Error(`naver tracking: HTTP ${res.status}`);
  const json = (await res.json()) as NaverTrackingResponse;
  return parseNaverTracking(json);
}

/**
 * Bounded concurrency — cap parallelism while still processing the
 * queue. Defaults to 3 so Naver does not throttle us.
 */
async function bounded<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  async function run(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]!);
    }
  }
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) runners.push(run());
  await Promise.all(runners);
}

/**
 * Runs the assignments → tracking chain for ORDER-type entries.
 * Each entry's order fields are enriched in place.
 */
async function enrichWithTracking(entries: NaverListEntry[]): Promise<void> {
  const targets = entries.filter((e) =>
    e.serviceType === "ORDER" &&
    e.orderNo &&
    !(e.statusName && ENRICH_SKIP_STATUSES.has(e.statusName))
  );
  if (targets.length === 0) return;

  // Dedupe by orderNo (multiple productOrders share one orderNo — we only call assignments once per orderNo).
  const byOrderNo = new Map<string, NaverListEntry[]>();
  for (const e of targets) {
    const list = byOrderNo.get(e.orderNo!) ?? [];
    list.push(e);
    byOrderNo.set(e.orderNo!, list);
  }

  const orderBatches = Array.from(byOrderNo.entries());
  await bounded(orderBatches, 3, async ([orderNo, items]) => {
    try {
      const assignments = await fetchNaverAssignments(orderNo);
      for (const item of items) {
        const entry = assignments.get(item.productOrderNo);
        if (!entry?.deliveryNo) continue;
        try {
          const tracking = await fetchNaverTracking(item.productOrderNo, entry.deliveryNo);
          if (tracking.trackingNumber) item.order.trackingNumber = tracking.trackingNumber;
          if (tracking.carrierCode) item.order.carrierCode = tracking.carrierCode;
          if (tracking.stageHint) item.order.stageHint = tracking.stageHint;
        } catch (e) {
          if (e instanceof UnauthenticatedError) throw e;
          console.warn(`[ParcelDeck naver] tracking failed po=${item.productOrderNo}`, e);
        }
      }
    } catch (e) {
      if (e instanceof UnauthenticatedError) throw e;
      console.warn(`[ParcelDeck naver] assignments failed orderNo=${orderNo}`, e);
    }
  });
}

export const naverCollector: MallCollector = {
  id: "naver",

  async probe() {
    const res = await fetch(MALL_CONFIGS.naver.probeUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (isAuthExpired(res)) return "expired";
    return "authenticated";
  },

  async collect({ sinceMs }) {
    const { fetchWindowDays } = await store.getSettings();
    const cutoffMs = Date.now() - fetchWindowDays * DAY_MS;

    const MAX_PAGES = 15;
    const orderNoReps = new Map<string, NaverListEntry>();    // orderNo → representative list entry (fallback)
    const nonOrderEntries: NaverListEntry[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      let html: string;
      try {
        html = await fetchHistoryHtml(page);
      } catch (e) {
        if (page === 1) throw e;  // Failure on page 1 is a session/network problem — propagate.
        console.warn(`[ParcelDeck naver] page ${page} failed`, e);
        break;
      }
      const pageEntries = parseNaverListEntries(html);
      for (const e of pageEntries) {
        if (e.serviceType === "ORDER" && e.orderNo) {
          if (!orderNoReps.has(e.orderNo)) orderNoReps.set(e.orderNo, e);
        } else {
          nonOrderEntries.push(e);
        }
      }
      const dates = extractRawItemDates(html);
      if (dates.length === 0) break;               // no more pages
      if (dates.every((d) => d < cutoffMs)) break; // cutoff reached
      await delay(200);
    }

    // For ORDER-type entries, call detail per orderNo to expand every productOrder ("includes N items").
    const entries: NaverListEntry[] = [];
    for (const [orderNo, rep] of orderNoReps) {
      try {
        const detail = await fetchNaverDetail(orderNo);
        const products = parseNaverDetail(detail);
        if (products.length === 0) {
          entries.push(rep);  // nothing extracted from detail → keep only the representative from the list
          continue;
        }
        for (const po of products) {
          entries.push({
            order: {
              mall: "naver",
              mallOrderId: po.productOrderNo,
              orderedAt: po.orderedAt,
              displayName: po.displayName,
              trackingNumber: null,
              carrierCode: null,
              stageHint: po.stageHint,
            },
            orderNo: po.orderNo,
            productOrderNo: po.productOrderNo,
            serviceType: "ORDER",
            statusName: undefined,
          });
        }
      } catch (e) {
        console.warn(`[ParcelDeck naver] detail failed orderNo=${orderNo}`, e);
        entries.push(rep);  // on failure, fall back to the list representative
      }
      await delay(150);
    }
    entries.push(...nonOrderEntries);

    await enrichWithTracking(entries);

    const all = entries
      .map((e) => e.order)
      .filter((o) => new Date(o.orderedAt).getTime() >= cutoffMs);
    if (!sinceMs) return all;
    const cutoff = sinceMs - 7 * DAY_MS;
    return all.filter((o) => new Date(o.orderedAt).getTime() >= cutoff);
  },
};
