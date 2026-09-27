#!/usr/bin/env bash
# ================================================================
# Tab Out — install the in-browser topic model (one time per Mac)
#
# Downloads three pinned things into the extension folder, then
# checks every file against scripts/model-files.sha256:
#   extension/vendor/  transformers.js 4.3.0 (library) and the
#                      onnxruntime-web engine (.mjs + .wasm) it loads
#   extension/models/  Xenova/paraphrase-multilingual-MiniLM-L12-v2
#                      (int8 ONNX, ~118 MB, English + Chinese + 48 more)
#
# These are plain file downloads from the npm registry and Hugging
# Face. No tab data is sent anywhere, now or later: the extension
# runs the model inside the browser and makes no network calls for it.
# Both folders are gitignored (GitHub refuses files over 100 MB).
#
# Safe to run again: files that are present and match their checksum
# are skipped. Needs only curl, tar and shasum (built into macOS).
#
# Usage:  bash scripts/setup-model.sh        (from anywhere)
# Then reload Tab Out in chrome://extensions (or brave://extensions).
# ================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT="$ROOT/extension"
SUMS="$ROOT/scripts/model-files.sha256"

TRANSFORMERS_VERSION="4.3.0"
ORT_VERSION="1.31.0-dev.20260914-8d85527a0"   # the onnxruntime-web build transformers.js 4.3.0 is bundled with
MODEL_ID="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REV="2c4055b12046f11709e9df2c122e59ffbdc2f900"
MODEL_FILES=(config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fetch() {  # fetch <url> <dest>
  curl -fsSL --retry 3 --retry-all-errors --connect-timeout 20 -o "$2.part" "$1"
  mv "$2.part" "$2"
}

# The expected checksum for a path relative to extension/
expected_sum() {
  awk -v p="$1" '$2 == p { print $1 }' "$SUMS"
}

is_ok() {  # is_ok <path relative to extension/>
  local f="$EXT/$1" want
  want="$(expected_sum "$1")"
  [[ -n "$want" && -f "$f" ]] && [[ "$(shasum -a 256 "$f" | awk '{print $1}')" == "$want" ]]
}

all_ok() {
  local p
  while read -r _ p; do is_ok "$p" || return 1; done < "$SUMS"
}

if all_ok; then
  echo "Tab Out model: all files present, checksums OK. Nothing to download."
  exit 0
fi

mkdir -p "$EXT/vendor" "$EXT/models/$MODEL_ID/onnx"

# 1. Library: transformers.min.js from the npm package tarball
if ! is_ok vendor/transformers.min.js; then
  echo "Downloading transformers.js $TRANSFORMERS_VERSION ..."
  fetch "https://registry.npmjs.org/@huggingface/transformers/-/transformers-$TRANSFORMERS_VERSION.tgz" "$TMP/transformers.tgz"
  tar -xzf "$TMP/transformers.tgz" -C "$TMP" package/dist/transformers.min.js
  cp "$TMP/package/dist/transformers.min.js" "$EXT/vendor/transformers.min.js"
fi

# 2. Engine: the single-thread-capable WASM build the library loads
if ! is_ok vendor/ort-wasm-simd-threaded.asyncify.wasm || ! is_ok vendor/ort-wasm-simd-threaded.asyncify.mjs; then
  echo "Downloading onnxruntime-web $ORT_VERSION (~27 MB) ..."
  fetch "https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-$ORT_VERSION.tgz" "$TMP/ort.tgz"
  mkdir -p "$TMP/ort"
  tar -xzf "$TMP/ort.tgz" -C "$TMP/ort" \
    package/dist/ort-wasm-simd-threaded.asyncify.mjs package/dist/ort-wasm-simd-threaded.asyncify.wasm
  cp "$TMP/ort/package/dist/ort-wasm-simd-threaded.asyncify."{mjs,wasm} "$EXT/vendor/"
fi

# 3. Model files, pinned to one Hugging Face revision
for f in "${MODEL_FILES[@]}"; do
  rel="models/$MODEL_ID/$f"
  is_ok "$rel" && continue
  echo "Downloading $MODEL_ID/$f ..."
  fetch "https://huggingface.co/$MODEL_ID/resolve/$MODEL_REV/$f" "$EXT/$rel"
done

# 4. Verify everything
failed=0
while read -r _ p; do
  if is_ok "$p"; then echo "  ok   $p"; else echo "  FAIL $p (missing or checksum mismatch)"; failed=1; fi
done < "$SUMS"

if [[ $failed -ne 0 ]]; then
  echo "Tab Out model: some files failed the checksum. Run this script again; if it keeps failing, delete extension/vendor and extension/models and retry." >&2
  exit 1
fi
echo "Tab Out model installed. Reload Tab Out in chrome://extensions (or brave://extensions)."
