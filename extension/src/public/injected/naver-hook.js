/**
 * fetch/XHR hook injected into Naver pages.
 *
 * The Naver Pay SPA ships only the first page in initial SSR
 * (__NEXT_DATA__). When the user scrolls or paginates, subsequent
 * pages arrive through `/orderApi/*` fetches. This hook intercepts
 * those responses and forwards them to the isolated-world content
 * script.
 *
 * MAIN-world injection cannot use chrome.*, so the bridge uses
 * postMessage.
 */

(function () {
  const TAG = "[ParcelDeck:naver-hook]";
  const MSG_TYPE = "PARCEL_HUB_NAVER_DATA";

  function post(url, data, error) {
    try {
      window.postMessage({ type: MSG_TYPE, payload: { url, data, error } }, window.location.origin);
    } catch (_) { /* noop */ }
  }

  function interesting(url) {
    return typeof url === "string" && /\/orderApi\//.test(url);
  }

  // URL observation helper was for pagination endpoint discovery; now identified. Noop.
  function noteUrl(_url) { /* intentionally empty */ }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url ? input.url : "";
      noteUrl(url);
      const p = origFetch.apply(this, arguments);
      if (!interesting(url)) return p;
      return p.then(function (res) {
        try {
          res.clone().text().then(function (t) {
            try {
              const parsed = JSON.parse(t);
              post(url, parsed);
            } catch (_) { /* empty response and similar cases */ }
          }).catch(function () { /* noop */ });
        } catch (_) { /* noop */ }
        return res;
      });
    };
  }

  const OrigXhr = window.XMLHttpRequest;
  if (OrigXhr) {
    const origOpen = OrigXhr.prototype.open;
    const origSend = OrigXhr.prototype.send;
    OrigXhr.prototype.open = function (method, url) {
      this.__ph_url = url;
      this.__ph_match = interesting(url);
      noteUrl(url);
      return origOpen.apply(this, arguments);
    };
    OrigXhr.prototype.send = function () {
      if (this.__ph_match) {
        const xhrUrl = this.__ph_url;
        this.addEventListener("load", function () {
          try {
            const parsed = JSON.parse(this.responseText);
            post(xhrUrl, parsed);
          } catch (_) { /* noop */ }
        });
      }
      return origSend.apply(this, arguments);
    };
  }

})();
