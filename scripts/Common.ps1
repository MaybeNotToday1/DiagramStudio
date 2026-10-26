$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Force "$runtimeRoot/tmp", "$runtimeRoot/logs", "$projectRoot/.cache" | Out-Null
$env:TEMP = "$runtimeRoot/tmp"
$env:TMP = $env:TEMP
$env:npm_config_cache = "$projectRoot/.cache/npm"
$env:PLAYWRIGHT_BROWSERS_PATH = "$projectRoot/.tools/playwright"
function Find-Tool($Name, $Candidates) {
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    foreach ($candidate in $Candidates) { if (Test-Path -LiteralPath $candidate) { return (Resolve-Path $candidate).Path } }
    throw "Missing tool $Name. See docs/DEVELOPMENT.md."
}
$nodeExe = Find-Tool 'node.exe' @('D:/develop/nodejs/node.exe', "$projectRoot/.tools/node/node.exe")
$npmExe = Join-Path (Split-Path $nodeExe -Parent) 'npm.cmd'
function Use-Java {
    $java = Get-Command java -ErrorAction SilentlyContinue
    $version = if ($java) { (& $java.Source -version 2>&1 | Out-String) } else { '' }
    if ($version -match 'version "21\.') { $env:JAVA_HOME = Split-Path (Split-Path $java.Source -Parent) -Parent }
    else {
        $jdk = if (Test-Path "$projectRoot/.tools") { Get-ChildItem "$projectRoot/.tools" -Directory -Filter 'jdk-21*' | Select-Object -First 1 }
        if (!$jdk) { throw 'Run scripts/Prepare-Backend.ps1 to prepare project JDK 21.' }
        $env:JAVA_HOME = $jdk.FullName
    }
    $env:Path = "$env:JAVA_HOME/bin;$(Split-Path $nodeExe -Parent);$env:Path"
    $maven = Get-Command mvn.cmd -ErrorAction SilentlyContinue
    $version = if ($maven) { (& $maven.Source -v 2>&1 | Out-String) } else { '' }
    if ($version -match 'Apache Maven 3\.9\.') { $script:mavenExe = $maven.Source }
    else {
        $script:mavenExe = "$projectRoot/.tools/apache-maven-3.9.16/bin/mvn.cmd"
        if (!(Test-Path -LiteralPath $script:mavenExe)) { throw 'Run scripts/Prepare-Backend.ps1 to prepare project Maven.' }
    }
}
function Test-Port($Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $task = $client.ConnectAsync('127.0.0.1', $Port); if (!$task.Wait(300)) { return $false }; return $client.Connected } catch { return $false } finally { $client.Dispose() }
}
function Read-Processes {
    $file = "$runtimeRoot/processes.json"
    if (Test-Path $file) { return @(Get-Content -LiteralPath $file -Raw | ConvertFrom-Json) }
    return @()
}
function Same-Process($Entry) {
    $process = Get-Process -Id $Entry.pid -ErrorAction SilentlyContinue
    return $process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Entry.started -and $process.Path -eq $Entry.binary
}
function Start-ProjectProcess($Name, $Binary, $Arguments, $Port) {
    $entries = @(Read-Processes | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue })
    if ($entries | Where-Object { $_.name -eq $Name }) { Write-Output "$Name already running"; return }
    if (Test-Port $Port) { throw "Port $Port is occupied. No existing process was stopped." }
    $quoted = @($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' })
    $process = Start-Process -FilePath $Binary -ArgumentList $quoted -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtimeRoot/logs/$Name.out.log" -RedirectStandardError "$runtimeRoot/logs/$Name.err.log"
    $process.Refresh()
    $entries += [pscustomobject]@{ name=$Name; pid=$process.Id; started=$process.StartTime.ToUniversalTime().Ticks.ToString(); binary=(Resolve-Path -LiteralPath $Binary).Path }
    $entries | ConvertTo-Json -AsArray | Set-Content -LiteralPath "$runtimeRoot/processes.json" -Encoding utf8
    Write-Output "$Name started (project process)"
}
function Wait-ProjectPort($Port, $Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) { if (Test-Port $Port) { return }; Start-Sleep -Milliseconds 300 }
    throw "Project service on port $Port did not start. Check .runtime/logs (do not share credentials)."
}
