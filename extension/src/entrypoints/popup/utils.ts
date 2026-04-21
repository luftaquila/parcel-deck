import type { CustomsStage, ShipmentStage } from "@parceldeck/shared";

/**
 * Shared popup utilities: formatters, labels, and SVG icons reused by multiple panels.
 */

export const STAGE_LABEL: Record<ShipmentStage, string> = {
  pending: "발송 대기",
  information_received: "송장 등록",
  at_pickup: "집화",
  in_transit: "배송 중",
  out_for_delivery: "배송 출발",
  delivered: "배송 완료",
  exception: "배송 이슈",
  unknown: "확인 중",
};

export const CUSTOMS_STAGE_LABEL: Record<CustomsStage, string> = {
  arrived: "입항",
  warehoused: "반입",
  declared: "수입신고",
  inspecting: "심사",
  cleared: "수리",
  released: "반출",
  other: "진행",
};

// tracker.delivery carrier id -> Korean display label.
export const CARRIER_DISPLAY: Record<string, string> = {
  "kr.cjlogistics": "CJ대한통운",
  "kr.hanjin": "한진택배",
  "kr.lotte": "롯데택배",
  "kr.epost": "우체국택배",
  "kr.epost.ems": "우체국 EMS",
  "kr.logen": "로젠택배",
  "kr.kdexp": "경동택배",
  "kr.coupangls": "쿠팡 로켓배송",
  "kr.cvsnet": "GS편의점택배",
  "kr.cupost": "CU편의점택배",
  "kr.chunilps": "천일택배",
  "kr.hdexp": "합동택배",
  "kr.daesin": "대신택배",
  "kr.ilyanglogis": "일양로지스",
  "kr.slx": "SLX",
  "kr.honamlogis": "호남택배",
  "kr.yongmalogis": "용마로지스",
  "kr.kunyoung": "군영택배",
  "kr.homepick": "홈픽",
  "kr.epantos": "판토스",
  "kr.today": "투데이",
  "kr.ltl": "LTL",
  "kr.swgexp.cjlogistics": "성원글로벌CJ",
  "kr.swgexp.epost": "성원글로벌우체국",
  "de.dhl": "DHL",
  "us.fedex": "FedEx",
  "us.usps": "USPS",
  "us.ups": "UPS",
  "nl.tnt": "TNT",
  "jp.yamato": "야마토",
  "jp.sagawa": "사가와",
  "jp.japanpost": "일본우편",
  "cn.cainiao.global": "차이냐오",
  "un.upu.ems": "국제 EMS",
};

export const COPY_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
export const CHECK_SVG = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;
export const CHEVRON_UP_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
