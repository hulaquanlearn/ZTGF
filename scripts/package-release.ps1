$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($package.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unexpected package version' }
$releaseVersion = ($package.version.Split('.')[0..1] -join '.')
$outputRoot = Join-Path $projectRoot 'releases'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$archive = Join-Path $outputRoot "quizforge-v$releaseVersion-openclaw-node-mysql.zip"
if (Test-Path -LiteralPath $archive) { throw "Release already exists: $archive. Keep it or select a new version before packaging." }
$entries = @('.env.example','.gitignore','database','docs','public','scripts','src','ecosystem.config.cjs','package.json','package-lock.json','test-fixture.md','README.md','OPENCLAW-DEPLOY.md',"RELEASE-NOTES-v$releaseVersion.md")
foreach ($entry in $entries) { if (!(Test-Path -LiteralPath (Join-Path $projectRoot $entry))) { throw "Missing release file: $entry" } }
& tar -a -cf $archive -C $projectRoot @entries
if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
  $bad = @($zip.Entries | Where-Object { $_.FullName.Contains('\') -or $_.FullName -match '(^|/)(\.env|node_modules|data|uploads|tmp|quizforge\.json)(/|$)' -or $_.FullName -match '\.pdf$' })
  if ($bad.Count) { throw "Unexpected archive entries: $($bad.FullName -join ', ')" }
  $entryCount = $zip.Entries.Count
} finally { $zip.Dispose() }
$guide = Join-Path $outputRoot "quizforge-v$releaseVersion-openclaw-deploy.md"
Copy-Item -LiteralPath (Join-Path $projectRoot 'OPENCLAW-DEPLOY.md') -Destination $guide
[PSCustomObject]@{archive=$archive;guide=$guide;files=$entryCount;bytes=(Get-Item -LiteralPath $archive).Length;sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash} | ConvertTo-Json
