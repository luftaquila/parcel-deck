import type { Order } from "@parceldeck/shared";
import { store } from "../../lib/store.js";
import {
  TrackerCarrierNotSupported,
  probeCarrierForTracking,
  trackShipmentDetail,
  type ProbeResult,
  type TrackDetail,
} from "../../lib/tracker.js";
import {
  CARRIER_DISPLAY,
  CHEVRON_UP_SVG,
  COPY_SVG,
  STAGE_LABEL,
  escapeHtml,
  formatDateTime,
} from "./utils.js";

/**
 * Detailed shipment timeline panel.
 * Keeps per-order state, open/closed state, and per-tracking-number probe
 * promises in module scope. The caller renders the customs section and
 * injects it into the customsBlock slot.
 */

export type DetailState = {
  loading: boolean;
  detail: TrackDetail | null;
  error: string | null;
  resolvedCarrierCode?: string;
};

export const detailStates = new Map<string, DetailState>();
export const openDetails = new Set<string>();

// Share one probe promise when multiple orders use the same tracking number.
const probeCache = new Map<string, Promise<ProbeResult | null>>();

export async function loadDetail(order: Order): Promise<void> {
  const state: DetailState = { loading: true, detail: null, error: null };
  detailStates.set(order.id, state);
  try {
    if (!order.trackingNumber) {
      state.error = "송장번호 없음";
      return;
    }
    let carrierCode = order.carrierCode;
    if (!carrierCode) {
      let pending = probeCache.get(order.trackingNumber);
      if (!pending) {
        pending = probeCarrierForTracking(order.trackingNumber);
        probeCache.set(order.trackingNumber, pending);
      }
      const probeResult = await pending;
      if (!probeResult) {
        state.error = "택배사를 찾을 수 없습니다.";
        return;
      }
      // The probe response already contains detail data, so no extra request is needed.
      state.resolvedCarrierCode = probeResult.carrierId;
      state.detail = probeResult.detail;
      // Persist carrierCode for every order sharing this tracking number.
      // AliExpress bundled orders often share one waybill, so one successful probe covers the rest.
      const tn = order.trackingNumber;
      store.patchOrdersWhere(
        (o) => o.trackingNumber === tn && !o.carrierCode,
        { carrierCode: probeResult.carrierId }
      ).catch(() => {});
      return;
    }
    const result = await trackShipmentDetail(carrierCode, order.trackingNumber);
    state.detail = result;
    if (!result) state.error = "추적 정보를 찾을 수 없습니다.";
  } catch (e) {
    if (e instanceof TrackerCarrierNotSupported) {
      state.error = `지원되지 않는 캐리어: ${order.carrierCode ?? state.resolvedCarrierCode ?? "unknown"}`;
    } else {
      state.error = "조회 실패";
    }
  } finally {
    state.loading = false;
  }
}

export function renderDetailPanel(
  order: Order,
  opts: { international: boolean },
  customsBlock: string
): string {
  const fullTitleBar = `<div class="detail-title-bar">
    <div class="detail-title">${escapeHtml(order.displayName ?? "(상품명 없음)")}</div>
    <button class="collapse-btn icon-btn" title="접기" aria-label="접기">${CHEVRON_UP_SVG}</button>
  </div>`;
  if (!order.trackingNumber) {
    return `<div class="detail-panel">${fullTitleBar}<div class="detail-status">송장번호 없음</div></div>`;
  }
  const state = detailStates.get(order.id);
  if (!state || state.loading) return `<div class="detail-panel">${fullTitleBar}<div class="detail-status">조회 중…</div></div>`;
  if (state.error) return `<div class="detail-panel">${fullTitleBar}<div class="detail-status error">${escapeHtml(state.error)}</div></div>`;
  const detail = state.detail!;
  const carrierCode = order.carrierCode ?? state.resolvedCarrierCode ?? "";
  const carrierLabel = CARRIER_DISPLAY[carrierCode] ?? carrierCode;
  const intlCheckbox = `<label class="intl-toggle" title="해외 배송으로 간주하고 통관 진행을 조회합니다">
    <input type="checkbox" class="intl-check" data-order-id="${escapeHtml(order.id)}" ${opts.international ? "checked" : ""} />
    <span>해외</span>
  </label>`;
  const head = `<div class="detail-head">
    <span class="detail-carrier">${escapeHtml(carrierLabel)}</span>
    <button class="copy-btn" data-tracking="${escapeHtml(order.trackingNumber)}" title="송장번호 복사">
      ${COPY_SVG}<span>${escapeHtml(order.trackingNumber)}</span>
    </button>
    ${intlCheckbox}
  </div>`;
  if (detail.progresses.length === 0) {
    return `<div class="detail-panel">${fullTitleBar}${head}<div class="detail-status">이벤트 없음</div>${customsBlock}</div>`;
  }
  const rows = [...detail.progresses].reverse().map((p, i, arr) => {
    const last = i === arr.length - 1;
    return `
      <div class="tl-row ${last ? "last" : ""}">
        <span class="tl-dot stage-${escapeHtml(p.stage)}"></span>
        <div class="tl-body">
          <div class="tl-top">
            <span class="tl-time">${escapeHtml(formatDateTime(p.time))}</span>
            <span class="tl-stage stage-${escapeHtml(p.stage)}">${escapeHtml(STAGE_LABEL[p.stage])}</span>
          </div>
          <div class="tl-desc">${escapeHtml(p.description)}</div>
        </div>
      </div>
    `;
  }).join("");
  return `<div class="detail-panel">${fullTitleBar}${head}<div class="timeline">${rows}</div>${customsBlock}</div>`;
}
