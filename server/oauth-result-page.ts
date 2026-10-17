const APP_RETURN_URL = 'stashbase://oauth-complete';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

export function oauthResultPage({
  title,
  message,
  kind = 'success',
  autoReturn = false,
  returnStatusUrl,
  returnIntentUrl,
}: {
  title: string;
  message: string;
  kind?: 'success' | 'error';
  autoReturn?: boolean;
  returnStatusUrl?: string;
  returnIntentUrl?: string;
}): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const returnStatusJson = JSON.stringify(returnStatusUrl ?? '').replace(/</g, '\\u003c');
  const returnIntentJson = JSON.stringify(returnIntentUrl ?? '').replace(/</g, '\\u003c');
  const isSuccess = kind === 'success';
  // Lucide geometry at the renderer's own stroke weight, so the glyph is the
  // same drawing the app would make: `check` for the result, `circle-alert`
  // for the failure.
  // It sits in a soft disc, so the result reads as one mark rather than a
  // hairline floating over the title.
  const icon = isSuccess
    ? '<span class="result-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>'
    : '<span class="result-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 6v7.5M12 17.5h.01"/></svg></span>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${safeTitle}</title>
  <style>
    /* This page is served by the local server and opened in the user's own
     * browser, so it cannot consume the renderer's CSS token layer. Every
     * value below is a hand copy of renderer/src/globals.css: the surface and
     * ink ladders, the 12% hairline, the shadow recipe for a level-3 floating
     * surface, the 12/13/16px type roles, the 36px control with its 16px
     * corner, the 80ms colour step, and the focus ring. Light values are
     * declared first and the dark scheme overrides them, rather than the
     * app's light-dark(), because the hosting browser is not Electron's
     * Chromium. Keep this block equal to the token layer when it moves.
     *
     * Colour carries meaning only: the failure mark is destructive red, and
     * nothing else on the page leaves the monochrome ramp except the mark's
     * own fixed frame grey and the focus ring. */
    :root {
      color-scheme: light;
      --background: #fafafa;
      --surface: #ffffff;
      --foreground: #171717;
      --muted-foreground: #737373;
      /* Mixed from the ink, so it re-resolves on its own under the dark
         scheme below. */
      --border: color-mix(in oklab, var(--foreground) 12%, transparent);
      --destructive: #ef4444;
      --focus-ring: #6b97ff;
      --brand-frame: #a3a3a3;
      --hairline: 1px;
      --motion-fast: 80ms;
      --shadow-color: rgb(0 0 0 / 0.06);
      --surface-shadow:
        0 0 0 var(--hairline) var(--shadow-color), 0 1px 1px -0.5px var(--shadow-color),
        0 3px 3px -1.5px var(--shadow-color);
      font-family: 'Inter Variable', Inter, system-ui, -apple-system, 'PingFang SC',
        'Hiragino Sans', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --background: #171717;
        --surface: #252525;
        --foreground: #f5f5f5;
        --muted-foreground: #a3a3a3;
        --destructive: #f87171;
        --surface-shadow:
          inset 0 1px 0 0 rgba(255, 255, 255, 0.02),
          inset 0 0 0 var(--hairline) rgba(255, 255, 255, 0.02),
          0 0 0 var(--hairline) rgba(0, 0, 0, 0.12), 0 1px 1px -0.5px rgba(0, 0, 0, 0.18),
          0 3px 3px -1.5px rgba(0, 0, 0, 0.18);
      }
    }

    /* One device pixel on hi-DPI panels, as in the token layer. */
    @media (min-resolution: 1.5dppx) {
      :root { --hairline: 0.5px; }
    }

    * { box-sizing: border-box; corner-shape: squircle; }
    body {
      margin: 0; min-width: 280px; min-height: 100vh;
      color: var(--foreground); background: var(--background);
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 32px 20px; }
    .stack { width: min(100%, 400px); text-align: center; }
    .brand { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 13px; font-weight: 600; font-variation-settings: 'wght' 600; }
    .brand-mark { display: grid; place-items: center; width: 20px; height: 20px; }
    .brand-mark svg { width: 20px; height: 20px; }
    /* A card is a level-3 surface: the shadow's first layer is the hairline
       edge, so the card draws no border of its own. */
    .card { padding: 24px; border-radius: 32px; background: var(--surface); box-shadow: var(--surface-shadow); }
    .result-mark {
      display: grid; place-items: center; width: 36px; height: 36px; margin: 4px auto 14px; border-radius: 50%;
      background: color-mix(in oklab, ${isSuccess ? 'var(--foreground) 6%' : 'var(--destructive) 12%'}, transparent);
    }
    .result-mark svg { width: 18px; height: 18px; fill: none; stroke: ${isSuccess ? 'currentColor' : 'var(--destructive)'}; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    h1 { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 700; font-variation-settings: 'wght' 700; }
    .message { margin: 6px 0 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
    /* The status and the button follow the message directly: a rule between
       them read as a second, unrelated notice. */
    .return-area { margin-top: 16px; }
    /* The live region holds its line once it has something to say, so later
       status changes do not move the button. Before the first one it
       collapses, so the failure card is not a gap under its own rule. */
    .status { min-height: 18px; margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.5; }
    .status:empty { min-height: 0; }
    /* The 36px control: 16px corner, 16px lead padding, 10px beside a
       trailing glyph, 13px label at the body weight. */
    .button {
      display: inline-flex; height: 36px; align-items: center; justify-content: center; gap: 6px;
      margin-top: 12px; padding: 0 10px 0 16px; border-radius: 16px;
      color: var(--background); background: var(--foreground);
      font-size: 13px; text-decoration: none;
      transition: background-color var(--motion-fast) ease;
    }
    .button:hover { background: color-mix(in oklab, var(--foreground) 84%, var(--background)); }
    .button:active { background: color-mix(in oklab, var(--foreground) 78%, var(--background)); }
    .button:focus-visible { outline: 1px solid var(--focus-ring); outline-offset: 1px; }
    .button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    [hidden] { display: none !important; }
    @media (prefers-reduced-motion: reduce) { .button { transition: none; } }
  </style>
</head>
<body>
  <main class="shell">
    <div class="stack">
      <!-- The product mark: a fixed grey frame behind an ink S, the ink side
           following the page's own scheme. -->
      <div class="brand"><span class="brand-mark"><svg viewBox="0 0 512 512" fill="none" aria-hidden="true"><g stroke="var(--brand-frame)" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"><path d="M104 210 L104 321.1 A24 24 0 0 0 116.1 342 L216.9 399.7"/></g><g stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"><path d="M338 111 L267.9 70.84 A24 24 0 0 0 244.1 70.84 L128.3 137.2 A24 24 0 0 0 128.3 178.8 L244.1 245.2 A24 24 0 0 0 267.9 245.2 L384.1 178.6 A24 24 0 0 1 420 199.4 L420 328.1 A24 24 0 0 1 407.9 348.9 L291.9 415.4 A24 24 0 0 1 256 394.6 L256 344"/></g></svg></span>StashBase</div>
      <section class="card" data-auto-return="${autoReturn ? 'true' : 'false'}" aria-labelledby="result-title">
        ${icon}
        <h1 id="result-title">${safeTitle}</h1>
        <p class="message">${safeMessage}</p>
        <div class="return-area">
          <p class="status" id="return-status" aria-live="polite">${autoReturn ? 'Returning you to StashBase…' : ''}</p>
          <a class="button" id="return-button" href="${APP_RETURN_URL}"${autoReturn ? ' hidden' : ''}>
            Open StashBase
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
        </div>
      </section>
    </div>
  </main>
  <script>
    (() => {
      const card = document.querySelector('.card');
      const button = document.getElementById('return-button');
      const status = document.getElementById('return-status');
      const autoReturn = card.dataset.autoReturn === 'true';
      const returnStatusUrl = ${returnStatusJson};
      const returnIntentUrl = ${returnIntentJson};
      let handedOff = false;
      let returnAttempted = false;

      const closeAfterAcknowledgement = () => {
        if (handedOff) return;
        handedOff = true;
        button.hidden = true;
        status.textContent = 'StashBase is open. You can close this page.';
        window.setTimeout(() => window.close(), 250);
      };

      const pollAcknowledgement = async () => {
        if (handedOff || !returnAttempted || !returnStatusUrl) return;
        try {
          const response = await fetch(returnStatusUrl, { cache: 'no-store' });
          const result = response.ok ? await response.json() : null;
          if (result && result.appReturned === true) {
            closeAfterAcknowledgement();
            return;
          }
        } catch { /* keep the fallback visible and retry */ }
        window.setTimeout(pollAcknowledgement, 300);
      };

      // One line at a time says where the return stands. Only a press of the
      // button earns "once more"; a missed automatic attempt says so and
      // offers the button.
      const beginReturnAttempt = (pressed) => {
        if (!returnAttempted) {
          returnAttempted = true;
          void pollAcknowledgement();
        }
        status.textContent = 'Opening StashBase…';
        window.setTimeout(() => {
          if (handedOff) return;
          button.hidden = false;
          status.textContent = pressed
            ? 'Still not open. Try once more.'
            : 'StashBase didn’t open on its own.';
        }, 1600);
      };

      const openStashBase = async (pressed) => {
        beginReturnAttempt(pressed);
        if (returnIntentUrl) {
          try { await fetch(returnIntentUrl, { method: 'POST', cache: 'no-store' }); }
          catch { /* the native fallback can still open the app */ }
        }
        window.location.href = '${APP_RETURN_URL}';
      };

      button.addEventListener('click', (event) => {
        event.preventDefault();
        void openStashBase(true);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void pollAcknowledgement();
      });

      if (!autoReturn) return;
      window.setTimeout(() => {
        if (!handedOff && document.visibilityState === 'visible' && document.hasFocus()) {
          void openStashBase(false);
        }
      }, 1200);
      // A page that never tried (out of focus) still offers the button.
      window.setTimeout(() => {
        if (handedOff || returnAttempted) return;
        button.hidden = false;
        status.textContent = 'StashBase didn’t open on its own.';
      }, 2800);
    })();
  </script>
</body>
</html>`;
}
