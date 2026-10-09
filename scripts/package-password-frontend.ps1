$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target=Join-Path $root 'releases/quizforge-6.2.1-frontend-password-P1-20261008.zip'
$files=@('public/index.html','public/workspace.js','public/refinements.css','public/password-visibility.js')
$manifest=@($files | ForEach-Object { $source=Join-Path $root $_; @{path=$_;sha256=(Get-FileHash -LiteralPath $source).Hash;bytes=(Get-Item -LiteralPath $source).Length} })
$stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach($file in $files){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $root $file),$file) | Out-Null}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $root 'releases/PASSWORD-FRONTEND-UPDATE-20261008.md'),'OPENCLAW-UPDATE.md') | Out-Null
  $writer=[IO.StreamWriter]::new($zip.CreateEntry('MANIFEST.json').Open(),[Text.UTF8Encoding]::new($false))
  try {$writer.Write((ConvertTo-Json -InputObject $manifest -Depth 4))} finally {$writer.Dispose()}
} finally {$zip.Dispose();$stream.Dispose()}
$read=[IO.Compression.ZipFile]::OpenRead($target)
try {
  foreach($item in $manifest){$entry=$read.GetEntry($item.path);if($entry.Length -ne $item.bytes){throw 'Size mismatch'};$es=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create();try {$hash=[Convert]::ToHexString($sha.ComputeHash($es));if($hash -ne $item.sha256){throw 'Hash mismatch'}} finally {$es.Dispose();$sha.Dispose()}}
  if($read.Entries.Count -ne 6){throw 'Unexpected entries'}
} finally {$read.Dispose()}
Get-FileHash -LiteralPath $target | Format-List
