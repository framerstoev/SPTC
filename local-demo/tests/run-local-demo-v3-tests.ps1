#requires -Version 5.1
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$demoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) (
    "sptc-v3-launcher-tests-" + [guid]::NewGuid().ToString("D")
)
$script:caseRecords = @()

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param([AllowNull()][object]$Actual, [AllowNull()][object]$Expected, [string]$Message)
    if ($Actual -cne $Expected) { throw "$Message (actual=$Actual expected=$Expected)" }
}

function Assert-ThrowsLike {
    param([scriptblock]$Action, [string]$Pattern)
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "Expected '$Pattern', got: $($_.Exception.Message)"
        }
        return
    }
    throw "Expected an exception matching '$Pattern'."
}

function Invoke-V3Test {
    param([string]$Name, [scriptblock]$Action)
    $result = "pass"
    try { & $Action } catch {
        $result = "fail"
        Write-Host "FAIL ${Name}: $($_.Exception.Message)"
    }
    $script:caseRecords += [pscustomobject]@{ case_id = $Name; result = $result }
}

function Invoke-V3Mocked {
    param([hashtable]$Mocks, [scriptblock]$Action, [object[]]$Arguments = @())
    # Only this isolated test process's module functions are replaced. Every
    # replacement is restored even when a safety assertion fails.
    & $script:windowsModule {
        param($replacements, $body, $bodyArguments)
        $originals = @{}
        try {
            foreach ($name in $replacements.Keys) {
                $originals[$name] = Get-Item -LiteralPath "Function:$name" -ErrorAction SilentlyContinue
                Set-Item -LiteralPath "Function:script:$name" -Value $replacements[$name]
            }
            & $body @bodyArguments
        } finally {
            foreach ($name in $replacements.Keys) {
                if ($null -eq $originals[$name]) {
                    Remove-Item -LiteralPath "Function:script:$name"
                } else {
                    Set-Item -LiteralPath "Function:script:$name" -Value $originals[$name].ScriptBlock
                }
            }
        }
    } $Mocks $Action $Arguments
}

function New-CheckpointFacts {
    @{
        FrontendCommitExists = $true
        FrontendTagTarget = "e8d5cf801fb6f7fdeae0bc4a60406f76ba217b7d"
        FrontendContainsAcceptedCommit = $true
        FrontendApplicationCommitExists = $true
        FrontendContainsApplicationCommit = $true
        BackendHead = "e289aeb9ecf92d8d3d2f937dbc2d693342a35bee"
        BackendTagTarget = "b550f11ca75b8c4921667a264ae7a3ca78710ea9"
        FrontendChanges = @()
        FrontendStatus = @()
        BackendStatus = @()
    }
}

function New-HealthyControllers {
    @([pscustomobject]@{
            Name = "NVIDIA GeForce RTX 4060 Laptop GPU"
            Status = "OK"; ConfigManagerErrorCode = 0
        })
}

function New-HealthyNvidiaRows {
    @([pscustomobject]@{
            Name = "NVIDIA GeForce RTX 4060 Laptop GPU"
            DriverVersion = "fixture-driver"
            TotalMiB = 8188; UsedMiB = 5447; FreeMiB = 2741
        })
}

function New-Listener {
    param([int]$Port = 11434, [string]$Address = "127.0.0.1",
        [int]$ProcessId = 46, [string]$Path = "C:\Fixture\ollama.exe",
        [string]$Name = "ollama", [AllowNull()][string]$Command = "ollama.exe serve")
    [pscustomobject]@{
        Port = $Port; Address = $Address; ProcessId = $ProcessId
        ProcessPath = $Path; ProcessName = $Name; ProcessCommandLine = $Command
    }
}

function New-FixtureLayout {
    param([string]$Name)
    $root = Join-Path $temporaryRoot $Name
    $runtime = Join-Path $root ".runtime-v3"
    [pscustomobject]@{
        DemoRoot = $root; RuntimeRoot = $runtime
        LogsRoot = Join-Path $runtime "logs"
        StatePath = Join-Path $runtime "active-session.json"
        LockPath = Join-Path $runtime "lifecycle.lock"
        FrontendRepository = Join-Path $root "frontend"
        BackendRepository = Join-Path $root "backend"
        BackendPython = Join-Path $root "backend\.venv\Scripts\python.exe"
        BackendUvicorn = Join-Path $root "backend\.venv\Scripts\uvicorn.exe"
        BackendSupervisorPython = Join-Path $root "base\python.exe"
    }
}

