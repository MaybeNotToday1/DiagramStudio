param([switch]$SkipMySQL)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$env:TEMP = Join-Path $projectRoot '.runtime/tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP, "$projectRoot/.tools", "$projectRoot/.runtime/downloads" | Out-Null
function Get-PortableArchive($Name, $Url, $Algorithm, $Checksum) {
    $archive = Join-Path $projectRoot ".runtime/downloads/$Name"
    if (!(Test-Path $archive)) {
        $part = "$archive.part"
        & curl.exe --fail --location --retry 3 --silent --show-error --output $part $Url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $Name" }
        Move-Item -LiteralPath $part -Destination $archive -Force
    }
    if ((Get-FileHash $archive -Algorithm $Algorithm).Hash -ne $Checksum) { throw "Checksum failed: $Name" }
    Expand-Archive -LiteralPath $archive -DestinationPath "$projectRoot/.tools" -Force
}
$java = Get-Command java -ErrorAction SilentlyContinue
$javaText = if ($java) { (& $java.Source -version 2>&1 | Out-String) } else { '' }
if ($javaText -notmatch 'version "21\.') {
    if (!(Get-ChildItem "$projectRoot/.tools" -Directory -Filter 'jdk-21*')) {
        Get-PortableArchive 'jdk21.zip' 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip' 'SHA256' 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e'
    }
}
$maven = Get-Command mvn -ErrorAction SilentlyContinue
$mavenText = if ($maven) { (& $maven.Source -v 2>&1 | Out-String) } else { '' }
if ($mavenText -notmatch 'Apache Maven 3\.9\.') {
    if (!(Test-Path "$projectRoot/.tools/apache-maven-3.9.16")) {
        $url = 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.16/apache-maven-3.9.16-bin.zip'
        $hash = (Invoke-RestMethod "$url.sha512").Trim().Split(' ')[0]
        Get-PortableArchive 'maven.zip' $url 'SHA512' $hash
    }
}
if (!$SkipMySQL) {
    $mysql = Get-Command mysqld -ErrorAction SilentlyContinue
    $mysqlText = if ($mysql) { (& $mysql.Source --version | Out-String) } else { '' }
    if ($mysqlText -notmatch 'Ver 8\.4\.') {
        if (!(Test-Path "$projectRoot/.tools/mysql-8.4.13-winx64")) {
            Get-PortableArchive 'mysql84.zip' 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.13-winx64.zip' 'MD5' '7b94489d5524dea9b27097068bea25a8'
        }
    }
}
Write-Output 'Project backend tools are ready. No global environment or Windows services were changed.'
