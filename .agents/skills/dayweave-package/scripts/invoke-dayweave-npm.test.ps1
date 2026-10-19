# Real native processes only; no compilation, packaging, or application termination.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'invoke-dayweave-npm.ps1')
$tempRoot = if ($env:PI_SCRATCH_DIR) { $env:PI_SCRATCH_DIR } else { [IO.Path]::GetTempPath() }
$fixture = Join-Path $tempRoot ("dayweave npm test {0}" -f [Guid]::NewGuid())
$originalPath = $env:PATH
$previousExpected = $env:DAYWEAVE_NPM_TEST_ARGUMENT
$previousChildDirectory = $env:DAYWEAVE_NPM_TEST_CHILD_DIR
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
try {
    [void][IO.Directory]::CreateDirectory($fixture)
    [IO.File]::WriteAllText((Join-Path $fixture 'fixture.cjs'), @'
const assert = require('node:assert/strict');
assert.equal(process.argv[3], '--config');
assert.equal(process.argv[4], process.env.DAYWEAVE_NPM_TEST_ARGUMENT);
process.stdout.write('native stdout preserved\n');
process.stderr.write('Info: native stderr is not a PowerShell exception\n');
if (process.argv[2] === 'spawn-child') {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const child = spawn(process.execPath, [path.join(__dirname, 'child.cjs')], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
} else {
  process.exit(Number(process.argv[2]));
}
'@)
    [IO.File]::WriteAllText((Join-Path $fixture 'npm.cmd'), ('@echo off' + "`r`n" + '@"' + $node + '" "%~dp0fixture.cjs" %*' + "`r`n" + 'exit /b %errorlevel%' + "`r`n"))
    [IO.File]::WriteAllText((Join-Path $fixture 'npm.ps1'), "throw 'npm.ps1 must never be invoked.'")
    [IO.File]::WriteAllText((Join-Path $fixture 'child.cjs'), @'
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.DAYWEAVE_NPM_TEST_CHILD_DIR;
const started = Date.now();
const timer = setInterval(() => {
  if (fs.existsSync(path.join(root, 'child.release')) || Date.now() - started > 10000) {
    fs.writeFileSync(path.join(root, 'child.finished'), 'done');
    clearInterval(timer);
  }
}, 25);
'@)
    $env:PATH = "$fixture;$originalPath"
    # Build Chinese text from Unicode code points so Windows PowerShell reads this test without a BOM.
    $chinese = [string][char]0x4ECA + [char]0x5E8F
    $env:DAYWEAVE_NPM_TEST_ARGUMENT = Join-Path $fixture "$chinese & (preview)\tauri debug.json"
    foreach ($expected in @(0, 23)) {
        $actual = Invoke-DayweaveNpm -Arguments @([string]$expected, '--config', $env:DAYWEAVE_NPM_TEST_ARGUMENT)
        if ($actual -ne $expected) { throw "Exit code mismatch: expected $expected, got $actual" }
        Write-Host "PASS: native stderr with exit $expected; quoted space/Chinese/metacharacter path preserved"
    }
    $env:DAYWEAVE_NPM_TEST_CHILD_DIR = $fixture
    $actual = Invoke-DayweaveNpm -Arguments @('spawn-child', '--config', $env:DAYWEAVE_NPM_TEST_ARGUMENT)
    if ($actual -ne 0) { throw "Child-process fixture failed: $actual" }
    if (Test-Path (Join-Path $fixture 'child.finished')) {
        throw 'npm invocation waited for the independent descendant instead of the command process.'
    }
    [IO.File]::WriteAllText((Join-Path $fixture 'child.release'), 'release')
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path (Join-Path $fixture 'child.finished'))) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Child-process fixture did not finish.' }
        Start-Sleep -Milliseconds 25
    }
    Write-Host 'PASS: return when command exits without waiting for independent descendant'
    foreach ($unsafe in @('bad"argument', '%PATH%', "bad`nargument")) {
        $caught = $false
        try { Invoke-DayweaveNpm -Arguments @($unsafe) | Out-Null }
        catch {
            if ($_.Exception.Message -notlike 'Unsupported*') { throw }
            $caught = $true
        }
        if (-not $caught) { throw 'Unsafe command argument was accepted.' }
    }
    Write-Host 'PASS: unsupported command arguments rejected before execution'
    Write-Host 'All native npm invocation tests passed.'
}
finally {
    if (Test-Path -LiteralPath $fixture) {
        [IO.File]::WriteAllText((Join-Path $fixture 'child.release'), 'release')
    }
    $env:PATH = $originalPath
    $env:DAYWEAVE_NPM_TEST_ARGUMENT = $previousExpected
    $env:DAYWEAVE_NPM_TEST_CHILD_DIR = $previousChildDirectory
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
