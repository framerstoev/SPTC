param(
    [ValidateSet("v2", "v3")]
    [string]$LauncherProfile = "v2"
)

Set-StrictMode -Version Latest

$script:AcceptedFrontendCommit = "58f04a9c8d608fa9622bf8a0133d446118970543"
$script:AcceptedFrontendTag = "phase3g-local-qwen-chatbot-accepted"
$script:AcceptedBackendCommit = "5edc4688514f2c47ae3e8c03f50b853c0f5d8108"
$script:BrowserUrl = "http://127.0.0.1:8001/coldwave-demo-v2/?assistantMode=backend-agent"
$script:BackendUrl = "http://127.0.0.1:8080"
$script:OllamaUrl = "http://127.0.0.1:11434"
$script:ModelName = "qwen3:8b"
$script:RuntimeSchemaVersion = 1

# Explicit per-invocation configuration; never inferred from environment or HEAD.
if ($LauncherProfile -eq "v3") {
    $script:AcceptedFrontendCommit = "e8d5cf801fb6f7fdeae0bc4a60406f76ba217b7d"
    $script:AcceptedFrontendTag = "phase4a-v3-tier-aware-explorer-accepted"
    $script:AcceptedBackendCommit = "1e1482d72efd494887f89c1a934970be0ab08fbf"
    $script:BrowserUrl = "http://127.0.0.1:8001/coldwave-demo-v3/?assistantMode=backend-agent"
    $script:RuntimeSchemaVersion = 3
}

function Get-LocalDemoConstants {
    [CmdletBinding()]
    param()

    [pscustomobject]@{
        AcceptedFrontendCommit = $script:AcceptedFrontendCommit
        AcceptedFrontendTag = $script:AcceptedFrontendTag
        AcceptedBackendCommit = $script:AcceptedBackendCommit
        BrowserUrl = $script:BrowserUrl
        BackendUrl = $script:BackendUrl
        OllamaUrl = $script:OllamaUrl
        ModelName = $script:ModelName
        RuntimeSchemaVersion = $script:RuntimeSchemaVersion
    }
}

function ConvertTo-NormalizedDemoPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    [System.IO.Path]::GetFullPath($Path).TrimEnd("\").ToLowerInvariant()
}

