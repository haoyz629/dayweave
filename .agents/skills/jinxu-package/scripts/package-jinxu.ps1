[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",

    [switch]$StopRunningApp
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$targetName = $Configuration.ToLowerInvariant()
$expectedExecutable = [System.IO.Path]::GetFullPath(
    (Join-Path $repositoryRoot "src-tauri\target\$targetName\jinxu.exe")
)

$matchingProcesses = @()
$unverifiedProcesses = @()
foreach ($process in @(Get-Process -Name "jinxu" -ErrorAction SilentlyContinue)) {
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
        Write-Warning "Ignoring jinxu process $($process.Id) because its path is '$processPath', not '$expectedExecutable'."
    }
}

if ($unverifiedProcesses.Count -gt 0) {
    $ids = ($unverifiedProcesses | ForEach-Object { $_.Id }) -join ", "
    Write-Warning "Could not verify the executable path for jinxu process(es): $ids. They will not be stopped."
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
$npmArguments = @("run", "tauri:build", "--")
if ($Configuration -eq "Debug") {
    $npmArguments += "--debug"
}

Push-Location $repositoryRoot
try {
    & npm @npmArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri packaging failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

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
$result = [ordered]@{
    configuration = $Configuration
    installerPath = $installer.FullName
    bytes = $installer.Length
    mebibytes = [Math]::Round($installer.Length / 1MB, 2)
    sha256 = $hash.Hash
    builtAtUtc = $installer.LastWriteTimeUtc.ToString("o")
}

Write-Output ("JINXU_PACKAGE_RESULT=" + ($result | ConvertTo-Json -Compress))
