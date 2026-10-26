. "$PSScriptRoot/Common.ps1"
$localFile = "$runtimeRoot/local.json"
$nextFile = "$runtimeRoot/local.next.json"
$clientFile = "$runtimeRoot/rotate-client.cnf"
$sqlFile = "$runtimeRoot/rotate.sql"
$entry = @(Read-Processes | Where-Object { $_.name -eq 'mysql' -and (Same-Process $_) }) | Select-Object -First 1
if (!$entry -or !(Test-Path $localFile)) { throw 'Start the project MySQL before rotating project-local secrets.' }
if (Test-Path $nextFile) { throw 'A previous rotation needs review. Keep .runtime/local.next.json private and recover it before retrying.' }
$mysql = Join-Path (Split-Path $entry.binary -Parent) 'mysql.exe'
$local = Get-Content -LiteralPath $localFile -Raw | ConvertFrom-Json
$random = { [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(36)) }
$next = @{ rootPassword=(& $random); dbPassword=(& $random); workerKey=(& $random) }
$next | ConvertTo-Json | Set-Content -LiteralPath $nextFile -Encoding utf8
try {
    & "$PSScriptRoot/Stop.ps1" -Service frontend
    & "$PSScriptRoot/Stop.ps1" -Service api
    & "$PSScriptRoot/Stop.ps1" -Service worker
    "[client]`nuser=root`npassword=$($local.rootPassword)`nhost=127.0.0.1`nport=3307`nprotocol=TCP`n" | Set-Content -LiteralPath $clientFile -Encoding utf8
    "ALTER USER 'root'@'localhost' IDENTIFIED BY '$($next.rootPassword)', 'diagram_app'@'localhost' IDENTIFIED BY '$($next.dbPassword)';" | Set-Content -LiteralPath $sqlFile -Encoding utf8
    $process = Start-Process -FilePath $mysql -ArgumentList @("`"--defaults-extra-file=$clientFile`"", '--batch', '--silent') -WindowStyle Hidden -Wait -PassThru -RedirectStandardInput $sqlFile -RedirectStandardOutput "$runtimeRoot/logs/rotation.out.log" -RedirectStandardError "$runtimeRoot/logs/rotation.err.log"
    if ($process.ExitCode -ne 0) { throw 'Project credential rotation failed. Keep local.next.json private for recovery; no other database instance was used.' }
    Move-Item -LiteralPath $nextFile -Destination $localFile -Force
} finally {
    Remove-Item -LiteralPath $clientFile -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sqlFile -ErrorAction SilentlyContinue
}
& "$PSScriptRoot/Start.ps1"
Write-Output 'Project-local database credentials and worker key rotated. Values were not printed.'
