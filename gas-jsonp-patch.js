/* ================================================================
 * gas-jsonp-patch.js
 * ----------------------------------------------------------------
 * Drop-in patch that monkey-patches window.fetch() to route Google
 * Apps Script GET requests via JSONP (script-tag injection) instead
 * of fetch(). Bypasses the cross-origin redirect quirk where
 * script.google.com → script.googleusercontent.com sometimes returns
 * a 404 from the browser fetch path (caused by tightening SameSite /
 * third-party cookie restrictions in modern browsers).
 *
 * USAGE
 *   1. Drop this file into the repo alongside index.html
 *   2. Add a script tag in index.html, before any code that calls
 *      the Apps Script web app:
 *        <script src="gas-jsonp-patch.js"></script>
 *   3. Make sure the Apps Script backend supports JSONP — it must
 *      detect the `callback` query parameter and wrap responses as
 *      `<callback>(<json>);` with MIME type JAVASCRIPT.
 *      (The updated Code.gs in this repo handles this automatically.)
 *
 * BEHAVIOUR
 *   - Only intercepts GET requests to https://script.google.com/macros/s/…
 *   - Non-Apps-Script fetches pass through to the original fetch()
 *   - POSTs pass through unchanged (JSONP can't carry a body)
 *   - Returns a fetch-compatible Promise resolving to a Response-like
 *     object with { ok, status, json(), text() } so existing fetch
 *     call sites don't need to be rewritten.
 *
 * Safe to load multiple times — guards against double-patching.
 * ================================================================ */

(function () {
  'use strict';

  if (window.__gasJsonpPatched) {
    console.log('[GasJsonpPatch] Already loaded — skipping');
    return;
  }
  window.__gasJsonpPatched = true;

  var SCRIPT_PREFIX = 'https://script.google.com/macros/s/';
  var TIMEOUT_MS    = 60000;
  var originalFetch = window.fetch.bind(window);

  /**
   * Performs a JSONP request: appends &callback=<name> to the URL,
   * injects a <script> tag, and resolves when the callback fires.
   */
  function jsonpRequest(url) {
    return new Promise(function (resolve, reject) {
      var cbName = '__gascb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var sep    = url.indexOf('?') === -1 ? '?' : '&';
      var fullUrl = url + sep + 'callback=' + cbName;
      var script  = document.createElement('script');
      var settled = false;
      var timeoutId;

      function cleanup() {
        settled = true;
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (timeoutId) clearTimeout(timeoutId);
      }

      window[cbName] = function (data) {
        if (settled) return;
        cleanup();
        // Build a Response-shaped object so existing fetch() callers
        // (e.g. `const res = await fetch(...); const json = await res.json();`)
        // continue to work without modification.
        resolve({
          ok        : true,
          status    : 200,
          statusText: 'OK (via JSONP)',
          json      : function () { return Promise.resolve(data); },
          text      : function () { return Promise.resolve(JSON.stringify(data)); },
        });
      };

      script.onerror = function () {
        if (settled) return;
        cleanup();
        reject(new Error('JSONP request failed (script load error): ' + url.slice(0, 120) + '…'));
      };

      timeoutId = setTimeout(function () {
        if (settled) return;
        cleanup();
        reject(new Error('JSONP request timed out after ' + (TIMEOUT_MS / 1000) + 's'));
      }, TIMEOUT_MS);

      script.src = fullUrl;
      (document.head || document.documentElement).appendChild(script);
    });
  }

  /**
   * Patched fetch — intercepts GET requests to the Apps Script web app
   * and routes them through JSONP. Everything else falls through.
   */
  window.fetch = function (input, init) {
    var url    = (typeof input === 'string') ? input : (input && input.url) || '';
    var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    if (url.indexOf(SCRIPT_PREFIX) === 0 && method === 'GET') {
      return jsonpRequest(url).catch(function (err) {
        console.warn('[GasJsonpPatch] JSONP failed, falling back to native fetch:', err.message);
        return originalFetch(input, init);
      });
    }

    return originalFetch(input, init);
  };

  console.log('[GasJsonpPatch] Loaded — Apps Script GETs now use JSONP');
})();
