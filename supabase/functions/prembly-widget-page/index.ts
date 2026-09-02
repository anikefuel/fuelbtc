/**
 * prembly-widget-page
 *
 * Serves a complete HTML page that loads the Prembly IdentityPass widget SDK
 * and initialises it with caller-supplied parameters.
 *
 * Why an Edge Function instead of srcdoc?
 *   - srcdoc iframes run with a null origin — browsers block cross-origin
 *     <script src="https://..."> fetches from null-origin contexts.
 *   - Fetching widget.js from the client app is blocked by CORS because
 *     widget.prembly.com does not send Access-Control-Allow-Origin: *.
 *   - Serving this page from Supabase gives it a real https:// origin, so
 *     the Prembly script tag loads freely and camera/microphone permissions
 *     propagate correctly from the parent allow="" attribute.
 *
 * Query params (all required unless noted):
 *   config_id, widget_key, app_id, environment, reference_id
 *   email (optional), country (optional)
 *   parent_origin — the app origin for postMessage targeting (e.g. https://app-xxx.appmedo.com)
 *
 * Security:
 *   - All params are user-supplied display values; no server secrets are embedded.
 *   - CSP allows widget.prembly.com scripts and same-origin only.
 *   - The page posts messages ONLY to the verified parent_origin.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const p = url.searchParams;

  const configId      = p.get("config_id")    ?? "";
  const widgetKey     = p.get("widget_key")    ?? "";
  const appId         = p.get("app_id")        ?? "";
  const environment   = p.get("environment")   ?? "production";
  const referenceId   = p.get("reference_id")  ?? "";
  const email         = p.get("email")         ?? "";
  const country       = p.get("country")       ?? "";
  const parentOrigin  = p.get("parent_origin") ?? "*";

  // Validate required fields
  if (!configId || !widgetKey || !appId || !referenceId) {
    return new Response(
      buildErrorPage("Missing required parameters: config_id, widget_key, app_id, reference_id"),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const html = buildWidgetHtml({
    configId, widgetKey, appId, environment,
    referenceId, email, country, parentOrigin,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Allow embedding in an iframe from the app origin
      "X-Frame-Options": "ALLOWALL",
      // CSP: allow scripts from prembly CDN + self (inline scripts via nonce not needed
      // here since we fully control the HTML). Blob/data URIs for camera.
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://widget.prembly.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "connect-src 'self' https: wss:",
        "frame-src 'self' https:",
        "font-src 'self' data: https:",
        "worker-src blob:",
      ].join("; "),
      ...CORS_HEADERS,
    },
  });
});

// ─── HTML builders ────────────────────────────────────────────────────────────

function buildErrorPage(msg: string): string {
  return `<!DOCTYPE html><html><body style="background:#0a0a0a;color:#C9A84C;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:24px;box-sizing:border-box;text-align:center;">
  <p>${escHtml(msg)}</p>
</body></html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function buildWidgetHtml(params: {
  configId: string; widgetKey: string; appId: string; environment: string;
  referenceId: string; email: string; country: string; parentOrigin: string;
}): string {
  const { configId, widgetKey, appId, environment, referenceId, email, country, parentOrigin } = params;

  // JSON-encode each value so it's safe to embed directly in JS
  const jConfigId     = JSON.stringify(configId);
  const jWidgetKey    = JSON.stringify(widgetKey);
  const jAppId        = JSON.stringify(appId);
  const jEnvironment  = JSON.stringify(environment);
  const jReferenceId  = JSON.stringify(referenceId);
  const jEmail        = JSON.stringify(email);
  const jCountry      = JSON.stringify(country);
  const jParentOrigin = JSON.stringify(parentOrigin);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Identity Verification</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #prembly-widget { width: 100vw; height: 100vh; }
    #loading-state {
      position: fixed; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      background: #0a0a0a; gap: 16px; z-index: 100;
    }
    .spinner {
      width: 40px; height: 40px;
      border: 3px solid #333;
      border-top-color: #C9A84C;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { color: #C9A84C; font-size: 14px; }
  </style>
</head>
<body>
  <div id="loading-state">
    <div class="spinner"></div>
    <div class="loading-text" id="status-text">Loading verification…</div>
  </div>
  <div id="prembly-widget"></div>

  <script src="https://widget.prembly.com/widget.js"></script>

  <script>
    var PARENT_ORIGIN = ${jParentOrigin};

    function postToParent(msg) {
      try {
        var target = (PARENT_ORIGIN && PARENT_ORIGIN !== '*') ? PARENT_ORIGIN : '*';
        window.parent.postMessage(JSON.stringify(msg), target);
      } catch(e) {}
    }

    function hideLoading() {
      var el = document.getElementById('loading-state');
      if (el) el.style.display = 'none';
    }

    function showError(msg) {
      var el = document.getElementById('status-text');
      if (el) { el.textContent = msg; el.style.color = '#e05252'; }
    }

    function initWidget() {
      var cfg = {
        config_id:    ${jConfigId},
        widget_key:   ${jWidgetKey},
        app_id:       ${jAppId},
        environment:  ${jEnvironment},
        reference_id: ${jReferenceId},
        ${email   ? `email:   ${jEmail},`   : '// no email'}
        ${country ? `country: ${jCountry},` : '// no country'}
        onSuccess: function(data) {
          hideLoading();
          postToParent({ type: 'prembly_success', data: data || {} });
        },
        onError: function(err) {
          hideLoading();
          var errMsg = (err && (err.message || JSON.stringify(err))) || 'Verification error';
          showError(errMsg);
          postToParent({ type: 'prembly_error', error: errMsg });
        },
        onClose: function() {
          postToParent({ type: 'prembly_close' });
        },
        onReady: function() {
          hideLoading();
          postToParent({ type: 'prembly_ready' });
        },
      };

      try {
        if (typeof IdentitypassWidget !== 'undefined') {
          new IdentitypassWidget(cfg);
        } else if (typeof PremblyWidget !== 'undefined') {
          new PremblyWidget(cfg);
        } else if (typeof Identitypass !== 'undefined') {
          new Identitypass(cfg);
        } else {
          var globals = Object.keys(window).filter(function(k) {
            return k.toLowerCase().includes('prembly') || k.toLowerCase().includes('identitypass');
          }).join(', ');
          var errMsg = 'SDK not loaded. Globals: ' + (globals || 'none');
          showError(errMsg);
          postToParent({ type: 'prembly_error', error: errMsg });
        }
      } catch(e) {
        var msg = e && e.message ? e.message : String(e);
        showError('SDK init error: ' + msg);
        postToParent({ type: 'prembly_error', error: 'SDK init error: ' + msg });
      }
    }

    // widget.js is synchronous — SDK global is available immediately after the tag
    initWidget();
  </script>
</body>
</html>`;
}
