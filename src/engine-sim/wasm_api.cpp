#include <cstdio>
#include <cstring>
#include <unordered_set>
#include <emscripten.h>
#include "extern.h"
#include "hostapi.h"
#include "hardware_stub.h"
#include "simio_stub.h"

/* ===================== EM_JS bridge (single translation unit) ===================== */

/* text screen: drawing primitives + font metrics, unified with the graphics canvas */
EM_JS(void, js_canvas_clearBlack, (int alsoVisible), { if (Module.simHost) Module.simHost.clearBlack(!!alsoVisible); });
EM_JS(void, js_canvas_fillBlackRect, (int x,int y,int w,int h,int alsoVisible), { if (Module.simHost) Module.simHost.fillBlackRect(x,y,w,h,!!alsoVisible); });
EM_JS(void, js_canvas_copyRectBack, (int dx,int dy,int sx,int sy,int w,int h), { if (Module.simHost) Module.simHost.copyRectBack(dx,dy,sx,sy,w,h); });
EM_JS(void, js_canvas_copyRectVisible, (int dx,int dy,int sx,int sy,int w,int h), { if (Module.simHost) Module.simHost.copyRectVisible(dx,dy,sx,sy,w,h); });
EM_JS(void, js_canvas_drawChar, (int x,int y,int ch,int alsoVisible), { if (Module.simHost) Module.simHost.drawChar(x,y,ch,!!alsoVisible); });
EM_JS(void, js_canvas_beep, (), { if (Module.simHost) Module.simHost.beep(); });
EM_JS(void, js_canvas_repaint, (), { if (Module.simHost) Module.simHost.repaint(); });
EM_JS(int,  js_get_rowHeight, (), { return Module.simHost ? Module.simHost.getRowHeight() : 16; });
EM_JS(int,  js_get_colWidth, (), { return Module.simHost ? Module.simHost.getColWidth() : 8; });
EM_JS(void, js_canvas_setFont, (int colorBGR,int styleBits,int sizePt,int fontId), { if (Module.simHost) Module.simHost.setFont(colorBGR>>>0,styleBits,sizePt,fontId); });
EM_JS(void, js_canvas_setWindowSize, (int w,int h), { if (Module.simHost) Module.simHost.setWindowSize(w,h); });
EM_JS(int,  js_canvas_getWidth, (), { return Module.simHost ? Module.simHost.getWidth() : 640; });
EM_JS(int,  js_canvas_getHeight, (), { return Module.simHost ? Module.simHost.getHeight() : 480; });

/* graphics primitives (pen-position tracked C++-side in SimIOStub) */
EM_JS(void, js_gfx_drawPixel, (int x, int y, int alsoVisible), { if (Module.simHost) Module.simHost.drawPixel(x,y,!!alsoVisible); });
EM_JS(int,  js_gfx_getPixel, (int x, int y), { return Module.simHost ? Module.simHost.getPixel(x,y) : 0; });
EM_JS(void, js_gfx_moveTo, (int x, int y), { if (Module.simHost) Module.simHost.moveTo(x,y); });
EM_JS(void, js_gfx_lineTo, (int x, int y, int alsoVisible), { if (Module.simHost) Module.simHost.lineTo(x,y,!!alsoVisible); });
EM_JS(void, js_gfx_line, (int x1,int y1,int x2,int y2,int alsoVisible), { if (Module.simHost) Module.simHost.line(x1,y1,x2,y2,!!alsoVisible); });
EM_JS(void, js_gfx_rect, (int x1,int y1,int x2,int y2,int filled,int alsoVisible), { if (Module.simHost) Module.simHost.rectangle(x1,y1,x2,y2,!!filled,!!alsoVisible); });
EM_JS(void, js_gfx_ellipse, (int x1,int y1,int x2,int y2,int filled,int alsoVisible), { if (Module.simHost) Module.simHost.ellipse(x1,y1,x2,y2,!!filled,!!alsoVisible); });
EM_JS(void, js_gfx_floodFill, (int x, int y, int alsoVisible), { if (Module.simHost) Module.simHost.floodFill(x,y,!!alsoVisible); });
EM_JS(void, js_gfx_drawText, (const char* s, int x, int y, int alsoVisible), { if (Module.simHost) Module.simHost.drawGfxText(UTF8ToString(s),x,y,!!alsoVisible); });
EM_JS(void, js_gfx_setDrawingMode, (int m), { if (Module.simHost) Module.simHost.setDrawingMode(m); });
EM_JS(void, js_gfx_setPenWidth, (int w), { if (Module.simHost) Module.simHost.setPenWidth(w); });
EM_JS(void, js_gfx_setLineColor, (int c), { if (Module.simHost) Module.simHost.setLineColor(c>>>0); });
EM_JS(void, js_gfx_setFillColor, (int c), { if (Module.simHost) Module.simHost.setFillColor(c>>>0); });

