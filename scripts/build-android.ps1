param(
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$AndroidSdk = $env:ANDROID_HOME,
  [string]$GradlePath = '',
  [switch]$Offline
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidRoot = Join-Path $projectRoot 'android'
if (!$JavaHome -or !(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/javac.exe'))) { throw 'Pass -JavaHome with a JDK 17 installation.' }
if (!$AndroidSdk) { $AndroidSdk = $env:ANDROID_SDK_ROOT }
if (!$AndroidSdk -or !(Test-Path -LiteralPath (Join-Path $AndroidSdk 'platforms/android-35/android.jar'))) { throw 'Pass -AndroidSdk with Android SDK Platform 35 and Build Tools 35.0.0 installed.' }
if (!$GradlePath) { $GradlePath = Join-Path $androidRoot 'gradlew.bat' }
if (!(Test-Path -LiteralPath $GradlePath)) { throw 'Gradle wrapper missing. Generate with Gradle 8.11.1, or pass -GradlePath.' }

$previousJava = $env:JAVA_HOME
$previousKeyPassword = $env:QUIZFORGE_KEYSTORE_PASSWORD
try {
  $env:JAVA_HOME = $JavaHome
  $utf8 = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText((Join-Path $androidRoot 'local.properties'), 'sdk.dir=' + $AndroidSdk.Replace('\','/') + "`n", $utf8)
  $signingFile = Join-Path $androidRoot 'signing.properties'
  $signingDir = Join-Path $androidRoot '.signing'
  $keyFile = Join-Path $signingDir 'quizforge-release.jks'
  if (!(Test-Path -LiteralPath $signingFile)) {
    if (Test-Path -LiteralPath $keyFile) { throw 'Signing key exists without signing.properties. Restore its original properties; do not replace the key.' }
    New-Item -ItemType Directory -Path $signingDir -Force | Out-Null
    $env:QUIZFORGE_KEYSTORE_PASSWORD = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    & (Join-Path $JavaHome 'bin/keytool.exe') -genkeypair -keystore $keyFile -storetype JKS -storepass:env QUIZFORGE_KEYSTORE_PASSWORD -keypass:env QUIZFORGE_KEYSTORE_PASSWORD -alias quizforge -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=QuizForge Android, O=QuizForge' -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the dedicated signing key.' }
    $properties = "storeFile=.signing/quizforge-release.jks`nstorePassword=$env:QUIZFORGE_KEYSTORE_PASSWORD`nkeyAlias=quizforge`nkeyPassword=$env:QUIZFORGE_KEYSTORE_PASSWORD`n"
    [IO.File]::WriteAllText($signingFile, $properties, $utf8)
    Write-Host 'Created a private release key. Back up android/.signing and signing.properties securely for future APK updates.'
  }
  $gradleArgs = @('-p', $androidRoot, '--console=plain', '--no-daemon', 'assembleRelease', 'lintRelease', 'checkServerPolicy', 'checkSavedPasswords', 'checkUpdateReminder')
  if ($Offline) { $gradleArgs += '--offline' }
  & $GradlePath @gradleArgs
  if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }
  & node --test (Join-Path $androidRoot 'autofill.test.js') (Join-Path $androidRoot 'app-controls.test.js')
  if ($LASTEXITCODE -ne 0) { throw 'Android login DOM checks failed.' }
  $apk = Join-Path $androidRoot 'app/build/outputs/apk/release/app-release.apk'
  & (Join-Path $AndroidSdk 'build-tools/35.0.0/apksigner.bat') verify --verbose --print-certs $apk
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  $metadata = Get-Content -LiteralPath (Join-Path $androidRoot 'app/build/outputs/apk/release/output-metadata.json') -Raw | ConvertFrom-Json
  $version = $metadata.elements[0].versionName
  $releaseRoot = Join-Path $projectRoot 'releases'
  New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
  $destination = Join-Path $releaseRoot "quizforge-android-$version.apk"
  if (Test-Path -LiteralPath $destination) { throw "APK already exists: $destination. Increase versionCode and versionName before publishing another APK." }
  Copy-Item -LiteralPath $apk -Destination $destination
  $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower()
  [IO.File]::WriteAllText($destination + '.sha256', "$hash  $([IO.Path]::GetFileName($destination))`n", $utf8)
  [PSCustomObject]@{apk=$destination;bytes=(Get-Item -LiteralPath $destination).Length;sha256=$hash} | ConvertTo-Json
} finally {
  $env:JAVA_HOME = $previousJava
  $env:QUIZFORGE_KEYSTORE_PASSWORD = $previousKeyPassword
}
