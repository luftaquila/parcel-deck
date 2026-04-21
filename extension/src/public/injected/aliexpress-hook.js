/**
 * MAIN-world injection script for AliExpress.
 *
 * It works on two channels:
 *  A. Passive observation: hook MTop responses triggered by the page
 *     itself (JSONP / fetch / XHR).
 *  B. Active collection: when the content script sends AUTOCOLLECT,
 *     call `order.list` and `ae.ld.querydetail` directly using the
 *     signature verified in docs/ALIEXPRESS_MTOP.md
 *     (md5(token + & + t + & + appKey + & + dataJson)).
 *
 * All data is forwarded to the isolated content script via
 * postMessage because chrome.* is unavailable in the MAIN world.
 */

(function () {
  const TAG = "[ParcelDeck:ali-hook]";
  const MSG_TYPE = "PARCEL_HUB_ALI_DATA";
  const AUTO_START = "PARCEL_HUB_ALI_AUTOCOLLECT";
  const APP_KEY = "24815441";

  // ─── MD5 (RFC 1321) ─────────────────────────────────────────────────────
  // Condensed from Joseph Myers' public-domain implementation.
  // Test vectors: md5("") and md5("abc").
  function md5(str) {
    function rh(n) {
      let s = "", j;
      for (j = 0; j <= 3; j++)
        s += ("0" + ((n >> (j * 8 + 4)) & 0x0f).toString(16)).slice(-1) + ("0" + ((n >> (j * 8)) & 0x0f).toString(16)).slice(-1);
      return s;
    }
    function ac(x, y) {
      const l = (x & 0xffff) + (y & 0xffff);
      const m = (x >> 16) + (y >> 16) + (l >> 16);
      return (m << 16) | (l & 0xffff);
    }
    function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { return ac(rl(ac(ac(a, q), ac(x, t)), s), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function c2b(s) {
      // Convert to UTF-8 bytes, then pack into 32-bit words.
      const utf8 = unescape(encodeURIComponent(s));
      const n = utf8.length, b = [];
      let i;
      for (i = 0; i < n; i++) b[i >> 2] = (b[i >> 2] || 0) | (utf8.charCodeAt(i) << ((i % 4) * 8));
      b[n >> 2] = (b[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
      b[(((n + 8) >> 6) * 16) + 14] = n * 8;
      return b;
    }
    const x = c2b(str);
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const oa = a, ob = b, oc = c, od = d;
      a = ff(a, b, c, d, x[i + 0] | 0, 7, -680876936);
      d = ff(d, a, b, c, x[i + 1] | 0, 12, -389564586);
      c = ff(c, d, a, b, x[i + 2] | 0, 17, 606105819);
      b = ff(b, c, d, a, x[i + 3] | 0, 22, -1044525330);
      a = ff(a, b, c, d, x[i + 4] | 0, 7, -176418897);
      d = ff(d, a, b, c, x[i + 5] | 0, 12, 1200080426);
      c = ff(c, d, a, b, x[i + 6] | 0, 17, -1473231341);
      b = ff(b, c, d, a, x[i + 7] | 0, 22, -45705983);
      a = ff(a, b, c, d, x[i + 8] | 0, 7, 1770035416);
      d = ff(d, a, b, c, x[i + 9] | 0, 12, -1958414417);
      c = ff(c, d, a, b, x[i + 10] | 0, 17, -42063);
      b = ff(b, c, d, a, x[i + 11] | 0, 22, -1990404162);
      a = ff(a, b, c, d, x[i + 12] | 0, 7, 1804603682);
      d = ff(d, a, b, c, x[i + 13] | 0, 12, -40341101);
      c = ff(c, d, a, b, x[i + 14] | 0, 17, -1502002290);
      b = ff(b, c, d, a, x[i + 15] | 0, 22, 1236535329);

      a = gg(a, b, c, d, x[i + 1] | 0, 5, -165796510);
      d = gg(d, a, b, c, x[i + 6] | 0, 9, -1069501632);
      c = gg(c, d, a, b, x[i + 11] | 0, 14, 643717713);
      b = gg(b, c, d, a, x[i + 0] | 0, 20, -373897302);
      a = gg(a, b, c, d, x[i + 5] | 0, 5, -701558691);
      d = gg(d, a, b, c, x[i + 10] | 0, 9, 38016083);
      c = gg(c, d, a, b, x[i + 15] | 0, 14, -660478335);
      b = gg(b, c, d, a, x[i + 4] | 0, 20, -405537848);
      a = gg(a, b, c, d, x[i + 9] | 0, 5, 568446438);
      d = gg(d, a, b, c, x[i + 14] | 0, 9, -1019803690);
      c = gg(c, d, a, b, x[i + 3] | 0, 14, -187363961);
      b = gg(b, c, d, a, x[i + 8] | 0, 20, 1163531501);
      a = gg(a, b, c, d, x[i + 13] | 0, 5, -1444681467);
      d = gg(d, a, b, c, x[i + 2] | 0, 9, -51403784);
      c = gg(c, d, a, b, x[i + 7] | 0, 14, 1735328473);
      b = gg(b, c, d, a, x[i + 12] | 0, 20, -1926607734);

      a = hh(a, b, c, d, x[i + 5] | 0, 4, -378558);
      d = hh(d, a, b, c, x[i + 8] | 0, 11, -2022574463);
      c = hh(c, d, a, b, x[i + 11] | 0, 16, 1839030562);
      b = hh(b, c, d, a, x[i + 14] | 0, 23, -35309556);
      a = hh(a, b, c, d, x[i + 1] | 0, 4, -1530992060);
      d = hh(d, a, b, c, x[i + 4] | 0, 11, 1272893353);
      c = hh(c, d, a, b, x[i + 7] | 0, 16, -155497632);
      b = hh(b, c, d, a, x[i + 10] | 0, 23, -1094730640);
      a = hh(a, b, c, d, x[i + 13] | 0, 4, 681279174);
      d = hh(d, a, b, c, x[i + 0] | 0, 11, -358537222);
      c = hh(c, d, a, b, x[i + 3] | 0, 16, -722521979);
      b = hh(b, c, d, a, x[i + 6] | 0, 23, 76029189);
      a = hh(a, b, c, d, x[i + 9] | 0, 4, -640364487);
      d = hh(d, a, b, c, x[i + 12] | 0, 11, -421815835);
      c = hh(c, d, a, b, x[i + 15] | 0, 16, 530742520);
      b = hh(b, c, d, a, x[i + 2] | 0, 23, -995338651);

      a = ii(a, b, c, d, x[i + 0] | 0, 6, -198630844);
      d = ii(d, a, b, c, x[i + 7] | 0, 10, 1126891415);
      c = ii(c, d, a, b, x[i + 14] | 0, 15, -1416354905);
      b = ii(b, c, d, a, x[i + 5] | 0, 21, -57434055);
      a = ii(a, b, c, d, x[i + 12] | 0, 6, 1700485571);
      d = ii(d, a, b, c, x[i + 3] | 0, 10, -1894986606);
      c = ii(c, d, a, b, x[i + 10] | 0, 15, -1051523);
      b = ii(b, c, d, a, x[i + 1] | 0, 21, -2054922799);
      a = ii(a, b, c, d, x[i + 8] | 0, 6, 1873313359);
      d = ii(d, a, b, c, x[i + 15] | 0, 10, -30611744);
      c = ii(c, d, a, b, x[i + 6] | 0, 15, -1560198380);
      b = ii(b, c, d, a, x[i + 13] | 0, 21, 1309151649);
      a = ii(a, b, c, d, x[i + 4] | 0, 6, -145523070);
      d = ii(d, a, b, c, x[i + 11] | 0, 10, -1120210379);
      c = ii(c, d, a, b, x[i + 2] | 0, 15, 718787259);
      b = ii(b, c, d, a, x[i + 9] | 0, 21, -343485551);

      a = ac(a, oa); b = ac(b, ob); c = ac(c, oc); d = ac(d, od);
    }
    return rh(a) + rh(b) + rh(c) + rh(d);
  }

  // Fail fast if the MD5 implementation is accidentally modified.
  if (md5("") !== "d41d8cd98f00b204e9800998ecf8427e" ||
      md5("abc") !== "900150983cd24fb0d6963f7d28e17f72") {
    console.error(TAG, "MD5 self-test failed; cannot generate request signatures");
    return;
  }

  // Shared helpers.
  function post(source, data, extra) {
    try {
      const payload = Object.assign({ source, data }, extra || {});
      window.postMessage({ type: MSG_TYPE, payload }, window.location.origin);
    } catch (_) { /* noop */ }
  }

  function getTkToken() {
    // Cookie format: _m_h5_tk=<token>_<expiresMs>
    const m = document.cookie.match(/(?:^|;\s*)_m_h5_tk=([^;]+)/);
    if (!m) return null;
    const val = m[1];
    const sp = val.indexOf("_");
    if (sp <= 0) return null;
    return { token: val.slice(0, sp), expires: parseInt(val.slice(sp + 1), 10) || 0 };
  }

  function classifyResponse(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.api === "mtop.aliexpress.trade.buyer.order.list") return "order_list";
    if (payload.api === "mtop.ae.ld.querydetail") return "tracking";
    try {
      const d = payload.data && payload.data.data;
      if (d && typeof d === "object") {
        if (Object.keys(d).some(function (k) { return k.indexOf("pc_om_list_order_") === 0; })) return "order_list";
      }
    } catch (_) { /* noop */ }
    return null;
  }

  // Direct MTop calls.
  // Cache the original fetch before replacing window.fetch below.
  const rawFetch = window.fetch.bind(window);

  async function callMtop(api, dataObj, attempt) {
    attempt = attempt || 0;
    const tk = getTkToken();
    if (!tk) return { ok: false, error: "no_token" };

    const t = String(Date.now());
    const dataJson = JSON.stringify(dataObj);
    const sign = md5(tk.token + "&" + t + "&" + APP_KEY + "&" + dataJson);

    const url = new URL("https://acs.aliexpress.com/h5/" + api + "/1.0/");
    url.searchParams.set("jsv", "2.5.1");
    url.searchParams.set("appKey", APP_KEY);
    url.searchParams.set("t", t);
    url.searchParams.set("sign", sign);
    url.searchParams.set("v", "1.0");
    url.searchParams.set("timeout", "15000");
    url.searchParams.set("api", api);
    url.searchParams.set("type", "originaljson");
    url.searchParams.set("dataType", "json");
    url.searchParams.set("data", dataJson);

    // Use rawFetch so this response is not captured twice by the fetch hook.
    const res = await rawFetch(url.toString(), { credentials: "include" });
    const body = await res.json();

    // Token failures refresh _m_h5_tk via Set-Cookie. Retry once after the
    // browser applies the cookie update to document.cookie.
    const ret = Array.isArray(body && body.ret) ? body.ret : [];
    const isTokenErr = ret.some((r) => typeof r === "string" && /TOKEN_|ILLEGAL_REQUEST|ILLEGAL_ACCESS/.test(r));
    if (isTokenErr && attempt === 0) {
      await new Promise((r) => setTimeout(r, 300));
      return callMtop(api, dataObj, attempt + 1);
    }
    return { ok: true, body };
  }

  // Extract the state needed for the next Ultron POST.
  function extractUltronState(body) {
    try {
      const d = body && body.data;
      if (!d || !d.data) return null;
      let bodyId = null, bodyFields = null, headerActionId = null, headerActionFields = null;
      for (const key of Object.keys(d.data)) {
        if (key.indexOf("pc_om_list_body_") === 0 && !bodyId) {
          bodyId = key.slice("pc_om_list_body_".length);
          bodyFields = (d.data[key] && d.data[key].fields) || {};
        } else if (key.indexOf("pc_om_list_header_action_") === 0 && !headerActionId) {
          headerActionId = key.slice("pc_om_list_header_action_".length);
          headerActionFields = (d.data[key] && d.data[key].fields) || {};
        }
      }
      if (!bodyId || !headerActionId || !d.linkage || !d.linkage.common) return null;
      return {
        bodyId,
        bodyFields,
        headerActionId,
        headerActionFields,
        linkageCommon: d.linkage.common,
        signature: d.linkage.signature,
        hierarchy: d.hierarchy,
        endpoint: d.endpoint,
        hasMore: !!(bodyFields && bodyFields.hasMore),
        pageIndex: (bodyFields && bodyFields.pageIndex) || 1,
        pageSize: (bodyFields && bodyFields.pageSize) || 10,
      };
    } catch (_) {
      return null;
    }
  }

  // POST the next page by replaying the previous Ultron state with a bumped pageIndex.
  async function postNextPage(state, nextPageIndex, attempt) {
    attempt = attempt || 0;
    const tk = getTkToken();
    if (!tk) return { ok: false, error: "no_token" };

    const bodyKey = "pc_om_list_body_" + state.bodyId;
    const headerKey = "pc_om_list_header_action_" + state.headerActionId;

    const componentData = {};
    componentData[bodyKey] = {
      fields: {
        hasMore: true,
        hasMoreText: "View orders",
        mergePayLimit: 20,
        pageIndex: nextPageIndex,
        pageSize: state.pageSize,
      },
      id: state.bodyId,
      position: "body",
      scriptKey: "Pc_om_list_body_" + state.bodyId,
      status: "normal",
      tag: "pc_om_list_body",
      type: "pc_om_list_body",
    };
    componentData[headerKey] = {
      fields: state.headerActionFields,
      id: state.headerActionId,
      position: "header",
      scriptKey: "Pc_om_list_header_action_" + state.headerActionId,
      status: "normal",
      tag: "pc_om_list_header_action",
      type: "pc_om_list_header_action",
    };

    const innerParams = {
      data: JSON.stringify(componentData),
      linkage: JSON.stringify({
        common: state.linkageCommon,
        input: [headerKey, bodyKey],
        request: [headerKey, bodyKey],
        signature: state.signature,
      }),
      hierarchy: JSON.stringify(state.hierarchy),
      endpoint: JSON.stringify(state.endpoint),
      operator: bodyKey,
    };

    const outer = {
      params: JSON.stringify(innerParams),
      shipToCountry: "KR",
      _lang: "en_US",
    };
    const outerJson = JSON.stringify(outer);

    const t = String(Date.now());
    const POST_APP_KEY = "12574478";
    const sign = md5(tk.token + "&" + t + "&" + POST_APP_KEY + "&" + outerJson);

    const url = new URL("https://acs.aliexpress.com/h5/mtop.aliexpress.trade.buyer.order.list/1.0/");
    url.searchParams.set("jsv", "2.5.1");
    url.searchParams.set("appKey", POST_APP_KEY);
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

    const body = "data=" + encodeURIComponent(outerJson);
    const res = await rawFetch(url.toString(), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const respBody = await res.json();

    const ret = Array.isArray(respBody && respBody.ret) ? respBody.ret : [];
    const isTokenErr = ret.some((r) => typeof r === "string" && /TOKEN_|ILLEGAL_REQUEST|ILLEGAL_ACCESS/.test(r));
    if (isTokenErr && attempt === 0) {
      await new Promise((r) => setTimeout(r, 300));
      return postNextPage(state, nextPageIndex, attempt + 1);
    }
    return { ok: true, body: respBody };
  }

  function extractOrderIdsAndDates(body) {
    const items = [];
    try {
      const map = body && body.data && body.data.data;
      if (map && typeof map === "object") {
        for (const key of Object.keys(map)) {
          const node = map[key];
          if (node && node.tag === "pc_om_list_order" && node.fields && node.fields.orderId) {
            const f = node.fields;
            const orderLines = Array.isArray(f.orderLines) ? f.orderLines : [];
            const title = (orderLines[0] && orderLines[0].itemTitle) ? String(orderLines[0].itemTitle) : "";
            items.push({
              orderId: String(f.orderId),
              orderDateText: String(f.orderDateText || ""),
              itemTitle: title.trim(),
            });
          }
        }
      }
    } catch (_) { /* noop */ }
    return items;
  }

  // Example: "Apr 12, 2026" -> epoch milliseconds.
  const MONTH = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseOrderDate(s) {
    if (!s) return null;
    const m = s.match(/^([A-Za-z]+)\s+(\d+),\s+(\d{4})$/);
    if (!m) return null;
    const mon = MONTH[m[1].slice(0, 3).toLowerCase()];
    if (mon === undefined) return null;
    return Date.UTC(parseInt(m[3], 10), mon, parseInt(m[2], 10));
  }

  async function fetchTrackingForAll(orderMetas) {
    for (const meta of orderMetas) {
      const trackParams = {
        tradeOrderId: meta.orderId,
        terminalType: "PC",
        needPageDisplayInfo: true,
        timeZone: "GMT+9",
        __inline: "true",
        _lang: "en_US",
        _currency: "USD",
      };
      try {
        const r = await callMtop("mtop.ae.ld.querydetail", trackParams);
        if (r.ok && r.body) {
          // Backfill orderedAt/displayName from tracking data so the
          // background upsert still succeeds even if order.list parsing fails.
          const ms = parseOrderDate(meta.orderDateText);
          post("tracking", r.body, {
            tradeOrderId: meta.orderId,
            backfillOrderedAt: ms ? new Date(ms).toISOString() : null,
            backfillDisplayName: meta.itemTitle || null,
          });
        }
      } catch (e) {
        console.warn(TAG, "querydetail failed", meta.orderId, e);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  async function autoCollect(days) {
    const cutoffDays = typeof days === "number" && days > 0 ? days : 14;
    const listParams = {
      statusTab: "",
      renderType: "init",
      clientPlatform: "pc",
      shipToCountry: "KR",
      _lang: "en_US",
      _currency: "USD",
      __inline: "true",
    };

    // 1) Initial GET: page 1 plus the full Ultron state.
    const listRes = await callMtop("mtop.aliexpress.trade.buyer.order.list", listParams);
    if (!listRes.ok || !listRes.body) {
      console.warn(TAG, "order.list call failed", listRes.error || listRes.body);
      return;
    }
    post("order_list", listRes.body);
    let state = extractUltronState(listRes.body);
    // orderId -> { orderDateText, itemTitle } accumulator for backfill.
    const orderMetaMap = new Map();
    let items = extractOrderIdsAndDates(listRes.body);
    for (const it of items) orderMetaMap.set(it.orderId, it);

    // 2) Enforce the collection window from settings.
    const CUTOFF_MS = Date.now() - cutoffDays * 24 * 3600 * 1000;
    function reachedCutoff(its) {
      return its.some((it) => {
        const ts = parseOrderDate(it.orderDateText);
        return ts !== null && ts < CUTOFF_MS;
      });
    }

    // 3) Keep POSTing with pageIndex++ while hasMore is true.
    const MAX_PAGES = 15;
    let reached = reachedCutoff(items);
    while (state && state.hasMore && !reached && state.pageIndex < MAX_PAGES) {
      const nextIdx = state.pageIndex + 1;
      let nextRes;
      try {
        nextRes = await postNextPage(state, nextIdx);
      } catch (e) {
        console.warn(TAG, "page " + nextIdx + " POST failed", e);
        break;
      }
      if (!nextRes.ok || !nextRes.body) {
        console.warn(TAG, "page " + nextIdx + " response failed");
        break;
      }
      const retVal = Array.isArray(nextRes.body.ret) && nextRes.body.ret[0];
      if (typeof retVal !== "string" || retVal.indexOf("SUCCESS") !== 0) {
        console.warn(TAG, "page " + nextIdx + " ret=", retVal);
        break;
      }
      post("order_list", nextRes.body);
      items = extractOrderIdsAndDates(nextRes.body);
      for (const it of items) orderMetaMap.set(it.orderId, it);
      reached = reachedCutoff(items);
      const nextState = extractUltronState(nextRes.body);
      if (!nextState) break;
      state = nextState;
      await new Promise((r) => setTimeout(r, 300));
    }

    // 4) Per-order tracking lookup, including backfilled entries.
    await fetchTrackingForAll(Array.from(orderMetaMap.values()));
  }

  // Passive observation channel.
  // 1. Wrap __INIT_DATA_CALLBACK__
  const origCb = window.__INIT_DATA_CALLBACK__;
  window.__INIT_DATA_CALLBACK__ = function (data) {
    try {
      const kind = classifyResponse(data);
      if (kind) post(kind, data);
    } catch (_) { /* noop */ }
    if (typeof origCb === "function") {
      try { return origCb.call(this, data); } catch (_) { /* noop */ }
    }
  };

  // 2. Hook global mtopjsonp* callbacks
  const hookedNames = new Set();
  function hookMtopCallback(name) {
    if (hookedNames.has(name)) return;
    hookedNames.add(name);
    const orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function (resp) {
      try {
        const kind = classifyResponse(resp);
        if (kind) post(kind, resp);
      } catch (_) { /* noop */ }
      return orig.apply(this, arguments);
    };
  }
  setInterval(function () {
    for (const key in window) {
      if (/^mtopjsonp/.test(key) && typeof window[key] === "function" && !hookedNames.has(key)) {
        hookMtopCallback(key);
      }
    }
  }, 1000);

  // 3. Hook fetch / XMLHttpRequest
  const MTOP_URL_RE = /acs\.aliexpress\.com\/h5\/mtop\./;

  function parseMtopResponseText(text) {
    if (!text) return null;
    const trimmed = text.trim();
    const wrapped = trimmed.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
    try { return JSON.parse(wrapped ? wrapped[1] : trimmed); } catch (_) { return null; }
  }

  // Extract tradeOrderId from the MTop URL's data= query parameter.
  // The page's own querydetail XHR includes tradeOrderId only in the
  // request JSON, not in the response body, so the content script needs
  // this to match tracking data to the correct order.
  function extractTradeOrderIdFromUrl(url) {
    try {
      const u = new URL(url, location.origin);
      const data = u.searchParams.get("data");
      if (!data) return null;
      const parsed = JSON.parse(data);
      return parsed && parsed.tradeOrderId ? String(parsed.tradeOrderId) : null;
    } catch (_) {
      return null;
    }
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url ? input.url : "";
      const isMtop = MTOP_URL_RE.test(url);
      const p = origFetch.apply(this, arguments);
      if (!isMtop) return p;
      return p.then(function (res) {
        try {
          res.clone().text().then(function (t) {
            const parsed = parseMtopResponseText(t);
            const kind = classifyResponse(parsed);
            if (!kind) return;
            const extra = kind === "tracking" ? { tradeOrderId: extractTradeOrderIdFromUrl(url) } : undefined;
            post(kind, parsed, extra);
          }).catch(function () { /* noop */ });
        } catch (_) { /* noop */ }
        return res;
      });
    };
  }

  const OrigXhr = window.XMLHttpRequest;
  if (OrigXhr) {
    const origOpen = OrigXhr.prototype.open;
    const origSend = OrigXhr.prototype.send;
    OrigXhr.prototype.open = function (method, url) {
      this.__ph_url = url;
      this.__ph_method = method;
      this.__ph_mtop = typeof url === "string" && MTOP_URL_RE.test(url);
      return origOpen.apply(this, arguments);
    };
    OrigXhr.prototype.send = function () {
      if (this.__ph_mtop) {
        const xhrUrl = this.__ph_url;
        this.addEventListener("load", function () {
          try {
            const parsed = parseMtopResponseText(this.responseText);
            const kind = classifyResponse(parsed);
            if (!kind) return;
            const extra = kind === "tracking" ? { tradeOrderId: extractTradeOrderIdFromUrl(xhrUrl) } : undefined;
            post(kind, parsed, extra);
          } catch (_) { /* noop */ }
        });
      }
      return origSend.apply(this, arguments);
    };
  }

  // Auto-collection trigger.
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    if (ev.data && ev.data.type === AUTO_START) {
      autoCollect(ev.data.days).catch(function (e) { console.warn(TAG, "autoCollect error", e); });
    }
  });

})();
