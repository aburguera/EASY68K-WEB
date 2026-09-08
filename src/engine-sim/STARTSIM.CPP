
/***************************** 68000 SIMULATOR ****************************

File Name: SIM.C
Version: 1.0

This file contains the function 'main()' and various screen management
	routines.

   Modified: Chuck Kelly
             Monroe County Community College
             http://www.monroeccc.edu/ckelly

***************************************************************************/

#include <stdio.h>
#include <iostream>
using namespace std;
#include "extern.h"
#include "hostapi.h"
#include "hardware_stub.h"
#include "simio_stub.h"


//void scrshow(); 	/* update register display */
extern bool inputMode;
extern bool disableKeyCommands;  // defined in SIM68Ku

void initSim()                   // initialization for the simulator
{
  int	i;

  autoTraceInProgress = false;
  simIO->clear();               // clear output window
  simIO->setWindowSize(0,0);    // reset output window size
  simIO->setDrawingMode(4);     // set default pen mode
  simIO->setDrawingMode(16);    // turn off double buffering
  simIO->setPenWidth(1);        // set default pen width
  simIO->setLineColor(clWhite);
  simIO->setFillColor(clBlack);


  inputMode = false;
  pendingKey = 0;               // clear pendingKey

  runMode = false;
  lbuf[0] = '\0';		// initialize to prevent memory access violations
  wordptr[0] = lbuf;
  for (i = 0; i <= 7; i++)
    A[i] = D[i] = 0;
  cycles = 0;
  SR = 0x2000;
  A[7] = 0x00FF0000;            // user stack
  A[8] = 0x01000000;            // supervisor stack
  OLD_PC = -1;                  // set different from 'PC' and 'cycles'
  trace = sstep = false;
  stopInstruction = false;
  stepToAddr = 0;               // clear step
  runToAddr = 0;                // clear runTo
  scrshow();
  keyboardEcho = true;          // true, EASy68K input is echoed (default)
  inputPrompt = true;           // true, display prompt during input (default)
  inputLFdisplay = true;

  for (i=0; i<MAXFILES; i++) {  // clear file structures
    files[i].fp = NULL;
  }

  irq = 0;                      // reset IRQ flags
  Hardware->autoIRQoff();       // turn off auto interrupt timers
  hardReset = false;

  Hardware->enable();

  mouseX = 0;
  mouseY = 0;
  mouseLeft = false;
  mouseRight = false;
  mouseMiddle = false;
  mouseDouble = false;
  keyShift = false;
  keyAlt = false;
  keyCtrl =false;

  mouseXUp = 0;
  mouseYUp = 0;
  mouseLeftUp = false;
  mouseRightUp = false;
  mouseMiddleUp = false;
  mouseDoubleUp = false;
  keyShiftUp = false;
  keyAltUp = false;
  keyCtrlUp = false;

  mouseXDown = 0;
  mouseYDown = 0;
  mouseLeftDown = false;
  mouseRightDown = false;
  mouseMiddleDown = false;
  mouseDoubleDown = false;
  keyShiftDown = false;
  keyAltDown = false;
  keyCtrlDown = false;
  mouseDownIRQ = 0;
  mouseUpIRQ = 0;
  mouseMoveIRQ = 0;
  keyDownIRQ = 0;
  keyUpIRQ = 0;

  simIO->ResetSounds(); // stop all playing sounds and clear sound memory


  // web port: netCloseSockets() - networking deferred, see simio_stub.h
}


void scrshow()          // update register display
{
  // web port: this pushed D0-D7/A0-A7/PC/SR/cycles into VCL Text/Caption
  // properties and repainted several panels. The web GUI reads registers
  // directly via exported getters instead, so there is nothing to do here;
  // kept as a no-op so existing call sites don't need to change.
}
