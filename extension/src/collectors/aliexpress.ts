import browser from "webextension-polyfill";
import { MALL_CONFIGS } from "../lib/mall-config.js";
import { store } from "../lib/store.js";
import { DAY_MS, delay, isAuthExpired } from "../lib/util.js";
import {
  UnauthenticatedError,
  type CollectedOrder,
  type MallCollector,
} from "./types.js";
import { parseAliPayload } from "./aliexpress-parse.js";
import { parseAliTracking, type AliTrackingResponse } from "./aliexpress-tracking-parse.js";

/**
 * AliExpress background collector.
 *
 * TypeScript port of aliexpress-hook.js autoCollect().
 * Reads the `_m_h5_tk` cookie through browser.cookies, signs MTop
 * requests, and calls the APIs directly. Both Chrome and Firefox send
 * the logged-in session cookies from the background with
 * credentials: "include".
 */

// ─── MD5 (Joseph Myers, public domain) ───────────────────────────────────────
function md5(str: string): string {
  function rh(n: number): string {
    let s = "";
    for (let j = 0; j <= 3; j++)
      s += ("0" + ((n >> (j * 8 + 4)) & 0x0f).toString(16)).slice(-1)
         + ("0" + ((n >> (j * 8)) & 0x0f).toString(16)).slice(-1);
    return s;
  }
  function ac(x: number, y: number): number {
    const l = (x & 0xffff) + (y & 0xffff);
    const m = (x >> 16) + (y >> 16) + (l >> 16);
    return (m << 16) | (l & 0xffff);
  }
  function rl(n: number, c: number): number { return (n << c) | (n >>> (32 - c)); }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return ac(rl(ac(ac(a, q), ac(x, t)), s), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function c2b(s: string): number[] {
    const utf8 = unescape(encodeURIComponent(s));
    const n = utf8.length;
    const b: number[] = [];
    for (let i = 0; i < n; i++) b[i >> 2] = (b[i >> 2] ?? 0) | (utf8.charCodeAt(i) << ((i % 4) * 8));
    b[n >> 2] = (b[n >> 2] ?? 0) | (0x80 << ((n % 4) * 8));
    b[(((n + 8) >> 6) * 16) + 14] = n * 8;
    return b;
  }
  const x = c2b(str);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < x.length; i += 16) {
    const [oa, ob, oc, od] = [a, b, c, d];
    a=ff(a,b,c,d,x[i+0]!|0, 7,-680876936);  d=ff(d,a,b,c,x[i+1]!|0,12,-389564586);
    c=ff(c,d,a,b,x[i+2]!|0,17, 606105819);  b=ff(b,c,d,a,x[i+3]!|0,22,-1044525330);
    a=ff(a,b,c,d,x[i+4]!|0, 7,-176418897);  d=ff(d,a,b,c,x[i+5]!|0,12,1200080426);
    c=ff(c,d,a,b,x[i+6]!|0,17,-1473231341); b=ff(b,c,d,a,x[i+7]!|0,22,-45705983);
    a=ff(a,b,c,d,x[i+8]!|0, 7,1770035416);  d=ff(d,a,b,c,x[i+9]!|0,12,-1958414417);
    c=ff(c,d,a,b,x[i+10]!|0,17,-42063);     b=ff(b,c,d,a,x[i+11]!|0,22,-1990404162);
    a=ff(a,b,c,d,x[i+12]!|0,7,1804603682);  d=ff(d,a,b,c,x[i+13]!|0,12,-40341101);
    c=ff(c,d,a,b,x[i+14]!|0,17,-1502002290);b=ff(b,c,d,a,x[i+15]!|0,22,1236535329);
    a=gg(a,b,c,d,x[i+1]!|0, 5,-165796510);  d=gg(d,a,b,c,x[i+6]!|0,9,-1069501632);
    c=gg(c,d,a,b,x[i+11]!|0,14,643717713);  b=gg(b,c,d,a,x[i+0]!|0,20,-373897302);
    a=gg(a,b,c,d,x[i+5]!|0, 5,-701558691);  d=gg(d,a,b,c,x[i+10]!|0,9,38016083);
    c=gg(c,d,a,b,x[i+15]!|0,14,-660478335); b=gg(b,c,d,a,x[i+4]!|0,20,-405537848);
    a=gg(a,b,c,d,x[i+9]!|0, 5,568446438);   d=gg(d,a,b,c,x[i+14]!|0,9,-1019803690);
    c=gg(c,d,a,b,x[i+3]!|0,14,-187363961);  b=gg(b,c,d,a,x[i+8]!|0,20,1163531501);
    a=gg(a,b,c,d,x[i+13]!|0,5,-1444681467); d=gg(d,a,b,c,x[i+2]!|0,9,-51403784);
    c=gg(c,d,a,b,x[i+7]!|0,14,1735328473);  b=gg(b,c,d,a,x[i+12]!|0,20,-1926607734);
    a=hh(a,b,c,d,x[i+5]!|0, 4,-378558);     d=hh(d,a,b,c,x[i+8]!|0,11,-2022574463);
    c=hh(c,d,a,b,x[i+11]!|0,16,1839030562); b=hh(b,c,d,a,x[i+14]!|0,23,-35309556);
    a=hh(a,b,c,d,x[i+1]!|0, 4,-1530992060); d=hh(d,a,b,c,x[i+4]!|0,11,1272893353);
    c=hh(c,d,a,b,x[i+7]!|0,16,-155497632);  b=hh(b,c,d,a,x[i+10]!|0,23,-1094730640);
    a=hh(a,b,c,d,x[i+13]!|0,4,681279174);   d=hh(d,a,b,c,x[i+0]!|0,11,-358537222);
    c=hh(c,d,a,b,x[i+3]!|0,16,-722521979);  b=hh(b,c,d,a,x[i+6]!|0,23,76029189);
    a=hh(a,b,c,d,x[i+9]!|0, 4,-640364487);  d=hh(d,a,b,c,x[i+12]!|0,11,-421815835);
    c=hh(c,d,a,b,x[i+15]!|0,16,530742520);  b=hh(b,c,d,a,x[i+2]!|0,23,-995338651);
    a=ii(a,b,c,d,x[i+0]!|0, 6,-198630844);  d=ii(d,a,b,c,x[i+7]!|0,10,1126891415);
    c=ii(c,d,a,b,x[i+14]!|0,15,-1416354905);b=ii(b,c,d,a,x[i+5]!|0,21,-57434055);
    a=ii(a,b,c,d,x[i+12]!|0,6,1700485571);  d=ii(d,a,b,c,x[i+3]!|0,10,-1894986606);
    c=ii(c,d,a,b,x[i+10]!|0,15,-1051523);   b=ii(b,c,d,a,x[i+1]!|0,21,-2054922799);
    a=ii(a,b,c,d,x[i+8]!|0, 6,1873313359);  d=ii(d,a,b,c,x[i+15]!|0,10,-30611744);
    c=ii(c,d,a,b,x[i+6]!|0,15,-1560198380); b=ii(b,c,d,a,x[i+13]!|0,21,1309151649);
    a=ii(a,b,c,d,x[i+4]!|0, 6,-145523070);  d=ii(d,a,b,c,x[i+11]!|0,10,-1120210379);
    c=ii(c,d,a,b,x[i+2]!|0,15,718787259);   b=ii(b,c,d,a,x[i+9]!|0,21,-343485551);
    a=ac(a,oa); b=ac(b,ob); c=ac(c,oc); d=ac(d,od);
  }
  return rh(a) + rh(b) + rh(c) + rh(d);
}

