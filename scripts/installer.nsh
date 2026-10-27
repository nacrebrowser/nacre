!include MUI2.nsh
!include LogicLib.nsh
!include nsDialogs.nsh

; Native process check: no PowerShell/WMI, no broad path-prefix matching,
; and no automatic termination of another Nacre instance or another user's app.
!macro customCheckAppRunning
  !define NacreProcessCheck ${__LINE__}
  nacre_check_${NacreProcessCheck}:
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 == 0
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Nacre is running. Close its windows and retry. No process will be stopped automatically." /SD IDCANCEL IDRETRY nacre_check_${NacreProcessCheck}
      SetErrorLevel 2
      Quit
    ${ElseIf} $R0 != 603
      ; nsProcess: 603 = process not running. Other failures are not absence.
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Unable to check running applications (code $R0). Retry, or cancel installation." /SD IDCANCEL IDRETRY nacre_check_${NacreProcessCheck}
      SetErrorLevel 2
      Quit
    ${EndIf}
  !undef NacreProcessCheck
!macroend
!ifndef BUILD_UNINSTALLER
; Donation link on the last page of the setup wizard.
!define MUI_FINISHPAGE_LINK "Like Nacre? Support my work on PayPal"
!define MUI_FINISHPAGE_LINK_LOCATION "https://www.paypal.com/paypalme/donNacre"
Var ProtectionMode
Var TorRadio
Var StandardRadio
!endif

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom ProtectionPage ProtectionLeave

Function ProtectionPage
  !insertmacro MUI_HEADER_TEXT "Choose your protection" "Both modes include ad blocking and third-party cookie blocking."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 8u 100% 22u "Tor protection - connect automatically on every launch"
  Pop $TorRadio
  ${NSD_CreateLabel} 12u 34u 95% 38u "Hides your IP through Tor. Startup and browsing can be slower.$\r$\nWeb traffic stays blocked until Tor connects; no direct fallback."
  Pop $0
  ${NSD_CreateRadioButton} 0 85u 100% 22u "Standard protection - start without Tor"
  Pop $StandardRadio
  ${NSD_CreateLabel} 12u 111u 95% 38u "Uses your normal network; your IP is visible.$\r$\nYou can turn on Tor whenever you want from the toolbar."
  Pop $0
  ${If} $ProtectionMode == "standard"
    ${NSD_Check} $StandardRadio
  ${Else}
    ${NSD_Check} $TorRadio
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function ProtectionLeave
  ${NSD_GetState} $StandardRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ProtectionMode "standard"
  ${Else}
    StrCpy $ProtectionMode "tor"
  ${EndIf}
FunctionEnd

!macroend

!macro customInstall
  ${If} $ProtectionMode == ""
    StrCpy $ProtectionMode "tor"
  ${EndIf}
  System::Call 'ole32::CoCreateGuid(g .r0) i.r1'
  ${If} $1 != 0
    Abort "Unable to save the protection choice."
  ${EndIf}
  StrCpy $0 $0 36 1
  ClearErrors
  FileOpen $2 "$INSTDIR\startup-choice.json" w
  FileWrite $2 '{$\"version$\":1,$\"id$\":$\"$0$\",$\"mode$\":$\"$ProtectionMode$\"}'
  FileClose $2
  ${If} ${Errors}
    Abort "Unable to save the protection choice."
  ${EndIf}
!macroend
