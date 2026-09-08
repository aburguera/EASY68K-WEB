#!/usr/bin/env python3
"""
Combines the web frontend (src/web/gui_shell.html, app_part1.js, app_part2.js)
with the two built WASM engines (dist/asm_engine.js, dist/sim_engine.js) into
a single, self-contained dist/easy68k-web.html file.

Run via build.sh, or standalone after the two engines have already been
built once (useful when only editing app_part1.js / app_part2.js /
gui_shell.html - no need to rebuild the WASM engines for a JS/HTML-only
change).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "src" / "web"
DIST = ROOT / "dist"

shell = (WEB / "gui_shell.html").read_text(encoding="utf-8")
asm_engine = (DIST / "asm_engine.js").read_text(encoding="utf-8")
sim_engine = (DIST / "sim_engine.js").read_text(encoding="utf-8")
part1 = (WEB / "app_part1.js").read_text(encoding="utf-8")
part2 = (WEB / "app_part2.js").read_text(encoding="utf-8")

marker = "</div>\n\n</body>\n</html>"
if marker not in shell:
    raise SystemExit(
        "Could not find the expected insertion marker at the end of "
        "gui_shell.html. If you've edited the very end of that file, "
        "update this marker to match."
    )

injected = (
    "</div>\n<script>\n" + asm_engine + "\n</script>\n"
    "<script>\n" + sim_engine + "\n</script>\n"
    + part1 + "\n" + part2 + "\n</body>\n</html>"
)
final = shell.replace(marker, injected)

out_path = DIST / "easy68k-web.html"
out_path.write_text(final, encoding="utf-8")

# Sanity check: pull the JS back out and make sure it's syntactically valid.
# 4 blocks: the small inline dark/light-theme-restore script in gui_shell.html's
# own <head> (there before any of the rest, to avoid a flash of the wrong
# theme on load - see the comment right above it), then asm_engine, sim_engine,
# and part1+part2 combined.
scripts = re.findall(r"<script>(.*?)</script>", final, re.S)
assert len(scripts) == 4, f"expected 4 <script> blocks, found {len(scripts)}"
(DIST / "_app_check.js").write_text(scripts[-1], encoding="utf-8")

print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")
print("Run: node --check dist/_app_check.js   (to verify JS syntax)")
