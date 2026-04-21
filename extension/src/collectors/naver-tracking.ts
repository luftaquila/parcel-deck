import type { ShipmentStage } from "@parceldeck/shared";

/**
 * Naver Pay delivery tracking API parser.
 *
 * Endpoint:
 *   GET /orderApi/orderSheet/universal/delivery/tracking/customer
 *       ?deliveryNo=<shipmentId>&productOrderNo=<productOrderNo>
 *
 * Real sample (2026-04, one delivered Hanjin order):
 *   result.deliveryTrace.stackTrace.invoiceNo          — tracking number
 *   result.deliveryTrace.stackTrace.deliveryCompanyName — observed: "한진택배" only
 *   result.deliveryTrace.deliveryStatusType             — observed: "DELIVERY_COMPLETION"
 *   result.deliveryTrace.stackTrace.details[].deliveryStatusType — observed: "DELIVERING", "ESTIMATED_ARRIVAL", "DELIVERY_COMPLETION"
 *
 * Other status enums and carrier names are not added until a real
 * sample appears. Unknown values return undefined/null and log a warning.
 *
 * **carrierCode (tracker.delivery id) requires its own mapping — this
 * parser only returns the raw Korean carrier name.** The mapping is
 * filled in later against the verified tracker.delivery catalog.
 */

const warnedStatus = new Set<string>();
const warnedCarrier = new Set<string>();
function warnStatus(value: string) {
  if (warnedStatus.has(value)) return;
  warnedStatus.add(value);
  console.warn(`[ParcelDeck naver-tracking] unmapped deliveryStatusType: ${JSON.stringify(value)}`);
}
function warnCarrier(value: string) {
  if (warnedCarrier.has(value)) return;
  warnedCarrier.add(value);
  console.warn(`[ParcelDeck naver-tracking] unmapped deliveryCompanyName: ${JSON.stringify(value)}`);
}

/**
 * deliveryStatusType values seen in real samples.
 * Verified 2026-04 against two orders (Lotte + Hanjin) in tracking details[]:
 *   COLLECT_CARGO, DELIVERING, ESTIMATED_ARRIVAL, DELIVERY_COMPLETION
 */
const STATUS_MAP: Record<string, ShipmentStage> = {
  COLLECT_CARGO: "at_pickup",
  DELIVERING: "in_transit",
  ESTIMATED_ARRIVAL: "out_for_delivery",
  DELIVERY_COMPLETION: "delivered",
};

export type NaverTrackingResponse = {
  code?: string;
  message?: string;
  result?: {
    deliveryOrder?: {
      productOrder?: {
        productOrderNo?: string;
        productOrderStatusType?: string;
        productName?: string;
      };
    };
    deliveryTrace?: {
      deliveryId?: string;
      interlockingCorpType?: string;
      deliveryStatusType?: string;
      deliveryDateTime?: string | null;
      deliveryCompleteDateTime?: string | null;
      trackable?: boolean;
      completed?: boolean;
      expired?: boolean;
      stackTrace?: {
        deliveryCompanyName?: string | null;
        deliveryCompanyTel?: string | null;
        invoiceNo?: string | null;
        completed?: boolean;
        lastDetail?: TraceEvent | null;
        details?: TraceEvent[];
      } | null;
    };
  };
};

export type TraceEvent = {
  processDateTime?: string;
  deliveryStatusType?: string;
  deliveryStatusName?: string;
  branchName?: string;
};

/**
 * Naver deliveryCompanyName → tracker.delivery id.
 *
 * Naver returns Korean carrier names with variation ("한진택배",
 * "CJ대한통운", "CJ택배", "대한통운", etc.). Substring matches absorb
 * those variants. International carriers are matched case-insensitively.
 */
