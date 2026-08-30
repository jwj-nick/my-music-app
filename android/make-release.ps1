# APK 릴리스 스크립트 — render-ext의 set-version.ps1+make-zip.ps1+gh release 패턴을
# APK 하나짜리로 단순화한 버전. decisions.md #60 참고.
#
# 사용법 (repo 루트에서 또는 android/ 안에서):
#   powershell -File android/make-release.ps1 -Version 0.1.1 -Notes "재생 큐 버그 수정"
#
# 하는 일: 디버그 빌드 -> 버전 고정본 + latest 별칭 두 자산으로 -> git 태그 -> gh release.
# versionName(build.gradle.kts)은 이 스크립트가 안 건드림 — 의미 있을 때 수동으로 올릴 것.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Notes = "디버그 빌드 갱신."
)
$ErrorActionPreference = "Stop"

$androidDir = $PSScriptRoot
$repoRoot = Split-Path -Parent $androidDir
$jdk = "C:\Users\admin\scoop\apps\temurin17-jdk\current"
$gradle = "C:\Users\admin\scoop\apps\gradle\current\bin\gradle.bat"

if (-not (Test-Path $jdk)) { throw "JDK가 안 보임: $jdk (scoop install temurin17-jdk)" }
if (-not (Test-Path $gradle)) { throw "Gradle이 안 보임: $gradle (scoop install gradle)" }

$env:JAVA_HOME = $jdk
Push-Location $androidDir
try {
    & $gradle assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "gradle assembleDebug 실패" }
} finally {
    Pop-Location
}

$apk = Join-Path $androidDir "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "빌드 산출물을 못 찾음: $apk" }

$distDir = Join-Path $env:TEMP "mma-release"
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$versioned = Join-Path $distDir "my-music-app-v$Version-debug.apk"
$latest = Join-Path $distDir "my-music-app-latest-debug.apk"
Copy-Item $apk $versioned -Force
Copy-Item $apk $latest -Force

Push-Location $repoRoot
try {
    git tag "v$Version"
    git push origin "v$Version"
    gh release create "v$Version" $versioned $latest `
        --repo jwj-nick/my-music-app `
        --title "v$Version" `
        --notes $Notes
} finally {
    Pop-Location
}

Write-Output "완료: https://github.com/jwj-nick/my-music-app/releases/tag/v$Version"
Write-Output "고정 링크(항상 최신, 버전 안 바뀜): https://github.com/jwj-nick/my-music-app/releases/latest/download/my-music-app-latest-debug.apk"
