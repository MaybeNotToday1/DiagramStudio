$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$env:DOCKER_CONFIG = "$projectRoot/.runtime/docker"
$compose = "$projectRoot/.tools/docker-compose.exe"
if (!(Test-Path $compose)) { throw 'Use Docker Compose on the server, or place the official standalone Compose CLI in .tools/docker-compose.exe.' }
& $compose --env-file deploy/.env.example -f deploy/compose.yml config --quiet
if ($LASTEXITCODE -ne 0) { throw 'HTTP deployment configuration is invalid' }
& $compose --env-file deploy/.env.example -f deploy/compose.yml -f deploy/compose.https.yml config --quiet
if ($LASTEXITCODE -ne 0) { throw 'HTTPS deployment configuration is invalid' }
Write-Output 'HTTP and HTTPS Compose configuration checks passed. This does not start containers or verify server deployment.'
