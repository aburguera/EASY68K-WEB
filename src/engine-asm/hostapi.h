#ifndef HOSTAPI_H
#define HOSTAPI_H
/* Callback the engine uses to report an error/warning to whatever host UI
   is attached (in the browser, this will be an emscripten EM_JS/EM_ASM hook;
   for now, a default implementation prints to stderr so the engine is
   independently testable from the command line). */
void reportError(int lineNum, const char* message);
void onBeforeClearSymbols();
#endif
