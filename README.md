# Private Budget

A privacy-first personal budgeting web app. You load your own bank, credit-card and loan
statements plus your paycheck details. The app categorizes spending, flags overspending, compares
debt payoff strategies, suggests a budget, plans savings goals and prints a report.

**Everything runs in your browser tab.** There is no backend, no database, no analytics and no
network requests after the page loads. Nothing is saved; refreshing the page erases everything.

- 100% static: plain HTML, CSS and vanilla JavaScript ES modules. No framework, no build step.
- **One** third-party library: Mozilla PDF.js 6.3.289. It is self-hosted, pinned, checksum-verified,
  loaded with Subresource Integrity, and used only to read text out of PDF statements.
- See [SECURITY.md](SECURITY.md) for the threat model and [AUDIT.md](AUDIT.md) for the requirement-by-requirement self-audit.

## File structure

```
site/                     ← the only folder that gets deployed
  index.html              single page; CSP <meta>; SRI <script> tags
  _headers                security headers (Netlify / Cloudflare Pages format)
  css/app.css             screen styles (system fonts, light/dark)
  css/print.css           print-only layout: only the report is printed
  js/main.js              bootstrap, step navigation, wipe-on-leave lifecycle
  js/state.js             the single in-memory store + clearAll()
  js/dom.js               safe DOM builders (createElement/textContent only)
  js/util.js              money (integer cents), dates, merchant names, masking, limits
  js/files.js             file intake: size/row limits, magic-byte sniffing, routing
  js/parsers/csv.js       RFC 4180 CSV reader, header detection, column mapping, sign conventions
  js/parsers/ofx.js       OFX 1.x (SGML), OFX 2.x (XML) and QFX reader
  js/parsers/pdf-import.js  the ONLY module that uses PDF.js (statements + paystubs)
  js/categorize.js        built-in keyword rules + user rules
  js/ledger.js            dedupe across files, transfer and card-payment pairing
  js/analysis.js          totals, monthly series, subscriptions, overspending flags
  js/debt.js              avalanche vs snowball simulation
  js/budget.js            budget suggestion (actuals or 50/30/20), goal math
  js/charts.js            SVG charts built with createElementNS
  js/views/*.js           one renderer per step, plus the printable report
  vendor/pdfjs-6.3.289/   pdf.mjs, pdf.worker.mjs, LICENSE, VERSION.md (checksums + SRI)
samples/                  fake test files, including hostile and malformed ones
tests/logic.test.mjs      unit tests (Node built-in test runner)
tools/                    dev-only helpers (never deployed)
```

## Run locally

You need any static file server. The app must be served over `http://` or `https://`, because
ES modules do not load from `file://`.

**Recommended (applies the real security headers):**

```sh
node tools/serve.mjs          # Node 18+; no npm install needed
# open http://127.0.0.1:8000/
```

`tools/serve.mjs` serves `site/` and applies every header from `site/_headers`, so the CSP behaves
locally exactly as it will in production.

**Alternative:** `cd site && python3 -m http.server 8000`. This works, but sends no security headers. The
CSP `<meta>` tag still applies; `frame-ancestors` and the other headers do not.

Try it with the files in `samples/`:
- `checking-jan-mar-2024.csv` includes `<script>` and `<img onerror>` descriptions, a CSV
  formula-injection string, an impossible date, a refund, and a legitimate same-day double charge.
- `checking-overlap-feb-mar-2024.csv` is the same account in a different layout with overlapping
  dates, so every row should be detected as a duplicate.
- `creditcard-positive-charges.csv` is a card export where purchases are positive.
- `visa-card-2024q1.ofx` is OFX 1.x SGML with an HTML-entity script and a repeated FITID.
- `savings-2024q1.qfx` is OFX 2.x XML with transfers that pair with the checking account.
- `european-semicolon-ddmm.csv` uses semicolons, day-first dates and decimal commas.
- `unmapped-headers.csv` triggers the column-mapping screen.
- `card-statement-text.pdf` and `paystub-text.pdf` are text PDFs for the review/confirm flows.
- `malformed-unclosed-quote.csv` and `fake-image-renamed.csv` must be rejected with clear errors.

## Tests (dev only)

```sh
node --test tests/              # unit tests: parsers, dedupe, categorization, debt math…
node tools/serve.mjs &          # then, if Playwright is installed (npm i -g playwright):
node tools/check-privacy.mjs    # end-to-end: zero requests after load, no storage, no XSS
```

## Deploy as a static site over HTTPS

Deploy **only the `site/` folder**. It contains `_headers`, which both hosts below read.

**Netlify:** New site → "Deploy manually" → drag the `site/` folder in. Or connect the
repository with *Base directory* empty, *Build command* empty and *Publish directory* `site`.
HTTPS is automatic.

**Cloudflare Pages:** Create project → connect the repo (or use direct upload). Leave the build command empty and
set the build output directory to `site`. HTTPS is automatic.

**Other hosts** (nginx, Apache, S3 + CloudFront, GitHub Pages…): copy `site/` and configure the
same response headers as `site/_headers`. Serve `.mjs` files as `text/javascript`, because
`X-Content-Type-Options: nosniff` blocks module scripts with the wrong MIME type. GitHub Pages
cannot set custom headers, so there you only get the `<meta>` CSP. Prefer Netlify or Cloudflare.

