# Vendored PDF.js

| | |
|---|---|
| Library | Mozilla PDF.js (Apache-2.0, see `LICENSE`) |
| Version | **6.3.289** (latest stable when vendored; ≥ 4.2.67 required for CVE-2024-4367) |
| Source | `https://github.com/mozilla/pdf.js/releases/download/v6.3.289/pdfjs-6.3.289-dist.zip` |
| Zip SHA-256 | `98c5832ffe7af4edd59853476a478c0d4d4d76dd49c1701f4c86f7182725cdf9` |
| Files taken | `build/pdf.mjs`, `build/pdf.worker.mjs`, `LICENSE` (unmodified) |

## Checksums of the files in this folder

| File | SHA-256 | SRI (used in `index.html`) |
|---|---|---|
| `pdf.mjs` | `df4a14ea8a67f687265d7d51d89cc4fce429739f6e8076dea163b164024fe6e2` | `sha384-9nEaZvLkvNW0evMnMGhOHMJt/7q6Dem5SsU2KJQO6BZvWUXB8An9DULmwLKxwsaw` |
| `pdf.worker.mjs` | `f2870db902eaff8397442c912b69459980ac91f6f4b5ed827167b12cf7057930` | `sha384-AzcYX25yPL+RXO1exGVxYnTOllKYsHH8WoZX+n+Z+Cekli52UJoV4i8f2nC9LwEL` |

## How these were verified

1. Downloaded the release zip from the official GitHub release URL above (HTTPS).
2. Cross-checked against Mozilla's second official channel, the npm package
   `pdfjs-dist@6.3.289`. Its tarball matched the registry's signed integrity value
   (`sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==`).
3. `pdf.worker.mjs` is **byte-identical** in both channels.
   `pdf.mjs` differs in exactly one line: a random per-build UUID constant
   (`INTERNAL_EVT`). Nothing else differs.
4. The GitHub release page's own SHA-256 digest could not be fetched from the build
   environment (the proxy blocked it). **Compare the zip SHA-256 above against the digest shown on
   the release page yourself**, as described in the README.

`tools/verify-pdfjs.sh` re-computes all of the above.

## How it is used

- Both files load as `<script type="module" integrity="sha384-…">` in `index.html`.
- `pdf.worker.mjs` loads first and registers `globalThis.pdfjsWorker`. PDF.js then
  runs its parser on the main thread. Nothing is fetched later, and every byte of PDF.js
  is covered by SRI (`new Worker()` cannot carry an integrity hash).
- Only `js/parsers/pdf-import.js` uses PDF.js, and only `getTextContent()` is ever
  called. Nothing is rendered.
- Source-map comments (`//# sourceMappingURL=…`) are left in place so the files stay
  byte-identical to the release. The `.map` files are not shipped. Browsers only request
  them while DevTools is open, and the page never does.
