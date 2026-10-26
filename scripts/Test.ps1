param([switch]$UnitOnly)
. "$PSScriptRoot/Common.ps1"
Set-Location $projectRoot
& $npmExe test
if ($LASTEXITCODE -ne 0) { throw 'Frontend unit tests failed' }
& $npmExe run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend production build failed' }
Use-Java
& $mavenExe -B -ntp "-Dmaven.repo.local=$projectRoot/.cache/maven" -f server/api/pom.xml verify
if ($LASTEXITCODE -ne 0) { throw 'Backend verification failed' }
if (!$UnitOnly) {
    & "$PSScriptRoot/Start.ps1"
    & $npmExe run test:e2e
    if ($LASTEXITCODE -ne 0) { throw 'Browser acceptance failed; see .runtime/test-results' }
    & $nodeExe --import tsx scripts/verify-expiry.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Actual expiration cleanup verification failed' }
    & $nodeExe --import tsx scripts/verify-model-editing.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Double-click, foreign key editing or self-reference verification failed' }
}
Write-Output 'Requested project checks passed.'
