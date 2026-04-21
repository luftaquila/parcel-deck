import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  // Do not use the popup entrypoint as default_popup.
  // Clicking the icon lets the background script open a detached window via windows.create, so blur does not close it.
  hooks: {
    "build:manifestGenerated": (_, manifest) => {
      const m = manifest as { action?: Record<string, unknown>; browser_action?: Record<string, unknown> };
      if (m.action) delete m.action.default_popup;
      if (m.browser_action) delete m.browser_action.default_popup;
    },
  },
  manifest: {
    name: "ParcelDeck",
    description: "See shopping order, delivery, and customs status in one place. Works locally in your browser without a server.",
    icons: {
      16: "icon/16.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
    action: {
      default_title: "ParcelDeck",
      default_icon: {
        16: "icon/16.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    },
    // Firefox MV2 needs browser_action.default_icon explicitly.
    // WXT copies title/popup from action to browser_action but drops default_icon.
    browser_action: {
      default_title: "ParcelDeck",
      default_icon: {
        16: "icon/16.png",
        48: "icon/48.png",
        128: "icon/128.png",
      },
    },
    permissions: [
      "alarms",
      "cookies",
      "notifications",
      "storage",
      "tabs",
      "webNavigation",
    ],
    host_permissions: [
      "https://*.coupang.com/*",
      "https://*.naver.com/*",
      "https://*.aliexpress.com/*",
      "https://*.aliexpress.us/*",
      "https://unipass.customs.go.kr/*",
      "https://unipass.customs.go.kr:38010/*",
    ],
    web_accessible_resources: [
      {
        resources: ["injected/aliexpress-hook.js"],
        matches: [
          "https://*.aliexpress.com/*",
          "https://*.aliexpress.us/*",
          "https://ko.aliexpress.com/*",
        ],
      },
      {
        resources: ["injected/naver-hook.js"],
        matches: [
          "https://pay.naver.com/*",
        ],
      },
    ],
  },
});
