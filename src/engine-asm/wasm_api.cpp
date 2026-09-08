#include <cstdio>
#include <cstring>
#include "asm.h"

extern bool listFlag, objFlag, WARflag, MEXflag, CREflag, SEXflag;
extern int errorCount, warningCount;
extern unsigned int startAddress;

/* --- error collection: reportError() is called by ERROR.CPP's printError()
   for every error/warning line; we capture them here instead of printing to
   stderr, so JS can read back a structured list. --- */
#define MAX_CAPTURED_ERRORS 2000
static int g_errLine[MAX_CAPTURED_ERRORS];
static char g_errMsg[MAX_CAPTURED_ERRORS][256];
static int g_errCount = 0;

void reportError(int lineNum, const char* message){
  if(g_errCount < MAX_CAPTURED_ERRORS){
    g_errLine[g_errCount] = lineNum;
    strncpy(g_errMsg[g_errCount], message, 255);
    g_errMsg[g_errCount][255] = '\0';
    g_errCount++;
  }
}

/* --- symbol table: SYMBOL.CPP keeps its own hash table (26 buckets, linked
   lists) as a file-local global; we walk it after assembly into a flat list
   the JS side can page through by index. --- */
#define SYM_MAXHASH 26
extern symbolDef *htable[SYM_MAXHASH+1];

#define MAX_EXPORTED_SYMBOLS 4000
/* symbolDef::name lives in a buffer owned by the symbolDef node itself
   (asm.h), which clearSymbols() deletes right after this snapshot runs
   (see the call site in ASSEMBLE.CPP). Copy the characters out here rather
   than storing s->name's address, or every entry becomes a dangling
   pointer into freed memory by the time JS reads it back. */
static char g_symName[MAX_EXPORTED_SYMBOLS][SIGCHARS+1];
static int g_symValue[MAX_EXPORTED_SYMBOLS];
static int g_symFlags[MAX_EXPORTED_SYMBOLS];
static int g_symCount = 0;

void onBeforeClearSymbols(){
  g_symCount = 0;
  for(int h=0; h<=SYM_MAXHASH; h++){
    for(symbolDef* s = htable[h]; s != nullptr && g_symCount < MAX_EXPORTED_SYMBOLS; s = s->next){
      strncpy(g_symName[g_symCount], s->name, SIGCHARS);
      g_symName[g_symCount][SIGCHARS] = '\0';
      g_symValue[g_symCount] = s->value;
      g_symFlags[g_symCount] = s->flags;
      g_symCount++;
    }
  }
}

extern char mainSourceFile[256];

extern "C" {

// Tells the assembler the main file's real project path (e.g.
// "/proj/sub/MAIN.X68"), even though it's actually staged at the fixed
// "/src.X68" for wasm_assemble() below. INCLUDE/INCBIN use this purely to
// resolve relative filenames against the referencing file's own
// directory (DIRECTIV.CPP's resolveRelativePath()) - it does not need to
// exist at this path in the virtual FS. Call before wasm_assemble().
void wasm_set_main_path(const char* path){
  strncpy(mainSourceFile, path, sizeof(mainSourceFile)-1);
  mainSourceFile[sizeof(mainSourceFile)-1] = '\0';
}

// Assembles /src.X68 (written into the Emscripten virtual FS by the caller
// beforehand) and writes /src.L68 (listing) + /src.S68 (S-Record object).
// Returns errorCount (>=0) on a completed assembly, -1 if assembleFile
// itself aborted (e.g. couldn't open the source file).
int wasm_assemble(){
  g_errCount = 0;
  g_symCount = 0;
  listFlag = true;
  objFlag = true;
  WARflag = true;
  // web port: the WASM engine instance persists across repeated Assemble
  // clicks in this SPA (unlike the original, which started a fresh process
  // each run), so OPT-set flags must be explicitly reset here or a source
  // file with "OPT MEX"/"OPT CRE"/"OPT SEX" leaves that setting stuck for
  // every later assembly in the session, even after the OPT line is
  // removed or a different file is assembled.
  MEXflag = false;
  CREflag = false;
  SEXflag = false;
  char fileName[] = "/src.X68";
  char tempName[] = "/tmp.tmp";
  AnsiString workName("/src");
  int result = assembleFile(fileName, tempName, workName);
  return result==NORMAL ? errorCount : -1;
}

int wasm_get_error_count(){ return g_errCount; }
int wasm_get_error_line(int i){ return (i>=0 && i<g_errCount) ? g_errLine[i] : 0; }
const char* wasm_get_error_message(int i){ return (i>=0 && i<g_errCount) ? g_errMsg[i] : ""; }

int wasm_get_warning_count(){ return warningCount; }
unsigned int wasm_get_start_address(){ return startAddress; }

int wasm_get_symbol_count(){ return g_symCount; }
const char* wasm_get_symbol_name(int i){ return (i>=0 && i<g_symCount) ? g_symName[i] : ""; }
int wasm_get_symbol_value(int i){ return (i>=0 && i<g_symCount) ? g_symValue[i] : 0; }
int wasm_get_symbol_flags(int i){ return (i>=0 && i<g_symCount) ? g_symFlags[i] : 0; }

}

