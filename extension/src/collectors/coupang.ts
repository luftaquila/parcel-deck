import {
  UnauthenticatedError,
  type MallCollector,
} from "./types.js";
import { MALL_CONFIGS } from "../lib/mall-config.js";
import { isAuthExpired } from "../lib/util.js";

/**
 * Coupang collector — not implemented until real samples are captured.
 *
 * Still need to establish:
 *  - Actual URL and response shape of the order history page (SSR HTML vs XHR JSON).
 *  - Endpoints that only an authenticated session can reach.
 *  - Status code enums and the carrier / tracking field layout.
 *  - Session keep-alive and expiry behavior (which URL to probe).
 *
 * For now only probe runs to infer login state; collect returns an empty array.
 */
export const coupangCollector: MallCollector = {
  id: "coupang",

  async probe() {
    const res = await fetch(MALL_CONFIGS.coupang.probeUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (isAuthExpired(res)) return "expired";
    return "authenticated";
  },

  async collect(_opts) {
    const res = await fetch(MALL_CONFIGS.coupang.probeUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (isAuthExpired(res)) {
      throw new UnauthenticatedError("coupang_redirect");
    }
    // TODO: implement parsing once real samples are available
    return [];
  },
};