function Get-LocalDemoLayout {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptRoot
    )

    $demoRoot = [System.IO.Path]::GetFullPath($ScriptRoot)
    $frontendRepository = [System.IO.Path]::GetFullPath((Join-Path $demoRoot ".."))
    $workspaceRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $frontendRepository "..\..\..")
    )
    $backendRepository = Join-Path $workspaceRoot "services\resilience-agent"
    $backendPython = Join-Path $backendRepository ".venv\Scripts\python.exe"
    $backendVenvConfig = Join-Path $backendRepository ".venv\pyvenv.cfg"
    $backendSupervisorPython = Join-Path $backendRepository `
        ".venv\__invalid_base_python_configuration__"
    if (Test-Path -LiteralPath $backendVenvConfig -PathType Leaf) {
        $configuredExecutable = @(Get-Content -LiteralPath $backendVenvConfig |
                Where-Object { $_ -match '^\s*executable\s*=\s*(.+?)\s*$' } |
                ForEach-Object { $Matches[1] }) | Select-Object -First 1
        if (-not [string]::IsNullOrWhiteSpace([string]$configuredExecutable) -and
            [System.IO.Path]::IsPathRooted([string]$configuredExecutable) -and
            [System.IO.Path]::GetFileName([string]$configuredExecutable) -eq
                "python.exe") {
            $backendSupervisorPython = [System.IO.Path]::GetFullPath(
                [string]$configuredExecutable
            )
        }
    }
    $runtimeName = if ($LauncherProfile -eq "v3") { ".runtime-v3" } else { ".runtime" }
    $runtimeRoot = Join-Path $demoRoot $runtimeName

    [pscustomobject]@{
        DemoRoot = $demoRoot
        FrontendRepository = $frontendRepository
        WorkspaceRoot = $workspaceRoot
        BackendRepository = $backendRepository
        BackendPython = $backendPython
        BackendVenvConfig = $backendVenvConfig
        BackendSupervisorPython = $backendSupervisorPython
        BackendUvicorn = Join-Path $backendRepository ".venv\Scripts\uvicorn.exe"
        SnapshotDirectory = Join-Path $backendRepository ".local\snapshot"
        RuntimeRoot = $runtimeRoot
        StatePath = Join-Path $runtimeRoot "active-session.json"
        LockPath = Join-Path $runtimeRoot "lifecycle.lock"
        LogsRoot = Join-Path $runtimeRoot "logs"
    }
}

function Assert-WindowsPowerShellCompatibility {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$PowerShellInfo
    )

    if ($PowerShellInfo.OS -ne "Windows_NT") {
        throw "The local demo launcher requires Windows PowerShell on Windows."
    }
    if ([int]$PowerShellInfo.MajorVersion -lt 5) {
        throw "Windows PowerShell 5.1 or later is required."
    }
}

function Assert-RequiredDemoPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [ValidateSet("Container", "Leaf")]
        [string]$PathType,
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [bool]$Exists
    )

    if (-not $Exists) {
        throw "$Label is missing or invalid: $Path"
    }
}

function Assert-DemoCheckpointFacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [bool]$FrontendCommitExists,
        [Parameter(Mandatory = $true)]
        [string]$FrontendTagTarget,
        [Parameter(Mandatory = $true)]
        [bool]$FrontendContainsAcceptedCommit,
        [Parameter(Mandatory = $true)]
        [string]$BackendHead,
        [Parameter(Mandatory = $true)]
        [bool]$FrontendClean,
        [Parameter(Mandatory = $true)]
        [bool]$BackendClean
    )

    if (-not $FrontendCommitExists) {
        throw "The accepted Phase 3G frontend commit is missing."
    }
    if ($FrontendTagTarget -ne $script:AcceptedFrontendCommit) {
        throw "The accepted Phase 3G tag target has changed."
    }
    if (-not $FrontendContainsAcceptedCommit) {
        throw "The current frontend branch does not contain the accepted Phase 3G checkpoint."
    }
    if ($BackendHead -ne $script:AcceptedBackendCommit) {
        throw "The backend HEAD does not match the accepted Phase 3G backend checkpoint."
    }
    if (-not $FrontendClean -or -not $BackendClean) {
        throw "A required repository has uncommitted changes."
    }
}

function Assert-DemoGpuFacts {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Controllers,
        [Parameter(Mandatory = $true)]
        [int]$NvidiaSmiExitCode,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$NvidiaRows
    )

    $controller = @($Controllers | Where-Object {
            $_.Name -eq "NVIDIA GeForce RTX 4060 Laptop GPU"
        }) | Select-Object -First 1
    if ($null -eq $controller) {
        throw (
            "NVIDIA GeForce RTX 4060 Laptop GPU was not found. Connect the laptop " +
            "to power and enable the discrete NVIDIA GPU, then retry."
        )
    }
    if ([int]$controller.ConfigManagerErrorCode -ne 0 -or $controller.Status -ne "OK") {
        throw (
            "The RTX 4060 is not healthy (ConfigManagerErrorCode=" +
            "$($controller.ConfigManagerErrorCode), Status=$($controller.Status)). " +
            "Connect the laptop to power and enable the discrete NVIDIA GPU. " +
            "The launcher will not fall back to CPU."
        )
    }
    if ($NvidiaSmiExitCode -ne 0) {
        throw (
            "nvidia-smi failed. Connect the laptop to power and enable the discrete " +
            "NVIDIA GPU. The launcher will not change drivers or fall back to CPU."
        )
    }
    $nvidiaRow = @($NvidiaRows | Where-Object {
            $_.Name -eq "NVIDIA GeForce RTX 4060 Laptop GPU"
        }) | Select-Object -First 1
    if ($null -eq $nvidiaRow) {
        throw "nvidia-smi did not report the required RTX 4060."
    }
    $nvidiaRow
}

function Resolve-DemoPortPolicy {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Listeners,
        [Parameter(Mandatory = $false)]
        [string]$ExpectedOllamaPath
    )

    $active = @($Listeners | Where-Object { [int]$_.Port -eq $Port })
    if ($active.Count -eq 0) {
        return [pscustomobject]@{ Disposition = "free"; ProcessId = $null }
    }

    $ownerIds = @($active | ForEach-Object { [int]$_.ProcessId } | Select-Object -Unique)
    $ownerText = $ownerIds -join ","
    if ($Port -ne 11434) {
        throw "Required local port $Port is occupied by PID $ownerText. No process was stopped."
    }
    if ([string]::IsNullOrWhiteSpace($ExpectedOllamaPath)) {
        throw "Port 11434 is occupied, but the Ollama executable could not be verified."
    }
    if ($ownerIds.Count -ne 1) {
        throw "Port 11434 has multiple listener owners ($ownerText); refusing to continue."
    }
    if (@($active | Where-Object { $_.Address -ne "127.0.0.1" }).Count -gt 0) {
        throw "Ollama must listen only on 127.0.0.1:11434; a non-loopback listener was found."
    }
    $owner = $active[0]
    if ([string]::IsNullOrWhiteSpace([string]$owner.ProcessPath)) {
        throw "The process on port 11434 could not be identified; refusing to continue."
    }
    if ((ConvertTo-NormalizedDemoPath $owner.ProcessPath) -ne
        (ConvertTo-NormalizedDemoPath $ExpectedOllamaPath)) {
        throw "Port 11434 is occupied by unrelated PID $ownerText. No process was stopped."
    }
    if ($owner.ProcessName -ne "ollama") {
        throw "Port 11434 is not owned by a verified Ollama process."
    }
    # Win32_Process.CommandLine can be unavailable to a non-administrator even
    # when Get-Process can verify the executable identity.  When it is visible,
    # use it as an additional check; the caller must always complete verification
    # with the loopback API contracts before using a pre-existing service.
    if (-not [string]::IsNullOrWhiteSpace([string]$owner.ProcessCommandLine) -and
        $owner.ProcessCommandLine -notmatch '(?i)(?:^|\s)serve(?:\s|$)') {
        throw "Port 11434 is not owned by a verified Ollama serve process."
    }
    [pscustomobject]@{
        Disposition = "preexisting_ollama"
        ProcessId = [int]$owner.ProcessId
    }
}

function Assert-DemoWarmupResult {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$ExitCode,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$StandardOutput,
        [Parameter(Mandatory = $true)]
        [bool]$TimedOut
    )

    if ($TimedOut) {
        throw "Qwen warm-up exceeded the bounded launcher timeout."
    }
    $trimmedOutput = $StandardOutput.Trim()
    if ($ExitCode -ne 0 -or $trimmedOutput -notmatch
        "^READY elapsed_seconds=[0-9]+\.[0-9]{3}$") {
        throw "Qwen warm-up did not return the accepted READY contract."
    }
    [double]([regex]::Match(
            $trimmedOutput,
            "^READY elapsed_seconds=([0-9]+\.[0-9]{3})$"
        ).Groups[1].Value)
}

function Get-DemoOllamaAllocation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Output,
        [Parameter(Mandatory = $false)]
        [string]$ModelName = $script:ModelName
    )

    $modelLine = @($Output -split "`r?`n" | Where-Object {
            $_ -match ("^\s*" + [regex]::Escape($ModelName) + "\s+")
        }) | Select-Object -First 1
    if ($null -eq $modelLine) {
        throw "$ModelName is not resident after warm-up."
    }
    if ($modelLine -notmatch "\b100%\s+GPU\b") {
        throw (
            "$ModelName is not allocated 100% to GPU. If Ollama started before GPU " +
            "activation, close it, connect power, enable the RTX 4060, and retry. " +
            "The launcher will not restart a pre-existing Ollama process."
        )
    }
    "100% GPU"
}

function Get-DemoOllamaAllocationFromApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Body,
        [Parameter(Mandatory = $false)]
        [string]$ModelName = $script:ModelName
    )

    $model = @($Body.models | Where-Object {
            ([string]$_.name -eq $ModelName) -or
            ([string]$_.model -eq $ModelName)
        }) | Select-Object -First 1
    if ($null -eq $model) {
        throw "$ModelName is not resident."
    }
    $size = [int64]$model.size
    $sizeVram = [int64]$model.size_vram
    if ($size -le 0 -or $sizeVram -ne $size) {
        throw "$ModelName is not allocated 100% to GPU."
    }
    [pscustomobject]@{
        Allocation = "100% GPU"
        VramMiB = [Math]::Round($sizeVram / 1MB, 0)
    }
}

function Assert-DemoBackendHealth {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Health
    )

    $valid = (
        $Health.HttpStatus -eq 200 -and
        $Health.Body.status -eq "ok" -and
        $Health.Body.snapshot_loaded -eq $true -and
        $Health.Body.curve_snapshot_loaded -eq $true -and
        $Health.Body.event_id -eq "coldwave_2026_01" -and
        $Health.Body.data_release -eq "coldwave_2026_01_r1" -and
        $Health.Body.method_version -eq "data_driven_resilience_v0" -and
        [int]$Health.Body.row_count -eq 10029 -and
        [int]$Health.Body.curve_row_count -eq 3026967 -and
        [int]$Health.Body.curve_section_count -eq 3842 -and
        $Health.Body.timezone_status -eq "unverified_local_clock_time"
    )
    if (-not $valid) {
        throw "FastAPI health did not match the accepted local release contract."
    }
}

function Assert-DemoFrontendResponse {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$HttpStatus
    )

    if ($HttpStatus -ne 200) {
        throw "The local frontend production page did not return HTTP 200."
    }
}

function New-DemoProcessRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,
        [Parameter(Mandatory = $true)]
        [string]$StartTimeUtc,
        [Parameter(Mandatory = $true)]
        [string]$ExecutablePath,
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [bool]$CreatedByLauncher,
        [Parameter(Mandatory = $false)]
        [Nullable[int]]$LauncherProcessId,
        [Parameter(Mandatory = $false)]
        [string]$StandardOutputLog,
        [Parameter(Mandatory = $false)]
        [string]$StandardErrorLog
    )

    [ordered]@{
        role = $Role
        process_id = $ProcessId
        start_time_utc = $StartTimeUtc
        executable_path = [System.IO.Path]::GetFullPath($ExecutablePath)
        port = $Port
        address = "127.0.0.1"
        created_by_launcher = $CreatedByLauncher
        launcher_process_id = if ($null -eq $LauncherProcessId) {
            $null
        } else {
            [int]$LauncherProcessId
        }
        stdout_log = $StandardOutputLog
        stderr_log = $StandardErrorLog
    }
}

function Test-DemoProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Record,
        [Parameter(Mandatory = $false)]
        [object]$ActualProcess
    )

    if ($null -eq $ActualProcess) {
        return $false
    }
    if ([int]$Record.process_id -ne [int]$ActualProcess.ProcessId) {
        return $false
    }
    if ([string]::IsNullOrWhiteSpace([string]$ActualProcess.ExecutablePath)) {
        return $false
    }
    if ((ConvertTo-NormalizedDemoPath $Record.executable_path) -ne
        (ConvertTo-NormalizedDemoPath $ActualProcess.ExecutablePath)) {
        return $false
    }
    if ([string]$Record.start_time_utc -ne [string]$ActualProcess.StartTimeUtc) {
        return $false
    }
    $true
}

function Get-DemoOwnedStopPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Processes
    )

    $priority = @{
        frontend = 0
        frontend_launcher = 0.5
        nvidia_smi = 0.6
        ollama_cli = 0.7
        warmup = 0.75
        backend = 1
        backend_launcher = 1.5
        ollama = 2
        ollama_launcher = 2.5
    }
    @($Processes | Where-Object { $_.created_by_launcher -eq $true } | Sort-Object {
            if ($priority.ContainsKey([string]$_.role)) {
                $priority[[string]$_.role]
            } else {
                3
            }
        })
}

function Get-DemoSessionDisposition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$State,
        [Parameter(Mandatory = $true)]
        [hashtable]$ActualProcesses
    )

    $matching = 0
    $recorded = 0
    $owned = 0
    $hasTransientHelper = $false
    foreach ($record in @($State.processes)) {
        $recorded += 1
        if ($record.created_by_launcher -eq $true) {
            $owned += 1
        }
        if ($record.role -in @("nvidia_smi", "ollama_cli", "warmup")) {
            $hasTransientHelper = $true
        }
        $key = [string]$record.process_id
        $actual = if ($ActualProcesses.ContainsKey($key)) {
            $ActualProcesses[$key]
        } else {
            $null
        }
        if (Test-DemoProcessIdentity -Record $record -ActualProcess $actual) {
            $matching += 1
        }
    }
    if ($matching -eq 0) {
        return "stale"
    }
    if ($State.status -eq "ready" -and -not $hasTransientHelper -and $owned -gt 0 -and
        $recorded -gt 0 -and $matching -eq $recorded) {
        return "active"
    }
    "partial"
}

function Invoke-DemoShutdownSequence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$State,
        [Parameter(Mandatory = $true)]
        [scriptblock]$StopProcessAction,
        [Parameter(Mandatory = $true)]
        [scriptblock]$UnloadModelAction
    )

    $ordered = @(Get-DemoOwnedStopPlan -Processes @($State.processes))
    $beforeUnload = @($ordered | Where-Object {
            $_.role -notin @("ollama", "ollama_launcher")
        })
    $afterUnload = @($ordered | Where-Object {
            $_.role -in @("ollama", "ollama_launcher")
        })
    $processResults = @()

    foreach ($record in $beforeUnload) {
        $processResults += [pscustomobject]@{
            Record = $record
            Result = & $StopProcessAction $record
        }
    }

    $upstreamClear = @($processResults | Where-Object {
            -not $_.Result.Stopped -and
            $_.Result.Reason -notin @(
                "already_stopped", "identity_mismatch_or_absent"
            )
        }).Count -eq 0

    $unloadResult = $null
    if ($upstreamClear -and $State.model_loaded_by_launcher -eq $true) {
        $unloadResult = & $UnloadModelAction $State
    }

    if ($upstreamClear) {
        foreach ($record in $afterUnload) {
            $processResults += [pscustomobject]@{
                Record = $record
                Result = & $StopProcessAction $record
            }
        }
    }

    [pscustomobject]@{
        ProcessResults = @($processResults)
        UnloadResult = $unloadResult
        UpstreamClear = $upstreamClear
        OllamaShutdownDeferred = -not $upstreamClear -and $afterUnload.Count -gt 0
    }
}

function Invoke-WithTemporaryProcessEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    $previous = @{}
    try {
        foreach ($name in $Environment.Keys) {
            $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
            [Environment]::SetEnvironmentVariable(
                $name,
                [string]$Environment[$name],
                "Process"
            )
        }
        & $Action
    } finally {
        foreach ($name in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
        }
    }
}

function Get-DemoBackendEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SnapshotDirectory
    )

    @{
        RESILIENCE_SNAPSHOT_DIR = [System.IO.Path]::GetFullPath($SnapshotDirectory)
        RESILIENCE_ASSISTANT_ENABLED = "true"
        RESILIENCE_MODEL_PROVIDER = "ollama"
        RESILIENCE_OLLAMA_BASE_URL = $script:OllamaUrl
        RESILIENCE_OLLAMA_MODEL = $script:ModelName
        RESILIENCE_ASSISTANT_TIMEOUT_SECONDS = "75"
        RESILIENCE_ASSISTANT_MAX_HISTORY_MESSAGES = "4"
        RESILIENCE_ASSISTANT_MAX_TOOL_CALLS = "1"
        RESILIENCE_ASSISTANT_MAX_ANSWER_WORDS = "180"
        RESILIENCE_CORS_ALLOWED_ORIGINS = (
            "http://127.0.0.1:8001,http://localhost:8001"
        )
        PYTHONUNBUFFERED = "1"
    }
}

function New-DemoState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SessionId,
        [Parameter(Mandatory = $true)]
        [string]$CreatedAtUtc,
        [Parameter(Mandatory = $true)]
        [string]$LogDirectory
    )

    [ordered]@{
        schema_version = $script:RuntimeSchemaVersion
        session_id = $SessionId
        status = "starting"
        created_at_utc = $CreatedAtUtc
        ready_at_utc = $null
        startup_seconds = $null
        browser_url = $script:BrowserUrl
        model_name = $script:ModelName
        gpu_allocation = $null
        gpu_vram_used_mib = $null
        warmup_seconds = $null
        ollama_preexisting = $false
        model_preexisting_resident = $false
        model_loaded_by_launcher = $false
        ports = [ordered]@{ ollama = 11434; backend = 8080; frontend = 8001 }
        log_directory = [System.IO.Path]::GetFullPath($LogDirectory)
        processes = @()
    }
}

Export-ModuleMember -Function @(
    "Get-LocalDemoConstants",
    "ConvertTo-NormalizedDemoPath",
    "Get-LocalDemoLayout",
    "Assert-WindowsPowerShellCompatibility",
    "Assert-RequiredDemoPath",
    "Assert-DemoCheckpointFacts",
    "Assert-DemoGpuFacts",
    "Resolve-DemoPortPolicy",
    "Assert-DemoWarmupResult",
    "Get-DemoOllamaAllocation",
    "Get-DemoOllamaAllocationFromApi",
    "Assert-DemoBackendHealth",
    "Assert-DemoFrontendResponse",
    "New-DemoProcessRecord",
    "Test-DemoProcessIdentity",
    "Get-DemoOwnedStopPlan",
    "Get-DemoSessionDisposition",
    "Invoke-DemoShutdownSequence",
    "Invoke-WithTemporaryProcessEnvironment",
    "Get-DemoBackendEnvironment",
    "New-DemoState"
)
