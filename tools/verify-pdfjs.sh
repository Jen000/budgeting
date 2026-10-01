#!/bin/sh
# Dev-only: re-verify the vendored PDF.js against Mozilla's official release.
# Usage: sh tools/verify-pdfjs.sh [version]      (default: the vendored version)
# Needs: curl, unzip, sha256sum (or shasum), openssl.
set -eu
VERSION="${1:-6.3.289}"
DIR="site/vendor/pdfjs-$VERSION"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
sri() { printf 'sha384-%s' "$(openssl dgst -sha384 -binary "$1" | openssl base64 -A)"; }

URL="https://github.com/mozilla/pdf.js/releases/download/v$VERSION/pdfjs-$VERSION-dist.zip"
echo "Downloading $URL"
curl -fsSL -o "$TMP/pdfjs.zip" "$URL"
echo "Zip SHA-256:      $(sha256 "$TMP/pdfjs.zip")"
echo "  -> compare with the digest shown next to the asset on"
echo "     https://github.com/mozilla/pdf.js/releases/tag/v$VERSION"
if [ -f "$DIR/VERSION.md" ]; then
  if grep -q "$(sha256 "$TMP/pdfjs.zip")" "$DIR/VERSION.md"; then echo "  -> matches VERSION.md"; else echo "  -> DOES NOT match VERSION.md"; fi
fi
unzip -q "$TMP/pdfjs.zip" -d "$TMP/dist"

status=0
for f in pdf.mjs pdf.worker.mjs; do
  echo
  echo "$f"
  echo "  release SHA-256: $(sha256 "$TMP/dist/build/$f")"
  if [ -f "$DIR/$f" ]; then
    echo "  vendored SHA-256: $(sha256 "$DIR/$f")"
    if cmp -s "$TMP/dist/build/$f" "$DIR/$f"; then echo "  identical to release: yes"; else echo "  identical to release: NO"; status=1; fi
    echo "  SRI for index.html: $(sri "$DIR/$f")"
    if grep -q "$(sri "$DIR/$f")" site/index.html; then echo "  SRI present in index.html: yes"; else echo "  SRI present in index.html: NO"; status=1; fi
  else
    echo "  (not vendored yet) SRI would be: $(sri "$TMP/dist/build/$f")"
  fi
done
exit $status
