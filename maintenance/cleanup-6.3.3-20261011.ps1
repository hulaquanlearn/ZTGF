$ErrorActionPreference='Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$taskRoot=[IO.Path]::GetFullPath('E:/workspace/quizforge')
$obsoletePaths=@('public/flights.js','public/flights.css','releases/quizforge-6.3.0-standby-20261010.zip','releases/quizforge-6.3.0-standby-20261010.zip.sha256','releases/quizforge-6.3.0-standby-deploy.md','releases/quizforge-6.3.0-standby-verification.md','releases/quizforge-6.3.1-standby-20261011.zip','releases/quizforge-6.3.1-standby-20261011.zip.sha256','releases/quizforge-6.3.1-standby-deploy.md','releases/quizforge-6.3.1-standby-verification.md','releases/quizforge-6.3.2-standby-20261011.zip','releases/quizforge-6.3.2-standby-20261011.zip.sha256','releases/quizforge-6.3.2-standby-deploy.md','releases/quizforge-6.3.2-standby-verification.md','.verification/flights-6.2.2-20261010','.verification/workbench-6.2.3-20261010','.verification/workbench-6.2.4-20261010','.verification/release-6.3.0-final','.verification/release-6.3.1-final','.verification/release-6.3.2-final')
$obsoleteHelpers=@('add-proof.py','check-new-rule.mjs','check-preview-export.mjs','finalize-rule.py','finish-navigation.py','fix-autosave-export.py','fix-result-context.py','new-proposal.js','polish-final.py','polish-workbench.py','rebuild-workspace.py','revision-edit.mjs','revision-final-polish.mjs','revision-polish.mjs','revision-separate.mjs','revision-version.mjs','update-full-exports.py','update-min-guide.mjs','update-min-rule.mjs','update-rule.py','validate-source.py','verify-6.3.2-files.mjs','verify-revision-files.mjs','render-revision-pdf.py','render-revision.ps1')
$obsoletePaths+=@($obsoleteHelpers | ForEach-Object {'.verification/'+$_})
$obsoletePaths+=@('.verification/standby-release-6.3.3/installed','.verification/standby-release-6.3.3/polish.mjs','.verification/standby-release-6.3.3/release-docs.mjs')
$obsoleteEvidence=@('revision-word-6.3.3','actual-file-check-6.3.2.json','browser-word-final.pdf','browser-word.pdf','coverage-14-9-final.png','final-word-page-1.png','final-word-page-2.png','final-word-page-3.png','mobile-6.3.2.png','new-pdf-confirm-6.3.2.png','nx658-rejected.jpg','original-tab-6.3.3.png','report.json','revision-6.3.3.png','revision-file-check-6.3.3.json','revision-word-6.3.3-page-1.png','revision-word-6.3.3-page-2.png','revision-word-6.3.3-page-3.png','revision-word-6.3.3-page-4.png','revision-word-6.3.3.pdf','rules-final.jpg','scheme.docx','scheme.xlsx','word-6.3.2-final-page-1.png','word-6.3.2-final-page-2.png','word-6.3.2-final-page-3.png','word-6.3.2-final.pdf','word-6.3.2-page-1.png','word-6.3.2-page-2.png','word-6.3.2-page-3.png','word-6.3.2.pdf','word-page-1.png','word-page-2.png','word-page-3.png','word-page-4.png')
$obsoletePaths+=@($obsoleteEvidence | ForEach-Object {'.verification/standby-20261011/'+$_})
$records=@()
foreach($relative in $obsoletePaths){
 $resolved=[IO.Path]::GetFullPath((Join-Path $taskRoot $relative))
 if(!$resolved.StartsWith($taskRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Target outside project'}
 if(!(Test-Path -LiteralPath $resolved)){continue}
 $item=Get-Item -LiteralPath $resolved -Force
 $ancestor=$item
 while($ancestor -and $ancestor.FullName -ne $taskRoot){if($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked target refused'};$ancestor=if($ancestor.PSIsContainer){$ancestor.Parent}else{$ancestor.Directory}}
 if($item.PSIsContainer){$all=@(Get-ChildItem -LiteralPath $resolved -Recurse -Force);if(@($all | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Linked child refused'};$bytes=($all | Where-Object {!$_.PSIsContainer} | Measure-Object Length -Sum).Sum}
 else{$bytes=$item.Length}
 $reason=if($relative.StartsWith('public/')){'Unused legacy frontend; current workbench imports verified'}elseif($relative.StartsWith('releases/')){'Superseded standby release; latest validated release replaces it'}elseif($item.PSIsContainer){'Completed isolated test installation or obsolete rendered QA output; no business data or running preview'}else{'Completed one-time edit or obsolete verification output/helper'}
 $records+= [PSCustomObject]@{path=$resolved;directory=$item.PSIsContainer;bytes=$bytes;reason=$reason;result='planned'}
}
$logPath=Join-Path $taskRoot 'maintenance/cleanup-6.3.3-20261011.json'
[IO.File]::WriteAllText($logPath,(ConvertTo-Json -InputObject $records -Depth 4),[Text.UTF8Encoding]::new($false))
if($args -notcontains '-Execute'){$records | Select-Object path,bytes,reason;exit}
foreach($record in $records){
 try{if($record.directory){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($record.path,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)}else{[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($record.path,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)};$record.result='recycled'}catch{$record.result='failed: '+$_.Exception.Message}
 [IO.File]::WriteAllText($logPath,(ConvertTo-Json -InputObject $records -Depth 4),[Text.UTF8Encoding]::new($false))
}
$records | Group-Object result | Select-Object Name,Count
