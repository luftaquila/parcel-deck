/**
 * userActions endpoint from the Naver Pay order-detail flow.
 *
 * Request format verified from a real sample in 2026-04:
 *   POST https://orders.pay.naver.com/orderApi/orderSheet/detail/assignments
 *   Content-Type: application/json
 *   body: {"orderNo":"<orderNo>","claimNos":[]}
 *
 * Response:
 * {
 *   code: "00",
 *   result: [
 *     {
 *       productOrderNo: "...",
 *       userActions: [
 *         { code: "trackDelivery", pcUrl: "https://orders.pay.naver.com/order/delivery/tracking/<productOrderNo>/<deliveryNo>", ... },
 *         ...
 *       ],
 *       claims: []
 *     }
 *   ]
 * }
 *
 * Purpose: extract deliveryNo from each productOrder's trackDelivery
 * action URL, then use it for the tracking endpoint.
 */

import { isAuthExpired } from "../lib/util.js";

export type NaverUserAction = {
  code?: string;
  text?: string;
  pcUrl?: string;
  mobileUrl?: string;
};

export type NaverAssignmentsResponse = {
  code?: string;
  message?: string;
  result?: Array<{
    productOrderNo?: string;
    userActions?: NaverUserAction[];
    claims?: unknown[];
  }>;
};

export type AssignmentsMap = Map<string, { deliveryNo: string | null }>;

export function parseNaverAssignments(response: NaverAssignmentsResponse): AssignmentsMap {
  const out: AssignmentsMap = new Map();
  if (response.code && response.code !== "00") return out;
  const rows = response.result;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row.productOrderNo) continue;
    const trackAction = row.userActions?.find((a) => a.code === "trackDelivery");
    const url = trackAction?.pcUrl ?? trackAction?.mobileUrl ?? null;
    const deliveryNo = extractDeliveryNoFromUrl(url);
    out.set(row.productOrderNo, { deliveryNo });
  }
  return out;
}

/**
 * trackDelivery URL shape:
 *   https://orders.pay.naver.com/order/delivery/tracking/<productOrderNo>/<deliveryNo>
 */
export function extractDeliveryNoFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/order\/delivery\/tracking\/\d+\/(\d+)/);
  return m ? m[1]! : null;
}

/**
 * Live fetch helper that uses the extension's logged-in browser session.
 */
export async function fetchNaverAssignments(orderNo: string): Promise<AssignmentsMap> {
  const res = await fetch("https://orders.pay.naver.com/orderApi/orderSheet/detail/assignments", {
    method: "POST",
    credentials: "include",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ orderNo, claimNos: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (isAuthExpired(res)) {
    throw new Error(`naver assignments: ${res.status || "redirect"}`);
  }
  if (!res.ok) throw new Error(`naver assignments: HTTP ${res.status}`);
  const json = (await res.json()) as NaverAssignmentsResponse;
  return parseNaverAssignments(json);
}
