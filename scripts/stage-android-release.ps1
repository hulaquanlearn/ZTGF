param(
  [Parameter(Mandatory=$true)][string]$Apk,
  [Parameter(Mandatory=$true)][int]$VersionCode,
  [Parameter(Mandatory=$true)][string]$VersionName,
  [Parameter(Mandatory=$true)][string]$AndroidSdk
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($VersionCode -lt 1 -or $VersionName -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!(Test-Path -LiteralPath $Apk -PathType Leaf)) { throw 'APK not found.' }
& (Join-Path $AndroidSdk 'build-tools/35.0.0/apksigner.bat') verify $Apk
if ($LASTEXITCODE -ne 0) { throw 'APK signature check failed.' }
# Cross-check the declared release version against the actual APK manifest.
$badging = & (Join-Path $AndroidSdk 'build-tools/35.0.0/aapt.exe') dump badging $Apk
if ($LASTEXITCODE -ne 0) { throw 'Cannot read APK manifest.' }
$package = $badging | Select-Object -First 1
if ($package -notmatch "name='cn.quizforge.app'" -or $package -notmatch "versionCode='$VersionCode'" -or $package -notmatch "versionName='$([Regex]::Escape($VersionName))'") { throw 'APK package or version does not match release metadata.' }
$targetDirectory = Join-Path $projectRoot 'public/android'
New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
$name = "quizforge-android-$VersionName.apk"
$target = Join-Path $targetDirectory $name
if (Test-Path -LiteralPath $target) {
  if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $Apk).Hash) { throw 'A different APK already uses this version. Increase versionCode and versionName.' }
} else { Copy-Item -LiteralPath $Apk -Destination $target }
$metadata = @{versionCode=$VersionCode;versionName=$VersionName;apkPath="/android/$name"} | ConvertTo-Json
$metadataFile = Join-Path $projectRoot 'public/android-release.json'
$temporary = $metadataFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
[IO.File]::WriteAllText($temporary, $metadata + "`n", [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $temporary -Destination $metadataFile -Force
Write-Host 'APK and version metadata staged locally. Deploy public/android, public/android-release.json and the version API together.'
