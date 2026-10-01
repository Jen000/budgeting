# Self-audit

Status key: ✅ met · ⚠️ met with a documented caveat · ❌ not met

Evidence comes from three places:
- **Unit tests:** `node --test tests/` (21 passing)
- **End-to-end check:** `node tools/check-privacy.mjs`, which drives Chromium through every step with every sample file (28/28 passing)
- **Static scan:** a grep of `site/js` and `site/index.html` for forbidden APIs, which matches only comments and the deny-list in `dom.js`:
  ```sh
  grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|serviceWorker|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|import\(" site/js site/index.html
  ```

## No data leaves the device

| Requirement | Status | Evidence / notes |
|---|---|---|
| 100% client-side static site, no backend/API/DB/serverless | ✅ | `site/` is static files only. |
| Zero network requests after initial load | ✅ | E2E check records every request: 26 on load (all same-origin), **0** afterwards, including during PDF import. PDF.js loads up front so even lazy same-origin loading never happens. |
| No analytics, telemetry, error reporting, CDN fonts, external images, AI APIs | ✅ | None in the code. System font stack. `<link rel="icon" href="data:,">` avoids even a favicon request. |
| CSP as HTTP header | ✅ | `site/_headers`. It contains the exact policy requested **plus** `require-trusted-types-for 'script'; trusted-types 'none'` (stricter). |
| CSP mirrored in `<meta>` | ⚠️ | Mirrored, except `frame-ancestors`: browsers ignore it in `<meta>` per the CSP spec and log a warning. The header and `X-Frame-Options: DENY` enforce it. |
| No inline scripts or handlers, no eval / new Function, no unsafe-inline / unsafe-eval | ✅ | All JS is in external modules; events use `addEventListener`. PDF.js 6.3.289 has no eval/`new Function` paths (grep). |
| Referrer-Policy, nosniff, Permissions-Policy (camera, mic, geolocation, payment), COOP same-origin | ✅ | `site/_headers`; plus CORP, X-Frame-Options, HSTS and more disabled features. |

## No data is stored

| Requirement | Status | Evidence / notes |
|---|---|---|
| Data in JS memory only | ✅ | Single object in `js/state.js`. |
| No localStorage, sessionStorage, IndexedDB, cookies, Cache API, service workers | ✅ | Static scan is clean. The E2E check confirms all are empty after a full session. |
| Prominent "Clear all data" button that wipes state and resets the UI | ✅ | Header button; `clearAll()` replaces the whole state object. E2E verifies files and transactions are gone. |
| Close/refresh erases everything, with a notice | ✅ | The privacy banner says so. Also: wipe on `pagehide`, wipe if restored from bfcache, `autocomplete="off"` on inputs, and a `beforeunload` warning. |
| — | ⚠️ | JS cannot zero memory; freed data may linger in RAM or swap until overwritten (see SECURITY.md, Limits). |

## Treat uploaded files as hostile

| Requirement | Status | Evidence / notes |
|---|---|---|
| Never use innerHTML / outerHTML / insertAdjacentHTML / document.write with user data | ✅ | Not used anywhere. `dom.js` refuses those keys, and Trusted Types makes the browser throw. E2E: `<script>`, `<img onerror>`, `<svg onload>`, entity-encoded scripts and a PDF `<script>` line all render as text, and no `alert()` fires. |
| Validate file type by content | ✅ | `files.js#sniff`: magic bytes and structure. Test: a PNG renamed `.csv` is rejected. |
| Max file size and row count | ✅ | 20 MB/file, 50k rows/file, 200k total, 150 PDF pages, 60 s PDF timeout (`util.js#LIMITS`). Tested. |
| Malformed files handled gracefully | ✅ | Unclosed quotes, impossible dates (`02/30`), `20249999`, garbage rows and empty files give per-file messages or "skipped rows" details. Linear-time parsers (40k-row SGML OFX test < 5 s). |

## Dependencies

