# Third-party notices

This project is a browser port of **EASy68K**, a Motorola 68000
assembler/simulator/IDE originally written for Windows. The files under
`src/engine-asm/` and `src/engine-sim/` are the real EASy68K assembler and
simulator source (Borland C++ Builder), used here **essentially
unmodified**: the actual assembly/simulation logic - parsing, code
generation, the instruction interpreter, TRAP #15 task dispatch - is the
original code. Only the parts of the original program that a browser
fundamentally cannot have were touched:

- The Win32 GUI layer (`TsimIO`, the original's window/GDI-drawing class)
  is replaced by `src/engine-sim/simio_stub.h`, which calls out to
  JavaScript instead of GDI. What each TRAP #15 task *does* is unchanged;
  only how pixels/text/sound actually reach the screen is redirected.
- A small C-linkage adapter, `wasm_api.cpp` (one per engine), exposes the
  engines to JavaScript via Emscripten. This adapter is new code written
  for this port and is covered by `LICENSE`, not this notice.

No other change was made to the original assembler/simulator source files.

## Authorship, as found in the source itself

The source files carry their own author headers, reproduced here rather
than summarized, since that's the only authorship record that came with
the code:

- **Paul McKee** — the original 68000 assembler (`ECE492`, North Carolina
  State University, 1986) - credited in `src/engine-asm/ASSEMBLE.CPP`'s own
  header comment.
- **Charles "Chuck" Kelly** — EASy68K itself (assembler updates and the
  simulator), <http://www.easy68k.com/> - credited via a `Modified:` /
  `Modified by:` line (the exact wording varies slightly by file) in
  `ASSEMBLE.CPP` and in the header of essentially every file under
  `src/engine-sim/` (`CODE1.CPP` through `CODE9.CPP`, `RUN.CPP`, `def.h`,
  and others).
- **Jorge Cwik** (`pasti@fxatari.com`) — a DIVU/DIVS instruction-timing
  subroutine embedded in `src/engine-sim/CODE4.CPP`, which carries its own
  explicit **GNU General Public License v2 (or later)** notice, reproduced
  below verbatim since it's the one piece of this codebase with unambiguous
  license terms:

  > Copyright (c) 2005 by Jorge Cwik, pasti@fxatari.com
  >
  > This is free software; you can redistribute it and/or modify
  > it under the terms of the GNU General Public License as published by
  > the Free Software Foundation; either version 2 of the License, or
  > (at your option) any later version.
  >
  > This software is distributed in the hope that it will be useful,
  > but WITHOUT ANY WARRANTY; without even the implied warranty of
  > MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  > GNU General Public License for more details.
  >
  > You should have received a copy of the GNU General Public License
  > along with this software; if not, write to the Free Software
  > Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA 02111-1307 USA

  That GPLv2 notice covers that one file (`CODE4.CPP`) specifically, since
  that's the scope of the notice as written into the source.

## What we could not confirm

Despite checking every source file for a header, footer, or accompanying
document, **no license or copyright statement covering the EASy68K project
as a whole was found anywhere in the source as obtained** - no `LICENSE`,
`COPYING`, or equivalent file shipped with it, and no blanket statement in
any of the `.CPP`/`.h` file headers beyond the per-file "Modified by"
authorship lines above. We also could not independently verify terms from
<http://www.easy68k.com/> itself (a TLS certificate mismatch on the site
prevented an automated check at the time this was written).

If you know the actual distribution terms EASy68K is published under
(easy68k.com may state them directly, or Charles Kelly may be reachable to
confirm), please open an issue or PR updating this file - this notice
intentionally states only what could be directly confirmed from the source
code itself, rather than assuming a license that was never actually found.

## This port's own code

Everything else in this repository - the WebAssembly adapters
(`wasm_api.cpp` in both engine directories), `simio_stub.h`, the entire
`src/web/` frontend, the build tooling, and the test suite - is new code
written for this port and is covered by the MIT license in `LICENSE`, not
by anything above.

Portions of this port's own code (the WebAssembly adapter layers and the
browser frontend) were developed with the assistance of
[Claude Code](https://claude.com/claude-code) (Anthropic).
