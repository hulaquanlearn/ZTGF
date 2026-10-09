$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = Join-Path $projectRoot 'releases'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$archivePath = Join-Path $outputRoot 'quizforge-6.2.1-corpus-20261009.zip'
if (Test-Path -LiteralPath $archivePath) { throw '部署包已存在，不覆盖已有交付。' }
$files = @('.env.example','.gitignore','package.json','package-lock.json','ecosystem.config.cjs','README.md','OPENCLAW-DEPLOY.md','PASSWORD-UPDATE-DEPLOY.md','RELEASE-NOTES-v6.0.md','RELEASE-NOTES-v6.1.md','server-content-template.json','test-fixture.md')
foreach ($directory in @('public','src','database','docs','scripts')) {
    $files += @(Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($projectRoot,$_.FullName).Replace('\','/') })
}
$files = @($files | Sort-Object -Unique)
$manifest = @($files | ForEach-Object {
    $source = Join-Path $projectRoot $_
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "缺少文件: $_" }
    if ($_ -match '(^|/)(\.env|node_modules|data|uploads|tmp|backups)(/|$)' -or $_ -match '\.(bak|log|zip)$') { throw "非发布文件: $_" }
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
        if (!$entry -or $entry.Length -ne $item.bytes) { throw "ZIP清单不一致: $($item.path)" }
        $entryStream = $entry.Open(); $hasher = [Security.Cryptography.SHA256]::Create()
        try { if ([Convert]::ToHexString($hasher.ComputeHash($entryStream)).ToLower() -ne $item.sha256) { throw 'ZIP哈希校验失败' } } finally { $entryStream.Dispose(); $hasher.Dispose() }
    }
    if ($read.Entries.Count -ne $manifest.Count + 1) { throw 'ZIP条目数量不一致' }
} finally { $read.Dispose() }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText($archivePath+'.sha256',"$hash  $([IO.Path]::GetFileName($archivePath))`n",[Text.UTF8Encoding]::new($false))
[PSCustomObject]@{archive=$archivePath;files=$manifest.Count;bytes=(Get-Item -LiteralPath $archivePath).Length;sha256=$hash} | ConvertTo-Json