/* blocking-read text I/O (tasks 2, 4, 5) - synchronous prompt(), fine for a
   standalone page (not sandboxed like an embedded artifact iframe) */
EM_JS(int, js_sim_charIn, (), { return Module.simHost ? Module.simHost.charIn() : 0; });
EM_JS(void, js_sim_textIn, (char* buf, int maxLen), {
  if (!Module.simHost) { HEAPU8[buf] = 0; return; }
  const s = Module.simHost.textIn() || "";
  const bytes = new TextEncoder().encode(s.slice(0, maxLen - 1));
  HEAPU8.set(bytes, buf);
  HEAPU8[buf + bytes.length] = 0;
});

/* sound: fire-and-forget (real PlaySound with SND_ASYNC doesn't block either) */
/* keyboard: query whether a virtual-key code is currently held */
EM_JS(int, js_key_isPressed, (int vkCode), { return (Module.simHost && Module.simHost.isKeyPressed) ? (Module.simHost.isKeyPressed(vkCode)?1:0) : 0; });

EM_JS(void, js_snd_load, (const char* path, int slot), { if (Module.simHost) Module.simHost.sndLoad(UTF8ToString(path), slot); });
EM_JS(void, js_snd_loadDX, (const char* path, int slot), { if (Module.simHost) Module.simHost.sndLoad(UTF8ToString(path), slot); });
EM_JS(void, js_snd_play, (const char* path), { if (Module.simHost) Module.simHost.sndPlayFile(UTF8ToString(path)); });
EM_JS(void, js_snd_playDX, (const char* path), { if (Module.simHost) Module.simHost.sndPlayFile(UTF8ToString(path)); });
EM_JS(void, js_snd_playMem, (int slot), { if (Module.simHost) Module.simHost.sndPlaySlot(slot); });
EM_JS(void, js_snd_playMemDX, (int slot), { if (Module.simHost) Module.simHost.sndPlaySlot(slot); });
EM_JS(void, js_snd_control, (int slot, int cmd), { if (Module.simHost) Module.simHost.sndControl(slot, cmd); });
EM_JS(void, js_snd_controlDX, (int slot, int cmd), { if (Module.simHost) Module.simHost.sndControl(slot, cmd); });

/* file dialog: synchronous prompt() listing files already in the virtual FS
   (populated by the host page's upload UI before the program runs) */
EM_JS(int, js_file_dialog, (int mode, const char* title, const char* ext, char* pathInOut, int pathBufLen), {
  if (!Module.simHost) return 0;
  const t = title ? UTF8ToString(title) : "";
  const e = ext ? UTF8ToString(ext) : "";
  const cur = UTF8ToString(pathInOut);
  const picked = Module.simHost.fileDialog(mode, t, e, cur);
  if (picked === null || picked === undefined) return 0;
  const bytes = new TextEncoder().encode(String(picked).slice(0, pathBufLen - 1));
  HEAPU8.set(bytes, pathInOut);
  HEAPU8[pathInOut + bytes.length] = 0;
  return 1;
});

/* ===================== host objects, globals, callbacks ===================== */

