import type { ShipmentStage } from "@parceldeck/shared";

/**
 * Parser for the AliExpress delivery-tracking API (`mtop.ae.ld.querydetail`).
 *
 * Request shape verified from a real session in 2026-04:
 *   GET https://acs.aliexpress.com/h5/mtop.ae.ld.querydetail/1.0/
 *   params: jsv, appKey(=24815441), t, sign(md5(token+&+t+&+appKey+&+data)),
 *           v=1.0, api=mtop.ae.ld.querydetail, type=originaljson, dataType=json, data=<json>
 *   data.tradeOrderId, data.terminalType="PC", data.needPageDisplayInfo=true,
 *       data.__inline="true", data._lang, data._currency
 *   cookie: _m_h5_tk required (token + expiry), plus the usual AE session cookies
 *
 * Observed response shape:
 *   {
 *     api: "mtop.ae.ld.querydetail",
 *     ret: ["SUCCESS::..."],
 *     data: {
 *       module: {
 *         trackingDetailLineList: [
 *           {
 *             mailNo,                       // tracking number
 *             originMailNo,
 *             logisticsCarrierName,         // service name ("AliExpress standard shipping")
 *             logisticsCpInfo: {
 *               cpName,                     // actual carrier ("Hanjin")
 *               contactCarrierText,          // "Contact Hanjin"
 *               ...
 *             },
 *             detailList: [
 *               { time(ms), timeText, trackingName, trackingDetailDesc,
 *                 trackingSecondCode, trackingPrimaryCode, fulfillStage, ... }
 *             ]
 *           }
 *         ],
 *         logisticsReceiverInfo: { ...PII... },   // recipient info, intentionally ignored
 *         fastDeliveryInfoDTO, i18nMap, isTrackingV2, pageResources
 *       }
 *     }
 *   }
 *
 * trackingSecondCode values observed so far (from one in-transit order):
 *   AE_ORDER_PLACED, AE_ORDER_PAID, AE_ORDER_SHIPPED,
 *   AE_LH_HO_IN_SUCCESS, AE_LH_HO_AIRLINE,
 *   AE_CC_EX_START_SUCCESS, AE_CC_EX_SUCCESS_SUCCESS
 *
 * Observed cpName: "Hanjin" (mapped to kr.hanjin).
 */

const warnedStatus = new Set<string>();
const warnedCarrier = new Set<string>();
function warnStatus(v: string, mailNo: string | null) {
  if (warnedStatus.has(v)) return;
  warnedStatus.add(v);
  console.warn(`[ParcelDeck ali-tracking] unmapped trackingSecondCode: ${JSON.stringify(v)} (tracking ${mailNo ?? "?"})`);
}
function warnCarrier(v: string, mailNo: string | null) {
  if (warnedCarrier.has(v)) return;
  warnedCarrier.add(v);
  console.warn(`[ParcelDeck ali-tracking] unmapped cpName: ${JSON.stringify(v)} (tracking ${mailNo ?? "?"})`);
}

/**
 * Only values observed in real samples are mapped.
 * Verified from two 2026-04 tracking responses (in-transit + delivered).
 *
 * fulfillStage 1000=warehouse, 1400=long haul, 1600=customs, 1700=destination.
 */
const STATUS_MAP: Record<string, ShipmentStage> = {
  // Order lifecycle
  AE_ORDER_PLACED: "pending",
  AE_ORDER_PAID: "pending",
  AE_ORDER_SHIPPED: "at_pickup",
  // Warehouse processing (GWMS)
  AE_GWMS_ACCEPT: "pending",
  AE_GWMS_PACKAGE: "pending",
  AE_GWMS_OUTBOUND: "at_pickup",
  // International line haul (LH)
  AE_LH_HO_IN_SUCCESS: "in_transit",
  AE_LH_HO_AIRLINE: "in_transit",
  AE_LH_DEPART_SUCCESS: "in_transit",
  AE_LH_ARRIVE_SUCCESS: "in_transit",
  // Customs clearance (CC)
  AE_CC_EX_START_SUCCESS: "in_transit",
  AE_CC_EX_SUCCESS_SUCCESS: "in_transit",
  AE_CC_IM_START: "in_transit",
  AE_CC_IM_SUCCESS: "in_transit",
  AE_CC_HO_OUT_SUCCESS: "in_transit",
  // Destination-mile delivery (GTMS)
  AE_GTMS_ACCEPT: "in_transit",
  AE_GTMS_SC_DEPART: "in_transit",
  AE_GTMS_SC_ARRIVE: "in_transit",
  AE_GTMS_DELIVERING: "out_for_delivery",
  AE_GTMS_DO_DEPART: "out_for_delivery",
  AE_GTMS_SIGNED: "delivered",
};

