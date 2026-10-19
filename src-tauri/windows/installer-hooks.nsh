; Current product names use Dayweave. Old literals below are upgrade-only identifiers.
; Tauri includes this file before defining its own constants.
!define MUI_CUSTOMFUNCTION_GUIINIT DayweaveRestoreLegacyInstallLocation
!define DAYWEAVE_STARTUP_NAME "今序 · Dayweave"
!define DAYWEAVE_BINARY_NAME "dayweave.exe"
!define LEGACY_STARTUP_NAME "今序（JinXu）"
!define LEGACY_BINARY_NAME "jinxu.exe"

Function DayweaveRestoreLegacyInstallLocation
  Push $4
  ReadRegStr $4 HKCU "Software\今序\今序 · Dayweave" ""
  ${If} $4 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\今序 · Dayweave"
    ReadRegStr $4 HKCU "Software\今序\今序" ""
    ${If} $4 != ""
      IfFileExists "$4\${LEGACY_BINARY_NAME}" 0 dayweave_restore_original
        StrCpy $INSTDIR $4
        Goto dayweave_restore_done
    ${EndIf}
    dayweave_restore_original:
    ReadRegStr $4 HKCU "Software\jinxu\${LEGACY_STARTUP_NAME}" ""
    ${If} $4 != ""
      IfFileExists "$4\${LEGACY_BINARY_NAME}" 0 +2
        StrCpy $INSTDIR $4
    ${EndIf}
  ${EndIf}
  dayweave_restore_done:
  Pop $4
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ; GUI restores before the directory page; silent installs use the same check.
  Call DayweaveRestoreLegacyInstallLocation
  ; Do not kill another same-named process; the user must close the old app first.
  nsis_tauri_utils::FindProcessCurrentUser "${LEGACY_BINARY_NAME}"
  Pop $R0
  ${If} $R0 = 0
    IfSilent +2
      MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出旧版今序（包括托盘），再继续安装 Dayweave。"
    Abort
  ${EndIf}
  SetOutPath $INSTDIR
!macroend

!macro DayweaveRemoveLegacyShortcut ShortcutPath
  !insertmacro IsShortcutTarget "${ShortcutPath}" "$INSTDIR\${LEGACY_BINARY_NAME}"
  Pop $0
  ${If} $0 != 1
    !insertmacro IsShortcutTarget "${ShortcutPath}" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
  ${EndIf}
  ${If} $0 = 1
    Delete "${ShortcutPath}"
  ${EndIf}
!macroend

!macro DayweaveRemoveLegacyInstall LegacyPublisher LegacyProductName
  ReadRegStr $4 SHCTX "Software\${LegacyPublisher}\${LegacyProductName}" ""
  ; Remove only records, executable and shortcuts for the installation we replaced.
  ${If} $4 == $INSTDIR
    !insertmacro DayweaveRemoveLegacyShortcut "$SMPROGRAMS\${LegacyProductName}.lnk"
    !insertmacro IsShortcutTarget "$DESKTOP\${LegacyProductName}.lnk" "$INSTDIR\${LEGACY_BINARY_NAME}"
    Pop $0
    ${If} $0 != 1
      !insertmacro IsShortcutTarget "$DESKTOP\${LegacyProductName}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
    ${EndIf}
    ${If} $0 = 1
      Call CreateOrUpdateDesktopShortcut
      Delete "$DESKTOP\${LegacyProductName}.lnk"
    ${EndIf}
    DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LegacyProductName}"
    DeleteRegKey SHCTX "Software\${LegacyPublisher}\${LegacyProductName}"
  ${EndIf}
!macroend

