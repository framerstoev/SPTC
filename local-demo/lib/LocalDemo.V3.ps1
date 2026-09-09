# Private V3 policies, loaded only by the explicit V3 Windows module instance.
# Lifecycle/process primitives stay in the shared, regression-tested modules.

function Get-V3DemoApplicationCheckpoint {
    # Reviewed Phase 4C content; immutable Phase 4A tags remain independently checked.
    "ee398bc6f6fbd5d942f31f9469222bd10108ab6a"
}

function Get-V3DemoAllowedChanges {
    @(
        ".gitignore",
        "local-demo/start-local-chatbot-demo.ps1",
        "local-demo/stop-local-chatbot-demo.ps1",
        "local-demo/start-local-chatbot-demo-v3.ps1",
        "local-demo/stop-local-chatbot-demo-v3.ps1",
        "local-demo/status-local-chatbot-demo-v3.ps1",
        "local-demo/lib/LocalDemo.Core.psm1",
        "local-demo/lib/LocalDemo.Windows.psm1",
        "local-demo/lib/LocalDemo.V3.ps1",
        "local-demo/supervise_service.py",
        "local-demo/supervise_service_v3.py",
        "local-demo/tests/run-local-demo-v3-tests.ps1",
        "local-demo/README-V3.md"
    )
}

function Assert-V3DemoCheckpointFacts {
    param(
        [bool]$FrontendCommitExists,
        [string]$FrontendTagTarget,
        [bool]$FrontendContainsAcceptedCommit,
        [bool]$FrontendApplicationCommitExists,
        [bool]$FrontendContainsApplicationCommit,
        [string]$BackendHead,
        [string]$BackendTagTarget,
        [AllowEmptyCollection()][string[]]$FrontendChanges = @(),
        [AllowEmptyCollection()][string[]]$FrontendStatus = @(),
        [AllowEmptyCollection()][string[]]$BackendStatus = @()
    )
    $constants = Get-LocalDemoConstants
    if (-not $FrontendCommitExists -or
        $FrontendTagTarget -cne $constants.AcceptedFrontendCommit -or
        -not $FrontendContainsAcceptedCommit) {
        throw "V3 frontend does not match the accepted Phase 4A checkpoint/tag ancestry."
    }
    if (-not $FrontendApplicationCommitExists -or -not $FrontendContainsApplicationCommit) {
        throw "V3 frontend does not match the reviewed Phase 4C application checkpoint/tag ancestry."
    }
    # Reviewed analytical depth advances runtime HEAD, never the Phase 4A tag.
    if ($BackendHead -cne $constants.AcceptedBackendCommit -or
        $BackendTagTarget -cne "b550f11ca75b8c4921667a264ae7a3ca78710ea9") {
        throw "V3 backend does not match the exact reviewed runtime checkpoint/tag baseline."
    }
    $allowed = @(Get-V3DemoAllowedChanges)
    foreach ($path in $FrontendChanges) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and $path -cnotin $allowed) {
            throw "Frontend production content differs from the accepted V3 checkpoint: $path"
        }
    }
    foreach ($line in $FrontendStatus) {
        if (-not [string]::IsNullOrWhiteSpace($line) -and $line -cne "?? debug.log") {
            throw "Unexpected dirty frontend worktree; only untracked root debug.log is accepted."
        }
    }
    if (@($BackendStatus | Where-Object {
                -not [string]::IsNullOrWhiteSpace($_)
            }).Count -gt 0) {
        throw "Unexpected dirty backend worktree."
    }
}

