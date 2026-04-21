import browser from "webextension-polyfill";
import type { MallId, SessionStatus } from "@parceldeck/shared";
import { MALL_CONFIGS, mallFromCookieDomain, mallFromUrl } from "./mall-config.js";
import { store, type SessionRecord } from "./store.js";

/**
 * Session state machine.
 *
 *   unknown ──probe ok──► authenticated ──cookie cleared──► expired
 *     │                    │  ▲   │                          │
 *     └─probe fail──► expired  │   └──login page visit──► refreshing
 *                       ▲       │                             │
 *                       │       └─cookies set & probe ok──────┘
 *                       │
 *                   N consecutive failures or 2FA detected → unsupported
 *
 * Key signals:
 *  - cookies.onChanged : auth cookie added/removed triggers transitions.
 *  - webNavigation     : detects entering/leaving the login page.
 *  - collector replies : 401/302/login page force a transition to expired.
 *
 * Every transition persists and runs in the background.
 */

const FAILURE_THRESHOLD_UNSUPPORTED = 5;
const PROBE_STALE_MS = 30 * 60 * 1000;

type Transition = { mall: MallId; from: SessionStatus; to: SessionStatus; reason: string };

const listeners = new Set<(t: Transition) => void>();
export function onSessionTransition(fn: (t: Transition) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function transition(mall: MallId, to: SessionStatus, reason: string) {
  const cur = await store.getSession(mall);
  if (cur.status === to) {
    await store.setSession(mall, { ...cur, lastProbedAt: Date.now() });
    return;
  }

  const next: SessionRecord = {
    status: to,
    lastProbedAt: Date.now(),
    lastChangedAt: Date.now(),
    failureCount: to === "authenticated" ? 0 : cur.failureCount + (to === "expired" ? 1 : 0),
    lastReason: reason,
  };

  if (to === "expired" && next.failureCount >= FAILURE_THRESHOLD_UNSUPPORTED) {
    next.status = "unsupported";
  }

  await store.setSession(mall, next);
  await updateBadge();

  for (const fn of listeners) fn({ mall, from: cur.status, to: next.status, reason });
}

/**
 * Checks whether an auth cookie exists. Even when Firefox Total Cookie
 * Protection prevents extension fetches from attaching cookies, the
 * browser.cookies API still reads the browser's actual cookie jar, so
 * it is a reliable login signal.
 */
async function hasAuthCookie(mall: MallId): Promise<boolean> {
  const cfg = MALL_CONFIGS[mall];
  for (const domain of cfg.authCookieDomains) {
    for (const name of cfg.authCookieNames) {
      const url = `https://${domain.replace(/^\./, "")}/`;
      try {
        const c = await browser.cookies.get({ url, name });
        if (c && c.value) return true;
      } catch { /* noop */ }
    }
  }
  return false;
}

/**
 * Probe — first check that the cookie exists, then hit the endpoint
 * only if needed. When the cookie is present we optimistically say
 * authenticated (sidestepping Firefox's cookie blocking on extension
 * fetches). Actual collection failures will then flip it to expired.
 */
export async function probeSession(mall: MallId): Promise<"authenticated" | "expired" | "unknown"> {
  const cfg = MALL_CONFIGS[mall];

  // No auth cookie → expired straight away.
  if (!(await hasAuthCookie(mall))) {
    await transition(mall, "expired", "no_auth_cookie");
    return "expired";
  }

  try {
    // Use redirect: "manual" so 302 redirects surface as opaqueredirect.
    const res = await fetch(cfg.probeUrl, {
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    // opaqueredirect can happen when the extension fetch lost its cookies
    // and the server sent a 302 to the login page. The cookie is confirmed
    // to exist, so stay authenticated; actual collection failures will
    // call markExpired later.
    if (res.type === "opaqueredirect" || res.status === 0) {
      await transition(mall, "authenticated", "probe_redirect_but_cookie_ok");
      return "authenticated";
    }

    if (res.status === 401 || res.status === 403) {
      await transition(mall, "expired", `http_${res.status}`);
      return "expired";
    }

    if (res.status >= 200 && res.status < 300) {
      await transition(mall, "authenticated", "probe_ok");
      return "authenticated";
    }

    return "unknown";
  } catch (e) {
    return "unknown";
  }
}

/**
 * cookies.onChanged handler. Auth cookie set/remove drives transitions.
 * - removed: re-probe after a short delay (rotation vs. real logout).
 * - added  : probe shortly after to confirm the login is live.
 */
export function installCookieListener() {
  browser.cookies.onChanged.addListener(async (changeInfo) => {
    const domain = changeInfo.cookie.domain;
    const mall = mallFromCookieDomain(domain);
    if (!mall) return;
    const cfg = MALL_CONFIGS[mall];
    if (!cfg.authCookieNames.includes(changeInfo.cookie.name)) return;

    if (changeInfo.removed) {
      // Could be a secondary cookie rotating — do not flip to expired instantly.
      // Re-probe after 1.5s to see the real state.
      setTimeout(() => { probeSession(mall).catch(() => {}); }, 1500);
    } else {
      // New cookie → user might have just logged in. Wait 1s for propagation then probe.
      setTimeout(() => { probeSession(mall).catch(() => {}); }, 1000);
    }
  });
}

/**
 * Detects entering / leaving the login page.
 * - login page visit    → refreshing.
 * - mall page afterwards → probe.
 */
export function installNavigationListener() {
  browser.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId !== 0) return;
    const url = details.url;
    const mall = mallFromUrl(url);
    if (!mall) {
      // The login page may not be caught by mallFromUrl; fall back to loginPageRegex.
      for (const cfg of Object.values(MALL_CONFIGS)) {
        if (cfg.loginPageRegex.test(url)) {
          const cur = await store.getSession(cfg.id);
          if (cur.status !== "refreshing") {
            await transition(cfg.id, "refreshing", "login_page_visit");
          }
          return;
        }
      }
      return;
    }
    // Landed on a mall page — opportunistic probe.
    const cur = await store.getSession(mall);
    const stale = !cur.lastProbedAt || Date.now() - cur.lastProbedAt > PROBE_STALE_MS;
    if (stale || cur.status === "refreshing" || cur.status === "expired") {
      probeSession(mall).catch(() => {});
    }
  });
}

/**
 * Called by collectors that detected 401 or the login page mid-request.
 */
export async function markExpired(mall: MallId, reason: string) {
  await transition(mall, "expired", reason);
}

export async function markAuthenticated(mall: MallId) {
  await transition(mall, "authenticated", "collector_ok");
}

export async function markUnsupported(mall: MallId, reason: string) {
  const cur = await store.getSession(mall);
  await store.setSession(mall, { ...cur, status: "unsupported", lastReason: reason, lastChangedAt: Date.now() });
  await updateBadge();
}

/**
 * Badge — shows the number of malls that need re-login.
 * Chrome MV3 uses browser.action; Firefox MV2 uses browser.browserAction.
 */
async function updateBadge() {
  const all = await store.getAllSessions();
  const needsLogin = Object.values(all).filter((s) => s?.status === "expired" || s?.status === "unsupported").length;
  const action = (browser as any).action ?? (browser as any).browserAction;
  if (!action) return;
  await action.setBadgeText({ text: needsLogin > 0 ? String(needsLogin) : "" });
  await action.setBadgeBackgroundColor({ color: "#d32f2f" });
}

export async function initSessionMonitor() {
  installCookieListener();
  installNavigationListener();
  await updateBadge();
}