// Passes the raw message bytes (NOT UTF8ToString(message)) - a program's own
// output text (CONSOLE_LOG family, runtime-error strings that can embed
// program-controlled data) is built out of the same CP437-single-byte-
// encoded source every other string in this simulator is (see
// encodeSourceForEngine() in app_part1.js), so an accented character is one
// raw byte >=0x80, not valid UTF-8 - UTF8ToString() would silently mangle
// it. JS-side simHost.simLog() decodes with the matching CP437 table
// instead.
EM_JS(void, js_sim_log, (const char* message, int len), {
  if (Module.simHost && Module.simHost.simLog) Module.simHost.simLog(HEAPU8.subarray(message, message + len));
});
// No longer echoes to stderr via fprintf() here - Emscripten's own stdio
// virtual device converts a flushed line to a JS string with a real UTF8
// decode before handing it to console.error, which - for exactly the same
// reason js_sim_log() above no longer uses UTF8ToString() - would throw a
// visible "Invalid UTF-8 leading byte" warning to the browser/Node console
// for any message containing a raw CP437 byte (any accented character).
// Harmless to the app (js_sim_log already delivers the real message to the
// Log panel), but confusing noise - simply not worth an extra stderr echo
// that a browser build has no real use for anyway.
void simLog(const char* message){ js_sim_log(message, (int)strlen(message)); }
void simLog(const AnsiString& message){ simLog(message.c_str()); }
EM_JS(void, js_show_hardware_window, (), { if (Module.simHost && Module.simHost.showHardwareWindow) Module.simHost.showHardwareWindow(); });
EM_JS(void, js_set_fullscreen, (int on), { if (Module.simHost && Module.simHost.setFullscreen) Module.simHost.setFullscreen(!!on); });
EM_JS(void, js_reset_sounds, (), { if (Module.simHost && Module.simHost.resetSounds) Module.simHost.resetSounds(); });

// web port: normally defined in hardwareu.cpp (excluded - see hardware_stub.h).
// Defaults mean no hardware device is mapped, no memory-map protection configured.
int seg7loc = -1, LEDloc = -1, switchLoc = -1, pbLoc = -1;
extern int g_irqMaskStackDepth;
double g_delayUntilMs = 0; // wall-clock deadline set by TRAP #15 task 23 (delay)
static std::unordered_set<uint32_t> g_breakpoints; // native breakpoint addresses - checked entirely inside WASM during a batch run, avoiding a JS<->WASM crossing per instruction
static bool g_hitBreakpoint = false;
// web port: Settings > Simulator > "EASy68K initial interrupt mask" checkbox.
// Real 68000 hardware (and real EASy68K) always resets with SR's
// interrupt-priority mask at 111 (level 7 - IRQ1-6 blocked until the
// program itself lowers it; IRQ7 is non-maskable regardless). This lets a
// course optionally start every run at mask 000 instead (every level
// admitted immediately) as a teaching convenience, without changing real
// 68000 masking semantics for anything else.
static bool g_initialMaskZero = false;
unsigned char g_keyDownCode = 0, g_keyUpCode = 0; // matches real keyDownCode/keyUpCode (simIOu.cpp), used by TRAP task 19 when D1==0
bool ROMMap = false, ReadMap = false, ProtectedMap = false, InvalidMap = false;
int ROMStart = 0, ROMEnd = 0, ReadStart = 0, ReadEnd = 0;
int ProtectedStart = 0, ProtectedEnd = 0, InvalidStart = 0, InvalidEnd = 0;

HardwareStub _hardwareInstance;
HardwareStub *Hardware = &_hardwareInstance;
LogStub _logInstance;
LogStub *Log = &_logInstance;
SimIOStub _simIOInstance;
SimIOStub *simIO = &_simIOInstance;
char SimIOStub::text[SIMIO_MAX_ROWS*SIMIO_MAX_COLS];

// charIn/textIn: real signature per CODE9.CPP is char*/buffer-out params;
// route through the blocking prompt() bridge.
void charIn_impl(char* out){ if(out) *out = (char)js_sim_charIn(); }
void textIn_impl(char* buf, long* len){
  char tmp[256];
  js_sim_textIn(tmp, 256);
  int n=0; while(tmp[n] && n<255){ if(buf) buf[n]=tmp[n]; n++; }
  if(buf) buf[n]=0;
  if(len) *len=n;
}