function New-FixtureRecord {
    param([string]$Role = "backend", [int]$ProcessId = 502,
        [bool]$Owned = $true, [string]$Path = "C:\Fixture\python.exe",
        [int]$Port = 8080)
    New-DemoProcessRecord -Role $Role -ProcessId $ProcessId -ExecutablePath $Path `
        -StartTimeUtc "2026-09-01T12:00:00.0000000Z" -CreatedByLauncher $Owned -Port $Port
}

function New-FixtureState {
    param([pscustomobject]$Layout, [bool]$PreexistingOllama = $true)
    $session = [guid]::NewGuid().ToString("D")
    $state = New-DemoState -SessionId $session -CreatedAtUtc "2026-09-01T12:00:00Z" `
        -LogDirectory (Join-Path $Layout.LogsRoot $session)
    $state.status = "ready"
    $state.ready_at_utc = "2026-09-01T12:00:10Z"
    $state.startup_seconds = 10.0
    $state.warmup_seconds = 4.5
    $state.gpu_allocation = "100% GPU"
    $state.gpu_vram_used_mib = 5447
    $state.ollama_preexisting = $PreexistingOllama
    $state.model_loaded_by_launcher = $true
    $state.processes = @(
        (New-FixtureRecord -Role "ollama" -ProcessId 501 -Owned (-not $PreexistingOllama) `
            -Path "C:\Fixture\ollama.exe" -Port 11434),
        (New-FixtureRecord -Path $Layout.BackendPython),
        (New-FixtureRecord -Role "frontend" -ProcessId 503 -Path $Layout.BackendPython -Port 8001)
    )
    $state
}

function New-ActualFact {
    param([object]$Record)
    [pscustomobject]@{
        ProcessId = $Record.process_id
        ExecutablePath = $Record.executable_path
        StartTimeUtc = $Record.start_time_utc
    }
}

function New-V3SchemaFixture {
    param([string]$MissingPath = "none", [string]$MissingTool = "none", [string]$Profile = "v3")
    $paths = [ordered]@{}
    foreach ($path in @("/api/v1/sections/rank", "/api/v1/assistant/query",
            "/api/v1/sections/{cs_id}", "/api/v1/metrics/{metric_name}")) {
        if ($path -ne $MissingPath) { $paths[$path] = [pscustomobject]@{} }
    }
    $toolNames = @("rank_sections", "summarize_tier_alignment", "summarize_county_resilience",
        "explain_project_concept", "get_section_summary", "explain_metric", "compare_sections",
        "generate_review_note", "request_clarification", "answer_scope_explanation",
        "decline_unsupported_request") | Where-Object { $_ -ne $MissingTool }
    [pscustomobject]@{
        HttpStatus = 200
        Body = [pscustomobject]@{
            paths = [pscustomobject]$paths
            components = [pscustomobject]@{
                schemas = [pscustomobject]@{
                    AssistantQueryRequest = [pscustomobject]@{
                        properties = [pscustomobject]@{
                            assistant_profile = [pscustomobject]@{
                                anyOf = @([pscustomobject]@{ const = $Profile }, [pscustomobject]@{ type = "null" })
                            }
                        }
                    }
                    AssistantToolUse = [pscustomobject]@{
                        properties = [pscustomobject]@{
                            tool_name = [pscustomobject]@{ enum = @($toolNames) }
                        }
                    }
                }
            }
        }
    }
}

function Invoke-FixtureServiceContracts {
    param([pscustomobject]$Schema)
    $get = {
        param($Url, $TimeoutSeconds)
        if ($Url -ne "http://127.0.0.1:8080/openapi.json") { throw "Unexpected HTTP/model/Assistant call" }
        $Schema
    }.GetNewClosure()
    Invoke-V3Mocked @{
        "Wait-DemoHttpJson" = $get
        "Wait-DemoHttpStatus" = {
            param($Url, $TimeoutSeconds)
            if ($Url -ne "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent") { throw "V2 compatibility URL changed" }
            200
        }
    } { Assert-V3DemoServiceContracts -Layout ([pscustomobject]@{}) }
}

function Invoke-WrapperScopeFixture {
    param([ValidateSet("start", "stop")][string]$Operation,
        [ValidateSet("success", "failure", "negative_call_operator")][string]$Mode)
    $fixtureRoot = Join-Path $temporaryRoot ("wrapper-scope-" + $Operation + "-" + $Mode)
    [void](New-Item -ItemType Directory -Path $fixtureRoot)
    $wrapperName = "$Operation-local-chatbot-demo-v3.ps1"
    $wrapperPath = Join-Path $fixtureRoot $wrapperName
    $sourcePath = Join-Path $demoRoot $wrapperName
    # The positive/error cases execute the actual entry file byte-for-byte.
    # Only the negative control substitutes the formerly broken call operator.
    Copy-Item -LiteralPath $sourcePath -Destination $wrapperPath
    Assert-Equal (Get-FileHash -LiteralPath $wrapperPath).Hash `
        (Get-FileHash -LiteralPath $sourcePath).Hash "Actual wrapper fixture is unchanged"
    if ($Mode -eq "negative_call_operator") {
        $wrapper = Get-Content -LiteralPath $wrapperPath -Raw
        $pattern = '(?m)^\. (?=\(Join-Path \$PSScriptRoot)'
        Assert-Equal ([regex]::Matches($wrapper, $pattern).Count) 1 "One explicit shared-script invocation"
        [IO.File]::WriteAllText($wrapperPath, ([regex]::Replace($wrapper, $pattern, '& ')))
    }
    $moduleSource = @'
Set-StrictMode -Version Latest
function Invoke-FixtureModuleCallback {
    param([scriptblock]$Action)
    & $Action
}
Export-ModuleMember -Function Invoke-FixtureModuleCallback
'@
    [IO.File]::WriteAllText((Join-Path $fixtureRoot "Fixture.Lifecycle.psm1"), $moduleSource)
    $helperName = if ($Operation -eq "stop") { "Register-FailedStopHelper" } else { "Register-FailedDemoHelper" }
    $sharedSource = @'
param(
    [string]$LauncherProfile = "v2",
    [switch]$NoBrowser,
    [int]$WarmupTimeoutSeconds = 120,
    [int]$ServiceTimeoutSeconds = 30,
    [int]$GraceSeconds = 3
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "Fixture.Lifecycle.psm1") -Force
function __HELPER__ {
    param([string]$Profile)
    "HELPER_READY profile=$Profile"
}
$callback = {
    __HELPER__ -Profile $LauncherProfile
}.GetNewClosure()
$result = Invoke-FixtureModuleCallback -Action $callback
if ($result -ne "HELPER_READY profile=v3") { throw "Fixture lost the V3 profile or helper result." }
Write-Output $result
if ($env:SPTC_V3_SCOPE_FIXTURE_MODE -eq "failure") {
    throw "EXPECTED_FIXTURE_FAILURE_AFTER_PRIVATE_HELPER"
}
Write-Output ("FORWARDED no_browser={0} service_timeout={1} grace={2}" -f $NoBrowser, $ServiceTimeoutSeconds, $GraceSeconds)
Write-Output "WRAPPER_SCOPE_FIXTURE_COMPLETE"
'@
    [IO.File]::WriteAllText((Join-Path $fixtureRoot "$Operation-local-chatbot-demo.ps1"),
        $sharedSource.Replace("__HELPER__", $helperName))
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $wrapperPath)
    if ($Operation -eq "start") { $arguments += @("-NoBrowser", "-ServiceTimeoutSeconds", "17") }
    else { $arguments += @("-GraceSeconds", "2") }
    $result = Invoke-DemoCapturedProcess -FilePath (Join-Path $PSHOME "powershell.exe") `
        -ArgumentList $arguments -Environment @{ SPTC_V3_SCOPE_FIXTURE_MODE = $Mode } -TimeoutSeconds 10
    Assert-Equal $result.TimedOut $false "Wrapper scope fixture finishes without services"
    Assert-Equal $result.CleanupFailed $false "Owned fixture process cleanup succeeds"
    $result
}

try {
    [void](New-Item -ItemType Directory -Path $temporaryRoot)
    Import-Module (Join-Path $demoRoot "lib\LocalDemo.Core.psm1") -Force
    Invoke-V3Test "v2_default_checkpoints_and_url_unchanged" {
        $v2 = Get-LocalDemoConstants
        Assert-Equal $v2.AcceptedFrontendCommit "58f04a9c8d608fa9622bf8a0133d446118970543" "V2 frontend"
        Assert-Equal $v2.AcceptedBackendCommit "5edc4688514f2c47ae3e8c03f50b853c0f5d8108" "V2 backend"
        Assert-Equal $v2.AcceptedFrontendTag "phase3g-local-qwen-chatbot-accepted" "V2 tag"
        Assert-Equal $v2.BrowserUrl "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent" "V2 URL"
        Assert-Equal $v2.RuntimeSchemaVersion 1 "V2 state schema"
        Assert-Equal (Split-Path -Leaf (Get-LocalDemoLayout -ScriptRoot $demoRoot).RuntimeRoot) ".runtime" "V2 runtime"
    }
    Import-Module (Join-Path $demoRoot "lib\LocalDemo.Core.psm1") -Force -ArgumentList v3
    Import-Module (Join-Path $demoRoot "lib\LocalDemo.Windows.psm1") -Force -ArgumentList v3
    $script:windowsModule = Get-Module LocalDemo.Windows

    Invoke-V3Test "all_launcher_powershell_parses" {
        $files = @(Get-ChildItem -LiteralPath $demoRoot -Recurse -File | Where-Object {
                $_.Extension -in @(".ps1", ".psm1") -and $_.FullName -notmatch '\\.runtime'
            })
        Assert-True ($files.Count -ge 10) "Expected all V2/V3 PowerShell entry points/modules/tests."
        foreach ($file in $files) {
            $tokens = $null; $errors = $null
            [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
            Assert-Equal $errors.Count 0 "Parse errors: $($file.Name)"
        }
    }
    Invoke-V3Test "v3_exact_constants_and_separate_namespace" {
        $constants = Get-LocalDemoConstants
        Assert-Equal $constants.AcceptedFrontendCommit "e8d5cf801fb6f7fdeae0bc4a60406f76ba217b7d" "V3 frontend"
        Assert-Equal $constants.AcceptedBackendCommit "e289aeb9ecf92d8d3d2f937dbc2d693342a35bee" "V3 backend"
        Assert-Equal $constants.AcceptedFrontendTag "phase4a-v3-tier-aware-explorer-accepted" "V3 tag"
        Assert-Equal $constants.BrowserUrl "http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent" "V3 browser"
        Assert-Equal $constants.RuntimeSchemaVersion 3 "V3 schema"
        $layout = Get-LocalDemoLayout -ScriptRoot $demoRoot
        Assert-Equal (Split-Path -Leaf $layout.RuntimeRoot) ".runtime-v3" "Independent runtime"
        Assert-True ($layout.StatePath -notmatch '\\.runtime\\') "V3 must not use V2 state."
    }
    Invoke-V3Test "accepted_frontend_and_backend_checkpoint" {
        Assert-Equal (& $script:windowsModule { Get-V3DemoApplicationCheckpoint }) "1861bfc9e4a6ddd4691d4d7256980de5a43a895a" "Phase 4B content pin"
        $facts = New-CheckpointFacts
        Assert-V3DemoCheckpointFacts @facts
    }
    foreach ($mutation in @(
            @{ Name = "missing_frontend_commit"; Key = "FrontendCommitExists"; Value = $false },
            @{ Name = "missing_phase4b_application_commit"; Key = "FrontendApplicationCommitExists"; Value = $false },
            @{ Name = "unrelated_phase4b_application_head"; Key = "FrontendContainsApplicationCommit"; Value = $false },
            @{ Name = "wrong_frontend_tag"; Key = "FrontendTagTarget"; Value = "0000000000000000000000000000000000000000" },
            @{ Name = "unrelated_frontend_head"; Key = "FrontendContainsAcceptedCommit"; Value = $false },
            @{ Name = "wrong_backend_head"; Key = "BackendHead"; Value = "5edc4688514f2c47ae3e8c03f50b853c0f5d8108" },
            @{ Name = "old_backend_baseline_runtime_rejected"; Key = "BackendHead"; Value = "b550f11ca75b8c4921667a264ae7a3ca78710ea9" },
            @{ Name = "moved_backend_baseline_tag_rejected"; Key = "BackendTagTarget"; Value = "e289aeb9ecf92d8d3d2f937dbc2d693342a35bee" },
            @{ Name = "wrong_backend_tag"; Key = "BackendTagTarget"; Value = "wrong" }
        )) {
        Invoke-V3Test $mutation.Name {
            $facts = New-CheckpointFacts; $facts[$mutation.Key] = $mutation.Value
            Assert-ThrowsLike { Assert-V3DemoCheckpointFacts @facts } "checkpoint/tag"
        }
    }
    Invoke-V3Test "launcher_only_committed_descendant_is_application_equivalent" {
        $facts = New-CheckpointFacts; $facts.FrontendChanges = @(Get-V3DemoAllowedChanges)
        Assert-V3DemoCheckpointFacts @facts
    }
    foreach ($path in @("coldwave-demo-v3/js/app.js", "coldwave-demo-v3/data/summary.json",
            "coldwave-demo-v2/js/app.js", "coldwave-demo/index.html", "local-demo/unreviewed.ps1",
            "local-demo/tests/run-local-demo-tests.ps1", "LOCAL-DEMO/README-V3.md", "debug.log")) {
        Invoke-V3Test ("committed_change_rejected_" + $path) {
            $facts = New-CheckpointFacts; $facts.FrontendChanges = @($path)
            Assert-ThrowsLike { Assert-V3DemoCheckpointFacts @facts } "production content differs"
        }
    }
    Invoke-V3Test "accepted_root_untracked_debug_file_allowlisted" {
        $facts = New-CheckpointFacts; $facts.FrontendStatus = @("?? debug.log")
        Assert-V3DemoCheckpointFacts @facts
    }
    foreach ($line in @(" M coldwave-demo-v3/js/app.js", "M  local-demo/lib/LocalDemo.Core.psm1",
            "?? local-demo/unreviewed.ps1", "?? data/debug.log", "?? Debug.log", " M debug.log",
            "A  debug.log", "?? debug.log.bak")) {
        Invoke-V3Test ("dirty_frontend_rejected_" + $line.Trim()) {
            $facts = New-CheckpointFacts; $facts.FrontendStatus = @("?? debug.log", $line)
            Assert-ThrowsLike { Assert-V3DemoCheckpointFacts @facts } "dirty frontend"
        }
    }
    foreach ($line in @(" M src/resilience_agent/api.py", "?? debug.log")) {
        Invoke-V3Test ("dirty_backend_rejected_" + $line.Trim()) {
            $facts = New-CheckpointFacts; $facts.BackendStatus = @($line)
            Assert-ThrowsLike { Assert-V3DemoCheckpointFacts @facts } "dirty backend"
        }
    }

    Invoke-V3Test "healthy_gpu_reports_driver_and_vram" {
        $gpu = Assert-DemoGpuFacts -Controllers (New-HealthyControllers) -NvidiaSmiExitCode 0 -NvidiaRows (New-HealthyNvidiaRows)
        Assert-Equal $gpu.DriverVersion "fixture-driver" "Driver state"
        Assert-Equal $gpu.UsedMiB 5447 "Used VRAM"
    }
    Invoke-V3Test "missing_gpu_fails_closed" {
        Assert-ThrowsLike { Assert-DemoGpuFacts -Controllers @() -NvidiaSmiExitCode 0 -NvidiaRows (New-HealthyNvidiaRows) } "not found"
    }
    Invoke-V3Test "gpu_code43_no_cpu_fallback" {
        $controllers = New-HealthyControllers; $controllers[0].ConfigManagerErrorCode = 43
        Assert-ThrowsLike { Assert-DemoGpuFacts -Controllers $controllers -NvidiaSmiExitCode 0 -NvidiaRows (New-HealthyNvidiaRows) } "ConfigManagerErrorCode=43"
    }
    Invoke-V3Test "unhealthy_windows_driver_status_rejected" {
        $controllers = New-HealthyControllers; $controllers[0].Status = "Error"
        Assert-ThrowsLike { Assert-DemoGpuFacts -Controllers $controllers -NvidiaSmiExitCode 0 -NvidiaRows (New-HealthyNvidiaRows) } "not healthy"
    }
    Invoke-V3Test "nvidia_smi_failure_stops_startup" {
        Assert-ThrowsLike { Assert-DemoGpuFacts -Controllers (New-HealthyControllers) -NvidiaSmiExitCode 1 -NvidiaRows @() } "nvidia-smi failed"
    }
    Invoke-V3Test "smi_success_without_required_gpu_rejected" {
        Assert-ThrowsLike { Assert-DemoGpuFacts -Controllers (New-HealthyControllers) -NvidiaSmiExitCode 0 -NvidiaRows @() } "did not report"
    }
    Invoke-V3Test "missing_exact_model_manifest_rejected" {
        Assert-ThrowsLike { Assert-RequiredDemoPath -Path "C:\Fixture\qwen3\8b" -PathType Leaf -Label "Installed qwen3:8b manifest" -Exists $false } "qwen3:8b"
    }
    foreach ($model in @("qwen3:8b", "qwen3:4b", "other:8b")) {
        Invoke-V3Test ("exact_model_api_" + $model) {
            $installed = Test-DemoModelInstalledFromApi -TagsBody ([pscustomobject]@{ models = @([pscustomobject]@{ name = $model }) })
            Assert-Equal $installed ($model -eq "qwen3:8b") "No model substitution"
        }
    }
    Invoke-V3Test "missing_model_api_rejected" {
        Assert-Equal (Test-DemoModelInstalledFromApi -TagsBody ([pscustomobject]@{ models = @() })) $false "Empty installed list"
    }
    Invoke-V3Test "warmup_ready_timing_contract" {
        Assert-Equal (Assert-DemoWarmupResult -ExitCode 0 -StandardOutput "READY elapsed_seconds=4.321" -TimedOut $false) 4.321 "Warm-up seconds"
    }
    foreach ($failure in @(
            @{ Name = "warmup_timeout"; Exit = 0; Text = "READY elapsed_seconds=4.321"; Timeout = $true },
            @{ Name = "warmup_failure"; Exit = 1; Text = "READY elapsed_seconds=4.321"; Timeout = $false },
            @{ Name = "warmup_raw_response_not_ready"; Exit = 0; Text = "some model response"; Timeout = $false }
        )) {
        Invoke-V3Test $failure.Name {
            Assert-ThrowsLike { Assert-DemoWarmupResult -ExitCode $failure.Exit -StandardOutput $failure.Text -TimedOut $failure.Timeout } "warm-up"
        }
    }
    Invoke-V3Test "full_gpu_residency_cli_and_api" {
        Assert-Equal (Get-DemoOllamaAllocation -Output "qwen3:8b fixture 5.2 GB 100% GPU") "100% GPU" "CLI residency"
        $api = Get-DemoOllamaAllocationFromApi -Body ([pscustomobject]@{ models = @([pscustomobject]@{ name = "qwen3:8b"; size = 5000000000; size_vram = 5000000000 }) })
        Assert-Equal $api.Allocation "100% GPU" "API residency"
    }
    Invoke-V3Test "partial_cpu_gpu_residency_rejected" {
        Assert-ThrowsLike { Get-DemoOllamaAllocation -Output "qwen3:8b fixture 5.2 GB 70% GPU" } "not allocated 100%"
        Assert-ThrowsLike { Get-DemoOllamaAllocationFromApi -Body ([pscustomobject]@{ models = @([pscustomobject]@{ name = "qwen3:8b"; size = 5000000000; size_vram = 3000000000 }) }) } "not allocated 100%"
    }

    Invoke-V3Test "healthy_preexisting_ollama_reused" {
        $policy = Resolve-DemoPortPolicy -Port 11434 -Listeners @(New-Listener) -ExpectedOllamaPath "C:\Fixture\ollama.exe"
        Assert-Equal $policy.Disposition "preexisting_ollama" "Reuse disposition"
        Assert-Equal $policy.ProcessId 46 "Verified owner"
    }
    Invoke-V3Test "free_ollama_port_allows_launcher_owned_start" {
        Assert-Equal (Resolve-DemoPortPolicy -Port 11434 -Listeners @()).Disposition "free" "No unrelated owner"
        $layout = New-FixtureLayout "own-ollama"; $state = New-FixtureState $layout $false
        Assert-True $state.processes[0].created_by_launcher "New Ollama ownership"
    }
    foreach ($port in @(8001, 8080)) {
        Invoke-V3Test ("unrelated_port_" + $port) {
            Assert-ThrowsLike { Resolve-DemoPortPolicy -Port $port -Listeners @(New-Listener -Port $port -Path "C:\Other\python.exe" -Name "python") } "No process was stopped"
        }
        Invoke-V3Test ("v3_cross_session_conflict_" + $port) {
            $fixture = @(New-Listener -Port $port -Path "C:\Other\python.exe" -Name "python")
            $provider = { param($Port) @($fixture | Where-Object { $_.Port -eq $Port }) }.GetNewClosure()
            Assert-ThrowsLike {
                Invoke-V3Mocked @{ "Get-DemoPortListeners" = $provider } { Assert-V3DemoAvailablePorts }
            } "Stop the existing launcher session before starting V3"
        }
    }
    Invoke-V3Test "unrelated_11434_owner_never_reused" {
        Assert-ThrowsLike { Resolve-DemoPortPolicy -Port 11434 -Listeners @(New-Listener -Path "C:\Other\python.exe" -Name "python") -ExpectedOllamaPath "C:\Fixture\ollama.exe" } "unrelated PID 46"
    }
    foreach ($address in @("0.0.0.0", "::", "::1", "192.168.1.5")) {
        Invoke-V3Test ("non_exact_loopback_ollama_" + $address) {
            Assert-ThrowsLike { Resolve-DemoPortPolicy -Port 11434 -Listeners @(New-Listener -Address $address) -ExpectedOllamaPath "C:\Fixture\ollama.exe" } "only on 127.0.0.1"
        }
    }
    Invoke-V3Test "ollama_multiple_owners_rejected" {
        Assert-ThrowsLike { Resolve-DemoPortPolicy -Port 11434 -Listeners @((New-Listener), (New-Listener -ProcessId 47)) -ExpectedOllamaPath "C:\Fixture\ollama.exe" } "multiple listener owners"
    }
    Invoke-V3Test "nonserve_ollama_rejected" {
        Assert-ThrowsLike { Resolve-DemoPortPolicy -Port 11434 -Listeners @(New-Listener -Command "ollama.exe run qwen3:8b") -ExpectedOllamaPath "C:\Fixture\ollama.exe" } "serve process"
    }
    Invoke-V3Test "unavailable_command_line_still_requires_exact_executable" {
        Assert-Equal (Resolve-DemoPortPolicy -Port 11434 -Listeners @(New-Listener -Command $null) -ExpectedOllamaPath "C:\Fixture\ollama.exe").Disposition "preexisting_ollama" "Reviewed non-admin path"
    }

    Invoke-V3Test "v3_state_round_trip_with_operational_metadata" {
        $layout = New-FixtureLayout "roundtrip"; Initialize-DemoRuntime $layout
        $state = New-FixtureState $layout
        Write-DemoState -State $state -StatePath $layout.StatePath
        $read = Read-DemoState -StatePath $layout.StatePath -Layout $layout
        Assert-Equal $read.schema_version 3 "V3 state persisted"
        Assert-Equal $read.processes.Count 3 "Service identities persisted"
        Assert-Equal $read.browser_url (Get-LocalDemoConstants).BrowserUrl "No V2 state alias"
        Assert-True (($state.Keys -join ",") -notmatch "prompt|answer|evidence|question|history") "Operational state keys only"
    }
    foreach ($mutation in @(
            @{ Name = "v2_state_schema_rejected"; Apply = { param($s) $s.schema_version = 1 }; Pattern = "schema" },
            @{ Name = "v2_browser_state_rejected"; Apply = { param($s) $s.browser_url = "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent" }; Pattern = "session metadata" },
            @{ Name = "wrong_model_state_rejected"; Apply = { param($s) $s.model_name = "other:8b" }; Pattern = "session metadata" },
            @{ Name = "out_of_root_logs_rejected"; Apply = { param($s) $s.log_directory = "C:\Other\logs" }; Pattern = "outside" },
            @{ Name = "relative_executable_rejected"; Apply = { param($s) $s.processes[1].executable_path = "python.exe" }; Pattern = "not absolute" },
            @{ Name = "wrong_executable_rejected"; Apply = { param($s) $s.processes[1].executable_path = "C:\Other\notepad.exe" }; Pattern = "unauthorized executable" },
            @{ Name = "duplicate_pid_rejected"; Apply = { param($s) $s.processes[2].process_id = 502 }; Pattern = "conflicting process" },
            @{ Name = "incorrect_role_port_rejected"; Apply = { param($s) $s.processes[1].port = 8001 }; Pattern = "conflicting process" },
            @{ Name = "external_frontend_ownership_rejected"; Apply = { param($s) $s.processes[2].created_by_launcher = $false }; Pattern = "Only a verified Ollama" },
            @{ Name = "unmatched_child_link_rejected"; Apply = { param($s) $s.processes[1].launcher_process_id = 9876 }; Pattern = "unmatched child" },
            @{ Name = "false_gpu_readiness_rejected"; Apply = { param($s) $s.gpu_allocation = "50% GPU" }; Pattern = "readiness metadata" }
        )) {
        Invoke-V3Test $mutation.Name {
            $layout = New-FixtureLayout $mutation.Name; Initialize-DemoRuntime $layout
            $state = New-FixtureState $layout; & $mutation.Apply $state
            Write-DemoState -State $state -StatePath $layout.StatePath
            Assert-ThrowsLike { Read-DemoState -StatePath $layout.StatePath -Layout $layout } $mutation.Pattern
        }
    }
    foreach ($case in @("missing_after_reboot", "pid_reused_path", "pid_reused_start_time", "ollama_restarted_independently")) {
        Invoke-V3Test ("stale_identity_" + $case) {
            $layout = New-FixtureLayout $case; $state = New-FixtureState $layout
            $actual = @{}
            if ($case -ne "missing_after_reboot") {
                $record = if ($case -eq "ollama_restarted_independently") { $state.processes[0] } else { $state.processes[1] }
                $fact = New-ActualFact $record
                if ($case -eq "pid_reused_path") { $fact.ExecutablePath = "C:\Other\python.exe" } else { $fact.StartTimeUtc = "2026-09-02T12:00:00.0000000Z" }
                $actual[[string]$fact.ProcessId] = $fact
                Assert-Equal (Test-DemoProcessIdentity -Record $record -ActualProcess $fact) $false "Identity reuse rejected"
            }
            Assert-Equal (Get-DemoSessionDisposition -State $state -ActualProcesses $actual) "stale" "No matching identity"
        }
    }
    Invoke-V3Test "partially_matching_state_is_not_discarded" {
        $state = New-FixtureState (New-FixtureLayout "partial")
        $actual = @{ "501" = (New-ActualFact $state.processes[0]) }
        Assert-Equal (Get-DemoSessionDisposition -State $state -ActualProcesses $actual) "partial" "Live external identity retains conservative state"
    }
    Invoke-V3Test "all_matching_ready_identities_active" {
        $state = New-FixtureState (New-FixtureLayout "active"); $actual = @{}
        foreach ($record in $state.processes) { $actual[[string]$record.process_id] = New-ActualFact $record }
        Assert-Equal (Get-DemoSessionDisposition -State $state -ActualProcesses $actual) "active" "All identities match"
    }
    foreach ($case in @("reboot", "unrelated_reused_pid")) {
        Invoke-V3Test ("actual_stale_startup_branch_" + $case) {
            $layout = New-FixtureLayout ("stale-branch-" + $case); Initialize-DemoRuntime $layout
            $state = New-FixtureState $layout
            Write-DemoState -State $state -StatePath $layout.StatePath
            $sentinel = Join-Path $layout.RuntimeRoot "keep-operational.json"
            Write-DemoState -State @{ keep = "unrelated fixture" } -StatePath $sentinel
            $v2Runtime = Join-Path $layout.DemoRoot ".runtime"
            [void](New-Item -ItemType Directory -Path $v2Runtime)
            $v2State = Join-Path $v2Runtime "active-session.json"
            Write-DemoState -State @{ keep = "V2 fixture" } -StatePath $v2State
            $source = Get-Content -LiteralPath (Join-Path $demoRoot "start-local-chatbot-demo.ps1") -Raw
            $start = $source.IndexOf('$stage = "existing session check"')
            $end = $source.IndexOf('$stage = "Windows PowerShell verification"', $start)
            Assert-True ($start -ge 0 -and $end -gt $start) "Actual startup branch markers exist"
            $branch = [scriptblock]::Create($source.Substring($start, $end - $start))
            $actual = @{}
            if ($case -eq "unrelated_reused_pid") {
                $actual["502"] = [pscustomobject]@{ ProcessId = 502; ExecutablePath = "C:\Other\python.exe"; StartTimeUtc = "2026-09-02T12:00:00Z" }
            }
            $provider = { param($Records) $actual }.GetNewClosure()
            Invoke-V3Mocked @{
                "Get-DemoActualProcessMap" = $provider
                "Stop-DemoOwnedProcess" = { throw "MUST NOT STOP ANY PROCESS during stale cleanup" }
                "Stop-Process" = { throw "MUST NOT KILL ANY PROCESS during stale cleanup" }
                "Limit-DemoSessionLogs" = { throw "MUST NOT alter stale V3 logs" }
            } {
                param($fixtureLayout, $startupBranch)
                $layout = $fixtureLayout; $LauncherProfile = "v3"
                $activeExistingState = $null; $preservedExistingSession = $false
                & $startupBranch
            } @($layout, $branch)
            Assert-Equal (Test-Path -LiteralPath $layout.StatePath) $false "Only stale V3 state removed"
            Assert-True (Test-Path -LiteralPath $sentinel) "Other operational file preserved"
            Assert-True (Test-Path -LiteralPath $v2State) "V2 state preserved"
            Write-DemoState -State (New-FixtureState $layout) -StatePath $layout.StatePath
            Assert-Equal (Read-DemoState -StatePath $layout.StatePath -Layout $layout).schema_version 3 "New clean session can be persisted"
        }
    }

    Invoke-V3Test "stop_preserves_preexisting_ollama_without_process_probe" {
        $record = New-FixtureRecord -Role "ollama" -Port 11434 -Path "C:\Fixture\ollama.exe" -Owned $false
        $result = Invoke-V3Mocked @{
            "Get-DemoProcessFact" = { throw "Pre-existing Ollama must not be probed for termination" }
            "Stop-Process" = { throw "Unrelated termination forbidden" }
        } { param($r) Stop-DemoOwnedProcess -Record $r } @($record)
        Assert-Equal $result.Reason "preexisting" "External ownership preserved"
    }
    foreach ($case in @("absent", "reused_pid", "same_path_new_start")) {
        Invoke-V3Test ("stop_never_kills_" + $case) {
            $record = New-FixtureRecord
            $fact = if ($case -eq "absent") { $null } else { New-ActualFact $record }
            if ($case -eq "reused_pid") { $fact.ExecutablePath = "C:\Other\python.exe" }
            if ($case -eq "same_path_new_start") { $fact.StartTimeUtc = "2026-09-02T12:00:00Z" }
            $provider = { param($ProcessId) $fact }.GetNewClosure()
            $result = Invoke-V3Mocked @{
                "Get-DemoProcessFact" = $provider
                "Get-Process" = { throw "MUST NOT acquire unrelated process for stopping" }
                "Stop-Process" = { throw "MUST NOT kill unrelated process" }
            } { param($r) Stop-DemoOwnedProcess -Record $r } @($record)
            Assert-Equal $result.Reason "identity_mismatch_or_absent" "No unrelated process action"
        }
    }
    foreach ($role in @("frontend", "backend")) {
        Invoke-V3Test ("stop_matching_owned_" + $role) {
            $record = New-FixtureRecord -Role $role
            $fact = New-ActualFact $record
            $events = New-Object Collections.ArrayList
            $fakeProcess = [pscustomobject]@{ Events = $events }
            $fakeProcess | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value {
                [void]$this.Events.Add("graceful-close"); $true
            }
            $fakeProcess | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Milliseconds) $true }
            $provider = { param($ProcessId) $fact }.GetNewClosure()
            $getProcess = {
                param($Id, $ErrorAction)
                if ($Id -ne $record.process_id) { throw "Wrong owned PID" }
                $fakeProcess
            }.GetNewClosure()
            $result = Invoke-V3Mocked @{
                "Get-DemoProcessFact" = $provider
                "Get-Process" = $getProcess
                "Stop-Process" = { throw "Force unnecessary after graceful exit" }
            } { param($r) Stop-DemoOwnedProcess -Record $r -GraceSeconds 1 } @($record)
            Assert-Equal $result.Reason "graceful" "Verified owned service shutdown"
            Assert-Equal ($events -join ",") "graceful-close" "Only owned fake process received graceful close"
        }
    }
    foreach ($stage in @("normal", "force")) {
        Invoke-V3Test ("stop_revalidates_identity_before_" + $stage) {
            $record = New-FixtureRecord; $fact = New-ActualFact $record
            $reused = New-ActualFact $record; $reused.StartTimeUtc = "2026-09-02T12:00:00Z"
            $counter = @{ Calls = 0 }; $events = New-Object Collections.ArrayList
            $changeAt = if ($stage -eq "normal") { 2 } else { 3 }
            $provider = {
                param($ProcessId)
                $counter.Calls += 1
                if ($counter.Calls -ge $changeAt) { $reused } else { $fact }
            }.GetNewClosure()
            $fakeProcess = [pscustomobject]@{}
            $fakeProcess | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value { $false }
            $fakeProcess | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Milliseconds) $false }
            $getProcess = { param($Id, $ErrorAction) $fakeProcess }.GetNewClosure()
            $stop = {
                param($Id, [switch]$Force, $ErrorAction)
                if ($Force) { throw "Must not force-stop a reused PID" }
                [void]$events.Add("normal-stop:" + $Id)
            }.GetNewClosure()
            $result = Invoke-V3Mocked @{
                "Get-DemoProcessFact" = $provider
                "Get-Process" = $getProcess
                "Stop-Process" = $stop
            } { param($r) Stop-DemoOwnedProcess -Record $r -GraceSeconds 1 } @($record)
            $expectedReason = if ($stage -eq "normal") { "identity_changed_before_normal_stop" } else { "identity_changed_before_force" }
            Assert-Equal $result.Reason $expectedReason "Identity rechecked at stop boundary"
            Assert-Equal $events.Count ([int]($stage -eq "force")) "Only pre-reuse stop authorization used"
        }
    }
    foreach ($case in @("verified", "reused_parent_pid", "unrelated_parent")) {
        Invoke-V3Test ("child_supervisor_identity_" + $case) {
            $ancestor = New-FixtureRecord -Role "backend_launcher" -ProcessId 601
            $fact = New-ActualFact $ancestor
            if ($case -eq "reused_parent_pid") { $fact.StartTimeUtc = "2026-09-02T12:00:00Z" }
            $parentId = if ($case -eq "unrelated_parent") { 0 } else { 601 }
            $facts = { param($targetProcessId) $fact }.GetNewClosure()
            $parents = { param($targetProcessId) $parentId }.GetNewClosure()
            $verified = Test-DemoProcessDescendant -ProcessId 602 -AncestorRecord $ancestor `
                -ParentProcessIdProvider $parents -ProcessFactProvider $facts
            Assert-Equal $verified ($case -eq "verified") "Parent PID alone never authorizes child ownership"
        }
    }
    foreach ($owned in @($false, $true)) {
        Invoke-V3Test ("shutdown_sequence_ollama_owned_" + $owned) {
            $state = New-FixtureState (New-FixtureLayout ("shutdown-" + $owned)) (-not $owned)
            $events = New-Object Collections.ArrayList
            $stop = { param($r) [void]$events.Add("stop:" + $r.role); [pscustomobject]@{ Stopped = $true; Reason = "fixture" } }.GetNewClosure()
            $unload = { param($s) [void]$events.Add("unload:qwen3:8b"); [pscustomobject]@{ Succeeded = $true } }.GetNewClosure()
            [void](Invoke-DemoShutdownSequence -State $state -StopProcessAction $stop -UnloadModelAction $unload)
            $expected = "stop:frontend,stop:backend,unload:qwen3:8b"
            if ($owned) { $expected += ",stop:ollama" }
            Assert-Equal ($events -join ",") $expected "Only owned services stopped, unload before owned Ollama"
        }
    }
    Invoke-V3Test "preexisting_resident_model_not_unloaded" {
        $state = New-FixtureState (New-FixtureLayout "preexisting-model")
        $state.model_loaded_by_launcher = $false; $state.model_preexisting_resident = $true
        $result = Invoke-DemoShutdownSequence -State $state -StopProcessAction {
            param($r) [pscustomobject]@{ Stopped = $true; Reason = "fixture" }
        } -UnloadModelAction { throw "Must preserve pre-existing resident model" }
        Assert-Equal $result.UnloadResult $null "No unload authorization"
    }
    Invoke-V3Test "failed_owned_backend_stop_defers_ollama_shutdown_and_unload" {
        $state = New-FixtureState (New-FixtureLayout "deferred-stop") $false
        $result = Invoke-DemoShutdownSequence -State $state -StopProcessAction {
            param($r)
            if ($r.role -eq "ollama") { throw "Must not stop Ollama while backend remains" }
            [pscustomobject]@{ Stopped = $false; Reason = "fixture_busy" }
        } -UnloadModelAction { throw "Must not unload while backend remains" }
        Assert-True $result.OllamaShutdownDeferred "Owned Ollama cleanup deferred safely"
    }
    Invoke-V3Test "restarted_external_ollama_not_unloaded" {
        $record = New-FixtureRecord -Role "ollama" -Port 11434 -Path "C:\Fixture\ollama.exe" -Owned $false
        Assert-ThrowsLike {
            Invoke-V3Mocked @{
                "Assert-DemoOllamaServiceIdentity" = { throw "identity changed after independent restart" }
                "Invoke-DemoOllamaCommand" = { throw "Must not unload replacement Ollama" }
            } {
                param($r)
                Invoke-DemoVerifiedModelUnload -OllamaRecord $r -State ([pscustomobject]@{ processes = @($r) }) `
                    -OllamaPath "C:\Fixture\ollama.exe" -ModelName "qwen3:8b"
            } @($record)
        } "identity changed"
    }

    Invoke-V3Test "v2_session_presence_blocks_v3_without_state_mutation" {
        $layout = New-FixtureLayout "v2-conflict"
        $v2Runtime = Join-Path $layout.DemoRoot ".runtime"
        [void](New-Item -ItemType Directory -Path $v2Runtime -Force)
        $statePath = Join-Path $v2Runtime "active-session.json"
        Write-DemoState -State @{ sentinel = "unchanged" } -StatePath $statePath
        $hash = (Get-FileHash -LiteralPath $statePath).Hash
        Assert-ThrowsLike { Enter-V3DemoCompatibilityLock -Layout $layout } "recorded by V2"
        Assert-Equal (Get-FileHash -LiteralPath $statePath).Hash $hash "V2 state byte-preserved"
        $lock = Enter-DemoLifecycleLock -LockPath (Join-Path $v2Runtime "lifecycle.lock")
        $lock.Dispose()
    }
    Invoke-V3Test "v3_holds_v2_compatibility_lock_during_launch" {
        $layout = New-FixtureLayout "compatibility-lock"
        [void](New-Item -ItemType Directory -Path (Join-Path $layout.DemoRoot ".runtime") -Force)
        $lock = Enter-V3DemoCompatibilityLock -Layout $layout
        try {
            Assert-ThrowsLike { Enter-DemoLifecycleLock -LockPath (Join-Path $layout.DemoRoot ".runtime\lifecycle.lock") } "another|in use|already|locked"
        } finally { $lock.Dispose() }
    }

    Invoke-V3Test "v3_browser_opens_only_fixed_v3_target" {
        $events = New-Object Collections.ArrayList
        $open = { param($Url) [void]$events.Add($Url) }.GetNewClosure()
        Invoke-V3Mocked @{ "Open-DemoBrowser" = $open } { Open-V3DemoBrowser -Url (Get-LocalDemoConstants).BrowserUrl }
        Assert-Equal ($events -join ",") "http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent" "Browser target"
    }
    Invoke-V3Test "v3_browser_failure_keeps_ready_demo_and_reports_url" {
        $output = @(Invoke-V3Mocked @{ "Open-DemoBrowser" = { throw "fixture browser failure" } } {
                Open-V3DemoBrowser -Url (Get-LocalDemoConstants).BrowserUrl
            } 3>&1)
        Assert-True (($output -join " ") -match "ready demo remains running.+coldwave-demo-v3") "Manual fallback URL"
    }
    foreach ($missing in @("none", "/api/v1/sections/rank", "/api/v1/assistant/query", "/api/v1/sections/{cs_id}", "/api/v1/metrics/{metric_name}")) {
        Invoke-V3Test ("v3_service_contract_" + $missing) {
            $schema = New-V3SchemaFixture -MissingPath $missing
            $action = { Invoke-FixtureServiceContracts -Schema $schema }
            if ($missing -eq "none") { & $action } else { Assert-ThrowsLike $action "endpoint is missing" }
        }
    }
    foreach ($missing in @("rank_sections", "summarize_tier_alignment", "summarize_county_resilience",
            "explain_project_concept", "get_section_summary", "explain_metric", "compare_sections",
            "generate_review_note", "request_clarification", "answer_scope_explanation", "decline_unsupported_request")) {
        Invoke-V3Test ("v3_and_v2_tool_contract_required_" + $missing) {
            $schema = New-V3SchemaFixture -MissingTool $missing
            Assert-ThrowsLike { Invoke-FixtureServiceContracts -Schema $schema } ([regex]::Escape("tool contract is missing: $missing"))
        }
    }
    foreach ($profile in @("v2", "other")) {
        Invoke-V3Test ("wrong_assistant_profile_" + $profile) {
            $schema = New-V3SchemaFixture -Profile $profile
            Assert-ThrowsLike { Invoke-FixtureServiceContracts -Schema $schema } "profile contract is missing"
        }
    }
    Invoke-V3Test "status_is_operational_only_read_only_and_model_safe" {
        $layout = New-FixtureLayout "status"; $state = New-FixtureState $layout
        $state["private_prompt"] = "DO-NOT-PRINT-PRIVATE-CONTENT"
        $mockState = { param($StatePath, $Layout) $state }.GetNewClosure()
        $mocks = @{
            "Resolve-DemoExecutable" = { param($CommandName) "C:\Fixture\$CommandName" }
            "Invoke-DemoGit" = { param($GitPath, $Repository, $Arguments) [pscustomobject]@{ Output = "fixture-checkpoint"; ExitCode = 0 } }
            "Assert-V3DemoRepositoryCheckpoints" = { param($Layout, $GitPath) }
            "Read-DemoState" = $mockState
            "Get-DemoActualProcessMap" = { param($Records) @{} }
            "Get-DemoPortListeners" = { param($Port) @() }
            "Invoke-DemoNvidiaSmi" = { param($NvidiaSmiPath) throw "fixture GPU unavailable" }
            "Wait-DemoHttpStatus" = { param($Url, $TimeoutSeconds) 200 }
            "Wait-DemoHttpJson" = { param($Url, $TimeoutSeconds) throw "fixture service unavailable" }
            "Start-DemoProcess" = { throw "Status must not start a process" }
            "Stop-DemoOwnedProcess" = { throw "Status must not stop a process" }
            "Invoke-DemoOllamaCommand" = { throw "Status must not load/unload or prompt a model" }
            "Write-DemoState" = { throw "Status must not write state" }
        }
        $output = @(Invoke-V3Mocked $mocks { param($fixture) Write-V3DemoStatus -Layout $fixture } @($layout) *>&1)
        $text = $output -join " "
        Assert-True ($text -match "V3 state: stale") "Stale state reported without cleanup"
        Assert-True ($text -match "pre-existing") "Ollama ownership reported"
        Assert-True ($text -match "coldwave-demo-v3") "V3 URL reported"
        Assert-True ($text -notmatch "DO-NOT-PRINT-PRIVATE-CONTENT|private_prompt") "No prompt/history/evidence output"
    }
    Invoke-V3Test "healthy_status_reports_installed_resident_gpu_and_ports_without_model_call" {
        $layout = New-FixtureLayout "healthy-status"
        $controllers = @(New-HealthyControllers); $rows = @(New-HealthyNvidiaRows)
        $gpuFacts = { $controllers }.GetNewClosure()
        $smi = { param($NvidiaSmiPath) [pscustomobject]@{ ExitCode = 0; Rows = $rows } }.GetNewClosure()
        $mocks = @{
            "Resolve-DemoExecutable" = { param($CommandName) "C:\Fixture\$CommandName" }
            "Invoke-DemoGit" = { param($GitPath, $Repository, $Arguments) [pscustomobject]@{ Output = "fixture-checkpoint"; ExitCode = 0 } }
            "Assert-V3DemoRepositoryCheckpoints" = { param($Layout, $GitPath) }
            "Read-DemoState" = { param($StatePath, $Layout) $null }
            "Get-DemoPortListeners" = {
                param($Port)
                if ($Port -eq 11434) {
                    [pscustomobject]@{ Port = 11434; Address = "127.0.0.1"; ProcessId = 46
                        ProcessPath = "C:\Fixture\ollama.exe"; ProcessName = "ollama"; ProcessCommandLine = "ollama.exe serve" }
                }
            }
            "Invoke-DemoNvidiaSmi" = $smi
            "Get-DemoGpuControllers" = $gpuFacts
            "Wait-DemoHttpStatus" = { param($Url, $TimeoutSeconds) 200 }
            "Wait-DemoHttpJson" = {
                param($Url, $TimeoutSeconds)
                switch ($Url) {
                    "http://127.0.0.1:8080/health" { throw "fixture backend unavailable" }
                    "http://127.0.0.1:11434/api/tags" {
                        [pscustomobject]@{ Body = [pscustomobject]@{ models = @([pscustomobject]@{ name = "qwen3:8b" }) } }
                    }
                    "http://127.0.0.1:11434/api/ps" {
                        [pscustomobject]@{ Body = [pscustomobject]@{ models = @([pscustomobject]@{ name = "qwen3:8b"; size = 5000000000; size_vram = 5000000000 }) } }
                    }
                    default { throw "Status attempted unexpected model/Assistant endpoint" }
                }
            }
            "Invoke-DemoOllamaCommand" = { throw "Status must not invoke model commands" }
        }
        $output = @(Invoke-V3Mocked $mocks { param($fixture) Write-V3DemoStatus -Layout $fixture } @($layout) *>&1)
        $text = $output -join " "
        Assert-True ($text -match "GPU: healthy Code 0, driver fixture-driver, used 5447 MiB, free 2741 MiB") "GPU health and VRAM"
        Assert-True ($text -match "qwen3:8b installed=True") "Exact installed model"
        Assert-True ($text -match "Model resident: 100% GPU") "GPU-backed model residency"
        Assert-True ($text -match "Port 11434: 127.0.0.1, PID 46") "Loopback port owner"
    }
    Invoke-V3Test "startup_order_and_v2_profile_defaults_preserved" {
        $source = Get-Content -LiteralPath (Join-Path $demoRoot "start-local-chatbot-demo.ps1") -Raw
        $last = -1
        foreach ($marker in @('$stage = "NVIDIA GPU verification"', '$stage = "Ollama loopback startup"',
                '$stage = "qwen3:8b explicit warm-up"', '$stage = "GPU allocation verification"',
                '$stage = "FastAPI startup"', '$stage = "frontend startup"', '$stage = "browser open"')) {
            $position = $source.IndexOf($marker)
            Assert-True ($position -gt $last) "Readiness stage order: $marker"
            $last = $position
        }
        Assert-True ($source -match '\[string\]\$LauncherProfile = "v2"') "Start defaults to V2"
        $stop = Get-Content -LiteralPath (Join-Path $demoRoot "stop-local-chatbot-demo.ps1") -Raw
        Assert-True ($stop -match '\[string\]\$LauncherProfile = "v2"') "Stop defaults to V2"
        foreach ($name in @("start", "stop")) {
            $wrapper = Get-Content -LiteralPath (Join-Path $demoRoot "$name-local-chatbot-demo-v3.ps1") -Raw
            Assert-True ($wrapper -match '-LauncherProfile v3 @PSBoundParameters') "Explicit V3 wrapper: $name"
        }
    }
    foreach ($operation in @("start", "stop")) {
        Invoke-V3Test ("actual_" + $operation + "_wrapper_preserves_private_helper_closure_scope") {
            $result = Invoke-WrapperScopeFixture -Operation $operation -Mode "success"
            Assert-Equal $result.ExitCode 0 "Actual wrapper/private callback succeeds"
            Assert-True ($result.Output -match "HELPER_READY profile=v3") "Private helper resolved through module callback"
            Assert-True ($result.Output -match "WRAPPER_SCOPE_FIXTURE_COMPLETE") "Wrapper completed"
            $forwarded = if ($operation -eq "start") { "no_browser=True service_timeout=17 grace=3" } else { "no_browser=False service_timeout=30 grace=2" }
            Assert-True ($result.Output -match [regex]::Escape($forwarded)) "Operator parameters forwarded unchanged"
        }
        Invoke-V3Test ("actual_" + $operation + "_wrapper_propagates_callback_lifecycle_failure") {
            $result = Invoke-WrapperScopeFixture -Operation $operation -Mode "failure"
            Assert-True ($result.ExitCode -ne 0) "Shared lifecycle failure propagates out of wrapper"
            Assert-True ($result.Output -match "HELPER_READY profile=v3") "Helper resolved before intended failure"
            Assert-True ($result.ErrorOutput -match "EXPECTED_FIXTURE_FAILURE_AFTER_PRIVATE_HELPER") "Exact failure remains visible"
            Assert-True ($result.Output -notmatch "WRAPPER_SCOPE_FIXTURE_COMPLETE") "No false success after shared failure"
        }
        Invoke-V3Test ("negative_call_operator_" + $operation + "_reproduces_private_helper_scope_defect") {
            $result = Invoke-WrapperScopeFixture -Operation $operation -Mode "negative_call_operator"
            Assert-True ($result.ExitCode -ne 0) "Original call operator reproduces lifecycle failure"
            $helper = if ($operation -eq "stop") { "Register-FailedStopHelper" } else { "Register-FailedDemoHelper" }
            Assert-True ($result.ErrorOutput -match [regex]::Escape($helper)) "Failure identifies missing private cleanup helper"
            Assert-True ($result.Output -notmatch "WRAPPER_SCOPE_FIXTURE_COMPLETE") "Negative control cannot falsely pass"
        }
    }
    Invoke-V3Test "reviewed_loopback_backend_configuration_unchanged" {
        $environment = Get-DemoBackendEnvironment -SnapshotDirectory (Join-Path $temporaryRoot "snapshot")
        Assert-Equal $environment.RESILIENCE_ASSISTANT_ENABLED "true" "Assistant enabled"
        Assert-Equal $environment.RESILIENCE_OLLAMA_BASE_URL "http://127.0.0.1:11434" "Loopback model endpoint"
        Assert-Equal $environment.RESILIENCE_OLLAMA_MODEL "qwen3:8b" "Exact model"
        Assert-Equal $environment.RESILIENCE_CORS_ALLOWED_ORIGINS "http://127.0.0.1:8001,http://localhost:8001" "Reviewed CORS"
    }
    Invoke-V3Test "v3_status_entry_does_not_mutate_state" {
        $source = Get-Content -LiteralPath (Join-Path $demoRoot "status-local-chatbot-demo-v3.ps1") -Raw
        Assert-True ($source -match "Write-V3DemoStatus") "Explicit V3 status"
        Assert-True ($source -notmatch "Write-DemoState|Remove-Item|Stop-Process|Start-Process|Open-DemoBrowser") "Read-only status entry"
    }

    foreach ($record in $script:caseRecords) { Write-Output ("CASE " + ($record | ConvertTo-Json -Compress)) }
    $failed = @($script:caseRecords | Where-Object { $_.result -eq "fail" }).Count
    Write-Output ("SUMMARY " + ([ordered]@{
                total_cases = $script:caseRecords.Count
                passed_cases = $script:caseRecords.Count - $failed
                failed_cases = $failed
                overall_result = if ($failed -eq 0) { "pass" } else { "fail" }
            } | ConvertTo-Json -Compress))
    if ($failed -gt 0) { exit 1 }
} finally {
    $resolved = [IO.Path]::GetFullPath($temporaryRoot)
    $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd("\")
    if ([IO.Path]::GetDirectoryName($resolved) -eq $tempParent -and
        (Split-Path -Leaf $resolved).StartsWith("sptc-v3-launcher-tests-") -and
        (Test-Path -LiteralPath $resolved -PathType Container)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