**After deploying**, check the headers:

```sh
curl -sI https://your-site.example/ | grep -iE 'content-security|referrer|nosniff|permissions|cross-origin|frame'
```

## Verify PDF.js integrity

The vendored files are byte-for-byte copies of `build/pdf.mjs` and `build/pdf.worker.mjs` from the
official `pdfjs-6.3.289-dist.zip` GitHub release. Their checksums are in
[`site/vendor/pdfjs-6.3.289/VERSION.md`](site/vendor/pdfjs-6.3.289/VERSION.md).

```sh
sh tools/verify-pdfjs.sh
```

The script downloads the release zip from GitHub and prints its SHA-256. **Compare that with the
digest GitHub shows next to the asset** on <https://github.com/mozilla/pdf.js/releases/tag/v6.3.289>.
It then checks that the vendored files are identical to the release and that `index.html` carries
the right `integrity=` values. You can also check by hand:

```sh
sha256sum site/vendor/pdfjs-6.3.289/*.mjs
openssl dgst -sha384 -binary site/vendor/pdfjs-6.3.289/pdf.mjs | openssl base64 -A   # SRI value
```

The browser enforces the SRI hashes: if either file is altered, it refuses to run it, and PDF import
reports "PDF support is not available" while CSV/OFX keep working.

## Update PDF.js

1. Find the latest stable release at <https://github.com/mozilla/pdf.js/releases>. It must be
   ≥ 4.2.67 (CVE-2024-4367). Read its release notes for security fixes and API changes.
2. Run `sh tools/verify-pdfjs.sh NEW_VERSION` and compare the zip digest with GitHub's.
3. Create `site/vendor/pdfjs-NEW_VERSION/` with `build/pdf.mjs`, `build/pdf.worker.mjs` and
   `LICENSE` from the zip. Do not modify them.
4. In `site/index.html`, update both `<script>` paths and `integrity` values (the script prints them).
5. In `site/js/parsers/pdf-import.js`, update `PDFJS_VERSION`. Check that the options in
   `SAFE_OPTIONS` still exist in the new version's `getDocument()`.
6. Update `VERSION.md` (copy the old one as a template), update the default version in
   `tools/verify-pdfjs.sh`, and delete the old folder.
7. Run `node --test tests/` and `node tools/check-privacy.mjs` (it imports the sample PDFs), and re-run
   `sh tools/verify-pdfjs.sh` to confirm "identical to release: yes" and "SRI present: yes".

**To remove PDF support entirely:** delete `site/vendor/pdfjs-*`, the two vendor `<script>` tags,
and `js/parsers/pdf-import.js` and its import in `js/files.js`. PDF uploads are then rejected with a message.

## Dev tooling (none of it ships)

| Tool | Why |
|---|---|
| `package.json` | No dependencies. Only `"type": "module"` so Node can import `site/js/*.js` in tests. |
| Node's built-in `node:test` | Unit tests for parsers and calculations. |
| `tools/serve.mjs` (Node built-ins) | Local server that applies `_headers`. |
| `tools/verify-pdfjs.sh` (curl, unzip, openssl) | Re-verify the vendored PDF.js. |
| `tools/make-sample-pdfs.py` (Python stdlib) | Generates the fake sample PDFs. |
| `tools/check-privacy.mjs` + Playwright (optional, installed separately) | End-to-end privacy check in Chromium. |

## How to confirm in DevTools that nothing leaves and nothing is stored

Use Chrome/Edge; Firefox has equivalents.

1. Open the app, open DevTools (F12) and go to the **Network** tab. Tick **Preserve log**, then reload.
2. You will see only the initial same-origin requests: `index.html`, two CSS files, two PDF.js
   files and the app's `js/*.js` modules (about 26 rows, all from your own domain).
3. Click the 🚫 **Clear** button in the Network tab so the list is empty. Now use the app: upload
   files (including a PDF), recategorize, build a budget, add goals, and print.
   **The list stays empty.** No XHR/fetch, no fonts, no images, no beacons. Filtering by
   "All" also shows nothing.
   - The file you upload is read by the browser locally (`File.arrayBuffer()`), which is not a
     network request, so it never appears here.
4. Go to the **Application** tab (Firefox: **Storage**):
   - **Local storage**, **Session storage**: your site's entry is empty.
   - **IndexedDB**: no databases.
   - **Cookies**: none.
   - **Cache storage**: empty. **Service workers**: none registered.
   - The **Storage** overview's usage figure shows nothing stored for the site.
5. **Console tab:** run `fetch('/')`. It fails with a CSP `connect-src 'none'` error, which proves the
   page cannot make requests even if code tried. `document.body.innerHTML = 'x'` is
   rejected by Trusted Types.
6. Check the headers: Network → click the `index.html` row → **Headers** → *Response headers*.
   The `Content-Security-Policy`, `Referrer-Policy`, `X-Content-Type-Options`,
   `Permissions-Policy` and `Cross-Origin-Opener-Policy` headers should be listed.
7. Refresh: every upload, rule, budget and goal is gone.

Note: if DevTools is open, it may itself request `*.map` source-map files for PDF.js. That is
DevTools, not the page. It happens only while DevTools is open, the files are not shipped, and
the page never reads them.

---

*General information only, not financial advice.*
