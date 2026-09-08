#include <cstdio>
#include "extern.h"

extern "C" {
  void wasm_sim_init();
  int wasm_load_srec(const char*);
  int wasm_step();
  int wasm_get_halt();
  long wasm_get_d(int);
  long wasm_get_pc();
}

int main(){
  wasm_sim_init();

  // Real .S68 produced by the actual assembler engine (Stage 2) for:
  //   ORG $1000
  //   START: MOVEQ #5,D3
  //   LOOP:  ADDQ.L #7,D0
  //          SUBQ.W #1,D3
  //          BNE LOOP
  //          MOVE.B #9,D0
  //          TRAP #15
  //          END START
  const char* srec =
    "S021000036384B50524F47202020323043524541544544204259204541535936384B6D\n"
    "S111100076055E80534366FA103C00094E4F9D\n"
    "S804001000EB\n";
  FILE* f = fopen("/tmp/test.S68","w");
  fputs(srec, f);
  fclose(f);

  int r = wasm_load_srec("/tmp/test.S68");
  printf("loadSrec returned %d, PC=$%lX\n", r, wasm_get_pc());

  int guard = 0;
  long peakD0 = 0;
  while(!wasm_get_halt() && guard < 1000){
    if(wasm_get_pc()==0x1008) peakD0 = wasm_get_d(0); // right after the loop, before MOVE.B #9,D0
    wasm_step();
    guard++;
  }
  printf("halted after %d instructions\n", guard);
  printf("D0 after loop = %ld (expect 35)\n", peakD0);
  return 0;
}
