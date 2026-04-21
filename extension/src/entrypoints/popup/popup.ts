import browser from "webextension-polyfill";
import type { MallId, Order, SessionStatus, ShipmentStage } from "@parceldeck/shared";
import { MALL_CONFIGS } from "../../lib/mall-config.js";
import { store, type SortMode } from "../../lib/store.js";
import { DAY_MS } from "../../lib/util.js";
import {
  CARRIER_DISPLAY,
  CHECK_SVG,
  COPY_SVG,
  STAGE_LABEL,
  escapeHtml,
} from "./utils.js";
import {
  detailStates,
  loadDetail,
  openDetails,
  renderDetailPanel,
} from "./detail-panel.js";
import {
  customsStates,
  loadCustoms,
  renderCustomsPanel,
} from "./customs-panel.js";

const STATUS_LABEL: Record<SessionStatus, string> = {
  unknown: "확인 중",
  authenticated: "연결됨",
  expired: "로그인 필요",
  refreshing: "로그인 중",
  unsupported: "수집 불가",
};

// Sort priority: active -> waiting -> delivered -> issue.
const STAGE_ORDER: Record<ShipmentStage, number> = {
  out_for_delivery: 0,
  in_transit: 1,
  at_pickup: 2,
  information_received: 3,
  pending: 4,
  unknown: 5,
  exception: 6,
  delivered: 7,
};

// Real brand logos for each mall, bundled from src/public/mall-icons/ (Wikimedia / simple-icons CC0).
const MALL_ICON_URL: Record<MallId, string> = {
  naver: "mall-icons/naver.svg",
  coupang: "mall-icons/coupang.png",
  aliexpress: "mall-icons/aliexpress.png",
};

// Header settings icon (feather gear).
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

// Refresh icon (Lucide rotate-cw).
const REFRESH_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;

// Search-box state preserved only within the popup session.
let searchQuery = "";

function orderMatchesQuery(o: Order, q: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const mallLabel = MALL_CONFIGS[o.mall]?.label ?? o.mall;
  const carrierLabel = o.carrierCode ? (CARRIER_DISPLAY[o.carrierCode] ?? o.carrierCode) : "";
  const hay = [
    o.mall,
    mallLabel,
    o.displayName ?? "",
    o.trackingNumber ?? "",
    o.carrierCode ?? "",
    carrierLabel,
  ].join(" ").toLowerCase();
  return hay.includes(needle);
}

function mallVisible(settings: { mallFilter: Partial<Record<MallId, boolean>> }, mall: MallId): boolean {
  const v = settings.mallFilter[mall];
  return v === undefined ? true : v;
}

function sortOrders(orders: Order[], mode: SortMode): Order[] {
  const arr = [...orders];
  if (mode === "stage") {
    arr.sort((a, b) => {
      const sa = STAGE_ORDER[a.stage];
      const sb = STAGE_ORDER[b.stage];
      if (sa !== sb) return sa - sb;
      return b.orderedAt.localeCompare(a.orderedAt);
    });
  } else {
    arr.sort((a, b) => b.orderedAt.localeCompare(a.orderedAt));
  }
  return arr;
}

/** Whether an order is treated as international by default when no override exists. */
function defaultInternational(order: Order): boolean {
  return order.mall === "aliexpress";
}

function isInternational(
  order: Order,
  overrides: Record<string, { international?: boolean }>
): boolean {
  const ov = overrides[order.id]?.international;
  if (ov === true || ov === false) return ov;
  return defaultInternational(order);
}

function renderOrderDetail(
  order: Order,
  opts: { international: boolean; apiKeySet: boolean }
): string {
  const customsBlock = opts.international ? renderCustomsPanel(order, opts.apiKeySet) : "";
  return renderDetailPanel(order, { international: opts.international }, customsBlock);
}

