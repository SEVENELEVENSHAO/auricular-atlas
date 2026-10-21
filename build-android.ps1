$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Resolve-FirstExistingPath([string[]]$Candidates, [string]$Description) {
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    throw "$Description was not found. Set the relevant environment variable or install the Android build tools."
}

$env:JAVA_HOME = Resolve-FirstExistingPath @(
    $env:JAVA_HOME,
    'E:\toolchain\jdk17',
    'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
) 'Java'
$env:ANDROID_HOME = Resolve-FirstExistingPath @(
    $env:ANDROID_HOME,
    'E:\Android\Sdk',
    'E:\toolchain\android-sdk'
) 'Android SDK'
if (-not $env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }

Write-Output 'Building offline web assets for Android...'
& npm.cmd run build -- --outDir android/app/atlas-assets-staging
if ($LASTEXITCODE) { throw 'Web asset build failed' }

Write-Output 'Assembling debug APK...'
$gradleExe = Resolve-FirstExistingPath @(
    $env:GRADLE_EXE,
    'C:\Users\ASUS\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\gradle-8.14.3\bin\gradle.bat',
    'D:\gradle\wrapper\dists\gradle-8.11.1-bin\eac4u065zwes5phgltp5f9b9e\gradle-8.11.1\bin\gradle.bat'
) 'Gradle'
& $gradleExe -p .\android --no-daemon assembleDebug
if ($LASTEXITCODE) { throw 'Android APK build failed' }

$apk = Join-Path $PSScriptRoot 'android\app\build-output-staging\outputs\apk\debug\app-debug.apk'
$copy = Join-Path $PSScriptRoot 'Auricular-Atlas.apk'
Copy-Item -LiteralPath $apk -Destination $copy -Force
Get-FileHash -Algorithm SHA256 -LiteralPath $copy | Format-List Algorithm, Hash, Path
