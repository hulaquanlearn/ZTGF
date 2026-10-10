$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($packageVersion -ne '6.2.3') { throw 'Expected version 6.2.3' }
$outputRoot = Join-Path $projectRoot 'releases'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$archivePath = Join-Path $outputRoot 'quizforge-6.2.3-workbench-20261010.zip'
if (Test-Path -LiteralPath $archivePath) { throw 'Release already exists; do not overwrite.' }
$files = @('.env.example','.gitignore','package.json','package-lock.json','ecosystem.config.cjs','README.md','WORKBENCH-DEPLOY.md','FLIGHTS-DEPLOY.md','OPENCLAW-DEPLOY.md','PASSWORD-UPDATE-DEPLOY.md','RELEASE-NOTES-v6.0.md','RELEASE-NOTES-v6.1.md','server-content-template.json','test-fixture.md')
foreach ($directory in @('public','src','database','docs','scripts')) {
  $files += @(Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($projectRoot,$_.FullName).Replace('\','/') })
}
$manifest = @($files | Sort-Object -Unique | ForEach-Object {
  $source = Join-Path $projectRoot $_
  if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing file: $_" }
  if ($_ -match '(^|/)(\.env|node_modules|data|uploads|tmp|backups)(/|$)' -or $_ -match '\.(bak|log|zip|pdf)$') { throw "Forbidden file: $_" }
  [PSCustomObject]@{path=$_;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower();bytes=(Get-Item -LiteralPath $source).Length}
})
$stream = [IO.File]::Open($archivePath,[IO.FileMode]::CreateNew)
$zip = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($item in $manifest) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $projectRoot $item.path),$item.path,[IO.Compression.CompressionLevel]::Optimal) | Out-Null }
  $writer = [IO.StreamWriter]::new($zip.CreateEntry('MANIFEST.json').Open(),[Text.UTF8Encoding]::new($false))
  try { $writer.Write((ConvertTo-Json -InputObject $manifest -Depth 4)) } finally { $writer.Dispose() }
} finally { $zip.Dispose(); $stream.Dispose() }
$read = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  foreach ($item in $manifest) {
    $entry = $read.GetEntry($item.path)
    if (!$entry -or $entry.Length -ne $item.bytes) { throw "ZIP manifest mismatch: $($item.path)" }
    $entryStream = $entry.Open(); $hasher = [Security.Cryptography.SHA256]::Create()
    try { if ([Convert]::ToHexString($hasher.ComputeHash($entryStream)).ToLower() -ne $item.sha256) { throw 'ZIP hash mismatch' } } finally { $entryStream.Dispose(); $hasher.Dispose() }
  }
  if ($read.Entries.Count -ne $manifest.Count + 1) { throw 'ZIP entry count mismatch' }
} finally { $read.Dispose() }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText($archivePath+'.sha256',"$hash  $([IO.Path]::GetFileName($archivePath))`n",[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $projectRoot 'WORKBENCH-DEPLOY.md') -Destination (Join-Path $outputRoot 'quizforge-6.2.3-workbench-deploy.md')
[PSCustomObject]@{archive=$archivePath;files=$manifest.Count;bytes=(Get-Item -LiteralPath $archivePath).Length;sha256=$hash} | ConvertTo-Json
