---
name: jinxu-package
description: Build and verify the JinXu Windows NSIS installer when the user asks to package, rebuild an installer, or approves the repository's post-change packaging question. Do not use for ordinary tests, frontend-only builds, or development runs.
---

# Package JinXu

Build a fresh local Windows installer and return evidence for that exact artifact.

## Authorization boundary

Run this workflow only when the user has explicitly requested packaging or has answered yes to the post-change packaging question. Packaging approval also permits closing only the running development executable whose resolved path exactly matches this repository's `src-tauri\target\<configuration>\jinxu.exe`; never stop another same-named process.

## Workflow

1. Use Debug unless the user explicitly requests Release.
2. Run the deterministic helper from the repository root:

   ```powershell
   & ".\.agents\skills\jinxu-package\scripts\package-jinxu.ps1" -Configuration Debug -StopRunningApp
   ```

3. Treat the package as successful only when the command exits successfully and prints `JINXU_PACKAGE_RESULT=` for the newly built installer.
4. Report the absolute installer path, exact byte size, MiB size, and SHA-256 from that result. Never reuse a hash or size from an earlier build.

The Tauri package command runs the configured frontend build. Packaging does not replace other relevant tests; complete those as part of the change workflow before asking whether to package.

If the build reports a Windows child-process restriction such as `spawn EPERM`, retry the unchanged command in an environment that permits child processes before editing application code. If the helper refuses to stop a process, preserve that safety boundary and report the exact blocker.

