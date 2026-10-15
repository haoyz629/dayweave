; Dayweave must upgrade both previous display names in place.
; Tauri includes this file before defining its own constants.
!define MUI_CUSTOMFUNCTION_GUIINIT JinxuRestoreLegacyInstallLocation

Function JinxuRestoreLegacyInstallLocation
  Push $4
  ReadRegStr $4 HKCU "Software\今序\今序 · Dayweave" ""
  ${If} $4 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\今序 · Dayweave"
    ReadRegStr $4 HKCU "Software\今序\今序" ""
    ${If} $4 != ""
      IfFileExists "$4\jinxu.exe" 0 jinxu_restore_original
        StrCpy $INSTDIR $4
        Goto jinxu_restore_done
    ${EndIf}
    jinxu_restore_original:
    ReadRegStr $4 HKCU "Software\jinxu\今序（JinXu）" ""
    ${If} $4 != ""
      IfFileExists "$4\jinxu.exe" 0 +2
        StrCpy $INSTDIR $4
    ${EndIf}
  ${EndIf}
  jinxu_restore_done:
  Pop $4
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; GUI restores before the directory page; silent installs use the same check.
  Call JinxuRestoreLegacyInstallLocation
  SetOutPath $INSTDIR
!macroend

!macro JinxuRemoveLegacyInstall LegacyPublisher LegacyProductName
  ReadRegStr $4 SHCTX "Software\${LegacyPublisher}\${LegacyProductName}" ""
  ; Remove only records and shortcuts belonging to the installation we replaced.
  ${If} $4 == $INSTDIR
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${LegacyProductName}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Delete "$SMPROGRAMS\${LegacyProductName}.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$DESKTOP\${LegacyProductName}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Call CreateOrUpdateDesktopShortcut
      Delete "$DESKTOP\${LegacyProductName}.lnk"
    ${EndIf}
    DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LegacyProductName}"
    DeleteRegKey SHCTX "Software\${LegacyPublisher}\${LegacyProductName}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $4
  !insertmacro JinxuRemoveLegacyInstall "今序" "今序"
  !insertmacro JinxuRemoveLegacyInstall "jinxu" "今序（JinXu）"
  ; Keep the existing Run value and StartupApproved state: the executable path
  ; did not change, so upgrading must not enable a disabled startup preference.
  Pop $4
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $4
  ReadRegStr $4 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "今序（JinXu）"
  ; auto-launch writes the executable with a trailing space when args are empty.
  ${If} $4 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" '
  ${OrIf} $4 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\"'
  ${OrIf} $4 == "$INSTDIR\${MAINBINARYNAME}.exe "
  ${OrIf} $4 == "$INSTDIR\${MAINBINARYNAME}.exe"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "今序（JinXu）"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "今序（JinXu）"
  ${EndIf}
  Pop $4
!macroend
