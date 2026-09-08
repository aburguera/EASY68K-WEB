#ifndef SIMIO_STUB_H
#define SIMIO_STUB_H
#include <cstdlib>
#include "compat_vcl.h"
#include "hostapi.h"
extern "C" void js_set_fullscreen(int on);
extern "C" void js_reset_sounds();

/* web port, phase 3: matches the REAL simIOu.cpp dual-canvas semantics,
   verified directly against the source. Every primitive ALWAYS draws to
   the hidden back buffer; when NOT double-buffered (mode 16, the default),
   it ALSO draws the identical primitive directly to the VISIBLE canvas -
   two cheap draws, not a costly image-data copy or full-canvas blit. Only
   the explicit "flip" (TRAP task 94 / FormPaint) does a full back->visible
   blit, matching real Canvas->Draw(0,0,BackBuffer). */
const int SIMIO_MAX_ROWS = 128, SIMIO_MAX_COLS = 256;

extern "C" {
void js_canvas_clearBlack(int alsoVisible);
void js_canvas_fillBlackRect(int x, int y, int w, int h, int alsoVisible);
void js_canvas_copyRectBack(int destX, int destY, int srcX, int srcY, int w, int h);
void js_canvas_copyRectVisible(int destX, int destY, int srcX, int srcY, int w, int h);
void js_canvas_drawChar(int x, int y, int ch, int alsoVisible);
void js_canvas_beep();
void js_canvas_repaint(); // explicit full flip: back -> visible (task 94)
int  js_get_rowHeight();
int  js_get_colWidth();
void js_canvas_setFont(int colorBGR, int styleBits, int sizePt, int fontId);
void js_canvas_setWindowSize(int w, int h);
int  js_canvas_getWidth();
int  js_canvas_getHeight();

void js_gfx_drawPixel(int x, int y, int alsoVisible);
int  js_gfx_getPixel(int x, int y);
void js_gfx_moveTo(int x, int y);
void js_gfx_lineTo(int x, int y, int alsoVisible);
void js_gfx_line(int x1,int y1,int x2,int y2,int alsoVisible);
void js_gfx_rect(int x1,int y1,int x2,int y2,int filled,int alsoVisible);
void js_gfx_ellipse(int x1,int y1,int x2,int y2,int filled,int alsoVisible);
void js_gfx_floodFill(int x, int y, int alsoVisible);
void js_gfx_drawText(const char* s, int x, int y, int alsoVisible);
void js_gfx_setDrawingMode(int m);
void js_gfx_setPenWidth(int w);
void js_gfx_setLineColor(int c);
void js_gfx_setFillColor(int c);

/* sound (fire-and-forget; Web Audio decode is async under the hood) */
void js_snd_load(const char* path, int slot);
void js_snd_loadDX(const char* path, int slot);
void js_snd_play(const char* path);
void js_snd_playDX(const char* path);
void js_snd_playMem(int slot);
void js_snd_playMemDX(int slot);
void js_snd_control(int slot, int cmd);
void js_snd_controlDX(int slot, int cmd);

/* file dialog (synchronous prompt-based approximation) */
int js_file_dialog(int mode, const char* title, const char* ext, char* pathInOut, int pathBufLen);
void charIn_impl(char* out);
void textIn_impl(char* buf, long* len);
int js_key_isPressed(int vkCode);
}

extern unsigned char g_keyDownCode, g_keyUpCode; // matches real keyDownCode/keyUpCode; C++ linkage, defined in wasm_api.cpp

struct SimIOStub {
  bool fullScreen = false;
  int row=0, col=0;
  int textX=0, textY=0;
  int rowHeight=16, colWidth=8;
  int textRows=30, textCols=80;
  int canWidth=640, canHeight=480;
  bool textWrap=false; // real original default (simIOu.cpp: `bool textWrap = false;`) - nothing in the real
                        // source ever calls setTextWrap(true), so text that runs past the right edge is simply
                        // clipped by the canvas, not wrapped onto the next row
  bool doubleBuffer=false; // real default: single-buffered (mode 16)
  int penX=0, penY=0;
  static char text[SIMIO_MAX_ROWS*SIMIO_MAX_COLS];