| Requirement | Status | Evidence / notes |
|---|---|---|
| Zero third-party deps except PDF.js; no frameworks; no npm packages | ✅ | `package.json` has no dependencies (it exists only to set `"type": "module"` for tests). |
| Charts drawn by hand as SVG via createElementNS | ✅ | `js/charts.js`. |
| PDF export via `window.print()` + print stylesheet | ✅ | `css/print.css`, `views/report.js`. |
| Own CSV/OFX/QFX parsers | ✅ | `js/parsers/csv.js`, `js/parsers/ofx.js`. |
| PDF.js ≥ 4.2.67, latest stable | ✅ | 6.3.289, the newest `v*` tag on mozilla/pdf.js at build time. |
| Downloaded from the official GitHub release, checksum verified | ⚠️ | Downloaded from the official release URL. The zip SHA-256 is recorded. **GitHub's published digest could not be fetched from the build sandbox**, so I verified against Mozilla's independently signed npm tarball instead: worker byte-identical, main file differing only by a random build ID. **Action for you:** run `sh tools/verify-pdfjs.sh` and compare the printed zip digest with the one on the GitHub release page. |
| Self-hosted, pinned, SRI on its script tags | ✅ | `vendor/pdfjs-6.3.289/`, `integrity="sha384-…"` on both tags. `verify-pdfjs.sh` re-checks the hashes. |
| `isEvalSupported: false`, text extraction only, never render | ⚠️ | Passed as required, but PDF.js 6.x **removed this option** because it no longer has eval code paths, so it is a no-op. CSP forbids eval regardless. Only `getTextContent()` is called. Fonts, XFA, WASM, fetches and image decoders are disabled. |
| Isolated in its own module | ✅ | Only `js/parsers/pdf-import.js` touches it; removal steps are in the README. |
| Dev tooling doesn't ship; listed and explained | ✅ | README → "Dev tooling". Only `site/` is deployed. |
| — | ⚠️ | **Design trade-off:** PDF.js runs on the main thread ("fake worker") so every byte is under SRI (`new Worker()` cannot take an integrity hash). A huge PDF can briefly freeze the tab; the page cap and timeout bound this. |

## Supported inputs

| Requirement | Status | Evidence / notes |
|---|---|---|
| CSV: Date/Description/Amount, split Debit/Credit, date formats, sign conventions | ✅ | Header aliases plus preamble skipping; MDY/DMY auto-detect; ISO, `15-Feb-2024`, `Jan 5, 2024`; `(12.34)`, `12.34-`, CR/DR, decimal comma; type column; auto sign detection with a per-file override. |
| Column-mapping screen when headers aren't recognized | ✅ | Also reachable later via "Change columns". |
| OFX/QFX | ✅ | SGML 1.x and XML 2.x, bank and credit-card statements. ⚠️ Investment and loan OFX message sets are not parsed (clear error message); enter loans manually. |
| Text PDFs with a review step, and a notice that CSV/OFX is more accurate | ✅ | Every PDF row goes through an editable review table (include, date, description, amount, direction). The notice is on the upload step and the review screen. |
| Paycheck manual form (gross, net, frequency, deductions) | ✅ | |
| Optional PDF paystub parsing with confirmation; no OCR | ✅ | Pre-fills the same form; nothing is saved until confirmed. Scanned PDFs get a "no text found / no OCR" message. |
| Remove duplicates across overlapping statements | ✅ | Same date + amount + merchant from a different file with compatible account; plus OFX FITID. Same-day identical charges *within* one file are kept. Users can override any row. |
| Exclude own-account transfers and card payments from spending | ✅ | Keyword rules plus pairing of equal and opposite amounts across files within 5 days. If card payments are excluded but no card statement was loaded, the app warns that the spending would be missing. |

## UI, report, deliverables

| Requirement | Status | Notes |
|---|---|---|
| Single page, steps Upload → Review → Insights → Budget → Goals → Export | ✅ | Debts live in step 4 ("Budget & debts"). |
| Mobile-friendly | ✅ | Fluid grids, 16px gutters, wide tables scroll within their own container. |
| Accessible: semantic HTML, keyboard, contrast, labels | ⚠️ | Landmarks, a skip link, real buttons, labels on every input, `aria-current` steps, a live status region, focus moved to step headings, focus kept across re-renders, charts with `role="img"` and a data table, status shown by icon and text (never color alone), forced-colors support. Contrast was chosen for ≥ 4.5:1 text. **Not yet tested with a real screen reader or an automated axe audit**; please do both before relying on it. |
| Privacy banner with the exact wording; system fonts; disclaimer | ✅ | |
| Report contents (date range, income, category chart + table, merchants, flags, subscriptions, debts + payoff, budget, goals) | ✅ | |
| Print hides upload controls, buttons, nav | ✅ | Verified by printing to PDF in Chromium. |
| Mask account numbers, on by default | ✅ | Masks account labels and long digit runs in file names. The app UI always masks. |
| `_headers`, README, SECURITY.md, this audit, sample files | ✅ | |

## Could not be met / left out on purpose

1. **GitHub's own release digest** couldn't be fetched from the build sandbox. The substitute verification
   is described above; please do the final comparison yourself.
2. **`frame-ancestors` in `<meta>`** is impossible per spec; it is enforced by the header instead.
3. **`isEvalSupported: false`** no longer exists in PDF.js 6.x. It is passed anyway, and eval is absent and blocked by CSP.
4. **Loan/investment OFX parsing** was not built (rare in the wild). Debts are entered by hand, or
   suggested from card OFX balances and PDF statements for you to confirm.
5. **Secure memory wiping** is not possible from JavaScript.
6. **SRI on the app's own modules** was not added. ES module imports can't carry integrity without an
   import map, and the requirement covers PDF.js. The app's code is served from the same
   origin under the same CSP.