; Copy StartupApproved's binary value, not just Run: disabled must remain disabled.
; All registers used here are saved because this function runs inside Tauri's installer.
Function DayweaveMigrateAutostart
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  ; Some pre-rename builds already used the current display name but the old binary.
  ; Repair that Run target in place without changing its StartupApproved state.
  ReadRegStr $5 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${DAYWEAVE_STARTUP_NAME}"
  ${If} $5 == '$\"$INSTDIR\${LEGACY_BINARY_NAME}$\" '
  ${OrIf} $5 == '$\"$INSTDIR\${LEGACY_BINARY_NAME}$\"'
  ${OrIf} $5 == "$INSTDIR\${LEGACY_BINARY_NAME} "
  ${OrIf} $5 == "$INSTDIR\${LEGACY_BINARY_NAME}"
    ClearErrors
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${DAYWEAVE_STARTUP_NAME}" '$\"$INSTDIR\${DAYWEAVE_BINARY_NAME}$\" '
    ${If} ${Errors}
      Abort "无法更新开机启动路径。旧设置已保留。"
    ${EndIf}
  ${EndIf}
  ReadRegStr $4 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${LEGACY_STARTUP_NAME}"
  ${If} $4 == '$\"$INSTDIR\${LEGACY_BINARY_NAME}$\" '
  ${OrIf} $4 == '$\"$INSTDIR\${LEGACY_BINARY_NAME}$\"'
  ${OrIf} $4 == "$INSTDIR\${LEGACY_BINARY_NAME} "
  ${OrIf} $4 == "$INSTDIR\${LEGACY_BINARY_NAME}"
  ${OrIf} $4 == '$\"$INSTDIR\${DAYWEAVE_BINARY_NAME}$\" '
  ${OrIf} $4 == '$\"$INSTDIR\${DAYWEAVE_BINARY_NAME}$\"'
  ${OrIf} $4 == "$INSTDIR\${DAYWEAVE_BINARY_NAME} "
  ${OrIf} $4 == "$INSTDIR\${DAYWEAVE_BINARY_NAME}"
    ReadRegStr $5 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${DAYWEAVE_STARTUP_NAME}"
    ${If} $5 == ""
      ; Copy the 12-byte Windows startup approval record only when the new name has none.
      System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", i 0, i 3, *p .r0) i .r1'
      ${If} $1 == 0
        System::Call 'advapi32::RegQueryValueExW(p r0, w "${DAYWEAVE_STARTUP_NAME}", p 0, p 0, p 0, *i .r2) i .r1'
        ${If} $1 == 2
          System::Alloc 12
          Pop $3
          StrCpy $2 12
          System::Call 'advapi32::RegQueryValueExW(p r0, w "${LEGACY_STARTUP_NAME}", p 0, *i .r6, p r3, *i r2r2) i .r1'
          ${If} $1 == 0
          ${AndIf} $6 == 3
          ${AndIf} $2 == 12
            System::Call 'advapi32::RegSetValueExW(p r0, w "${DAYWEAVE_STARTUP_NAME}", i 0, i 3, p r3, i 12) i .r1'
            ${If} $1 != 0
              System::Free $3
              System::Call 'advapi32::RegCloseKey(p r0)'
              Abort "无法迁移开机启动状态。旧设置已保留，请关闭旧版后重试。"
            ${EndIf}
          ${ElseIf} $1 != 2
            System::Free $3
            System::Call 'advapi32::RegCloseKey(p r0)'
            Abort "无法读取旧版开机启动状态。旧设置已保留。"
          ${EndIf}
          System::Free $3
        ${ElseIf} $1 != 0
          System::Call 'advapi32::RegCloseKey(p r0)'
          Abort "无法读取开机启动状态。旧设置已保留。"
        ${EndIf}
        System::Call 'advapi32::RegCloseKey(p r0)'
      ${ElseIf} $1 != 2
        Abort "无法打开开机启动设置。旧设置已保留。"
      ${EndIf}
      ClearErrors
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${DAYWEAVE_STARTUP_NAME}" '$\"$INSTDIR\${DAYWEAVE_BINARY_NAME}$\" '
      ${If} ${Errors}
        Abort "无法保存开机启动设置。旧设置已保留。"
      ${EndIf}
    ${EndIf}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${LEGACY_STARTUP_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${LEGACY_STARTUP_NAME}"
  ${EndIf}
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  Push $4
  Call DayweaveMigrateAutostart
  !insertmacro DayweaveRemoveLegacyInstall "今序" "今序"
  !insertmacro DayweaveRemoveLegacyInstall "jinxu" "${LEGACY_STARTUP_NAME}"
  ; The immediately previous version already used the current display name.
  ; Its registry key is now the current one, so only remove the replaced binary.
  ReadRegStr $4 SHCTX "Software\今序\今序 · Dayweave" ""
  ${If} $4 == $INSTDIR
    Delete "$INSTDIR\${LEGACY_BINARY_NAME}"
  ${EndIf}
  Pop $4
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $4
  ReadRegStr $4 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${DAYWEAVE_STARTUP_NAME}"
  ${If} $4 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" '
  ${OrIf} $4 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\"'
  ${OrIf} $4 == "$INSTDIR\${MAINBINARYNAME}.exe "
  ${OrIf} $4 == "$INSTDIR\${MAINBINARYNAME}.exe"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${DAYWEAVE_STARTUP_NAME}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${DAYWEAVE_STARTUP_NAME}"
  ${EndIf}
  Pop $4
!macroend
