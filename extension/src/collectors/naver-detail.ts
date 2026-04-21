import type { ShipmentStage } from "@parceldeck/shared";
import type { CollectedOrder } from "./types.js";
import { isAuthExpired } from "../lib/util.js";

/**
 * Naver Pay order detail API parser.
 *
 * Endpoint: GET https://orders.pay.naver.com/orderApi/orderSheet/detail/?orderNo=<orderNo>
 *
 * Real response (2026-04, observed across two samples):
 *   result.productOrders[].productOrderStatusType — observed: "PAYED", "PURCHASE_DECIDED" only
 *   result.productOrders[].deliveryCompleteDateTime — delivery-complete epoch ms (null means not delivered)
 *
 * This endpoint has no tracking number or carrier; only a status can be inferred.
 * Other English enum values will log a runtime warning and need to be added.
 */

const warned = new Set<string>();
function warn(value: string) {
  if (warned.has(value)) return;
  warned.add(value);
  console.warn(`[ParcelDeck naver-detail] unmapped productOrderStatusType: ${JSON.stringify(value)}`);
}

/** Only values observed in real samples. */
const STATUS_MAP: Record<string, ShipmentStage> = {
  PAYED: "pending",
  DELIVERING: "in_transit",
  PURCHASE_DECIDED: "delivered",
};

export type NaverDetailProductOrder = {
  productOrderNo: string;
  productOrderStatusType?: string;
  exposureStatusType?: string;
  productName?: string;
  deliveryCompleteDateTime?: number | null;
  dispatchDueDateTime?: number | null;
  bundleGroupKey?: string;
};

export type NaverDetailResponse = {
  code?: string;
  result?: {
    order?: { orderNo?: string; orderDateTime?: number };
    productOrders?: NaverDetailProductOrder[];
    productBundleGroups?: Record<string, { merchantName?: string }>;
  };
};

export function parseNaverDetail(
  response: NaverDetailResponse
): Array<CollectedOrder & { productOrderNo: string; orderNo: string }> {
  if (response.code && response.code !== "00") return [];
  const r = response.result;
  const productOrders = r?.productOrders;
  const orderDateTime = r?.order?.orderDateTime;
  const orderNo = r?.order?.orderNo;
  if (!Array.isArray(productOrders) || !orderDateTime || !orderNo) return [];

  const out: Array<CollectedOrder & { productOrderNo: string; orderNo: string }> = [];
  for (const po of productOrders) {
    if (!po.productOrderNo) continue;
    const stage = resolveStage(po);
    out.push({
      mall: "naver",
      mallOrderId: po.productOrderNo,
      productOrderNo: po.productOrderNo,
      orderNo,
      orderedAt: new Date(orderDateTime).toISOString(),
      displayName: (po.productName ?? "").trim() || "(제목 없음)",
      trackingNumber: null,   // Not present at this endpoint; the tracking endpoint fills this in later.
      carrierCode: null,
      stageHint: stage,
    });
  }
  return out;
}

function resolveStage(po: NaverDetailProductOrder): ShipmentStage | undefined {
  // Confirmed in samples: a non-null deliveryCompleteDateTime means the order is delivered.
  if (po.deliveryCompleteDateTime && po.deliveryCompleteDateTime > 0) return "delivered";
  const key = po.productOrderStatusType;
  if (!key) return undefined;
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  warn(key);
  return undefined;
}

/** Live-call helper — used against an authenticated session. */
export async function fetchNaverDetail(orderNo: string): Promise<NaverDetailResponse> {
  const url = new URL("https://orders.pay.naver.com/orderApi/orderSheet/detail/");
  url.searchParams.set("orderNo", orderNo);
  const res = await fetch(url.toString(), {
    method: "GET",
    credentials: "include",
    redirect: "manual",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (isAuthExpired(res)) {
    throw new Error(`naver detail: ${res.status || "redirect"}`);
  }
  if (!res.ok) throw new Error(`naver detail: HTTP ${res.status}`);
  return (await res.json()) as NaverDetailResponse;
}
