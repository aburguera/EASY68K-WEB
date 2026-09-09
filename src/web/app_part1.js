<script>
(function(){
"use strict";

function hex(n, width){
  n = (n>>>0);
  let s = n.toString(16).toUpperCase();
  while(s.length < width) s = '0'+s;
  return s;
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function rgbFromEasyColor(c){
  c = c>>>0;
  return `rgb(${c&0xFF},${(c>>>8)&0xFF},${(c>>>16)&0xFF})`; // $00BBGGRR
}
/* =========================================================================
   SOURCE -> ASSEMBLER BYTE ENCODING
   ========================================================================= */
// The embedded output-window bitmap font ("moderndos-8x16", see simHost's
// own comment in app_part2.js) is laid out in classic CP437 (DOS OEM-US
// codepage) order, index 128-255 = accented Latin letters and box-drawing
// glyphs at their traditional CP437 byte positions - NOT Unicode/Latin-1
// order. Emscripten's FS.writeFile(path, jsString) real-UTF8-encodes any
// JS string handed to it (confirmed empirically: 'É' -> two bytes, C3 89),
// so a DC.B string literal typed with an accented character used to
// assemble into TWO separate garbage bytes instead of the one the
// programmer meant - each looked up independently in the CP437 font,
// producing two wrong/garbled glyphs on screen instead of one correct
// accented one (this is what made accented characters look broken - not a
// font coverage gap, an encoding mismatch upstream of the font entirely).
// This table maps the accented Unicode codepoints CP437 actually has a
// glyph for back to their real CP437 byte value, so encodeSourceForEngine()
// below can emit exactly the single byte the assembler (and, later, the
// bitmap font) expects - the same "one glyph typed = one glyph shown"
// behavior the real, Windows-hosted EASy68K has (there, via the OS's own
// ANSI codepage + a real TrueType font with full glyph coverage; here, via
// this explicit table matched to the one embedded bitmap font).
//
// IMPORTANT (found investigating to_do.md's "capital Í doesn't print
// properly" report): bytes 128-175 below genuinely ARE real IBM CP437
// (CP437 and the more Latin-friendly CP850 agree on that whole block - the
// common lowercase accented Spanish letters, plus capital É at 144,
// are correct and DO match the embedded bitmap font). But bytes 176-255 in
// an EARLIER version of this table were transcribed from CP850 (DOS
// "Multilingual/Latin-1"), which crams in extra capital accented letters -
// Á Â À Ê Ë È Í Î Ï Ì Ó Ô Ò Ú Û Ù Ý ã Ã õ Õ ð Ð þ Þ ı ý - where real CP437
// instead has box-drawing (┤╣║╗...) and Greek/math (α ß Γ π...) glyphs at those
// SAME byte positions. Confirmed by literally decoding the embedded
// FONT_B64 bitmap pixel-by-pixel: byte 0xD6 (214, where the old table
// claimed "Í") renders as a box-drawing glyph (╓), not a letter at all -
// so encoding 'Í' to that byte and later looking it up in the REAL font
// silently drew an unrelated glyph instead of failing loudly. This went
// unnoticed because 128-175 (the block covering common lowercase accented
// Spanish letters plus capital É, which real CP437 does include) is by
// far the most-exercised part of the table, and the earlier "É
// round-trips correctly" verification never happened to test one of the
// CP850-only positions above 175. Real, unmodified IBM CP437 - confirmed
// both from the standard published table AND by decoding this exact
// embedded font - simply has NO capital Á, Í, Ó, or Ú at all (É at 144 is
// the only capital accented Latin letter CP437 defines); 176-255 below is
// now the genuine CP437 box-drawing/Greek/math block, matching what the
// font actually draws.
//
// DELIBERATE DEVIATION (user's explicit choice - this is a Spanish-
// language EASy68K teaching tool, and "?" for a student's own accented
// name was judged worse than a small authenticity compromise): 4 of the
// genuinely-real-but-rarely-needed-in-a-68000-assembly-course CP437 Greek
// letters are repurposed here to actually draw the 4 missing capital
// Spanish vowels instead of falling back to '?' - byte 226 (was Γ) now
// draws Á, byte 231 (was τ) now draws Ú, byte 232 (was Φ) now draws Ó,
// byte 233 (was Θ) now draws Í. The corresponding 4 glyph cells in
// FONT_B64 (app_part2.js) were hand-built to match: the same 3-row accent
// stroke É already uses at rows 0-2, over each base capital letter's own
// existing A/I/O/U glyph shape COMPRESSED by one row (not shifted down -
// an earlier version of this fix shifted the whole letter down a row
// instead, which left it sitting one pixel below the baseline every other
// character, including É itself, shares; see the FONT_B64 comment in
// app_part2.js for the fix and the general "compress, don't shift"
// construction rule to follow for any future synthetic glyph). Any
// OTHER unsupported character (Â À Ê Ë È Î Ï Ì Ô Ò Û Ù Ý ã Ã õ Õ ð Ð þ Þ
// ı ý, and any genuinely non-CP437 script) still correctly falls back to
// '?' via encodeSourceForEngine()'s existing fallback - only these 4
// specific letters got a synthetic glyph. If a program deliberately draws
// byte 226/231/232/233 expecting the original Greek letter (vanishingly
// unlikely in an intro 68000 course), it will now see the wrong glyph -
// an accepted, explicitly chosen tradeoff, not an oversight.
const CP437_UPPER = // byte 128 (0x80) through 255 (0xFF), in order
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»"+
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧"+
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀"+
  "αßÁπΣσµÚÓÍΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const CP437_ENCODE_MAP = (function(){
  const m = new Map();
  for(let i=0;i<CP437_UPPER.length;i++){
    const ch = CP437_UPPER[i];
    if(!m.has(ch)) m.set(ch, 128+i); // first (accented-letter) occurrence wins over a later duplicate/box-drawing entry
  }
  return m;
})();
// Encodes a JS source string into the single-byte-per-character form the
// assembler/bitmap font expect: plain ASCII (and any byte already <0x80)
// passes through unchanged; a Unicode character the CP437 table above has
// a real glyph for becomes that one CP437 byte; anything else (Unicode text
// with no CP437 equivalent at all - Cyrillic, CJK, emoji, ...) falls back
// to '?', matching how a real single-byte ANSI codepage would clip
// something outside its own repertoire rather than corrupting it into
// multiple bytes/lines. Scoped to the file actually being assembled (see
// Machine.assemble()) - not applied to the general project file tree/
// editor round-trip, which must stay real UTF-8 or reopening a saved file
// would show corrupted text instead of what was typed.
function encodeSourceForEngine(text){
  const out = new Uint8Array(text.length);
  for(let i=0;i<text.length;i++){
    const code = text.charCodeAt(i);
    if(code < 128){ out[i] = code; continue; }
    const mapped = CP437_ENCODE_MAP.get(text[i]);
    out[i] = (mapped !== undefined) ? mapped : 0x3F; // '?'
  }
  return out;
}
// Reverses encodeSourceForEngine(): given raw bytes that originated from
// engine-side text built out of the encoded source above (the assembler's
// own .L68 listing, which echoes source lines verbatim; a program's TRAP
// #15 console-log/file-I/O output, whose string content in memory is
// exactly the CP437 bytes the source was encoded to) - NOT plain
// Emscripten UTF8ToString()/FS 'utf8'-encoding reads, which assume the
// bytes are already valid UTF-8 and mis-decode any byte >=0x80 into
// mangled/replacement characters instead of the accented character it
// actually represents. Every byte 0-255 maps back losslessly to a single
// character (ASCII passes through as-is; 128-255 is a straight positional
// lookup into the same CP437_UPPER table encodeSourceForEngine encodes
// into), so decode(encode(x)) round-trips correctly for anything the
// editor could have typed in the first place.
function decodeEngineBytes(bytes){
  let out = '';
  for(let i=0;i<bytes.length;i++){
    const b = bytes[i];
    out += (b < 128) ? String.fromCharCode(b) : CP437_UPPER[b-128];
  }
  return out;
}
// Emscripten's FS.readFile(path, {encoding:'utf8'}) decodes via
// UTF8ArrayToString() called with no length limit, which treats the buffer
// as a NUL-terminated C string - silently dropping the first embedded NUL
// byte and everything after it (see the matching, fuller comment on
// readVfsTextFile() in app_part2.js, which this mirrors - the two files
// are separate closures, so this can't just call that one directly). A
// project's own source text won't normally contain a raw NUL byte, but
// this is the same bug class regardless of how unlikely any one call site
// is to hit it - read the real bytes and decode without truncation.
function readVfsTextFileLocal(FS, path){
  const bytes = FS.readFile(path, {encoding:'binary'});
  return new TextDecoder('utf-8').decode(bytes);
}
const FONT_MAP = {
  1: "'Fixedsys', monospace", 2: "'Courier', monospace", 3: "'Courier New', monospace",
  4: "'Lucida Console', monospace", 5: "'Lucida Sans Typewriter', monospace",
  6: "'Consolas', monospace", 7: "'Terminal', monospace",
};

/* =========================================================================
   SYNTAX HIGHLIGHTING — matches the real default colors from asm.h:
   DEFAULT_CODE_COLOR=clBlack, DEFAULT_COMMENT_COLOR=clBlue,
   DEFAULT_DIRECTIVE_COLOR=clGreen, DEFAULT_LABEL_COLOR=clPurple,
   DEFAULT_STRUCTURE_COLOR=clMaroon, DEFAULT_TEXT_COLOR=clTeal (strings)
   ========================================================================= */
const DIRECTIVES = new Set(['ORG','EQU','SET','DC','DS','END','INCLUDE','MACRO','ENDM','OPT','REG','FAIL','LIST','NOLIST']);
const STRUCTURE = new Set(['IF','THEN','ELSE','ENDIF','ENDC','WHILE','ENDW','REPEAT','UNTIL','FOR','ENDF','DBLOOP','ENDDBLOOP','DO']);

/* Splits a source line into its four logical fields - TAG, INSTRUCTION,
   PARAMS, COMMENT - any of which may be absent. String-aware (a ';'
   inside a quoted string is not a comment start). Used to re-render lines
   in consistent, fixed columns regardless of the original source's
   spacing, which can vary wildly line to line in real code. */
function parseLineFields(line){
  if(!line.trim()) return {tag:'', instr:'', params:'', comment:''};
  if(/^\s*\*/.test(line)) return {tag:'', instr:'', params:'', comment: line.trim()}; // full-line "*" comment
  let i = 0;
  const n = line.length;
  let tag = '';
  if(line[0] && !/\s/.test(line[0]) && line[0] !== ';'){
    let j = 0;
    while(j < n && !/\s/.test(line[j])) j++;
    tag = line.slice(0, j);
    i = j;
  }
  while(i < n && /\s/.test(line[i])) i++;
  if(i < n && line[i] === ';') return {tag, instr:'', params:'', comment: line.slice(i)};
  let instr = '';
  if(i < n){
    let j = i;
    while(j < n && !/\s/.test(line[j])) j++;
    instr = line.slice(i, j);
    i = j;
  }
  while(i < n && /\s/.test(line[i])) i++;
  let paramsEnd = i;
  while(paramsEnd < n){
    const ch = line[paramsEnd];
    if(ch === "'"){
      paramsEnd++;
      while(paramsEnd < n && line[paramsEnd] !== "'") paramsEnd++;
      if(paramsEnd < n) paramsEnd++;
      continue;
    }
    if(ch === ';') break;
    paramsEnd++;
  }
  const params = line.slice(i, paramsEnd).trimEnd();
  const comment = line.slice(paramsEnd);
  return {tag, instr, params, comment};
}
function highlightParamsAware(text){
  // Colors string literals within an operand list; everything else is
  // plain code color. Simpler than the full highlightLine tokenizer since
  // there's no label-at-line-start ambiguity to resolve here.
  let out = '';
  let i = 0;
  const n = text.length;
  while(i < n){
    if(text[i] === "'"){
      let j = i+1;
      while(j < n && text[j] !== "'") j++;
      if(j < n) j++;
      out += `<span class="tok-string">${escapeHtml(text.slice(i,j))}</span>`;
      i = j;
    } else {
      let j = i;
      while(j < n && text[j] !== "'") j++;
      out += escapeHtml(text.slice(i,j));
      i = j;
    }
  }
  return out;
}
const SL_TAG_COL = 14, SL_INSTR_COL = 8;
function renderAlignedLine(text){
  const {tag, instr, params, comment} = parseLineFields(text);
  if(!tag && !instr && !params && !comment) return '&nbsp;';
  if(!tag && !instr && !params && comment) return `<span class="tok-comment">${escapeHtml(comment)}</span>`;
  let out = '';
  out += tag ? `<span class="tok-label">${escapeHtml(tag)}</span>${' '.repeat(Math.max(1,SL_TAG_COL-tag.length))}` : ' '.repeat(SL_TAG_COL);
  if(instr){
    const bare = instr.replace(/\.[BWLbwl]$/,'').toUpperCase();
    const cls = DIRECTIVES.has(bare) ? 'tok-directive' : STRUCTURE.has(bare) ? 'tok-structure' : 'tok-code';
    out += `<span class="${cls}">${escapeHtml(instr)}</span>`;
    if(params || comment) out += ' '.repeat(Math.max(1,SL_INSTR_COL-instr.length));
  } else if(params || comment){
    out += ' '.repeat(SL_INSTR_COL);
  }
  if(params) out += highlightParamsAware(params) + (comment ? '  ' : '');
  if(comment) out += `<span class="tok-comment">${escapeHtml(comment)}</span>`;
  return out;
}

function highlightLine(line){
  if(/^\*/.test(line)) return `<span class="tok-comment">${escapeHtml(line)}</span>`;
  let out = '';
  let i = 0;
  const n = line.length;
  let atLineStart = true;
  while(i < n){
    const ch = line[i];
    if(ch === ';'){
      out += `<span class="tok-comment">${escapeHtml(line.slice(i))}</span>`;
      break;
    }
    if(ch === "'"){
      let j = i+1;
      while(j < n && line[j] !== "'") j++;
      if(j < n) j++;
      out += `<span class="tok-string">${escapeHtml(line.slice(i,j))}</span>`;
      i = j; atLineStart = false;
      continue;
    }
    if(/\s/.test(ch)){ out += ch; i++; continue; }
    let j = i;
    while(j < n && !/[\s;']/.test(line[j])) j++;
    const word = line.slice(i,j);
    const bare = word.replace(/\.[BWLbwl]$/,'').toUpperCase();
    if(atLineStart && !/^\s/.test(line) && i===0){
      out += `<span class="tok-label">${escapeHtml(word)}</span>`;
    } else if(DIRECTIVES.has(bare)){
      out += `<span class="tok-directive">${escapeHtml(word)}</span>`;
    } else if(STRUCTURE.has(bare)){
      out += `<span class="tok-structure">${escapeHtml(word)}</span>`;
    } else {
      out += `<span class="tok-code">${escapeHtml(word)}</span>`;
    }
    atLineStart = false;
    i = j;
  }
  return out || '&nbsp;';
}

const DEFAULT_SOURCE =
`; =============================================================================
; TITLE   :
; AUTHOR  :
; HISTORY :
; =============================================================================
            ORG     $1000
START
            SIMHALT

            END     START`;

/* =========================================================================
   MACHINE — wraps both real WASM engines
   ========================================================================= */
class Machine{
  constructor(ui){
    this.ui = ui;
    this.asmEngine = null;
    this.simEngine = null;
    this.mode = 'idle';
    this.running = false;
    this.instrCount = 0;
    this.symbols = [];
    this._lastObjectCode = '';
    this.breakpointAddrs = new Set(); // active addresses, computed from ALL files' breakpoints combined
    this.breakpointsByFile = new Map(); // path -> Set of local line numbers
    this.addrToLoc = new Map();
    this.locToAddr = new Map();
  }

  async load(){
    this.asmEngine = await EASy68KModule();
    this.simEngine = await EASy68KSimModule();
    this.simEngine.simHost = this.ui.simHost;
    window.__suppressOutputAutoShow = true;
    this.simEngine.ccall('wasm_sim_init', null, [], []);
    window.__suppressOutputAutoShow = false;
    this._runBatchFn = this.simEngine.cwrap('wasm_run_batch', 'number', ['number']);
    this.ui.onEnginesLoaded();
  }

  // Executes up to maxSteps instructions in a single native WASM call (no
  // per-instruction JS<->WASM boundary crossing - roughly 2x the throughput
  // of calling step() in a JS loop, and the only way real programs like a
  // full game reach a usable instructions/frame rate).
  runBatch(maxSteps){
    const n = this._runBatchFn(maxSteps);
    this.instrCount += n;
    return n;
  }

  assemble(source, mainPath){
    this.currentFilePath = mainPath || '/MAIN.X68';
    this.asmEngine.FS.writeFile('/src.X68', encodeSourceForEngine(source));
    try{ this.asmEngine.FS.unlink('/src.L68'); }catch(e){}
    try{ this.asmEngine.FS.unlink('/src.S68'); }catch(e){}
    // The engine always reads/writes the fixed /src.X68 staging path above,
    // but INCLUDE/INCBIN inside it must resolve relative filenames against
    // this file's REAL project directory (which may be several sub-folders
    // deep) - tell it separately so a nested-folder project's sibling
    // INCLUDEs resolve correctly. See wasm_set_main_path in wasm_api.cpp.
    this.asmEngine.ccall('wasm_set_main_path', null, ['string'], [this.currentFilePath]);
    // The SIMULATOR's own TRAP #15 file I/O (tasks 50-59, SIMOPS2.CPP) is
    // real, unmodified code that just calls fopen(fname,...) - there's no
    // custom relative-path resolver to hook into the way DIRECTIV.CPP's
    // INCLUDE/INCBIN handling has. A bare relative filename (no leading
    // "/") therefore resolves through Emscripten's own libc/FS layer
    // against whatever the MEMFS's current working directory happens to
    // be - which defaults to "/" and, unlike INCLUDE, was never pointed
    // at the running program's own folder. A real desktop EASy68K almost
    // certainly runs with its process's CWD set to wherever the opened
    // .X68 file lives, so a project that keeps its data files in a
    // subfolder next to the main file (e.g. `OPEN "ASSETS/LEVEL.BTM"`
    // from `src/MAIN.X68`) works there but silently failed to open here -
    // to_do.md: a real game's title-screen image never appeared because
    // its own bare-relative BTM asset path resolved against the
    // filesystem root instead of its `src/` folder. Fixed by pointing the
    // simulator engine's OWN MEMFS cwd at the main file's real directory
    // too, via Emscripten's real FS.chdir() - this needs no C++ change at
    // all, since plain fopen() already respects the FS layer's cwd for a
    // relative path. Set once per Assemble (mirrors wasm_set_main_path
    // above), not per Run/Reset - like a real process's CWD, it shouldn't
    // reset just because the program restarts.
    try{
      const mainDir = this.currentFilePath.replace(/\/[^/]*$/, '') || '/';
      this.simEngine.FS.chdir(mainDir);
    }catch(e){}
    const result = this.asmEngine.ccall('wasm_assemble', 'number', [], []);
    const errorCount = this.asmEngine.ccall('wasm_get_error_count', 'number', [], []);
    const errors = [];
    for(let i=0;i<errorCount;i++){
      const message = this.asmEngine.ccall('wasm_get_error_message','string',['number'],[i]);
      errors.push({
        line: this.asmEngine.ccall('wasm_get_error_line','number',['number'],[i]),
        message,
        isWarning: /^WARNING:/i.test(message),
      });
    }
    const hardErrorCount = errors.filter(e=>!e.isWarning).length;
    const symCount = this.asmEngine.ccall('wasm_get_symbol_count','number',[],[]);
    const symbols = [];
    for(let i=0;i<symCount;i++){
      symbols.push({
        name: this.asmEngine.ccall('wasm_get_symbol_name','string',['number'],[i]),
        value: this.asmEngine.ccall('wasm_get_symbol_value','number',['number'],[i])>>>0,
      });
    }
    symbols.sort((a,b)=>a.name.localeCompare(b.name));
    this.symbols = symbols;

    let listing='', objectCode='';
    // The listing echoes source lines verbatim, which - since /src.X68 was
    // written via encodeSourceForEngine() above - means any accented
    // character is a single raw CP437 byte (>=0x80) in the .L68 file, not
    // valid UTF-8. Reading it with {encoding:'utf8'} (Emscripten's own
    // UTF8ArrayToString) would treat those bytes as malformed UTF-8 and
    // mangle them - read as raw bytes instead and decode with the matching
    // CP437 table so accented characters round-trip correctly into the
    // listing/simulation view.
    try{ listing = decodeEngineBytes(this.asmEngine.FS.readFile('/src.L68',{encoding:'binary'})); }catch(e){}
    try{ objectCode = this.asmEngine.FS.readFile('/src.S68',{encoding:'utf8'}); }catch(e){} // pure ASCII hex S-record text - never contains a CP437 byte, plain utf8 read is safe

    // Real listing format: "AAAAAAAA  HHHH HHHH   GLOBALLINE   SOURCE".
    // Critically, that line number is a single count across the WHOLE
    // compiled output - it does NOT reset for each INCLUDEd file - but the
    // editor shows each file's own local line numbers. So breakpoints and
    // current-line highlighting need a map keyed by (file, localLine), not
    // just the raw listing line number, built by tracking which file is
    // "current" as INCLUDE boundaries are crossed (the listing marks the
    // end of each include with a literal "-------------------- end
    // include --------------------" line; the start is inferred from the
    // INCLUDE directive's own source text).
    this.addrToLoc = new Map();      // address -> {file, line}
    this.locToAddr = new Map();      // "file\x00line" -> address
    this.locHasCode = new Set();     // "file\x00line" for lines that actually generated bytes (not comments/labels/directives)
    this.listingDisplayLines = [];   // ordered {addr, bytes, file, line, text, hasBytes} for the unified simulation listing view
    // name.toUpperCase() -> {file, line} of the line that actually DEFINES
    // that symbol (a label, or an EQU), for the symbol pane's "jump to
    // definition" feature. The assembler's own symbol table only gives us
    // name+value, not a source location, so this is found heuristically
    // below: the first listing line whose first whitespace-delimited
    // token (colon stripped) matches a known symbol name exactly.
    // Local labels (source form ".LOOP", scoped between two global labels -
    // see EASy68K's real local-label rules) are a special case: SYMBOL.CPP's
    // lookup() mangles them into "GLOBAL:LOCAL" (leading '.' replaced with
    // ':', the enclosing global label's name prepended) before they ever
    // reach the symbol table, so `symbols` here only ever contains that
    // mangled form, never the bare ".LOOP" the listing actually shows on
    // the defining line - a plain equality check against the listing's
    // first token (as done for ordinary global labels below) can never
    // match a local label's mangled name, which is exactly why the symbol
    // pane's "jump to definition" previously did nothing for them. Fixed
    // by tracking the most recent GLOBAL label seen while scanning (same
    // "last global label wins" rule the assembler itself uses) and
    // reconstructing the same GLOBAL:LOCAL mangled key for any line whose
    // first token starts with '.', mirroring lookup()'s own mangling
    // exactly rather than guessing at a display format.
    this.symbolDefLoc = new Map();
    const symbolNamesUpper = new Set(symbols.map(s=>s.name.toUpperCase()));
    const globalSymbolNamesUpper = new Set([...symbolNamesUpper].filter(n=>!n.includes(':')));
    let lastGlobalLabel = '';
    // Capture group 2 separately so we can tell whether this listing line
    // actually generated code (has hex bytes) vs. is a directive/label/
    // comment line that merely SHOWS the address the next real instruction
    // will occupy. Multiple lines commonly share one address (e.g. an ORG,
    // a comment, and a label can all show the same address as the real
    // instruction that follows them) - when they do, the line with real
    // bytes is the only correct one for "this address IS this line",
    // The bytes field can be truncated with "..." for an overlong byte
    // list (DC.W/DC.B with many values) in two different ways observed in
    // real listings: a complete hex group followed by a separate "..."
    // token, or a partial hex value directly followed by 1-3 dots with no
    // space. Both must be matched explicitly as part of the bytes group
    // itself - otherwise the regex has no way to consume "..." and must
    // backtrack into what looks like a plausible hex byte value,
    // misreading it as the line number and corrupting the line entirely
    // (confirmed: this happened with long DC.B string tables).
    // Real listing format after the line number is either two literal
    // spaces ("%6d  %s", ordinary line), OR - for a line that's inside a
    // macro expansion or structured-code expansion (LISTING.CPP's
    // lineIdent[] mechanism, one 'm' per macro nesting level plus a
    // trailing 's' for structured code called from a macro) - the ident
    // letters immediately follow the digits with no space, then exactly
    // one space before the source text ("%6d%s %s"). Both the macro
    // call line itself and every expanded body line use this second
    // form, so without matching it here, macro expansions (and OPT MEX)
    // are invisible in the LST view even though the engine assembled and
    // listed them correctly.
    const listingLineRe = /^([0-9A-Fa-f]{8})\s*=?\s*((?:[0-9A-Fa-f]{2,8}\s+|[0-9A-Fa-f]{1,8}\.{1,3}\s+|\.{1,3}\s+)*)(\d+)(?:[ms]+ |  )(.*)$/;
    const equRe = /^\S*\s+EQU\b/i;
    const includeRe = /INCLUDE\s+['"]([^'"]+)['"]/i;
    const fileStack = [{ path: this.currentFilePath, local: 0 }];
    const fileSourceLines = new Map(); // path -> actual source lines (from the VFS), for content-matching
    const fileSearchPos = new Map();   // path -> how far into that file's lines we've already matched
    const localCounters = new Map();   // path -> fallback blind counter, used only if content-matching fails
    const addrHasBytes = new Map(); // addr -> whether the recorded loc came from a bytes-line
    const getSourceLines = (path) => {
      if(fileSourceLines.has(path)) return fileSourceLines.get(path);
      let lines = null;
      try{ lines = readVfsTextFileLocal(this.asmEngine.FS, path).split('\n').map(l=>l.replace(/\r$/,'')); }
      catch(e){ lines = null; }
      fileSourceLines.set(path, lines);
      return lines;
    };
    // Finds the actual 1-indexed source line number for a listing entry's
    // echoed text, by searching forward (from wherever we last matched)
    // for a line whose trimmed content agrees. Falls back to a simple
    // increment if the source can't be read or no match is found nearby,
    // so a rare mismatch degrades gracefully instead of breaking entirely.
    const resolveLocalLine = (path, text) => {
      const lines = getSourceLines(path);
      const fallback = () => { const n=(localCounters.get(path)||0)+1; localCounters.set(path,n); return n; };
      if(!lines) return fallback();
      const trimmedTarget = text.trim();
      let pos = fileSearchPos.get(path) || 0;
      const searchLimit = Math.min(lines.length, pos + 500); // bounded search - a real match is always close by
      for(let i=pos; i<searchLimit; i++){
        if(lines[i].trim() === trimmedTarget){
          fileSearchPos.set(path, i+1);
          localCounters.set(path, i+1);
          return i+1;
        }
      }
      return fallback();
    };
    for(const l of listing.split('\n')){
      // Check the RAW line first, unconditionally - a truncated data line
      // must never be allowed to hide the end-include marker and
      // permanently desync the file-context stack for everything after it.
      if(/-{5,}\s*end include\s*-{5,}/i.test(l)){
        if(fileStack.length>1) fileStack.pop();
        continue;
      }
      const m = listingLineRe.exec(l);
      if(!m) continue;
      const addr = parseInt(m[1],16), text = m[4];
      const bytesPart = m[2].trim();
      const hasBytes = bytesPart.length>0 && !equRe.test(text);
      const top = fileStack[fileStack.length-1];
      const nextLocal = resolveLocalLine(top.path, text);
      const key = top.path+'\x00'+nextLocal;
      if(!this.addrToLoc.has(addr) || (hasBytes && !addrHasBytes.get(addr))){
        this.addrToLoc.set(addr, {file: top.path, line: nextLocal});
        addrHasBytes.set(addr, hasBytes);
      }
      if(!this.locToAddr.has(key)) this.locToAddr.set(key, addr);
      if(hasBytes) this.locHasCode.add(key);
      this.listingDisplayLines.push({ addr, bytes: bytesPart, file: top.path, line: nextLocal, text, hasBytes });
      if(symbolNamesUpper.size){
        const trimmed = text.trim();
        if(trimmed && trimmed[0]!==';'){
          const firstToken = trimmed.split(/\s+/)[0].replace(/:$/,'').toUpperCase();
          if(firstToken[0]==='.'){
            // Local label definition line - reconstruct the same
            // GLOBAL:LOCAL mangled name SYMBOL.CPP's lookup() gives it.
            const mangledKey = lastGlobalLabel + ':' + firstToken.slice(1);
            if(symbolNamesUpper.has(mangledKey) && !this.symbolDefLoc.has(mangledKey)){
              this.symbolDefLoc.set(mangledKey, {file: top.path, line: nextLocal});
            }
          } else {
            if(symbolNamesUpper.has(firstToken) && !this.symbolDefLoc.has(firstToken)){
              this.symbolDefLoc.set(firstToken, {file: top.path, line: nextLocal});
            }
            // Track the most recent GLOBAL label regardless of whether this
            // is its first-seen definition line, so local labels appearing
            // after a re-encountered/duplicate line still resolve correctly.
            if(globalSymbolNamesUpper.has(firstToken)) lastGlobalLabel = firstToken;
          }
        }
      }
      const incM = includeRe.exec(text);
      if(incM){
        let incPath = incM[1].replace(/\\/g,'/');
        if(!incPath.startsWith('/')) incPath = '/'+incPath;
        fileStack.push({ path: incPath, local: 0 });
      }
    }

    const success = result>=0 && hardErrorCount===0;
    if(success){
      this.simEngine.ccall('wasm_reset', null, [], []);
      // Reset both canvases to black directly (not via repaint(), which is
      // task 94's explicit-flip semantics and unconditionally auto-opens
      // the output window) - a fresh assemble must NOT force the window
      // open by itself; it should stay closed until the program actually
      // draws or prints something. (wasm_reset() itself now also resets
      // the output RESOLUTION back to 640x480 via simIO->setWindowSize(0,0)
      // - see wasm_api.cpp - which already clears both canvases through
      // the same JS bridge this call uses; this explicit call is harmless,
      // redundant belt-and-suspenders, kept for clarity at this call site.)
      this.ui.simHost.clearBlack(true);
      this._lastObjectCode = objectCode;
      this.simEngine.FS.writeFile('/prog.S68', objectCode);
      const loadResult = this.simEngine.ccall('wasm_load_srec','number',['string'],['/prog.S68']);
      this.instrCount = 0;
      this.mode = 'idle';
      this.recomputeBreakpointAddrs();
      this.ui.setAssembled(loadResult===0);
      this.ui.appendLog(`Assembled OK — entry at $${hex(this.asmEngine.ccall('wasm_get_start_address','number',[],[]),4)}, loaded into the simulator.`);
    } else {
      this.ui.setAssembled(false);
    }
    return {success, errors, listing, objectCode, symbols};
  }

  step(){
    if(this.simEngine.ccall('wasm_get_halt','number',[],[])) return;
    this.simEngine.ccall('wasm_step', null, [], []);
    this.instrCount++;
  }
  // Step Over: if the current instruction is a subroutine call (JSR/BSR),
  // run until it returns instead of stepping into it - the same technique
  // real debuggers use: execute the call, read the return address the call
  // just pushed onto the stack, then run (with a temporary breakpoint)
  // until PC reaches it or the program halts.
  stepOver(maxInstr){
    if(this.halted()) return;
    const pc = this.getPC();
    const w0 = (this.readByte(pc)<<8) | this.readByte(pc+1);
    const isJSR = (w0 & 0xFFC0) === 0x4E80;
    const isBSR = (w0 & 0xFF00) === 0x6100;
    if(!isJSR && !isBSR){ this.step(); return; }
    this.step(); // executes the call; return address is now on the stack
    if(this.halted()) return;
    const supervisorMode = (this.getSR() & 0x2000) !== 0;
    const sp = (supervisorMode ? this.getA(8) : this.getA(7)) >>> 0;
    const retAddr = ((this.readByte(sp)<<24)|(this.readByte(sp+1)<<16)|(this.readByte(sp+2)<<8)|this.readByte(sp+3)) >>> 0;
    let guard = 0;
    const cap = maxInstr || 2000000;
    while(!this.halted() && this.getPC()>>>0 !== retAddr && guard<cap){
      this.step();
      guard++;
    }
  }
  recomputeBreakpointAddrs(){
    this.breakpointAddrs.clear();
    for(const [path, lines] of this.breakpointsByFile){
      for(const line of lines){
        const key = path+'\x00'+line;
        if(this.locToAddr.has(key)) this.breakpointAddrs.add(this.locToAddr.get(key));
      }
    }
    this.syncBreakpointsToNative();
  }
  // Write the current breakpoint address set into WASM heap memory and
  // hand it to the native side, so wasm_run_batch_native_bp can check
  // breakpoints entirely inside WASM without crossing back to JS per
  // instruction. Only called when the breakpoint list actually changes,
  // not per instruction or per batch.
  syncBreakpointsToNative(){
    if(!this.simEngine || !this.simEngine._malloc) return;
    const addrs = [...this.breakpointAddrs];
    const count = addrs.length;
    if(count === 0){ this.simEngine.ccall('wasm_set_breakpoints','number',['number','number'],[0,0]); return; }
    const bytesNeeded = count*4;
    const ptr = this.simEngine._malloc(bytesNeeded);
    try{
      this.simEngine.HEAPU32.set(addrs, ptr>>>2);
      this.simEngine.ccall('wasm_set_breakpoints','number',['number','number'],[ptr,count]);
    } finally {
      this.simEngine._free(ptr);
    }
  }
  getBreakpointsFor(path){
    if(!this.breakpointsByFile.has(path)) this.breakpointsByFile.set(path, new Set());
    return this.breakpointsByFile.get(path);
  }
  // Runs a full native batch, checking breakpoints entirely inside WASM -
  // no per-instruction JS<->WASM crossing regardless of whether any
  // breakpoints are set, and regardless of whether they're ever reached.
  // Falls back to the old per-instruction JS loop only if this build's
  // native breakpoint support isn't available (e.g. an older cached
  // engine binary), so this degrades gracefully rather than breaking.
  runBatchWithBreakpoints(maxSteps){
    if(!this.simEngine._wasm_run_batch_native_bp){
      // fallback path for an engine build without native breakpoint support
      if(this.breakpointAddrs.size === 0) return this.runBatch(maxSteps);
      let n = 0;
      while(n < maxSteps && !this.halted()){
        this.step();
        n++;
        if(this.breakpointAddrs.has(this.getPC()>>>0)){ this.hitBreakpoint = true; break; }
      }
      this.instrCount += n;
      return n;
    }
    const n = this.simEngine.ccall('wasm_run_batch_native_bp','number',['number'],[maxSteps]);
    this.instrCount += n;
    if(this.simEngine.ccall('wasm_get_hit_breakpoint','number',[],[])) this.hitBreakpoint = true;
    return n;
  }
  halted(){ return !!this.simEngine.ccall('wasm_get_halt','number',[],[]); }
  reset(){
    this.simEngine.ccall('wasm_reset', null, [], []);
    if(this._lastObjectCode){
      this.simEngine.FS.writeFile('/prog.S68', this._lastObjectCode);
      this.simEngine.ccall('wasm_load_srec','number',['string'],['/prog.S68']);
    }
    this.instrCount = 0;
    this.mode = 'idle';
    this.running = false;
  }
  getD(i){ return this.simEngine.ccall('wasm_get_d','number',['number'],[i])|0; }
  getA(i){ return this.simEngine.ccall('wasm_get_a','number',['number'],[i])|0; }
  getActiveA7(){ return this.simEngine.ccall('wasm_get_active_a7','number',[],[])|0; } // whichever A7 a running program actually sees right now
  getUSP(){ return this.simEngine.ccall('wasm_get_usp','number',[],[])|0; }
  getSSP(){ return this.simEngine.ccall('wasm_get_ssp','number',[],[])|0; }
  getPC(){ return this.simEngine.ccall('wasm_get_pc','number',[],[])>>>0; }
  getSR(){ return this.simEngine.ccall('wasm_get_sr','number',[],[])&0xFFFF; }
  readByte(addr){ return this.simEngine.ccall('wasm_read_byte','number',['number'],[addr])&0xFF; }
  writeByte(addr,val){ this.simEngine.ccall('wasm_write_byte',null,['number','number'],[addr,val&0xFF]); }
  setD(i,v){ this.simEngine.ccall('wasm_set_d',null,['number','number'],[i,v|0]); }
  setA(i,v){ this.simEngine.ccall('wasm_set_a',null,['number','number'],[i,v|0]); }
  setUSP(v){ this.simEngine.ccall('wasm_set_a',null,['number','number'],[7,v|0]); }
  setSSP(v){ this.simEngine.ccall('wasm_set_a',null,['number','number'],[8,v|0]); }
  // Settings > Simulator > "EASy68K initial interrupt mask" checkbox - takes
  // effect on the next wasm_reset() (next Assemble or Reset), not retroactively.
  setInitialMaskZero(v){ this.simEngine.ccall('wasm_set_initial_mask_zero',null,['number'],[v?1:0]); }
  setActiveA7(v){ this.simEngine.ccall('wasm_set_active_a7',null,['number'],[v|0]); }
  setPC(v){ this.simEngine.ccall('wasm_set_pc',null,['number'],[v|0]); }
  setSR(v){ this.simEngine.ccall('wasm_set_sr',null,['number'],[v&0xFFFF]); }
}
