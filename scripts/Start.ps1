param([switch]$FrontendOnly, [switch]$Build)
. "$PSScriptRoot/Common.ps1"
Set-Location $projectRoot
if (!(Test-Path 'node_modules')) { & $npmExe ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' } }
if (!$FrontendOnly) {
    Use-Java
    $localFile = "$runtimeRoot/local.json"
    if (!(Test-Path $localFile)) {
        $randomPassword = { [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(36)) }
        @{ rootPassword=(& $randomPassword); dbPassword=(& $randomPassword); workerKey=(& $randomPassword) } | ConvertTo-Json | Set-Content -LiteralPath $localFile -Encoding utf8
    }
    $local = Get-Content -LiteralPath $localFile -Raw | ConvertFrom-Json
    $mysql = Get-Command mysqld.exe -ErrorAction SilentlyContinue
    $mysqlVersion = if ($mysql) { (& $mysql.Source --version | Out-String) } else { '' }
    $mysqlBase = if ($mysqlVersion -match 'Ver 8\.4\.') { Split-Path (Split-Path $mysql.Source -Parent) -Parent } else { "$projectRoot/.tools/mysql-8.4.13-winx64" }
    if (!(Test-Path "$mysqlBase/bin/mysqld.exe")) { throw 'Run scripts/Prepare-Backend.ps1 first.' }
    $mysqlData = "$runtimeRoot/mysql-data"
    $initFile = "$runtimeRoot/mysql-init.sql"
    $initArgs = @()
    if (!(Test-Path "$mysqlData/mysql")) {
        & "$mysqlBase/bin/mysqld.exe" --no-defaults --initialize-insecure "--basedir=$mysqlBase" "--datadir=$mysqlData" "--log-error=$runtimeRoot/logs/mysql-init.log"
        if ($LASTEXITCODE -ne 0) { throw 'Project MySQL initialization failed' }
        @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$($local.rootPassword)';
CREATE DATABASE diagram_studio CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'diagram_app'@'localhost' IDENTIFIED BY '$($local.dbPassword)';
GRANT ALL PRIVILEGES ON diagram_studio.* TO 'diagram_app'@'localhost';
"@ | Set-Content -LiteralPath $initFile -Encoding utf8
    }
    # Retry the initialization file after an interrupted first startup.
    if (Test-Path $initFile) { $initArgs = @("--init-file=$initFile") }
    Start-ProjectProcess 'mysql' "$mysqlBase/bin/mysqld.exe" (@('--no-defaults', "--basedir=$mysqlBase", "--datadir=$mysqlData", '--bind-address=127.0.0.1', '--port=3307', '--mysqlx=0', '--skip-log-bin', "--log-error=$runtimeRoot/logs/mysql.log") + $initArgs) 3307
    Wait-ProjectPort 3307
    if (Test-Path $initFile) { Remove-Item -LiteralPath $initFile }
    $env:DB_PASSWORD = $local.dbPassword
    $env:WORKER_KEY = $local.workerKey
    $env:EXPORT_DIRECTORY = "$runtimeRoot/exports"
    $env:CHROME_PATH = @($env:CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (!$env:CHROME_PATH) { throw 'Install Chrome/Edge or set CHROME_PATH to an existing browser.' }
    $workerEntry = @(Read-Processes | Where-Object { $_.name -eq 'worker' -and (Same-Process $_) }) | Select-Object -First 1
    $workerSource = (Get-ChildItem "$projectRoot/server/worker.mjs", "$projectRoot/src/modules/er/domain", "$projectRoot/public/fonts" -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.Ticks
    if ($workerEntry -and ($Build -or $workerSource -gt [long]$workerEntry.started)) { & "$PSScriptRoot/Stop.ps1" -Service worker }
    Start-ProjectProcess 'worker' $nodeExe @('--import', 'tsx', "$projectRoot/server/worker.mjs") 3001
    Wait-ProjectPort 3001
    $jar = "$projectRoot/server/api/target/diagram-api-0.1.0.jar"
    $newestSource = (Get-ChildItem "$projectRoot/server/api/src", "$projectRoot/server/api/pom.xml" -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
    if ($Build -or !(Test-Path $jar) -or (Get-Item $jar).LastWriteTimeUtc -lt $newestSource) {
        & "$PSScriptRoot/Stop.ps1" -Service api
        & $mavenExe -B -q "-Dmaven.repo.local=$projectRoot/.cache/maven" -f server/api/pom.xml package
        if ($LASTEXITCODE -ne 0) { throw 'API build or tests failed' }
    }
    Start-ProjectProcess 'api' "$env:JAVA_HOME/bin/java.exe" @("-Djava.io.tmpdir=$runtimeRoot/tmp", '-jar', $jar) 8080
    Wait-ProjectPort 8080
}
Start-ProjectProcess 'frontend' $nodeExe @("$projectRoot/node_modules/vite/bin/vite.js", '--host', '127.0.0.1') 5173
Wait-ProjectPort 5173
Write-Output 'Open http://127.0.0.1:5173/ in your browser.'