void SimIOStub::displayFileDialog(long* mode, long a1, long a2, long a3, short* result){
  char title[256]={0}, ext[256]={0}, path[256]={0};
  if(a1!=0){ strncpy(title, &memory[a1 & ADDRMASK], 255); }
  if(a2!=0){ strncpy(ext, &memory[a2 & ADDRMASK], 255); }
  strncpy(path, &memory[a3 & ADDRMASK], 255);
  int got = js_file_dialog((int)*mode, title, ext, path, 256);
  if(got){
    strncpy(&memory[a3 & ADDRMASK], path, 255);
    *mode = 1;
    if(result) *result = 0; // F_SUCCESS
  } else {
    *mode = 0;
    if(result) *result = 0;
  }
}

extern "C" {

void wasm_sim_init(){
  memory = new char[MEMSIZE];
  memset(memory, 0xFF, MEMSIZE); // real EASy68K erases memory to $FF at startup, not $00 (SIM68Ku.cpp)
  initSim();
  exceptions = true; // web port: real EASy68K defaults this on via GUI
                      // startup/settings-restore, which is stubbed here;
                      // without it, OLD_PC never updates and branches break.
  simhalt_on = true;  // web port: real EASy68K defaults this on too (Direct SIMHALT
                      // setting); without it, the $FFFFFFFF SIMHALT marker falls
                      // through to being treated as a reserved F-line instruction,
                      // triggering a spurious exception instead of stopping cleanly.
  keyboardEcho = true; inputPrompt = true; inputLFdisplay = true; // these default
                      // to true per the real docs, but plain bool globals without
                      // an explicit initializer zero-init to false in C++.
  simIO->recomputeTextSize();
  Hardware->syncAddrText();
  seg7loc = Hardware->seg7loc; LEDloc = Hardware->LEDloc;
  switchLoc = Hardware->switchLoc; pbLoc = Hardware->pbLoc;
}

int wasm_load_srec(const char* path){
  char buf[256];
  strncpy(buf, path, 255); buf[255] = 0;
  Hardware->bootGraceInstr = 5000;
  g_irqMaskStackDepth = 0;
  g_delayUntilMs = 0;
  irq = 0; // pending-interrupt bitmask - same singleton persistence issue: manually firing an IRQ (or an unhandled auto-IRQ) in one program left it PENDING here forever otherwise, since it's a plain global never recreated between runs. A later program that lowers its interrupt mask enough to admit that stale level then had it fire immediately - often before that program's own vector table was even installed - which is exactly the "launching YAP raises an error the first time, but not the second" symptom this was root-caused from.
  simIO->gotorc(0,0); // reset text print cursor on every program load too
  simIO->ResetSounds(); // stop playback and clear loaded sound slots - same singleton-only-inits-once issue as the cursor
  simIO->doubleBuffer = false; // real default is single-buffered (mode 16) - same singleton persistence issue: a PREVIOUS program setting mode 17 would otherwise silently carry over into this one, since simIO is never recreated between runs
  simIO->setWindowSize(0,0); // real EASy68K's own initSim() (STARTSIM.CPP) does this too - "reset output window size" - but only ever runs once at module load here, same singleton-persistence issue as doubleBuffer/irq/etc above: a PREVIOUS program calling TRAP #15 task 91 to resize the output window otherwise left it at that resolution for every LATER program too, even one that never touches window size at all (to_do.md: "when the simulator restarts... the output window should restart to 640x480 resolution too"). setWindowSize(0,0) clamps to the real default 640x480 (see simio_stub.h) and also clears both canvases via the same JS bridge clearBlack(true) already uses.
  keyboardEcho = true; inputPrompt = true; inputLFdisplay = true; // restored by Reset/Reload per the real docs (tasks 12, 16)
  stopInstruction = false; // one-shot latch (RUN.CPP) guarding the "STOP instruction. Execution halted" log message - same singleton persistence issue: once true, no LATER program's own STOP would ever log that message again
  trace = false; sstep = false; // debug/logging flags - exceptionHandler()'s SSP-invalid-stack guard (RUN.CPP) sets trace=true without an accompanying halt=true, so a program that manages to corrupt its own supervisor stack could otherwise leave every subsequent program's every instruction being (silently, since there's no log viewer for it in this port) traced forever
  mouseDownIRQ = mouseUpIRQ = mouseMoveIRQ = 0; keyDownIRQ = keyUpIRQ = 0; // same singleton persistence issue, only ever zeroed by initSim() (called once at module load, not per-run): a program that once called TRAP #15 task 60/62 to arm a mouse/keyboard IRQ level left it armed FOREVER for every later program too, since wasm_mouse_move/wasm_key_down (called from the real JS mouse/keyboard listeners on every actual browser event, completely independent of which program is loaded) unconditionally re-fire Hardware->IRQprocess() at that stale level. Confirmed reproducible: a later, totally unrelated program with no mouse/keyboard code of its own at all gets an out-of-nowhere "Hardware interrupt occurred, but no interrupt handler is installed for that level" the instant the user's mouse merely passes over the output canvas - looking like it was caused by whatever instruction happened to be executing at that moment, when the real cause is a much earlier program's leftover IRQ arming.
  memset(memory, 0xFF, MEMSIZE); // real EASy68K erases to $FF on every program load (SIM68Ku.cpp OpenFile), not just at startup
  int result = loadSrec(buf);
  // OLD_PC is only ever updated AFTER an instruction executes, priming it
  // for the NEXT one - so the very first instruction ever run has no valid
  // OLD_PC (it stays at its -1 default from initSim()), breaking any
  // branch/call relying on it (BSR/Bcc with a word-sized displacement use
  // "PC = OLD_PC + displacement + 2"). Prime it here to the real start
  // address so the first instruction behaves the same as every other one.
  OLD_PC = PC;
  return result;
}

int wasm_step(){
  exec_inst();
  Hardware->tickAlways();
  return halt ? 1 : 0;
}

// Executes up to maxSteps instructions in a single WASM call (no per-
// instruction JS<->WASM boundary crossing), stopping early if halted.
// Returns the number of instructions actually executed.
int wasm_run_batch(int maxSteps){
  int n = 0;
  if (g_delayUntilMs > 0) {
    if (emscripten_get_now() < g_delayUntilMs) return 0; // still waiting out a TRAP #15 task-23 delay
    g_delayUntilMs = 0;
  }
  while(!halt && n < maxSteps){
    exec_inst();
    Hardware->tick();
    n++;
    if (g_delayUntilMs > 0) break; // a delay was just requested mid-batch - stop here, resume later
  }
  return n;
}

int wasm_get_halt(){ return halt ? 1 : 0; }

// Replace the full breakpoint set from a flat array of addresses written
// into the WASM heap by JS (see wasm_get_breakpoints_buffer for the
// pointer). Called once whenever the breakpoint list actually changes,
// not per instruction.
void wasm_set_breakpoints(const uint32_t* addrs, int count){
  g_breakpoints.clear();
  for(int i=0;i<count;i++) g_breakpoints.insert(addrs[i]);
}
int wasm_get_hit_breakpoint(){ return g_hitBreakpoint ? 1 : 0; }

// Executes up to maxSteps instructions in a single WASM call, exactly
// like wasm_run_batch, but also checks the current PC against the native
// breakpoint set after every instruction - entirely inside WASM. This
// means having breakpoints set (even ones never actually reached) no
// longer forces execution down a slow per-instruction JS loop; the only
// per-instruction cost is a native unordered_set lookup, and JS is only
// re-entered once per batch (or immediately if a breakpoint fires).
int wasm_run_batch_native_bp(int maxSteps){
  int n = 0;
  g_hitBreakpoint = false;
  if (g_delayUntilMs > 0) {
    if (emscripten_get_now() < g_delayUntilMs) return 0;
    g_delayUntilMs = 0;
  }
  while(!halt && n < maxSteps){
    exec_inst();
    Hardware->tick();
    n++;
    if (g_delayUntilMs > 0) break;
    if (g_breakpoints.count((uint32_t)PC)){ g_hitBreakpoint = true; break; }
  }
  return n;
}
int wasm_get_irq(){ return irq; }
long wasm_get_d(int i){ return (i>=0 && i<D_REGS) ? D[i] : 0; }
long wasm_get_a(int i){ return (i>=0 && i<A_REGS) ? A[i] : 0; }
long wasm_get_active_a7(){ return A[a_reg(7)]; } // whichever A7 (USP or SSP) a running program actually sees right now
long wasm_get_usp(){ return A[7]; }
long wasm_get_ssp(){ return A[8]; }
long wasm_get_pc(){ return PC; }
int wasm_get_sr(){ return SR; }
void wasm_set_d(int i, long v){ if(i>=0 && i<D_REGS) D[i]=v; }
void wasm_set_a(int i, long v){ if(i>=0 && i<A_REGS) A[i]=v; }
void wasm_set_active_a7(long v){ A[a_reg(7)]=v; }
void wasm_set_pc(long v){ PC=v; }
void wasm_set_sr(int v){ SR=(short)v; }

unsigned char wasm_read_byte(unsigned int addr){ return (unsigned char)memory[addr & ADDRMASK]; }
void wasm_write_byte(unsigned int addr, unsigned char v){ memory[addr & ADDRMASK] = (char)v; }
int wasm_get_inst(){ return inst; }
long wasm_get_old_pc(){ return OLD_PC; }

void wasm_reset(){
  memset(memory, 0xFF, MEMSIZE); // matches real EASy68K's $FF erase, not $00
  for(int i=0;i<D_REGS;i++) D[i]=0;
  for(int i=0;i<A_REGS;i++) A[i]=0;
  A[7] = 0x00FF0000; // user stack - matches real initSim() in STARTSIM.CPP
  A[8] = 0x01000000; // supervisor stack - matches real initSim() in STARTSIM.CPP
  PC = 0; SR = g_initialMaskZero ? 0x2000 : 0x2700; halt = false;
  OLD_PC = -1;
  exceptions = true;
  for(int l=1;l<=7;l++) Hardware->autoIrq[l].enabled = false;
  Hardware->bootGraceInstr = 5000;
  g_irqMaskStackDepth = 0;
  g_delayUntilMs = 0;
  irq = 0; // pending-interrupt bitmask - see wasm_load_srec() for why this must be reset here too
  simIO->gotorc(0,0); // reset text print cursor - persists otherwise, since simIO is a singleton
  simIO->ResetSounds(); // stop playback and clear loaded sound slots - same singleton-only-inits-once issue
  simIO->doubleBuffer = false; // real default is single-buffered (mode 16) - same singleton persistence issue
  simIO->setWindowSize(0,0); // see wasm_load_srec() for why this must be reset here too - clamps to the real default 640x480
  keyboardEcho = true; inputPrompt = true; inputLFdisplay = true; // restored by Reset/Reload per the real docs (tasks 12, 16)
  stopInstruction = false; // see wasm_load_srec() for why this must be reset here too
  trace = false; sstep = false; // see wasm_load_srec() for why these must be reset here too
  mouseDownIRQ = mouseUpIRQ = mouseMoveIRQ = 0; keyDownIRQ = keyUpIRQ = 0; // see wasm_load_srec() for why this must be reset here too
}

/* ---- mouse / keyboard IRQ wiring (called from JS canvas/page event listeners) ---- */

void wasm_mouse_move(int x, int y){
  mouseX=x; mouseY=y;
  if(mouseMoveIRQ) Hardware->IRQprocess(mouseMoveIRQ);
}
void wasm_mouse_down(int x, int y, int button){
  mouseXDown=x; mouseYDown=y;
  mouseLeftDown = (button==0); mouseRightDown=(button==2); mouseMiddleDown=(button==1);
  mouseX=x; mouseY=y;
  mouseLeft = (button==0); mouseRight=(button==2); mouseMiddle=(button==1);
  if(mouseDownIRQ) Hardware->IRQprocess(mouseDownIRQ);
}
void wasm_mouse_up(int x, int y, int button){
  mouseXUp=x; mouseYUp=y;
  mouseLeftUp = (button==0); mouseRightUp=(button==2); mouseMiddleUp=(button==1);
  mouseX=x; mouseY=y;
  mouseLeft = false; mouseRight = false; mouseMiddle = false;
  if(mouseUpIRQ) Hardware->IRQprocess(mouseUpIRQ);
}
void wasm_key_modifiers(int shift, int alt, int ctrl){
  keyShift=!!shift; keyAlt=!!alt; keyCtrl=!!ctrl;
}
// vkCode: the actual virtual-key code (matches JS's event.keyCode, which
// aligns with Windows VK_* codes for arrows/space/letters - exactly what
// real EASy68K programs check against via TRAP #15 task 19).
void wasm_key_down(int vkCode, int shift,int alt,int ctrl){
  keyShiftDown=!!shift; keyAltDown=!!alt; keyCtrlDown=!!ctrl;
  keyShift=!!shift; keyAlt=!!alt; keyCtrl=!!ctrl;
  g_keyDownCode = (unsigned char)vkCode;
  if(keyDownIRQ) Hardware->IRQprocess(keyDownIRQ);
}
void wasm_key_up(int vkCode, int shift,int alt,int ctrl){
  keyShiftUp=!!shift; keyAltUp=!!alt; keyCtrlUp=!!ctrl;
  g_keyUpCode = (unsigned char)vkCode;
  if(keyUpIRQ) Hardware->IRQprocess(keyUpIRQ);
}

/* ---- hardware window: 7-segment display, LEDs, switches, push buttons ---- */
void wasm_hw_set_addrs(unsigned int seg7, unsigned int led, unsigned int sw, unsigned int pb){
  Hardware->seg7loc = seg7; Hardware->LEDloc = led;
  Hardware->switchLoc = sw; Hardware->pbLoc = pb;
  Hardware->syncAddrText();
  // memoryMapCheck() (UTILS.CPP) reads these globals - not Hardware-> - to
  // recognize hardware addresses as always-accessible; keep them in sync.
  seg7loc = seg7; LEDloc = led; switchLoc = sw; pbLoc = pb;
}
unsigned int wasm_hw_get_seg7loc(){ return Hardware->seg7loc; }
unsigned int wasm_hw_get_ledloc(){ return Hardware->LEDloc; }
unsigned int wasm_hw_get_switchloc(){ return Hardware->switchLoc; }
unsigned int wasm_hw_get_pbloc(){ return Hardware->pbLoc; }
// One-shot manual trigger (the Hardware window's "Interrupt" pushbuttons)
void wasm_hw_manual_irq(int level){ Hardware->IRQprocess(level); }
// Per-level auto-interval configuration (the Hardware window's "Auto
// Interval" dropdown + checkbox per interrupt button) - the SAME
// underlying state a running program sets via TRAP #15 task 32.6 (e.g. a
// game's own screen-refresh timer), not a separate independent one - see
// HardwareStub::setAutoIRQ in hardware_stub.h. Whichever side (the UI or
// the program) touched it last wins, so either can read back the other's
// setting via the getters below - that's what lets the Hardware window
// reflect a program-enabled timer interrupt, and lets a program observe
// the UI unchecking one it enabled.
void wasm_hw_set_auto(int level, int enabled, int periodMs){
  Hardware->setAutoIRQLevel(level, !!enabled, periodMs);
}
int wasm_hw_get_auto_enabled(int level){
  return (level>=1 && level<=7) ? (Hardware->autoIrq[level].enabled ? 1 : 0) : 0;
}
int wasm_hw_get_auto_period(int level){
  return (level>=1 && level<=7) ? (int)Hardware->autoIrq[level].periodMs : 0;
}

// Settings > Simulator > "EASy68K initial interrupt mask" checkbox - see
// g_initialMaskZero above. Takes effect on the NEXT wasm_reset() (i.e. the
// next Assemble or Reset), not retroactively on whatever's currently loaded.
void wasm_set_initial_mask_zero(int v){ g_initialMaskZero = !!v; }

}