function Assert-V3DemoRepositoryCheckpoints {
    param([pscustomobject]$Layout, [string]$GitPath)
    $constants = Get-LocalDemoConstants
    $front = $Layout.FrontendRepository
    $back = $Layout.BackendRepository
    $application = Get-V3DemoApplicationCheckpoint
    $applicationCommit = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("cat-file", "-e", "${application}^{commit}") -AllowFailure
    $applicationAncestor = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("merge-base", "--is-ancestor", $application, "HEAD") -AllowFailure
    $commit = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("cat-file", "-e", "$($constants.AcceptedFrontendCommit)^{commit}") -AllowFailure
    $tag = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("rev-parse", "$($constants.AcceptedFrontendTag)^{commit}")
    $ancestor = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("merge-base", "--is-ancestor", $constants.AcceptedFrontendCommit, "HEAD") -AllowFailure
    $head = Invoke-DemoGit -GitPath $GitPath -Repository $back -Arguments @("rev-parse", "HEAD")
    $backTag = Invoke-DemoGit -GitPath $GitPath -Repository $back `
        -Arguments @("rev-parse", "phase4a-v3-network-assistant-accepted^{commit}")
    $changes = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("diff", "--name-only", "--no-renames", $application, "HEAD", "--")
    $frontStatus = Invoke-DemoGit -GitPath $GitPath -Repository $front `
        -Arguments @("status", "--porcelain=v1", "--untracked-files=all")
    $backStatus = Invoke-DemoGit -GitPath $GitPath -Repository $back `
        -Arguments @("status", "--porcelain=v1", "--untracked-files=all")
    Assert-V3DemoCheckpointFacts -FrontendCommitExists ($commit.ExitCode -eq 0) `
        -FrontendTagTarget $tag.Output -FrontendContainsAcceptedCommit ($ancestor.ExitCode -eq 0) `
        -FrontendApplicationCommitExists ($applicationCommit.ExitCode -eq 0) `
        -FrontendContainsApplicationCommit ($applicationAncestor.ExitCode -eq 0) `
        -BackendHead $head.Output -BackendTagTarget $backTag.Output `
        -FrontendChanges @($changes.Output -split "`n") `
        -FrontendStatus @($frontStatus.Output -split "`n") `
        -BackendStatus @($backStatus.Output -split "`n")
}

function Enter-V3DemoCompatibilityLock {
    param([pscustomobject]$Layout)
    # V2's existing lock also serializes a concurrent V2 launch during warm-up.
    # Never read V2 state as V3 state, and never delete or rewrite V2 state.
    $v2Runtime = Join-Path $Layout.DemoRoot ".runtime"
    $v2Layout = [pscustomobject]@{
        DemoRoot = $Layout.DemoRoot
        RuntimeRoot = $v2Runtime
        LogsRoot = Join-Path $v2Runtime "logs"
        StatePath = Join-Path $v2Runtime "active-session.json"
        LockPath = Join-Path $v2Runtime "lifecycle.lock"
    }
    Assert-DemoRuntimePathSafety -Layout $v2Layout
    $lock = Enter-DemoLifecycleLock -LockPath $v2Layout.LockPath
    try {
        if (Test-Path -LiteralPath $v2Layout.StatePath) {
            # Presence alone is a conservative conflict; V2 owns inspection/cleanup.
            throw (
                "Another local demo session is recorded by V2. " +
                "Inspect/stop the existing V2 launcher session before starting V3."
            )
        }
        $lock
    } catch {
        $lock.Dispose()
        throw
    }
}

function Assert-V3DemoAvailablePorts {
    foreach ($port in @(8001, 8080)) {
        $listeners = @(Get-DemoPortListeners -Port $port)
        if ($listeners.Count -gt 0) {
            foreach ($listener in $listeners) {
                Write-Host ("Port {0}: PID {1}, executable {2}" -f
                    $port, $listener.ProcessId, $listener.ProcessPath)
            }
            throw (
                "Another local demo session or unrelated process is using the required ports. " +
                "Stop the existing launcher session before starting V3. No process was stopped."
            )
        }
    }
}

