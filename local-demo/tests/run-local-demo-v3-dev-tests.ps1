#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$demoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Import-Module (Join-Path $demoRoot 'lib/LocalDemo.Core.psm1') -Force -ArgumentList v3-dev
. (Join-Path $demoRoot 'lib/LocalDemo.V3Dev.ps1')
$policy = Import-PowerShellDataFile (Join-Path $demoRoot 'v3-dev-checkpoints.psd1')
$script:passed = 0
$script:failed = 0
function Check([bool]$Value) { if (-not $Value) { throw 'Assertion failed' } }
function Throws([scriptblock]$Action) {
    try { & $Action } catch { return }
    throw 'Expected fail-closed rejection'
}
function Case([string]$Name, [scriptblock]$Action) {
    try { & $Action; $script:passed++; Write-Host "PASS $Name" }
    catch { $script:failed++; Write-Host "FAIL ${Name}: $($_.Exception.Message)" }
}
function Facts {
    @{
        FrontendBranch = $policy.Branch; BackendBranch = $policy.Branch
        BackendHead = $policy.BackendCommit; FrontendAncestor = $true
        FrontendRollbackTag = '345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b'
        BackendRollbackTag = 'e6b0ad5600e1d0056cd927ba9034bda6243b6030'
        Changes = @(); FrontendStatus = @('?? debug.log'); BackendStatus = @()
    }
}
function Residency {
    [pscustomobject]@{ models = @([pscustomobject]@{
        name = 'gemma4:12b'; model = 'gemma4:12b'; digest = $policy.ModelDigest
        context_length = 4096; size = 10000000000L; size_vram = 6900000000L
    }) }
}
foreach ($file in @(Get-ChildItem -LiteralPath $demoRoot -Recurse -File |
        Where-Object { $_.Extension -in @('.ps1','.psm1','.psd1') -and $_.FullName -notmatch '\.runtime' })) {
    Case "parse_$($file.Name)" {
        $tokens = $null; $errors = $null
        [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
        Check ($errors.Count -eq 0)
    }
}
Case 'exact_dev_checkpoints' { $facts = Facts; Assert-V3DevCheckpointFacts @facts }
foreach ($field in @('FrontendBranch','BackendBranch','BackendHead','FrontendRollbackTag','BackendRollbackTag')) {
    Case "reject_wrong_$field" {
        $facts = Facts; $facts[$field] = 'unreviewed'; Throws { Assert-V3DevCheckpointFacts @facts }
    }
}
Case 'reject_unrelated_ancestry' {
    $facts = Facts; $facts.FrontendAncestor = $false; Throws { Assert-V3DevCheckpointFacts @facts }
}
foreach ($field in @('FrontendStatus','BackendStatus')) {
    Case "reject_dirty_$field" {
        $facts = Facts; $facts[$field] = @(' M src/app.py'); Throws { Assert-V3DevCheckpointFacts @facts }
    }
}
foreach ($path in @('coldwave-demo-v3/js/app.js','coldwave-demo/index.html','coldwave-demo-v2/index.html','unknown.log')) {
    Case "reject_unreviewed_$path" {
        $facts = Facts; $facts.Changes = @($path); Throws { Assert-V3DevCheckpointFacts @facts }
    }
}
Case 'exact_launcher_only_allowlist' {
    $facts = Facts; $facts.Changes = @(Get-V3DevAllowedChanges); Assert-V3DevCheckpointFacts @facts
}
Case 'separate_runtime_and_gemma_configuration' {
    $layout = Get-LocalDemoLayout -ScriptRoot $demoRoot
    Check ($layout.RuntimeRoot.EndsWith('.runtime-v3-dev'))
    $constants = Get-LocalDemoConstants
    Check ($constants.ModelName -ceq 'gemma4:12b' -and $constants.RuntimeSchemaVersion -eq 4)
    $environment = Get-DemoBackendEnvironment -SnapshotDirectory $layout.SnapshotDirectory
    Check ($environment.RESILIENCE_OLLAMA_MODEL -ceq 'gemma4:12b')
    Check ($environment.RESILIENCE_OLLAMA_BASE_URL -ceq 'http://127.0.0.1:11434')
    Check ($constants.BrowserUrl -ceq 'http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent')
}
Case 'honest_partial_gpu_label' {
    Check ((Get-DemoOllamaAllocation -Output 'gemma4:12b hash 8.9 GB 31%/69% CPU/GPU 4096') -ceq
        '31% CPU / 69% GPU (development offload)')
    Check ((Get-DemoOllamaAllocationFromApi -Body (Residency)).Allocation -ceq
        '31% CPU / 69% GPU (development offload)')
}
foreach ($output in @('gemma4:12b hash 100% CPU','gemma4:12b hash 60%/40% CPU/GPU','qwen3:8b hash 100% GPU')) {
    Case "reject_allocation_$output" { Throws { Get-DemoOllamaAllocation -Output $output } }
}
foreach ($field in @('digest','context_length','size','size_vram')) {
    Case "reject_residency_$field" {
        $body = Residency
        if ($field -eq 'digest') { $body.models[0].digest = 'other' } else { $body.models[0].$field = 0 }
        Throws { Get-DemoOllamaAllocationFromApi -Body $body }
    }
}
Case 'full_gpu_remains_supported' {
    $body = Residency; $body.models[0].size_vram = $body.models[0].size
    Check ((Get-DemoOllamaAllocationFromApi -Body $body).Allocation -ceq '100% GPU')
}
Case 'stale_pid_reuse_never_matches' {
    $record = New-DemoProcessRecord -Role backend -ProcessId 999 -ExecutablePath 'C:\fixture\python.exe' `
        -StartTimeUtc '2026-09-01T12:00:00Z' -CreatedByLauncher $true -Port 8080
    $actual = [pscustomobject]@{ ProcessId = 999; ExecutablePath = 'C:\fixture\python.exe'; StartTimeUtc = '2026-09-18T12:00:00Z' }
    Check (-not (Test-DemoProcessIdentity $record $actual))
    Check ((Get-DemoSessionDisposition ([pscustomobject]@{status='ready'; processes=@($record)}) @{'999'=$actual}) -eq 'stale')
}
Case 'unowned_ollama_never_in_stop_plan' {
    $external = New-DemoProcessRecord -Role ollama -ProcessId 998 -ExecutablePath 'C:\fixture\ollama.exe' `
        -StartTimeUtc '2026-09-01T12:00:00Z' -CreatedByLauncher $false -Port 11434
    Check (@(Get-DemoOwnedStopPlan -Processes @($external)).Count -eq 0)
}
Case 'status_has_no_chat_or_inference' {
    $body = (Get-Command Write-V3DevStatus).ScriptBlock.ToString()
    Check ($body -notmatch '/api/chat|/api/generate|Stop-Process|Remove-Item|Write-DemoState')
}
Case 'accepted_profile_still_qwen_full_gpu' {
    Import-Module (Join-Path $demoRoot 'lib/LocalDemo.Core.psm1') -Force -ArgumentList v3
    $constants = Get-LocalDemoConstants
    Check ($constants.ModelName -ceq 'qwen3:8b')
    Check ($constants.AcceptedBackendCommit -ceq 'e6b0ad5600e1d0056cd927ba9034bda6243b6030')
    Check (-not (Test-DemoGpuAllocationLabel '31% CPU / 69% GPU (development offload)'))
    Throws { Get-DemoOllamaAllocation -Output 'qwen3:8b hash 31%/69% CPU/GPU' }
}
Write-Host "SUMMARY passed=$script:passed failed=$script:failed"
if ($script:failed) { exit 1 }
