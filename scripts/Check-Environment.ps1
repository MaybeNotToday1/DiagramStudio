. "$PSScriptRoot/Common.ps1"
Write-Output "Project: $projectRoot"
Write-Output "Node: $(& $nodeExe --version)"
Write-Output "npm: $(& $npmExe --version)"
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { & $git.Source --version }
$chromeCandidates = @('C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
Write-Output ('Browser: ' + (($chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1) -join ''))
Write-Output 'Local tools:'
if (Test-Path "$projectRoot/.tools") { Get-ChildItem "$projectRoot/.tools" -Directory | Select-Object -ExpandProperty Name }
foreach ($port in @(5173, 8080, 3001, 3307)) { Write-Output "Port $port listening: $(Test-Port $port)" }
