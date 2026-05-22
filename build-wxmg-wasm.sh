#!/usr/bin/env bash
# Build Godot WASM engine for WeChat Mini Game
#
# Clones Godot 4.4.1 (shallow) on first run, applies Mini Game patches,
# and compiles with optional PCK encryption.
#
# Usage:
#   ./build-wxmg-wasm.sh [profile] [--clean]
#
#   Profiles:
#     2d-tiny  — no 3D, no AdvancedGUI (default, smallest)
#     2d-full  — no 3D, AdvancedGUI
#     3d       — 3D + Jolt physics
#
#   Encryption (optional):
#     SCRIPT_AES256_ENCRYPTION_KEY=<64-hex-chars> ./build-wxmg-wasm.sh
#     SCRIPT_AES256_ENCRYPTION_KEY=$(openssl rand -hex 32) ./build-wxmg-wasm.sh
#
#   Default Clean rebuild:
#     ./build-wxmg-wasm.sh 2d-tiny --clean      # removes godot/ dir, re-clones
#
# Output:
#   engine/godot.wasm.br — brotli-compressed WASM

set -euo pipefail

PROFILE="${1:-2d-tiny}"
CLEAN="${2:---clean}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GODOT_DIR="$SCRIPT_DIR/godot"
GODOT_REPO="https://github.com/darklinden/godot.git"
GODOT_BRANCH="4.4"

# ---------------------------------------------------------------------------
# Profile settings
# ---------------------------------------------------------------------------
case "$PROFILE" in
2d-tiny)
    DISABLE_3D="yes"
    MODULE_JOLT="no"
    echo "==> Profile: 2D精简版 (no 3D, fallback text server)"
    ;;
2d-full)
    DISABLE_3D="yes"
    MODULE_JOLT="no"
    echo "==> Profile: 2D完整版 (no 3D, advanced text server)"
    ;;
3d)
    DISABLE_3D="no"
    MODULE_JOLT="yes"
    echo "==> Profile: 3D版 (Jolt physics)"
    ;;
*)
    echo "ERROR: Unknown profile '$PROFILE'. Use: 2d-tiny, 2d-full, 3d"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
if [ "$CLEAN" = "--clean" ]; then
    echo "==> Cleaning: removing $GODOT_DIR"
    rm -rf "$GODOT_DIR"
fi

# ---------------------------------------------------------------------------
# Clone Godot (shallow, single branch)
# ---------------------------------------------------------------------------
if [ ! -d "$GODOT_DIR/platform" ]; then
    echo "==> Cloning Godot $GODOT_BRANCH (depth=1)..."
    git clone --depth 1 --branch "$GODOT_BRANCH" "$GODOT_REPO" "$GODOT_DIR"
fi

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------
command -v emcc >/dev/null 2>&1 || {
    echo "ERROR: emcc not found. Activate emsdk first."
    exit 1
}
command -v scons >/dev/null 2>&1 || {
    echo "ERROR: scons not found. Install: pip install scons"
    exit 1
}

SCONS="scons"
type scons &>/dev/null || SCONS="python3 -m SCons"

# ---------------------------------------------------------------------------
# Encryption key
# ---------------------------------------------------------------------------
KEY="${SCRIPT_AES256_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}"

if [ "${#KEY}" -ne 64 ]; then
    echo "ERROR: SCRIPT_AES256_ENCRYPTION_KEY must be exactly 64 hex characters (got ${#KEY})" >&2
    exit 1
fi

if [ "$KEY" = "0000000000000000000000000000000000000000000000000000000000000000" ]; then
    echo "==> Encryption: none (default key)"
else
    echo "==> Encryption: ${KEY:0:8}..."
fi

export SCRIPT_AES256_ENCRYPTION_KEY="$KEY"

# ---------------------------------------------------------------------------
# Write custom.py
# ---------------------------------------------------------------------------
echo "==> Writing custom.py"
cat >"$GODOT_DIR/custom.py" <<PYEOF
threads = "no"
platform = "web"
extra_suffix = "minigame"
production = "yes"
optimize = "size"
disable_3d = "$DISABLE_3D"
module_jolt_physics_enabled = "$MODULE_JOLT"
module_mobile_vr_enabled = "no"
module_openxr_enabled = "no"
module_webxr_enabled = "no"
module_text_server_adv_enabled = "no"
module_text_server_fb_enabled = "yes"
module_webrtc_enabled = "no"
PYEOF

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "======================================"
echo " Building Godot WASM for WeChat MG"
echo " profile  = $PROFILE"
echo " target   = template_release"
echo " 3d       = $DISABLE_3D"
echo " threads  = no"
echo "======================================"
echo "==> Compiling (10-30 min)..."
echo ""

cd "$GODOT_DIR"

$SCONS \
    platform=web \
    custom=./custom.py \
    target=template_release \
    production=yes \
    optimize=size \
    disable_3d="$DISABLE_3D" \
    threads=no \
    -j"$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)"

# ---------------------------------------------------------------------------
# Find output zip
# ---------------------------------------------------------------------------
WASM_ZIP=$(find bin/ -maxdepth 1 -name "godot.web.*.wasm32.nothreads.minigame.zip" 2>/dev/null | head -1)

if [ ! -f "$WASM_ZIP" ]; then
    echo "==> Looking for WASM output..."
    find bin/ -name "*.zip" 2>/dev/null | head -10
    echo "ERROR: Could not find WASM zip. Check scons output above."
    exit 1
fi

echo ""
echo "==> Build complete. Extracting outputs..."

# --- godot.wasm + brotli ---
unzip -o "$WASM_ZIP" godot.wasm -d /tmp/wxmg_wasm/
ENGINE_DIR="$SCRIPT_DIR/engine"
mkdir -p "$ENGINE_DIR"

cp /tmp/wxmg_wasm/godot.wasm "$ENGINE_DIR/godot.wasm"
if command -v brotli &>/dev/null; then
    brotli -f --best "$ENGINE_DIR/godot.wasm" -o "$ENGINE_DIR/godot.wasm.br"
    echo "  -> engine/godot.wasm.br ($(du -h "$ENGINE_DIR/godot.wasm.br" | cut -f1))"
else
    echo "  -> engine/godot.wasm ($(du -h "$ENGINE_DIR/godot.wasm" | cut -f1))"
    echo "  ⚠️  brotli not found — no .br file. Install: brew install brotli"
fi

rm -rf /tmp/wxmg_wasm/

echo ""
echo "Done. Outputs in engine/:"
ls -lh "$ENGINE_DIR/"
