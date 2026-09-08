
/***************************** 68000 SIMULATOR ****************************

File Name: VAR.H
Version: 1.0

This file contains all global variable definitions for the simulator
program.  It is included in the module "SIM68Ku".

        BE CAREFUL TO KEEP THESE DECLARATIONS IDENTICAL TO THE GLOBAL
        VARIABLE DECLARATIONS IN "EXTERN.H"


***************************************************************************/


#include "def.h"                   /* include file for constants & types */
#include "compat_vcl.h"
#include "proto.h"		/* function prototypes */


#include <stack>
using namespace std;

#include "BPoint.h"
#include "BPointExpr.h"
#pragma hdrstop


// General
char	*memory = NULL;        // pointer for main 68000 memory

char buffer[256];       // used to form messages for display in windows
char numBuf[20];        // "
AnsiString errstr, str;



// _____________________________________________________________________
// The following variables must remain together. put() and value_of()
// check the addresses of these variables to decide if an operation
// is being performed on a 68000 register or 68000 memory.
// 68000 registers
long 	D[D_REGS], A[A_REGS];
long 	PC;
short	SR;

long	global_temp;	// to hold an immediate data operand
long    OLD_PC;         // previous PC
long	*EA1, *EA2;
long	EV1, EV2;
long	source, dest, result;
int 	inst;
// _____________________________________________________________________




unsigned long long  cycles;
int 	trace, sstep, old_trace, old_sstep, exceptions;
bool    bitfield, simhalt_on;
bool    halt;                   // true, halts running program
bool    stopInstruction;        // true after running stop instruction

char	lbuf[SREC_MAX], *wordptr[20]; 	// command buffers
char	bpoints = 0;
int 	brkpt[100], wcount;
int     stepToAddr;             // Step Over stopping address
int     runToAddr;              // runToCursor stopping address

int 	errflg;


/* port structure is :{control,trans data,status,recieve data} */
unsigned int port1[4] = {0x00,0,0x82,0};	/* simulated 6850 port */
char 	p1dif = 0;

bool    runMode;                // true when running 68000 program (not tracing)
bool    runModeSave;

bool    keyboardEcho;           // true, EASy68K input is echoed (default)
char    pendingKey;             // pending key for char input
bool    inputPrompt;            // true, display prompt during input (default)
bool    inputLFdisplay;         // true, display LF on CR during input (default)

char    inputBuf[256];          // simulator input buffer
long    inputSize;              // number of characters input
bool    inputMode;              // true when getting keyboard input

FileStruct files[MAXFILES];     // array of file structures

// log output
char ElogFlag;          // Execution log file setting
FILE *ElogFile;		// Execution Log file
char OlogFlag;          // Output log file setting
FILE *OlogFile;		// Output Log file
bool logging;           // true when logging
unsigned int logMemAddr;        // log memory address
unsigned int logMemBytes;       // log memory bytes

bool autoTraceInProgress;       // true when auto tracing


// Allocate array of breakpoints / expression groups.
// PC/Reg break points are in elements 0-49.  Addr => 50-99.
BPoint breakPoints[MAX_BPOINTS];
BPointExpr bpExpressions[MAX_BP_EXPR];
int bpCountCond[MAX_BPOINTS];
int regCount = 0;
int addrCount = 0;
int exprCount = 0;

// Allocate array of ints for building a break expression.
// Elements of infixExpr represent relative indexes into the
// breakPoints array or represent and_node, or_node, not_node.
int infixExpr[MAX_LB_NODES];
int postfixExpr[MAX_LB_NODES];
int infixCount = 0;
int postfixCount;
stack<int> s_operator;

// Used to efficiently calculate which GUI buttons are availabe as
// the user builds a breakpoint expression.
bool mruOperand = false;
bool mruOperator = false;
int parenCount = 0;

// Read and write flags so when breakpoints are tested for read/write
// access, we know if this instruction caused a respective read/write.
bool bpRead;
bool bpWrite;
long * readEA;
long * writeEA;

// Interrupt and Reset Control
bool hardReset;
int irq;



// true if ChangeDisplaySettingsEx() and other multi monitor apis exist
// web port: removed Win32 multi-monitor fullscreen API definitions here
// (see extern.h for the matching removal and rationale).
bool dsoundExist;

// Mouse
int mouseX, mouseY;
bool mouseLeft, mouseRight, mouseMiddle, mouseDouble;
bool keyShift, keyAlt, keyCtrl;

int mouseXUp, mouseYUp;
bool mouseLeftUp, mouseRightUp, mouseMiddleUp, mouseDoubleUp;
bool keyShiftUp, keyAltUp, keyCtrlUp;

int mouseXDown, mouseYDown;
bool mouseLeftDown, mouseRightDown, mouseMiddleDown, mouseDoubleDown;
bool keyShiftDown, keyAltDown, keyCtrlDown;
unsigned char mouseDownIRQ, mouseUpIRQ, mouseMoveIRQ;
unsigned char keyDownIRQ, keyUpIRQ;


