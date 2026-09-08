/* compat_vcl.h — portable stand-ins for the handful of Borland VCL/RTL
   things the EASy68K assembler engine touches (AnsiString, TColor, a couple
   of RTL calls). This is the *only* header the ported engine files should
   need beyond the standard library. */
#ifndef COMPAT_VCL_H
#define COMPAT_VCL_H

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <cctype>
#include <ctime>

/* --- AnsiString: only string concatenation / c_str() / operator= are used
   by the engine files, so a thin wrapper over std::string covers it. --- */
class AnsiString {
public:
  std::string s;
  AnsiString() {}
  AnsiString(const char* c) : s(c ? c : "") {}
  AnsiString(const std::string& o) : s(o) {}
  AnsiString(int v) { char buf[32]; snprintf(buf,sizeof(buf),"%d",v); s = buf; }
  AnsiString operator+(const AnsiString& o) const { return AnsiString(s + o.s); }
  AnsiString operator+(const char* c) const { return AnsiString(s + c); }
  AnsiString operator+(char c) const { return AnsiString(s + std::string(1,c)); }
  AnsiString& operator+=(char c) { s += c; return *this; }
  AnsiString& operator+=(const AnsiString& o) { s += o.s; return *this; }
  bool operator==(const AnsiString& o) const { return s == o.s; }
  const char* c_str() const { return s.c_str(); }
  int Length() const { return (int)s.size(); }
  AnsiString UpperCase() const { std::string r=s; for(auto& c:r) c=toupper((unsigned char)c); return AnsiString(r); }
  AnsiString LowerCase() const { std::string r=s; for(auto& c:r) c=tolower((unsigned char)c); return AnsiString(r); }
  static AnsiString IntToHex(long v, int digits){
    char buf[32]; snprintf(buf,sizeof(buf), "%0*lX", digits, (unsigned long)v);
    return AnsiString(buf);
  }
};
inline AnsiString operator+(const char* c, const AnsiString& a){ return AnsiString(std::string(c)+a.s); }
inline char* fgets_fix(char* buf, int n, FILE* f){
  char* r = fgets(buf, n, f);
  if(r){
    int len = (int)strlen(buf);
    if(len>=2 && buf[len-2]=='\r' && buf[len-1]=='\n'){ buf[len-2]='\n'; buf[len-1]='\0'; }
    else if(len>=1 && buf[len-1]=='\r'){ buf[len-1]='\n'; buf[len]='\0'; }
  }
  return r;
}

typedef AnsiString String;
inline int StrToInt(const AnsiString& a){ return (int)strtol(a.c_str(), nullptr, 0); } // auto-detects 0x prefix, like VCL

/* Change a filename's extension, VCL-style (ext includes the leading dot) */
inline AnsiString ChangeFileExt(const AnsiString& fn, const char* ext){
  std::string s = fn.s;
  size_t slash = s.find_last_of("/\\");
  size_t dot = s.find_last_of('.');
  if(dot!=std::string::npos && (slash==std::string::npos || dot>slash)) s = s.substr(0,dot);
  return AnsiString(s + ext);
}

/* Timestamp helpers: real EASy68K writes a human-readable date/time into the
   listing header. time_t + ctime covers that without needing VCL's TDateTime. */
inline time_t Now(){ return time(nullptr); }
inline AnsiString DateTimeToStr(time_t t){
  char buf[64]; std::strftime(buf,sizeof(buf),"%m/%d/%Y %H:%M:%S", std::localtime(&t));
  return AnsiString(buf);
}

/* --- TColor: Windows-style 0x00BBGGRR packed color, same convention
   EASy68K itself uses for TRAP #15 graphics colors. --- */
typedef unsigned long TColor;
const TColor clBlack   = 0x00000000;
const TColor clWhite   = 0x00FFFFFF;
const TColor clRed     = 0x000000FF;
const TColor clGreen   = 0x00008000;
const TColor clBlue    = 0x00FF0000;
const TColor clOlive   = 0x00008080;
const TColor clPurple  = 0x00800080;
const TColor clMaroon  = 0x00000080;
const TColor clTeal    = 0x00808000;

/* Borland RTL helpers used here and there in the engine */
inline char* strcpyRTL(char* dst, const char* src){ return strcpy(dst,src); }

#endif