async function render() {
  const app = document.getElementById("app")!;
  const prevScroll = app.querySelector<HTMLElement>(".orders")?.scrollTop ?? 0;
  const prevSearch = document.getElementById("order-search") as HTMLInputElement | null;
  const searchHadFocus = prevSearch !== null && document.activeElement === prevSearch;
  const searchSelStart = prevSearch?.selectionStart ?? null;
  const searchSelEnd = prevSearch?.selectionEnd ?? null;
  const settings = await store.getSettings();

  const children: Node[] = [];

  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `
    <h1>ParcelDeck</h1>
    <div class="header-actions">
      <select id="sort-mode" class="sort-select" title="정렬">
        <option value="time" ${settings.sortMode === "time" ? "selected" : ""}>시간순</option>
        <option value="stage" ${settings.sortMode === "stage" ? "selected" : ""}>배송상태별</option>
      </select>
      <button id="refresh-collect" class="icon-btn" title="재수집" aria-label="재수집">${REFRESH_SVG}</button>
      <button id="open-options" class="icon-btn" title="설정" aria-label="설정">${GEAR_SVG}</button>
    </div>
  `;
  header.querySelector("#open-options")!.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });
  const refreshBtn = header.querySelector<HTMLButtonElement>("#refresh-collect")!;
  refreshBtn.addEventListener("click", async () => {
    if (refreshBtn.classList.contains("spinning")) return;
    refreshBtn.classList.add("spinning");
    refreshBtn.disabled = true;
    try {
      await browser.runtime.sendMessage({ type: "collect-all" });
    } catch (e) {
      console.warn("[ParcelDeck popup] recollection failed", e);
    } finally {
      refreshBtn.classList.remove("spinning");
      refreshBtn.disabled = false;
      runRender();
    }
  });
  header.querySelector<HTMLSelectElement>("#sort-mode")!.addEventListener("change", async (ev) => {
    const v = (ev.target as HTMLSelectElement).value as SortMode;
    await store.updateSettings({ sortMode: v });
    runRender();
  });
  children.push(header);

  // Mall chips: checkbox plus brand icon. Clicking the icon opens that mall's order page.
  const sessions = await store.getAllSessions();
  const collecting = await store.getCollectingMap();
  const sessionRow = document.createElement("div");
  sessionRow.className = "sessions";
  for (const mall of Object.keys(MALL_CONFIGS) as MallId[]) {
    const rec = sessions[mall];
    const status = rec?.status ?? "unknown";
    const isCollecting = !!collecting[mall];
    const checked = mallVisible(settings, mall);
    const chip = document.createElement("span");
    chip.className = `mall-chip ${status}${isCollecting ? " collecting" : ""}`;
    chip.dataset.mall = mall;
    chip.dataset.tooltip = `${MALL_CONFIGS[mall].label} · ${isCollecting ? "수집 중…" : STATUS_LABEL[status]}`;
    // Keep the spin phase continuous across rerenders by syncing the animation timeline with a negative delay.
    if (isCollecting) chip.style.setProperty("--spin-offset", `-${Date.now() % 1200}ms`);
    chip.innerHTML = `
      <input type="checkbox" class="mall-check" ${checked ? "checked" : ""} title="표시 여부" />
      <img class="mall-icon" src="${browser.runtime.getURL(MALL_ICON_URL[mall])}"
           alt="${escapeHtml(MALL_CONFIGS[mall].label)}"
           title="${escapeHtml(MALL_CONFIGS[mall].label)} 주문 페이지 열기" />
    `;
    chip.querySelector<HTMLInputElement>(".mall-check")!.addEventListener("change", async (ev) => {
      const next: Partial<Record<MallId, boolean>> = { ...settings.mallFilter };
      next[mall] = (ev.target as HTMLInputElement).checked;
      await store.updateSettings({ mallFilter: next });
      runRender();
    });
    chip.querySelector<HTMLImageElement>(".mall-icon")!.addEventListener("click", () => {
      browser.tabs.create({ url: MALL_CONFIGS[mall].probeUrl });
    });
    sessionRow.appendChild(chip);
  }
  children.push(sessionRow);

  // Search box
  const searchRow = document.createElement("div");
  searchRow.className = "search-row";
  searchRow.innerHTML = `
    <input type="search" id="order-search" class="search-input"
      placeholder="검색 (쇼핑몰·상품명·송장·택배사)"
      value="${escapeHtml(searchQuery)}" />
  `;
  const searchInput = searchRow.querySelector<HTMLInputElement>("#order-search")!;
  // While an IME composition is active, defer all rerenders including storage.onChanged.
  searchInput.addEventListener("compositionstart", () => { searchComposing = true; });
  searchInput.addEventListener("compositionend", () => {
    searchComposing = false;
    searchQuery = searchInput.value;
    if (renderDeferred) {
      renderDeferred = false;
      runRender();
    } else {
      runRender();
    }
  });
  searchInput.addEventListener("input", () => {
    if (searchComposing) return;
    searchQuery = searchInput.value;
    runRender();
  });
  children.push(searchRow);

  // Order list
  let orders: Order[] = [];
  let loadFailed = false;
  try {
    orders = await store.listOrders();
  } catch {
    loadFailed = true;
  }

  const overrides = await store.getAllOrderOverrides();
  const customsApiKey = settings.customs.unipassApiKey ?? "";
  const customsApiKeySet = customsApiKey.length > 0;

  // Clean up state for deleted orders to avoid orphan entries after retention cleanup, resets, or logout.
  const liveIds = new Set(orders.map((o) => o.id));
  for (const id of detailStates.keys()) if (!liveIds.has(id)) detailStates.delete(id);
  for (const id of customsStates.keys()) if (!liveIds.has(id)) customsStates.delete(id);
  for (const id of openDetails) if (!liveIds.has(id)) openDetails.delete(id);

  let restoreTarget: HTMLElement | null = null;

  if (loadFailed) {
    const err = document.createElement("div");
    err.className = "empty";
    err.textContent = "주문 목록 로드 실패";
    children.push(err);
  } else {
    const now = Date.now();
    const fetchWindowMs = settings.fetchWindowDays * DAY_MS;
    const DELIVERED_HIDE_MS = 3 * DAY_MS;

    const visible = sortOrders(
      orders.filter((o) => {
        if (!mallVisible(settings, o.mall)) return false;
        const orderedAtMs = Date.parse(o.orderedAt);
        if (Number.isFinite(orderedAtMs) && now - orderedAtMs > fetchWindowMs) return false;
        if (o.stage === "delivered") {
          const ts = Date.parse(o.updatedAt);
          if (!Number.isFinite(ts) ? false : now - ts >= DELIVERED_HIDE_MS) return false;
        }
        if (!orderMatchesQuery(o, searchQuery)) return false;
        return true;
      }),
      settings.sortMode,
    );

    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "표시할 주문이 없습니다.";
      children.push(empty);
    } else {
      const ul = document.createElement("ul");
      ul.className = "orders";
      visible.forEach((o, idx) => {
        const li = document.createElement("li");
        li.className = "order clickable";
        if (openDetails.has(o.id)) li.classList.add("open");

        const hasTracking = !!o.trackingNumber;
        const title = o.displayName ?? "(상품명 없음)";
        const dateStr = o.orderedAt.slice(0, 10);
        const carrierName = o.carrierCode ? (CARRIER_DISPLAY[o.carrierCode] ?? o.carrierCode) : null;
        const metaParts = [carrierName, o.trackingNumber].filter((v): v is string => !!v);
        const tracking = metaParts.length > 0 ? ` · ${escapeHtml(metaParts.join(" "))}` : "";

        const iconUrl = browser.runtime.getURL(MALL_ICON_URL[o.mall]);
        const detailOpts = { international: isInternational(o, overrides), apiKeySet: customsApiKeySet };
        li.innerHTML = `
          <div class="order-row">
            <span class="order-idx">${idx + 1}.</span>
            <img class="order-mall-icon" src="${iconUrl}" alt="${escapeHtml(MALL_CONFIGS[o.mall].label)}" />
            <span class="order-title">${escapeHtml(title)}</span>
            <span class="stage ${escapeHtml(o.stage)}">${escapeHtml(STAGE_LABEL[o.stage])}</span>
          </div>
          <div class="order-meta">${escapeHtml(dateStr)}${tracking}</div>
          ${openDetails.has(o.id) ? renderOrderDetail(o, detailOpts) : ""}
        `;

        // Auto-load customs data if the card is open, treated as international, and not fetched yet.
        if (
          openDetails.has(o.id)
          && detailOpts.international
          && customsApiKeySet
          && !!o.trackingNumber
          && !customsStates.has(o.id)
        ) {
          loadCustoms(o, customsApiKey).then(() => runRender());
        }

        li.addEventListener("click", async (ev) => {
          const target = ev.target as Element;
          const copyBtn = target.closest<HTMLButtonElement>(".copy-btn");
          if (copyBtn) {
            ev.stopPropagation();
            const trackingNo = copyBtn.dataset.tracking ?? "";
            await navigator.clipboard.writeText(trackingNo);
            copyBtn.classList.add("copied");
            copyBtn.innerHTML = `${CHECK_SVG}<span>${escapeHtml(trackingNo)}</span>`;
            setTimeout(() => {
              copyBtn.classList.remove("copied");
              copyBtn.innerHTML = `${COPY_SVG}<span>${escapeHtml(trackingNo)}</span>`;
            }, 1500);
            return;
          }
          // Toggle the "international" checkbox, persist the override, and fetch customs when needed.
          const intlCheck = target.closest<HTMLInputElement>(".intl-check");
          if (intlCheck) {
            ev.stopPropagation();
            const nowChecked = intlCheck.checked;
            await store.setOrderOverride(o.id, { international: nowChecked });
            if (!nowChecked) customsStates.delete(o.id);
            runRender();
            if (nowChecked && customsApiKeySet && o.trackingNumber && !customsStates.has(o.id)) {
              await loadCustoms(o, customsApiKey);
              runRender();
            }
            return;
          }
          // Retry customs lookup.
          if (target.closest(".customs-retry")) {
            ev.stopPropagation();
            if (!customsApiKeySet || !o.trackingNumber) return;
            customsStates.delete(o.id);
            runRender();
            await loadCustoms(o, customsApiKey);
            runRender();
            return;
          }
          // Open customs settings when the API key is missing.
          if (target.closest(".customs-open-options")) {
            ev.stopPropagation();
            browser.runtime.openOptionsPage();
            return;
          }
          // Collapse button inside the card.
          if (target.closest(".collapse-btn")) {
            ev.stopPropagation();
            openDetails.delete(o.id);
            runRender();
            return;
          }
          // Do not toggle when clicking inside the detail panel; preserve text selection and button interaction.
          if (target.closest(".detail-panel")) return;
          // Clicking order-row / order-meta toggles the card.
          if (openDetails.has(o.id)) {
            openDetails.delete(o.id);
            runRender();
            return;
          }
          openDetails.add(o.id);
          const willProbeCustoms = detailOpts.international && customsApiKeySet && !!o.trackingNumber && !customsStates.has(o.id);
          if (hasTracking && !detailStates.has(o.id)) {
            detailStates.set(o.id, { loading: true, detail: null, error: null });
            runRender();
            await loadDetail(o);
            runRender();
          } else {
            runRender();
          }
          if (willProbeCustoms) {
            await loadCustoms(o, customsApiKey);
            runRender();
          }
        });
        ul.appendChild(li);
      });
      children.push(ul);
      restoreTarget = ul;
    }
  }

  // Replacing the whole app while the search box is focused detaches and reattaches the input,
  // which breaks IME composition. While focused, swap only the orders section.
  if (searchHadFocus && app.querySelector(".search-row") !== null) {
    const oldOrdersSection = app.querySelector(".orders, .empty");
    const newOrdersSection = children.find((c): c is HTMLElement =>
      c instanceof HTMLElement && (c.classList.contains("orders") || c.classList.contains("empty"))
    );
    if (oldOrdersSection && newOrdersSection) {
      oldOrdersSection.replaceWith(newOrdersSection);
      if (restoreTarget === newOrdersSection && prevScroll > 0) newOrdersSection.scrollTop = prevScroll;
      return;
    }
    // Fallback: replace the whole tree and then restore focus.
  }

  app.replaceChildren(...children);
  if (restoreTarget && prevScroll > 0) restoreTarget.scrollTop = prevScroll;
  if (searchHadFocus) {
    const next = document.getElementById("order-search") as HTMLInputElement | null;
    if (next) {
      next.focus();
      if (searchSelStart !== null && searchSelEnd !== null) {
        try { next.setSelectionRange(searchSelStart, searchSelEnd); } catch { /* ignore */ }
      }
    }
  }
}

// Reentrancy guard: keep storage.onChanged storms to one render at a time.
let rendering = false;
let renderAgain = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Defer every rerender during IME composition, including storage.onChanged.
// DOM replacement interrupts the composition session.
let searchComposing = false;
let renderDeferred = false;

async function runRender() {
  if (searchComposing) {
    renderDeferred = true;
    return;
  }
  if (rendering) {
    renderAgain = true;
    return;
  }
  rendering = true;
  try {
    await render();
  } finally {
    rendering = false;
    if (renderAgain) {
      renderAgain = false;
      runRender();
    }
  }
}

function scheduleRender() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runRender();
  }, 1000);
}

runRender();
browser.storage.onChanged.addListener(scheduleRender);
