# Regression tests use command mocks: no compilation, packaging, or process termination.
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot 'package-dayweave.ps1'
$tempRoot = if ($env:PI_SCRATCH_DIR) { $env:PI_SCRATCH_DIR } else { [IO.Path]::GetTempPath() }
$fixture = Join-Path $tempRoot ("dayweave-package-test-{0}.exe" -f [Guid]::NewGuid())
[IO.File]::WriteAllText($fixture, 'installer fixture')
$mockState = @{ Calls = $null; Processes = $null; Scenario = $null; BundleDirectory = $null }

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

function Get-Process { param($Name, $ErrorAction) }
function Stop-Process { throw 'Tests must never stop a process.' }
function New-Object {
    param([string]$TypeName)
    if ($TypeName -eq 'Diagnostics.ProcessStartInfo') {
        return [Diagnostics.ProcessStartInfo]::new()
    }
    if ($TypeName -ne 'Diagnostics.Process') { throw "Unexpected constructed type: $TypeName" }
    $process = [PSCustomObject]@{
        StartInfo = $null; ExitCode = 0; Waited = $false; Disposed = $false; State = $mockState
    }
    $process | Add-Member -MemberType ScriptMethod -Name Start -Value {
        Assert-True ($this.StartInfo.FileName -eq $env:ComSpec) 'npm runs through cmd.exe'
        Assert-True (-not $this.StartInfo.UseShellExecute) 'native process without shell execution'
        Assert-True (-not $this.StartInfo.RedirectStandardOutput -and -not $this.StartInfo.RedirectStandardError) 'native output inherited'
        $tokens = @([regex]::Matches($this.StartInfo.Arguments, '"([^"\r\n]+)"') | ForEach-Object { $_.Groups[1].Value })
        Assert-True ($tokens[0] -like '*npm.cmd') 'explicit npm.cmd, never npm.ps1'
        $this.State.Calls.Add(@($tokens | Select-Object -Skip 1))
        $this.State.Processes.Add($this)
        if (($this.State.Scenario -eq 'build-failure' -and $this.State.Calls.Count -eq 1) -or
            ($this.State.Scenario -eq 'bundle-failure' -and $this.State.Calls.Count -eq 2)) {
            $this.ExitCode = 23
        }
        return $true
    }
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { $this.Waited = $true }
    $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true }
    return $process
}
function Get-ChildItem {
    param($LiteralPath, [switch]$File, $Filter)
    $mockState.BundleDirectory = $LiteralPath
    if ($mockState.Scenario -eq 'missing') { return }
    $writtenAt = [DateTime]::UtcNow
    if ($mockState.Scenario -eq 'stale') { $writtenAt = $writtenAt.AddHours(-1) }
    [PSCustomObject]@{
        Name = 'dayweave-setup.exe'
        FullName = $fixture
        Length = (Get-Item -LiteralPath $fixture).Length
        LastWriteTimeUtc = $writtenAt
    }
}

try {
    foreach ($case in @(
        @{ Name = 'debug'; Configuration = 'Debug'; Error = $null; Calls = 2 },
        @{ Name = 'release'; Configuration = 'Release'; Error = $null; Calls = 2 },
        @{ Name = 'build-failure'; Configuration = 'Debug'; Error = '*build failed*23*'; Calls = 1 },
        @{ Name = 'bundle-failure'; Configuration = 'Debug'; Error = '*bundling failed*23*'; Calls = 2 },
        @{ Name = 'missing'; Configuration = 'Debug'; Error = '*no NSIS setup executable*'; Calls = 2 },
        @{ Name = 'stale'; Configuration = 'Debug'; Error = '*predates this build*'; Calls = 2 }
    )) {
        $mockState.Scenario = $case.Name
        $mockState.Calls = [Collections.Generic.List[object]]::new()
        $mockState.Processes = [Collections.Generic.List[object]]::new()
        $mockState.BundleDirectory = $null
        $previousPath = $env:PATH
        $previousLocation = (Get-Location).Path
        $caught = $null
        $output = @()
        try { $output = @(& $helper -Configuration $case.Configuration) }
        catch { $caught = $_.Exception.Message }

        Assert-True ($env:PATH -eq $previousPath) "$($case.Name): PATH restored"
        Assert-True ((Get-Location).Path -eq $previousLocation) "$($case.Name): location restored"
        Assert-True ($mockState.Calls.Count -eq $case.Calls) "$($case.Name): command count; error '$caught'"
        foreach ($process in $mockState.Processes) {
            Assert-True ($process.Waited) 'wait for command process before returning'
            Assert-True ($process.Disposed) 'dispose process on success and failure'
        }
        $buildCall = $mockState.Calls[0]
        Assert-True (($buildCall[0..3] -join ' ') -eq 'run tauri:build -- --no-bundle') 'build skips bundling'
        Assert-True ($buildCall -contains '--ci') 'build does not prompt'
        if ($case.Calls -eq 2) {
            $bundleCall = $mockState.Calls[1]
            Assert-True (($bundleCall[0..5] -join ' ') -eq 'run tauri -- bundle --bundles nsis') 'bundle command does not rebuild'
            Assert-True ($bundleCall -contains '--ci') 'bundle does not prompt'
        }
        foreach ($call in $mockState.Calls) {
            if ($case.Configuration -eq 'Debug') {
                Assert-True ($call -contains '--debug') 'Debug flag preserved'
                $configIndex = [Array]::IndexOf($call, '--config')
                Assert-True ($configIndex -ge 0) 'Debug config supplied'
                $config = Get-Content -Raw -LiteralPath $call[$configIndex + 1] | ConvertFrom-Json
                Assert-True ($config.bundle.windows.nsis.compression -eq 'zlib') 'Debug uses zlib'
            }
            else {
                Assert-True (-not ($call -contains '--debug')) 'Release does not use Debug'
                Assert-True (-not ($call -contains '--config')) 'Release keeps original compression'
            }
        }
        if ($case.Error) {
            Assert-True ($caught -like $case.Error) "$($case.Name): expected error, got '$caught'"
            Assert-True (-not ($output -match '^DAYWEAVE_PACKAGE_RESULT=')) 'failure cannot report success'
        }
        else {
            Assert-True ($null -eq $caught) "$($case.Name): unexpected error '$caught'"
            $resultLines = @($output | Where-Object { $_ -like 'DAYWEAVE_PACKAGE_RESULT=*' })
            Assert-True ($resultLines.Count -eq 1) 'exactly one result'
            $result = $resultLines[0].Substring('DAYWEAVE_PACKAGE_RESULT='.Length) | ConvertFrom-Json
            Assert-True ($result.sha256 -eq (Get-FileHash $fixture -Algorithm SHA256).Hash) 'real SHA-256'
            Assert-True ($result.bytes -eq (Get-Item $fixture).Length) 'exact byte size'
            Assert-True ($result.configuration -eq $case.Configuration) 'result configuration'
            Assert-True ($mockState.BundleDirectory -like "*\target\$($case.Configuration.ToLowerInvariant())\bundle\nsis") 'correct bundle directory'
            foreach ($field in @('buildSeconds', 'bundleSeconds', 'verificationSeconds', 'totalSeconds')) {
                Assert-True ($null -ne $result.timings.$field -and $result.timings.$field -ge 0) "timing $field"
            }
        }
        Write-Host "PASS: $($case.Name)"
    }
    Write-Host 'All 6 packaging regression tests passed (mock commands only).'
}
finally {
    Remove-Item -LiteralPath $fixture -Force
}
