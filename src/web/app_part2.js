/* =========================================================================
   UI
   ========================================================================= */
(function initUI(){
  const $ = sel => document.querySelector(sel);
  let sourceEl = $('#source');
  let gutterEl = $('#gutter');
  let highlightEl = $('#highlightLayer');
  let editorStackEl = $('.editor-stack');
  const editorLockTag = $('#editorLockTag');
  const cursorPosInfoEl = $('#cursorPosInfo');
  const messagesEl = $('#messages');
  const syslogEl = $('#syslog');
  const gfxCanvas = $('#gfxCanvas');
  const gfxCtx = gfxCanvas.getContext('2d');
  gfxCtx.imageSmoothingEnabled = false;
  const backCanvas = document.createElement('canvas');
  backCanvas.width = 640; backCanvas.height = 480;
  const backCtx = backCanvas.getContext('2d', {willReadFrequently:true});
  backCtx.imageSmoothingEnabled = false;
  const regsGridD1El = $('#regsGridD1'), regsGridD2El = $('#regsGridD2'), regsGridA1El = $('#regsGridA1'), regsGridA2El = $('#regsGridA2');
  const pcValEl = $('#pcVal');
  const flagsRowEl = $('#flagsRow');
  const srValEl = $('#srVal');
  const intMaskValEl = $('#intMaskVal');
  const runtimeInfoEl = $('#runtimeInfo');
  const statusDot = $('#statusDot');
  const statusText = $('#statusText');
  const engineTag = $('#engineTag');
  const hexdumpEl = $('#hexdump');
  // Fixed header row above the memory hexdump: "Address" lines up with the
  // "$XXXXXX  " address column (7 hex-address chars + 2 spaces = 9, same
  // width as the literal "Address" label), each column header lines up
  // with that byte column's "XX " 3-char cell, and the ASCII header lines
  // up 1-for-1 with the 16 single-char ASCII cells - built programmatically
  // from the same widths renderHexdump() uses below, rather than hand-typed,
  // so the two can never drift out of alignment with each other.
  {
    const hexdumpHeaderEl = $('#hexdumpHeader');
    if(hexdumpHeaderEl){
      let cols = '';
      for(let c=0;c<16;c++) cols += ` ${c.toString(16).toUpperCase()} `;
      hexdumpHeaderEl.textContent = `Address  ${cols} 0123456789ABCDEF`;
    }
  }
  const memAddrEl = $('#memAddr');
  const symTableEl = $('#symTable');
  const fileTreeEl = $('#fileTree');

  const btnAssemble = $('#btnAssemble');
  const btnRun = $('#btnRun');
  const btnStep = $('#btnStep');
  const btnStepOver = $('#btnStepOver');
  const btnStop = $('#btnStop');
  const btnReset = $('#btnReset');
  const btnCommentOut = $('#btnCommentOut');
  const btnCommentIn = $('#btnCommentIn');
  const btnRemoveTrailingSpaces = $('#btnRemoveTrailingSpaces');
  const btnHelp = $('#btnHelp'), btnHelpClose = $('#btnHelpClose'), helpFloatWindow = $('#helpFloatWindow');

  /* ---- dark/light theme toggle (to_do.md: "dark theme (exactly the
     current one) and light theme"). All of the actual color values live
     in CSS (:root vs :root[data-theme="light"], gui_shell.html) - this is
     just the toggle button + persistence. A separate, tiny inline <script>
     in gui_shell.html's own <head> already applies any saved preference
     before the page first paints (avoiding a flash of the wrong theme,
     since this script only runs after the whole body has already rendered
     once) - this block re-derives the SAME state from the `data-theme`
     attribute that script just set, rather than re-reading localStorage
     itself, so the two can never disagree with each other. ---- */
  const btnThemeToggle = $('#btnThemeToggle');
  const iconThemeMoon = $('#iconThemeMoon'), iconThemeSun = $('#iconThemeSun');
  function applyTheme(theme){
    if(theme === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
    // .style.display, not .hidden - the `hidden` IDL property/attribute has
    // no rendering effect at all on an <svg> element in real Chrome (only
    // HTMLElement reflects it) - confirmed directly, not assumed; see the
    // CLAUDE.md gotcha this discovery produced.
    iconThemeMoon.style.display = theme === 'light' ? 'none' : '';
    iconThemeSun.style.display = theme === 'light' ? '' : 'none';
    btnThemeToggle.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    try{ localStorage.setItem('easy68k-theme', JSON.stringify(theme)); }catch(e){}
  }
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  btnThemeToggle.addEventListener('click', ()=>{
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  });

  let memBase = 0x1000;
  // Clamps a candidate memBase to [0, 0xFFFFFF] BEFORE any >>>0 coercion -
  // a plain `(memBase - pageBytes) >>> 0` on a negative result wraps to a
  // huge unsigned number close to 0xFFFFFFFF, which downstream code then
  // clamped only from above (Math.min(x, 0xFFFFFF)), landing on ~0xFFFFF0
  // instead of stopping at 0 - reported as "scrolling up doesn't stop at
  // 000000 but at FFFFF0". Math.trunc (not >>>0) is what correctly handles
  // the negative case.
  function clampMemBase(a){ a = Math.trunc(Number(a)); if(!isFinite(a) || a<0) a=0; else if(a>0xFFFFFF) a=0xFFFFFF; return a; }
  const uploadedFiles = []; // {path, size}
  let currentVirtualPath = null; // path (in the virtual FS) of the file currently shown in the editor - null means "no file open" (the app deliberately starts with nothing open; see the startup block near the end of this IIFE)
  // The exact text last LOADED into sourceEl from the VFS for the
  // currently-open file (or, for a brand-new file, the exact content it was
  // created with) - null when nothing is open. persistCurrentToVFS() uses
  // this as the baseline to detect a genuine edit vs. no edit at all; see
  // its own comment and textareaNormalizeNewlines() below for why a plain
  // `sourceEl.value === this` check isn't enough.
  let currentFileRawText = null;
  // A real <textarea>'s .value getter normalizes every CRLF and lone CR to
  // a bare LF - a browser/DOM-spec behavior (confirmed empirically, not
  // assumed: setting `.value` to a string containing "\r\n" and reading it
  // straight back already returns "\n", with no user interaction at all),
  // not something this app's code does or can prevent. Mirrors that exact
  // normalization so a JS string can be compared against whatever a
  // textarea would show it as, without needing a real DOM element.
  function textareaNormalizeNewlines(s){ return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
  // Maps "N characters into textareaNormalizeNewlines(raw)" to "how many
  // bytes into raw produced those N characters" - i.e. rawIndexAtNorm[i] is
  // the index into raw right after whichever raw bytes produced the first i
  // normalized characters (a \r\n pair consumes 2 raw bytes for 1 normalized
  // character; anything else, including a lone \r, consumes 1-for-1). Used
  // by mergeEditIntoRaw() below to recover the ORIGINAL (CR-preserving)
  // bytes for any prefix/suffix of a file a genuine edit didn't touch.
  function buildRawNormMap(raw){
    const rawIndexAtNorm = [0];
    let r = 0;
    while(r < raw.length){
      if(raw[r] === '\r' && raw[r+1] === '\n') r += 2;
      else r += 1;
      rawIndexAtNorm.push(r);
    }
    return rawIndexAtNorm;
  }
  // A textarea can never contain a real \r (see textareaNormalizeNewlines()'s
  // own comment) - so once a file WITH real \r bytes (e.g. one a TRAP #15
  // program wrote with explicit 13,10 line endings) gets genuinely edited,
  // naively persisting sourceEl.value verbatim would silently strip every
  // \r from the WHOLE file, not just wherever the edit actually happened -
  // the same corruption persistCurrentToVFS()'s no-op-switch guard already
  // prevents for the zero-edit case, resurfacing the instant a real edit is
  // made anywhere in the file (to_do.md: fixed for "just open, no need to
  // modify", broke again for "I changed ÍÑIGO to ANTÓN"). This reconstructs
  // a new raw file instead of trusting the textarea wholesale: for the
  // common, UNCHANGED prefix and suffix around the edit (found the same way
  // a simple diff would - longest common prefix of the normalized-original
  // and the edited value, then longest common suffix of what's left), the
  // ORIGINAL raw bytes (CR included) are reused verbatim via
  // buildRawNormMap()'s index mapping; only the genuinely-edited middle
  // span uses the new (unavoidably LF-only, since that's all a textarea can
  // ever produce) text. A single localized edit - the common case, and
  // exactly what to_do.md's own repro was (one word replaced) - is handled
  // exactly right, preserving every \r elsewhere in the file untouched.
  function mergeEditIntoRaw(rawOriginal, editedValue){
    const normalized = textareaNormalizeNewlines(rawOriginal);
    if(editedValue === normalized) return rawOriginal; // no genuine edit at all
    let prefixLen = 0;
    const maxPrefix = Math.min(normalized.length, editedValue.length);
    while(prefixLen < maxPrefix && normalized[prefixLen] === editedValue[prefixLen]) prefixLen++;
    let suffixLen = 0;
    const maxSuffix = Math.min(normalized.length, editedValue.length) - prefixLen;
    while(suffixLen < maxSuffix && normalized[normalized.length-1-suffixLen] === editedValue[editedValue.length-1-suffixLen]) suffixLen++;
    const rawIndexAtNorm = buildRawNormMap(rawOriginal);
    const rawPrefixEnd = rawIndexAtNorm[prefixLen];
    const rawSuffixStart = rawIndexAtNorm[normalized.length - suffixLen];
    return rawOriginal.slice(0, rawPrefixEnd) + editedValue.slice(prefixLen, editedValue.length - suffixLen) + rawOriginal.slice(rawSuffixStart);
  }
  // Emscripten's FS.readFile(path, {encoding:'utf8'}) decodes via
  // UTF8ArrayToString() called with NO length limit, which then treats the
  // buffer as a NUL-TERMINATED C STRING - its scan loop only stops at the
  // first byte equal to 0, exactly a C strlen() scan - silently dropping
  // that byte and everything after it. A project file routinely DOES
  // contain a genuine embedded NUL: EASy68K's own `DC.B '...',0`
  // string-literal convention is a NUL-terminated string, and it's
  // completely ordinary for a TRAP #15 program to write exactly that
  // pattern to a file the user later opens in this editor. This was
  // invisible for a long time whenever the NUL happened to sit at the very
  // end of a file (nothing visible to lose) - to_do.md's own "I inspected
  // the 68000 memory... and the zero was not there" report is what actually
  // surfaced it: the truncated text became the baseline
  // persistCurrentToVFS()/mergeEditIntoRaw() compare future edits against,
  // so even a later, otherwise byte-perfect merge could never restore a
  // byte the read itself had already thrown away before the file was ever
  // edited. Reads the real, complete bytes instead and decodes them as
  // UTF-8 without any length-based truncation - every call site that loads
  // a project file's TEXT for the editor (never binary assets, which stay
  // untouched raw bytes throughout) should go through this, not a raw
  // `FS.readFile(path, {encoding:'utf8'})` call.
  function readVfsTextFile(FS, path){
    const bytes = FS.readFile(path, {encoding:'binary'});
    return new TextDecoder('utf-8').decode(bytes);
  }
  let appMode = 'editing'; // 'editing' | 'simulating' - drives the mode indicator badge and the Play/Pause button's behavior
  let currentFileName = 'No file open';
  let currentFileHandle = null; // File System Access API handle, when available

  /* ---- audio: single "standard player" channel, matching the real
     controlSound semantics (only one sound plays at a time; games are
     expected to stop before playing a new one, which is exactly what
     YAP's AUDPLAY does). ---- */
  let audioCtx = null;
  function getAudioCtx(){
    if(!audioCtx){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    return audioCtx;
  }
  // Browsers block audio until a real user gesture; resume on the first
  // click/keypress anywhere on the page.
  ['click','keydown','mousedown'].forEach(evt=>{
    window.addEventListener(evt, ()=>{ const c=getAudioCtx(); if(c&&c.state==='suspended') c.resume().catch(()=>{}); }, {once:false, passive:true});
  });
  const soundSlots = {}; // slot -> decoded AudioBuffer (persists across play/stop)
  let currentSource = null, currentWaveSlot = -1;
  function readVirtualFile(path){
    try{ return machine.simEngine.FS.readFile(path); } // Uint8Array
    catch(e){ return null; }
  }
  function stopCurrent(){
    if(currentSource){ try{ currentSource.stop(); }catch(e){} currentSource=null; }
  }
  function resetSounds(){
    stopCurrent();
    for(const k of Object.keys(soundSlots)) delete soundSlots[k];
  }
  function playSlot(slot, loop){
    const buf = soundSlots[slot];
    const ctx = getAudioCtx();
    if(!buf || !ctx) return;
    stopCurrent();
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = !!loop;
    src.connect(ctx.destination);
    src.start();
    currentSource = src; currentWaveSlot = slot;
  }
  async function decodeAndPlay(bytes){
    const ctx = getAudioCtx();
    if(!ctx || !bytes) return;
    try{
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength);
      const buf = await ctx.decodeAudioData(ab);
      stopCurrent();
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start();
      currentSource = src; currentWaveSlot = -1;
    }catch(e){ console.error('sound decode/play failed', e); }
  }

  /* ---- simHost: the real bridge TRAP #15 dispatch calls into.
     Text and graphics share the SAME canvas, exactly like real EASy68K:
     charOut/textOut draw glyphs at row*rowHeight, col*colWidth; graphics
     primitives draw pixels directly. Row/col cursor logic, control
     characters, and scrolling all live in the ported C++ (simio_stub.h);
     this object supplies only drawing primitives + font metrics. ----

     Text is rendered from a real embedded bitmap font (8x16 pixels/char,
     the classic VGA text-mode size - moderndos-8x16 from the pcface
     project, MIT/CC0 licensed, public-domain-equivalent), blitted pixel
     by pixel exactly like real old computers and consoles did, instead of
     relying on however a browser happens to render some named system
     font. This guarantees the exact same crisp, correctly-sized glyphs
     everywhere, matching the real EASy68K look, rather than approximating
     it with CSS.

     4 of the 256 cells (bytes 226, 231, 232, 233 - originally real CP437's
     Γ, τ, Φ, Θ) were hand-patched to instead draw capital Á, Ú, Ó, Í - see
     the CP437_UPPER comment in app_part1.js for the full reasoning (this
     is a Spanish-language teaching tool; real CP437 has no capital
     accented Spanish vowels at all except É, and the maintainer explicitly
     chose 4 synthetic glyphs over always showing '?' for a student's own
     name). Every other one of the 256 cells is the genuine, unmodified
     moderndos-8x16 CP437 glyph.

     A first version of these 4 synthetic glyphs got the baseline wrong: it
     took the unaccented letter's ORIGINAL 10-row shape (rows 2-11) and
     shifted the whole thing down one row (to rows 3-12) to make room for
     the 3-row accent stroke above it - which visibly drops that one letter
     below the baseline every other character (including the pre-existing
     É) sits on, since É's own accent construction instead COMPRESSES the
     letter by one row (rows 3-11, not rows 2-11) rather than shifting it.
     Re-derived Á/Ú/Ó/Í the same way É already does it: keep the letter's
     bottom row pinned to row 11 (the shared baseline every glyph in this
     font uses) and drop ONE row out of the letter's own body - a
     duplicated/near-duplicate middle row, invisible at this resolution -
     to free up exactly the 3 rows (0-2) the accent stroke needs. If you
     ever add a 5th/6th synthetic accented glyph, copy this construction
     (compress, don't shift) or you'll reintroduce the exact baseline bug
     this fixed. */
  const FONT_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAfoGlgYG9mYGBfgAAAAAAAH7/2///w+f//34AAAAAAAAAAGzu/v7+fDgQAAAAAAAAAAAQOHz+/nw4EAAAAAAAAAAYPDxa//9aGDwAAAAAAAAAEDh8/v7uVBA4AAAAAAAAAAAAABg8PBgAAAAAAAD////////nw8Pn////////AAAAAAA8ZkJCZjwAAAAAAP//////w5m9vZnD//////8AAB4OGjB4zMzMzHgAAAAAAAA8ZmZmZjwYfhgYAAAAAAAIDAoKCggICHj4cAAAAAAAEBgUEhoWEhJy8mIOHhwAAAAAEJJ8bMZsfJIQAAAAAAAAAIDA4Pj++ODAgAAAAAAAAAACBg4+/j4OBgIAAAAAAAAQOHzWEBDWfDgQAAAAAAAAZmZmZmZmZgBmZgAAAAAAAH/b29vbexsbGxsAAAAAAHzGYDhsxsZsOAzGfAAAAAAAAAAAAAAA/v7+/gAAAAAAABA4fNYQENZ8OBD+AAAAAAAQOHzWEBAQEBAQAAAAAAAAEBAQEBAQ1nw4EAAAAAAAAAAAEBgM/gwYEAAAAAAAAAAAABAwYP5gMBAAAAAAAAAAAAAAAMDAwP4AAAAAAAAAAAAAACRC/0IkAAAAAAAAAAAAABA4OHx8/v4AAAAAAAAAAAD+/nx8ODgQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYPDw8GBgYABgYAAAAAABmZiIiAAAAAAAAAAAAAAAAAAAAbGz+bGz+bGwAAAAAABAQfNbWcDgc1tZ8EBAAAAAAYJKWbBgwbNKSDAAAAAAAADhsbDgwdtzMzHYAAAAAABgYCBAAAAAAAAAAAAAAAAAADBgwMDAwMDAYDAAAAAAAADAYDAwMDAwMGDAAAAAAAAAAAABmPP88ZgAAAAAAAAAAAAAAGBh+GBgAAAAAAAAAAAAAAAAAAAAAMDAQIAAAAAAAAAAAAP4AAAAAAAAAAAAAAAAAAAAAAAAwMAAAAAAAAAACBgwYMGDAgAAAAAAAAAB8xsbO3vbmxsZ8AAAAAAAAGDh4GBgYGBgYfgAAAAAAAHzGBgwYMGDAxv4AAAAAAAB8xgYGPAYGBsZ8AAAAAAAADBw8bMzM/gwMHgAAAAAAAP7AwMD8BgYGxnwAAAAAAAB8xsDA/MbGxsZ8AAAAAAAA/sYGBgwYMDAwMAAAAAAAAHzGxsZ8xsbGxnwAAAAAAAB8xsbGxn4GBsZ8AAAAAAAAAAAYGAAAABgYAAAAAAAAAAAAGBgAAAAYGAgQAAAAAAAABgwYMGAwGAwGAAAAAAAAAAAAfgAAfgAAAAAAAAAAAABgMBgMBgwYMGAAAAAAAAB8xsYGDBgYABgYAAAAAAAAADxCnaWlrbZAPAAAAAAAADhsxsbG/sbGxsYAAAAAAAD8ZmZmfGZmZmb8AAAAAAAAfMbGwMDAwMbGfAAAAAAAAPxmZmZmZmZmZvwAAAAAAAD+ZmJoeHhoYmb+AAAAAAAA/mZiaHh4aGBg8AAAAAAAAHzGxsDAzsbGxn4AAAAAAADGxsbG/sbGxsbGAAAAAAAAPBgYGBgYGBgYPAAAAAAAAB4MDAwMDAzMzHgAAAAAAADmZmZseHhsZmbmAAAAAAAA8GBgYGBgYGJm/gAAAAAAAILG7v7+1sbGxsYAAAAAAACGxub2/t7OxsbGAAAAAAAAfMbGxsbGxsbGfAAAAAAAAPxmZmZmfGBgYPAAAAAAAAB8xsbGxsbG1t58BgAAAAAA/GZmZmZ8bGZm5gAAAAAAAHzGxmA4DAbGxnwAAAAAAAB+floYGBgYGBg8AAAAAAAAxsbGxsbGxsbGfAAAAAAAAMbGxsbGxsZsOBAAAAAAAADGxsbGxtb+7saCAAAAAAAAxsZsfDg4fGzGxgAAAAAAAGZmZmY8GBgYGDwAAAAAAAD+xoYMGDBgwsb+AAAAAAAAPDAwMDAwMDAwPAAAAAAAAACAwGAwGAwGAgAAAAAAAAA8DAwMDAwMDAw8AAAAAAAAEDhsxgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wAAABgYEAgAAAAAAAAAAAAAAAAAAAAAeAx8zMzMdgAAAAAAAOBgYHxmZmZmZnwAAAAAAAAAAAB8xsDAwMZ8AAAAAAAAHAwMfMzMzMzMdgAAAAAAAAAAAHzGxv7AxnwAAAAAAAAcNjB8MDAwMDB4AAAAAAAAAAAAdszMzMzMfAzMeAAAAOBgYGx2ZmZmZuYAAAAAAAAYGAA4GBgYGBg8AAAAAAAADAwAHAwMDAwMDMzMeAAAAOBgYGZseHhsZuYAAAAAAAA4GBgYGBgYGBg8AAAAAAAAAAAA7P7W1tbWxgAAAAAAAAAAANxmZmZmZmYAAAAAAAAAAAB8xsbGxsZ8AAAAAAAAAAAA3GZmZmZmfGBg8AAAAAAAAHzMzMzMzHwMDB4AAAAAAADedmBgYGDwAAAAAAAAAAAAfMZgOAzGfAAAAAAAABAwMPwwMDAwNBgAAAAAAAAAAADMzMzMzMx2AAAAAAAAAAAAxsbGxmw4EAAAAAAAAAAAAMbW1tbW/mwAAAAAAAAAAADGxmw4bMbGAAAAAAAAAAAAxsbGxsbGfgYM+AAAAAAAAP6MGDBgwv4AAAAAAAAOGBgYcBgYGBgOAAAAAAAAGBgYGAAAGBgYGAAAAAAAAHAYGBgOGBgYGHAAAAAAAAB23AAAAAAAAAAAAAAAAAAAAAAQOGzGxsb+AAAAAAAAAHzGxsDAwMDGxnwQCHAAAADMzADMzMzMzMx2AAAAAAAGDBAAfMbG/sDGfAAAAAAAMHjMAHgMfMzMzHYAAAAAAADMzAB4DHzMzMx2AAAAAADAYBAAeAx8zMzMdgAAAAAAMEgwAHgMfMzMzHYAAAAAAAAAAAB8xsDAwMZ8EAhwAAAYPGYAfMbG/sDGfAAAAAAAAMbGAHzGxv7AxnwAAAAAAMBgEAB8xsb+wMZ8AAAAAAAAZmYAOBgYGBgYPAAAAAAAGDxmADgYGBgYGDwAAAAAAMBgEAA4GBgYGBg8AAAAAMbGADhsxsb+xsbGxgAAAAA4RDg4bMbG/sbGxsYAAAAADBgg/mZiaHhoYmb+AAAAAAAAAAAAfBJynpCSfAAAAAAAAD5qyMjM/MjIys4AAAAAABg8ZgB8xsbGxsZ8AAAAAAAAxsYAfMbGxsbGfAAAAAAAwGAQAHzGxsbGxnwAAAAAADB4zADMzMzMzMx2AAAAAADAYBAAzMzMzMzMdgAAAAAAAMbGAMbGxsbGxn4GDHgAxsYAfMbGxsbGxsZ8AAAAAMbGAMbGxsbGxsbGfAAAAAAAABAQfNbQ0NZ8EBAAAAAAAAA4bGDwYGBgYPLcAAAAAAAAZmZmPBh+GH4YGAAAAAAAAPjMzPjEzN7MzMYAAAAAAAAOGxgYfhgYGBgYGNhwAAAGDBAAeAx8zMzMdgAAAAAABgwQADgYGBgYGDwAAAAAAAYMEAB8xsbGxsZ8AAAAAAAGDBAAzMzMzMzMdgAAAAAAAHbcANxmZmZmZmYAAAAAdtwAhsbm9v7ezsbGAAAAAAA4DDxsNgB+AAAAAAAAAAAAADxmZjwAfgAAAAAAAAAAAAAwMAAwMGDAxsZ8AAAAAAAAAAAAAAD+wMDAAAAAAAAAAAAAAAAA/gYGBgAAAAAAAGDgZGx4MGDctgwYPgAAAABg4GRseDBs3Kw+DAwAAAAAABgYABgYGDw8PBgAAAAAAAAAAAA2bNhsNgAAAAAAAAAAAAAA2Gw2bNgAAAAAAAAiiCKIIogiiCKIIogiiCKIVapVqlWqVapVqlWqVapVqt133Xfdd9133Xfdd9133X8YGBgYGBgYGBgYGBgYGBgYGBgYGBgYGPgYGBgYGBgYGBgYGBgY+Bj4GBgYGBgYGBg2NjY2NjY29jY2NjY2NjY2AAAAAAAAAP42NjY2NjY2NgAAAAAA+Bj4GBgYGBgYGBg2NjY2NvYG9jY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NgAAAAAA/gb2NjY2NjY2NjY2NjY2NvYG/gAAAAAAAAAANjY2NjY2Nv4AAAAAAAAAABgYGBgY+Bj4AAAAAAAAAAAAAAAAAAAA+BgYGBgYGBgYGBgYGBgYGB8AAAAAAAAAABgYGBgYGBj/AAAAAAAAAAAAAAAAAAAA/xgYGBgYGBgYGBgYGBgYGB8YGBgYGBgYGAAAAAAAAAD/AAAAAAAAAAAYGBgYGBgY/xgYGBgYGBgYGBgYGBgfGB8YGBgYGBgYGDY2NjY2NjY3NjY2NjY2NjY2NjY2NjcwPwAAAAAAAAAAAAAAAAA/MDc2NjY2NjY2NjY2NjY29wD/AAAAAAAAAAAAAAAAAP8A9zY2NjY2NjY2NjY2NjY3MDc2NjY2NjY2NgAAAAAA/wD/AAAAAAAAAAA2NjY2NvcA9zY2NjY2NjY2GBgYGBj/AP8AAAAAAAAAADY2NjY2Njb/AAAAAAAAAAAAAAAAAP8A/xgYGBgYGBgYAAAAAAAAAP82NjY2NjY2NjY2NjY2NjY/AAAAAAAAAAAYGBgYGB8YHwAAAAAAAAAAAAAAAAAfGB8YGBgYGBgYGAAAAAAAAAA/NjY2NjY2NjY2NjY2NjY2/zY2NjY2NjY2GBgYGBj/GP8YGBgYGBgYGBgYGBgYGBj4AAAAAAAAAAAAAAAAAAAAHxgYGBgYGBgY/////////////////////wAAAAAAAAD////////////w8PDw8PDw8PDw8PDw8PDwDw8PDw8PDw8PDw8PDw8PD///////////AAAAAAAAAAAAAAAAAHTcyMjI3HYAAAAAAAB4zMzYzMbGxtzAQAAAAAwYIDhsxsb+xsbGxgAAAAAAAAAAAn7sbGxsbEgAAAAAAAD+wmAwGDBgwML+AAAAAAAAAAAAftDIyMjIcAAAAAAAAAAAAMzMzMzMzPiAgAAADBggxsbGxsbGxsZ8AAAAAAwYIHzGxsbGxsbGfAAAAAAMGCA8GBgYGBgYGDwAAAAAAAB8xsbGxsZsKCjuAAAAAAAAPGIwGHzMzMzMeAAAAAAAAAAAAG7b29t2AAAAAAAAAAAAAgZ8zt7W9uZ8wIAAAAAAAAAAPGDA+MBgPAAAAAAAAHzGxsbGxsbGxsYAAAAAAAAAAP4AAP4AAP4AAAAAAAAAAAAYGH4YGAAA/wAAAAAAAABgMBgMGDBgAP4AAAAAAAAADBgwYDAYDAD+AAAAAAAADhsbGBgYGBgYGBgYGBgYGBgYGBgYGBjY2HAAAAAAAAAAABgYAH4AGBgAAAAAAAAAAAAAdtwAdtwAAAAAAAAAOGxsOAAAAAAAAAAAAAAAAAAAAAAAADAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAADwwMDAwM7GxsPBwAAAAAANhsbGxsAAAAAAAAAAAAAAA4TAwYMHwAAAAAAAAAAAAAAAAAfHx8fHx8fAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
  const FONT_BITMAP = (function(){
    const raw = atob(FONT_B64);
    const bytes = new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
    return bytes; // 256 chars x 16 bytes/rows each, byte-indexed (CP437/ASCII code = array index)
  })();
  const GLYPH_W = 8, GLYPH_H = 16;
  let fontFamily = "'Consolas', monospace"; // kept only for non-graphics UI text elsewhere in the app
  let fontScale = 1; // integer scale factor for the bitmap font (1 = native 8x16)
  let fontColorCss = 'rgb(255,255,255)';
  let fontBold=false, fontItalic=false, fontUnderline=false, fontStrike=false;
  let penColorCss = 'rgb(255,255,255)', fillColorCss = 'rgb(0,0,0)', penWidth = 1;
  let penX = 0, penY = 0; // current pen position, for the moveTo/lineTo polyline drawing pattern

  /* ---- pixel-perfect drawing primitives (no anti-aliasing) ----
     Canvas 2D's stroke()/ellipse() always anti-alias; plotting individual
     pixel rects avoids that entirely, matching real GDI's hard-edged
     output and making exact-match flood fill (real Borland semantics:
     FloodFill(x,y,color,fsSurface)) work correctly instead of leaking
     through blended edge pixels. */
  function plotDot(ctx, x, y, color, width){
    ctx.fillStyle = color;
    if(width<=1) ctx.fillRect(x, y, 1, 1);
    else { const o=Math.floor(width/2); ctx.fillRect(x-o, y-o, width, width); }
  }
  // A program that prints a lot of text (most notably one using the SR
  // trace bit's own TRACE exception vector to run a "clear screen, print a
  // value" routine after literally every single main-program instruction -
  // see EINTI02.X68-style trace demos) used to visibly crawl compared to
  // real EASy68K, even though the CPU core itself executes such a program
  // at full native WASM batch speed with no extra JS<->WASM crossings per
  // instruction. The actual bottleneck was here: blitGlyph used to plot
  // every lit pixel of an 8x16 glyph as its own ctx.fillRect() call - up to
  // 128 real Canvas2D calls per CHARACTER drawn, cheap for an occasional
  // status line but ruinous for thousands of redraws/sec. Pre-rendering
  // each color's full 256-glyph set into an offscreen "atlas" canvas ONCE
  // (still built via the same per-pixel fillRect loop, just done a single
  // time per distinct color instead of on every draw) lets every actual
  // character draw become a single ctx.drawImage() call instead - the
  // same optimization real font/sprite rendering always uses. This only
  // touches TEXT glyph drawing - the pixel/line/shape primitives games
  // like YAR/YAP actually use (drawPixel, lineTo, floodFill, etc.) are
  // untouched, so their draw performance/behavior is unaffected.
  const GLYPH_ATLAS_COLS = 16, GLYPH_ATLAS_ROWS = 16; // 256 glyphs, 16x16 grid
  const glyphAtlasCache = new Map(); // fontColorCss -> {canvas, ctx, built:Uint8Array(256)}
  // Builds a color's atlas cell for ONE glyph the first time that exact
  // (color, code) pair is actually drawn, not all 256 up front. An earlier
  // version of this optimization built the full 256-glyph set eagerly on
  // the atlas's first use (still a one-time cost, so overall session
  // throughput was genuinely higher than the old per-pixel-every-draw
  // approach) - but "one-time" landed as one big synchronous ~32,000-
  // fillRect stall on whatever the FIRST character draw of the session
  // happened to be, which for most programs (games included) is their
  // very first title/score text, right after Run - to_do.md reported this
  // as new lag "between I press ASSEMBLE AND EXECUTE and the game starts"
  // even though nothing about steady-state gameplay drawing got slower.
  // Building lazily per-glyph spreads that cost across whichever distinct
  // characters actually get printed, as they're first encountered, instead
  // of eagerly paying for glyphs (e.g. rare box-drawing/accented codes)
  // that particular program never even uses - strictly less total work for
  // any real program, and no more front-loaded than the single glyph its
  // first draw call actually needs.
  function getGlyphAtlasEntry(color){
    let entry = glyphAtlasCache.get(color);
    if(entry) return entry;
    const cnv = document.createElement('canvas');
    cnv.width = GLYPH_ATLAS_COLS*GLYPH_W; cnv.height = GLYPH_ATLAS_ROWS*GLYPH_H;
    const actx = cnv.getContext('2d');
    actx.fillStyle = color;
    entry = { canvas: cnv, ctx: actx, built: new Uint8Array(256) };
    glyphAtlasCache.set(color, entry);
    return entry;
  }
  function ensureGlyphBuilt(entry, code){
    if(entry.built[code]) return;
    entry.built[code] = 1;
    const ox = (code % GLYPH_ATLAS_COLS) * GLYPH_W, oy = Math.floor(code / GLYPH_ATLAS_COLS) * GLYPH_H;
    const off = code*GLYPH_H;
    for(let row=0; row<GLYPH_H; row++){
      const bits = FONT_BITMAP[off+row];
      if(!bits) continue;
      for(let col=0; col<GLYPH_W; col++){
        if(bits & (0x80 >> col)) entry.ctx.fillRect(ox+col, oy+row, 1, 1);
      }
    }
  }
  function blitGlyph(ctx, x, y, code){
    code = code & 0xFF;
    const entry = getGlyphAtlasEntry(fontColorCss);
    ensureGlyphBuilt(entry, code);
    const sx = (code % GLYPH_ATLAS_COLS) * GLYPH_W, sy = Math.floor(code / GLYPH_ATLAS_COLS) * GLYPH_H;
    const dw = GLYPH_W*fontScale, dh = GLYPH_H*fontScale;
    const boldOffsets = fontBold ? [0,1] : [0]; // synthetic bold: draw twice, 1px to the right
    for(const bo of boldOffsets){
      ctx.drawImage(entry.canvas, sx, sy, GLYPH_W, GLYPH_H, x+bo, y, dw, dh);
    }
  }
  function plotLine(ctx, x0, y0, x1, y1, color, width){
    x0=Math.round(x0); y0=Math.round(y0); x1=Math.round(x1); y1=Math.round(y1);
    const dx = Math.abs(x1-x0), sx = x0<x1?1:-1;
    const dy = -Math.abs(y1-y0), sy = y0<y1?1:-1;
    let err = dx+dy;
    ctx.fillStyle = color;
    while(true){
      plotDot(ctx, x0, y0, color, width);
      if(x0===x1 && y0===y1) break;
      const e2 = 2*err;
      const stepX = e2>=dy, stepY = e2<=dx;
      if(stepX && stepY){
        // Diagonal step: both x and y move this iteration, which leaves
        // the two pixels touching only at a corner (8-connected, not
        // 4-connected). A 4-connected flood fill (matching real GDI
        // FloodFill) can leak straight through that gap, so bridge it.
        plotDot(ctx, x0+sx, y0, color, width);
      }
      if(stepX) { err+=dy; x0+=sx; }
      if(stepY) { err+=dx; y0+=sy; }
    }
  }
  function plotRectOutline(ctx, x, y, w, h, color, width){
    plotLine(ctx, x,y, x+w,y, color, width);
    plotLine(ctx, x,y+h, x+w,y+h, color, width);
    plotLine(ctx, x,y, x,y+h, color, width);
    plotLine(ctx, x+w,y, x+w,y+h, color, width);
  }
  // Midpoint ellipse: plots the outline pixel-perfectly; for filled
  // ellipses, fills each scanline between the mirrored boundary points.
  // Per-row rasterization (not a midpoint/Bresenham stepping algorithm) -
  // computing every row's boundary directly guarantees no row is ever
  // skipped, and bridging horizontal jumps between adjacent rows
  // guarantees no diagonal gap either. This matters a lot here: a
  // midpoint ellipse algorithm can produce outline pixels that only touch
  // diagonally (confirmed: ~14% of outline pixels in a test case had no
  // 4-connected neighbor), and since flood fill correctly uses 4-way
  // connectivity (matching real GDI FloodFill), it could leak straight
  // through those gaps - this was very likely the real cause of YAP/YAR's
  // title screen only showing a single flat color.
  function plotEllipse(ctx, bx, by, w, h, penColor, fillColor, filled, penWidth){
    const rx = Math.max(1,Math.round(w/2)), ry = Math.max(1,Math.round(h/2));
    const cx = bx+rx, cy = by+ry;
    const rowSpan = new Map(); // y -> [minX, maxX]
    function mark(x,y){
      const cur = rowSpan.get(y);
      if(!cur) rowSpan.set(y, [x,x]);
      else { if(x<cur[0]) cur[0]=x; if(x>cur[1]) cur[1]=x; }
    }
    let prevXR = null;
    for(let dy=-ry; dy<=ry; dy++){
      const t = 1 - (dy*dy)/(ry*ry);
      const xr = t>0 ? Math.round(rx*Math.sqrt(t)) : 0;
      mark(cx+xr, cy+dy); mark(cx-xr, cy+dy);
      if(prevXR!==null){
        const lo = Math.min(prevXR, xr), hi = Math.max(prevXR, xr);
        for(let xx=lo; xx<=hi; xx++){
          mark(cx+xx, cy+dy); mark(cx+xx, cy+dy-1);
          mark(cx-xx, cy+dy); mark(cx-xx, cy+dy-1);
        }
      }
      prevXR = xr;
    }
    if(filled){
      ctx.fillStyle = fillColor;
      for(const [yy,[minX,maxX]] of rowSpan) ctx.fillRect(minX, yy, maxX-minX+1, 1);
    }
    ctx.fillStyle = penColor;
    for(const [yy,[minX,maxX]] of rowSpan){ plotDot(ctx,minX,yy,penColor,penWidth); plotDot(ctx,maxX,yy,penColor,penWidth); }
  }

  const outputFloatWindowEl = document.getElementById('outputFloatWindow');
  let outputWindowKnownVisible = false;
  // Called unconditionally by every drawing primitive below, regardless of
  // its own alsoVisible flag - alsoVisible only controls whether THIS draw
  // also lands on the visible canvas right now (real double-buffer
  // semantics), not whether the window should open. A program drawing
  // only to the hidden back buffer still has visible output coming (the
  // next repaint()/flip), so the window must open for that too.
  function ensureOutputVisible(){
    if(outputWindowKnownVisible) return; // fast path: already visible, skip the DOM touch entirely
    if(window.__suppressOutputAutoShow) return;
    if(outputFloatWindowEl && outputFloatWindowEl.hidden){ outputFloatWindowEl.hidden = false; resetGfxCanvasToNativeSize(); }
    outputWindowKnownVisible = true;
  }
  const simHost = {
    showHardwareWindow(){
      const win = document.getElementById('hwFloatWindow');
      if(win) win.hidden = false;
    },
    setFullscreen(on){
      const pane = document.getElementById('outputFloatWindow');
      if(on){
        if(pane && pane.requestFullscreen) pane.requestFullscreen().catch(()=>{});
      } else {
        if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
      }
    },
    clearBlack(alsoVisible){
      backCtx.fillStyle='#000'; backCtx.fillRect(0,0,backCanvas.width,backCanvas.height);
      if(alsoVisible){ gfxCtx.fillStyle='#000'; gfxCtx.fillRect(0,0,gfxCanvas.width,gfxCanvas.height); }
    },
    fillBlackRect(x,y,w,h,alsoVisible){
      backCtx.fillStyle='#000'; backCtx.fillRect(x,y,w,h);
      if(alsoVisible){ gfxCtx.fillStyle='#000'; gfxCtx.fillRect(x,y,w,h); }
    },
    // used only by text scrolling (scroll()/scrollRect()) - a real pixel copy,
    // but confined to the small scrolled region, not the whole canvas
    copyRectBack(dx,dy,sx,sy,w,h){
      if(w<=0||h<=0) return;
      const img = backCtx.getImageData(sx,sy,w,h);
      backCtx.putImageData(img,dx,dy);
    },
    copyRectVisible(dx,dy,sx,sy,w,h){
      if(w<=0||h<=0) return;
      const img = gfxCtx.getImageData(sx,sy,w,h);
      gfxCtx.putImageData(img,dx,dy);
    },
    drawChar(x,y,ch,alsoVisible){
      ensureOutputVisible();
      blitGlyph(backCtx, x, y, ch);
      if(alsoVisible) blitGlyph(gfxCtx, x, y, ch);
      if(fontUnderline || fontStrike){
        const w = GLYPH_W*fontScale;
        const ly = fontUnderline ? y+GLYPH_H*fontScale-fontScale : y+Math.floor(GLYPH_H*fontScale/2);
        backCtx.fillStyle = fontColorCss; backCtx.fillRect(x, ly, w, fontScale);
        if(alsoVisible){ gfxCtx.fillStyle = fontColorCss; gfxCtx.fillRect(x, ly, w, fontScale); }
      }
    },
    beep(){
      const ctx = getAudioCtx(); if(!ctx) return;
      try{
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 750; g.gain.value = 0.1;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime+0.1);
      }catch(e){}
    },
    // explicit full flip (TRAP task 94 only) - real Canvas->Draw(0,0,BackBuffer)
    repaint(){
      ensureOutputVisible();
      gfxCtx.clearRect(0,0,gfxCanvas.width,gfxCanvas.height); gfxCtx.drawImage(backCanvas,0,0);
    },
    getRowHeight(){ return GLYPH_H*fontScale; },
    getColWidth(){ return GLYPH_W*fontScale; },
    setFont(colorBGR, styleBits, sizePt, fontId){
      fontColorCss = rgbFromEasyColor(colorBGR);
      fontBold=!!(styleBits&1); fontItalic=!!(styleBits&2); fontUnderline=!!(styleBits&4); fontStrike=!!(styleBits&8);
      // The bitmap font is pixel-blitted at its native 8x16 size, not
      // continuously resizable like a CSS font - integer scaling (1x, 2x,
      // 3x...) is what real bitmap-font systems supported too. 8pt is
      // treated as the native/default size.
      if(sizePt>0) fontScale = Math.max(1, Math.round(sizePt/8));
    },
    setWindowSize(w,h){
      w=Math.max(640,w); h=Math.max(480,h);
      gfxCanvas.width=w; gfxCanvas.height=h; backCanvas.width=w; backCanvas.height=h;
      simHost.clearBlack(true);
      const tag = document.getElementById('resolutionTag');
      if(tag) tag.textContent = `${w}×${h}`;
      const win = document.getElementById('outputFloatWindow');
      if(win){
        const maxW = Math.round(window.innerWidth*0.85), maxH = Math.round(window.innerHeight*0.85);
        win.style.width = Math.min(w+30, maxW) + 'px';
        win.style.height = Math.min(h+70, maxH) + 'px';
      }
      resetGfxCanvasToNativeSize(); // a resolution change is a fresh "start" for the new size - always exactly 1:1
    },
    getWidth(){ return backCanvas.width; },
    getHeight(){ return backCanvas.height; },

    drawPixel(x,y,alsoVisible){
      ensureOutputVisible();
      backCtx.fillStyle=penColorCss; backCtx.fillRect(x,y,1,1);
      if(alsoVisible){ gfxCtx.fillStyle=penColorCss; gfxCtx.fillRect(x,y,1,1); }
    },
    getPixel(x,y){ const d=backCtx.getImageData(x,y,1,1).data; return (d[2]<<16)|(d[1]<<8)|d[0]; },
    moveTo(x,y){ penX = x; penY = y; },
    lineTo(x,y,alsoVisible){
      ensureOutputVisible();
      plotLine(backCtx, penX,penY, x,y, penColorCss, penWidth);
      if(alsoVisible) plotLine(gfxCtx, penX,penY, x,y, penColorCss, penWidth);
      penX = x; penY = y;
    },
    // Pixel-perfect (Bresenham) line — Canvas 2D always anti-aliases
    // stroke() paths with no way to disable it, which produces blended
    // edge pixels that break exact-match flood fill (and don't match real
    // GDI's hard-edged output anyway). Plotting individual 1x1 (or
    // penWidth x penWidth for thick pens) rects avoids that entirely.
    line(x1,y1,x2,y2,alsoVisible){
      ensureOutputVisible();
      plotLine(backCtx, x1,y1,x2,y2, penColorCss, penWidth);
      if(alsoVisible) plotLine(gfxCtx, x1,y1,x2,y2, penColorCss, penWidth);
    },
    rectangle(x1,y1,x2,y2,filled,alsoVisible){
      ensureOutputVisible();
      const x=Math.min(x1,x2), y=Math.min(y1,y2), w=Math.abs(x2-x1), h=Math.abs(y2-y1);
      if(filled){ backCtx.fillStyle=fillColorCss; backCtx.fillRect(x,y,w+1,h+1); }
      plotRectOutline(backCtx, x,y,w,h, penColorCss, penWidth);
      if(alsoVisible){
        if(filled){ gfxCtx.fillStyle=fillColorCss; gfxCtx.fillRect(x,y,w+1,h+1); }
        plotRectOutline(gfxCtx, x,y,w,h, penColorCss, penWidth);
      }
    },
    ellipse(x1,y1,x2,y2,filled,alsoVisible){
      ensureOutputVisible();
      const x=Math.min(x1,x2), y=Math.min(y1,y2), w=Math.abs(x2-x1), h=Math.abs(y2-y1);
      plotEllipse(backCtx, x,y,w,h, penColorCss, fillColorCss, filled, penWidth);
      if(alsoVisible) plotEllipse(gfxCtx, x,y,w,h, penColorCss, fillColorCss, filled, penWidth);
    },
    // Exact match only, matching real TCanvas::FloodFill(x,y,color,fsSurface)
    // exactly - now that lines/rects/ellipses are drawn pixel-perfect (no
    // anti-aliasing), exact matching is correct and doesn't leak.
    floodFill(x,y,alsoVisible){
      ensureOutputVisible();
      if(x<0||x>=backCanvas.width||y<0||y>=backCanvas.height) return;
      const w=backCanvas.width,h=backCanvas.height;
      const img = backCtx.getImageData(0,0,w,h);
      const data = img.data;
      const idx=(px,py)=>(py*w+px)*4;
      const s=idx(x,y);
      const tr=data[s],tg=data[s+1],tb=data[s+2],ta=data[s+3];
      const m = fillColorCss.match(/\d+/g).map(Number);
      const fr=m[0],fg=m[1],fb=m[2],fa=255;
      if(!(tr===fr&&tg===fg&&tb===fb&&ta===fa)){
        const stack=[[x,y]]; const visited=new Uint8Array(w*h);
        while(stack.length){
          const [px,py]=stack.pop();
          if(px<0||px>=w||py<0||py>=h) continue;
          const vi=py*w+px; if(visited[vi]) continue;
          const i=vi*4;
          if(data[i]!==tr||data[i+1]!==tg||data[i+2]!==tb||data[i+3]!==ta) continue;
          visited[vi]=1; data[i]=fr;data[i+1]=fg;data[i+2]=fb;data[i+3]=fa;
          stack.push([px+1,py],[px-1,py],[px,py+1],[px,py-1]);
        }
        backCtx.putImageData(img,0,0);
      }
      if(alsoVisible) gfxCtx.drawImage(backCanvas,0,0);
    },
    drawGfxText(s,x,y,alsoVisible){
      ensureOutputVisible();
      let cx = x;
      const savedColor = fontColorCss;
      fontColorCss = penColorCss; // graphics text draws in the current pen color, not a separate font color
      for(let i=0;i<s.length;i++){
        blitGlyph(backCtx, cx, y, s.charCodeAt(i));
        if(alsoVisible) blitGlyph(gfxCtx, cx, y, s.charCodeAt(i));
        cx += GLYPH_W*fontScale;
      }
      fontColorCss = savedColor;
    },
    setDrawingMode(m){
      const op = (m===14||m===15) ? 'xor' : 'source-over';
      backCtx.globalCompositeOperation = op;
      gfxCtx.globalCompositeOperation = op;
    },
    setPenWidth(w){ penWidth = Math.max(1,w); },
    setLineColor(c){ penColorCss = rgbFromEasyColor(c); },
    setFillColor(c){ fillColorCss = rgbFromEasyColor(c); },

    charIn(){
      const v = window.prompt('TRAP #15 task 5 — enter a character:');
      return v && v.length ? v.charCodeAt(0) : 0;
    },
    textIn(){
      return window.prompt('TRAP #15 — enter text/number:') || '';
    },

    sndLoad(path, slot){
      const b = readVirtualFile(path);
      if(!b) return;
      (async()=>{
        try{
          const ctx = getAudioCtx();
          if(!ctx) return;
          const ab = b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength);
          soundSlots[slot] = await ctx.decodeAudioData(ab);
        }catch(e){ console.error('sndLoad failed for', path, e); }
      })();
    },
    sndPlayFile(path){ const b=readVirtualFile(path); if(b) decodeAndPlay(b); },
    sndPlaySlot(slot){ playSlot(slot, false); },
    // cmd: 0=play once, 1=play looping, 2=stop if this slot is the active one, 3=stop all
    sndControl(slot, cmd){
      if(cmd===0) playSlot(slot, false);
      else if(cmd===1) playSlot(slot, true);
      else if(cmd===2){ if(currentWaveSlot===slot) stopCurrent(); }
      else if(cmd===3) stopCurrent();
    },

    fileDialog(mode, title, ext, currentPath){
      let files = [];
      try{ files = machine.simEngine.FS.readdir('/').filter(f=>f!=='.'&&f!=='..'); }catch(e){}
      const label = title || (mode===0 ? 'Open file' : 'Save file');
      const picked = window.prompt(`${label}\nFiles available: ${files.join(', ') || '(none uploaded)'}`, currentPath||'');
      return picked;
    },

    // backs TRAP #15 task 19 (getKeyState) - real games check specific
    // Windows virtual-key codes packed into D1, e.g. VK_LEFT=$25.
    isKeyPressed(vkCode){ return pressedKeys.has(vkCode); },

    // Surfaces simLog() messages from the CPU core (halt reasons, runtime
    // errors like an uninitialized interrupt vector) in the syslog panel -
    // this was previously only going to stderr and never reaching the UI.
    simLog(rawMessage){
      // The C++ bridge now hands over the message's raw bytes (a typed
      // array view into WASM memory), not an already-decoded JS string -
      // UTF8ToString() would mangle any accented character, since the
      // bytes are single-byte CP437 (see encodeSourceForEngine() in
      // app_part1.js), not UTF-8. Decode with the matching table here.
      const message = decodeEngineBytes(rawMessage);
      const isRuntimeError = /^Runtime error:/i.test(message);
      // TRAP #15 task 200 (CONSOLE_LOG, web-port-only debugging aid -
      // CODE9.CPP) prefixes its output with "CONSOLE_LOG: " specifically so
      // it can be picked out here and given a distinctive color, separate
      // from ordinary engine log lines (default teal) and runtime errors
      // (red) - a program's own debug prints should stand out from the
      // simulator's own status/error chatter in the same pane.
      const isConsoleLogTask = /^CONSOLE_LOG:/.test(message);
      ui.appendLog(message, /error|Error/.test(message), isConsoleLogTask);
      if(isRuntimeError) ui.appendRuntimeError(message);
    },
  };

  /* ---- mouse / keyboard wiring for TRAP tasks 19/60-62 ----
     Real EASy68K games query keys via a keys[256] array indexed by
     Windows virtual-key codes (confirmed against YAP's source: arrows use
     $25-$28 = VK_LEFT..VK_DOWN, letters use their ASCII code, space=$20).
     JS's (deprecated but still functional and universally supported)
     event.keyCode lines up with these directly, so no translation table
     is needed - just track which codes are currently held. ---- */
  const pressedKeys = new Set();
  function canvasCoords(e){
    const rect = gfxCanvas.getBoundingClientRect();
    const x = Math.round((e.clientX-rect.left) * gfxCanvas.width/rect.width);
    const y = Math.round((e.clientY-rect.top) * gfxCanvas.height/rect.height);
    return [x,y];
  }
  function btnIndex(e){ return e.button===0?0:e.button===1?1:e.button===2?2:0; }
  gfxCanvas.addEventListener('mousemove', e=>{
    if(!machine.simEngine) return;
    const [x,y]=canvasCoords(e);
    machine.simEngine.ccall('wasm_mouse_move', null, ['number','number'],[x,y]);
  });
  gfxCanvas.addEventListener('mousedown', e=>{
    gfxCanvas.focus();
    if(!machine.simEngine) return;
    const [x,y]=canvasCoords(e);
    machine.simEngine.ccall('wasm_mouse_down', null, ['number','number','number'],[x,y,btnIndex(e)]);
  });
  window.addEventListener('mouseup', e=>{
    if(!machine.simEngine) return;
    const [x,y]=canvasCoords(e);
    machine.simEngine.ccall('wasm_mouse_up', null, ['number','number','number'],[x,y,btnIndex(e)]);
  });
  gfxCanvas.addEventListener('contextmenu', e=>e.preventDefault());

  // Game-relevant keys that must not trigger page scroll/other browser
  // default behavior while the graphics screen has focus.
  const GAME_KEYS = new Set([32,37,38,39,40,33,34,35,36]); // space, arrows, pgup/dn, end/home
  gfxCanvas.addEventListener('keydown', e=>{
    pressedKeys.add(e.keyCode);
    if(GAME_KEYS.has(e.keyCode)) e.preventDefault();
    if(!machine.simEngine) return;
    machine.simEngine.ccall('wasm_key_down', null, ['number','number','number','number'],[e.keyCode, e.shiftKey?1:0,e.altKey?1:0,e.ctrlKey?1:0]);
  });
  gfxCanvas.addEventListener('keyup', e=>{
    pressedKeys.delete(e.keyCode);
    if(GAME_KEYS.has(e.keyCode)) e.preventDefault();
    if(!machine.simEngine) return;
    machine.simEngine.ccall('wasm_key_up', null, ['number','number','number','number'],[e.keyCode, e.shiftKey?1:0,e.altKey?1:0,e.ctrlKey?1:0]);
  });
  // Losing focus mid-keypress would otherwise leave a key "stuck" pressed
  // forever from the simulator's point of view.
  gfxCanvas.addEventListener('blur', ()=>{ pressedKeys.clear(); });

  /* ---- file management: populates BOTH engines' virtual filesystem, so
     INCLUDE (assembler) and file I/O / sound (simulator) can find files.
     Deliberately browser-only, always, in every browser - see "Import
     Folder…"/"Import ZIP" below: nothing in this app ever writes back to
     a real file on disk except a one-time, explicit "Download file" /
     "Export ZIP" (a plain download, not an ongoing link). ---- */

  function ensureDirs(FS, path){
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for(let i=0;i<parts.length-1;i++){
      cur += '/'+parts[i];
      try{ FS.mkdir(cur); }catch(e){}
    }
  }
  function writeToBothFS(path, data){
    if(!path.startsWith('/')) path = '/'+path;
    ensureDirs(machine.asmEngine.FS, path);
    ensureDirs(machine.simEngine.FS, path);
    machine.asmEngine.FS.writeFile(path, data);
    // A file that originated as TRAP #15 program output (tracked in
    // simOriginFiles by syncSimFileIOToVFS()) needs its SIMULATOR-side copy
    // re-encoded back to single-byte CP437 before writing, not stored as
    // plain UTF-8 like every other tracked file. Reasoning: such a file's
    // bytes represent CP437-encoded "text" the way the simulator's own
    // screen/console-log rendering expects (see encodeSourceForEngine() in
    // app_part1.js) - simply opening the file in this editor (which reads
    // it back correctly as real UTF-8/Unicode, decoded via
    // decodeEngineBytes() when it was first synced) and then switching
    // away, even with ZERO edits, used to call this exact function with
    // sourceEl.value re-encoded as real UTF-8 multi-byte bytes - correct
    // for the asmEngine copy (all the editor ever reads), but it silently
    // overwrote the SIMULATOR's copy too, replacing its single-byte CP437
    // content with multi-byte UTF-8. A later TRAP #15 read-and-print of
    // that same file then fed those UTF-8 bytes straight into the
    // CP437-indexed screen font / decodeEngineBytes() one byte at a time,
    // rendering two wrong characters for every one accented character
    // instead of the original correct one (to_do.md: "the special
    // characters do not print well... both if I print to screen or to
    // console... has something to do with the editor"). Re-encoding here
    // makes this round-trip lossless when nothing was actually edited, and
    // correctly CP437-encodes any new accented text the user types by hand
    // into such a file too. Known accepted gap: a file that TRAP #15 wrote
    // once and is later manually overwritten with genuinely unrelated
    // binary content (a re-upload reusing the same path) would also get
    // this treatment, which could be wrong for non-text bytes - narrow
    // enough, and consistent with every other CP437-vs-binary tradeoff
    // already documented for this feature, not worth extra bookkeeping to
    // close given how the tracking role a path plays isn't reliably
    // knowable from writeToBothFS() alone.
    const simData = simOriginFiles.has(path) ? encodeSourceForEngine(new TextDecoder().decode(data)) : data;
    machine.simEngine.FS.writeFile(path, simData);
    // The real assembler's INCLUDE/INCBIN resolution always uppercases
    // the referenced filename before opening it (strcap(), matching
    // real EASy68K on Windows - a case-insensitive filesystem, so this
    // was always harmless there). This WASM filesystem is case-sensitive,
    // so a project that references "DrawPixels.x68" while the actual
    // uploaded file is "drawPixels.x68" would otherwise fail to resolve
    // even though it works fine in the real, original EASy68K. Writing
    // an uppercase-named copy specifically to the assembler's own
    // filesystem (not the simulator's - it doesn't do this lookup)
    // makes that resolution succeed regardless of the file's actual case.
    const upperPath = path.toUpperCase();
    if(upperPath !== path){
      ensureDirs(machine.asmEngine.FS, upperPath);
      machine.asmEngine.FS.writeFile(upperPath, data);
    }
    // Seed syncSimFileIOToVFS()'s "already synced" baseline for this path
    // at its CURRENT (correct, pristine) size. Without this, simFsSyncedSize
    // starts completely empty every session, so the FIRST time that
    // function's tree-walk runs after ANY ordinary project file (a WAV
    // asset, an INCBIN'd .BIN - anything uploaded/created by the user, not
    // written by a TRAP #15 program) happens to exist in the sim engine's
    // FS, it looked exactly like "a new file a program just wrote" - no
    // different from a genuine TRAP #15 write, since both just look like "a
    // path not yet in simFsSyncedSize." That wrongly ran the binary asset's
    // raw bytes through decodeEngineBytes()+TextEncoder (the CP437-text
    // pipeline meant only for genuine TRAP #15 text output), corrupting its
    // asmEngine.FS mirror and its IndexedDB backup, and wrongly added it to
    // simOriginFiles - which could then ALSO corrupt the LIVE simEngine.FS
    // copy audio playback reads from the next time this same path went
    // through writeToBothFS again. This is what made YAR's sound come out
    // as garbled noise ("trash, but audible" - a corrupted-but-still-
    // parseable WAV) the first time it ran after any other program's file
    // I/O activity had already triggered one sync pass in the same session
    // (to_do.md). Seeding here means syncSimFileIOToVFS() only ever treats
    // a path as "new" when it's genuinely new or has genuinely changed SIZE
    // since this function (the only place ordinary/user files reach the sim
    // engine's FS) last wrote it - i.e., a real TRAP #15 write, not merely
    // "the tree-walk hasn't looked at this path before." Seeded with
    // simData.length (the byte count actually written to
    // machine.simEngine.FS just above), NOT data.length - for a
    // simOriginFiles path those two differ (CP437-encoded bytes are never
    // longer, and usually shorter, than the UTF-8 re-encoding of the same
    // text), and syncSimFileIOToVFS()'s change detection stats the
    // SIMULATOR filesystem, so seeding with the wrong length would make
    // every such path look "changed" on the very next sync and immediately
    // undo this fix for exactly the files it matters most for.
    simFsSyncedSize.set(path, simData.length);
  }
  function registerFile(path, size){
    const entry = uploadedFiles.find(f=>f.path===path);
    if(entry) entry.size = size;
    else uploadedFiles.push({path, size});
  }
  // TRAP #15 FILE HANDLING tasks (open/create/write/close, 50-59) write
  // straight into the simulator engine's own Emscripten MEMFS via plain
  // fopen()/fwrite() (SIMOPS2.CPP, unmodified) - a real filesystem, so a
  // program that writes then reads a file back within the same session
  // already worked, but any file created/modified that way never appeared
  // in the project's own file tree (uploadedFiles/IndexedDB), couldn't be
  // viewed/edited/downloaded, and vanished on reload since only IndexedDB
  // survives a page refresh. Walk the sim engine's FS tree at natural
  // simulation-pause points (halt, breakpoint, manual pause, each Step) -
  // not every instruction/batch, which would add real per-frame overhead
  // to a fast Run - and mirror any new/changed regular file into the same
  // place every other uploaded file lives. A cheap byte-length check
  // (paired with a per-path "already synced this exact size" flag) avoids
  // re-reading/re-persisting a file's full content on every single pause
  // when nothing about it actually changed since the last sync.
  const simFsSyncedSize = new Map(); // path -> size already synced to the VFS
  // Paths known to have been written by a TRAP #15 program (not the user) -
  // consulted by writeToBothFS() so re-persisting such a file (even just
  // from opening it and switching away, no edits needed) re-encodes its
  // SIMULATOR-side copy back to single-byte CP437 instead of leaving real
  // UTF-8 bytes there. See the comment in writeToBothFS() for the full story.
  const simOriginFiles = new Set();
  function syncSimFileIOToVFS(){
    if(!machine.simEngine) return;
    const FS = machine.simEngine.FS;
    const SKIP = new Set(['/prog.S68']); // engine's own internal staging path, never user data
    let changed = false;
    const walk = (dir) => {
      let entries;
      try{ entries = FS.readdir(dir); }catch(e){ return; }
      for(const name of entries){
        if(name==='.' || name==='..') continue;
        const full = (dir==='/' ? '' : dir) + '/' + name;
        if(SKIP.has(full)) continue;
        let st;
        try{ st = FS.stat(full); }catch(e){ continue; }
        if(FS.isDir(st.mode)){ walk(full); continue; }
        if(!FS.isFile(st.mode)) continue;
        if(simFsSyncedSize.get(full) === st.size) continue; // unchanged since last sync
        let data;
        try{ data = FS.readFile(full); }catch(e){ continue; } // Uint8Array
        // A program's TRAP #15 file-write tasks put raw bytes straight into
        // the simulator engine's MEMFS, and those bytes come from the same
        // CP437-encoded source (encodeSourceForEngine()) as everything else
        // the assembled program's strings are built from - a plain
        // TextDecoder('utf-8') (the previous approach) mis-decodes any
        // accented character byte (>=0x80) into garbage, which then also
        // got baked into the asmEngine FS mirror as those same wrong bytes,
        // corrupting the file even when reopened in this app's own editor
        // (to_do.md: "I can see the text but all the special characters...
        // are bad"). Decode with the matching CP437 table into a real
        // Unicode string once, then store that string the normal way (UTF-8
        // bytes) - the same convention every other tracked file uses - so
        // both the in-app editor and a real download show the correct
        // accented characters.
        const text = decodeEngineBytes(data);
        try{ ensureDirs(machine.asmEngine.FS, full); machine.asmEngine.FS.writeFile(full, new TextEncoder().encode(text)); }catch(e){}
        registerFile(full, data.length);
        // Stored as UTF-8 bytes (like every other tracked file, not the raw
        // CP437 original) so it displays correctly if reopened after a
        // restore. Known accepted gap: simOriginFiles (see writeToBothFS())
        // is in-memory only and doesn't survive a page reload, so a
        // restored copy of this exact file won't get the CP437 round-trip
        // treatment if a program reads it again in a LATER session without
        // that program having re-run its own write step first in this one
        // - narrow enough (needs a reload before ever re-reading a file
        // from a past session) not to be worth persisting that flag too.
        idbSaveFile(full, new TextEncoder().encode(text));
        simFsSyncedSize.set(full, st.size);
        simOriginFiles.add(full);
        changed = true;
      }
    };
    walk('/');
    if(changed) renderFileTable();
  }

  /* ---- persistence, no server: nothing this app imports (Upload files,
     Import Folder, Import ZIP) is ever linked back to a real file on disk,
     in any browser, by design (the project owner explicitly does not want
     that, in any form). Every edit is auto-saved into IndexedDB instead,
     meaning nothing is ever lost even if you close the tab/browser and
     come back later. "Export ZIP"/"Download file" (below) give an
     explicit, one-time way to get a real copy onto disk when you want
     one - a plain download, never an ongoing link. ---- */
  const IDB_NAME = 'easy68k-project', IDB_STORE = 'files';
  function idbOpen(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = ()=>{ req.result.createObjectStore(IDB_STORE, {keyPath:'path'}); };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error);
    });
  }
  // Stores RAW BYTES (a Uint8Array), not a decoded string - IndexedDB can
  // hold a typed array natively via structured clone, so there's no need
  // to go through any text encoding at all here. This used to take a JS
  // string and store `new TextDecoder().decode(bytes)` at every call site,
  // which is LOSSY for anything that isn't valid UTF-8 - genuinely binary
  // project assets (a .WAV a game loads via TRAP #15 sound tasks, a .BIN
  // an INCBIN references, an image) got silently corrupted the moment they
  // were saved here (invalid byte sequences replaced with U+FFFD,
  // unrecoverably), which never showed up on a fresh upload (the actual
  // engine filesystems still had the original, uncorrupted bytes - only
  // the IndexedDB *backup* copy was already wrong) but broke exactly the
  // moment that backup copy became the ONLY copy again - i.e. after
  // restoring auto-saved files on a fresh page load. This is what turned
  // out to be behind to_do.md's "[YAR] works at reasonable speed but with
  // no audio" after "quit the app, enter it again and accept recovering
  // the files" - the restored .WAV bytes were never bit-for-bit what was
  // originally uploaded. Callers that have a JS string (editor content,
  // the assembler's generated listing/S-record) encode it themselves with
  // TextEncoder before calling this - see call sites.
  async function idbSaveFile(path, bytes){
    try{
      const db = await idbOpen();
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).put({path, content: bytes, savedAt: Date.now()});
        tx.oncomplete = resolve; tx.onerror = ()=>reject(tx.error);
      });
    }catch(e){ console.error('IndexedDB save failed for', path, e); }
  }
  async function idbDeleteFile(path){
    try{
      const db = await idbOpen();
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).delete(path);
        tx.oncomplete = resolve; tx.onerror = ()=>reject(tx.error);
      });
    }catch(e){}
  }
  // File management (create/upload/rename/delete) only makes sense while
  // editing - only Export ZIP stays available during simulation.
  function blockedDuringSimulation(){
    if(appMode==='simulating'){ window.alert('File management is disabled while simulating. Use Export ZIP if you need a copy, or Reset to go back to editing first.'); return true; }
    return false;
  }
  async function deleteFileFromStorage(path, skipConfirm){
    if(!skipConfirm && blockedDuringSimulation()) return;
    const name = path.replace(/^\//,'');
    if(!skipConfirm && !window.confirm(`Delete ${name} from storage? This removes it from the file list and browser auto-save. This cannot be undone.`)) return;
    // Close any tab showing this file FIRST, in every pane, so the editor
    // has already switched away from it before we actually remove it -
    // closeFileTab's own fallback logic re-persists whatever is CURRENTLY
    // displayed when switching tabs, which would silently re-register
    // this file if it were already deleted from uploadedFiles at that point.
    for(const p of panes){
      const files = (p === panes[activePaneIdx]) ? openedFiles : p.openedFiles;
      if(files.some(f=>f.path===path)){
        activatePane(p);
        closeFileTab(path);
      }
    }
    const idx = uploadedFiles.findIndex(f=>f.path===path);
    if(idx!==-1) uploadedFiles.splice(idx,1);
    try{ machine.asmEngine.FS.unlink(path); }catch(e){}
    try{ machine.simEngine.FS.unlink(path); }catch(e){}
    simFsSyncedSize.delete(path);
    simOriginFiles.delete(path);
    await idbDeleteFile(path);
    if(!skipConfirm){ renderFileTable(); ui.appendLog(`Deleted ${name} from storage.`); }
  }
  async function deleteFolderFromStorage(folderPath){
    if(blockedDuringSimulation()) return;
    const prefix = folderPath + '/';
    const filesInFolder = uploadedFiles.filter(f => f.path.replace(/^\//,'').startsWith(prefix));
    if(!filesInFolder.length) return;
    if(!window.confirm(`Delete folder "${folderPath}" and all ${filesInFolder.length} file(s) inside it from storage? This cannot be undone.`)) return;
    for(const f of filesInFolder.slice()) await deleteFileFromStorage(f.path, true);
    renderFileTable();
    ui.appendLog(`Deleted folder "${folderPath}" (${filesInFolder.length} file(s)) from storage.`);
  }
  async function renameFileInStorage(oldPath, newName){
    if(blockedDuringSimulation()) return false;
    const newPath = '/' + newName.replace(/^\/+/,'');
    if(newPath === oldPath) return true;
    if(uploadedFiles.some(f=>f.path===newPath)) return 'A file with that name already exists here.';
    // Raw bytes, not {encoding:'utf8'} - a rename/copy has to preserve a
    // genuinely binary file (a .WAV/.BIN asset) exactly, and a text round
    // trip through UTF8 decode+re-encode is lossy for anything that isn't
    // valid UTF-8 in the first place.
    let bytes = new Uint8Array(0);
    try{ bytes = machine.asmEngine.FS.readFile(oldPath); }catch(e){}
    const wasOpenPane = panes.find(p => ((p===panes[activePaneIdx]) ? openedFiles : p.openedFiles).some(f=>f.path===oldPath));
    writeToBothFS(newPath, bytes);
    registerFile(newPath, bytes.length);
    idbSaveFile(newPath, bytes);
    await deleteFileFromStorage(oldPath, true);
    if(wasOpenPane){ activatePane(wasOpenPane); loadVirtualFile(newPath); }
    renderFileTable();
    ui.appendLog(`Renamed ${oldPath.replace(/^\//,'')} → ${newName}.`);
    return true;
  }
  // Duplicates a file's content to a new path, leaving the original in
  // place - the "copy" half of move/copy (renameFileInStorage above is
  // effectively "move", since it deletes the original after writing the
  // new path).
  async function copyFileInStorage(oldPath, newPath){
    if(newPath === oldPath) return true;
    if(uploadedFiles.some(f=>f.path===newPath)) return 'A file with that name already exists here.';
    let bytes = new Uint8Array(0); // raw bytes - see renameFileInStorage()'s comment on why not {encoding:'utf8'}
    try{ bytes = machine.asmEngine.FS.readFile(oldPath); }catch(e){}
    writeToBothFS(newPath, bytes);
    registerFile(newPath, bytes.length);
    idbSaveFile(newPath, bytes);
    return true;
  }
  function filesUnderFolder(folderPath){ // folderPath: no leading slash, e.g. "sub/inner"
    const prefix = folderPath + '/';
    return uploadedFiles.filter(f => f.path.replace(/^\//,'').startsWith(prefix)).map(f=>f.path);
  }
  // Drag-and-drop and the context menu's Cut/Copy/Paste both funnel through
  // here - a file or a whole folder (recursing over every file under it,
  // preserving its internal sub-structure), moved or duplicated into
  // targetFolder (no leading slash; '' means the project root).
  async function moveOrCopyEntry(mode, type, srcPath, targetFolder){
    if(blockedDuringSimulation()) return false;
    if(type==='file'){
      const baseName = srcPath.slice(srcPath.lastIndexOf('/')+1);
      const newPath = '/' + (targetFolder ? targetFolder+'/' : '') + baseName;
      if(newPath === srcPath) return true; // dropped onto the folder it's already in
      const result = mode==='move'
        ? await renameFileInStorage(srcPath, newPath.slice(1))
        : await copyFileInStorage(srcPath, newPath);
      if(result !== true){ window.alert(typeof result==='string' ? result : 'Could not complete the operation.'); return false; }
      renderFileTable();
      return true;
    }
    // folder: srcPath and targetFolder are both slash-free folder paths
    const folderName = srcPath.slice(srcPath.lastIndexOf('/')+1);
    const newFolderRel = (targetFolder ? targetFolder+'/' : '') + folderName;
    if(newFolderRel === srcPath) return true;
    if((newFolderRel+'/').startsWith(srcPath+'/')){
      window.alert('Cannot move a folder into itself or one of its own sub-folders.');
      return false;
    }
    const filesToMove = filesUnderFolder(srcPath);
    if(!filesToMove.length) return true;
    const prefixLen = srcPath.length + 1; // strips "sub/inner/" from each contained file's path
    for(const p of filesToMove){
      const rel = p.replace(/^\//,'').slice(prefixLen);
      const newPath = '/' + newFolderRel + '/' + rel;
      const result = mode==='move'
        ? await renameFileInStorage(p, newPath.slice(1))
        : await copyFileInStorage(p, newPath);
      if(result !== true){ window.alert(typeof result==='string' ? result : 'Could not complete the operation.'); return false; }
    }
    if(collapsedFolders.has(srcPath)){ collapsedFolders.delete(srcPath); collapsedFolders.add(newFolderRel); }
    renderFileTable();
    ui.appendLog(`${mode==='move'?'Moved':'Copied'} folder "${folderName}" (${filesToMove.length} file(s)) → ${targetFolder||'/'}.`);
    return true;
  }
  // Cut/Copy/Paste clipboard - {mode:'cut'|'copy', type:'file'|'folder', path}
  let ftClipboard = null;
  // Drag-and-drop state for moving tree rows - {type:'file'|'folder', path}
  let dragFtEntry = null;
  async function idbLoadAll(){
    try{
      const db = await idbOpen();
      return await new Promise((resolve,reject)=>{
        const tx = db.transaction(IDB_STORE,'readonly');
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = ()=>resolve(req.result);
        req.onerror = ()=>reject(req.error);
      });
    }catch(e){ console.error('IndexedDB load failed', e); return []; }
  }
  async function idbClear(){
    try{
      const db = await idbOpen();
      await new Promise((resolve,reject)=>{
        const tx = db.transaction(IDB_STORE,'readwrite');
        tx.objectStore(IDB_STORE).clear();
        tx.oncomplete = resolve; tx.onerror = ()=>reject(tx.error);
      });
    }catch(e){}
  }
  async function restoreFromIndexedDB(){
    const saved = await idbLoadAll();
    if(!saved.length) return null;
    const names = saved.map(f=>f.path).sort();
    const preview = names.slice(0,8).join('\n') + (names.length>8 ? `\n… and ${names.length-8} more` : '');
    const ok = window.confirm(`Restore ${saved.length} file(s) auto-saved from your last browser session?\n\n${preview}\n\nChoosing "Cancel" just skips restoring for now — nothing is deleted.`);
    if(!ok) return null; // declining only skips for this session; the saved data stays put, nothing is destroyed by a misclick
    for(const f of saved){
      // f.content is raw bytes (Uint8Array) for anything saved by the
      // current build - but a record saved by an OLDER build (before
      // idbSaveFile() stored bytes instead of a lossy UTF-8-decoded
      // string) still has a plain string here; encoding that one string
      // case back to bytes keeps restoring old auto-saves working exactly
      // as before (nothing new to fix there - a string-typed record can
      // only ever have been valid UTF-8 text in the first place, since
      // that's all the old code path could produce).
      const bytes = (typeof f.content === 'string') ? new TextEncoder().encode(f.content) : f.content;
      writeToBothFS(f.path, bytes);
      registerFile(f.path, bytes.length);
    }
    renderFileTable();
    ui.appendLog(`Restored ${saved.length} file(s) from browser storage: ${names.join(', ')}.`);
    return names;
  }
  /* ZIP export - minimal STORE-only (uncompressed) writer, no external
     library needed, so "get real files onto disk" always works even with
     no File System Access API and no server. */
  function crc32(bytes){
    let c, crc = 0xFFFFFFFF;
    for(let i=0;i<bytes.length;i++){
      c = (crc ^ bytes[i]) & 0xFF;
      for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
      crc = (crc>>>8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function buildZip(files){ // files: [{path, data:Uint8Array}]
    const chunks = []; const central = []; let offset = 0;
    const le16 = n => new Uint8Array([n&0xFF,(n>>8)&0xFF]);
    const le32 = n => new Uint8Array([n&0xFF,(n>>8)&0xFF,(n>>16)&0xFF,(n>>24)&0xFF]);
    for(const f of files){
      const nameBytes = new TextEncoder().encode(f.path.replace(/^\//,''));
      const crc = crc32(f.data);
      const localHeader = new Uint8Array([
        ...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
        ...le32(crc), ...le32(f.data.length), ...le32(f.data.length),
        ...le16(nameBytes.length), ...le16(0),
      ]);
      chunks.push(localHeader, nameBytes, f.data);
      central.push({nameBytes, crc, size:f.data.length, offset});
      offset += localHeader.length + nameBytes.length + f.data.length;
    }
    const centralStart = offset;
    for(const c of central){
      const hdr = new Uint8Array([
        ...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
        ...le32(c.crc), ...le32(c.size), ...le32(c.size),
        ...le16(c.nameBytes.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
        ...le32(0), ...le32(c.offset),
      ]);
      chunks.push(hdr, c.nameBytes);
      offset += hdr.length + c.nameBytes.length;
    }
    const centralSize = offset - centralStart;
    const end = new Uint8Array([
      ...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(central.length), ...le16(central.length),
      ...le32(centralSize), ...le32(centralStart), ...le16(0),
    ]);
    chunks.push(end);
    const total = chunks.reduce((s,c)=>s+c.length,0);
    const out = new Uint8Array(total);
    let p=0; for(const c of chunks){ out.set(c,p); p+=c.length; }
    return out;
  }
  // Reads an arbitrary ZIP file (not just ones buildZip() itself produced -
  // real-world zips from Finder/Explorer/GitHub "Download ZIP" etc. almost
  // always use DEFLATE, not STORED) back into [{path, data:Uint8Array}].
  // Walks the End Of Central Directory record backward from the end of the
  // buffer (the only reliably-positioned anchor in the format - a ZIP can
  // have arbitrary prepended data, e.g. a self-extractor stub), then reads
  // each entry's actual local file header to find where its data really
  // starts (its filename/extra-field lengths aren't guaranteed identical
  // to the central directory copy, even though in practice they usually
  // are). DEFLATE entries are inflated with the browser's native
  // DecompressionStream('deflate-raw') - no bundled inflate library needed,
  // keeping this a real single-file build with no added dependency.
  async function readZip(bytes){
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50, LOC_SIG = 0x04034b50;
    let eocdPos = -1;
    const searchFloor = Math.max(0, bytes.length - 65557); // max comment length (65535) + EOCD record (22)
    for(let i=bytes.length-22; i>=searchFloor; i--){
      if(dv.getUint32(i, true) === EOCD_SIG){ eocdPos = i; break; }
    }
    if(eocdPos === -1) throw new Error('Not a valid ZIP file (no End Of Central Directory record found).');
    const entryCount = dv.getUint16(eocdPos+10, true);
    let centralOffset = dv.getUint32(eocdPos+16, true);
    const results = [];
    for(let n=0; n<entryCount; n++){
      if(dv.getUint32(centralOffset, true) !== CEN_SIG) throw new Error('Corrupt ZIP central directory.');
      const method = dv.getUint16(centralOffset+10, true);
      const compSize = dv.getUint32(centralOffset+20, true);
      const nameLen = dv.getUint16(centralOffset+28, true);
      const extraLen = dv.getUint16(centralOffset+30, true);
      const commentLen = dv.getUint16(centralOffset+32, true);
      const localOffset = dv.getUint32(centralOffset+42, true);
      const nameBytes = bytes.subarray(centralOffset+46, centralOffset+46+nameLen);
      const name = new TextDecoder('utf-8').decode(nameBytes).replace(/\\/g,'/');
      centralOffset += 46 + nameLen + extraLen + commentLen;
      if(name.endsWith('/')) continue; // directory entry, no data of its own
      if(dv.getUint32(localOffset, true) !== LOC_SIG) throw new Error(`Corrupt ZIP local header for "${name}".`);
      const locNameLen = dv.getUint16(localOffset+26, true);
      const locExtraLen = dv.getUint16(localOffset+28, true);
      const dataStart = localOffset + 30 + locNameLen + locExtraLen;
      const compData = bytes.slice(dataStart, dataStart+compSize);
      let data;
      if(method === 0){
        data = compData;
      } else if(method === 8){
        if(typeof DecompressionStream === 'undefined'){
          throw new Error(`"${name}" is DEFLATE-compressed and this browser has no DecompressionStream support to unpack it - try a newer browser, or re-save the zip using "store/no compression".`);
        }
        const readable = new ReadableStream({
          start(controller){ controller.enqueue(compData); controller.close(); }
        }).pipeThrough(new DecompressionStream('deflate-raw'));
        const reader = readable.getReader();
        const parts = []; let total = 0;
        for(;;){
          const {done, value} = await reader.read();
          if(done) break;
          parts.push(value); total += value.length;
        }
        data = new Uint8Array(total);
        let off = 0; for(const p of parts){ data.set(p, off); off += p.length; }
      } else {
        throw new Error(`"${name}" uses an unsupported ZIP compression method (${method}) - only Stored and Deflate are supported.`);
      }
      results.push({path: name, data});
    }
    return results;
  }
  async function downloadAllFiles(){
    if(!uploadedFiles.length){ ui.appendLog('No files to download yet.'); return; }
    await persistCurrentToVFS();
    const files = [];
    for(const f of uploadedFiles){
      try{
        const bytes = machine.asmEngine.FS.readFile(f.path);
        files.push({path: f.path, data: bytes});
      }catch(e){}
    }
    const zipBytes = buildZip(files);
    const blob = new Blob([zipBytes], {type:'application/zip'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'easy68k-project.zip';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ui.appendLog(`Downloaded ${files.length} file(s) as easy68k-project.zip.`);
  }

  // Import Folder: deliberately just a bulk upload, exactly like Upload
  // files/Import ZIP - never a real, ongoing link back to disk, in any
  // browser. #fileInputFolder (webkitdirectory) already reads the whole
  // picked folder as plain browser-only Files (preserving its internal
  // sub-structure via webkitRelativePath), so this just opens that picker.
  function openFolder(){
    if(blockedDuringSimulation()) return;
    $('#fileInputFolder').click();
  }

  // OS-generated metadata junk (Finder's .DS_Store, AppleDouble resource-fork
  // shadow files, Explorer's Thumbs.db/desktop.ini, and the __MACOSX/ folder
  // some zip tools add) - never something a project actually wants imported.
  // Filtered at the one chokepoint every import path (Upload files, Import
  // Folder, Import ZIP, drag-and-drop) funnels through, so it can never end
  // up in the tree/IndexedDB in the first place, regardless of which path
  // brought it in.
  const JUNK_BASENAMES = new Set(['.DS_Store','Thumbs.db','desktop.ini','.localized']);
  function isJunkFile(name){
    const base = name.slice(name.lastIndexOf('/')+1);
    return JUNK_BASENAMES.has(base) || base.startsWith('._') || name.split('/').includes('__MACOSX');
  }
  async function handleFileList(fileList, targetFolder, keepRootFolderName, autoOpenFirst){
    if(autoOpenFirst === undefined) autoOpenFirst = true;
    if(blockedDuringSimulation()) return;
    const prefix = targetFolder ? targetFolder.replace(/^\/+|\/+$/g,'') + '/' : '';
    let firstRelPath = null;
    for(const f of fileList){
      const nameForJunkCheck = (f.webkitRelativePath && f.webkitRelativePath.length) ? f.webkitRelativePath : f.name;
      if(isJunkFile(nameForJunkCheck)) continue;
      const data = new Uint8Array(await f.arrayBuffer());
      let relPath = f.webkitRelativePath && f.webkitRelativePath.length ? f.webkitRelativePath : f.name;
      // webkitRelativePath includes the locally-chosen folder name as its
      // first segment (e.g. "YAR-main/SYSCONST.X68"). For "Import Folder"/
      // Import ZIP (the picker-based paths), that name is just whatever
      // the user happened to name their local folder and is stripped - it
      // becomes the new project root, same as double-clicking into it.
      // Dragging a folder onto the tree is different: like a real file
      // manager, the dragged folder becomes a real CHILD folder that
      // keeps its own name (keepRootFolderName, set by
      // handleExternalFileDrop) - "DROPPED" dragged onto "TARGETDIR"
      // lands at TARGETDIR/DROPPED/..., not flattened into TARGETDIR/....
      if(!keepRootFolderName){
        const parts = relPath.split('/');
        if(parts.length > 1) relPath = parts.slice(1).join('/');
      }
      relPath = prefix + relPath; // land inside whichever folder this was dropped/imported into (root if none)
      if(!relPath.startsWith('/')) relPath = '/'+relPath;
      writeToBothFS(relPath, data);
      registerFile(relPath, data.length);
      // Persist every uploaded file immediately, not just ones later
      // edited - otherwise anything the student never clicked into was
      // silently gone on browser close, even though it "looked" uploaded.
      // Raw bytes (data), not new TextDecoder().decode(data) - this used
      // to store a lossy UTF-8-decoded STRING for every upload, silently
      // corrupting any genuinely binary asset (a .WAV a game loads via
      // TRAP #15 sound tasks, an INCBIN'd .BIN, an image) the moment it
      // was auto-saved here - invisible on the SAME session (the engine
      // filesystems still had the real, uncorrupted bytes) but permanent
      // the moment that IndexedDB copy became the only surviving copy,
      // i.e. after restoring auto-saved files on a fresh page load.
      idbSaveFile(relPath, data);
      if(firstRelPath === null) firstRelPath = relPath;
    }
    renderFileTable();
    // Single/multi "Upload files" is a deliberate, explicit pick - if
    // nothing is currently open (most commonly right after a "clear and
    // upload" replace, which - correctly - no longer falls back to a
    // phantom /untitled.X68 placeholder - see clearAllBrowserOnlyFiles())
    // the editor would otherwise be left stuck on the empty "No file open"
    // state even though files just arrived, so that path still
    // auto-opens the first one. A bulk import (Import Folder, Import ZIP,
    // dragging a folder in) is different - to_do.md reported that "one of
    // the files opens... the file seems quite random" (it's really just
    // whichever entry happened to sort first in the browser's own
    // FileList/zip-entry order, which has no relation to which file is
    // actually the project's entry point) - callers of those three paths
    // pass autoOpenFirst=false so a bulk import always leaves the editor on
    // the genuine, already-correctly-supported "No file open" placeholder
    // instead of guessing.
    if(autoOpenFirst && !currentVirtualPath && firstRelPath) loadVirtualFile(firstRelPath);
    ui.appendLog(`Uploaded ${fileList.length} file(s) - saved in this browser (survives closing the tab). Edits stay in the browser only, use Export ZIP or Download file to export a real copy.`);
  }

  /* ---- dragging real files/folders in from the OS (Finder/Explorer) onto
     the file tree - purely additive, exactly like "Upload files"/"Import
     Folder" (never the confirm-replace-and-clear flow those two use, since
     to_do.md was explicit: dragging in must never delete anything). Uses
     the (non-standard but universally supported for years - Chrome,
     Firefox, Safari) File and Directory Entries API
     (DataTransferItem.webkitGetAsEntry()) to walk dropped folders
     recursively; a plain flat file has no containing folder so it's left
     without a webkitRelativePath, landing directly in the drop target with
     no stripping needed - same convention handleFileList() already uses
     for the picker-based uploads. ---- */
  function isExternalFileDrag(e){
    return !!(e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files'));
  }
  function readEntryAsFile(entry){
    return new Promise((resolve,reject)=> entry.file(resolve, reject));
  }
  function readAllDirEntries(dirReader){
    return new Promise((resolve,reject)=>{
      let all = [];
      (function readBatch(){
        dirReader.readEntries(entries=>{
          if(!entries.length){ resolve(all); return; }
          all = all.concat(entries);
          readBatch(); // readEntries() can cap how many it returns per call - keep calling until it's empty
        }, reject);
      })();
    });
  }
  async function walkDroppedEntry(entry, basePath, out){
    if(!entry) return;
    if(entry.isFile){
      const file = await readEntryAsFile(entry);
      if(basePath){
        try{ Object.defineProperty(file, 'webkitRelativePath', {value: basePath+'/'+entry.name, configurable:true}); }catch(e){}
      }
      out.push(file);
    } else if(entry.isDirectory){
      const children = await readAllDirEntries(entry.createReader());
      const newBase = basePath ? basePath+'/'+entry.name : entry.name;
      for(const child of children) await walkDroppedEntry(child, newBase, out);
    }
  }
  async function handleExternalFileDrop(e, targetFolder){
    if(blockedDuringSimulation()) return;
    const items = e.dataTransfer.items;
    const out = [];
    if(items && items.length && items[0].webkitGetAsEntry){
      const entries = [];
      for(let i=0;i<items.length;i++){
        const entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
        if(entry) entries.push(entry);
      }
      for(const entry of entries) await walkDroppedEntry(entry, '', out);
    } else if(e.dataTransfer.files){
      // Fallback for a browser without webkitGetAsEntry - flat files only, no folder recursion
      for(const f of e.dataTransfer.files) out.push(f);
    }
    if(out.length) await handleFileList(out, targetFolder, true, false);
  }
  let fileSortMode = 'name';
  const lastOpenedMap = new Map(); // path -> timestamp, for "Recent" sorting
  const FILE_ICONS = {
    x68:'📝', asm:'📝', s68:'📝', '68k':'📝', inc:'📝', txt:'📄',
    dat:'💾', bin:'💾', wav:'🔊', png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼',
  };
  function iconFor(path){
    const ext = path.slice(path.lastIndexOf('.')+1).toLowerCase();
    return FILE_ICONS[ext] || '📄';
  }
  const collapsedFolders = new Set(); // folder paths the user has manually collapsed
  let pendingCreate = null; // {kind:'file'|'folder', parentFolder:''} while an inline create row is being edited
  let pendingRename = null; // path of the file/folder currently being renamed inline
  // Most recently clicked file/folder row in the tree - not the same thing as
  // currentVirtualPath (the file open in the editor): clicking a FOLDER also
  // updates this even though it doesn't open anything. Drives where an
  // untargeted "New File"/"New Folder" (toolbar buttons, or the context
  // menu's root-level items) lands, per to_do.md: it should land at the same
  // level as whatever's selected - inside the selected folder, or alongside
  // (same parent as) the selected file - rather than always at the root.
  let selectedTreeEntry = null; // {type:'file'|'folder', path}
  function currentTreeCreateFolder(){
    if(!selectedTreeEntry) return '';
    if(selectedTreeEntry.type==='folder') return selectedTreeEntry.path;
    const noSlash = selectedTreeEntry.path.replace(/^\//,'');
    const idx = noSlash.lastIndexOf('/');
    return idx===-1 ? '' : noSlash.slice(0, idx);
  }
  function buildFileTree(files){
    const root = { name:'', children: new Map(), files: [] };
    for(const f of files){
      const parts = f.path.replace(/^\//,'').split('/');
      let node = root;
      for(let i=0;i<parts.length-1;i++){
        const seg = parts[i];
        if(!node.children.has(seg)) node.children.set(seg, { name:seg, children:new Map(), files:[], fullPath: (node.fullPath?node.fullPath+'/':'')+seg });
        node = node.children.get(seg);
      }
      node.files.push(f);
    }
    return root;
  }
  function renderTreeNode(node, depth, nodeFullPath){
    let html = '';
    // folders first, alphabetical, then files per the active sort mode
    const folderNames = [...node.children.keys()].sort((a,b)=>a.localeCompare(b));
    for(const name of folderNames){
      const child = node.children.get(name);
      const collapsed = collapsedFolders.has(child.fullPath);
      if(pendingRename === child.fullPath){
        html += `<div class="ft-node">
          <div class="ft-row ft-folder" style="padding-left:${depth*4}px;">
            <span class="ft-icon">📁</span><input class="ft-name-input" data-rename-kind="folder" data-rename-old="${escapeHtml(child.fullPath)}" value="${escapeHtml(name)}">
          </div>
        </div>`;
        continue;
      }
      const folderSelected = selectedTreeEntry && selectedTreeEntry.type==='folder' && selectedTreeEntry.path===child.fullPath;
      html += `<div class="ft-node">
        <div class="ft-row ft-folder${folderSelected?' ft-selected':''}" data-folder="${escapeHtml(child.fullPath)}" draggable="true" style="padding-left:${depth*4}px;" title="New files/folders will be created inside this folder">
          <span class="ft-caret${collapsed?'':' expanded'}">▶</span><span class="ft-icon">${collapsed?'📁':'📂'}</span><span class="ft-name">${escapeHtml(name)}</span>
        </div>
        <div class="ft-children${collapsed?' collapsed':''}">${renderTreeNode(child, depth+1, child.fullPath)}</div>
      </div>`;
    }
    if(pendingCreate && pendingCreate.parentFolder === (nodeFullPath||'')){
      const placeholder = pendingCreate.kind==='file' ? 'FILENAME.X68' : 'folder name';
      html += `<div class="ft-row" style="padding-left:${depth*4+15}px;">
        <span class="ft-icon">${pendingCreate.kind==='file'?'📝':'📁'}</span>
        <input class="ft-name-input" id="ftPendingCreateInput" placeholder="${placeholder}" value="">
      </div>`;
    }
    const sortedFiles = sortWithinFolder(node.files);
    for(const f of sortedFiles){
      if(pendingRename === f.path){
        html += `<div class="ft-row" style="padding-left:${depth*4+15}px;">
          <span class="ft-icon">${iconFor(f.path)}</span>
          <input class="ft-name-input" data-rename-kind="file" data-rename-old="${escapeHtml(f.path)}" value="${escapeHtml(f.path.slice(f.path.lastIndexOf('/')+1))}">
        </div>`;
        continue;
      }
      const label = 'Auto-saved locally in this browser (IndexedDB) — use Export ZIP for a real file';
      const active = f.path===currentVirtualPath;
      const fileSelected = selectedTreeEntry && selectedTreeEntry.type==='file' && selectedTreeEntry.path===f.path;
      html += `<div class="ft-row ft-file${active?' active':''}${fileSelected?' ft-selected':''}" data-path="${escapeHtml(f.path)}" draggable="true" style="padding-left:${depth*4+15}px;" title="${label}">
        <span class="ft-icon">${iconFor(f.path)}</span><span class="ft-name">${escapeHtml(f.path.slice(f.path.lastIndexOf('/')+1))}</span>
        <span class="ft-size">${f.size}B</span><span class="ft-delete" data-delete-path="${escapeHtml(f.path)}" title="Delete from storage">✕</span>
      </div>`;
    }
    return html;
  }
  function sortWithinFolder(files){
    const ext = p => { const i = p.lastIndexOf('.'); return i>=0 ? p.slice(i+1).toLowerCase() : ''; };
    const base = p => p.slice(p.lastIndexOf('/')+1).toLowerCase();
    const arr = files.slice();
    switch(fileSortMode){
      case 'type': arr.sort((a,b)=> ext(a.path).localeCompare(ext(b.path)) || base(a.path).localeCompare(base(b.path))); break;
      case 'size': arr.sort((a,b)=> b.size - a.size); break;
      case 'recent': arr.sort((a,b)=> (lastOpenedMap.get(b.path)||0) - (lastOpenedMap.get(a.path)||0)); break;
      default: arr.sort((a,b)=> base(a.path).localeCompare(base(b.path)));
    }
    return arr;
  }
  function renderFileTree(){
    if(!uploadedFiles.length && !pendingCreate){
      fileTreeEl.innerHTML = '<div class="file-tree-empty">No files opened. Right-click here, or use the buttons above, to create or upload one.</div>';
      return;
    }
    const tree = buildFileTree(uploadedFiles);
    fileTreeEl.innerHTML = renderTreeNode(tree, 0, '');
    fileTreeEl.querySelectorAll('.ft-file').forEach(row=>{
      row.addEventListener('click', ()=>{
        selectedTreeEntry = {type:'file', path: row.dataset.path};
        if(appMode === 'simulating'){
          const idx = machine.listingDisplayLines.findIndex(e => e.file === row.dataset.path);
          if(idx === -1){
            // Not part of the currently assembled program (a totally
            // different file, not one of its INCLUDEs) - there's nothing
            // to scroll to. Whether the program is still running, paused,
            // or long since halted, clicking a file the user clearly wants
            // to look at or edit must actually open it, not silently do
            // nothing (see stopSimulationReturnToEditing()).
            stopSimulationReturnToEditing();
            loadVirtualFile(row.dataset.path);
            ui.renderAll();
            return;
          }
          const el = document.getElementById('simListingView');
          const rowEl = el.children[idx];
          if(rowEl){
            if(rowEl.scrollIntoView) rowEl.scrollIntoView({block:'start'});
            rowEl.classList.add('sl-jump-flash');
            setTimeout(()=> rowEl.classList.remove('sl-jump-flash'), 900);
          }
          return;
        }
        loadVirtualFile(row.dataset.path);
      });
      row.addEventListener('contextmenu', e=>{ e.preventDefault(); showFtContextMenu(e, {type:'file', path: row.dataset.path}); });
      row.addEventListener('dragstart', e=>{
        dragFtEntry = {type:'file', path: row.dataset.path};
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.path);
        row.style.opacity = '0.5';
      });
      row.addEventListener('dragend', ()=>{ dragFtEntry = null; row.style.opacity = ''; });
    });
    fileTreeEl.querySelectorAll('.ft-delete').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        deleteFileFromStorage(btn.dataset.deletePath);
      });
    });
    fileTreeEl.querySelectorAll('.ft-folder').forEach(row=>{
      row.addEventListener('click', ()=>{
        const path = row.dataset.folder;
        selectedTreeEntry = {type:'folder', path};
        if(collapsedFolders.has(path)) collapsedFolders.delete(path); else collapsedFolders.add(path);
        renderFileTree();
      });
      row.addEventListener('contextmenu', e=>{ e.preventDefault(); e.stopPropagation(); showFtContextMenu(e, {type:'folder', path: row.dataset.folder}); });
      row.addEventListener('dragstart', e=>{
        dragFtEntry = {type:'folder', path: row.dataset.folder};
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.folder);
        e.stopPropagation(); // don't let an ancestor folder row also start a drag for the same gesture
        row.style.opacity = '0.5';
      });
      row.addEventListener('dragend', ()=>{ dragFtEntry = null; row.style.opacity = ''; });
      row.addEventListener('dragover', e=>{
        if(!dragFtEntry && !isExternalFileDrag(e)) return;
        e.preventDefault(); e.stopPropagation();
        if(!dragFtEntry) e.dataTransfer.dropEffect = 'copy'; // external files are copied in, not moved out of the OS
        row.classList.add('ft-drop-target');
      });
      row.addEventListener('dragleave', ()=>{ row.classList.remove('ft-drop-target'); });
      row.addEventListener('drop', e=>{
        if(!dragFtEntry && !isExternalFileDrag(e)) return;
        e.preventDefault(); e.stopPropagation();
        row.classList.remove('ft-drop-target');
        if(dragFtEntry){
          const entry = dragFtEntry; dragFtEntry = null;
          moveOrCopyEntry('move', entry.type, entry.path, row.dataset.folder);
        } else {
          handleExternalFileDrop(e, row.dataset.folder); // real files/folders dragged in from the OS - upload into this folder
        }
      });
    });
    fileTreeEl.addEventListener('click', e=>{
      if(e.target.closest('.ft-row')) return; // handled by the more specific per-row listeners above
      if(selectedTreeEntry){ selectedTreeEntry = null; renderFileTree(); }
    });
    fileTreeEl.addEventListener('contextmenu', e=>{
      if(e.target.closest('.ft-row')) return; // handled by the more specific listeners above
      e.preventDefault();
      showFtContextMenu(e, {type:'root'});
    });
    fileTreeEl.addEventListener('dragover', e=>{
      if(e.target.closest('.ft-folder')) return; // folders handle their own drop
      if(!dragFtEntry && !isExternalFileDrag(e)) return;
      e.preventDefault();
      if(!dragFtEntry) e.dataTransfer.dropEffect = 'copy';
    });
    fileTreeEl.addEventListener('drop', e=>{
      if(e.target.closest('.ft-folder')) return; // folders already handled it, and stopped propagation
      if(!dragFtEntry && !isExternalFileDrag(e)) return;
      e.preventDefault();
      if(dragFtEntry){
        const entry = dragFtEntry; dragFtEntry = null;
        moveOrCopyEntry('move', entry.type, entry.path, ''); // dropped on empty tree space - move to root
      } else {
        handleExternalFileDrop(e, ''); // real files/folders dragged in from the OS, dropped on empty space - upload to root
      }
    });
    const pendingInput = document.getElementById('ftPendingCreateInput');
    if(pendingInput){
      pendingInput.focus();
      pendingInput.addEventListener('keydown', e=>{
        if(e.key==='Enter') confirmPendingCreate(pendingInput.value);
        else if(e.key==='Escape') cancelPendingCreate();
      });
      pendingInput.addEventListener('blur', ()=>{ setTimeout(()=>{ if(pendingCreate) confirmPendingCreate(pendingInput.value); }, 120); });
    }
    fileTreeEl.querySelectorAll('[data-rename-old]').forEach(input=>{
      input.focus();
      input.select();
      input.addEventListener('keydown', e=>{
        if(e.key==='Enter') confirmPendingRename(input);
        else if(e.key==='Escape') cancelPendingRename();
      });
      input.addEventListener('blur', ()=>{ setTimeout(()=>{ if(pendingRename) confirmPendingRename(input); }, 120); });
    });
  }
  const renderFileTable = renderFileTree; // alias: existing call sites throughout the file are unchanged
  document.querySelectorAll('.file-sort-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      fileSortMode = btn.dataset.sort;
      document.querySelectorAll('.file-sort-btn').forEach(b=>b.classList.toggle('active', b===btn));
      renderFileTable();
    });
  });

  async function createFileAtPath(path, content=''){
    if(uploadedFiles.some(f=>f.path===path)) return 'A file with that name already exists here.';
    const name = path.replace(/^\//,'');
    persistCurrentToVFS();
    const contentBytes = new TextEncoder().encode(content);
    writeToBothFS(path, contentBytes);
    registerFile(path, content.length);
    idbSaveFile(path, contentBytes);
    ui.appendLog(`Created ${path} (auto-saved in this browser; use Export ZIP or Download file to get it onto disk).`);
    sourceEl.value = content;
    currentVirtualPath = path;
    currentFileRawText = content;
    // If the pane was showing the "No file open" placeholder (e.g. the
    // last file was just deleted), that state left the textarea locked
    // read-only - switchToTabInCurrentPane()/loadVirtualFile() always
    // clear this when opening a file, but this is a separate code path
    // (creating a brand new one) that has to clear it too, or the new
    // file opens read-only with the empty-pane's gray background stuck
    // on despite currentVirtualPath now being non-null.
    sourceEl.readOnly = false;
    sourceEl.placeholder = '';
    syncEditor();
    setCurrentFile(name, null);
    renderFileTable();
    markFileOpened(path);
    return true;
  }
  /* ---- New File modal: a real dialog (not the inline tree row used for
     rename/New Folder) since a filename needs the "use .X68 extension"
     checkbox logic - always checked when the dialog opens; typing an
     extension auto-unchecks it (since the user has clearly stated their
     own extension); checked + no extension typed means .X68 gets
     appended automatically. ---- */
  let newFileParentFolder = '';
  const newFileModalEl = document.getElementById('newFileModal');
  const newFileNameInputEl = document.getElementById('newFileNameInput');
  const newFileUseExtCheckboxEl = document.getElementById('newFileUseExtCheckbox');
  const newFileUseTemplateCheckboxEl = document.getElementById('newFileUseTemplateCheckbox');
  const newFileNameErrorEl = document.getElementById('newFileNameError');
  function newFile(parentFolder){
    if(blockedDuringSimulation()) return;
    newFileParentFolder = parentFolder || '';
    newFileNameInputEl.value = '';
    newFileUseExtCheckboxEl.checked = true; // always checked when the dialog appears
    newFileUseTemplateCheckboxEl.checked = true; // default: start from the template
    newFileNameErrorEl.style.display = 'none';
    newFileModalEl.hidden = false;
    setTimeout(()=> newFileNameInputEl.focus(), 30);
  }
  function closeNewFileModal(){ newFileModalEl.hidden = true; }
  newFileNameInputEl.addEventListener('input', ()=>{
    // typing a "." (an extension) is a clear signal the user wants their
    // own extension, not the automatic .X68 - auto-uncheck to reflect that
    if(newFileNameInputEl.value.includes('.') && newFileUseExtCheckboxEl.checked){
      newFileUseExtCheckboxEl.checked = false;
    }
    newFileNameErrorEl.style.display = 'none';
  });
  async function confirmNewFileModal(){
    let name = newFileNameInputEl.value.trim();
    if(!name){ newFileNameErrorEl.textContent = 'Enter a file name.'; newFileNameErrorEl.style.display = ''; return; }
    if(/[\\:*?"<>|]/.test(name)){ newFileNameErrorEl.textContent = 'That name contains characters not allowed in a filename.'; newFileNameErrorEl.style.display = ''; return; }
    if(newFileUseExtCheckboxEl.checked && !name.includes('.')) name += '.X68';
    const path = '/' + (newFileParentFolder ? newFileParentFolder+'/' : '') + name;
    const content = newFileUseTemplateCheckboxEl.checked ? DEFAULT_SOURCE : '';
    const result = await createFileAtPath(path, content);
    if(result !== true){ newFileNameErrorEl.textContent = result; newFileNameErrorEl.style.display = ''; return; }
    closeNewFileModal();
    renderFileTree();
  }
  document.getElementById('btnNewFileModalCreate').addEventListener('click', confirmNewFileModal);
  document.getElementById('btnNewFileModalCancel').addEventListener('click', closeNewFileModal);
  document.getElementById('btnNewFileModalClose').addEventListener('click', closeNewFileModal);
  newFileNameInputEl.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); confirmNewFileModal(); }
    else if(e.key==='Escape'){ e.preventDefault(); closeNewFileModal(); }
  });
  function newFolder(parentFolder){ if(blockedDuringSimulation()) return; startInlineCreate('folder', parentFolder||''); }
  function startInlineCreate(kind, parentFolder){
    pendingCreate = { kind, parentFolder: parentFolder||'' };
    if(parentFolder) collapsedFolders.delete(parentFolder);
    renderFileTree();
  }
  function cancelPendingCreate(){ pendingCreate = null; renderFileTree(); }
  async function confirmPendingCreate(rawName){
    if(!pendingCreate) return;
    const name = (rawName||'').trim();
    if(!name){ cancelPendingCreate(); return; }
    const { kind, parentFolder } = pendingCreate;
    if(kind==='folder'){
      // there's no standalone "empty folder" concept in this VFS - folders
      // exist implicitly via file paths, so creating one means creating a
      // starter file inside it (the tree will show the folder as soon as
      // any file exists under that path)
      const path = '/' + (parentFolder ? parentFolder+'/' : '') + name + '/.keep';
      pendingCreate = null;
      const result = await createFileAtPath(path);
      if(result !== true){ startInlineCreate(kind, parentFolder); showFtInlineError(result); return; }
      collapsedFolders.delete((parentFolder ? parentFolder+'/' : '') + name);
      renderFileTree();
      return;
    }
    const path = '/' + (parentFolder ? parentFolder+'/' : '') + name;
    pendingCreate = null;
    const result = await createFileAtPath(path);
    if(result !== true){ startInlineCreate(kind, parentFolder); showFtInlineError(result); return; }
    renderFileTree();
  }
  function showFtInlineError(message){
    const input = document.getElementById('ftPendingCreateInput') || fileTreeEl.querySelector('[data-rename-old]');
    if(!input) return;
    input.classList.add('ft-invalid');
    let err = input.parentElement.nextElementSibling;
    if(!err || !err.classList || !err.classList.contains('ft-inline-error')){
      err = document.createElement('div');
      err.className = 'ft-inline-error';
      input.closest('.ft-row').after(err);
    }
    err.textContent = message;
    input.focus();
  }
  function startInlineRename(path){ pendingRename = path; renderFileTree(); }
  function cancelPendingRename(){ pendingRename = null; renderFileTree(); }
  async function confirmPendingRename(input){
    const oldPath = input.dataset.renameOld;
    const kind = input.dataset.renameKind;
    const name = input.value.trim();
    if(!name || name === oldPath.slice(oldPath.lastIndexOf('/')+1)){ cancelPendingRename(); return; }
    pendingRename = null;
    if(kind==='folder'){
      // renaming a folder = renaming every file under it, preserving the sub-path
      const oldPrefix = oldPath + '/';
      const parentDir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')+1) : '';
      const newFolderPath = parentDir + name;
      const filesToMove = uploadedFiles.filter(f => f.path.replace(/^\//,'').startsWith(oldPrefix)).map(f=>f.path);
      for(const oldFilePath of filesToMove){
        const rest = oldFilePath.replace(/^\//,'').slice(oldPrefix.length);
        await renameFileInStorage(oldFilePath, newFolderPath + '/' + rest);
      }
      renderFileTree();
      return;
    }
    const result = await renameFileInStorage(oldPath, name);
    if(result !== true){ startInlineRename(oldPath); showFtInlineError(typeof result==='string' ? result : 'Could not rename.'); return; }
    renderFileTree();
  }
  /* ---- right-click context menu: New File/Folder here, Rename, Delete -
     matches how a real file manager behaves, rather than only offering
     creation via toolbar buttons at the root. ---- */
  const ftContextMenuEl = document.getElementById('ftContextMenu');
  function hideFtContextMenu(){ ftContextMenuEl.hidden = true; }
  async function pasteFtClipboardInto(targetFolder){
    if(!ftClipboard) return;
    const { mode, type, path } = ftClipboard;
    const ok = await moveOrCopyEntry(mode==='cut'?'move':'copy', type, path, targetFolder);
    if(ok && mode==='cut') ftClipboard = null; // cut is one-shot; copy can be pasted repeatedly
  }
  function showFtContextMenu(e, target){
    const items = [];
    if(target.type==='root'){
      // Right-clicking empty tree space still honors the current selection
      // (same rule as the toolbar buttons) rather than forcing root, so a
      // folder/file selected higher up stays the target even from here.
      items.push(['New File', ()=> newFile(currentTreeCreateFolder())]);
      items.push(['New Folder', ()=> newFolder(currentTreeCreateFolder())]);
      items.push(null);
      items.push(['Upload files…', ()=> $('#fileInputMulti').click()]);
      items.push(['Upload ZIP…', ()=> $('#fileInputZip').click()]);
      if(ftClipboard){ items.push(null); items.push(['Paste', ()=> pasteFtClipboardInto('')]); }
    } else if(target.type==='folder'){
      items.push(['New File here', ()=> newFile(target.path)]);
      items.push(['New Folder here', ()=> newFolder(target.path)]);
      items.push(null);
      items.push(['Rename', ()=> startInlineRename(target.path)]);
      items.push(['Cut', ()=> { ftClipboard = {mode:'cut', type:'folder', path: target.path}; }]);
      items.push(['Copy', ()=> { ftClipboard = {mode:'copy', type:'folder', path: target.path}; }]);
      if(ftClipboard) items.push(['Paste here', ()=> pasteFtClipboardInto(target.path)]);
      items.push(null);
      items.push(['Delete folder', ()=> deleteFolderFromStorage(target.path), true]);
    } else if(target.type==='file'){
      items.push(['Rename', ()=> startInlineRename(target.path)]);
      items.push(['Cut', ()=> { ftClipboard = {mode:'cut', type:'file', path: target.path}; }]);
      items.push(['Copy', ()=> { ftClipboard = {mode:'copy', type:'file', path: target.path}; }]);
      items.push(null);
      items.push(['Delete', ()=> deleteFileFromStorage(target.path), true]);
    }
    ftContextMenuEl.innerHTML = items.map(it => it===null
      ? '<div class="ft-ctx-sep"></div>'
      : `<div class="ft-ctx-item${it[2]?' ft-ctx-danger':''}" data-idx="${items.indexOf(it)}">${it[0]}</div>`
    ).join('');
    ftContextMenuEl.querySelectorAll('.ft-ctx-item').forEach(el=>{
      el.addEventListener('click', ()=>{ hideFtContextMenu(); items[+el.dataset.idx][1](); });
    });
    ftContextMenuEl.hidden = false;
    const maxX = window.innerWidth - 180, maxY = window.innerHeight - (items.length*28+10);
    ftContextMenuEl.style.left = Math.min(e.clientX, maxX) + 'px';
    ftContextMenuEl.style.top = Math.min(e.clientY, maxY) + 'px';
  }
  document.addEventListener('click', e=>{ if(!e.target.closest('.ft-context-menu')) hideFtContextMenu(); });
  document.addEventListener('contextmenu', e=>{ if(!e.target.closest('.file-tree')) hideFtContextMenu(); });

  // Persists the currently-open file's editor content back to the virtual
  // filesystem (both engines) and IndexedDB - browser-only, always; never
  // touches real disk (see saveFile() for the one deliberate, one-shot
  // download path).
  async function persistCurrentToVFS(){
    if(!currentVirtualPath || !machine.asmEngine) return;
    // Never persist the untouched startup demo - if the first real action
    // is opening a project, we don't want a spurious "untitled.X68"
    // containing our demo code appearing anywhere it shouldn't.
    if(currentVirtualPath === '/untitled.X68' && sourceEl.value === DEFAULT_SOURCE) return;
    // If the textarea's current content is EXACTLY what a browser would
    // show for the file's last-loaded text with nothing but its forced
    // newline normalization applied, nothing was actually edited - skip
    // the write entirely and leave the file's real on-disk bytes untouched.
    // This matters specifically for a file containing real CR (\r, byte
    // 13) bytes, e.g. one a TRAP #15 program wrote with explicit 13,10
    // line endings: merely OPENING it (no keystrokes at all) already lost
    // every \r the moment it became sourceEl.value (see
    // textareaNormalizeNewlines()'s own comment), so a plain "does the
    // textarea's value differ from what a naive re-read of the ORIGINAL
    // raw text would look like" check can never tell "genuinely edited"
    // apart from "merely viewed" - both look identical to a value that's
    // already been silently normalized. Comparing against a baseline that
    // ALSO went through the same normalization is the only reliable test.
    // Without this, viewing such a file and switching away permanently
    // stripped its CR bytes - collapsing "next line, same column" into
    // "next line, column 0 lost", corrupting later TRAP #15 reads/prints
    // of that same file even though the user never touched a key.
    if(currentFileRawText !== null && sourceEl.value === textareaNormalizeNewlines(currentFileRawText)) return;
    // A genuine edit happened - but naively persisting sourceEl.value
    // verbatim would still strip every \r from the WHOLE file (a textarea
    // can never contain one, anywhere), not just wherever the edit actually
    // happened. mergeEditIntoRaw() reconstructs the file from the ORIGINAL
    // raw bytes for the unchanged prefix/suffix around the edit, keeping
    // any \r bytes there intact, and only uses the new (unavoidably
    // LF-only) text for the actually-edited span. See its own comment for
    // the to_do.md report this fixes ("the problem appears again" after
    // editing a file that survived being merely viewed).
    const text = (currentFileRawText !== null) ? mergeEditIntoRaw(currentFileRawText, sourceEl.value) : sourceEl.value;
    const data = new TextEncoder().encode(text);
    try{ writeToBothFS(currentVirtualPath, data); }catch(e){}
    registerFile(currentVirtualPath, data.length);
    idbSaveFile(currentVirtualPath, data); // universal safety net, every browser - deliberately the ONLY persistence here; never writes back to a real disk file
    currentFileRawText = text; // the file's real content genuinely IS this now - keep the baseline in sync so a later no-op switch away doesn't re-persist (and thus re-normalize) it again
  }
  /* ---- file tabs bar: tracks files opened during this session (not
     every file in the project - just ones actually viewed), rendered as
     Sublime-style tabs for quick switching. Closing a tab only removes
     it from this list; it doesn't touch the actual file. ---- */
  let openedFiles = []; // [{path, name}], in open order
  function markFileOpened(path){
    const name = path.replace(/^\//,'');
    if(!openedFiles.some(f=>f.path===path)) openedFiles.push({path, name});
    renderFileTabsBar();
  }
  let fileTabsBarEl = $('#fileTabsBar');
  function renderFileTabsBar(){
    const bar = fileTabsBarEl;
    if(!bar) return;
    const paneAtRenderTime = panes[activePaneIdx]; // the pane this tab bar actually belongs to - stays correct even if a different pane becomes active later, since a non-active pane's tab bar isn't re-rendered until it's activated again
    bar.innerHTML = '';
    for(const f of openedFiles){
      const tab = document.createElement('div');
      tab.className = 'file-tab' + (f.path===currentVirtualPath ? ' active' : '');
      tab.title = f.path;
      tab.draggable = true;
      tab.innerHTML = `<span class="mod-dot"></span><span class="tab-name"></span><span class="close-x">✕</span>`;
      tab.querySelector('.tab-name').textContent = f.name;
      tab.addEventListener('click', (e)=>{
        if(e.target.closest('.close-x')) return;
        activatePane(paneAtRenderTime);
        if(f.path !== currentVirtualPath) loadVirtualFile(f.path);
      });
      tab.querySelector('.close-x').addEventListener('click', (e)=>{
        e.stopPropagation();
        activatePane(paneAtRenderTime);
        closeFileTab(f.path);
      });
      wireTabDragHandlers(tab, f.path, paneAtRenderTime);
      bar.appendChild(tab);
    }
  }
  /* ---- drag tabs between splits ---- */
  let dragTabInfo = null; // {path, sourcePane}
  function wireTabDragHandlers(tab, path, sourcePane){
    tab.addEventListener('dragstart', e=>{
      dragTabInfo = {path, sourcePane};
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
      tab.style.opacity = '0.5';
    });
    tab.addEventListener('dragend', ()=>{ dragTabInfo = null; tab.style.opacity = ''; });
  }
  function moveTabBetweenPanes(path, sourcePane, targetPane){
    if(sourcePane === targetPane) return;
    activatePane(sourcePane);
    closeFileTab(path); // reuses the same tested remove/fallback logic as clicking a tab's close button
    activatePane(targetPane);
    loadVirtualFile(path);
  }
  function wireTabDropTarget(dropZoneEl, getOwnPane){
    dropZoneEl.addEventListener('dragover', e=>{
      if(dragTabInfo) e.preventDefault();
    });
    dropZoneEl.addEventListener('drop', e=>{
      if(!dragTabInfo) return;
      e.preventDefault();
      const {path, sourcePane} = dragTabInfo;
      moveTabBetweenPanes(path, sourcePane, getOwnPane());
      dragTabInfo = null;
    });
  }

  function showEmptyPaneState(){
    persistCurrentToVFS();
    currentVirtualPath = null;
    currentFileRawText = null;
    currentFileName = 'No file open';
    currentFileHandle = null;
    sourceEl.value = '';
    sourceEl.readOnly = true;
    sourceEl.placeholder = 'No file open in this pane.\nOpen a file from the FILES panel on the left, or create a new one.';
    syncEditor();
    setCurrentFile('No file open', null);
  }
  function switchToTabInCurrentPane(path){
    persistCurrentToVFS();
    let text = '';
    try{ text = readVfsTextFile(machine.asmEngine.FS, path); }
    catch(e){
      if(path === '/untitled.X68'){ text = DEFAULT_SOURCE; }
      else { ui.appendLog(`Could not read ${path} from the virtual filesystem.`); return; }
    }
    sourceEl.value = text;
    currentVirtualPath = path;
    currentFileRawText = text;
    lastOpenedMap.set(path, Date.now());
    sourceEl.readOnly = false;
    sourceEl.placeholder = '';
    syncEditor();
    setCurrentFile(path.replace(/^\//,''), null);
    renderFileTable();
    markFileOpened(path);
  }
  function closeFileTab(path){
    const idx = openedFiles.findIndex(f=>f.path===path);
    if(idx===-1) return;
    const closingActiveTab = (path === currentVirtualPath);
    openedFiles.splice(idx,1);
    if(closingActiveTab){
      const next = openedFiles[idx] || openedFiles[idx-1];
      if(next){
        switchToTabInCurrentPane(next.path);
      } else if(panes.length > 1 && panes[activePaneIdx] !== panes[0]){
        // last tab in a non-primary pane, with other panes still open:
        // the pane itself closes rather than sitting empty - matches
        // "closing the file in this split" reading as "closing the split"
        closeEditorPane(panes[activePaneIdx]);
        return; // closeEditorPane already re-renders everything needed
      } else {
        // the primary pane, or the only pane left - never auto-closes,
        // shows an explicit empty state instead of stale/untracked content
        showEmptyPaneState();
      }
    }
    renderFileTabsBar();
  }
  // Close current/others/all - all scoped to the CURRENT pane's own tab
  // strip (each split pane keeps its own independent openedFiles list, see
  // the split-editor comment just below), reusing closeFileTab's existing
  // active-tab-switch / pane-collapse / empty-state fallback logic so
  // there's exactly one code path that knows how to safely close a tab.
  function closeCurrentTab(){
    if(currentVirtualPath) closeFileTab(currentVirtualPath);
  }
  function closeOtherTabs(){
    if(!currentVirtualPath) return;
    for(const f of [...openedFiles]){
      if(f.path !== currentVirtualPath) closeFileTab(f.path);
    }
  }
  function closeAllTabsInPane(){
    for(const f of [...openedFiles]) closeFileTab(f.path);
  }

  /* ---- split editor panes ----
     Rather than rewriting every one of the ~90 places that reference the
     editor's state (sourceEl, gutterEl, currentVirtualPath, openedFiles,
     etc.), each pane keeps its own copy of that state, and switching the
     "active" pane simply repoints these variables to that pane's copies.
     Every existing function (syncEditor, loadVirtualFile, doAssemble,
     comment toggle, breakpoint gutter clicks...) keeps working completely
     unmodified - it just always operates on "whichever pane was most
     recently interacted with", which is exactly the semantics a split
     editor needs. Only the interactive elements (gutter, textarea, editor
     scroll container) need a small hook added to activate their own pane
     before running their normal logic. ---- */
  const panes = [{
    containerEl: document.querySelector('.editor-pane-instance'),
    sourceEl, gutterEl, highlightEl, editorStackEl, fileTabsBarEl,
    currentVirtualPath, currentFileRawText, currentFileName, currentFileHandle, openedFiles,
  }];
  wireTabDropTarget(panes[0].containerEl, ()=> panes[0]);
  let activePaneIdx = 0;
  function activatePane(paneOrIdx){
    const p = typeof paneOrIdx === 'number' ? panes[paneOrIdx] : paneOrIdx;
    const newIdx = panes.indexOf(p);
    if(newIdx === -1 || newIdx === activePaneIdx) return;
    // save the currently-active pane's JS-only state (DOM-backed state
    // like the textarea's text needs no saving - it lives in the element).
    // Skip if that pane no longer exists (e.g. it was just closed, which
    // is exactly when activatePane gets called to pick a replacement).
    const cur = panes[activePaneIdx];
    if(cur){
      cur.currentVirtualPath = currentVirtualPath;
      cur.currentFileRawText = currentFileRawText;
      cur.currentFileName = currentFileName;
      cur.currentFileHandle = currentFileHandle;
      cur.openedFiles = openedFiles;
      cur.containerEl.classList.remove('pane-active');
    }
    // repoint to the newly active pane
    activePaneIdx = newIdx;
    sourceEl = p.sourceEl; gutterEl = p.gutterEl; highlightEl = p.highlightEl;
    editorStackEl = p.editorStackEl; fileTabsBarEl = p.fileTabsBarEl;
    currentVirtualPath = p.currentVirtualPath; currentFileRawText = p.currentFileRawText;
    currentFileName = p.currentFileName;
    currentFileHandle = p.currentFileHandle; openedFiles = p.openedFiles;
    p.containerEl.classList.add('pane-active');
    syncEditor();
    renderFileTabsBar();
    fileNameTag.textContent = currentFileName + (currentFileHandle ? '' : ' (download)');
    applyEditorSettings();
  }
  // Single source of truth for toggling a breakpoint - keeps the normal
  // editor gutter, the simulation listing view, and the breakpoint list
  // panel all consistent regardless of which of the three UIs the toggle
  // actually came from.
  function toggleBreakpoint(path, line){
    const bpSet = machine.getBreakpointsFor(path);
    const willBeSet = !bpSet.has(line);
    if(willBeSet) bpSet.add(line); else bpSet.delete(line);
    machine.recomputeBreakpointAddrs();
    if(appMode !== 'simulating') syncEditor(); // the normal editor is hidden during simulation - no point rebuilding it
    else {
      // targeted update of just this one row, avoiding a full listing rebuild
      const el = document.getElementById('simListingView');
      const row = [...el.querySelectorAll('.sl-line')].find(r => r.dataset.file===path && parseInt(r.dataset.line,10)===line);
      if(row) row.classList.toggle('sl-bp', willBeSet);
    }
    renderBreakpointList();
  }
  // Heuristic for "this line can't possibly generate code" while editing
  // (before assembly, so there's no definitive info yet the way the
  // simulation view has via hasBytes) - empty lines, comment-only lines,
  // and known non-executable directives (macro definitions, conditional
  // assembly, listing control, etc).
  const NON_EXECUTABLE_DIRECTIVES = new Set([
    'MACRO','ENDM','MEXIT','ENDR','ENDC','IFC','IFNC','IFEQ','IFNE','IFGE','IFGT','IFLE','IFLT',
    'IFD','IFND','IFB','IFNB','OPT','TTL','PAGE','LIST','NOLIST','END','SECTION','XDEF','XREF'
  ]);
  function isNonExecutableSourceLine(text){
    const trimmed = text.trim();
    if(!trimmed) return true;
    if(trimmed.startsWith(';') || trimmed.startsWith('*')) return true;
    const words = trimmed.split(/\s+/);
    // a bare directive (no label before it) is just the first word; a
    // labeled line's directive is the second word
    const candidateWords = [words[0].toUpperCase().replace(/:$/,''), (words[1]||'').toUpperCase()];
    return candidateWords.some(w => NON_EXECUTABLE_DIRECTIVES.has(w));
  }
  function wireEditorPaneEvents(p){
    p.gutterEl.addEventListener('mousedown', ()=> activatePane(p));
    p.sourceEl.addEventListener('focus', ()=> activatePane(p));
    p.sourceEl.addEventListener('input', ()=>{ activatePane(p); syncEditor(); scheduleAutoSync(); });
    p.sourceEl.addEventListener('keydown', e=>{ activatePane(p); handleEditorTabKey(e); });
    // Pure caret moves (click-to-position, arrow/Home/End navigation) don't
    // change .value, so they never fire 'input' and never reach the
    // syncEditor() call above - the status bar needs its own lightweight
    // listeners rather than piggybacking on that one.
    p.sourceEl.addEventListener('click', ()=>{ activatePane(p); updateCursorPosInfo(); });
    p.sourceEl.addEventListener('keyup', ()=> updateCursorPosInfo());
    p.editorStackEl.addEventListener('scroll', ()=>{
      p.gutterEl.scrollTop = p.editorStackEl.scrollTop;
    });
  }
  const EDITOR_PANE_MIN_WIDTH = 200;
  function wirePaneSplitter(splitterEl, leftPaneEl, rightPaneEl){
    let dragging = false, startX = 0, startLeftW = 0, startRightW = 0;
    splitterEl.addEventListener('mousedown', e=>{
      dragging = true;
      splitterEl.classList.add('dragging');
      startX = e.clientX;
      startLeftW = leftPaneEl.getBoundingClientRect().width;
      startRightW = rightPaneEl.getBoundingClientRect().width;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const delta = e.clientX - startX;
      let newLeftW = startLeftW + delta;
      let newRightW = startRightW - delta;
      if(newLeftW < EDITOR_PANE_MIN_WIDTH){ newRightW -= (EDITOR_PANE_MIN_WIDTH - newLeftW); newLeftW = EDITOR_PANE_MIN_WIDTH; }
      if(newRightW < EDITOR_PANE_MIN_WIDTH){ newLeftW -= (EDITOR_PANE_MIN_WIDTH - newRightW); newRightW = EDITOR_PANE_MIN_WIDTH; }
      // still enforce the floor even when both would want to shrink past it at once (very narrow window)
      newLeftW = Math.max(EDITOR_PANE_MIN_WIDTH, newLeftW);
      newRightW = Math.max(EDITOR_PANE_MIN_WIDTH, newRightW);
      leftPaneEl.style.flex = `0 0 ${newLeftW}px`;
      rightPaneEl.style.flex = `0 0 ${newRightW}px`;
    });
    window.addEventListener('mouseup', ()=>{
      if(dragging){ dragging = false; splitterEl.classList.remove('dragging'); }
    });
  }
  function createEditorPane(){
    // reset any manually-dragged fixed-pixel widths back to equal-share
    // BEFORE adding the new pane - otherwise old panes' pixel widths could
    // sum to more than the available space once a new pane joins them
    // (flex:0 0 Npx never shrinks), overflowing past the right column
    for(const existing of panes) existing.containerEl.style.flex = '';
    const template = panes[0].containerEl;
    const clone = template.cloneNode(true);
    clone.removeAttribute('data-pane-idx');
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btnClosePaneX';
    closeBtn.title = 'Close this split';
    closeBtn.textContent = '✕';
    const newFileTabsBar = clone.querySelector('.file-tabs-bar');
    const tabsRow = document.createElement('div');
    tabsRow.className = 'file-tabs-row';
    newFileTabsBar.parentNode.insertBefore(tabsRow, newFileTabsBar);
    tabsRow.appendChild(newFileTabsBar);
    tabsRow.appendChild(closeBtn);
    const editorPanesRowEl = document.getElementById('editorPanesRow');
    const prevLastPane = editorPanesRowEl.lastElementChild; // the pane this new one is being added after
    const splitterEl = document.createElement('div');
    splitterEl.className = 'editor-pane-splitter';
    editorPanesRowEl.appendChild(splitterEl);
    editorPanesRowEl.appendChild(clone);
    if(prevLastPane) wirePaneSplitter(splitterEl, prevLastPane, clone);
    const newPane = {
      containerEl: clone,
      sourceEl: clone.querySelector('#source') || clone.querySelector('textarea'),
      gutterEl: clone.querySelector('.gutter'),
      highlightEl: clone.querySelector('#highlightLayer') || clone.querySelector('pre'),
      editorStackEl: clone.querySelector('.editor-stack'),
      fileTabsBarEl: newFileTabsBar,
      currentVirtualPath: null, currentFileRawText: null, currentFileName: 'No file open', currentFileHandle: null, openedFiles: [],
    };
    // clear duplicate IDs from the clone (only pane 0 keeps the real IDs) to keep the document valid
    newPane.sourceEl.removeAttribute('id');
    newPane.highlightEl.removeAttribute('id');
    newPane.gutterEl.removeAttribute('id');
    newPane.fileTabsBarEl.removeAttribute('id');
    panes.push(newPane);
    wireEditorPaneEvents(newPane);
    wireTabDropTarget(clone, ()=> newPane);
    closeBtn.addEventListener('click', ()=> closeEditorPane(newPane));
    const previouslyActivePane = panes[activePaneIdx];
    activatePane(newPane);
    showEmptyPaneState();
    // keep the ORIGINAL pane active/focused after the split - silently
    // switching focus to the brand new empty pane meant Assemble/Run/Step
    // would operate on nothing at all unless the user remembered to click
    // back on their actual file first
    activatePane(previouslyActivePane);
    return newPane;
  }
  function closeEditorPane(paneOrIdx){
    if(panes.length <= 1) return; // never close the last pane
    const p = typeof paneOrIdx === 'number' ? panes[paneOrIdx] : paneOrIdx;
    const idx = panes.indexOf(p);
    if(idx === -1) return;
    const wasActive = idx === activePaneIdx;
    // remove one adjacent splitter along with the pane - prefer the one
    // immediately before it (how createEditorPane always inserts them),
    // falling back to the one after it if this was the first pane
    const prevSibling = p.containerEl.previousElementSibling;
    const nextSibling = p.containerEl.nextElementSibling;
    if(prevSibling && prevSibling.classList.contains('editor-pane-splitter')) prevSibling.remove();
    else if(nextSibling && nextSibling.classList.contains('editor-pane-splitter')) nextSibling.remove();
    p.containerEl.remove();
    panes.splice(idx, 1);
    // reset remaining panes to equal-share sizing - any manually-dragged
    // pixel widths no longer make sense with a different pane count
    for(const remaining of panes) remaining.containerEl.style.flex = '';
    if(wasActive){
      activePaneIdx = Math.min(idx, panes.length-1); // force activatePane to actually run even though the "new" index might numerically equal the old activePaneIdx
      const target = panes[Math.max(0, idx-1)];
      activePaneIdx = -1; // sentinel so activatePane's early-return check never skips this
      activatePane(target);
    } else if(activePaneIdx > idx){
      activePaneIdx--;
    }
  }
  function closeAllSplits(){
    while(panes.length > 1) closeEditorPane(panes.length-1);
  }

  /* ---- prevent the same file being open in more than one split: before
     loading, check every pane's open tabs (including the currently
     active one, via the live global state) for this path. If found in a
     DIFFERENT pane, just activate that pane and show its existing tab
     instead of opening a second, disconnected copy. ---- */
  function findPaneWithFile(path){
    for(const p of panes){
      const files = (p === panes[activePaneIdx]) ? openedFiles : p.openedFiles;
      if(files.some(f=>f.path===path)) return p;
    }
    return null;
  }
  function loadVirtualFile(path){
    const existingPane = findPaneWithFile(path);
    if(existingPane && existingPane !== panes[activePaneIdx]){
      activatePane(existingPane);
      if(currentVirtualPath !== path){
        // the pane has this file open as a tab but a different one is currently showing - switch its active tab too
        currentVirtualPath = path;
        let raw;
        try{ raw = readVfsTextFile(machine.asmEngine.FS, path); }
        catch(e){ raw = (path === '/untitled.X68') ? DEFAULT_SOURCE : ''; }
        sourceEl.value = raw;
        currentFileRawText = raw;
        setCurrentFile(path.replace(/^\//,''), null);
        syncEditor();
        renderFileTabsBar();
      }
      return;
    }
    persistCurrentToVFS();
    let text = '';
    try{ text = readVfsTextFile(machine.asmEngine.FS, path); }
    catch(e){
      if(path === '/untitled.X68'){ text = DEFAULT_SOURCE; }
      else { ui.appendLog(`Could not read ${path} from the virtual filesystem.`); return; }
    }
    sourceEl.value = text;
    currentVirtualPath = path;
    currentFileRawText = text;
    lastOpenedMap.set(path, Date.now());
    sourceEl.readOnly = false;
    sourceEl.placeholder = '';
    syncEditor();
    setCurrentFile(path.replace(/^\//,''), null);
    renderFileTable();
    markFileOpened(path);
    ui.appendLog(`Editing ${path} (browser-only copy - edits do not touch your local disk; use Download file to export).`);
  }
  let syncDebounce = null;
  function scheduleAutoSync(){
    if(!currentVirtualPath) return;
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(persistCurrentToVFS, 400);
  }

  // btnUploadFiles/btnUploadFolder/btnNewFile(left-pane)/btnNewFolder(left-pane)/fileInputFolder removed - create/upload now happen via the file tree's right-click context menu
  // btnDownloadAll (left-pane action row) removed - "Export ZIP" now lives in the toolbar above the editor, alongside the other load/save/import/export buttons (#btnExportZipToolbar's listener, below)
  // Clearing must leave NOTHING behind - no auto-recreated /untitled.X68
  // placeholder, ever (an earlier version of this function did recreate
  // one "so the editor isn't left showing an untracked file", but that's
  // exactly the "there is always an untitled.X68" complaint - the user
  // wants a real empty state instead, not a fresh phantom file). If the
  // file the editor currently has open gets wiped, the editor just closes
  // it, showing the genuine "no file open" empty-pane state.
  async function clearAllBrowserOnlyFiles(){
    await idbClear();
    // Every file is browser-only (nothing is ever linked to real disk,
    // in any browser), so this clears everything, no exceptions.
    const removedPaths = uploadedFiles.map(f=>f.path);
    uploadedFiles.length = 0;
    for(const p of removedPaths){
      try{ machine.asmEngine.FS.unlink(p); }catch(e){}
      try{ machine.simEngine.FS.unlink(p); }catch(e){}
    }
    if(removedPaths.includes(currentVirtualPath)){
      // Close the now-deleted file WITHOUT going through
      // showEmptyPaneState()'s normal persistCurrentToVFS() call first -
      // that call is correct when a user voluntarily closes a tab (save
      // what they were looking at), but here the whole point is that this
      // file's content is gone; persisting it would silently re-create
      // exactly the file (and its FS/IndexedDB entries) this function just
      // deleted, undoing the clear for it.
      currentVirtualPath = null;
      currentFileRawText = null;
      currentFileName = 'No file open';
      currentFileHandle = null;
      sourceEl.value = '';
      sourceEl.readOnly = true;
      sourceEl.placeholder = 'No file open in this pane.\nOpen a file from the FILES panel on the left, or create a new one.';
      syncEditor();
      setCurrentFile('No file open', null);
    }
    openedFiles = openedFiles.filter(f => !removedPaths.includes(f.path));
    renderFileTabsBar();
    renderFileTable();
    return removedPaths.length;
  }
  $('#btnClearStorage').addEventListener('click', async ()=>{
    if(!window.confirm('Delete all files auto-saved in this browser and remove them from the file list? This cannot be undone.')) return;
    const removedCount = await clearAllBrowserOnlyFiles();
    ui.appendLog(`Cleared browser storage — removed ${removedCount} file(s) from the list.`);
  });
  /* ---- Upload Folder replacing existing files: confirm first, since this
     is destructive - "Upload and delete" is the default action (matching
     the common case of intentionally opening a whole new project), with
     a "download before deleting" safety net checked by default. ---- */
  const uploadReplaceModalEl = document.getElementById('uploadReplaceModal');
  function confirmUploadReplace(){
    if(!uploadedFiles.length) return Promise.resolve(true); // nothing to replace, nothing to confirm
    document.getElementById('uploadReplaceFileCount').textContent = uploadedFiles.length;
    document.getElementById('uploadReplaceDownloadFirst').checked = true;
    uploadReplaceModalEl.hidden = false;
    return new Promise(resolve=>{
      const confirmBtn = document.getElementById('btnUploadReplaceConfirm');
      const cancelBtn = document.getElementById('btnUploadReplaceCancel');
      const closeBtn = document.getElementById('btnUploadReplaceClose');
      function cleanup(){
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        uploadReplaceModalEl.hidden = true;
      }
      async function onConfirm(){
        const downloadFirst = document.getElementById('uploadReplaceDownloadFirst').checked;
        cleanup();
        if(downloadFirst) await downloadAllFiles();
        await clearAllBrowserOnlyFiles();
        resolve(true);
      }
      function onCancel(){ cleanup(); resolve(false); }
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);
    });
  }
  // btnNewFile/btnNewFolder left-pane buttons removed - the editor toolbar's New File button and the tree's context menu remain
  $('#fileInputMulti').addEventListener('change', e=> handleFileList(e.target.files));
  $('#fileInputFolder').addEventListener('change', async e=>{
    const files = e.target.files;
    if(!(await confirmUploadReplace())){ e.target.value = ''; return; }
    handleFileList(files, undefined, undefined, false);
  });
  // Upload ZIP: same effect as Upload Folder (to_do.md), reusing the exact
  // same confirm-replace + handleFileList() pipeline - readZip() just
  // supplies synthetic File-like objects (with webkitRelativePath set to
  // each entry's internal zip path) instead of a real webkitdirectory
  // FileList, so every path/case/nested-folder rule handleFileList already
  // applies keeps working identically for a zip's contents.
  $('#fileInputZip').addEventListener('change', async e=>{
    const zipFile = e.target.files[0];
    e.target.value = '';
    if(!zipFile) return;
    if(!(await confirmUploadReplace())) return;
    let entries;
    try{
      const bytes = new Uint8Array(await zipFile.arrayBuffer());
      entries = await readZip(bytes);
    }catch(err){
      ui.appendLog(`Could not read "${zipFile.name}" as a ZIP file: ${err.message}`, true);
      return;
    }
    if(!entries.length){ ui.appendLog(`"${zipFile.name}" contains no files.`); return; }
    // A zip built the way GitHub's "Download ZIP" does wraps every entry in
    // one shared top-level folder ("repo-branch/...") - stripping that one
    // segment matches the folder-upload convention (the wrapper name is
    // arbitrary, not real project structure). But a zip with no such single
    // shared wrapper (e.g. multiple top-level folders/files, as produced by
    // zipping a folder's CONTENTS rather than the folder itself) has no
    // "arbitrary picker name" to strip at all - every segment is real
    // project structure. Blindly stripping the first segment of EVERY entry
    // independently (the old behavior) silently discarded a real subfolder
    // for any entry nested one level deep, and could collide two
    // differently-named top folders' same-named files onto the same
    // stripped path, overwriting one - matching the exact "folders aren't
    // imported / not all files arrive" report. Only strip when every single
    // entry is nested under the exact same one top-level segment.
    const topSegments = new Set(entries.map(en => en.path.split('/')[0]));
    const hasCommonRoot = topSegments.size === 1 && entries.every(en => en.path.includes('/'));
    const synthFiles = entries.map(en=>{
      const f = new File([en.data], en.path.split('/').pop());
      Object.defineProperty(f, 'webkitRelativePath', {value: en.path});
      return f;
    });
    await handleFileList(synthFiles, undefined, !hasCommonRoot, false);
  });

  const ui = {
    simHost,
    onEnginesLoaded(){
      engineTag.textContent = 'real WASM engines loaded';
      btnAssemble.disabled = false;
      btnAssemble.title = 'Assemble (build the current file)';
      btnRun.disabled = false;
      btnRun.title = 'Run';
      btnStep.disabled = false;
      btnStep.title = 'Step one instruction (assembles first if editing)';
      btnStepOver.disabled = false;
      btnStepOver.title = 'Step over (assembles first if editing)';
      this.appendLog('Real EASy68K assembler + simulator engines loaded (compiled from the actual Borland C++ source). Click Assemble.');
      simHost.clearBlack(true); // clears both back and visible canvases directly - no repaint() needed here, and calling it would be indistinguishable from a real program calling task 94
      applySimulatorSettings(); // push the persisted initial-interrupt-mask setting before anything gets assembled/reset
      this.renderAll(); // populate D0-D7/A0-A7 with their real default state now, instead of leaving them blank until the first assemble
    },
    appendLog(text, isError, isConsoleLogTask){
      const div = document.createElement('div');
      div.textContent = text;
      if(isError) div.style.color = 'var(--red)';
      else if(isConsoleLogTask) div.className = 'sys-console-log';
      syslogEl.appendChild(div);
      syslogEl.scrollTop = syslogEl.scrollHeight;
      // A program's own CONSOLE_LOG-family TRAP #15 output (tasks 200-220)
      // must actually be seen the moment it's written, the same way a real
      // program's screen/output-window drawing auto-opens that window - the
      // Errors tab is the default active one, so a program logging while the
      // user has it open otherwise wrote into a pane nobody was looking at.
      // Scoped to isConsoleLogTask only - ordinary system messages (engine
      // load, file upload confirmations, etc.) don't hijack the user's
      // current tab choice.
      if(isConsoleLogTask){
        const logTabBtn = document.querySelector('.center-bottom .tab[data-tab="log"]');
        if(logTabBtn && !logTabBtn.classList.contains('active')) logTabBtn.click();
      }
    },
    appendRuntimeError(text){
      // clear the "no errors" placeholder if that's all that's there
      if(messagesEl.querySelector('.empty') || messagesEl.querySelector('.msg-row.ok')) messagesEl.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'msg-row error';
      row.innerHTML = `<span class="ln">RUN</span><span class="txt"></span>`;
      row.querySelector('.txt').textContent = text;
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      // switch the messages pane to the Errors tab and make sure it's actually visible
      const errorsTabBtn = document.querySelector('.center-bottom .tab[data-tab="errors"]');
      if(errorsTabBtn) errorsTabBtn.click();
    },
    clearConsole(){
      syslogEl.innerHTML='';
      simHost.clearBlack(true); // clears both canvases directly - no repaint() needed
    },
    showAssembleErrorModal(errors){
      const listEl = document.getElementById('asmErrorList');
      const hardErrors = errors.filter(e=>!e.isWarning);
      listEl.innerHTML='';
      for(const e of hardErrors){
        const row=document.createElement('div');
        row.className='msg-row error';
        row.innerHTML = `<span class="ln">L${e.line}</span><span class="txt">${escapeHtml(e.message)}</span>`;
        row.addEventListener('click', ()=>{ document.getElementById('asmErrorModal').hidden=true; jumpToLine(e.line); });
        listEl.appendChild(row);
      }
      document.getElementById('asmErrorModal').hidden = false;
    },
    showErrors(errors){
      if(!errors.length){
        messagesEl.innerHTML = `<div class="msg-row ok"><span class="ln"></span><span class="txt">Assembled with no errors.</span></div>`;
        return;
      }
      messagesEl.innerHTML='';
      for(const e of errors){
        const row=document.createElement('div');
        row.className='msg-row '+(e.isWarning?'warning':'error');
        row.innerHTML = `<span class="ln">L${e.line}</span><span class="txt">${escapeHtml(e.message)}</span>`;
        row.addEventListener('click', ()=>jumpToLine(e.line));
        messagesEl.appendChild(row);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },
    showSymbols(symbols){
      if(!symbols.length){
        symTableEl.querySelector('tbody').innerHTML = '<tr><td colspan="2" style="color:var(--text-faint);font-style:italic;">No symbols.</td></tr>';
        return;
      }
      symTableEl.querySelector('tbody').innerHTML = symbols.map(s=>
        `<tr data-symbol="${escapeHtml(s.name)}" title="Click to jump to where ${escapeHtml(s.name)} gets its value"><td class="name">${escapeHtml(s.name)}</td><td class="val">$${hex(s.value,8)}</td></tr>`
      ).join('');
    },
    setEditorLocked(locked){
      sourceEl.readOnly = locked;
      sourceEl.style.cursor = locked ? 'not-allowed' : '';
      editorLockTag.hidden = !locked;
      btnCommentOut.disabled = locked; btnCommentIn.disabled = locked; btnRemoveTrailingSpaces.disabled = locked;
      editorStackEl.classList.toggle('editor-readonly-active', locked && currentVirtualPath!==null);
    },
    setAssembled(ok){
      btnRun.disabled=false; btnReset.disabled=!ok;
      statusText.textContent = ok ? 'assembled — ready' : 'assembly failed';
      statusDot.className = 'dot'+(ok?' on':' halt');
      ui.setEditorLocked(false);
    },
    onRunStart(){
      btnStep.disabled=true; btnStepOver.disabled=true; btnAssemble.disabled=true;
      statusText.textContent='running…'; statusDot.className='dot on';
      ui.setEditorLocked(true);
    },
    onStopped(){
      btnRun.disabled=false; btnStep.disabled=false; btnStepOver.disabled=false; btnAssemble.disabled=false;
      statusText.textContent='stopped'; statusDot.className='dot';
      ui.setEditorLocked(machine.instrCount>0);
    },
    onHalted(){
      btnStep.disabled=true; btnStepOver.disabled=true; btnAssemble.disabled=false;
      statusText.textContent='halted'; statusDot.className='dot halt';
      ui.setEditorLocked(machine.instrCount>0);
    },
    renderAll(){
      if(!machine.simEngine) return;
      let htmlD1='', htmlD2='', htmlA1='', htmlA2='';
      for(let i=0;i<8;i++){
        const v = machine.getD(i);
        const changed = prevRegs.d[i] !== v;
        const cell = `<div class="reg-cell${changed?' changed':''}"><span class="rname">D${i}</span><span class="rval" contenteditable="true" spellcheck="false" data-reg="D${i}">$${hex(v,8)}</span></div>`;
        if(i<4) htmlD1 += cell; else htmlD2 += cell;
        prevRegs.d[i] = v;
      }
      for(let i=0;i<8;i++){
        const v = (i===7) ? machine.getActiveA7() : machine.getA(i);
        const changed = prevRegs.a[i] !== v;
        const regName = `A${i}`;
        const cell = `<div class="reg-cell a-reg${changed?' changed':''}"><span class="rname">${regName}</span><span class="rval" contenteditable="true" spellcheck="false" data-reg="${regName}">$${hex(v,8)}</span></div>`;
        if(i<4) htmlA1 += cell; else htmlA2 += cell;
        prevRegs.a[i] = v;
      }
      const supervisorNow = (machine.getSR() & 0x2000) !== 0;
      const usp = machine.getUSP(), ssp = machine.getSSP();
      const uspChanged = prevRegs.usp !== usp, sspChanged = prevRegs.ssp !== ssp;
      prevRegs.usp = usp; prevRegs.ssp = ssp;
      const uspEl = $('#regUSP'), sspEl = $('#regSSP');
      uspEl.className = 'reg-cell a-reg'+(uspChanged?' changed':'')+(!supervisorNow?' sp-active':'');
      uspEl.querySelector('.rval').textContent = '$'+hex(usp,8);
      sspEl.className = 'reg-cell a-reg'+(sspChanged?' changed':'')+(supervisorNow?' sp-active':'');
      sspEl.querySelector('.rval').textContent = '$'+hex(ssp,8);
      regsGridD1El.innerHTML = htmlD1;
      regsGridD2El.innerHTML = htmlD2;
      regsGridA1El.innerHTML = htmlA1;
      regsGridA2El.innerHTML = htmlA2;
      pcValEl.textContent = '$'+hex(machine.getPC(),8);
      const sr = machine.getSR();
      srValEl.textContent = '$'+hex(sr,4);
      const intMask = (sr>>8)&0x7;
      // All 16 bits are shown as real lamps (lit=1, unlit=0) - even the
      // bits with no defined 68000 meaning still hold whatever value a
      // program (or a manual SR edit) last wrote there, so they're lit
      // from the actual SR value like every other bit, just labeled "-"
      // instead of a flag mnemonic since they don't have one.
      const systemBits=[
        ['T',!!(sr&0x8000)],['-',!!(sr&0x4000)],['S',!!(sr&0x2000)],['-',!!(sr&0x1000)],['-',!!(sr&0x0800)],
        ['I2',!!(sr&0x400)],['I1',!!(sr&0x200)],['I0',!!(sr&0x100)],
      ];
      const userBits=[
        ['-',!!(sr&0x80)],['-',!!(sr&0x40)],['-',!!(sr&0x20)],
        ['X',!!(sr&0x10)],['N',!!(sr&0x08)],['Z',!!(sr&0x04)],['V',!!(sr&0x02)],['C',!!(sr&0x01)],
      ];
      const lampsHtml = bits => bits.map(([name,val])=>
        `<div class="lamp${val?' on':''}"><div class="bulb"></div><span>${name}</span></div>`
      ).join('');
      flagsRowEl.innerHTML =
        `<div class="sr-byte-group">
           <div class="sr-byte-box sr-mode-${supervisorNow?'supervisor':'user'}">${lampsHtml(systemBits)}</div>
           <div class="sr-byte-label">SYSTEM BYTE</div>
         </div>
         <div class="sr-byte-group">
           <div class="sr-byte-box sr-user-byte">${lampsHtml(userBits)}</div>
           <div class="sr-byte-label">USER BYTE</div>
         </div>`;
      intMaskValEl.textContent = intMask;
      runtimeInfoEl.textContent = machine.halted()
        ? `Halted after ${machine.instrCount} instruction${machine.instrCount===1?'':'s'}.`
        : machine.hitBreakpoint
          ? `Stopped at breakpoint — $${hex(machine.getPC(),8)}. ${machine.instrCount} instructions executed.`
          : `${machine.instrCount} instruction${machine.instrCount===1?'':'s'} executed. Next @ $${hex(machine.getPC(),4)}.`;
      updateCurrentLine();
      if(appMode==='simulating' && !document.getElementById('simListingView').hidden) renderSimListing();
      if(!document.getElementById('tab-memtab').hidden) renderHexdump();
      updateHardwareDisplay();
      if(!document.getElementById('tab-stacktab').hidden) renderAllStackDumps();
    },
  };
  const prevRegs = { d: new Array(8).fill(NaN), a: new Array(8).fill(NaN), usp: NaN, ssp: NaN };

  const machine = new Machine(ui);

  /* ---- hardware window: 7-segment display, LEDs, toggle switches, push
     buttons, and manual/auto interrupt triggers - all memory-mapped, same
     as the real Hardware window. Devices are plain memory: the running
     program reads/writes ordinary bytes at the configured addresses: this
     code just (a) polls those bytes once per render to update the visual
     7-seg/LED display, and (b) writes switch/button state into memory the
     moment the user interacts with them, so the next instruction the
     program executes already sees the latest state. No CPU-side special
     casing needed. ---- */
  const SEG_BITS = ['a','b','c','d','e','f','g','dp'];
  function buildSeg7Digit(){
    return SEG_BITS.map(s=>`<div class="seg seg-${s}" data-seg="${s}"></div>`).join('');
  }
  const hwSeg7Row = $('#hwSeg7Row'), hwLedRow = $('#hwLedRow'), hwSwitchRow = $('#hwSwitchRow'), hwPbRow = $('#hwPbRow'), hwIrqList = $('#hwIrqList');
  for(let i=0;i<8;i++){
    const d = document.createElement('div');
    d.className = 'hw-digit'; d.dataset.digit = i;
    d.innerHTML = buildSeg7Digit();
    hwSeg7Row.appendChild(d);
  }
  for(let i=0;i<8;i++){
    const d = document.createElement('div');
    d.className = 'hw-led'; d.dataset.bit = i;
    hwLedRow.appendChild(d);
  }
  const switchState = new Array(8).fill(false); // bit0..bit7, matches memory bit order
  const pbState = new Array(8).fill(false);
  for(let i=0;i<8;i++){
    const col = document.createElement('div'); col.className = 'hw-switch-col';
    col.innerHTML = `<div class="hw-toggle" data-bit="${i}"><div class="knob"></div></div><span class="hw-bitlabel">${i}</span>`;
    hwSwitchRow.appendChild(col);
  }
  for(let i=0;i<8;i++){
    const col = document.createElement('div'); col.className = 'hw-pb-col';
    col.innerHTML = `<div class="hw-pb" data-bit="${i}"></div><span class="hw-bitlabel">${i}</span>`;
    hwPbRow.appendChild(col);
  }
  for(let level=1;level<=7;level++){
    const row = document.createElement('div'); row.className = 'hw-irq-row';
    row.innerHTML = `
      <button class="hw-irq-btn" data-level="${level}" title="Manually trigger interrupt level ${level}">IRQ${level}</button>
      <label><input type="checkbox" class="hw-auto-en" data-level="${level}"> Auto every</label>
      <input type="number" class="hw-auto-ms" data-level="${level}" min="1" step="1" value="20"> ms`;
    hwIrqList.appendChild(row);
  }
  // Switch/button state must be reflected into memory/stack views the
  // instant it changes - always, in editing or simulation mode, running
  // or paused (the hardware window itself isn't gated by appMode, so
  // neither is this). renderHexdump/renderAllStackDumps are defined
  // further below in this same closure (plain function declarations,
  // hoisted - safe to call here since these only ever run later, at
  // click time, not during initial setup).
  function writeSwitchByte(){
    let b = 0;
    for(let i=0;i<8;i++) if(switchState[i]) b |= (1<<i);
    if(machine.simEngine) machine.simEngine.ccall('wasm_write_byte', null, ['number','number'], [hwAddrs.sw, b]);
    renderHexdump(); renderAllStackDumps();
  }
  function writePbByte(){
    let b = 0xFF; // active-low: released=1, pressed clears the bit
    for(let i=0;i<8;i++) if(pbState[i]) b &= ~(1<<i);
    if(machine.simEngine) machine.simEngine.ccall('wasm_write_byte', null, ['number','number'], [hwAddrs.pb, b & 0xFF]);
    renderHexdump(); renderAllStackDumps();
  }
  // Switches/buttons are INPUT devices - the physical switch position
  // always wins. If a memory/stack edit lands on the switch or button
  // byte, immediately overwrite it back with the actual switch/button
  // state, rather than letting the edited value stick. Called from
  // commitHexKeystroke/commitAsciiKeystroke/commitStackCellEdit after they
  // write the user's edit, so this always runs last.
  function reassertHwInputAddr(addr){
    if(addr === hwAddrs.sw) writeSwitchByte();
    else if(addr === hwAddrs.pb) writePbByte();
  }
  hwSwitchRow.querySelectorAll('.hw-toggle').forEach(el=>{
    el.addEventListener('click', ()=>{
      const bit = +el.dataset.bit;
      switchState[bit] = !switchState[bit];
      el.classList.toggle('on', switchState[bit]);
      writeSwitchByte();
    });
  });
  hwPbRow.querySelectorAll('.hw-pb').forEach(el=>{
    const bit = +el.dataset.bit;
    const press = ()=>{ pbState[bit]=true; el.classList.add('pressed'); writePbByte(); };
    const release = ()=>{ pbState[bit]=false; el.classList.remove('pressed'); writePbByte(); };
    el.addEventListener('mousedown', press);
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', ()=>{ if(pbState[bit]) release(); });
  });
  hwIrqList.querySelectorAll('.hw-irq-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(!machine.simEngine) return;
      const level = +btn.dataset.level;
      machine.simEngine.ccall('wasm_hw_manual_irq', null, ['number'], [level]);
      // Real 68000 interrupt masking (RUN.CPP's irqHandler()/exec loop,
      // unmodified original engine code): a request at level 1-6 is only
      // actually dispatched if it exceeds the CPU's current SR
      // interrupt-priority mask (SR bits 8-10) - level 7 (NMI) always
      // fires regardless. A masked request is correctly registered as
      // PENDING (it'll fire the instant the program lowers the mask
      // enough to admit it) but produces no immediate, visible effect at
      // all on its own - which reads as "the button does nothing" to
      // anyone not already thinking in terms of interrupt priority
      // levels. Log it explicitly so a masked press is never silent.
      const maskLevel = (machine.getSR()>>8) & 7;
      if(level!==7 && level<=maskLevel){
        ui.appendLog(`IRQ${level} requested, but it's currently masked by the CPU's interrupt-priority level (SR bits 8-10 = ${maskLevel}) - real 68000 behavior, matching real hardware. It stays pending and fires as soon as the program lowers its mask below ${level} (e.g. "MOVE.W #$2000,SR" sets it to 0, admitting every level). IRQ7 is non-maskable and always fires immediately, unlike IRQ1-6.`);
      }
    });
  });
  function applyAutoIrq(level){
    const row = hwIrqList.querySelector(`.hw-auto-en[data-level="${level}"]`).closest('.hw-irq-row');
    const enabled = row.querySelector('.hw-auto-en').checked;
    const ms = +row.querySelector('.hw-auto-ms').value;
    if(machine.simEngine) machine.simEngine.ccall('wasm_hw_set_auto', null, ['number','number','number'], [level, enabled?1:0, ms]);
  }
  hwIrqList.querySelectorAll('.hw-auto-en, .hw-auto-ms').forEach(el=>{
    el.addEventListener('change', ()=> applyAutoIrq(+el.dataset.level));
  });
  const tabIrqEl = $('#tab-irq');
  // The UI's "Auto every" checkbox/interval and a running program's own
  // TRAP #15 task 32.6 (auto screen-refresh timer, etc.) both write into
  // the SAME engine-side autoIrq[level] state (see wasm_hw_set_auto in
  // wasm_api.cpp) - so a program enabling e.g. a 40ms IRQ1 timer must show
  // up here too, not just the other direction (UI -> program). Skipped
  // while the user has a field focused, so this doesn't fight an in-
  // progress edit; skipped while the Interrupt sub-tab isn't visible,
  // matching updateHardwareDisplay's same tab-visibility guard below.
  function syncAutoIrqUIFromEngine(){
    if(!machine.simEngine) return;
    if(tabIrqEl.hidden) return;
    const focused = document.activeElement;
    for(let level=1; level<=7; level++){
      const row = hwIrqList.children[level-1];
      if(!row) continue;
      const enEl = row.querySelector('.hw-auto-en'), msEl = row.querySelector('.hw-auto-ms');
      if(enEl===focused || msEl===focused) continue;
      const enabled = !!machine.simEngine.ccall('wasm_hw_get_auto_enabled','number',['number'],[level]);
      const period = machine.simEngine.ccall('wasm_hw_get_auto_period','number',['number'],[level]);
      if(enEl.checked !== enabled) enEl.checked = enabled;
      if(period>0 && +msEl.value !== period) msEl.value = period;
    }
  }

  const hwAddrs = { seg7:0xE00000, led:0xE00010, sw:0xE00012, pb:0xE00014 };
  const HW_SPAN = { seg7:16, led:1, sw:1, pb:1 }; // 7-seg spans 8 digits x 2 bytes each
  function pushHwStateToSim(){
    if(!machine.simEngine) return;
    machine.simEngine.ccall('wasm_hw_set_addrs', null, ['number','number','number','number'], [hwAddrs.seg7, hwAddrs.led, hwAddrs.sw, hwAddrs.pb]);
    writeSwitchByte(); writePbByte();
  }
  function rangesOverlap(a1,len1,a2,len2){ return a1 < a2+len2 && a2 < a1+len1; }
  function validateAndApplyHwAddrs(){
    const fields = [['seg7','#hwAddrSeg7'],['led','#hwAddrLed'],['sw','#hwAddrSwitch'],['pb','#hwAddrPb']];
    const parsed = {};
    for(const [key, sel] of fields){
      const raw = $(sel).value.replace(/^\$/,'').trim();
      const n = parseInt(raw, 16);
      const wellFormed = !isNaN(n) && n>=0 && n<=0xFFFFFF && (n%2===0);
      parsed[key] = { value: n, wellFormed, valid: wellFormed };
    }
    // Overlap check runs against every OTHER well-formed address, regardless
    // of whether that other one has itself already been flagged invalid by
    // a different pairing - both sides of an overlapping pair must be
    // marked, not just whichever was checked first.
    for(const [keyA] of fields){
      if(!parsed[keyA].wellFormed) continue;
      for(const [keyB] of fields){
        if(keyA===keyB || !parsed[keyB].wellFormed) continue;
        if(rangesOverlap(parsed[keyA].value, HW_SPAN[keyA], parsed[keyB].value, HW_SPAN[keyB])){
          parsed[keyA].valid = false;
        }
      }
    }
    let anyChanged = false;
    for(const [key, sel] of fields){
      const el = $(sel);
      el.classList.toggle('hw-addr-invalid', !parsed[key].valid);
      if(parsed[key].valid && hwAddrs[key] !== parsed[key].value){
        hwAddrs[key] = parsed[key].value;
        anyChanged = true;
      }
    }
    if(anyChanged){
      pushHwStateToSim();
      // Output devices (7-seg/LED) read straight from memory at hwAddrs on
      // every repaint, but that repaint is normally only driven by the
      // step/run register-update callback or a hardware-window memory edit
      // (reassertHwInputAddr's caller) - moving the mapping itself to an
      // address that already holds different bytes needs its own explicit
      // repaint here, or the display keeps showing the OLD address's
      // pattern until some unrelated later event happens to refresh it.
      updateHardwareDisplay();
      ui.appendLog(`Hardware addresses set — 7-seg $${hex(hwAddrs.seg7,6)}, LED $${hex(hwAddrs.led,6)}, switches $${hex(hwAddrs.sw,6)}, buttons $${hex(hwAddrs.pb,6)}.`);
    }
  }
  ['#hwAddrSeg7','#hwAddrLed','#hwAddrSwitch','#hwAddrPb'].forEach(sel=>{
    $(sel).addEventListener('input', validateAndApplyHwAddrs);
  });
  document.querySelectorAll('.hw-addr-default').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const target = document.getElementById(btn.dataset.target);
      target.value = btn.dataset.default;
      validateAndApplyHwAddrs();
    });
  });

  const SEG7_BITMASK = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80]; // a,b,c,d,e,f,g,dp
  const tabHwEl = $('#tab-hw');
  function updateHardwareDisplay(){
    if(!machine.simEngine) return;
    syncAutoIrqUIFromEngine(); // own tab-visibility guard (Interrupt sub-tab, not Hardware) - independent of the seg7/LED update below
    if(tabHwEl.hidden) return; // hardware panel is behind the Hardware sub-tab (vs Interrupt) - skip the DOM work when it's not the active sub-tab
    for(let digit=0; digit<8; digit++){
      const b = machine.readByte(hwAddrs.seg7 + digit*2) & 0xFF;
      const el = hwSeg7Row.children[digit];
      SEG_BITS.forEach((seg,i)=> el.children[i].classList.toggle('on', !!(b & SEG7_BITMASK[i])));
    }
    const ledByte = machine.readByte(hwAddrs.led) & 0xFF;
    for(let i=0;i<8;i++) hwLedRow.children[i].classList.toggle('on', !!(ledByte & (1<<i)));
  }

  /* ---- editor ----
     Single scroll authority: .editor-stack. The textarea auto-grows to fit
     its full content (overflow:hidden, no internal scroll of its own) so it
     never desyncs from the highlight <pre> underneath it - previously both
     could scroll independently (the textarea has native internal scrolling
     by default), which is what caused the selection/text desync. */
  // editorStackEl declared at top of file alongside sourceEl/gutterEl/highlightEl
  let LINE_HEIGHT = 20; // px, matches the CSS line-height for #source/#highlightLayer - updated when font size settings change

  function resizeSourceHeight(){
    // Deterministic height, matching the gutter's own natural sizing
    // exactly: N lines at the shared LINE_HEIGHT row height (updated
    // whenever the font/size setting changes - see applyEditorSettings()),
    // plus the shared 24px vertical padding (12px top + 12px bottom on
    // both elements). Relying on the textarea's native scrollHeight
    // instead risked a few pixels of browser-internal rendering
    // discrepancy against the gutter's own div-based row sizing -
    // invisible most of the file, but surfacing as a scroll desync right
    // at the bottom. A hardcoded "20" here (the default row height at the
    // default 13px font size) instead of the live LINE_HEIGHT was a real
    // bug: changing the font/size setting away from the default made
    // every subsequent row-height calculation wrong, growing more visibly
    // wrong line by line down the file - exactly "code and line numbers
    // lose consistency... at the end of the file code or lines stop
    // scrolling while the other still scrolls" (to_do.md).
    const numLines = sourceEl.value.split('\n').length;
    sourceEl.style.height = (numLines*LINE_HEIGHT + 24) + 'px';
  }
  function syncEditor(){
    const lines = sourceEl.value.split('\n');
    gutterEl.innerHTML = lines.map((_,i)=>{
      const ln = i+1;
      return `<span class="gutter-line" data-line="${ln}"><span class="gl-num">${ln}</span></span>`;
    }).join('');
    highlightEl.innerHTML = lines.map((l,i)=>{
      const ln = i+1;
      const cls = (ln===currentExecLine && currentExecFile===currentVirtualPath) ? 'tok-current-line' : '';
      return `<span class="${cls}">${highlightLine(l)}</span>`;
    }).join('');
    resizeSourceHeight();
    // clear, distinct visual states: no file open in this pane at all
    // (gray, matches the placeholder text), vs a real file that's just
    // temporarily read-only while simulating (a different, lighter tint,
    // since there IS content here, just not editable right now)
    editorStackEl.classList.toggle('editor-no-file', currentVirtualPath===null);
    editorStackEl.classList.toggle('editor-readonly-active', currentVirtualPath!==null && !!sourceEl.readOnly);
    updateCursorPosInfo();
  }
  // to_do.md: "at the bottom of the editor, add an information bar with...
  // the position of the cursor (row and column)". Called from syncEditor()
  // (covers file load/switch, typing, and pane-switch via activatePane's
  // own syncEditor() call) plus dedicated click/keyup listeners below for
  // pure caret moves (click-to-position, arrow keys) that don't change
  // sourceEl.value and so never trigger an 'input' event/syncEditor() on
  // their own. 1-based row/col, matching every other line-number display
  // in this app (breakpoints, listing view, etc).
  function updateCursorPosInfo(){
    if(!cursorPosInfoEl) return;
    if(currentVirtualPath === null){ cursorPosInfoEl.textContent = 'Ln -, Col -'; return; }
    const pos = sourceEl.selectionStart;
    const val = sourceEl.value;
    const row = (val.slice(0, pos).match(/\n/g) || []).length + 1;
    const col = currentColumnOf(val, pos) + 1;
    cursorPosInfoEl.textContent = `Ln ${row}, Col ${col}`;
  }
  let currentExecLine = null, currentExecFile = null;
  // Passive: updates which line is highlighted as "current PC" if that
  // line happens to be in the file currently shown. Never switches files -
  // called from every renderAll(), including after Assemble/Run/Stop,
  // where jumping the editor around would be surprising and unwanted.
  function updateCurrentLine(){
    if(!machine.simEngine || !machine.addrToLoc) return;
    const pc = machine.getPC()>>>0;
    const loc = machine.addrToLoc.get(pc);
    const newFile = loc ? loc.file : null;
    const newLine = loc ? loc.line : null;
    if(newFile !== currentExecFile || newLine !== currentExecLine){
      currentExecFile = newFile; currentExecLine = newLine;
      // The normal per-file editor is completely hidden during
      // simulation (the unified listing view replaces it) - rebuilding
      // its gutter/highlight layer on every single instruction tick would
      // be pure wasted CPU for a view nobody can see.
      if(appMode !== 'simulating') syncEditor();
    }
  }
  // Active: called only right after Step / Step Over / hitting a
  // breakpoint - the moments a real debugger actually moves your view.
  // Switches to PC's file if it's not already shown, and scrolls so the
  // current line is visible.
  function followExecution(){
    if(!machine.simEngine || !machine.addrToLoc) return;
    const pc = machine.getPC()>>>0;
    const loc = machine.addrToLoc.get(pc);
    if(!loc) return;
    currentExecFile = loc.file; currentExecLine = loc.line;
    if(loc.file !== currentVirtualPath){
      loadVirtualFile(loc.file);
    } else if(appMode !== 'simulating'){
      syncEditor();
    }
    if(appMode === 'simulating') return; // the normal editor isn't visible - nothing left to sync/scroll
    const targetTop = (loc.line-1) * LINE_HEIGHT;
    if(targetTop < editorStackEl.scrollTop || targetTop > editorStackEl.scrollTop + editorStackEl.clientHeight - LINE_HEIGHT){
      editorStackEl.scrollTop = Math.max(0, targetTop - editorStackEl.clientHeight/2);
    }
  }
  gutterEl.addEventListener('mousedown', ()=> activatePane(0));
  function renderBreakpointList(){
    const el = document.getElementById('bpList');
    if(!el) return;
    const all = [];
    for(const [path, lines] of machine.breakpointsByFile){
      for(const ln of lines) all.push({path, ln});
    }
    if(all.length===0){ el.innerHTML = '<div class="empty-sm">No breakpoints set.</div>'; return; }
    all.sort((a,b)=> a.path===b.path ? a.ln-b.ln : a.path.localeCompare(b.path));
    el.innerHTML = all.map(({path,ln})=>{
      const addr = machine.locToAddr.get(path+'\x00'+ln);
      return `<div class="bp-row" data-path="${escapeHtml(path)}" data-line="${ln}"><span>${escapeHtml(path)}:${ln}${addr!==undefined?' — $'+hex(addr,8):' (no code here)'}</span><button data-path="${escapeHtml(path)}" data-line="${ln}">✕</button></div>`;
    }).join('');
    el.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        toggleBreakpoint(btn.dataset.path, parseInt(btn.dataset.line,10));
      });
    });
    el.querySelectorAll('.bp-row').forEach(row=>{
      row.addEventListener('click', ()=>{
        const path = row.dataset.path, line = parseInt(row.dataset.line, 10);
        navigateToBreakpoint(path, line);
      });
    });
  }
  // Jump to a breakpoint's location - opens/switches to the file and
  // centers the line in the editor while editing, or scrolls the unified
  // listing view to the matching row while simulating (there's no
  // per-file editor to switch to in that mode - the listing IS the view).
  function navigateToBreakpoint(path, line){
    if(appMode === 'simulating'){
      const idx = machine.listingDisplayLines.findIndex(e => e.file===path && e.line===line);
      if(idx === -1) return;
      const el = document.getElementById('simListingView');
      const rowEl = el.children[idx];
      if(rowEl){
        if(rowEl.scrollIntoView) rowEl.scrollIntoView({block:'center'});
        rowEl.classList.add('sl-jump-flash');
        setTimeout(()=> rowEl.classList.remove('sl-jump-flash'), 900);
      }
      return;
    }
    if(currentVirtualPath !== path) loadVirtualFile(path);
    const lines = sourceEl.value.split('\n');
    const charOffset = lines.slice(0, line-1).join('\n').length + (line>1 ? 1 : 0);
    sourceEl.focus();
    sourceEl.setSelectionRange(charOffset, charOffset + (lines[line-1]||'').length);
    const targetScroll = (line-1)*20 - editorStackEl.clientHeight/2;
    editorStackEl.scrollTop = Math.max(0, targetScroll);
  }
  sourceEl.addEventListener('focus', ()=> activatePane(0));
  sourceEl.addEventListener('input', ()=>{ activatePane(0); syncEditor(); scheduleAutoSync(); });
  sourceEl.addEventListener('click', ()=>{ activatePane(0); updateCursorPosInfo(); });
  sourceEl.addEventListener('keyup', ()=> updateCursorPosInfo());
  /* ---- comment out / in: 68k assembly convention is a leading "*" for a
     full-line comment. Operates on every selected line, or just the
     current line if nothing is selected, following the same
     line-boundary-finding pattern as the Tab indent handler above. ---- */
  function toggleComment(commentOut){
    if(sourceEl.readOnly) return;
    const val = sourceEl.value;
    const start = sourceEl.selectionStart, end = sourceEl.selectionEnd;
    const firstLineStart = val.lastIndexOf('\n', start-1) + 1;
    let lastLineEnd = val.indexOf('\n', Math.max(end-1,firstLineStart));
    if(lastLineEnd === -1) lastLineEnd = val.length;
    const block = val.slice(firstLineStart, lastLineEnd);
    const lines = block.split('\n');
    let firstLineDelta = 0;
    const newLines = lines.map((line,i)=>{
      if(commentOut){
        if(line.startsWith('*')) return line; // already commented
        if(i===0) firstLineDelta = 1;
        return '*'+line;
      } else {
        if(line.startsWith('*')){ if(i===0) firstLineDelta=-1; return line.slice(1); }
        return line;
      }
    });
    const newBlock = newLines.join('\n');
    sourceEl.value = val.slice(0,firstLineStart) + newBlock + val.slice(lastLineEnd);
    sourceEl.selectionStart = Math.max(firstLineStart, start+firstLineDelta);
    sourceEl.selectionEnd = firstLineStart + newBlock.length;
    sourceEl.focus();
    syncEditor(); scheduleAutoSync();
  }
  btnCommentOut.addEventListener('click', ()=> toggleComment(true));
  btnCommentIn.addEventListener('click', ()=> toggleComment(false));
  // to_do.md: "Remove trailing spaces" button - operates on the WHOLE file
  // (not just the selection, unlike Comment Out/In), matching the common
  // "trim trailing whitespace" convention in real editors. Preserves the
  // caret's row and (clamped) column across the edit, the same care
  // toggleComment() already takes for its own selection - a bulk rewrite
  // of sourceEl.value that just left the caret wherever a naive Math.min
  // landed would feel broken the moment any EARLIER line's own trailing
  // spaces shifted every following line's absolute character offset.
  function removeTrailingSpaces(){
    if(sourceEl.readOnly) return;
    const val = sourceEl.value;
    const pos = sourceEl.selectionStart;
    const lines = val.split('\n');
    let row = lines.length-1, col = lines[lines.length-1].length, count = 0;
    for(let i=0;i<lines.length;i++){
      if(count + lines[i].length >= pos){ row = i; col = pos - count; break; }
      count += lines[i].length + 1; // +1 for the newline
    }
    const cleanedLines = lines.map(l => l.replace(/[ \t]+$/, ''));
    const cleaned = cleanedLines.join('\n');
    if(cleaned === val) return; // nothing to do
    sourceEl.value = cleaned;
    const newCol = Math.min(col, cleanedLines[row].length);
    let newPos = newCol;
    for(let i=0;i<row;i++) newPos += cleanedLines[i].length + 1;
    sourceEl.selectionStart = sourceEl.selectionEnd = newPos;
    sourceEl.focus();
    syncEditor(); scheduleAutoSync();
  }
  btnRemoveTrailingSpaces.addEventListener('click', removeTrailingSpaces);

  /* ---- help overlay ---- */
  $('#btnSplitEditor').addEventListener('click', ()=> createEditorPane());
  $('#btnCloseAllSplits').addEventListener('click', ()=> closeAllSplits());
  $('#btnCloseCurrentTab').addEventListener('click', ()=> closeCurrentTab());
  $('#btnCloseOtherTabs').addEventListener('click', ()=> closeOtherTabs());
  $('#btnCloseAllTabs').addEventListener('click', ()=> closeAllTabsInPane());
  // A real, non-modal "normal" window like Output/Hardware (to_do.md: "allow
  // the help window to be opened while editing (and executing), exactly
  // like the output window and the hardware window") - toggles visibility
  // and brings it to front, rather than the old full-screen dimmed modal
  // that blocked everything else while open.
  btnHelp.addEventListener('click', ()=>{
    helpFloatWindow.hidden = !helpFloatWindow.hidden;
    if(!helpFloatWindow.hidden) bringFloatWindowToFront(helpFloatWindow);
  });
  /* ---- Search: an always-visible inline input (no popup) - typing does
     nothing by itself; pressing Enter or clicking the magnifying-glass
     icon runs the search. Repeating the trigger with the same query
     advances to the next match (cycling); a changed query re-searches
     from the start. Editing mode focuses the textarea and selects the
     match (native browser selection highlight, same as selecting with
     the mouse); simulation mode highlights matches directly in the
     read-only listing view. ---- */
  const searchInputEl = document.getElementById('searchInput');
  const searchMatchCountEl = document.getElementById('searchMatchCount');
  let searchMatches = []; // editing: [{start,end}]; simulating: [{rowIdx}]
  let searchCurrentIdx = -1;
  let lastSearchedQuery = null;
  let lastSearchedMode = null;
  function clearSearchHighlights(){
    document.querySelectorAll('.sl-search-match, .sl-search-current').forEach(el=>{
      el.classList.remove('sl-search-match','sl-search-current');
    });
  }
  function runSearch(){
    const q = searchInputEl.value;
    if(!q){ searchMatches = []; searchCurrentIdx = -1; updateSearchMatchCount(); clearSearchHighlights(); return; }
    const sameSearch = q === lastSearchedQuery && appMode === lastSearchedMode && searchMatches.length;
    if(sameSearch){
      goToSearchMatch(searchCurrentIdx+1);
      return;
    }
    lastSearchedQuery = q; lastSearchedMode = appMode;
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIdx = -1;
    const qLower = q.toLowerCase();
    if(appMode === 'simulating'){
      const rows = [...document.getElementById('simListingView').querySelectorAll('.sl-line')];
      rows.forEach((row, idx)=>{
        const text = row.querySelector('.sl-text').textContent;
        if(text.toLowerCase().includes(qLower)){
          searchMatches.push({rowIdx: idx});
          row.classList.add('sl-search-match');
        }
      });
    } else {
      const text = sourceEl.value;
      const textLower = text.toLowerCase();
      let pos = 0;
      while(true){
        const found = textLower.indexOf(qLower, pos);
        if(found === -1) break;
        searchMatches.push({start: found, end: found+q.length});
        pos = found + Math.max(1,q.length);
      }
    }
    updateSearchMatchCount();
    if(searchMatches.length) goToSearchMatch(0);
  }
  function updateSearchMatchCount(){
    if(!searchInputEl.value){ searchMatchCountEl.textContent = ''; searchMatchCountEl.classList.remove('no-matches'); return; }
    if(searchMatches.length === 0){ searchMatchCountEl.textContent = 'No results'; searchMatchCountEl.classList.add('no-matches'); return; }
    searchMatchCountEl.classList.remove('no-matches');
    searchMatchCountEl.textContent = `${searchCurrentIdx+1} of ${searchMatches.length}`;
  }
  function goToSearchMatch(idx){
    if(!searchMatches.length) return;
    idx = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    searchCurrentIdx = idx;
    updateSearchMatchCount();
    if(appMode === 'simulating'){
      const rows = [...document.getElementById('simListingView').querySelectorAll('.sl-line')];
      rows.forEach(r=>r.classList.remove('sl-search-current'));
      const row = rows[searchMatches[idx].rowIdx];
      if(row){
        row.classList.add('sl-search-current');
        if(row.scrollIntoView) row.scrollIntoView({block:'center'});
      }
    } else {
      const m = searchMatches[idx];
      // Only reached via an explicit trigger (Enter/button click), never
      // per-keystroke, so focusing here is safe and gives the visible,
      // native "selected with the mouse" highlight the user expects -
      // unlike a per-keystroke focus, which would steal focus away while
      // still typing the query.
      sourceEl.focus();
      sourceEl.setSelectionRange(m.start, m.end);
      const line = sourceEl.value.slice(0,m.start).split('\n').length;
      const targetScroll = (line-1)*20 - editorStackEl.clientHeight/2;
      editorStackEl.scrollTop = Math.max(0, targetScroll);
    }
  }
  document.getElementById('btnSearch').addEventListener('click', runSearch);
  searchInputEl.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); runSearch(); }
  });
  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='f'){ e.preventDefault(); searchInputEl.focus(); searchInputEl.select(); }
  });
  btnHelpClose.addEventListener('click', ()=>{ helpFloatWindow.hidden = true; });
  const asmErrorModal = $('#asmErrorModal');
  $('#btnAsmErrorClose').addEventListener('click', ()=>{ asmErrorModal.hidden = true; });
  $('#btnAsmErrorOk').addEventListener('click', ()=>{ asmErrorModal.hidden = true; });
  asmErrorModal.addEventListener('click', (e)=>{ if(e.target===asmErrorModal) asmErrorModal.hidden = true; });

  /* ---- editor settings: font family/size (monospace only) and tab mode
     (fixed N spaces, or real MC68000 assembly column stops - label at 0,
     opcode at 12, operand at 20, comment at 44, matching how real 68k
     source is traditionally hand-aligned). Persisted so preferences
     survive a reload. ---- */
  const ASM_TAB_STOPS = [12, 20, 44];
  let editorSettings = { font: "'JetBrains Mono',monospace", size: 13, tabMode: 'assembly', fixedTabSize: 4, columnMark: 80 };
  try{
    const saved = JSON.parse(localStorage.getItem('easy68k-editor-settings')||'null');
    if(saved) editorSettings = Object.assign(editorSettings, saved);
  }catch(e){}
  // to_do.md: "a thin vertical line at the editor at the X columns mark" -
  // implemented as a background-image on #highlightLayer, not a separate
  // absolutely-positioned div (see the CSS comment above `.col-mark-on` in
  // gui_shell.html for why: that element's height is content-driven/auto,
  // so the line always spans the FULL document, not just the current
  // viewport). Position is a `ch`-unit calc(), so it tracks font/size for
  // free without measuring pixel widths - every font this app offers is
  // monospace, where `ch` (the width of "0") equals every character's width.
  function applyColumnMark(){
    const col = Math.max(1, parseInt(editorSettings.columnMark, 10) || 80);
    highlightEl.classList.add('col-mark-on');
    highlightEl.style.backgroundPosition = `calc(14px + ${col}ch) 0`;
  }
  function applyEditorSettings(){
    const lineHeight = editorSettings.size + 7;
    LINE_HEIGHT = lineHeight;
    for(const el of [sourceEl, highlightEl, gutterEl]){
      el.style.fontFamily = editorSettings.font;
      el.style.fontSize = editorSettings.size+'px';
      el.style.lineHeight = lineHeight+'px';
    }
    applyColumnMark();
    // The textarea's own scrollable height is a manually-computed,
    // deterministic value (resizeSourceHeight(), keyed off LINE_HEIGHT
    // above) rather than the browser's native auto-sizing - so it has to
    // be explicitly recomputed here whenever LINE_HEIGHT itself just
    // changed, or it silently keeps using whatever row height was in
    // effect the last time text was edited/loaded (typically the default,
    // right after page load) instead of the new one - the exact cause of
    // to_do.md's "font or font size is changed... code and line numbers
    // lose consistency".
    resizeSourceHeight();
    try{ localStorage.setItem('easy68k-editor-settings', JSON.stringify(editorSettings)); }catch(e){}
  }
  function computeTabInsertion(currentCol){
    if(editorSettings.tabMode === 'fixed') return ' '.repeat(editorSettings.fixedTabSize);
    const nextStop = ASM_TAB_STOPS.find(s => s > currentCol);
    return ' '.repeat((nextStop!==undefined ? nextStop : currentCol+4) - currentCol);
  }
  function currentColumnOf(val, pos){
    const lineStart = val.lastIndexOf('\n', pos-1) + 1;
    return pos - lineStart;
  }

  /* ---- Settings modal (Editor tab + Simulator tab) ---- */
  const settingsModal = $('#settingsModal');
  const settingFontEl = $('#settingFont'), settingFontSizeEl = $('#settingFontSize'), settingFontSizeLabelEl = $('#settingFontSizeLabel');
  const settingFixedTabSizeEl = $('#settingFixedTabSize');
  const settingColumnMarkEl = $('#settingColumnMark');
  function syncSettingsUI(){
    settingFontEl.value = editorSettings.font;
    settingFontSizeEl.value = editorSettings.size;
    settingFontSizeLabelEl.textContent = editorSettings.size+'px';
    settingFixedTabSizeEl.value = editorSettings.fixedTabSize;
    $('#tabModeFixed').checked = editorSettings.tabMode==='fixed';
    $('#tabModeAssembly').checked = editorSettings.tabMode==='assembly';
    settingColumnMarkEl.value = editorSettings.columnMark;
    $('#settingInitialMaskZero').checked = simulatorSettings.initialMaskZero;
  }
  $('#btnEditorSettings').addEventListener('click', ()=>{ syncSettingsUI(); settingsModal.hidden = false; });
  $('#btnSettingsClose').addEventListener('click', ()=>{ settingsModal.hidden = true; });
  settingsModal.addEventListener('click', (e)=>{ if(e.target===settingsModal) settingsModal.hidden = true; });
  settingFontEl.addEventListener('change', ()=>{ editorSettings.font = settingFontEl.value; applyEditorSettings(); });
  settingFontSizeEl.addEventListener('input', ()=>{
    editorSettings.size = parseInt(settingFontSizeEl.value,10);
    settingFontSizeLabelEl.textContent = editorSettings.size+'px';
    applyEditorSettings();
  });
  settingFixedTabSizeEl.addEventListener('change', ()=>{ editorSettings.fixedTabSize = parseInt(settingFixedTabSizeEl.value,10); applyEditorSettings(); });
  settingColumnMarkEl.addEventListener('change', ()=>{
    editorSettings.columnMark = Math.max(1, parseInt(settingColumnMarkEl.value,10) || 80);
    settingColumnMarkEl.value = editorSettings.columnMark;
    applyEditorSettings();
  });
  document.querySelectorAll('input[name="tabMode"]').forEach(r=>{
    r.addEventListener('change', ()=>{ if(r.checked){ editorSettings.tabMode = r.value; applyEditorSettings(); } });
  });
  applyEditorSettings(); // apply any restored (or default) settings on load

  // Simulator settings: currently just "EASy68K initial interrupt mask"
  // (SR's interrupt-priority mask on reset: 000 vs the real-hardware
  // default of 111). Persisted the same way editorSettings is; pushed
  // into the engine both on change and once engines finish loading
  // (see ui.onEnginesLoaded), since it has to reach wasm_reset() before
  // the very first Assemble, not just after the checkbox is touched.
  let simulatorSettings = { initialMaskZero: true }; // default: EASy68K's own initial interrupt mask (000), matching the real original tool's out-of-box behavior
  try{
    const savedSim = JSON.parse(localStorage.getItem('easy68k-simulator-settings')||'null');
    if(savedSim) simulatorSettings = Object.assign(simulatorSettings, savedSim);
  }catch(e){}
  function applySimulatorSettings(){
    if(machine.simEngine) machine.setInitialMaskZero(simulatorSettings.initialMaskZero);
    try{ localStorage.setItem('easy68k-simulator-settings', JSON.stringify(simulatorSettings)); }catch(e){}
  }
  $('#settingInitialMaskZero').addEventListener('change', (e)=>{
    simulatorSettings.initialMaskZero = e.target.checked;
    applySimulatorSettings();
  });

  document.addEventListener('keydown', e=>{
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){
      e.preventDefault();
      btnExport.click();
    }
  });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && !helpFloatWindow.hidden) helpFloatWindow.hidden = true; });

  function handleEditorTabKey(e){
    if(e.key !== 'Tab') return;
    e.preventDefault();
    const val = sourceEl.value;
    const start = sourceEl.selectionStart, end = sourceEl.selectionEnd;
    const selectsMultipleLines = val.slice(start, end).includes('\n');
    if(!selectsMultipleLines){
      if(!e.shiftKey){
        // plain Tab: insert spaces at the cursor to reach the next tab
        // stop (fixed-width or real MC68000 assembly column, per the
        // editor settings), replacing any single-line selection
        const insertion = computeTabInsertion(currentColumnOf(val, start));
        sourceEl.value = val.slice(0,start) + insertion + val.slice(end);
        sourceEl.selectionStart = sourceEl.selectionEnd = start+insertion.length;
      } else {
        // Shift+Tab with no multi-line selection: remove one leading
        // indent character from the current line if present
        const lineStart = val.lastIndexOf('\n', start-1) + 1;
        if(val[lineStart]==='\t'){
          sourceEl.value = val.slice(0,lineStart) + val.slice(lineStart+1);
          const shift = start>lineStart ? 1 : 0;
          sourceEl.selectionStart = sourceEl.selectionEnd = start-shift;
        } else if(val.slice(lineStart,lineStart+4)==='    '){
          sourceEl.value = val.slice(0,lineStart) + val.slice(lineStart+4);
          const shift = Math.min(4, start-lineStart);
          sourceEl.selectionStart = sourceEl.selectionEnd = start-shift;
        }
      }
    } else {
      // Multi-line selection: indent/dedent every selected line, keeping
      // the selection spanning the same lines afterward
      const firstLineStart = val.lastIndexOf('\n', start-1) + 1;
      let lastLineEnd = val.indexOf('\n', end-1);
      if(lastLineEnd === -1) lastLineEnd = val.length;
      const block = val.slice(firstLineStart, lastLineEnd);
      const lines = block.split('\n');
      let removedFirst = 0;
      const newLines = lines.map((line,i)=>{
        if(!e.shiftKey) return '\t'+line;
        if(line[0]==='\t'){ if(i===0) removedFirst=1; return line.slice(1); }
        if(line.slice(0,4)==='    '){ if(i===0) removedFirst=4; return line.slice(4); }
        return line;
      });
      const newBlock = newLines.join('\n');
      sourceEl.value = val.slice(0,firstLineStart) + newBlock + val.slice(lastLineEnd);
      const delta = e.shiftKey ? -removedFirst : 1;
      sourceEl.selectionStart = Math.max(firstLineStart, start+delta);
      sourceEl.selectionEnd = firstLineStart + newBlock.length;
    }
    syncEditor(); scheduleAutoSync();
  }
  sourceEl.addEventListener('keydown', e=> handleEditorTabKey(e));
  editorStackEl.addEventListener('scroll', ()=>{
    gutterEl.scrollTop = editorStackEl.scrollTop;
  });
  function jumpToLine(lineNo){
    const lines = sourceEl.value.split('\n');
    let pos=0; for(let i=0;i<lineNo-1;i++) pos+=lines[i].length+1;
    sourceEl.focus();
    sourceEl.setSelectionRange(pos, pos+(lines[lineNo-1]||'').length);
    // scroll .editor-stack (the real scroll container) to center the line -
    // the textarea itself never scrolls internally, so this is the only
    // scroll that needs to happen.
    const targetTop = (lineNo-1) * LINE_HEIGHT;
    editorStackEl.scrollTop = Math.max(0, targetTop - editorStackEl.clientHeight/2);
  }

  /* ---- memory viewer ---- */
  const prevMemVals = new Map(); // addr -> last-seen byte value, for change-flash highlighting
  const MEM_VIEW_ROWS = 48; // generous fixed count so there's real vertical scroll range, not just exactly what fits

  /* ---- custom address-space scrollbar: a real native scrollbar over the
     rendered window can't reach the full 16MB (24-bit) address space -
     it can only scroll within whatever's currently rendered. This maps
     track position directly to an address across the whole space instead,
     giving click-to-jump and drag navigation through all of memory, with
     a minimum thumb size so it stays grabbable even though the visible
     window is a tiny fraction of the total range. ---- */
  function setupAddrScrollbar(trackEl, thumbEl, onSeek){
    function trackHeight(){ return trackEl.clientHeight || 300; }
    function seekFromClientY(clientY){
      const rect = trackEl.getBoundingClientRect();
      const th = thumbEl.offsetHeight || 24;
      const usable = Math.max(1, rect.height - th);
      const frac = Math.min(1, Math.max(0, (clientY - rect.top - th/2) / usable));
      onSeek(Math.round(frac * 0xFFFFFF));
    }
    let dragging = false;
    thumbEl.addEventListener('mousedown', e=>{ dragging=true; e.preventDefault(); e.stopPropagation(); seekFromClientY(e.clientY); });
    trackEl.addEventListener('mousedown', e=>{ if(e.target===thumbEl) return; seekFromClientY(e.clientY); });
    window.addEventListener('mousemove', e=>{ if(dragging) seekFromClientY(e.clientY); });
    window.addEventListener('mouseup', ()=>{ dragging=false; });
  }
  function updateAddrScrollThumb(trackEl, thumbEl, currentAddr){
    const th = trackHeightSafe(trackEl);
    const minThumb = 24;
    const thumbH = minThumb;
    const usable = Math.max(1, th - thumbH);
    const frac = Math.min(1, Math.max(0, currentAddr / 0xFFFFFF));
    thumbEl.style.height = thumbH+'px';
    thumbEl.style.top = Math.round(frac * usable)+'px';
  }
  function trackHeightSafe(trackEl){ return trackEl.clientHeight || 300; }
  function computeMemRows(){
    const availPx = hexdumpEl.clientHeight - 18; // minus vertical padding (9px top + 9px bottom)
    return availPx > 30 ? Math.max(4, Math.floor(availPx/18)) : 12; // 18px line-height; fallback for environments with no computed layout
  }
  let hexdumpDomCache = null; // {base, rows, cells:[{hexEl, asciiEl, addr}]} - reused across frames when the view window hasn't moved
  function renderHexdump(){
    if(!machine.simEngine){ hexdumpEl.textContent='Assemble a program to inspect memory.'; hexdumpDomCache = null; return; }
    const cols=16;
    const rows = computeMemRows();
    // Clamp so the LAST visible row can't run past 0xFFFFFF either - only
    // capping the first row (the old `Math.min(memBase, 0xFFFFFF)`) let a
    // base near the top still spill later rows past 0x1000000, where the
    // per-cell `&0xFFFFFF` address mask wrapped them back down to
    // 0x000000, reported as "scrolling down goes several lines after
    // FFFFF0, showing again from 000000".
    const maxBase = Math.max(0, (0x1000000 - rows*cols)) & ~0xF;
    const base = Math.min(clampMemBase(memBase), maxBase) & ~0xF;
    const pc = machine.getPC()>>>0;
    const sameWindow = hexdumpDomCache && hexdumpDomCache.base===base && hexdumpDomCache.rows===rows;
    if(!sameWindow){
      // structure changed (scrolled/navigated/first render) - full rebuild, same as before
      let out='';
      const cellRefs = [];
      for(let r=0;r<rows;r++){
        const addr=(base+r*cols)&0xFFFFFF;
        let hexPart='', asciiPart='';
        for(let c=0;c<cols;c++){
          const a = addr+c;
          const b=machine.readByte(a);
          const isPC = a===pc;
          prevMemVals.set(a, b);
          const classes = ['mem-byte-cell', isPC?'hb-pc':''].filter(Boolean).join(' ');
          const hb = hex(b,2);
          hexPart += `<span class="${classes}" spellcheck="false" data-addr="${a}" data-kind="hex">${hb}</span> `;
          const ch = (b>=32&&b<127) ? escapeHtml(String.fromCharCode(b)) : '.';
          const asciiClasses = ['mem-ascii-cell', isPC?'hb-pc':''].filter(Boolean).join(' ');
          asciiPart += `<span class="${asciiClasses}" spellcheck="false" data-addr="${a}" data-kind="ascii">${ch}</span>`;
        }
        out += `$${hex(addr,6)}  ${hexPart} ${asciiPart}\n`;
      }
      hexdumpEl.innerHTML = out;
      const hexEls = hexdumpEl.querySelectorAll('[data-kind="hex"]');
      const asciiEls = hexdumpEl.querySelectorAll('[data-kind="ascii"]');
      for(let i=0;i<hexEls.length;i++) cellRefs.push({ hexEl:hexEls[i], asciiEl:asciiEls[i], addr: parseInt(hexEls[i].dataset.addr,10), wasPC: hexEls[i].classList.contains('hb-pc') });
      hexdumpDomCache = { base, rows, cells: cellRefs };
    } else {
      // same view window as last frame - only touch cells that actually changed value or PC-highlight state
      for(const cell of hexdumpDomCache.cells){
        const b = machine.readByte(cell.addr);
        const prev = prevMemVals.get(cell.addr);
        const isPC = cell.addr===pc;
        const valueChanged = prev !== b;
        prevMemVals.set(cell.addr, b);
        if(valueChanged){
          cell.hexEl.textContent = hex(b,2);
          cell.asciiEl.textContent = (b>=32&&b<127) ? String.fromCharCode(b) : '.';
          // A real value change (e.g. the running program itself wrote here)
          // supersedes any stale invalid-red overlay left over from a bad
          // manual hex edit at this address - the underlying byte moved on.
          cell.hexEl.classList.remove('mem-cell-invalid');
          cancelPendingInvalidRevert(cell.addr);
          // restart the flash animation by removing and re-adding the class on the next frame tick
          cell.hexEl.classList.remove('flash-changed'); cell.asciiEl.classList.remove('flash-changed');
          void cell.hexEl.offsetWidth; // force reflow so the class removal registers before re-adding
          cell.hexEl.classList.add('flash-changed'); cell.asciiEl.classList.add('flash-changed');
        }
        if(isPC !== cell.wasPC){
          cell.hexEl.classList.toggle('hb-pc', isPC);
          cell.asciiEl.classList.toggle('hb-pc', isPC);
          cell.wasPC = isPC;
        }
      }
    }
    updateAddrScrollThumb(document.getElementById('memScrollbar'), document.getElementById('memScrollThumb'), base);
  }
  /* ---- editable memory cells: click a hex-byte or ASCII-char cell to
     start "typing through" memory like a hex editor, not a per-cell
     contenteditable text box - to_do.md was explicit that typing must
     flow across cells: click a starting byte, then every keystroke keeps
     writing forward (2 hex digits = 1 byte, or 1 ASCII char = 1 byte),
     auto-advancing the target address each time, with the OTHER column
     (hex<->ASCII) kept in sync on every real byte change. This can't be
     done with per-span contenteditable (each span is its own isolated
     editable region with no way to "spill over" into the next one), so
     cells are plain (non-editable) spans; the hexdump container itself
     holds keyboard focus (tabindex=-1, focus() called on click) and a
     single keydown listener drives a small state machine instead. ---- */
  let memEditActive = null; // {addr, kind:'hex'|'ascii', digits:''} - digits holds 0-1 raw chars typed so far for the in-progress byte (hex only)
  const pendingInvalidRevert = new Map(); // addr -> timeout handle - an invalid-red cell reverts to the real value on its own a couple seconds after the bad entry, instead of staying red until the user acts on it again
  function cancelPendingInvalidRevert(addr){
    const t = pendingInvalidRevert.get(addr);
    if(t){ clearTimeout(t); pendingInvalidRevert.delete(addr); }
  }
  function memCellSpan(addr, kind){ return hexdumpEl.querySelector(`[data-addr="${addr}"][data-kind="${kind}"]`); }
  function clearMemEditHighlight(addr){
    if(addr==null) return;
    const hexEl = memCellSpan(addr,'hex'), asciiEl = memCellSpan(addr,'ascii');
    if(hexEl) hexEl.classList.remove('mem-cell-editing');
    if(asciiEl) asciiEl.classList.remove('mem-cell-editing');
  }
  function markMemEditHighlight(addr){
    const hexEl = memCellSpan(addr,'hex'), asciiEl = memCellSpan(addr,'ascii');
    if(hexEl) hexEl.classList.add('mem-cell-editing');
    if(asciiEl) asciiEl.classList.add('mem-cell-editing');
  }
  // Redraws one address's hex+ASCII cells from the REAL current byte value,
  // clearing any leftover invalid-red/provisional-digit overlay - used both
  // when starting a fresh edit on a cell and after a successful write.
  function syncMemCellPairDisplay(addr){
    cancelPendingInvalidRevert(addr);
    const b = machine.readByte(addr);
    const hexEl = memCellSpan(addr,'hex'), asciiEl = memCellSpan(addr,'ascii');
    if(hexEl){ hexEl.textContent = hex(b,2); hexEl.classList.remove('mem-cell-invalid'); }
    if(asciiEl){ asciiEl.textContent = (b>=32&&b<127) ? String.fromCharCode(b) : '.'; asciiEl.classList.remove('mem-cell-invalid'); }
    prevMemVals.set(addr, b);
  }
  function ensureMemAddrVisible(addr){
    const cols=16, rows = computeMemRows();
    const base = memBase>>>0 & ~0xF;
    if(addr>=base && addr<base+rows*cols) return; // already on-screen
    memBase = addr & ~0xF;
    renderHexdump();
  }
  function startMemEdit(kind, addr){
    if(memEditActive){
      if(memEditActive.digits.length===1) syncMemCellPairDisplay(memEditActive.addr); // discard a lone pending digit
      clearMemEditHighlight(memEditActive.addr);
    }
    memEditActive = { kind, addr, digits:'' };
    syncMemCellPairDisplay(addr); // clear any stale invalid-red left on THIS cell from an earlier bad edit
    markMemEditHighlight(addr);
  }
  function cancelMemEdit(){
    if(!memEditActive) return;
    if(memEditActive.digits.length===1) syncMemCellPairDisplay(memEditActive.addr);
    clearMemEditHighlight(memEditActive.addr);
    memEditActive = null;
  }
  function advanceMemEditCursor(){
    clearMemEditHighlight(memEditActive.addr);
    memEditActive.addr = (memEditActive.addr+1) & 0xFFFFFF;
    memEditActive.digits = '';
    ensureMemAddrVisible(memEditActive.addr);
    markMemEditHighlight(memEditActive.addr);
  }
  function commitHexKeystroke(ch){
    const cur = memEditActive;
    cur.digits += ch;
    if(cur.digits.length < 2){
      const hexEl = memCellSpan(cur.addr,'hex');
      if(hexEl) hexEl.textContent = cur.digits; // provisional single-digit preview, byte not written yet
      return;
    }
    const pair = cur.digits;
    if(/^[0-9A-Fa-f]{2}$/.test(pair)){
      machine.writeByte(cur.addr, parseInt(pair,16));
      reassertHwInputAddr(cur.addr); // input device (switch/button) wins if this address maps to one
      syncMemCellPairDisplay(cur.addr);
    } else {
      const hexEl = memCellSpan(cur.addr,'hex');
      if(hexEl){ hexEl.textContent = pair; hexEl.classList.add('mem-cell-invalid'); }
      // byte itself is untouched - only the display shows the bad entry, in
      // red, for a couple seconds before reverting to the real value on
      // its own (rather than staying red indefinitely until the user
      // clicks the cell again or something else happens to change it).
      const addrForRevert = cur.addr;
      cancelPendingInvalidRevert(addrForRevert);
      pendingInvalidRevert.set(addrForRevert, setTimeout(()=>{
        pendingInvalidRevert.delete(addrForRevert);
        syncMemCellPairDisplay(addrForRevert);
      }, 2500));
    }
    renderAllStackDumps(); ui.renderAll();
    advanceMemEditCursor();
  }
  function commitAsciiKeystroke(ch){
    const cur = memEditActive;
    machine.writeByte(cur.addr, ch.charCodeAt(0) & 0xFF);
    reassertHwInputAddr(cur.addr);
    syncMemCellPairDisplay(cur.addr);
    renderAllStackDumps(); ui.renderAll();
    advanceMemEditCursor();
  }
  hexdumpEl.addEventListener('mousedown', e=>{
    const span = e.target.closest('[data-kind]');
    if(!span) return;
    e.preventDefault(); // these cells aren't natively focusable/selectable text anymore
    startMemEdit(span.dataset.kind, parseInt(span.dataset.addr,10));
    hexdumpEl.focus();
  });
  hexdumpEl.addEventListener('keydown', e=>{
    if(!memEditActive) return;
    if(e.key==='Escape'){ e.preventDefault(); cancelMemEdit(); return; }
    if(e.key==='Enter'){ e.preventDefault(); cancelMemEdit(); return; }
    if(e.key.length!==1) return; // ignore modifiers/navigation/function keys
    e.preventDefault();
    if(memEditActive.kind==='ascii') commitAsciiKeystroke(e.key);
    else commitHexKeystroke(e.key);
  });
  hexdumpEl.addEventListener('focusout', ()=> cancelMemEdit());

  /* ---- editable registers: click any register value, type a new hex
     value, Enter/blur commits it straight into the running simulator.
     A7 is special-cased to write through the mode-aware "active" stack
     pointer (matching what the CPU actually uses right now), not a fixed
     physical slot. ---- */
  function commitRegCellEdit(span){
    const reg = span.dataset.reg;
    const maxDigits = (reg==='SR') ? 4 : 8;
    const text = span.textContent.replace(/^\$/,'').trim();
    if(!/^[0-9A-Fa-f]{1,8}$/.test(text) || text.length>maxDigits){ ui.renderAll(); return; }
    const val = parseInt(text,16);
    if(reg==='PC') machine.setPC(val);
    else if(reg==='SR') machine.setSR(val);
    else if(reg==='USP') machine.setUSP(val);
    else if(reg==='SSP') machine.setSSP(val);
    else if(reg==='A7') machine.setActiveA7(val); // mode-aware - writes to whichever stack (USP/SSP) is currently active
    else if(reg[0]==='D') machine.setD(parseInt(reg.slice(1),10), val);
    else if(reg[0]==='A') machine.setA(parseInt(reg.slice(1),10), val);
    ui.renderAll();
  }
  const regsWrapEl = document.querySelector('.regs-h-wrap');
  regsWrapEl.addEventListener('keydown', e=>{
    const span = e.target.closest('[data-reg]');
    if(!span) return;
    if(e.key==='Enter'){ e.preventDefault(); span.blur(); }
    else if(e.key==='Escape'){ e.preventDefault(); ui.renderAll(); span.blur(); }
  });
  regsWrapEl.addEventListener('focusout', e=>{
    const span = e.target.closest('[data-reg]');
    if(span) commitRegCellEdit(span);
  });
  setupAddrScrollbar(document.getElementById('memScrollbar'), document.getElementById('memScrollThumb'), addr=>{ memBase = clampMemBase(addr); renderHexdump(); });
  // Shared by the Go button and Enter in the address box - on an invalid
  // address, show it in red and leave memBase (the displayed window)
  // untouched, in both cases.
  function applyMemGoAddress(){
    const v = memAddrEl.value.trim().replace(/^\$/,'');
    const valid = /^[0-9A-Fa-f]+$/.test(v);
    const n = valid ? parseInt(v,16) : NaN;
    if(valid && !isNaN(n)){
      memAddrEl.classList.remove('mem-addr-invalid');
      memBase = clampMemBase(n);
      renderHexdump();
      return true;
    }
    memAddrEl.classList.add('mem-addr-invalid');
    return false;
  }
  $('#memGo').addEventListener('click', applyMemGoAddress);
  memAddrEl.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); applyMemGoAddress(); }
  });
  memAddrEl.addEventListener('input', ()=>{ memAddrEl.classList.remove('mem-addr-invalid'); });
  $('#memPC').addEventListener('click', ()=>{ memBase=clampMemBase(machine.getPC()); renderHexdump(); });
  $('#memUSP').addEventListener('click', ()=>{ memBase=clampMemBase(machine.getA(7)>>>0); renderHexdump(); });
  $('#memSSP').addEventListener('click', ()=>{ memBase=clampMemBase(machine.getA(8)>>>0); renderHexdump(); });
  $('#memA7').addEventListener('click', ()=>{ memBase=clampMemBase(machine.getActiveA7()>>>0); renderHexdump(); });
  function currentMemPageBytes(){ return computeMemRows()*16; }
  $('#memPrev').addEventListener('click', ()=>{ memBase=clampMemBase(memBase-currentMemPageBytes()); renderHexdump(); });
  $('#memNext').addEventListener('click', ()=>{ memBase=clampMemBase(memBase+currentMemPageBytes()); renderHexdump(); });
  hexdumpEl.addEventListener('wheel', e=>{
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    memBase = clampMemBase(memBase + dir*3*16); // 3 rows per wheel tick
    renderHexdump();
  }, {passive:false});

  /* ---- stack pane ----
     Single stack view (kept to one, not multiple side-by-side, so the
     right column's width always matches the Memory tab exactly - a
     multi-column layout couldn't fit dropdown+base-input+buttons+a
     usably-wide value column in the same fixed width). Pick any address
     register, US, or SS via the dropdown.
     Two independent markers: "BASE" is a user-settable reference address
     (defaults to the selected register's current value when you switch
     registers) that stays put until you explicitly move it via Set Base -
     useful as a fixed anchor while the actual SP moves around during
     execution. The SP marker shows wherever the selected register
     ACTUALLY is right now, labeled with its register name, and the view
     auto-follows it (recentering) unless you've manually scrolled away -
     "Go to Stack" jumps back and resumes following.
     Drawn growing up: lower addresses at the top, matching how a stack
     conceptually "grows upward" as more gets pushed (even though the
     hardware SP counts down). One word per line, since 68k stack
     operations are word/longword-aligned. */
  function clampAddr(a){ a = a>>>0; return a > 0xFFFFFF ? 0xFFFFFF : a; }
  function resolveStackAddr(reg){
    if(!machine.simEngine) return 0;
    if(reg==='US') return machine.getA(7)>>>0;
    if(reg==='SS') return machine.getA(8)>>>0;
    if(reg==='SP' || reg==='A7'){
      const supervisor = (machine.getSR() & 0x2000) !== 0;
      return (supervisor ? machine.getA(8) : machine.getA(7))>>>0;
    }
    const idx = parseInt(reg.slice(1),10); // A0-A6
    return machine.getA(idx)>>>0;
  }
  function stackRegLabel(reg){
    if(reg==='US') return 'USP';
    if(reg==='SS') return 'SSP';
    if(reg==='A7') return ((machine.getSR()&0x2000)!==0) ? 'SSP' : 'USP'; // mode-aware: A7 shown as whichever is actually active
    return reg;
  }
  const STACK_VIEW_ROWS = 96; // range per panel, kept a bit smaller now that there are 3 side by side
  const prevStackVals = [new Map(), new Map(), new Map()];
  const stackPanels = [
    { reg:'US', baseMark:null, followSP:true, suppressScroll:false, el: document.getElementById('stackDump0'), scrollTrack: document.getElementById('stackScrollbar0'), scrollThumb: document.getElementById('stackScrollThumb0'), baseInputEl: document.getElementById('stackBaseInput0') },
    { reg:'SS', baseMark:null, followSP:true, suppressScroll:false, el: document.getElementById('stackDump1'), scrollTrack: document.getElementById('stackScrollbar1'), scrollThumb: document.getElementById('stackScrollThumb1'), baseInputEl: document.getElementById('stackBaseInput1') },
    { reg:'A7', baseMark:null, followSP:true, suppressScroll:false, el: document.getElementById('stackDump2'), scrollTrack: document.getElementById('stackScrollbar2'), scrollThumb: document.getElementById('stackScrollThumb2'), baseInputEl: document.getElementById('stackBaseInput2') },
  ];
  function setStackBaseMark(p, addr){
    p.baseMark = clampAddr(addr) & ~1;
    if(p.baseInputEl) p.baseInputEl.value = hex(p.baseMark, 6);
  }
  function initStackBaseMark(p){ setStackBaseMark(p, resolveStackAddr(p.reg)); }
  function computeStackRows(p){
    const availPx = p.el.clientHeight - 18;
    return availPx > 30 ? Math.max(4, Math.floor(availPx/18)) : 16;
  }
  function renderStackDump(idx){
    const p = stackPanels[idx];
    if(!machine.simEngine){ p.el.textContent='Assemble to inspect.'; return; }
    if(p.baseMark===null) initStackBaseMark(p);
    const spAddr = clampAddr(resolveStackAddr(p.reg)) & ~1;
    const spLabel = stackRegLabel(p.reg);
    const rows = computeStackRows(p);
    const center = p.followSP ? spAddr : (p._lastRangeCenter ?? spAddr);
    const totalRangeBytes = rows*2;
    let rangeStart = (center - Math.floor(rows/2)*2);
    if(rangeStart < 0) rangeStart = 0;
    if(rangeStart + totalRangeBytes > 0xFFFFFF) rangeStart = 0x1000000 - totalRangeBytes;
    rangeStart = clampAddr(rangeStart) & ~1;
    p._lastRangeCenter = center;
    let out = '';
    for(let r=0;r<rows;r++){
      const addr = (rangeStart + r*2) & 0xFFFFFF;
      const w = ((machine.readByte(addr)&0xFF)<<8) | (machine.readByte(addr+1)&0xFF);
      const isSP = addr===spAddr, isBase = addr===p.baseMark;
      const changed = prevStackVals[idx].has(addr) && prevStackVals[idx].get(addr) !== w;
      prevStackVals[idx].set(addr, w);
      const rowClasses = [isSP?'hb-sp':'', isBase?'hb-base':'', changed?'flash-changed':''].filter(Boolean).join(' ');
      const marker = isSP && isBase ? `◄${spLabel}+BASE` : isSP ? `◄${spLabel}` : isBase ? `◄BASE` : '';
      const valSpan = `<span class="mem-byte-cell stack-word-cell" contenteditable="true" spellcheck="false" data-addr="${addr}" data-panel="${idx}">${hex(w,4)}</span>`;
      const line = `$${hex(addr,6)} ${valSpan}${marker}`;
      out += rowClasses ? `<div class="${rowClasses}">${line}</div>` : `<div>${line}</div>`;
    }
    p.el.innerHTML = out;
    updateAddrScrollThumb(p.scrollTrack, p.scrollThumb, rangeStart);
  }
  function renderAllStackDumps(){ for(let i=0;i<3;i++) renderStackDump(i); }
  function commitStackCellEdit(span){
    const addr = parseInt(span.dataset.addr, 10);
    const idx = parseInt(span.dataset.panel, 10);
    const text = span.textContent.trim().replace(/^\$/,'');
    if(!/^[0-9A-Fa-f]{1,4}$/.test(text)){ renderStackDump(idx); return; }
    const w = parseInt(text,16);
    machine.writeByte(addr, (w>>8)&0xFF);
    machine.writeByte(addr+1, w&0xFF);
    reassertHwInputAddr(addr); reassertHwInputAddr(addr+1); // a stack edit writes 2 bytes - either one could be a switch/button address
    renderAllStackDumps(); // a write can be visible from more than one panel if their ranges overlap
    ui.renderAll();
  }
  stackPanels.forEach((p, idx)=>{
    p.el.addEventListener('wheel', e=>{
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      p.followSP = false;
      p._lastRangeCenter = clampAddr((p._lastRangeCenter ?? clampAddr(resolveStackAddr(p.reg))) + dir*3*2) & ~1;
      renderStackDump(idx);
    }, {passive:false});
    p.el.addEventListener('keydown', e=>{
      const span = e.target.closest('.stack-word-cell');
      if(!span) return;
      if(e.key==='Enter'){ e.preventDefault(); span.blur(); }
      else if(e.key==='Escape'){ e.preventDefault(); renderStackDump(idx); span.blur(); }
    });
    p.el.addEventListener('focusout', e=>{
      const span = e.target.closest('.stack-word-cell');
      if(span) commitStackCellEdit(span);
    });
    setupAddrScrollbar(p.scrollTrack, p.scrollThumb, addr=>{
      p.followSP = false;
      p._lastRangeCenter = clampAddr(addr) & ~1;
      renderStackDump(idx);
    });
    const dropdownEl = document.getElementById('stackRegDropdown'+idx);
    dropdownEl.addEventListener('change', ()=>{
      p.reg = dropdownEl.value;
      initStackBaseMark(p);
      p.followSP = true;
      renderStackDump(idx);
    });
    document.getElementById('stackSetBaseBtn'+idx).addEventListener('click', ()=>{
      const text = document.getElementById('stackBaseInput'+idx).value.trim().replace(/^\$/,'');
      if(!/^[0-9A-Fa-f]{1,8}$/.test(text)) return;
      setStackBaseMark(p, parseInt(text,16));
      renderStackDump(idx);
    });
    document.getElementById('stackGoBtn'+idx).addEventListener('click', ()=>{
      p.followSP = true;
      renderStackDump(idx);
    });
  });

  /* ---- shared "normal window" behavior for every floating panel (Output,
     Hardware, TRAP #15 Reference): clicking anywhere in one brings it in
     front of the others, like a real desktop window manager, instead of a
     fixed CSS z-index tied to DOM order (to_do.md: "I want the order to be
     changeable... roughly, I want these windows to behave like 'normal'
     windows" - previously Hardware was always drawn after Output in the
     HTML, so it always won on overlap no matter which one was clicked).
     Each window gets its OWN listener (registered where it's set up below)
     rather than one delegated document-level listener, since a plain click
     inside, say, the hexdump or a text input shouldn't need to bubble all
     the way up just to answer "which floating window is this in." ---- */
  let floatWindowZCounter = 90; // matches .float-window's own base z-index in gui_shell.html
  function bringFloatWindowToFront(el){
    el.style.zIndex = String(++floatWindowZCounter);
  }
  function makeFloatWindowFocusable(el){
    el.addEventListener('mousedown', ()=> bringFloatWindowToFront(el));
  }

  /* ---- floating Output (graphics & text) window: open by default (it's
     where most programs show their results), same open/close/drag/resize
     pattern as the Hardware window. ---- */
  const outputFloatWindow = $('#outputFloatWindow'), outputFloatTitlebar = $('#outputFloatTitlebar');
  makeFloatWindowFocusable(outputFloatWindow);
  /* gfxCanvas sizing: an exact integer CSS pixel size always, driven from
     here rather than left to CSS auto-sizing (width:auto;height:auto;
     object-fit:contain) - that combination let the canvas's rendered CSS
     size land on a fractional value (e.g. 640x480.5, a hair off native
     640x480) purely from ordinary flexbox/centering sub-pixel layout, and
     nearest-neighbor "pixelated" scaling of ANY non-exact ratio can
     silently drop individual source rows/columns instead of blending
     them - for a genuinely 1px-thin line, that means part of it just
     isn't drawn (to_do.md, reported twice: "some pixels are missing").
     Two distinct behaviors, deliberately not merged into one "smart fit"
     function (an earlier version that tried to auto-fit on every open
     is exactly what caused the pixels-still-missing report the second
     time - the container's precise size at that moment is never
     guaranteed to land on an exact 1:1 ratio, so "smart" here just meant
     "occasionally wrong"):
       - resetGfxCanvasToNativeSize(): forces an EXACT, unscaled 1:1 fit -
         no container measurement, no ambiguity, cannot land on a
         fractional ratio. This is the ONLY sizing call on every path
         that counts as "starting": opening the output window and a
         program's resolution change (setWindowSize). Explicitly enlarging
         the window afterward is the user's own deliberate action, not
         part of "starting."
       - fitGfxCanvasToContainer(): scales UP or DOWN (nearest-neighbor
         via image-rendering:pixelated either way except see
         .gfx-downscaled below) to fill however much room the window
         currently has - only called from explicit resize interactions
         (drag-resize handle, fullscreen exit, browser window resize) and
         "Reset to actual size" (misleadingly named for what it does
         inside - see its own handler). Scaling UP when the window is
         dragged bigger or fullscreen is activated is a real, intended
         feature - "Reset to actual size" exists specifically as the way
         to undo an enlarged state, which only makes sense if enlarging
         is possible to begin with.
     .gfx-downscaled (gui_shell.html) switches to smooth image-rendering
     only when fitGfxCanvasToContainer() had to shrink BELOW native -real
     information loss is unavoidable there, and blending beats nearest-
     neighbor silently dropping 1px-thin content. Both skip fullscreen
     entirely: the #outputFloatWindow:fullscreen #gfxCanvas CSS rule owns
     sizing there (100vw/100vh) - an inline style left over from either
     function would outrank that rule, which is exactly why fullscreen
     stopped enlarging the image before this fix; entering fullscreen now
     explicitly clears the inline style so the CSS rule can apply at all. */
  function applyGfxCanvasSize(w, h){
    const nativeW = gfxCanvas.width, nativeH = gfxCanvas.height;
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    gfxCanvas.style.width = w + 'px';
    gfxCanvas.style.height = h + 'px';
    // Even an explicit, exact-native requested size (w===nativeW) can still
    // render a hair SMALLER once the browser snaps the CSS box to the
    // physical device-pixel grid - confirmed by direct measurement: at
    // devicePixelRatio 0.9, an explicit "640px" style renders as ~639.79
    // CSS px, not 640. Comparing the REQUESTED w/h (the old check) can
    // never catch this, since the request itself was correct - only
    // re-measuring the ACTUAL rendered box after layout catches it.
    // Nearest-neighbor (pixelated) uniquely drops whole source rows/columns
    // for ANY shrink below native, even a fraction of a device pixel,
    // unlike a plain blur - this is what caused 1px-thin outline gaps
    // (to_do.md) to persist even in the "exact 1:1 on start" path, which
    // by design never intentionally asks for less than native.
    const dpr = window.devicePixelRatio || 1;
    const rect = gfxCanvas.getBoundingClientRect();
    const EPS = 0.5; // sub-device-pixel float noise, not a real shrink
    let downscaled;
    if(rect.width > 0 && rect.height > 0){
      // Real measurement, per the comment above - catches a browser
      // DPI-rounding shrink even when the REQUEST itself was exact.
      downscaled = (rect.width*dpr) < nativeW - EPS || (rect.height*dpr) < nativeH - EPS;
    } else {
      // No real layout engine to measure against (e.g. jsdom in tests) -
      // fall back to comparing the requested size directly.
      downscaled = w < nativeW || h < nativeH;
    }
    gfxCanvas.classList.toggle('gfx-downscaled', downscaled);
  }
  function resetGfxCanvasToNativeSize(){
    if(document.fullscreenElement === outputFloatWindow) return;
    applyGfxCanvasSize(gfxCanvas.width, gfxCanvas.height);
  }
  function fitGfxCanvasToContainer(){
    if(document.fullscreenElement === outputFloatWindow) return;
    const graphicsBodyEl = document.querySelector('.graphics-body');
    if(!graphicsBodyEl) return;
    const avail = graphicsBodyEl.getBoundingClientRect();
    const consoleViewEl = document.querySelector('.console-view');
    const padX = consoleViewEl ? (parseFloat(getComputedStyle(consoleViewEl).paddingLeft)||0) + (parseFloat(getComputedStyle(consoleViewEl).paddingRight)||0) : 0;
    const padY = consoleViewEl ? (parseFloat(getComputedStyle(consoleViewEl).paddingTop)||0) + (parseFloat(getComputedStyle(consoleViewEl).paddingBottom)||0) : 0;
    const availW = Math.max(1, avail.width - padX);
    const availH = Math.max(1, avail.height - padY);
    const nativeW = gfxCanvas.width, nativeH = gfxCanvas.height;
    const scale = Math.min(availW/nativeW, availH/nativeH);
    applyGfxCanvasSize(nativeW*scale, nativeH*scale);
  }
  $('#btnToggleOutputWindow').addEventListener('click', ()=>{
    outputFloatWindow.hidden = !outputFloatWindow.hidden;
    if(!outputFloatWindow.hidden){
      resetGfxCanvasToNativeSize(); // opening = "starting" - always exactly 1:1
      bringFloatWindowToFront(outputFloatWindow);
    }
  });
  $('#btnCloseOutputWindow').addEventListener('click', ()=>{ outputFloatWindow.hidden = true; outputWindowKnownVisible = false; });
  $('#btnToggleFullscreen').addEventListener('click', ()=>{
    simHost.setFullscreen(document.fullscreenElement !== outputFloatWindow);
  });
  document.addEventListener('fullscreenchange', ()=>{
    const isFs = document.fullscreenElement === outputFloatWindow;
    // Real, verified browser behavior (not jsdom-detectable, no real layout
    // there): the `hidden` IDL property/attribute has NO rendering effect at
    // all on an <svg> element - only HTMLElement reflects it, confirmed by
    // direct testing in real headless Chrome (a bare `<svg hidden>` renders
    // with computed display:inline regardless). `.style.display` is the one
    // thing that actually works for any element type - see the
    // btnRunIconPlay/btnRunIconPause CLAUDE.md gotcha for the full story.
    document.getElementById('iconMaximize').style.display = isFs ? 'none' : '';
    document.getElementById('iconRestore').style.display = isFs ? '' : 'none';
    document.getElementById('btnToggleFullscreen').title = isFs ? 'Restore (windowed)' : 'Maximize (full screen)';
    if(isFs){
      // Clear any leftover windowed-mode inline size so the
      // #outputFloatWindow:fullscreen #gfxCanvas CSS rule (100vw/100vh)
      // can actually take effect - an inline style always outranks it.
      gfxCanvas.style.width = ''; gfxCanvas.style.height = '';
      gfxCanvas.classList.remove('gfx-downscaled');
    } else {
      fitGfxCanvasToContainer(); // restore a proper windowed fit for whatever size the window currently is
    }
  });
  $('#btnResetOutputSize').addEventListener('click', ()=>{
    const maxW = Math.round(window.innerWidth*0.92), maxH = Math.round(window.innerHeight*0.92);
    outputFloatWindow.style.width = Math.min(gfxCanvas.width+30, maxW) + 'px';
    outputFloatWindow.style.height = Math.min(gfxCanvas.height+70, maxH) + 'px';
    resetGfxCanvasToNativeSize(); // this button's whole purpose is "return to 1:1" - not another fit computation
  });
  (function(){
    let dragging=false, offX=0, offY=0;
    outputFloatTitlebar.addEventListener('mousedown', e=>{
      if(e.target.closest('button')) return;
      dragging = true;
      const r = outputFloatWindow.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      // set left/top from the CURRENT on-screen position before clearing
      // right, so the window never has a frame with right:auto and no
      // left value yet (which caused it to flash to its default position)
      outputFloatWindow.style.left = r.left + 'px';
      outputFloatWindow.style.top = r.top + 'px';
      outputFloatWindow.style.right = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const maxX = window.innerWidth - 60, maxY = window.innerHeight - 40;
      outputFloatWindow.style.left = Math.min(Math.max(0, e.clientX-offX), maxX) + 'px';
      outputFloatWindow.style.top = Math.min(Math.max(0, e.clientY-offY), maxY) + 'px';
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; });
  })();
  (function(){
    let resizing=false, startW=0, startH=0, startX=0, startY=0;
    $('#outputFloatResize').addEventListener('mousedown', e=>{
      resizing = true;
      bringFloatWindowToFront(outputFloatWindow); // stopPropagation() below keeps this from reaching the window's own generic focus listener
      const r = outputFloatWindow.getBoundingClientRect();
      startW=r.width; startH=r.height; startX=e.clientX; startY=e.clientY;
      e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', e=>{
      if(!resizing) return;
      outputFloatWindow.style.width = Math.max(360, startW + (e.clientX-startX)) + 'px';
      outputFloatWindow.style.height = Math.max(280, startH + (e.clientY-startY)) + 'px';
      fitGfxCanvasToContainer(); // dragging the window bigger/smaller deliberately scales the picture to match
    });
    window.addEventListener('mouseup', ()=>{ resizing=false; });
  })();
  window.addEventListener('resize', ()=>{ if(!outputFloatWindow.hidden) fitGfxCanvasToContainer(); });

  /* ---- floating Hardware & Interrupt window: open/close, drag to move,
     drag to resize. A real lightweight "window" the student can position
     wherever's convenient while watching it update during a step. ---- */
  const hwFloatWindow = $('#hwFloatWindow'), hwFloatTitlebar = $('#hwFloatTitlebar');
  makeFloatWindowFocusable(hwFloatWindow);
  $('#btnToggleHwWindow').addEventListener('click', ()=>{
    hwFloatWindow.hidden = !hwFloatWindow.hidden;
    if(!hwFloatWindow.hidden){
      updateHardwareDisplay();
      bringFloatWindowToFront(hwFloatWindow);
    }
  });
  $('#btnCloseHwWindow').addEventListener('click', ()=>{ hwFloatWindow.hidden = true; });
  (function(){
    let dragging=false, offX=0, offY=0;
    hwFloatTitlebar.addEventListener('mousedown', e=>{
      if(e.target.closest('button')) return; // don't drag when clicking the close button
      dragging = true;
      const r = hwFloatWindow.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      hwFloatWindow.style.right = 'auto'; // switch from right-anchored to left-anchored once moved
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const maxX = window.innerWidth - 60, maxY = window.innerHeight - 40;
      hwFloatWindow.style.left = Math.min(Math.max(0, e.clientX-offX), maxX) + 'px';
      hwFloatWindow.style.top = Math.min(Math.max(0, e.clientY-offY), maxY) + 'px';
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; });
  })();

  /* ---- floating TRAP #15 Reference window: same open/close/drag/resize/
     focus pattern as Output/Hardware - purely static reference content, so
     no per-open refresh call is needed (unlike updateHardwareDisplay()/
     resetGfxCanvasToNativeSize() above). ---- */
  const helpFloatTitlebar = $('#helpFloatTitlebar');
  makeFloatWindowFocusable(helpFloatWindow);
  (function(){
    let dragging=false, offX=0, offY=0;
    helpFloatTitlebar.addEventListener('mousedown', e=>{
      if(e.target.closest('button')) return;
      dragging = true;
      const r = helpFloatWindow.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      helpFloatWindow.style.right = 'auto';
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const maxX = window.innerWidth - 60, maxY = window.innerHeight - 40;
      helpFloatWindow.style.left = Math.min(Math.max(0, e.clientX-offX), maxX) + 'px';
      helpFloatWindow.style.top = Math.min(Math.max(0, e.clientY-offY), maxY) + 'px';
    });
    window.addEventListener('mouseup', ()=>{ dragging=false; });
  })();
  (function(){
    let resizing=false, startW=0, startH=0, startX=0, startY=0;
    $('#helpFloatResize').addEventListener('mousedown', e=>{
      resizing = true;
      bringFloatWindowToFront(helpFloatWindow);
      const r = helpFloatWindow.getBoundingClientRect();
      startW=r.width; startH=r.height; startX=e.clientX; startY=e.clientY;
      e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', e=>{
      if(!resizing) return;
      helpFloatWindow.style.width = Math.max(360, startW + (e.clientX-startX)) + 'px';
      helpFloatWindow.style.height = Math.max(260, startH + (e.clientY-startY)) + 'px';
    });
    window.addEventListener('mouseup', ()=>{ resizing=false; });
  })();

  /* ---- tabs: scoped per group (left pane / messages / hardware-interrupt),
     since there are now three independent tab strips sharing the same
     .tab/.left-tab-content classes - a click in one must not affect the
     others. ---- */
  document.querySelectorAll('.left-tabs').forEach(tabRow=>{
    const container = tabRow.parentElement;
    tabRow.querySelectorAll('.tab').forEach(tab=>{
      tab.addEventListener('click', ()=>{
        tabRow.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
        container.querySelectorAll(':scope > .left-tab-content').forEach(c=>c.hidden=true);
        tab.classList.add('active');
        const content = document.getElementById('tab-'+tab.dataset.tab);
        if(content) content.hidden=false;
        if(tab.dataset.tab==='hw'){ updateHardwareDisplay(); }
        if(tab.dataset.tab==='memtab'){ renderHexdump(); }
        if(tab.dataset.tab==='stacktab'){ renderAllStackDumps(); }
        // Errors/Log auto-scroll on every new line (appendLog/appendRuntimeError/
        // showErrors) only has real effect while the pane is actually visible -
        // scrollHeight reads as 0 while [hidden], so messages that arrived
        // while the OTHER of the two tabs was active leave scrollTop stuck at
        // 0 (top) even though new content kept appending. Re-sync to the
        // bottom right when a pane becomes visible again, so switching to
        // check on it always shows the latest line, not stale scroll-position.
        if(tab.dataset.tab==='errors'){ const m=document.getElementById('messages'); if(m) m.scrollTop = m.scrollHeight; }
        if(tab.dataset.tab==='log'){ const s=document.getElementById('syslog'); if(s) s.scrollTop = s.scrollHeight; }
      });
    });
  });

  /* ---- run loop: time-budgeted, using native in-WASM batches (not a
     per-instruction JS loop) so programs that need tens of thousands of
     instructions per rendered frame (e.g. a real game) still run at a
     usable speed instead of trickling out over many seconds. ---- */
  const FRAME_BUDGET_MS = 12; // leave headroom in each ~16.6ms frame for rendering
  const CHUNK_MAX = 100000;   // instructions per native batch call - the common, compute-only case
  const CHUNK_MIN = 50;       // floor for a program whose loop body is almost entirely TRAP #15 calls
  let chunkSize = CHUNK_MAX;  // adapts down/up based on how long a batch ACTUALLY took - see below
  // The 100000-instruction batch size above only leaves "headroom in each
  // ~16.6ms frame" for a compute-only program - the while loop below only
  // re-checks elapsed time BETWEEN whole chunk calls, never WITHIN one, so
  // a single chunk can massively overshoot FRAME_BUDGET_MS if its
  // instruction stream does real per-iteration work outside the CPU core
  // (every TRAP #15 graphics call is a synchronous EM_JS round-trip into
  // JS/Canvas2D). to_do.md's mouse-tracking-circle report ("the whole
  // EASy68K-WEB seems to go slow", the circle looking stuck or redrawn in
  // the wrong place) turned out to be exactly this: measured directly in
  // real headless Chrome (not jsdom, which stubs out canvas calls as
  // free no-ops and so can never reproduce real draw-call cost) via a
  // requestAnimationFrame call-time log, a single 100000-instruction
  // batch of that program's ellipse-draw/flip/clear loop took ~415ms of
  // REAL wall-clock time - about 25x the entire intended per-frame
  // budget - collapsing the whole app's responsiveness to ~2 rendered
  // frames/second while Running, not a bug in the user's own program or
  // in the mouse-IRQ/double-buffer C++ logic (both were re-verified
  // correct in isolation first). Fixed by making the batch size
  // self-adjusting: after every `runBatchWithBreakpoints()` call, shrink
  // `chunkSize` (down to `CHUNK_MIN`) if THAT call alone already used up
  // the frame budget, or grow it back toward `CHUNK_MAX` once calls are
  // comfortably cheap again - so a graphics-heavy program's worst-case
  // single-chunk stall stays bounded close to the intended budget instead
  // of whatever multiple of it its own per-instruction JS/canvas cost
  // happens to produce, while an ordinary compute-only program (the
  // common case for this teaching tool) keeps running at full
  // `CHUNK_MAX` throughput, completely unaffected. Reset to `CHUNK_MAX`
  // at the start of every fresh Run (see the `btnRun` handler below) - a
  // size learned "small" from one graphics-heavy program must not leak
  // into some later, unrelated compute-bound program's first few frames,
  // the same class of "reset per-run, not just once at module load" trap
  // CLAUDE.md already documents for several simulator-side globals.
  function runBatch(){
    if(!machine.running) return;
    machine.hitBreakpoint = false;
    const t0 = performance.now();
    while(!machine.halted() && !machine.hitBreakpoint && (performance.now()-t0) < FRAME_BUDGET_MS){
      const callStart = performance.now();
      machine.runBatchWithBreakpoints(chunkSize);
      const callMs = performance.now() - callStart;
      if(callMs > FRAME_BUDGET_MS){
        chunkSize = Math.max(CHUNK_MIN, Math.floor(chunkSize * (FRAME_BUDGET_MS / callMs) * 0.8));
      } else if(callMs < FRAME_BUDGET_MS/4 && chunkSize < CHUNK_MAX){
        chunkSize = Math.min(CHUNK_MAX, chunkSize * 2);
      }
    }
    const halted = machine.halted(), hitBp = machine.hitBreakpoint;
    if(halted || hitBp){
      // let followExecution switch to wherever execution actually stopped
      // BEFORE the general renderAll() below - otherwise renderAll's own
      // passive gutter/editor sync could momentarily render against
      // whatever file happened to be displayed before the switch, since it
      // has no way to know a file switch is about to happen right after it
      machine.running = false;
      followExecution();
      syncSimFileIOToVFS();
    }
    // no forced repaint here: the program's own TRAP #15 calls (task 94 for
    // double-buffered code, or the dual-draw in single-buffer mode) already
    // keep the visible canvas correct. Forcing an extra full repaint here
    // raced against that and could catch the back buffer mid-clear (a
    // black flash) - exactly the flicker this fixes.
    ui.renderAll();
    if(halted){ ui.onHalted(); showRunIcon(false); return; }
    if(hitBp){ ui.onStopped(); showRunIcon(false); return; }
    requestAnimationFrame(runBatch);
  }

  /* ---- toolbar ---- */
  /* ---- track whether the CURRENT editor content matches what was last
     successfully assembled - not whether an .S68 file merely exists,
     since that could be stale from a previous session. Any edit or file
     switch naturally invalidates this (the text just won't match). ---- */
  let assembledSnapshot = { path: null, source: null, ok: false, originalPath: null, originalSource: null };
  function isCurrentlyAssembled(){
    const curPath = currentVirtualPath || '/'+currentFileName;
    if(!assembledSnapshot.ok) return false;
    if(assembledSnapshot.path === curPath && assembledSnapshot.source === sourceEl.value) return true;
    // also matches if this is the same displayed (possibly OPT MAIN-redirecting) file/content that led to the last successful assemble
    return assembledSnapshot.originalPath === curPath && assembledSnapshot.originalSource === sourceEl.value;
  }
  /* ---- OPT MAIN directive: "OPT MAIN path/to/file.X68" as the very first
     line of a file redirects assembly to that file instead - useful when
     editing an included file and wanting to just hit Assemble without
     switching back to the actual entry point first. Resolved relative to
     the current file's directory unless given as an absolute /path.
     Web-port-only convenience directive (not real EASy68K); entirely
     intercepted here before assembly starts. See the matching no-op
     "MAIN" case in DIRECTIV.CPP's opt() for why this is still safe if a
     file containing this line is ever assembled directly. ---- */
  function resolveMainFileDirective(source, currentPath){
    const firstLine = source.split('\n',1)[0];
    const m = firstLine.match(/^\s*OPT\s+MAIN\s+(\S+)\s*$/i);
    if(!m) return null;
    let target = m[1];
    if(!target.startsWith('/')){
      const dir = currentPath.slice(0, currentPath.lastIndexOf('/')+1);
      target = dir + target;
    }
    try{
      const data = readVfsTextFile(machine.asmEngine.FS, target);
      return { path: target, source: data };
    }catch(e){
      return { path: target, source: null }; // file referenced but not found
    }
  }
  // The real assembler generates a .L68 listing and (on a clean assemble)
  // a .S68 S-record file alongside the source - machine.assemble() only
  // ever wrote these into the FIXED staging path (/src.L68, /src.S68) the
  // engine itself uses, so they never showed up anywhere in the project's
  // own virtual file tree, couldn't be viewed/edited, and Export ZIP never
  // included them. Publish them into the VFS under the real project path
  // (same directory/basename as the assembled file, .L68/.S68 extension)
  // every time, same as any other file the user creates.
  function publishAssemblerOutputsToVFS(asmPath, out){
    const base = asmPath.replace(/\.[^./]+$/, '');
    if(out.listing){
      const lstPath = base + '.L68';
      const lstBytes = new TextEncoder().encode(out.listing);
      writeToBothFS(lstPath, lstBytes);
      registerFile(lstPath, out.listing.length);
      idbSaveFile(lstPath, lstBytes);
    }
    if(out.success && out.objectCode){
      const srecPath = base + '.S68';
      const srecBytes = new TextEncoder().encode(out.objectCode);
      writeToBothFS(srecPath, srecBytes);
      registerFile(srecPath, out.objectCode.length);
      idbSaveFile(srecPath, srecBytes);
    }
    renderFileTable();
  }
  function doAssemble(){
    if(!currentVirtualPath){
      // showEmptyPaneState() (closing every open tab) deliberately leaves
      // no real file behind - assembling here would silently build
      // whatever happens to be in the (empty, read-only) textarea against
      // a made-up "/No file open" path, tracked nowhere, the exact same
      // "phantom file" shape as the Clear Browser Storage bug this was
      // found alongside. Refuse instead of pretending there's something to build.
      ui.appendLog('No file is open - open a file from the FILES panel, or create a new one, before assembling.', true);
      return false;
    }
    persistCurrentToVFS();
    stopCurrent();
    const path = currentVirtualPath || '/'+currentFileName;
    let asmSource = sourceEl.value, asmPath = path;
    const redirect = resolveMainFileDirective(sourceEl.value, path);
    if(redirect){
      if(redirect.source === null){
        ui.showErrors([{ line:1, message:`ERROR: OPT MAIN directive references '${redirect.path}', which was not found. Make sure it has been opened/uploaded.`, isWarning:false }]);
        ui.appendLog(`Assemble aborted — OPT MAIN target '${redirect.path}' not found.`, true);
        return false;
      }
      asmSource = redirect.source; asmPath = redirect.path;
      ui.appendLog(`OPT MAIN directive: assembling '${redirect.path}' instead of the current file.`);
    }
    const out = machine.assemble(asmSource, asmPath);
    penX = 0; penY = 0; // reset graphics pen position, matching the text cursor reset inside machine.assemble()
    publishAssemblerOutputsToVFS(asmPath, out);
    ui.showErrors(out.errors);
    ui.showSymbols(out.symbols);
    renderBreakpointList();
    syncEditor();
    pushHwStateToSim();
    ui.renderAll();
    assembledSnapshot = { path: asmPath, source: asmSource, ok: out.success, originalPath: path, originalSource: sourceEl.value };
    if(!out.success) ui.showAssembleErrorModal(out.errors);
    return assembledSnapshot.ok;
  }
  btnAssemble.addEventListener('click', ()=>{ if(doAssemble()) setAppMode('simulating'); });
  const btnRunIconPlay = $('#btnRunIconPlay'), btnRunIconPause = $('#btnRunIconPause');
  function showRunIcon(running){
    btnRunIconPlay.style.display = running ? 'none' : '';
    btnRunIconPause.style.display = running ? '' : 'none';
    btnRun.title = running ? 'Pause' : (appMode==='editing' ? 'Assemble and Run' : 'Resume');
  }
  function clearSimStatusDisplay(){
    document.getElementById('statusText').textContent = 'editing';
    const dot = document.getElementById('statusDot');
    if(dot) dot.className = 'dot';
    const pcEl = document.getElementById('pcVal');
    if(pcEl) pcEl.textContent = '—';
  }
  // Breakpoints only exist while simulating. Editing the source can shift
  // what a saved line number actually points to (insert a line above it,
  // and the breakpoint silently targets the wrong code), and uploading a
  // same-named file could carry over a breakpoint that makes no sense in
  // the new content. Rather than trying to track edits and re-map
  // breakpoints correctly, they're simply cleared every time editing
  // becomes possible again.
  function clearAllBreakpoints(){
    machine.breakpointsByFile.clear();
    machine.recomputeBreakpointAddrs();
    renderBreakpointList();
  }
  function setAppMode(mode){
    appMode = mode;
    const tag = document.getElementById('modeIndicator');
    if(tag){
      tag.textContent = mode==='editing' ? 'EDITING' : 'SIMULATING';
      tag.className = 'mode-indicator ' + (mode==='editing' ? 'mode-editing' : 'mode-simulating');
    }
    // The last toolbar group's caption doubles as an "Assemble"/"Simulate"
    // label for the whole cluster of assemble/run/step/reset buttons,
    // rather than a fixed "Assemble or Simulate" - reflects which of the
    // two the buttons are actually for right now.
    const asmSimLabel = document.getElementById('asmSimGroupLabel');
    if(asmSimLabel) asmSimLabel.textContent = mode==='editing' ? 'ASSEMBLE' : 'SIMULATE';
    const panesRow = document.getElementById('editorPanesRow');
    const simView = document.getElementById('simListingView');
    const isEditing = mode==='editing';
    // Editing-only controls: only make sense while there's an editable
    // file open and no simulation in progress. Upload/clear-storage
    // actions are here too - only Export ZIP should work mid-simulation.
    ['btnImportFile','btnOpen','btnUploadZipToolbar','btnNewFileToolbar','btnNewFolderToolbar','btnExport','btnCommentOut','btnCommentIn',
     'btnRemoveTrailingSpaces',
     'btnSplitEditor','btnCloseAllSplits','btnCloseCurrentTab','btnCloseOtherTabs','btnCloseAllTabs',
     'btnAssemble','btnClearStorage'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.disabled = !isEditing;
    });
    // Reset only makes sense once something has actually been assembled.
    const btnResetEl = document.getElementById('btnReset');
    if(btnResetEl) btnResetEl.disabled = isEditing;
    // Search and Play/Pause/Step/Step Over stay active in both modes -
    // Step/Step Over while editing now assemble and stop before the
    // first instruction (their own click handlers decide this).
    if(isEditing) clearAllBreakpoints();
    if(mode==='simulating'){
      panesRow.hidden = true;
      simView.hidden = false;
      renderSimListing();
    } else {
      panesRow.hidden = false;
      simView.hidden = true;
      // Returning to editing - the simulation status display (PC,
      // registers, memory, stack) is meaningless without an active
      // simulation, so there's no need to preserve it looking accurate.
      clearSimStatusDisplay();
    }
  }
  /* ---- Unified simulation listing view: a single, naturally-scrolling
     element showing address + hex bytes + source for every assembled
     line, in true assembly order across all includes - exactly what the
     real assembler's .L68 file already contains. Replaces the split
     editor panes during simulation, eliminating the whole
     gutter-synced-to-a-separate-textarea class of bug entirely, since
     there's only one element and nothing to keep in sync. ---- */
  let simListingRowsCache = null; // {rows: [...], forListing: reference to machine.listingDisplayLines}
  function renderSimListing(){
    const el = document.getElementById('simListingView');
    if(!machine.listingDisplayLines || !machine.listingDisplayLines.length){
      el.textContent = 'Nothing assembled yet.';
      simListingRowsCache = null;
      return;
    }
    const sameListing = simListingRowsCache && simListingRowsCache.forListing === machine.listingDisplayLines;
    // While actively running at full speed, the cursor should NOT chase
    // execution - it's noisy and pointless at thousands of instructions
    // per frame. Only compute/show the current line when actually paused
    // (manual pause, breakpoint hit, halted) or between individual steps.
    const pc = (!machine.running && machine.simEngine) ? (machine.getPC()>>>0) : null;
    let currentIdx = -1;
    if(pc !== null){
      // multiple listing lines can share one address (an ORG/label/comment
      // ahead of the real instruction) - only the line that actually
      // generated bytes is the true "current PC" line, matching how
      // addrToLoc itself resolves this same ambiguity
      for(let i=0;i<machine.listingDisplayLines.length;i++){
        const e = machine.listingDisplayLines[i];
        if(e.addr===pc && e.hasBytes){ currentIdx = i; break; }
      }
    }
    if(!sameListing){
      // full rebuild - only happens once per fresh assembly, not per step
      let out = '';
      for(let i=0;i<machine.listingDisplayLines.length;i++){
        const e = machine.listingDisplayLines[i];
        const bpSet = machine.getBreakpointsFor(e.file);
        const isBp = bpSet.has(e.line);
        const isCurrent = i===currentIdx;
        const cls = ['sl-line', isBp?'sl-bp':'', isCurrent?'sl-current':'', !e.hasBytes?'sl-no-code':''].filter(Boolean).join(' ');
        out += `<div class="${cls}" data-idx="${i}" data-file="${escapeHtml(e.file)}" data-line="${e.line}">`
             + `<span class="sl-addr">${hex(e.addr,6)}</span><span class="sl-bytes">${escapeHtml(e.bytes)}</span><span class="sl-text">${renderAlignedLine(e.text)}</span></div>`;
      }
      el.innerHTML = out;
      simListingRowsCache = { forListing: machine.listingDisplayLines, rows: [...el.children], currentIdx };
    } else if(simListingRowsCache.currentIdx !== currentIdx){
      // just move the current-line highlight (or clear it, if we just
      // started running) - no need to touch anything else
      const rows = simListingRowsCache.rows;
      if(simListingRowsCache.currentIdx>=0 && rows[simListingRowsCache.currentIdx]) rows[simListingRowsCache.currentIdx].classList.remove('sl-current');
      if(currentIdx>=0 && rows[currentIdx]) rows[currentIdx].classList.add('sl-current');
      simListingRowsCache.currentIdx = currentIdx;
    }
    // only auto-scroll when we actually have a paused/stepped current line
    // to show - while running, the view must stay exactly where the user
    // left it, not jump around
    if(currentIdx>=0){
      const rowEl = simListingRowsCache.rows[currentIdx];
      if(rowEl && rowEl.scrollIntoView) rowEl.scrollIntoView({block:'center'});
    }
  }
  document.getElementById('simListingView').addEventListener('click', e=>{
    const row = e.target.closest('.sl-line');
    if(!row) return;
    if(row.classList.contains('sl-no-code')) return; // not an executable line - nothing to break at
    toggleBreakpoint(row.dataset.file, parseInt(row.dataset.line, 10));
  });
  // Symbol pane: click a row to jump to wherever that symbol (a label or
  // an EQU) actually gets its value - reuses navigateToBreakpoint()'s
  // existing file-and-line-aware jump (editor in edit mode, unified
  // listing scroll+flash while simulating). machine.symbolDefLoc is built
  // heuristically during assemble() (app_part1.js) since the assembler's
  // own symbol table only gives us name+value, not a source location.
  symTableEl.querySelector('tbody').addEventListener('click', e=>{
    const row = e.target.closest('tr[data-symbol]');
    if(!row) return;
    const loc = machine.symbolDefLoc && machine.symbolDefLoc.get(row.dataset.symbol.toUpperCase());
    if(!loc){
      ui.appendLog(`Could not locate the definition line for ${row.dataset.symbol}.`);
      return;
    }
    navigateToBreakpoint(loc.file, loc.line);
  });
  btnRun.addEventListener('click', ()=>{
    if(machine.running){
      // pausing - not a "start running" action, so no assemble here
      machine.running=false; stopCurrent(); ui.onStopped(); followExecution(); ui.renderAll(); showRunIcon(false);
      syncSimFileIOToVFS();
      return;
    }
    if(appMode==='simulating' && !machine.halted()){
      // resuming from a manual pause or a breakpoint stop - continue
      // exactly where we left off. Re-assembling here would silently
      // discard all simulation state (registers, memory, PC) and restart
      // the program from scratch instead of actually resuming it.
      chunkSize = CHUNK_MAX; // fresh Run, not a leftover size from last time - see runBatch()'s own comment
      machine.running=true; ui.onRunStart(); showRunIcon(true); runBatch();
      return;
    }
    // starting fresh from editing mode, OR pressing Play again after the
    // program halted (previously did nothing at all in this case) -
    // always assemble first, guaranteeing the latest code is what runs
    if(!doAssemble()) return;
    setAppMode('simulating');
    chunkSize = CHUNK_MAX; // fresh Run, not a leftover size from last time - see runBatch()'s own comment
    machine.mode='run'; machine.running=true; ui.onRunStart(); showRunIcon(true); runBatch();
  });
  btnStep.addEventListener('click', ()=>{
    if(appMode==='editing'){ if(!doAssemble()) return; setAppMode('simulating'); return; }
    if(machine.halted()) return;
    machine.step(); followExecution(); ui.renderAll();
    ui.setEditorLocked(true);
    syncSimFileIOToVFS();
    if(machine.halted()) ui.onHalted();
  });
  btnStepOver.addEventListener('click', ()=>{
    if(appMode==='editing'){ if(!doAssemble()) return; setAppMode('simulating'); return; }
    if(machine.halted()) return;
    machine.stepOver(); followExecution(); ui.renderAll();
    ui.setEditorLocked(true);
    syncSimFileIOToVFS();
    if(machine.halted()) ui.onHalted();
  });
  // Shared by the Reset button AND the file-tree click handler below: a
  // program that halts on its own (hits a breakpoint, runs off the end,
  // dies to an unhandled exception) leaves appMode==='simulating' - only
  // clicking Reset used to actually return to editing. Clicking a
  // different, unrelated file in the tree at that point used to just
  // silently fail (see the file-tree click handler), so Run/Step then
  // kept re-running the SAME stale, already-crashed program with zero
  // indication the file never actually switched - exactly the "open
  // another file, it does not work" bug report.
  function stopSimulationReturnToEditing(){
    machine.reset();
    stopCurrent();
    penX = 0; penY = 0; // reset graphics pen position, matching the text cursor reset
    simHost.clearBlack(true); // clears both canvases directly - no repaint() needed. (machine.reset(), called just above, already resets the output RESOLUTION back to 640x480 too, via wasm_reset()'s own simIO->setWindowSize(0,0) - see wasm_api.cpp - so Reset/Stop restarting a program-requested resolution change doesn't need handling here.)
    currentExecFile = null; currentExecLine = null;
    pushHwStateToSim();
    ui.onStopped();
    setAppMode('editing');
    showRunIcon(false);
  }
  btnReset.addEventListener('click', ()=>{
    stopSimulationReturnToEditing();
    syncEditor();
    ui.renderAll();
  });
  $('#btnClearConsole').addEventListener('click', ()=>{ ui.clearConsole(); });

  /* ---- Download file — a one-time export, never a link back to disk.
     Uses showSaveFilePicker when available (Chrome/Edge: lets the user pick
     a name/location for this download) purely as a nicer file-choosing
     dialog; the handle it returns is never read from again afterwards.
     Everywhere else (Firefox/Safari) falls back to a plain Blob download. ---- */
  const btnOpen = $('#btnOpen');
  const btnExport = $('#btnExport');
  const fileNameTag = $('#fileNameTag');
  const hasFSAccess = 'showSaveFilePicker' in window;
  // currentFileName / currentFileHandle declared earlier alongside currentVirtualPath

  function setCurrentFile(name, handle){
    currentFileName = name || 'untitled.X68';
    currentFileHandle = handle || null;
    fileNameTag.textContent = currentFileName + (handle ? '' : ' (download)');
  }

  function downloadAs(filename, text){
    const blob = new Blob([text], {type:'text/plain'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Always downloads a fresh copy (a real Save-As, via the picker when
  // available) - this is the ONLY point anything in the app ever touches
  // real disk, and it's a one-shot export, not an ongoing link: nothing
  // reads currentFileHandle back later to write into it again.
  async function saveFile(){
    if(hasFSAccess){
      try{
        const handle = await window.showSaveFilePicker({
          suggestedName: currentFileName,
          types: [{ description: '68000 assembly source', accept: {'text/plain': ['.x68']} }],
        });
        const writable = await handle.createWritable();
        await writable.write(sourceEl.value);
        await writable.close();
        const file = await handle.getFile();
        setCurrentFile(file.name, handle);
        ui.appendLog(`Saved ${file.name} to disk.`);
      }catch(e){ if(e.name!=='AbortError') console.error(e); }
    } else {
      downloadAs(currentFileName, sourceEl.value);
      ui.appendLog(`Downloaded ${currentFileName} (this browser has no picker to choose a different name/location).`);
    }
  }

  $('#btnNewFileToolbar').addEventListener('click', ()=> newFile(currentTreeCreateFolder()));
  $('#btnNewFolderToolbar').addEventListener('click', ()=>{
    // newFolder() creates the folder inline in the file tree (Files tab),
    // same as the tree's own right-click "New Folder" - switch to that tab
    // first so the new inline name input is actually visible.
    const filesTabBtn = document.querySelector('.tab[data-tab="files"]');
    if(filesTabBtn) filesTabBtn.click();
    newFolder(currentTreeCreateFolder());
  });
  btnOpen.addEventListener('click', openFolder);
  // Reuses the same #fileInputMulti picker the right-click "Upload files…"
  // context-menu item already uses (a plain <input type=file multiple>) -
  // nothing about that picker forces multiple files to actually be
  // selected, so it already does exactly what a single-file import needs.
  // This just gives that same action a toolbar button of its own, since
  // burying single-file import inside a right-click menu was the actual
  // complaint (to_do.md: "add an Import file button").
  $('#btnImportFile').addEventListener('click', ()=>{ if(blockedDuringSimulation()) return; $('#fileInputMulti').click(); });
  $('#btnUploadZipToolbar').addEventListener('click', ()=>{ if(blockedDuringSimulation()) return; $('#fileInputZip').click(); });
  $('#btnExportZipToolbar').addEventListener('click', downloadAllFiles);
  btnExport.addEventListener('click', saveFile);


  /* ---- resizable panes ---- */
  const leftPane = $('.left-pane'), centerCol = $('.center-col'), rightCol = $('.right-col');
  const centerTop = $('.center-top'), centerBottom = $('.center-bottom'), mainRow = $('#mainRow');
  function makeDragger(splitEl, onDrag){
    let dragging = false, startPos = 0, startSizes = null;
    splitEl.addEventListener('mousedown', e=>{
      dragging = true; splitEl.classList.add('dragging');
      startPos = splitEl.classList.contains('splitter-v') ? e.clientX : e.clientY;
      startSizes = onDrag.getSizes();
      e.preventDefault();
    });
    window.addEventListener('mousemove', e=>{
      if(!dragging) return;
      const pos = splitEl.classList.contains('splitter-v') ? e.clientX : e.clientY;
      onDrag.apply(pos - startPos, startSizes);
    });
    window.addEventListener('mouseup', ()=>{
      if(dragging){ dragging=false; splitEl.classList.remove('dragging'); }
    });
  }
  // left pane <-> center: dragging grows/shrinks the left pane
  makeDragger($('#splitV1'), {
    getSizes(){ return { l: leftPane.getBoundingClientRect().width }; },
    apply(delta, s){ leftPane.style.flex = `0 0 ${Math.max(170, s.l + delta)}px`; },
  });
  // center <-> right: dragging grows/shrinks the right column

  // editor <-> messages: dragging grows/shrinks the messages pane
  makeDragger($('#splitH1'), {
    getSizes(){ return { b: centerBottom.getBoundingClientRect().height }; },
    apply(delta, s){ centerBottom.style.flex = `0 0 ${Math.max(70, s.b - delta)}px`; },
  });

  /* ---- hide/show the left/right/bottom panes (to_do.md: "maximize the
     editor area when working with small screens"). Each pane simply gets
     `hidden` (a real HTMLElement, unlike the SVG icon-swap case a few
     bullets up in CLAUDE.md - `.hidden` works correctly here), which drops
     it out of the flex row/column entirely so `.center-col` (flex:1 1 auto)
     naturally reflows to fill the freed space - no separate "maximize"
     layout mode needed, this IS the maximize. The associated resize
     splitter is hidden right alongside its pane (nothing left to drag
     against once the pane itself is gone, and an orphaned 5px splitter bar
     sitting next to nothing would look like a rendering glitch). Persisted
     the same way editorSettings/theme are - so a user who collapses these
     once on a small screen doesn't have to redo it every reload. ---- */
  const splitV1El = $('#splitV1'), splitH1El = $('#splitH1');
  const btnToggleLeftPane = $('#btnToggleLeftPane'), btnToggleRightPane = $('#btnToggleRightPane'), btnToggleBottomPane = $('#btnToggleBottomPane');
  let panelVisibility = { left: true, right: true, bottom: true };
  try{
    const saved = JSON.parse(localStorage.getItem('easy68k-panel-visibility')||'null');
    if(saved) panelVisibility = Object.assign(panelVisibility, saved);
  }catch(e){}
  function applyPanelVisibility(){
    leftPane.hidden = !panelVisibility.left;
    splitV1El.hidden = !panelVisibility.left;
    btnToggleLeftPane.classList.toggle('panel-off', !panelVisibility.left);
    btnToggleLeftPane.title = panelVisibility.left ? 'Hide the left panel (Explorer)' : 'Show the left panel (Explorer)';
    rightCol.hidden = !panelVisibility.right;
    btnToggleRightPane.classList.toggle('panel-off', !panelVisibility.right);
    btnToggleRightPane.title = panelVisibility.right ? 'Hide the right panel (Registers/Memory/Stack)' : 'Show the right panel (Registers/Memory/Stack)';
    centerBottom.hidden = !panelVisibility.bottom;
    splitH1El.hidden = !panelVisibility.bottom;
    btnToggleBottomPane.classList.toggle('panel-off', !panelVisibility.bottom);
    btnToggleBottomPane.title = panelVisibility.bottom ? 'Hide the bottom panel (Messages)' : 'Show the bottom panel (Messages)';
    try{ localStorage.setItem('easy68k-panel-visibility', JSON.stringify(panelVisibility)); }catch(e){}
  }
  applyPanelVisibility();
  btnToggleLeftPane.addEventListener('click', ()=>{ panelVisibility.left = !panelVisibility.left; applyPanelVisibility(); });
  btnToggleRightPane.addEventListener('click', ()=>{ panelVisibility.right = !panelVisibility.right; applyPanelVisibility(); });
  btnToggleBottomPane.addEventListener('click', ()=>{ panelVisibility.bottom = !panelVisibility.bottom; applyPanelVisibility(); });

  // The app deliberately starts with NOTHING open - no real file, and no
  // in-memory "untitled.X68" scratch buffer either. An earlier round kept
  // an editable, unregistered /untitled.X68 as a "ready to type" scratch
  // area (like most editors' "Untitled" default), reasoning that nothing
  // observable was actually created since it was never written to storage
  // unless edited - but that's still a phantom file identity the user
  // never asked for and explicitly rejected once it was pointed out
  // (to_do.md: "untitled.X68 should not be created never... the app
  // should start with NOTHING opened"). So: genuinely nothing - the same
  // read-only "No file open" placeholder shown when every tab is closed.
  // Deliberately does NOT call showEmptyPaneState() here, since that
  // helper's first step is persistCurrentToVFS() (correct when a real,
  // already-open file is being closed; meaningless and harmless-but-
  // pointless before anything has ever been open).
  currentFileName = 'No file open';
  sourceEl.value = '';
  sourceEl.readOnly = true;
  sourceEl.placeholder = 'No file open in this pane.\nOpen a file from the FILES panel on the left, or create a new one.';
  syncEditor();
  setCurrentFile('No file open', null);
  simHost.clearBlack(true); // clears both canvases directly - no repaint() needed
  renderFileTable();
  renderBreakpointList();

  window.addEventListener('beforeunload', e=>{
    // Browsers ignore custom text here for security reasons and show
    // their own generic wording, but preventDefault + returnValue is
    // still what triggers that native confirmation dialog at all.
    e.preventDefault();
    e.returnValue = 'Your files are auto-saved in this browser, but it is advised to Export ZIP before closing.';
  });

  machine.load().then(async ()=>{
    // Restoring auto-saved files must never auto-open any of them - purely
    // registers them in the file tree/filesystems, same as any other
    // import. An earlier round auto-opened the first restored name
    // (alphabetically first), which silently opened whatever happened to
    // sort first - including OS junk like .DS_Store on a restored macOS
    // folder import (to_do.md). The app now always starts on the same
    // genuine "No file open" placeholder regardless of what got restored;
    // the user opens whichever file they actually want from the tree.
    await restoreFromIndexedDB();
  }).catch(err=>{
    ui.appendLog('Failed to load engines: '+err);
    console.error(err);
  });

})();
})();
</script>