function Assert-V3DemoServiceContracts {
    param([pscustomobject]$Layout)
    # No Assistant request or model call. V3 tools use the existing query route,
    # not additional invented tool endpoints.
    $schema = Wait-DemoHttpJson -Url "http://127.0.0.1:8080/openapi.json" -TimeoutSeconds 5
    if ($schema.HttpStatus -ne 200) { throw "V3 OpenAPI contract unavailable." }
    $paths = @($schema.Body.paths.PSObject.Properties.Name)
    foreach ($path in @(
            "/api/v1/sections/rank", "/api/v1/assistant/query",
            "/api/v1/sections/{cs_id}", "/api/v1/metrics/{metric_name}"
        )) {
        if ($path -notin $paths) { throw "Accepted V3 backend endpoint is missing: $path" }
    }
    $schemas = $schema.Body.components.schemas
    $profile = $schemas.AssistantQueryRequest.properties.assistant_profile
    if (@($profile.anyOf | Where-Object {
                $_.PSObject.Properties.Name -contains "const" -and $_.const -eq "v3"
            }).Count -ne 1) {
        throw "Accepted V3 Assistant profile contract is missing."
    }
    $toolNames = @($schemas.AssistantToolUse.properties.tool_name.enum)
    foreach ($name in @(
            "rank_sections", "summarize_tier_alignment",
            "summarize_county_resilience", "explain_project_concept",
            "get_section_summary", "explain_metric", "compare_sections",
            "generate_review_note", "request_clarification",
            "answer_scope_explanation", "decline_unsupported_request"
        )) {
        if ($name -notin $toolNames) { throw "Accepted Assistant tool contract is missing: $name" }
    }
    Write-Host "V3 profile and four network tools verified; V2 tool contracts retained."
    $v2 = Wait-DemoHttpStatus `
        -Url "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent" -TimeoutSeconds 5
    Assert-DemoFrontendResponse -HttpStatus $v2
}

function Open-V3DemoBrowser {
    param([string]$Url)
    try {
        Open-DemoBrowser -Url $Url
        Write-Host "Browser open requested: $Url"
    } catch {
        Write-Warning "Browser auto-open failed; the ready demo remains running. Paste: $Url"
    }
}

function Write-V3DemoStatus {
    param([pscustomobject]$Layout)
    $constants = Get-LocalDemoConstants
    Write-Host "V3 Roadway Resilience demo status"
    Write-Host "Browser: $($constants.BrowserUrl)"
    $gitPath = Resolve-DemoExecutable -CommandName "git.exe"
    foreach ($entry in @(
            @("Frontend", $Layout.FrontendRepository, (Get-V3DemoApplicationCheckpoint)),
            @("Backend", $Layout.BackendRepository, $constants.AcceptedBackendCommit)
        )) {
        $head = Invoke-DemoGit -GitPath $gitPath -Repository $entry[1] -Arguments @("rev-parse", "HEAD")
        Write-Host "$($entry[0]) HEAD: $($head.Output); accepted application checkpoint: $($entry[2])"
    }
    try {
        Assert-V3DemoRepositoryCheckpoints -Layout $Layout -GitPath $gitPath
        Write-Host "Checkpoint/worktree validation: accepted"
    } catch { Write-Warning "Checkpoint/worktree validation: $($_.Exception.Message)" }
    Assert-DemoRuntimePathSafety -Layout $Layout
    $state = Read-DemoState -StatePath $Layout.StatePath -Layout $Layout
    if ($null -eq $state) {
        Write-Host "V3 state: absent (no ownership claimed)"
    } else {
        $actual = Get-DemoActualProcessMap -Records @($state.processes)
        $disposition = Get-DemoSessionDisposition -State $state -ActualProcesses $actual
        Write-Host "V3 state: $disposition; session $($state.session_id)"
        foreach ($record in @($state.processes)) {
            $identity = Test-DemoProcessIdentity -Record $record `
                -ActualProcess $actual[[string]$record.process_id]
            $owner = if ($record.created_by_launcher) { "V3 launcher-owned" } else { "pre-existing" }
            Write-Host "$($record.role): PID $($record.process_id), $owner, identity match=$identity"
        }
    }
    foreach ($port in @(8001, 8080, 11434)) {
        $listeners = @(Get-DemoPortListeners -Port $port)
        if ($listeners.Count -eq 0) { Write-Host "Port ${port}: free" }
        foreach ($listener in $listeners) {
            Write-Host ("Port {0}: {1}, PID {2}, executable {3}" -f
                $port, $listener.Address, $listener.ProcessId, $listener.ProcessPath)
        }
    }
    try {
        $smi = Resolve-DemoExecutable -CommandName "nvidia-smi.exe"
        $result = Invoke-DemoNvidiaSmi -NvidiaSmiPath $smi
        $gpu = Assert-DemoGpuFacts -Controllers (Get-DemoGpuControllers) `
            -NvidiaSmiExitCode $result.ExitCode -NvidiaRows $result.Rows
        Write-Host "GPU: healthy Code 0, driver $($gpu.DriverVersion), used $($gpu.UsedMiB) MiB, free $($gpu.FreeMiB) MiB"
    } catch { Write-Warning "GPU: not verified; $($_.Exception.Message)" }
    foreach ($entry in @(
            @("Frontend", $constants.BrowserUrl),
            @("V2 frontend", "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent")
        )) {
        try {
            $status = Wait-DemoHttpStatus -Url $entry[1] -TimeoutSeconds 2
            Write-Host "$($entry[0]): HTTP $status"
        } catch { Write-Host "$($entry[0]): unavailable" }
    }
    try {
        $health = Wait-DemoHttpJson -Url "$($constants.BackendUrl)/health" -TimeoutSeconds 2
        Assert-DemoBackendHealth -Health $health
        Write-Host "FastAPI: accepted health contract"
    } catch { Write-Host "FastAPI: unavailable or incompatible" }
    $manifest = Get-DemoOllamaManifestPath -ModelName $constants.ModelName
    Write-Host ("qwen3:8b local manifest installed={0}" -f
        (Test-Path -LiteralPath $manifest -PathType Leaf))
    try {
        $ollamaPath = Resolve-DemoExecutable -CommandName "ollama.exe"
        $listeners = @(Get-DemoPortListeners -Port 11434)
        $policy = Resolve-DemoPortPolicy -Port 11434 -Listeners $listeners -ExpectedOllamaPath $ollamaPath
        if ($policy.Disposition -eq "free") { throw "No Ollama listener." }
        $ollamaOwnership = "pre-existing/unowned by V3"
        if ($null -ne $state) {
            $ownedRecord = @($state.processes | Where-Object {
                $_.role -eq "ollama" -and $_.created_by_launcher -eq $true -and
                [int]$_.process_id -eq [int]$policy.ProcessId
            }) | Select-Object -First 1
            if ($null -ne $ownedRecord -and
                (Test-DemoProcessIdentity -Record $ownedRecord `
                    -ActualProcess (Get-DemoProcessFact -ProcessId $policy.ProcessId))) {
                $ollamaOwnership = "V3 launcher-owned"
            }
        }
        Write-Host "Ollama ownership: $ollamaOwnership"
        $tags = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/tags" -TimeoutSeconds 2
        $installed = Test-DemoModelInstalledFromApi -TagsBody $tags.Body -ModelName $constants.ModelName
        Write-Host "Ollama: verified loopback; qwen3:8b installed=$installed"
        $resident = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/ps" -TimeoutSeconds 2
        try {
            $allocation = Get-DemoOllamaAllocationFromApi -Body $resident.Body
            Write-Host "Model resident: $($allocation.Allocation), VRAM $($allocation.VramMiB) MiB"
        } catch { Write-Host "Model: not resident or not 100% GPU" }
    } catch { Write-Host "Ollama: unavailable or unverified" }
}
