param([ValidateSet('all', 'api', 'worker', 'frontend', 'mysql')][string]$Service = 'all')
. "$PSScriptRoot/Common.ps1"
$entries = @(Read-Processes)
foreach ($name in @('frontend', 'api', 'worker', 'mysql')) {
    foreach ($entry in @($entries | Where-Object { $_.name -eq $name -and ($Service -eq 'all' -or $Service -eq $_.name) })) {
        if (Same-Process $entry) {
            if ($name -eq 'worker' -and (Test-Path "$runtimeRoot/local.json")) {
                $local = Get-Content "$runtimeRoot/local.json" -Raw | ConvertFrom-Json
                try { Invoke-WebRequest 'http://127.0.0.1:3001/shutdown' -Method Post -Headers @{ 'X-Worker-Key'=$local.workerKey } -TimeoutSec 5 | Out-Null } catch { }
                Start-Sleep -Milliseconds 500
            }
            if ($name -eq 'mysql' -and (Test-Path "$runtimeRoot/local.json")) {
                $local = Get-Content "$runtimeRoot/local.json" -Raw | ConvertFrom-Json
                $clientFile = "$runtimeRoot/mysql-stop.cnf"
                try {
                    "[client]`nuser=root`npassword=$($local.rootPassword)`n" | Set-Content -LiteralPath $clientFile -Encoding utf8
                    $admin = Join-Path (Split-Path $entry.binary -Parent) 'mysqladmin.exe'
                    & $admin "--defaults-extra-file=$clientFile" --protocol=TCP --host=127.0.0.1 --port=3307 shutdown 2>$null
                } finally { Remove-Item -LiteralPath $clientFile -ErrorAction SilentlyContinue }
            }
            if (Same-Process $entry) { & taskkill.exe /PID $entry.pid /T /F | Out-Null }
            Write-Output "$name stopped"
        }
    }
}
@(Read-Processes | Where-Object { Same-Process $_ }) | ConvertTo-Json -AsArray | Set-Content -LiteralPath "$runtimeRoot/processes.json" -Encoding utf8