/**
 * AE cpName -> tracker.delivery id.
 * AliExpress returns carrier names in English or abbreviations
 * ("Hanjin", "CJ", "Korea Post", etc.). Substring matching absorbs
 * formatting variance. International carriers use the same approach.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function resolveAliCarrierCode(cpName: string | null | undefined): string | null {
  if (!cpName) return null;
  const n = norm(cpName);
  if (!n) return null;

  // Domestic Korea
  if (n.includes("sungwon")) {
    if (n.includes("cj")) return "kr.swgexp.cjlogistics";
    if (n.includes("post")) return "kr.swgexp.epost";
  }
  if (n.includes("hanjin")) return "kr.hanjin";
  if (n.includes("lotte")) return "kr.lotte";
  if (n.includes("cj") || n.includes("korea express") || n.includes("대한통운")) return "kr.cjlogistics";
  if (n.includes("epost") || n.includes("korea post") || n.includes("koreapost")) {
    return n.includes("ems") ? "kr.epost.ems" : "kr.epost";
  }
  if (n.includes("logen")) return "kr.logen";
  if (n.includes("kyoungdong") || n.includes("kyungdong") || n === "kd") return "kr.kdexp";
  if (n.includes("daesin")) return "kr.daesin";
  if (n.includes("coupang")) return "kr.coupangls";
  if (n.includes("chunil")) return "kr.chunilps";
  if (n.includes("honam")) return "kr.honamlogis";
  if (n.includes("ilyang")) return "kr.ilyanglogis";
  if (n.includes("yongma")) return "kr.yongmalogis";
  if (n.includes("hapdong")) return "kr.hdexp";
  if (n.includes("pantos")) return "kr.epantos";
  if (n.includes("homepick")) return "kr.homepick";
  if (n.includes("kunyoung")) return "kr.kunyoung";
  if (n.includes("slx")) return "kr.slx";
  if (n.includes("cupost") || (n.includes("cu") && n.includes("편의점"))) return "kr.cupost";
  if (n.includes("gs postbox") || n.includes("cvsnet")) return "kr.cvsnet";

  // International
  if (n.includes("dhl")) return "de.dhl";
  if (n.includes("fedex")) return "us.fedex";
  if (n.includes("usps")) return "us.usps";
  if (n.includes("ups")) return "us.ups";
  if (n.includes("tnt")) return "nl.tnt";
  if (n.includes("yamato")) return "jp.yamato";
  if (n.includes("sagawa")) return "jp.sagawa";
  if (n.includes("japan post") || n.includes("yuubin")) return "jp.japanpost";
  if (n.includes("cainiao")) return "cn.cainiao.global";
  if (n.includes("ems") && (n.includes("upu") || n.includes("universal"))) return "un.upu.ems";

  return null;
}

export type AliTrackingResponse = {
  api?: string;
  ret?: string[];
  data?: {
    module?: {
      trackingDetailLineList?: Array<{
        mailNo?: string | null;
        originMailNo?: string | null;
        logisticsCarrierName?: string | null;
        logisticsCpInfo?: {
          cpName?: string | null;
          contactCarrierText?: string | null;
        } | null;
        detailList?: Array<{
          time?: number | null;
          timeText?: string | null;
          trackingName?: string | null;
          trackingDetailDesc?: string | null;
          trackingSecondCode?: string | null;
          trackingPrimaryCode?: string | null;
          fulfillStage?: string | null;
        }>;
      }>;
    };
  };
};

export type AliTrackingResult = {
  trackingNumber: string | null;
  carrierName: string | null;    // Raw value returned by AE (for example, "Hanjin")
  carrierCode: string | null;    // Mapped tracker.delivery id
  stageHint?: ShipmentStage;
  lastEventAt: string | null;
  lastEventDescription: string | null;
};

function isSuccess(ret?: string[]): boolean {
  if (!Array.isArray(ret)) return false;
  return ret.some((r) => typeof r === "string" && r.startsWith("SUCCESS::"));
}

export function parseAliTracking(response: AliTrackingResponse): AliTrackingResult {
  const empty: AliTrackingResult = {
    trackingNumber: null, carrierName: null, carrierCode: null,
    lastEventAt: null, lastEventDescription: null,
  };
  if (response.api !== "mtop.ae.ld.querydetail") return empty;
  if (!isSuccess(response.ret)) return empty;

  const line = response.data?.module?.trackingDetailLineList?.[0];
  if (!line) return empty;

  const trackingNumber = (line.mailNo ?? line.originMailNo ?? null) || null;
  const cpName = line.logisticsCpInfo?.cpName ?? null;
  const carrierCode = resolveAliCarrierCode(cpName);
  if (cpName && !carrierCode) warnCarrier(cpName, trackingNumber);

  const latest = line.detailList?.[0];
  let stage: ShipmentStage | undefined;
  if (latest?.trackingSecondCode) {
    if (STATUS_MAP[latest.trackingSecondCode]) stage = STATUS_MAP[latest.trackingSecondCode];
    else warnStatus(latest.trackingSecondCode, trackingNumber);
  }

  const lastEventAt = typeof latest?.time === "number" && latest.time > 0
    ? new Date(latest.time).toISOString()
    : null;
  const lastEventDescription = (latest?.trackingName && latest?.trackingDetailDesc)
    ? `${latest.trackingName} · ${latest.trackingDetailDesc}`
    : (latest?.trackingName ?? latest?.trackingDetailDesc ?? null);

  return {
    trackingNumber,
    carrierName: cpName,
    carrierCode,
    stageHint: stage,
    lastEventAt,
    lastEventDescription,
  };
}
