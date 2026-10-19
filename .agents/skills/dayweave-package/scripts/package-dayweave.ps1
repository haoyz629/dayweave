[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",

    [switch]$StopRunningApp
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'invoke-dayweave-npm.ps1')
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

Write-Host "[3/3] Verifying installer freshness and SHA-256..."
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
    timings = $timings
}

Write-Output ("DAYWEAVE_PACKAGE_RESULT=" + ($result | ConvertTo-Json -Compress))