  SimIOStub(){ for(int i=0;i<SIMIO_MAX_ROWS*SIMIO_MAX_COLS;i++) text[i]=' '; recomputeTextSize(); }

  int alsoVisible() const { return doubleBuffer ? 0 : 1; }

  void recomputeTextSize(){
    rowHeight = js_get_rowHeight();
    colWidth = js_get_colWidth();
    if(rowHeight<1) rowHeight=16;
    if(colWidth<1) colWidth=8;
    textRows = canHeight/rowHeight; if(textRows>SIMIO_MAX_ROWS) textRows=SIMIO_MAX_ROWS;
    textCols = canWidth/colWidth; if(textCols>SIMIO_MAX_COLS) textCols=SIMIO_MAX_COLS;
  }

  void FormPaint(void*){ js_canvas_repaint(); }

  void clear(){
    gotorc(0,0);
    js_canvas_clearBlack(alsoVisible());
    for(int i=0;i<SIMIO_MAX_ROWS*SIMIO_MAX_COLS;i++) text[i]=' ';
  }

  void scroll(){
    js_canvas_copyRectBack(0,0, 0,rowHeight, canWidth, canHeight-rowHeight);
    js_canvas_fillBlackRect(0, canHeight-rowHeight, canWidth, rowHeight, 0);
    if(!doubleBuffer){
      js_canvas_copyRectVisible(0,0, 0,rowHeight, canWidth, canHeight-rowHeight);
      js_canvas_fillBlackRect(0, canHeight-rowHeight, canWidth, rowHeight, 1);
    }
    for(int i=0;i<textRows-1;i++)
      for(int j=0;j<textCols;j++)
        text[i*SIMIO_MAX_COLS+j] = text[(i+1)*SIMIO_MAX_COLS+j];
    for(int j=0;j<textCols;j++) text[(textRows-1)*SIMIO_MAX_COLS+j] = ' ';
  }

  void doCRLF(){ col=0; row++; gotorc(row,col); }

  void gotorc(int r, int c){
    if(r<0) r=0;
    else if( (rowHeight*r) > (canHeight-rowHeight) ){ scroll(); r = canHeight/rowHeight - 1; }
    if(c<0) c=0;
    else if( (colWidth*c) > (canWidth-colWidth) && textWrap ){ doCRLF(); return; }
    textY = rowHeight*r; row=r; if(row>=SIMIO_MAX_ROWS) row=SIMIO_MAX_ROWS-1;
    textX = colWidth*c; col=c; if(col>=SIMIO_MAX_COLS) col=SIMIO_MAX_COLS-1;
  }

  void charOut(char ch){
    switch(ch){
      case '\a': js_canvas_beep(); return;
      case '\b': col--; gotorc(row,col); return;
      case '\f': clear(); return;
      case '\n': row++; gotorc(row,col); return;
      case '\r': col=0; gotorc(row,col); return;
      case '\t': col+=5; gotorc(row,col); return;
      case '\v': row+=4; gotorc(row,col); return;
      default:
        if((unsigned char)ch >= 0x20){
          js_canvas_drawChar(textX, textY, (unsigned char)ch, alsoVisible());
          if(row<SIMIO_MAX_ROWS && col<SIMIO_MAX_COLS) text[row*SIMIO_MAX_COLS+col]=ch;
          col++;
        }
    }
    gotorc(row,col);
  }
  void charIn(char* out){ charIn_impl(out); }
  void textOut(const char* s){ for(const char* p=s; *p; p++) charOut(*p); }
  void textOutCR(const char* s){ for(const char* p=s; *p; p++) charOut(*p); doCRLF(); }
  // `dummy` is the real signature's numeric-output parameter (TsimIO::textIn's
  // `inNum` in simIOu.cpp - the real FormKeyPress() does `*inputNumber =
  // atoi(inputBuf)` once Enter is pressed). It used to be silently discarded
  // here, so TRAP #15 tasks 4/18 ("read a number... into D1.L") never
  // actually wrote anything into D1 at all - confirmed while adding task 218
  // (the CONSOLE_LOG replica of task 18), whose own D1 came back $00000000
  // regardless of what was "entered" via the prompt() dialog.
  void textIn(char* buf, long* len, long* dummy){ textIn_impl(buf, len); if(dummy) *dummy = atol(buf); }

