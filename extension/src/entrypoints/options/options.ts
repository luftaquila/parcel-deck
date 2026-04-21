import browser from "webextension-polyfill";
import { store } from "../../lib/store.js";
import { DAY_MS } from "../../lib/util.js";

let render: () => Promise<void>;

// Collection toggle.
async function sectionCollectToggle(): Promise<string> {
  const enabled = (await store.getSettings()).collectEnabled;
  return `
    <section class="section">
      <div class="section-head">
        <h2>수집 활성화</h2>
        <label class="toggle">
          <input type="checkbox" id="collect-enabled" ${enabled ? "checked" : ""} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="muted">비활성화시 자동 재수집·초기화 후 재수집·팝업 새로고침 등 모든 수집이 중단됩니다.</p>
    </section>
  `;
}

function wireCollectToggle() {
  const cb = document.getElementById("collect-enabled") as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener("change", async () => {
    await store.updateSettings({ collectEnabled: cb.checked });
    await render();
  });
}

// Retention window.
async function sectionWindow(): Promise<string> {
  const days = (await store.getSettings()).fetchWindowDays;
  return `
    <section class="section">
      <h2>수집 · 보관 기간</h2>
      <div class="row">
        <input type="number" id="fetch-window-days" min="1" max="3650" value="${days}" style="max-width:100px" />
        <span class="muted">일</span>
        <button id="save-fetch-window">저장</button>
      </div>
    </section>
  `;
}

function wireWindow() {
  const input = document.getElementById("fetch-window-days") as HTMLInputElement | null;
  if (!input) return;
  document.getElementById("save-fetch-window")?.addEventListener("click", async () => {
    const v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || v < 1) return alert("1일 이상으로 지정");
    await store.updateSettings({ fetchWindowDays: v });
    const cutoffMs = Date.now() - v * DAY_MS;
    const removed = await store.deleteOrdersOrderedBefore(cutoffMs);
    if (removed > 0) alert(`기간 밖 기존 주문 ${removed}건 삭제`);
    await render();
  });
}

// Customs settings (UNI-PASS).
async function sectionCustoms(): Promise<string> {
  const key = (await store.getSettings()).customs.unipassApiKey ?? "";
  return `
    <section class="section">
      <h2>통관 정보 (관세청 UNI-PASS)</h2>
      <p class="muted"><b>해외</b> 체크박스를 켠 주문에 대해 관세청 UNI-PASS 에서 통관 진행 이력을 조회합니다.</p>
      <div class="field">
        <label for="unipass-key">UNI-PASS API 키 (CRKY)</label>
        <div class="row">
          <input type="text" id="unipass-key" value="${escapeAttr(key)}" spellcheck="false" autocomplete="off" placeholder="unipass.customs.go.kr 에서 발급" />
          <button id="save-customs" class="primary">저장</button>
        </div>
        <div class="hint">
          키 발급 방법 (<a href="https://unipass.customs.go.kr/csp/index.do" target="_blank" rel="noreferrer noopener">unipass.customs.go.kr</a> 회원가입 필요):
          <ol class="hint-list">
            <li>MY메뉴 → 서비스관리 → OpenAPI 사용관리</li>
            <li>목록에서 <b>화물통관진행정보조회</b> 체크</li>
            <li><b>OPEN API 신청</b> 버튼 클릭</li>
            <li>신청 완료 후 목록의 서비스명을 다시 클릭</li>
            <li>하단 상세내역의 인증키 복사</li>
          </ol>
        </div>
      </div>
    </section>
  `;
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

function wireCustoms() {
  const keyInput = document.getElementById("unipass-key") as HTMLInputElement | null;
  const saveBtn = document.getElementById("save-customs") as HTMLButtonElement | null;
  if (!keyInput || !saveBtn) return;
  saveBtn.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    await store.updateSettings({
      customs: { unipassApiKey: key.length > 0 ? key : null },
    });
    await render();
  });
}

// Reset.
function sectionReset(): string {
  return `
    <section class="section danger">
      <h2>초기화</h2>
      <p>수집된 주문, 세션 상태 등 로컬 저장소의 모든 데이터를 제거하고 즉시 재수집합니다.</p>
      <div class="row">
        <button id="reset-all" class="danger">초기화</button>
      </div>
    </section>
  `;
}

function wireReset() {
  const btn = document.getElementById("reset-all") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("정말로 초기화하시겠습니까?")) return;
    await store.reset();
    // Trigger recollection immediately after data removal so the popup can show a spinner right away.
    browser.runtime.sendMessage({ type: "collect-all" }).catch(() => { /* ignore */ });
    await render();
  });
}

// Footer with the privacy policy link.
function sectionFooter(): string {
  return `
    <footer class="footer">
      <a href="https://github.com/luftaquila/parcel-deck/blob/main/docs/PRIVACY.md" target="_blank" rel="noreferrer noopener">개인정보처리방침</a>
      <span class="footer-sep">·</span>
      <a href="https://github.com/luftaquila/parcel-deck" target="_blank" rel="noreferrer noopener">GitHub</a>
    </footer>
  `;
}

// Main render.
render = async function () {
  const app = document.getElementById("app")!;
  app.innerHTML = [
    await sectionCollectToggle(),
    await sectionWindow(),
    await sectionCustoms(),
    sectionReset(),
    sectionFooter(),
  ].join("");
  wireCollectToggle();
  wireWindow();
  wireCustoms();
  wireReset();
};

render();
