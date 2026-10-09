$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$quizRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$coupleRoot = 'D:\wx_xiangm\qlcx'
$archivePath = Join-Path $quizRoot 'releases\learning-update-20261008-quizforge6.2.1-couple2.19.13-independent.zip'
if (Test-Path -LiteralPath $archivePath) { throw '更新包已经存在，不覆盖历史交付' }
$quizFiles = @('README.md','package.json','package-lock.json','.env.example','.gitignore','server-content-template.json','database/schema.sql','src/db.js','src/server.js','src/corpus.js','src/db/relational.js','src/db/relational.test.js','src/server.test.js','src/identity-integration.test.js','public/index.html','public/workspace.js','public/corpus.js','public/corpus.css','scripts/import-learning-content.js','scripts/smoke-check.js','scripts/package-today-update.ps1','releases/OPENCLAW-UPDATE-20261008-INDEPENDENT.md','releases/VERIFICATION-20261008-INDEPENDENT.md')
$coupleFiles = @('README.md','OPENCLAW_DEPLOY_V2.19.13.md','server/package.json','server/package-lock.json','server/.env.example','server/src/auth.js','server/src/routes/auth.js','server/src/password.js','server/scripts/create-user.js','server/test/password.test.js','server/test/shared-identity.test.js','test/account-and-avatar.test.js','miniprogram/pages/index/index.wxml')
$manifest = @()
foreach ($project in @(@{root=$quizRoot;prefix='quizforge';files=$quizFiles},@{root=$coupleRoot;prefix='couple-space';files=$coupleFiles})) {
    foreach ($relative in $project.files) {
        $source = [IO.Path]::GetFullPath((Join-Path $project.root $relative))
        if (!$source.StartsWith($project.root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw '文件路径越界' }
        if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "缺少文件: $relative" }
        $manifest += [PSCustomObject]@{archivePath=$project.prefix+'/'+$relative;source=$source;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower();bytes=(Get-Item -LiteralPath $source).Length}
    }
}
$stream = [IO.File]::Open($archivePath,[IO.FileMode]::CreateNew)
$zip = New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($item in $manifest) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$item.source,$item.archivePath,[IO.Compression.CompressionLevel]::Optimal) | Out-Null }
    $entry = $zip.CreateEntry('MANIFEST.json');$writer = New-Object IO.StreamWriter($entry.Open(),[Text.UTF8Encoding]::new($false))
    try { $writer.Write(($manifest | Select-Object archivePath,sha256,bytes | ConvertTo-Json -Depth 4)) } finally { $writer.Dispose() }
    foreach ($name in @('OPENCLAW-UPDATE-20261008-INDEPENDENT.md','VERIFICATION-20261008-INDEPENDENT.md')) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $quizRoot "releases/$name"),$name) | Out-Null }
} finally { $zip.Dispose();$stream.Dispose() }
$read = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($item in $manifest) {
        $entry = $read.GetEntry($item.archivePath);if (!$entry -or $entry.Length -ne $item.bytes) { throw 'ZIP清单不一致' }
        $entryStream = $entry.Open();$hasher=[Security.Cryptography.SHA256]::Create()
        try { $hash=[Convert]::ToHexString($hasher.ComputeHash($entryStream)).ToLower();if ($hash -ne $item.sha256) { throw 'ZIP文件校验失败' } } finally { $entryStream.Dispose();$hasher.Dispose() }
    }
    if ($read.Entries | Where-Object { $_.FullName -match '(^|/)(\.env|identity\.env|node_modules|data|uploads|backups)(/|$)' }) { throw '包中出现不应发布的数据' }
    $count=$read.Entries.Count
} finally { $read.Dispose() }
[PSCustomObject]@{path=$archivePath;entries=$count;bytes=(Get-Item -LiteralPath $archivePath).Length;sha256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash} | ConvertTo-Json
