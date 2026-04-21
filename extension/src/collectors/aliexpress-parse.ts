import type { ShipmentStage } from "@parceldeck/shared";
import type { CollectedOrder } from "./types.js";

/**
 * Parser for the AliExpress MTop order-list response.
 *
 * Endpoint: mtop.aliexpress.trade.buyer.order.list (JSONP)
 *
 * Real sample observed in 2026-04:
 *   JSONP wrapper: mtopjsonp<N>({...})
 *   data.data.pc_om_list_order_<id> = {
 *     tag: "pc_om_list_order",
 *     type: "pc_om_list_order",
 *     fields: {
 *       orderId,
 *       orderDateText: "Apr 13, 2026",
 *       statusText: "Awaiting delivery",     // only observed value so far
 *       orderLines: [{ itemTitle, ... }],
 *       utParams: { args: { orderStatus: 8 } }  // only observed value so far
 *     }
 *   }
 *
 * Other statusText/orderStatus values are intentionally left unmapped
 * until real samples are available. Unseen values yield undefined + warn.
 *
 * The list response does not contain tracking numbers. Those require the
 * separate tracking endpoint.
 */

const warnedStatus = new Set<string>();
const warnedCode = new Set<number>();
function warnStatus(value: string) {
  if (warnedStatus.has(value)) return;
  warnedStatus.add(value);
  console.warn(`[ParcelDeck aliexpress] unmapped statusText: ${JSON.stringify(value)}`);
}
function warnCode(value: number) {
  if (warnedCode.has(value)) return;
  warnedCode.add(value);
  console.warn(`[ParcelDeck aliexpress] unmapped orderStatus code: ${value}`);
}

/**
 * Only values observed in real samples are mapped.
 * Verified from 2026-04 live-session calls to the "all", "shipped", and "completed" tabs.
 */
const STATUS_MAP: Record<string, ShipmentStage> = {
  "Awaiting delivery": "in_transit",
  "Completed": "delivered",
};

const ORDER_STATUS_CODE: Record<number, ShipmentStage> = {
  8: "in_transit",  // Awaiting delivery
  9: "delivered",    // Completed
};

const MONTH_LUT: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(s: unknown): string | null {
  if (!s) return null;
  const str = String(s).trim();
  const enMonth = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (enMonth) {
    const month = MONTH_LUT[enMonth[1]!.slice(0, 3).toLowerCase()]!;
    return new Date(Date.UTC(parseInt(enMonth[3]!, 10), month, parseInt(enMonth[2]!, 10))).toISOString();
  }
  if (/\d{4}-\d{2}-\d{2}T/.test(str)) {
    const t = Date.parse(str);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const ymd = str.match(/(\d{4})[.\-/\s](\d{1,2})[.\-/\s](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]!.padStart(2, "0")}-${ymd[3]!.padStart(2, "0")}T00:00:00.000Z`;
  const t = Date.parse(str);
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

function unwrapJsonp(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const trimmed = input.trim();
  const wrapped = trimmed.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (wrapped) {
    try { return JSON.parse(wrapped[1]!); } catch { /* fall through */ }
  }
  try { return JSON.parse(trimmed); } catch { return input; }
}

function pcOrderToCollected(fields: Record<string, unknown>): CollectedOrder | null {
  const orderId = String(fields.orderId ?? "");
  if (!orderId) return null;

  const orderedAt = parseDate(fields.orderDateText);
  if (!orderedAt) return null;

  const orderLines = fields.orderLines as Array<Record<string, unknown>> | undefined;
  const title = (orderLines?.[0]?.itemTitle as string | undefined) ?? "";

  const statusText = String(fields.statusText ?? "");
  const utParams = fields.utParams as Record<string, unknown> | undefined;
  const args = utParams?.args as Record<string, unknown> | undefined;
  const orderStatusRaw = args?.orderStatus;
  const orderStatus = typeof orderStatusRaw === "number"
    ? orderStatusRaw
    : typeof orderStatusRaw === "string"
      ? Number(orderStatusRaw)
      : undefined;

  let stageHint: ShipmentStage | undefined;
  if (statusText) {
    if (STATUS_MAP[statusText]) stageHint = STATUS_MAP[statusText];
    else warnStatus(statusText);
  }
  if (!stageHint && typeof orderStatus === "number" && !Number.isNaN(orderStatus)) {
    if (ORDER_STATUS_CODE[orderStatus]) stageHint = ORDER_STATUS_CODE[orderStatus];
    else warnCode(orderStatus);
  }

  return {
    mall: "aliexpress",
    mallOrderId: orderId,
    orderedAt,
    displayName: title.trim() || "(제목 없음)",
    trackingNumber: null,   // absent from the list response
    carrierCode: null,
    stageHint,
  };
}

/**
 * Extract fields from `tag === "pc_om_list_order"` nodes. JSONP wrappers
 * are unwrapped automatically.
 */
export function parseAliPayload(rootRaw: unknown): CollectedOrder[] {
  const root = unwrapJsonp(rootRaw);
  const out: CollectedOrder[] = [];
  const collected = new Set<string>();
  const seen = new WeakSet<object>();

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const obj = node as Record<string, unknown>;
    if (
      (obj.tag === "pc_om_list_order" || obj.type === "pc_om_list_order") &&
      obj.fields && typeof obj.fields === "object"
    ) {
      const parsed = pcOrderToCollected(obj.fields as Record<string, unknown>);
      if (parsed && !collected.has(parsed.mallOrderId)) {
        collected.add(parsed.mallOrderId);
        out.push(parsed);
      }
    }

    for (const v of Object.values(obj)) walk(v);
  }

  walk(root);
  return out;
}
