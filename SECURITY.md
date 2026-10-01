# Security & privacy model

Private Budget handles some of the most sensitive data people have: account numbers, income,
spending habits, debts. The design goal is that **no one but the person at the keyboard ever
sees that data**, including the app's own author and host.

## What we protect

| Asset | Where it lives | Lifetime |
|---|---|---|
| Uploaded file bytes | JS memory (`ArrayBuffer`), only while parsing | Discarded after parsing |
| Parsed transactions, rules, paychecks, debts, budget, goals | One JS object (`js/state.js`) | Until "Clear all data", refresh, close, or navigation away |
| Printed report | A PDF file **you** save | Your responsibility once saved |

## Threat model

### 1. Data exfiltration to any server: **prevented**
- There is no backend. The app is static files.
- CSP `connect-src 'none'` blocks `fetch`, XHR, WebSocket, EventSource and `sendBeacon` at the
  browser level. `default-src 'none'` plus narrow `script-src/style-src/img-src/font-src 'self'`
  stop anything from loading from another origin, including images, fonts, frames and objects. `form-action 'none'`
  blocks form submission; `base-uri 'none'` blocks `<base>` hijacking.
- No analytics, telemetry, error reporting, CDN fonts or remote images exist in the code.
- `Referrer-Policy: no-referrer` means even a clicked link carries no URL. The app has no outbound links.
- PDF.js is configured so it cannot fetch (`useWorkerFetch: false`, no cMap/font/wasm URLs,
  `useWasm: false`), and CSP would block it anyway.
- The page makes **zero requests after the initial load**. Both PDF.js files load up front, so not
  even same-origin lazy loading happens. `tools/check-privacy.mjs` verifies this end to end.

### 2. Data persistence on the device: **prevented (within the browser's control)**
- No localStorage, sessionStorage, IndexedDB, cookies, Cache API or service worker anywhere.
  A static scan finds none, and the end-to-end check confirms all are empty.
- Inputs use `autocomplete="off"`, so the browser's form-autofill history does not record amounts.
- `pagehide` wipes state, and a page restored from the back/forward cache is wiped again
  (`pageshow` + `persisted`), so pressing Back cannot resurrect old data.
- A `beforeunload` prompt warns before leaving with data loaded, because leaving erases it.

### 3. Malicious file content (XSS, injection): **mitigated in depth**
Uploaded files are treated as hostile:
- **Text only, never HTML.** All UI is built with `createElement`/`createElementNS` +
  `textContent` (`js/dom.js`). There is no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or
  `document.write` in the codebase. The helper also refuses attribute names such as `innerHTML`,
  `on*`, `href`, `src` and `style`.
- **Trusted Types** (`require-trusted-types-for 'script'; trusted-types 'none'`) makes the
  browser itself throw if any HTML-string sink is ever used, even one added by mistake later.
- **No eval:** CSP has no `'unsafe-eval'` and no `'unsafe-inline'`. There are no inline scripts or
  handlers. PDF.js 6.x contains no `eval`/`new Function` code paths (verified by grep), and
  `isEvalSupported: false` is passed anyway.
- **Content sniffing:** files are identified by magic bytes and structure (`%PDF-`, `OFXHEADER`/
  `<OFX>`, delimited text), not by extension. Images, Excel/zip, binaries and HTML are rejected
  with a clear message.
- **Resource limits:** 20 MB per file, 50,000 rows per file, 200,000 transactions total, 50 files,
  150 PDF pages, 60 s PDF timeout, 500-character cells, 60 columns. Parsers are single linear
  passes (the OFX reader caches tag positions so missing closing tags can't make it quadratic), so
  malformed input fails fast instead of hanging.
- **Sanitized text:** control characters and bidirectional-override characters (U+202E and
  friends, which can make `gnp.exe` look like `exe.png`) are stripped from all file text.
- **CSV formula injection** (`=HYPERLINK(...)`) is inert: the app never exports CSV, and
  rendering is text-only.
- PDF.js only extracts text. Nothing is rendered: no annotations, forms, XFA, JavaScript,
  embedded fonts (`disableFontFace: true`) or images.

### 4. Supply-chain compromise: **minimized**
- Zero npm runtime dependencies, no build step, no framework. What's in `site/` is what runs.
- One vendored library, PDF.js 6.3.289:
  - downloaded from the official GitHub release
  - cross-checked against the signed npm `pdfjs-dist` tarball (worker byte-identical; main file
    differs only in a random build ID)
  - pinned in a versioned folder and loaded with SRI `sha384` hashes
  - isolated in `js/parsers/pdf-import.js`, so removing it is a four-step change
- PDF.js runs in "fake worker" mode (on the page's main thread). `new Worker()` cannot carry an
  integrity hash, so this keeps **every byte** of third-party code covered by SRI. The trade-off is
  that a very large PDF can make the page briefly unresponsive. The page cap and timeout bound this.

### 5. Clickjacking, cross-window attacks, powerful features
- `frame-ancestors 'none'` + `X-Frame-Options: DENY`: the app cannot be framed.
- `Cross-Origin-Opener-Policy: same-origin` severs `window.opener` relationships;
  `Cross-Origin-Resource-Policy: same-origin` stops other sites from embedding the files.
- `Permissions-Policy` disables camera, microphone, geolocation, payment, USB, serial, HID, MIDI,
  clipboard-read, display capture and Topics.
- `X-Content-Type-Options: nosniff` stops MIME confusion.

## What this app does NOT protect against (limits)

Be honest with yourself about these:

1. **A compromised device or browser.** Malware, a keylogger, or a malicious **browser extension**
   with access to the page can read anything on screen or in memory. CSP does not restrict
   extensions. Use a clean browser profile (or a private window with extensions disabled) for
   maximum assurance.
2. **A compromised host or deployment.** If someone can change the files on your web host, they
   can change the app, including its CSP meta tag and its own code. SRI protects PDF.js but
   not the app's own modules. Mitigations: self-host on a host you control, enable 2FA on the
   hosting account, review diffs before deploying, or run it locally (`node tools/serve.mjs`).
3. **Memory is not securely erased.** "Clear all data" drops every reference so the garbage collector
   reclaims it, but JavaScript cannot zero memory. Data could remain in RAM, swap, a crash
   dump or a hibernation file until overwritten. Closing the tab is the strongest wipe the web offers.
4. **The browser's own behaviour.** Crash/session restore may reopen the tab, but it reloads the page
   and the data is gone. The OS file picker may remember recent file names. Print-to-PDF writes a file
   where you choose. Some browsers keep a "recently printed" or download history.
5. **The exported PDF.** Once saved, it is an ordinary file. Account numbers are masked by
   default, but amounts, merchants and income are in it. Store and share it carefully.
6. **Shoulder surfing and screen sharing.** Out of scope.
7. **Accuracy.** Parsing heuristics, especially for PDFs, can misread amounts or dates. That is why
   PDF rows require review and paystub numbers require confirmation. This is not financial advice.
8. **Old browsers.** The protections rely on a modern browser. Trusted Types is enforced in
   Chromium-based browsers; other engines are adding support and ignore the directive until then.
   Where it's unsupported, the text-only DOM code still prevents injection, so you only lose
   one extra safety net.

## Reporting a problem

If you find a way for data to leave the page, persist, or execute from a file, please open a
private security advisory on the repository rather than a public issue.