// Cookie lookup.
async function getH5Token(): Promise<string | null> {
  const all = await browser.cookies.getAll({ name: "_m_h5_tk" });
  const ali = all.find((c) => c.domain.includes("aliexpress"));
  if (!ali) return null;
  const sp = ali.value.indexOf("_");
  if (sp <= 0) return null;
  return ali.value.slice(0, sp);
}

// MTop GET call.
const APP_KEY_GET = "24815441";
const APP_KEY_POST = "12574478";

async function callMtopGet(api: string, dataObj: Record<string, unknown>, attempt = 0): Promise<unknown> {
  const token = await getH5Token();
  if (!token) throw new UnauthenticatedError("ali_no_token");

  const t = String(Date.now());
  const dataJson = JSON.stringify(dataObj);
  const sign = md5(`${token}&${t}&${APP_KEY_GET}&${dataJson}`);

  const url = new URL(`https://acs.aliexpress.com/h5/${api}/1.0/`);
  url.searchParams.set("jsv", "2.5.1");
  url.searchParams.set("appKey", APP_KEY_GET);
  url.searchParams.set("t", t);
  url.searchParams.set("sign", sign);
  url.searchParams.set("v", "1.0");
  url.searchParams.set("timeout", "15000");
  url.searchParams.set("api", api);
  url.searchParams.set("type", "originaljson");
  url.searchParams.set("dataType", "json");
  url.searchParams.set("data", dataJson);

  const res = await fetch(url.toString(), {
    credentials: "include",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json() as { ret?: string[] };

  const isTokenErr = (body.ret ?? []).some((r) => /TOKEN_|ILLEGAL_REQUEST|ILLEGAL_ACCESS/.test(r));
  if (isTokenErr && attempt === 0) {
    await delay(500);
    return callMtopGet(api, dataObj, 1);
  }
  return body;
}

// Ultron pagination state.
type UltronState = {
  bodyId: string;
  bodyFields: Record<string, unknown>;
  headerActionId: string;
  headerActionFields: Record<string, unknown>;
  linkageCommon: unknown;
  signature: unknown;
  hierarchy: unknown;
  endpoint: unknown;
  hasMore: boolean;
  pageIndex: number;
  pageSize: number;
};

function extractUltronState(body: unknown): UltronState | null {
  try {
    const d = (body as { data?: { data?: Record<string, unknown>; linkage?: { common?: unknown; signature?: unknown }; hierarchy?: unknown; endpoint?: unknown } }).data;
    if (!d?.data || !d?.linkage?.common) return null;
    let bodyId = "", bodyFields: Record<string, unknown> = {};
    let headerActionId = "", headerActionFields: Record<string, unknown> = {};
    for (const key of Object.keys(d.data)) {
      if (key.startsWith("pc_om_list_body_") && !bodyId) {
        bodyId = key.slice("pc_om_list_body_".length);
        bodyFields = ((d.data[key] as { fields?: Record<string, unknown> })?.fields) ?? {};
      } else if (key.startsWith("pc_om_list_header_action_") && !headerActionId) {
        headerActionId = key.slice("pc_om_list_header_action_".length);
        headerActionFields = ((d.data[key] as { fields?: Record<string, unknown> })?.fields) ?? {};
      }
    }
    if (!bodyId || !headerActionId) return null;
    return {
      bodyId, bodyFields, headerActionId, headerActionFields,
      linkageCommon: d.linkage.common,
      signature: d.linkage.signature,
      hierarchy: d.hierarchy,
      endpoint: d.endpoint,
      hasMore: !!(bodyFields.hasMore),
      pageIndex: (bodyFields.pageIndex as number) || 1,
      pageSize: (bodyFields.pageSize as number) || 10,
    };
  } catch { return null; }
}

// MTop POST for page N+1.
async function postNextPage(state: UltronState, nextPageIndex: number, attempt = 0): Promise<unknown> {
  const token = await getH5Token();
  if (!token) throw new UnauthenticatedError("ali_no_token");

  const bodyKey = `pc_om_list_body_${state.bodyId}`;
  const headerKey = `pc_om_list_header_action_${state.headerActionId}`;
  const componentData: Record<string, unknown> = {
    [bodyKey]: {
      fields: { hasMore: true, hasMoreText: "View orders", mergePayLimit: 20, pageIndex: nextPageIndex, pageSize: state.pageSize },
      id: state.bodyId, position: "body",
      scriptKey: `Pc_om_list_body_${state.bodyId}`,
      status: "normal", tag: "pc_om_list_body", type: "pc_om_list_body",
    },
    [headerKey]: {
      fields: state.headerActionFields, id: state.headerActionId, position: "header",
      scriptKey: `Pc_om_list_header_action_${state.headerActionId}`,
      status: "normal", tag: "pc_om_list_header_action", type: "pc_om_list_header_action",
    },
  };
  const innerParams = {
    data: JSON.stringify(componentData),
    linkage: JSON.stringify({ common: state.linkageCommon, input: [headerKey, bodyKey], request: [headerKey, bodyKey], signature: state.signature }),
    hierarchy: JSON.stringify(state.hierarchy),
    endpoint: JSON.stringify(state.endpoint),
    operator: bodyKey,
  };
  const outer = { params: JSON.stringify(innerParams), shipToCountry: "KR", _lang: "en_US" };
  const outerJson = JSON.stringify(outer);

  const t = String(Date.now());
  const sign = md5(`${token}&${t}&${APP_KEY_POST}&${outerJson}`);

  const url = new URL("https://acs.aliexpress.com/h5/mtop.aliexpress.trade.buyer.order.list/1.0/");
  url.searchParams.set("jsv", "2.5.1");
  url.searchParams.set("appKey", APP_KEY_POST);
  url.searchParams.set("t", t);
  url.searchParams.set("sign", sign);
  url.searchParams.set("v", "1.0");
  url.searchParams.set("post", "1");
  url.searchParams.set("type", "originaljson");
  url.searchParams.set("timeout", "15000");
  url.searchParams.set("dataType", "originaljsonp");
  url.searchParams.set("isSec", "1");
  url.searchParams.set("ecode", "1");
  url.searchParams.set("api", "mtop.aliexpress.trade.buyer.order.list");
  url.searchParams.set("method", "POST");
  url.searchParams.set("needLogin", "true");

  const res = await fetch(url.toString(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(outerJson),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json() as { ret?: string[] };

  const isTokenErr = (body.ret ?? []).some((r) => /TOKEN_|ILLEGAL_REQUEST|ILLEGAL_ACCESS/.test(r));
  if (isTokenErr && attempt === 0) {
    await delay(500);
    return postNextPage(state, nextPageIndex, 1);
  }
  return body;
}

// Collection.
export const aliexpressCollector: MallCollector = {
  id: "aliexpress",

  async probe() {
    const res = await fetch(MALL_CONFIGS.aliexpress.probeUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (isAuthExpired(res)) return "expired";
    return "authenticated";
  },

  async collect({ sinceMs }) {
    // Without a token, the user is either logged out or running in an unsupported session context.
    const token = await getH5Token();
    if (!token) throw new UnauthenticatedError("ali_no_token");

    const { fetchWindowDays } = await store.getSettings();
    const CUTOFF_MS = sinceMs
      ? Math.min(sinceMs - 7 * DAY_MS, Date.now() - fetchWindowDays * DAY_MS)
      : Date.now() - fetchWindowDays * DAY_MS;

    // orderId -> CollectedOrder, later enriched with tracking.
    const orderMap = new Map<string, CollectedOrder>();

    function ingestBody(body: unknown) {
      for (const o of parseAliPayload(body)) {
        if (!orderMap.has(o.mallOrderId)) orderMap.set(o.mallOrderId, o);
      }
    }

    function reachedCutoff(body: unknown): boolean {
      return parseAliPayload(body).some((o) => Date.parse(o.orderedAt) < CUTOFF_MS);
    }

    // 1) First page (GET)
    const listParams = {
      statusTab: "", renderType: "init", clientPlatform: "pc",
      shipToCountry: "KR", _lang: "en_US", _currency: "USD", __inline: "true",
    };
    const page1 = await callMtopGet("mtop.aliexpress.trade.buyer.order.list", listParams);
    ingestBody(page1);

    // 2) Pagination (POST)
    const MAX_PAGES = 15;
    let state = extractUltronState(page1);
    let reached = reachedCutoff(page1);

    while (state?.hasMore && !reached && state.pageIndex < MAX_PAGES) {
      await delay(300);
      try {
        const next = await postNextPage(state, state.pageIndex + 1);
        ingestBody(next);
        reached = reachedCutoff(next);
        const nextState = extractUltronState(next);
        if (!nextState) break;
        state = nextState;
      } catch (e) {
        console.warn("[ParcelDeck ali] page load failed", e);
        break;
      }
    }

    // 3) Per-order tracking lookup (skip already-delivered orders that already have a tracking number)
    for (const [orderId, order] of orderMap) {
      // Even delivered orders get one tracking call if the tracking number is still missing.
      if (order.stageHint === "delivered" && order.trackingNumber) continue;
      await delay(250);
      try {
        const trackBody = await callMtopGet("mtop.ae.ld.querydetail", {
          tradeOrderId: orderId, terminalType: "PC", needPageDisplayInfo: true,
          timeZone: "GMT+9", __inline: "true", _lang: "en_US", _currency: "USD",
        });
        const result = parseAliTracking(trackBody as AliTrackingResponse);
        if (result.trackingNumber) order.trackingNumber = result.trackingNumber;
        if (result.carrierCode) order.carrierCode = result.carrierCode;
        if (result.stageHint) order.stageHint = result.stageHint;
      } catch (e) {
        console.warn("[ParcelDeck ali] tracking failed", orderId, e);
      }
    }

    // Return only orders inside the collection window.
    return Array.from(orderMap.values()).filter((o) => Date.parse(o.orderedAt) >= CUTOFF_MS);
  },
};
