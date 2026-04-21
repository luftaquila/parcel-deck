import type { CustomsEvent, CustomsProgress, CustomsStage } from "@parceldeck/shared";

/**
 * Korea Customs UNI-PASS public API client.
 *
 * - Cargo clearance progress ("cargo clearance progress information" service)
 *   GET https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo
 *   Inputs: crkyCn (auth key) + (mblNo | hblNo + blYy) or cargMtNo
 *   Response: XML — top-level <cargCsclPrgsInfoQryRtnVo> with repeated
 *             <cargCsclPrgsInfoDtlQryVo> children (one per progress event).
 *
 * AliExpress tracking numbers usually match as House B/L (HBL).
 * We try the current year first and retry once with the prior year if
 * the first lookup comes back empty.
 */

const BASE =
  "https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo";

const REQUEST_TIMEOUT_MS = 10_000;

/** UNI-PASS status string → CustomsStage mapping. Fallback is "other". */
const STAGE_KEYWORDS: Array<[RegExp, CustomsStage]> = [
  [/수리/, "cleared"],             // import declaration accepted
  [/반출/, "released"],
  [/심사|검사/, "inspecting"],
  [/수입.*신고|신고.*수리.*전/, "declared"],
  [/반입|입고/, "warehoused"],
  [/입항|하선|양륙/, "arrived"],
];

function classifyStage(text: string): CustomsStage {
  for (const [re, stage] of STAGE_KEYWORDS) if (re.test(text)) return stage;
  return "other";
}

/**
 * UNI-PASS returns timestamps as "YYYYMMDDHHmm(SS)?" or
 * "YYYY-MM-DD HH:mm:ss". Normalized to ISO 8601 with +09:00 (KST).
 */
function normalizeDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // YYYYMMDDHHmm(SS)
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 12) {
    const y = Number(digits.slice(0, 4));
    const mo = Number(digits.slice(4, 6));
    const d = Number(digits.slice(6, 8));
    const hh = Number(digits.slice(8, 10));
    const mm = Number(digits.slice(10, 12));
    const ss = digits.length >= 14 ? Number(digits.slice(12, 14)) : 0;
    // Range validation: if UNI-PASS returns garbage, drop it instead of silently accepting it.
    if (
      y < 1970 || y > 2100
      || mo < 1 || mo > 12
      || d < 1 || d > 31
      || hh < 0 || hh > 23
      || mm < 0 || mm > 59
      || ss < 0 || ss > 59
    ) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}+09:00`;
  }
  // Already ISO-like.
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  return null;
}

function textOf(el: Element | null | undefined, tag: string): string | null {
  if (!el) return null;
  const node = el.getElementsByTagName(tag)[0];
  const v = node?.textContent?.trim();
  return v && v.length > 0 ? v : null;
}

function parseXml(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    return doc;
  } catch {
    return null;
  }
}

export class CustomsApiError extends Error {
  code: string;
  constructor(code: string, msg: string) {
    super(msg);
    this.code = code;
    this.name = "CustomsApiError";
  }
}

export type CustomsLookupInput = {
  trackingNumber: string;
  unipassApiKey: string;
  /** Optional — if provided, used for the initial query; otherwise the current and prior year are tried. */
  blYear?: number;
};

async function fetchOnce(params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}?${qs}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new CustomsApiError("http", `UNI-PASS HTTP ${res.status}`);
  return await res.text();
}

/**
 * UNI-PASS returns errors as HTTP 200 + <tCnt>0</tCnt> + <errMsgCn>…</errMsgCn>.
 * An error message raises CustomsApiError; tCnt=0 yields an empty result.
 * Exported so unit tests can call it directly.
 */
export function parseResponse(xml: string): CustomsProgress | null {
  const doc = parseXml(xml);
  if (!doc) throw new CustomsApiError("parse", "XML parse error");
  const root = doc.documentElement;

  const errMsg =
    textOf(root, "errMsgCn") ??
    textOf(root, "errMsg") ??
    textOf(root, "ERROR_MSG");
  if (errMsg && !/조회.*결과.*없/i.test(errMsg) && !/^\s*$/.test(errMsg)) {
    throw new CustomsApiError("api", errMsg);
  }

  const tCntStr = textOf(root, "tCnt");
  if (tCntStr && Number(tCntStr) === 0) return null;

  const details = Array.from(root.getElementsByTagName("cargCsclPrgsInfoDtlQryVo"));
  if (details.length === 0) return null;

  const events: CustomsEvent[] = [];
  for (const d of details) {
    const descRaw =
      textOf(d, "csclPrgsStts") ??
      textOf(d, "cargTrcnRelaBsopTpcd") ??
      textOf(d, "prcsStNm");
    const timeRaw = textOf(d, "prcsDttm") ?? textOf(d, "procDttm");
    if (!descRaw || !timeRaw) continue;
    const time = normalizeDateTime(timeRaw);
    if (!time) continue;
    events.push({
      time,
      description: descRaw,
      stage: classifyStage(descRaw),
      location: textOf(d, "shedNm") ?? textOf(d, "prgsStCdNm") ?? null,
    });
  }

  if (events.length === 0) return null;

  // Chronological sort (oldest first).
  events.sort((a, b) => a.time.localeCompare(b.time));

  const cargMtNo = textOf(root, "cargMtNo");
  return {
    cargMtNo,
    hsCode: textOf(root, "hsSgn") ?? textOf(root, "hsCd") ?? null,
    declaredValueKrw: null,
    events,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Look up customs progress using the tracking number as House B/L.
 * Tries the current year first, then the prior year. Returns null if
 * both come back empty.
 */
export async function probeCustoms(
  input: CustomsLookupInput
): Promise<CustomsProgress | null> {
  const { trackingNumber, unipassApiKey, blYear } = input;
  if (!unipassApiKey) throw new CustomsApiError("no-key", "UNI-PASS API key not configured");
  if (!trackingNumber) return null;

  const thisYear = new Date().getFullYear();
  const years = blYear ? [blYear] : [thisYear, thisYear - 1];

  let lastErr: CustomsApiError | null = null;
  for (const yy of years) {
    try {
      const xml = await fetchOnce({
        crkyCn: unipassApiKey,
        hblNo: trackingNumber,
        blYy: String(yy),
      });
      const parsed = parseResponse(xml);
      if (parsed) return parsed;
    } catch (e) {
      if (e instanceof CustomsApiError) lastErr = e;
      else lastErr = new CustomsApiError("network", (e as Error).message ?? "network error");
      // Bail out immediately for api/http errors (e.g., bad key) — no point trying another year.
      if (lastErr.code === "api" || lastErr.code === "http") break;
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

// ─── Cache ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes
type CacheEntry = { at: number; result: CustomsProgress | null };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CustomsProgress | null>>();

/**
 * Cache + concurrent-call dedupe. Memoizes repeated lookups for the
 * same tracking number for ten minutes. Same pattern as
 * probeCarrierForTracking.
 */
export async function probeCustomsCached(
  input: CustomsLookupInput
): Promise<CustomsProgress | null> {
  const key = input.trackingNumber;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const result = await probeCustoms(input);
      cache.set(key, { at: Date.now(), result });
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export function invalidateCustomsCache(trackingNumber?: string) {
  if (trackingNumber) cache.delete(trackingNumber);
  else cache.clear();
}
