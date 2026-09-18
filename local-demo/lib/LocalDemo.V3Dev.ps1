# Explicit experimental integration policy. Never changes accepted V3/Qwen pins.
function Get-V3DevAllowedChanges {
    @(
        '.gitignore', 'local-demo/v3-dev-checkpoints.psd1',
        'local-demo/start-local-chatbot-demo.ps1', 'local-demo/stop-local-chatbot-demo.ps1',
        'local-demo/lib/LocalDemo.Core.psm1', 'local-demo/lib/LocalDemo.Windows.psm1',
        'local-demo/lib/LocalDemo.V3Dev.ps1', 'local-demo/supervise_service.py',
        'local-demo/supervise_service_v3_dev.py', 'local-demo/start-local-chatbot-demo-v3-dev.ps1',
        'local-demo/stop-local-chatbot-demo-v3-dev.ps1', 'local-demo/status-local-chatbot-demo-v3-dev.ps1',
        'local-demo/tests/run-local-demo-v3-dev-tests.ps1', 'local-demo/README-V3-DEV.md',
        'coldwave-demo-v3/docs/PHASE4EB_INTEGRATION.md'
    )
}

function Assert-V3DevCheckpointFacts {
    param([string]$FrontendBranch, [string]$BackendBranch, [string]$BackendHead,
        [bool]$FrontendAncestor, [string]$FrontendRollbackTag, [string]$BackendRollbackTag,
        [AllowEmptyCollection()][string[]]$Changes = @(),
        [AllowEmptyCollection()][string[]]$FrontendStatus = @(),
        [AllowEmptyCollection()][string[]]$BackendStatus = @())
    $policy = Import-PowerShellDataFile (Join-Path $PSScriptRoot '../v3-dev-checkpoints.psd1')
    if ($FrontendBranch -cne $policy.Branch -or $BackendBranch -cne $policy.Branch -or
        $BackendHead -cne $policy.BackendCommit -or -not $FrontendAncestor) {
        throw 'Development integration branch/checkpoint mismatch.'
    }
    if ($FrontendRollbackTag -cne '345fe7a4d4f4bd4299c027d0c2cd7e1254b2819b' -or
        $BackendRollbackTag -cne 'e6b0ad5600e1d0056cd927ba9034bda6243b6030') {
        throw 'Accepted Qwen rollback tag changed.'
    }
    $allowed = @(Get-V3DevAllowedChanges)
    foreach ($path in $Changes) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and $path -cnotin $allowed) {
            throw "Unreviewed development production content: $path"
        }
    }
    foreach ($line in $FrontendStatus) {
        if (-not [string]::IsNullOrWhiteSpace($line) -and $line -cne '?? debug.log') {
            throw 'Dirty development frontend; only existing untracked debug.log is allowed.'
        }
    }
    if (@($BackendStatus | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count) {
        throw 'Dirty development backend.'
    }
}

function Assert-V3DevRepositoryCheckpoints {
    param([pscustomobject]$Layout, [string]$GitPath)
    $policy = Import-PowerShellDataFile (Join-Path $PSScriptRoot '../v3-dev-checkpoints.psd1')
    function Read-DevGit([string]$Repository, [string[]]$GitArguments) {
        (Invoke-DemoGit -GitPath $GitPath -Repository $Repository -Arguments $GitArguments).Output
    }
    $front = $Layout.FrontendRepository
    $back = $Layout.BackendRepository
    $ancestor = Invoke-DemoGit -GitPath $GitPath -Repository $front -AllowFailure `
        -Arguments @('merge-base', '--is-ancestor', $policy.FrontendApplicationCommit, 'HEAD')
    Assert-V3DevCheckpointFacts `
        -FrontendBranch (Read-DevGit $front @('branch','--show-current')) `
        -BackendBranch (Read-DevGit $back @('branch','--show-current')) `
        -BackendHead (Read-DevGit $back @('rev-parse','HEAD')) `
        -FrontendAncestor ($ancestor.ExitCode -eq 0) `
        -FrontendRollbackTag (Read-DevGit $front @('rev-parse','phase4c1-v3-plain-language-ai-accepted^{commit}')) `
        -BackendRollbackTag (Read-DevGit $back @('rev-parse','phase4c1-plain-language-ai-accepted^{commit}')) `
        -Changes @((Read-DevGit $front @('diff','--name-only','--no-renames',$policy.FrontendApplicationCommit,'HEAD','--')) -split "`n") `
        -FrontendStatus @((Read-DevGit $front @('status','--porcelain=v1','--untracked-files=all')) -split "`n") `
        -BackendStatus @((Read-DevGit $back @('status','--porcelain=v1','--untracked-files=all')) -split "`n")
}

function Write-V3DevStatus {
    param([pscustomobject]$Layout)
    $constants = Get-LocalDemoConstants
    Write-Host "Experimental V3 integration: $($constants.ModelName)"
    Write-Host "Browser: $($constants.BrowserUrl)"
    $gitPath = Resolve-DemoExecutable -CommandName 'git.exe'
    foreach ($repo in @($Layout.FrontendRepository, $Layout.BackendRepository)) {
        Write-Host (Invoke-DemoGit -GitPath $gitPath -Repository $repo -Arguments @('rev-parse','HEAD')).Output
    }
    try { Assert-V3DevRepositoryCheckpoints $Layout $gitPath; Write-Host 'Checkpoints: verified' }
    catch { Write-Warning $_.Exception.Message }
    Assert-DemoRuntimePathSafety -Layout $Layout
    $state = Read-DemoState -StatePath $Layout.StatePath -Layout $Layout
    if ($null -eq $state) { Write-Host 'Development state: absent' } else {
        $actual = Get-DemoActualProcessMap -Records @($state.processes)
        Write-Host ('Development state: ' + (Get-DemoSessionDisposition $state $actual))
        Write-Host "Ollama pre-existing: $($state.ollama_preexisting); model loaded by launcher: $($state.model_loaded_by_launcher)"
    }
    foreach ($port in @(8001,8080,11434)) {
        foreach ($listener in @(Get-DemoPortListeners -Port $port)) {
            Write-Host "Port $port PID $($listener.ProcessId) $($listener.Address) $($listener.ProcessPath)"
        }
    }
    try {
        $tags = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/tags" -TimeoutSeconds 3
        Write-Host ('Model installed: ' + (Test-DemoModelInstalledFromApi $tags.Body $constants.ModelName))
        $resident = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/ps" -TimeoutSeconds 3
        $allocation = Get-DemoOllamaAllocationFromApi -Body $resident.Body
        Write-Host "Model residency: $($allocation.Allocation); $($allocation.VramMiB) MiB VRAM"
    } catch { Write-Warning 'Model not resident or identity/allocation unverified.' }
    try {
        $smi = Invoke-DemoNvidiaSmi -NvidiaSmiPath (Resolve-DemoExecutable -CommandName 'nvidia-smi.exe')
        $gpu = Assert-DemoGpuFacts -Controllers (Get-DemoGpuControllers) -NvidiaSmiExitCode $smi.ExitCode -NvidiaRows $smi.Rows
        Write-Host "GPU healthy; used $($gpu.UsedMiB) MiB; free $($gpu.FreeMiB) MiB"
    } catch { Write-Warning 'GPU health unverified.' }
}