export function resolveNaverCarrierCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim();
  if (!n) return null;
  const upper = n.toUpperCase();

  // Domestic (Korea)
  if (n.includes("한진")) return "kr.hanjin";
  if (n.includes("롯데")) return "kr.lotte";
  if (n.includes("CJ") || n.includes("대한통운")) return "kr.cjlogistics";
  if (n.includes("우체국")) {
    return n.includes("EMS") || n.includes("국제") ? "kr.epost.ems" : "kr.epost";
  }
  if (n.includes("로젠")) return "kr.logen";
  if (n.includes("경동")) return "kr.kdexp";
  if (n.includes("대신")) return "kr.daesin";
  if (n.includes("합동")) return "kr.hdexp";
  if (n.includes("천일")) return "kr.chunilps";
  if (n.includes("호남")) return "kr.honamlogis";
  if (n.includes("일양")) return "kr.ilyanglogis";
  if (n.includes("용마")) return "kr.yongmalogis";
  if (n.includes("쿠팡")) return "kr.coupangls";
  if (n.includes("군영")) return "kr.kunyoung";
  if (n.includes("홈픽")) return "kr.homepick";
  if (n.includes("판토스")) return "kr.epantos";
  if (n.includes("투데이")) return "kr.today";
  if (upper.includes("SLX")) return "kr.slx";
  if (upper.includes("LTL")) return "kr.ltl";
  if (n.includes("CU") && n.includes("편의점")) return "kr.cupost";
  if (n.includes("GS") || n.includes("편의점택배") || upper.includes("CVSNET") || upper.includes("POSTBOX")) return "kr.cvsnet";

  // International
  if (upper.includes("DHL")) return "de.dhl";
  if (upper.includes("FEDEX")) return "us.fedex";
  if (upper.includes("USPS")) return "us.usps";
  if (upper.includes("UPS")) return "us.ups";
  if (upper.includes("TNT")) return "nl.tnt";
  if (upper.includes("YAMATO") || n.includes("야마토")) return "jp.yamato";
  if (upper.includes("SAGAWA") || n.includes("사가와")) return "jp.sagawa";
  if (upper.includes("JAPAN POST")) return "jp.japanpost";
  if (upper.includes("CAINIAO")) return "cn.cainiao.global";

  return null;
}

export type NaverTrackingResult = {
  trackingNumber: string | null;
  carrierName: string | null;    // Raw Korean carrier name returned by Naver.
  carrierCode: string | null;    // Mapped tracker.delivery id (null + warn when unmapped).
  stageHint?: ShipmentStage;
  completed: boolean;
  lastEventAt: string | null;
  lastEventDescription: string | null;
};

export function parseNaverTracking(response: NaverTrackingResponse): NaverTrackingResult {
  const empty: NaverTrackingResult = {
    trackingNumber: null, carrierName: null, carrierCode: null,
    completed: false, lastEventAt: null, lastEventDescription: null,
  };
  if (response.code && response.code !== "00") return empty;
  const trace = response.result?.deliveryTrace;
  if (!trace) return empty;

  const stack = trace.stackTrace ?? null;
  const trackingNumber = stack?.invoiceNo ? String(stack.invoiceNo).trim() || null : null;
  const carrierName = stack?.deliveryCompanyName ?? null;
  const carrierCode = resolveNaverCarrierCode(carrierName);
  if (carrierName && !carrierCode) warnCarrier(carrierName);

  let stage: ShipmentStage | undefined;
  if (trace.deliveryStatusType) {
    if (STATUS_MAP[trace.deliveryStatusType]) stage = STATUS_MAP[trace.deliveryStatusType];
    else warnStatus(trace.deliveryStatusType);
  }

  const last = stack?.lastDetail ?? null;
  const lastEventAt =
    last?.processDateTime ??
    trace.deliveryCompleteDateTime ??
    trace.deliveryDateTime ??
    null;
  const lastEventDescription =
    (last?.deliveryStatusName && last?.branchName
      ? `${last.deliveryStatusName} · ${last.branchName}`
      : last?.deliveryStatusName) ?? null;

  return {
    trackingNumber,
    carrierName,
    carrierCode,
    stageHint: stage,
    completed: Boolean(trace.completed),
    lastEventAt,
    lastEventDescription,
  };
}
