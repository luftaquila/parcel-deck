import type { MallId } from "@parceldeck/shared";

/**
 * Per-mall configuration.
 * - origins            : URL origins to match
 * - authCookieDomains  : domains where auth cookies are scoped (filter for cookies.onChanged)
 * - authCookieNames    : candidate auth cookie names (presence of any one means a possible login)
 * - loginPageRegex     : detects whether a URL is the mall's login page
 * - probeUrl           : lightweight endpoint used to check session health (JSON responses preferred)
 * - keepAliveUrl       : periodic ping URL (may be the same as probeUrl)
 *
 * Probes use `mode: "cors", credentials: "include"`. Many malls avoid
 * SameSite=None on their auth cookies, which means calling through a
 * content script is safer (a direct background fetch is treated as a
 * third-party context).
 */

export type MallConfig = {
  id: MallId;
  label: string;
  origins: string[];
  authCookieDomains: string[];
  authCookieNames: string[];
  loginPageRegex: RegExp;
  probeUrl: string;
  keepAliveUrl: string;
  keepAliveIntervalMin: number;
};

export const MALL_CONFIGS: Record<MallId, MallConfig> = {
  coupang: {
    id: "coupang",
    label: "쿠팡",
    origins: ["https://www.coupang.com", "https://mc.coupang.com"],
    authCookieDomains: [".coupang.com"],
    authCookieNames: ["X-CP-L", "sid", "MEMBER_ID"],
    loginPageRegex: /login\.coupang\.com/i,
    probeUrl: "https://mc.coupang.com/ssr/desktop/order",
    keepAliveUrl: "https://www.coupang.com/np/mycoupang",
    keepAliveIntervalMin: 45,
  },
  naver: {
    id: "naver",
    label: "네이버",
    origins: [
      "https://pay.naver.com",
      "https://order.pay.naver.com",
      "https://smartstore.naver.com",
      "https://www.naver.com",
    ],
    authCookieDomains: [".naver.com"],
    authCookieNames: ["NID_AUT", "NID_SES"],
    loginPageRegex: /nid\.naver\.com\/nidlogin\.login/i,
    // Actual order history SSR page (PC)
    probeUrl: "https://pay.naver.com/pc/history",
    keepAliveUrl: "https://pay.naver.com/pc/history",
    keepAliveIntervalMin: 60,
  },
  aliexpress: {
    id: "aliexpress",
    label: "알리익스프레스",
    origins: ["https://www.aliexpress.com", "https://www.aliexpress.us", "https://ko.aliexpress.com"],
    authCookieDomains: [".aliexpress.com", ".aliexpress.us"],
    authCookieNames: ["_hvn_lgc_", "x_lid", "ali_apache_track"],
    loginPageRegex: /login\.aliexpress\.com|passport\.aliexpress\.com/i,
    probeUrl: "https://www.aliexpress.com/p/order/index.html",
    keepAliveUrl: "https://www.aliexpress.com/p/order/index.html",
    keepAliveIntervalMin: 60,
  },
};

export function mallFromUrl(url: string): MallId | null {
  for (const cfg of Object.values(MALL_CONFIGS)) {
    if (cfg.origins.some((o) => url.startsWith(o))) return cfg.id;
  }
  return null;
}

export function mallFromCookieDomain(domain: string): MallId | null {
  for (const cfg of Object.values(MALL_CONFIGS)) {
    if (cfg.authCookieDomains.some((d) => domain === d || domain.endsWith(d))) return cfg.id;
  }
  return null;
}