  // gotorc(row,col) call signature used by CODE9.CPP is (col-from-lowbyte, row-from-highbyte); see CODE9.CPP case 11
  void gotorc(char rr, char cc){ gotorc((int)(unsigned char)rr, (int)(unsigned char)cc); }
  void getrc(short* result){ if(result) *result = (short)(((col & 0xFF)<<8) | (row & 0xFF)); }
  void getCharAt(unsigned short r, unsigned short c, char* out){
    if(out) *out = (r<SIMIO_MAX_ROWS && c<SIMIO_MAX_COLS) ? text[r*SIMIO_MAX_COLS+c] : ' ';
  }

  void setupWindow(){ js_set_fullscreen(fullScreen ? 1 : 0); }
  void getWindowSize(unsigned short& w, unsigned short& h){ w=(unsigned short)canWidth; h=(unsigned short)canHeight; }
  void setWindowSize(short w, short h){
    canWidth = w<640?640:w; canHeight = h<480?480:h;
    js_canvas_setWindowSize(canWidth, canHeight);
    recomputeTextSize();
  }

  void drawPixel(short x, short y){ js_gfx_drawPixel(x,y,alsoVisible()); }
  long getPixel(short x, short y){ return js_gfx_getPixel(x,y); }
  void moveTo(short x, short y){ penX=x; penY=y; js_gfx_moveTo(x,y); }
  void lineTo(short x, short y){ js_gfx_lineTo(x,y,alsoVisible()); penX=x; penY=y; }
  void line(short x1, short y1, short x2, short y2){ js_gfx_line(x1,y1,x2,y2,alsoVisible()); penX=x2; penY=y2; }
  void rectangle(short x1, short y1, short x2, short y2){ js_gfx_rect(x1,y1,x2,y2,1,alsoVisible()); }
  void unfilledRectangle(short x1, short y1, short x2, short y2){ js_gfx_rect(x1,y1,x2,y2,0,alsoVisible()); }
  void ellipse(short x1, short y1, short x2, short y2){ js_gfx_ellipse(x1,y1,x2,y2,1,alsoVisible()); }
  void unfilledEllipse(short x1, short y1, short x2, short y2){ js_gfx_ellipse(x1,y1,x2,y2,0,alsoVisible()); }
  void floodFill(short x, short y){ js_gfx_floodFill(x,y,alsoVisible()); }
  void drawText(const char* s, short x, short y){ js_gfx_drawText(s,x,y,alsoVisible()); }
  void getXY(short* x, short* y){ if(x)*x=(short)penX; if(y)*y=(short)penY; }
  void setDrawingMode(long m){
    m &= 0xFF;
    js_gfx_setDrawingMode((int)m);
    if(m==16){
      doubleBuffer=false;
      js_canvas_repaint(); // real source does an implicit FormPaint() here too
    }
    else if(m==17) doubleBuffer=true;
  }
  void setPenWidth(long w){ js_gfx_setPenWidth((int)(w & 0xFF)); }
  void setLineColor(long c){ js_gfx_setLineColor((int)c); }
  void setFillColor(long c){ js_gfx_setFillColor((int)c); }
  void setFontProperties(long c, long s){
    js_canvas_setFont((int)c, (int)(s&0xFFFF), (int)((s>>16)&0xFF), (int)((s>>24)&0xFF));
    recomputeTextSize();
    gotorc(row,col);
  }
  void scrollRect(unsigned short r, unsigned short c, unsigned short h, unsigned short w, unsigned short dir){
    if((r+h>=SIMIO_MAX_ROWS)||(c+w>=SIMIO_MAX_COLS)||w==0||h==0) return;
    int cw=colWidth, rh=rowHeight;
    if(dir==0){ // up
      js_canvas_copyRectBack(c*cw, r*rh, c*cw, (r+1)*rh, w*cw, (h-1)*rh);
      js_canvas_fillBlackRect(c*cw, (r+h-1)*rh, w*cw, rh, 0);
      if(!doubleBuffer){ js_canvas_copyRectVisible(c*cw, r*rh, c*cw, (r+1)*rh, w*cw, (h-1)*rh); js_canvas_fillBlackRect(c*cw, (r+h-1)*rh, w*cw, rh, 1); }
      for(int i=r;i<r+h-1;i++) for(int j=c;j<c+w;j++) text[i*SIMIO_MAX_COLS+j]=text[(i+1)*SIMIO_MAX_COLS+j];
      for(int j=c;j<c+w;j++) text[(r+h-1)*SIMIO_MAX_COLS+j]=' ';
    } else if(dir==1){ // down
      js_canvas_copyRectBack(c*cw, (r+1)*rh, c*cw, r*rh, w*cw, (h-1)*rh);
      js_canvas_fillBlackRect(c*cw, r*rh, w*cw, rh, 0);
      if(!doubleBuffer){ js_canvas_copyRectVisible(c*cw, (r+1)*rh, c*cw, r*rh, w*cw, (h-1)*rh); js_canvas_fillBlackRect(c*cw, r*rh, w*cw, rh, 1); }
      for(int i=r+h-1;i>r;i--) for(int j=c;j<c+w;j++) text[i*SIMIO_MAX_COLS+j]=text[(i-1)*SIMIO_MAX_COLS+j];
      for(int j=c;j<c+w;j++) text[r*SIMIO_MAX_COLS+j]=' ';
    } else if(dir==2){ // left
      js_canvas_copyRectBack(c*cw, r*rh, (c+1)*cw, r*rh, (w-1)*cw, h*rh);
      js_canvas_fillBlackRect((c+w-1)*cw, r*rh, cw, h*rh, 0);
      if(!doubleBuffer){ js_canvas_copyRectVisible(c*cw, r*rh, (c+1)*cw, r*rh, (w-1)*cw, h*rh); js_canvas_fillBlackRect((c+w-1)*cw, r*rh, cw, h*rh, 1); }
      for(int j=c;j<c+w-1;j++) for(int i=r;i<r+h;i++) text[i*SIMIO_MAX_COLS+j]=text[i*SIMIO_MAX_COLS+j+1];
      for(int i=r;i<r+h;i++) text[i*SIMIO_MAX_COLS+c+w-1]=' ';
    } else if(dir==3){ // right
      js_canvas_copyRectBack((c+1)*cw, r*rh, c*cw, r*rh, (w-1)*cw, h*rh);
      js_canvas_fillBlackRect(c*cw, r*rh, cw, h*rh, 0);
      if(!doubleBuffer){ js_canvas_copyRectVisible((c+1)*cw, r*rh, c*cw, r*rh, (w-1)*cw, h*rh); js_canvas_fillBlackRect(c*cw, r*rh, cw, h*rh, 1); }
      for(int j=c+w-1;j>c;j--) for(int i=r;i<r+h;i++) text[i*SIMIO_MAX_COLS+j]=text[i*SIMIO_MAX_COLS+j-1];
      for(int i=r;i<r+h;i++) text[i*SIMIO_MAX_COLS+c]=' ';
    }
  }

