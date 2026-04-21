import type { CustomsProgress, Order } from "@parceldeck/shared";
import { CustomsApiError, probeCustomsCached } from "../../lib/customs.js";
import { CUSTOMS_STAGE_LABEL, escapeHtml, formatDateTime } from "./utils.js";

/**
 * Customs progress panel for the UNI-PASS timeline.
 * Keeps per-order UI state in a module-scope Map.
 */

type CustomsErrorKind = "no-key" | "api" | "network" | "empty";
export type CustomsState = {
  loading: boolean;
  progress: CustomsProgress | null;
  error: CustomsErrorKind | null;
  errorMsg?: string;
};

export const customsStates = new Map<string, CustomsState>();

export async function loadCustoms(order: Order, apiKey: string): Promise<void> {
  if (!order.trackingNumber) return;
  const state: CustomsState = { loading: true, progress: null, error: null };
  customsStates.set(order.id, state);
  try {
    const progress = await probeCustomsCached({
      trackingNumber: order.trackingNumber,
      unipassApiKey: apiKey,
    });
    state.progress = progress;
    if (!progress) state.error = "empty";
  } catch (e) {
    if (e instanceof CustomsApiError) {
      state.error = e.code === "no-key" ? "no-key" : "api";
      state.errorMsg = e.message;
    } else {
      state.error = "network";
      state.errorMsg = (e as Error).message ?? "network error";
    }
  } finally {
    state.loading = false;
  }
}

export function renderCustomsPanel(order: Order, apiKeySet: boolean): string {
  const state = customsStates.get(order.id);
  if (!apiKeySet) {
    return `<div class="customs-section">
      <div class="customs-hint">
        UNI-PASS API 키 미설정 — <button class="customs-open-options link-btn" type="button">설정 열기</button>
      </div>
    </div>`;
  }
  if (!state || state.loading) {
    return `<div class="customs-section">
      <div class="customs-hint">조회 중…</div>
    </div>`;
  }
  if (state.error === "empty") {
    return `<div class="customs-section">
      <div class="customs-hint">통관 기록 없음</div>
    </div>`;
  }
  if (state.error) {
    const msg = state.error === "api"
      ? `조회 실패: ${state.errorMsg ?? "UNI-PASS 오류"}`
      : "통관 조회 실패";
    return `<div class="customs-section">
      <div class="customs-hint error">${escapeHtml(msg)} <button class="customs-retry link-btn" type="button" data-order-id="${escapeHtml(order.id)}">재시도</button></div>
    </div>`;
  }
  const progress = state.progress!;
  if (progress.events.length === 0) {
    return `<div class="customs-section">
      <div class="customs-hint">통관 기록 없음</div>
    </div>`;
  }
  const rows = [...progress.events].reverse().map((e, i, arr) => {
    const last = i === arr.length - 1;
    const loc = e.location ? `<span class="tl-loc">${escapeHtml(e.location)}</span>` : "";
    return `
      <div class="tl-row ${last ? "last" : ""}">
        <span class="tl-dot customs-dot cstage-${escapeHtml(e.stage)}"></span>
        <div class="tl-body">
          <div class="tl-top">
            <span class="tl-time">${escapeHtml(formatDateTime(e.time))}</span>
            <span class="tl-stage cstage-${escapeHtml(e.stage)}">${escapeHtml(CUSTOMS_STAGE_LABEL[e.stage])}</span>
          </div>
          <div class="tl-desc">${escapeHtml(e.description)}${loc}</div>
        </div>
      </div>
    `;
  }).join("");
  const meta: string[] = [];
  if (progress.cargMtNo) meta.push(`화물관리번호 ${escapeHtml(progress.cargMtNo)}`);
  if (progress.hsCode) meta.push(`HS ${escapeHtml(progress.hsCode)}`);
  const metaHtml = meta.length > 0 ? `<div class="customs-meta">${meta.join(" · ")}</div>` : "";
  return `<div class="customs-section">
    <div class="timeline customs-timeline">${rows}</div>
    ${metaHtml}
  </div>`;
}
