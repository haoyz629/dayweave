---
name: dayweave-package
description: Build and verify the Dayweave Windows NSIS installer when the user asks to package, rebuild an installer, or approves the repository's post-change packaging question. Do not use for ordinary tests, frontend-only builds, or development runs.
---

# Package Dayweave

Build a fresh local Windows installer and return evidence for that exact artifact.

## Authorization boundary

Run this workflow only when the user has explicitly requested packaging or has answered yes to the post-change packaging question. Packaging approval also permits closing only the running development executable whose resolved path exactly matches this repository's `src-tauri\target\<configuration>\dayweave.exe`; never stop another same-named process.

## Workflow

1. Use Debug unless the user explicitly requests Release.
2. Run the deterministic helper from the repository root:

   ```powershell
   & ".\.agents\skills\dayweave-package\scripts\package-dayweave.ps1" -Configuration Debug -StopRunningApp
   ```

3. Treat the package as successful only when the command exits successfully, verifies that both the application executable and installer are not Low integrity, and prints `DAYWEAVE_PACKAGE_RESULT=` for the newly built installer. The helper reads mandatory-label SIDs directly using the Windows security API, checks the application before and after bundling, and fails closed if reading fails. Hash/freshness alone do not establish a usable native artifact.
4. Report the absolute installer path, exact byte size, MiB size, SHA-256, integrity check status, and stage timings from that result. Never reuse a hash or size from an earlier build.

The helper builds the frontend and Rust application once with `tauri build --no-bundle`, then generates the NSIS installer with `tauri bundle`. It preserves existing build caches. Debug uses `src-tauri/tauri.debug.conf.json` to select faster zlib compression at the cost of a larger installer; Release retains its normal compression settings. Both commands run in non-interactive mode. Timings cover the combined frontend/Rust build, installer generation, verification, and total workflow.

Packaging does not replace other relevant tests; complete those as part of the change workflow before asking whether to package. To check the helper without building or stopping the app, run `& ".\.agents\skills\dayweave-package\scripts\package-dayweave.test.ps1"`.

If the build reports a Windows child-process restriction such as `spawn EPERM`, retry the unchanged command in an environment that permits child processes before editing application code. If the helper refuses to stop a process, preserve that safety boundary and report the exact blocker.

If an artifact inherits a Low mandatory label, stop delivery and inspect the artifact and ancestor directory labels. Packaging approval does not authorize changing security metadata. Ask separately before narrowly repairing specific output files; never recursively relabel the workspace or automatically elevate artifacts. For an already-authorized repair, verify unchanged SHA-256, owner/group/DACL and the actual native process token. A High label is only appropriate with separate user approval and evidence of an existing High desktop; it is not the default product policy. An inherited Low workspace remains unchanged and may cause a later rebuild to be refused again.