  void getKeyState(long* codes){
    long code = *codes;
    if(code == 0){
      // request scan code of last keypress: (keyUpCode<<16) + keyDownCode
      *codes = ((long)g_keyUpCode << 16) + g_keyDownCode;
      return;
    }
    long keyState = 0;
    if(js_key_isPressed((int)(unsigned char)code)) keyState = 0xFF;
    code = code >> 8;
    if(js_key_isPressed((int)(unsigned char)code)) keyState += 0xFF00;
    code = code >> 8;
    if(js_key_isPressed((int)(unsigned char)code)) keyState += 0xFF0000;
    code = code >> 8;
    if(js_key_isPressed((int)(unsigned char)code)) keyState += (long)0xFF000000;
    *codes = keyState;
  }
  void displayFileDialog(long* mode, long a1, long a2, long a3, short* result);

  void loadSound(const char* path, unsigned char slot){ js_snd_load(path, slot); }
  void loadSoundDX(const char* path, unsigned char slot, short* result){ js_snd_loadDX(path, slot); if(result) *result=0; }
  void playSound(const char* path, short* result){ js_snd_play(path); if(result) *result=0; }
  void playSoundDX(const char* path, short* result){ js_snd_playDX(path); if(result) *result=0; }
  void playSoundMem(unsigned char slot, short* result){ js_snd_playMem(slot); if(result) *result=0; }
  void playSoundMemDX(unsigned char slot, short* result){ js_snd_playMemDX(slot); if(result) *result=0; }
  void controlSound(unsigned int cmd, unsigned char slot, short* result){ js_snd_control(slot,cmd); if(result) *result=0; }
  void controlSoundDX(unsigned int cmd, unsigned char slot, short* result){ js_snd_controlDX(slot,cmd); if(result) *result=0; }
  bool serialWarningShown = false;
  void serialUnavailableWarning(){
    if(serialWarningShown) return;
    serialWarningShown = true;
    simLog("Note: TRAP #15 serial port tasks (40-43) are not available in this web port - a browser cannot access serial/COM ports directly. Every serial task reports failure (result code -1) so a program checking the result can detect this and continue gracefully.");
  }
  void initComm(long,char*,short* result){ serialUnavailableWarning(); if(result) *result=-1; }
  void setCommParams(long,long,short* result){ serialUnavailableWarning(); if(result) *result=-1; }
  void readComm(long,unsigned char* count,char*,short* result){ serialUnavailableWarning(); if(count) *count=0; if(result) *result=-1; }
  void sendComm(long,unsigned char* count,char*,short* result){ serialUnavailableWarning(); if(count) *count=0; if(result) *result=-1; }
  bool netWarningShown = false;
  void netUnavailableWarning(){
    if(netWarningShown) return;
    netWarningShown = true;
    simLog("Note: TRAP #15 networking tasks (100-107) are not available in this web port - a browser cannot open arbitrary TCP/UDP sockets the way a desktop program can. Every network task reports failure (result code -1) so a program checking the result can detect this and continue gracefully.");
  }
  void createNetClient(long,char*,int* result){ netUnavailableWarning(); if(result) *result=-1; }
  void createNetServer(long,int* result){ netUnavailableWarning(); if(result) *result=-1; }
  void sendNet(long,char*,char*,int* sent,int* result){ netUnavailableWarning(); if(sent) *sent=0; if(result) *result=-1; }
  void receiveNet(long,char*,int* received,char*,int* result){ netUnavailableWarning(); if(received) *received=0; if(result) *result=-1; }
  void sendPortNet(long* d0,long*,char*,char*){ netUnavailableWarning(); if(d0) *d0=-1; }
  void receivePortNet(long* d0,long*,char*,char*){ netUnavailableWarning(); if(d0) *d0=-1; }
  void getLocalIP(char* buf,int* result){ netUnavailableWarning(); if(buf) buf[0]='\0'; if(result) *result=-1; }
  void closeNetConnection(long,int* result){ netUnavailableWarning(); if(result) *result=-1; }
  void ResetSounds(){ js_reset_sounds(); }
};
extern SimIOStub *simIO;

#endif
