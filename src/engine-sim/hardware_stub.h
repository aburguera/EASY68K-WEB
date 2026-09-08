#ifndef HARDWARE_STUB_H
#define HARDWARE_STUB_H
#include "compat_vcl.h"
#include <emscripten.h>
#include <cstdio>

/* Real hardware window: 8-digit 7-segment display, 8 LEDs, 8 toggle
   switches, 8 push buttons, all memory-mapped at user-configurable
   addresses (default from the real EASy68K docs: 7-seg at $E00000,
   two bytes per digit). Values are queried by real programs via
   TRAP #15 task 32 subtasks 1/2/3/7 (which read these EditText-style
   fields as hex strings, matching the original Borland UI's approach -
   kept as-is so CODE9.CPP's real dispatch code needs no changes). */
struct HardwareCheckStub { bool Checked = false; };
struct HardwareEditStub {
  AnsiString EditText = "0";
  void setHex(unsigned int v){ char buf[16]; sprintf(buf, "%X", v); EditText = buf; }
};
extern int irq; // defined in var.h; RUN.CPP's exec_inst() already checks this each step

extern "C" void js_show_hardware_window();

struct HardwareStub {
  bool hardwareEnabled = true;
  int bootGraceInstr = 0; // instructions since load/reset before any IRQ may fire

  void IRQprocess(int irqN){ if(irqN>0) irq |= (0x01 << (irqN-1)); }

  /* ---- auto-interrupt timers: one independent slot per IRQ level 1-7.
     Both TRAP #15 task 32.6 (a running program requesting auto-refresh,
     e.g. a game's screen-timer) and the hardware window's own per-button
     "Auto Interval" UI use the SAME mechanism - they just target whichever
     level they ask for, so both can coexist. ---- */
  struct AutoIrq { bool enabled=false; double periodMs=0, lastFire=0; long instrSinceLastFire=0; };
  AutoIrq autoIrq[8]; // index 1-7 used (level 0 unused, matches real IRQ numbering)
  static const long MIN_INSTR_BETWEEN_FIRES = 200; // debounce: even once wall-clock time says "overdue", require this many real instructions since the last fire before firing again - stops an interrupt from re-triggering on literally the next single-step click after a long human pause between clicks (which would otherwise trap execution inside the handler forever)

  void setAutoIRQLevel(int level, bool enabled, double periodMs){
    if(level<1||level>7) return;
    autoIrq[level].enabled = enabled;
    autoIrq[level].periodMs = periodMs>0 ? periodMs : 1;
    autoIrq[level].lastFire = emscripten_get_now();
    autoIrq[level].instrSinceLastFire = 0;
  }
  // real signature: setAutoIRQ(mask, periodMs) where mask bit7=enable, bits0-6=IRQ number (used by TRAP task 32.6)
  void setAutoIRQ(unsigned char mask, int periodMs){
    int level = mask & 0x7F;
    setAutoIRQLevel(level, (mask & 0x80) != 0, periodMs);
  }
  void checkFireLevel(int level){
    AutoIrq& a = autoIrq[level];
    if(!a.enabled || bootGraceInstr>0) return;
    if(a.instrSinceLastFire < MIN_INSTR_BETWEEN_FIRES) return;
    double now = emscripten_get_now();
    if(now - a.lastFire >= a.periodMs){
      a.lastFire = now;
      a.instrSinceLastFire = 0;
      IRQprocess(level);
    }
  }
  int tickCounter = 0;
  // throttled: for the batch/Run loop, where checking every single
  // instruction would reintroduce per-instruction JS-boundary overhead
  void tick(){
    if(bootGraceInstr > 0) bootGraceInstr--;
    bool any=false;
    for(int l=1;l<=7;l++) if(autoIrq[l].enabled){ any=true; autoIrq[l].instrSinceLastFire++; }
    if(!any) return;
    if(++tickCounter < 512) return;
    tickCounter = 0;
    for(int l=1;l<=7;l++) checkFireLevel(l);
  }
  // unthrottled: for the Step button - real elapsed time is what makes a
  // wait-for-interrupt loop actually unblock across step clicks, matching
  // real wall-clock hardware between debugger pauses; the instruction-count
  // debounce above is what stops it re-firing on literally every click.
  void tickAlways(){
    if(bootGraceInstr > 0) bootGraceInstr--;
    for(int l=1;l<=7;l++){
      if(!autoIrq[l].enabled) continue;
      autoIrq[l].instrSinceLastFire++;
      checkFireLevel(l);
    }
  }

  /* ---- memory-mapped device addresses (real default: 7-seg at $E00000,
     one word per digit; LED/switch/pushbutton placed contiguously after
     it - not explicitly documented for those three but this keeps them
     inside the same natural hardware region). Queried by real programs
     via TRAP #15 task 32 subtasks 1/2/3/7, which read these fields as hex
     text - same mechanism the original Borland UI used, so CODE9.CPP's
     real dispatch code works unchanged. ---- */
  HardwareEditStub _seg7addr, _ledaddr, _switchaddr, _pbaddr;
  HardwareEditStub *seg7addr = &_seg7addr;
  HardwareEditStub *LEDaddr = &_ledaddr;
  HardwareEditStub *switchAddr = &_switchaddr;
  HardwareEditStub *pbAddr = &_pbaddr;
  unsigned int seg7loc = 0xE00000, LEDloc = 0xE00010, switchLoc = 0xE00012, pbLoc = 0xE00014;
  void syncAddrText(){
    seg7addr->setHex(seg7loc); LEDaddr->setHex(LEDloc);
    switchAddr->setHex(switchLoc); pbAddr->setHex(pbLoc);
  }

  void disable(){}
  void Show(){ js_show_hardware_window(); }
  void autoIRQoff(){}
  void enable(){}

  // web port: memory-map protection config, formerly synced to GUI
  // checkboxes here; real enforcement reads mapROM/mapRead/mapProtected/
  // mapInvalid directly (see memoryMapCheck() in UTILS.CPP), so these are
  // display-only in the original and safe to stub.
  HardwareCheckStub _chk;
  HardwareEditStub _edit;
  HardwareCheckStub *ROMChk = &_chk, *ReadChk = &_chk, *ProtectedChk = &_chk, *InvalidChk = &_chk;
  HardwareEditStub *ROMStartEdit = &_edit, *ROMEndEdit = &_edit, *ReadStartEdit = &_edit, *ReadEndEdit = &_edit,
                   *ProtectedStartEdit = &_edit, *ProtectedEndEdit = &_edit, *InvalidStartEdit = &_edit, *InvalidEndEdit = &_edit;
};
extern HardwareStub *Hardware;

struct LogStub { void stopLogWithAnnounce(){} };
extern LogStub *Log;

#endif
