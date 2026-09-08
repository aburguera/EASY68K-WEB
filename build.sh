#!/usr/bin/env bash
# Builds the two WebAssembly engines (assembler + simulator) from the
# original EASy68K C++ source, then bundles them together with the web
# frontend into a single self-contained dist/easy68k-web.html file.
#
# Requires the Emscripten SDK (emcc) on PATH. See README.md for setup.
set -euo pipefail
cd "$(dirname "$0")"

# dist/ is gitignored (build output, not checked in), so a fresh checkout
# never has it - emcc fails outright if its -o target's directory doesn't
# already exist, rather than creating it.
mkdir -p dist

echo "== Building assembler engine (src/engine-asm) =="
cd src/engine-asm
emcc -std=c++17 -I. \
  -Wno-c++11-narrowing -Wno-writable-strings -Wno-dangling-else \
  -Wno-format-security -Wno-format -Wno-shift-op-parentheses -Wno-parentheses \
  ASSEMBLE.CPP BINFILE.CPP BUILD.CPP CODEGEN.CPP DIRECTIV.CPP ERROR.CPP EVAL.CPP GLOBALS.CPP \
  INSTLOOK.CPP INSTTABL.CPP LISTING.CPP MACRO.CPP MOVEM.CPP OBJECT.CPP OPPARSE.CPP STRUCTURED.CPP SYMBOL.CPP \
  wasm_api.cpp \
  -o ../../dist/asm_engine.js \
  --no-entry \
  -s MODULARIZE=1 -s EXPORT_NAME=EASy68KModule \
  -s EXPORTED_FUNCTIONS='["_wasm_assemble","_wasm_set_main_path","_wasm_get_error_count","_wasm_get_error_line","_wasm_get_error_message","_wasm_get_start_address","_wasm_get_symbol_count","_wasm_get_symbol_flags","_wasm_get_symbol_name","_wasm_get_symbol_value","_wasm_get_warning_count","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS"]' \
  -s FORCE_FILESYSTEM=1 \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 \
  -s SINGLE_FILE=1
cd ../..

echo "== Building simulator engine (src/engine-sim) =="
cd src/engine-sim
emcc -std=c++17 -I. \
  -Wno-c++11-narrowing -Wno-writable-strings -Wno-dangling-else \
  -Wno-format-security -Wno-format -Wno-shift-op-parentheses -Wno-parentheses \
  CODE1.CPP CODE2.CPP CODE3.CPP CODE4.CPP CODE5.CPP CODE6.CPP CODE7.CPP CODE8.CPP CODE9.CPP \
  RUN.CPP SIMOPS1.CPP SIMOPS2.CPP SCAN.CPP STRUTILS.CPP UTILS.CPP STARTSIM.CPP BPoint.cpp BPointExpr.cpp \
  globals.cpp wasm_api.cpp \
  -o ../../dist/sim_engine.js \
  --no-entry \
  -s MODULARIZE=1 -s EXPORT_NAME=EASy68KSimModule \
  -s EXPORTED_FUNCTIONS='["_wasm_sim_init","_wasm_load_srec","_wasm_step","_wasm_run_batch","_wasm_run_batch_native_bp","_wasm_set_breakpoints","_wasm_get_hit_breakpoint","_wasm_get_halt","_wasm_get_irq","_wasm_get_d","_wasm_get_a","_wasm_get_active_a7","_wasm_get_usp","_wasm_get_ssp","_wasm_get_pc","_wasm_get_sr","_wasm_set_d","_wasm_set_a","_wasm_set_active_a7","_wasm_set_pc","_wasm_set_sr","_wasm_read_byte","_wasm_write_byte","_wasm_reset","_wasm_get_inst","_wasm_get_old_pc","_wasm_mouse_move","_wasm_mouse_down","_wasm_mouse_up","_wasm_key_modifiers","_wasm_key_down","_wasm_key_up","_wasm_hw_set_addrs","_wasm_hw_get_seg7loc","_wasm_hw_get_ledloc","_wasm_hw_get_switchloc","_wasm_hw_get_pbloc","_wasm_hw_manual_irq","_wasm_hw_set_auto","_wasm_hw_get_auto_enabled","_wasm_hw_get_auto_period","_wasm_set_initial_mask_zero","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS","HEAPU32"]' \
  -s FORCE_FILESYSTEM=1 \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 \
  -s SINGLE_FILE=1
cd ../..

echo "== Assembling final dist/easy68k-web.html =="
python3 tools/assemble_html.py

echo ""
echo "Done. Output: dist/easy68k-web.html"
echo "Open it directly in a browser, or run: python3 -m http.server -d dist 8080"
