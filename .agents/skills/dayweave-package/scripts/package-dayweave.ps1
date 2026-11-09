[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",

    [switch]$StopRunningApp
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'invoke-dayweave-npm.ps1')

function Assert-DayweaveArtifactIntegrity {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    try {
        if (-not ('DayweavePackagingIntegrity' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class DayweavePackagingIntegrity {
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetNamedSecurityInfoW(string path, uint kind, uint info,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetAce(IntPtr acl, uint index, out IntPtr ace);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    public static uint Read(string path) {
        IntPtr owner, group, dacl, sacl, descriptor;
        uint error = GetNamedSecurityInfoW(path, 1, 0x10, out owner, out group, out dacl, out sacl, out descriptor);
        if (error != 0) throw new Win32Exception((int)error);
        try {
            if (sacl != IntPtr.Zero) {
                uint count = (ushort)Marshal.ReadInt16(sacl, 4);
                for (uint i = 0; i < count; i++) {
                    IntPtr ace;
                    if (!GetAce(sacl, i, out ace)) throw new Win32Exception(Marshal.GetLastWin32Error());
                    if (Marshal.ReadByte(ace) == 0x11) {
                        string sid = new SecurityIdentifier(IntPtr.Add(ace, 8)).Value;
                        return UInt32.Parse(sid.Substring(sid.LastIndexOf('-') + 1));
                    }
                }
            }
            return 8192; // Windows treats an object without a mandatory label as Medium.
        } finally { LocalFree(descriptor); }
    }
}
'@
        }
        $integrityRid = [DayweavePackagingIntegrity]::Read($LiteralPath)
    }
    catch {
        throw "Cannot verify artifact integrity for '$LiteralPath': $($_.Exception.Message)"
    }
    if ($integrityRid -lt 8192) {
        throw "Low integrity artifact must not be delivered (SID S-1-16-$integrityRid): '$LiteralPath'. Check inherited directory labels; security metadata requires separate authorization."
    }
    Write-Host "Integrity check passed (not Low): $LiteralPath"
}

$totalTimer = [System.Diagnostics.Stopwatch]::StartNew()
$timings = [ordered]@{}
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$targetName = $Configuration.ToLowerInvariant()
$expectedExecutable = [System.IO.Path]::GetFullPath(
    (Join-Path $repositoryRoot "src-tauri\target\$targetName\dayweave.exe")
)

$matchingProcesses = @()
$unverifiedProcesses = @()
foreach ($process in @(Get-Process -Name "dayweave" -ErrorAction SilentlyContinue)) {
    try {
        $processPath = [System.IO.Path]::GetFullPath($process.Path)
    }
    catch {
        $unverifiedProcesses += $process
        continue
    }

    if ([System.StringComparer]::OrdinalIgnoreCase.Equals($processPath, $expectedExecutable)) {
        $matchingProcesses += $process
    }
    else {
        Write-Warning "Ignoring dayweave process $($process.Id) because its path is '$processPath', not '$expectedExecutable'."
    }
}

if ($unverifiedProcesses.Count -gt 0) {
    $ids = ($unverifiedProcesses | ForEach-Object { $_.Id }) -join ", "
    Write-Warning "Could not verify the executable path for dayweave process(es): $ids. They will not be stopped."
}

if ($matchingProcesses.Count -gt 0 -and -not $StopRunningApp) {
    $ids = ($matchingProcesses | ForEach-Object { $_.Id }) -join ", "
    throw "The repository development executable is running (PID: $ids). Re-run with -StopRunningApp after packaging is authorized."
}

foreach ($process in $matchingProcesses) {
    Write-Host "Stopping repository development executable PID $($process.Id): $expectedExecutable"
    Stop-Process -Id $process.Id -Force
    if (-not $process.WaitForExit(10000)) {
        throw "Timed out waiting for repository development executable PID $($process.Id) to stop."
    }
}

$buildStartedAtUtc = [DateTime]::UtcNow
$buildArguments = @("run", "tauri:build", "--", "--no-bundle", "--ci")
$bundleArguments = @("run", "tauri", "--", "bundle", "--bundles", "nsis", "--ci")
if ($Configuration -eq "Debug") {
    $debugConfig = Join-Path $repositoryRoot "src-tauri\tauri.debug.conf.json"
    $buildArguments += @("--debug", "--config", $debugConfig)
    $bundleArguments += @("--debug", "--config", $debugConfig)
    Write-Host "Debug installer: fast zlib compression (larger than LZMA); build caches are preserved."
}

$originalPath = $env:PATH
Push-Location $repositoryRoot
try {
    $env:PATH = "$(Join-Path $env:USERPROFILE '.cargo\bin');$originalPath"
    Write-Host "[1/3] Building frontend and Rust application (incremental cache enabled)..."
    $stageTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $buildExitCode = Invoke-DayweaveNpm -Arguments $buildArguments
    if ($buildExitCode -ne 0) {
        throw "Tauri build failed with exit code $buildExitCode."
    }
    Assert-DayweaveArtifactIntegrity -LiteralPath $expectedExecutable
    $timings.buildSeconds = [Math]::Round($stageTimer.Elapsed.TotalSeconds, 2)
    Write-Host "[1/3] Build completed in $($timings.buildSeconds) s."

    Write-Host "[2/3] Generating NSIS installer without recompiling..."
    $stageTimer.Restart()
    $bundleExitCode = Invoke-DayweaveNpm -Arguments $bundleArguments
    if ($bundleExitCode -ne 0) {
        throw "Tauri bundling failed with exit code $bundleExitCode."
    }
    $timings.bundleSeconds = [Math]::Round($stageTimer.Elapsed.TotalSeconds, 2)
    Write-Host "[2/3] Installer generated in $($timings.bundleSeconds) s."
}
finally {
    $env:PATH = $originalPath
    Pop-Location
}

Write-Host "[3/3] Verifying artifact integrity, installer freshness and SHA-256..."
$stageTimer.Restart()
$bundleDirectory = Join-Path $repositoryRoot "src-tauri\target\$targetName\bundle\nsis"
$installer = Get-ChildItem -LiteralPath $bundleDirectory -File -Filter "*.exe" |
    Where-Object { $_.Name -like "*setup.exe" } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if ($null -eq $installer) {
    throw "Packaging completed but no NSIS setup executable was found in '$bundleDirectory'."
}

if ($installer.LastWriteTimeUtc -lt $buildStartedAtUtc.AddSeconds(-5)) {
    throw "The newest installer predates this build, so artifact freshness could not be verified: '$($installer.FullName)'."
}

Assert-DayweaveArtifactIntegrity -LiteralPath $expectedExecutable
Assert-DayweaveArtifactIntegrity -LiteralPath $installer.FullName

$hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
$timings.verificationSeconds = [Math]::Round($stageTimer.Elapsed.TotalSeconds, 2)
$timings.totalSeconds = [Math]::Round($totalTimer.Elapsed.TotalSeconds, 2)
Write-Host "[3/3] Verification completed in $($timings.verificationSeconds) s; total $($timings.totalSeconds) s."
$result = [ordered]@{
    configuration = $Configuration
    installerPath = $installer.FullName
    bytes = $installer.Length
    mebibytes = [Math]::Round($installer.Length / 1MB, 2)
    sha256 = $hash.Hash
    builtAtUtc = $installer.LastWriteTimeUtc.ToString("o")
    integrity = @{ executable = 'not-low'; installer = 'not-low' }
    timings = $timings
}

Write-Output ("DAYWEAVE_PACKAGE_RESULT=" + ($result | ConvertTo-Json -Compress))
