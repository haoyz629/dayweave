function Invoke-DayweaveNpm {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    # npm.ps1 can promote ordinary native stderr into a terminating PowerShell error.
    # Inherit native output handles and judge success by the actual process exit code.
    $npmCommand = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $tokens = @($npmCommand) + $Arguments
    foreach ($token in $tokens) {
        if ($token -match '["%\r\n]') {
            throw 'Unsupported quote, percent sign, or newline in npm command arguments.'
        }
    }
    $command = ($tokens | ForEach-Object { '"' + $_ + '"' }) -join ' '
    # Wait only for npm's command process, not PowerShell's job/process-tree wait.
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.WorkingDirectory = (Get-Location).Path
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /s /c "' + $command + '"'
    $startInfo.UseShellExecute = $false
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $process.WaitForExit()
        return $process.ExitCode
    }
    finally {
        $process.Dispose()
    }
}
