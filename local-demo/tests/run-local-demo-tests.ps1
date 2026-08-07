#requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$demoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Import-Module (Join-Path $demoRoot "lib\LocalDemo.Core.psm1") -Force
Import-Module (Join-Path $demoRoot "lib\LocalDemo.Windows.psm1") -Force

$script:passed = 0
$script:failed = 0
$script:caseRecords = @()
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    "sptc local demo tests " + [guid]::NewGuid().ToString("D")
)

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $false)]
        [AllowNull()]
        [object]$Actual,
        [Parameter(Mandatory = $false)]
        [AllowNull()]
        [object]$Expected,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "$Message (actual=$Actual expected=$Expected)"
    }
}

function Assert-ThrowsLike {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action,
        [Parameter(Mandatory = $true)]
        [string]$Pattern
    )
    $threw = $false
    try {
        & $Action
    } catch {
        $threw = $true
        if ($_.Exception.Message -notmatch $Pattern) {
            throw "Exception did not match '$Pattern': $($_.Exception.Message)"
        }
    }
    if (-not $threw) {
        throw "Expected an exception matching '$Pattern'."
    }
}

function Invoke-DemoTestCase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CaseId,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    try {
        & $Action
        $script:passed += 1
        $result = "pass"
    } catch {
        $script:failed += 1
        $result = "fail"
        Write-Host "FAIL $CaseId`: $($_.Exception.Message)"
    }
    $script:caseRecords += [pscustomobject]@{
        case_id = $CaseId
        result = $result
    }
}

function New-FakeProcessRecord {
    param(
        [string]$Role = "backend",
        [int]$ProcessId = 200,
        [bool]$Owned = $true,
        [string]$Path = "C:\Tools\python.exe",
        [string]$Start = "2026-08-03T12:00:00.0000000Z",
        [int]$Port = 8080
    )
    New-DemoProcessRecord -Role $Role -ProcessId $ProcessId `
        -StartTimeUtc $Start -ExecutablePath $Path -Port $Port `
        -CreatedByLauncher $Owned
}

function New-HealthyGpuControllers {
    @([pscustomobject]@{
            Name = "NVIDIA GeForce RTX 4060 Laptop GPU"
            Status = "OK"
            ConfigManagerErrorCode = 0
        })
}

function New-HealthyNvidiaRows {
    @([pscustomobject]@{
            Name = "NVIDIA GeForce RTX 4060 Laptop GPU"
            DriverVersion = "610.88"
            TotalMiB = 8188
            UsedMiB = 5447
            FreeMiB = 2520
        })
}

function New-TestStateLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    [pscustomobject]@{
        LogsRoot = Join-Path $Root "logs"
        BackendPython = Join-Path $Root "backend\.venv\Scripts\python.exe"
        BackendUvicorn = Join-Path $Root "backend\.venv\Scripts\uvicorn.exe"
        BackendSupervisorPython = Join-Path $Root "base\python.exe"
    }
}

function New-ValidReadyDemoState {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Layout
    )

    $sessionId = [guid]::NewGuid().ToString("D")
    $logDirectory = Join-Path $Layout.LogsRoot $sessionId
    $state = New-DemoState -SessionId $sessionId `
        -CreatedAtUtc "2026-08-03T12:00:00.0000000Z" `
        -LogDirectory $logDirectory
    $state.status = "ready"
    $state.ready_at_utc = "2026-08-03T12:00:10.0000000Z"
    $state.startup_seconds = 10.0
    $state.warmup_seconds = 4.5
    $state.gpu_allocation = "100% GPU"
    $state.gpu_vram_used_mib = 5447
    $state.ollama_preexisting = $true
    $state.model_preexisting_resident = $true
    $state.processes = @(
        (New-DemoProcessRecord -Role "ollama" -ProcessId 501 `
            -StartTimeUtc "2026-08-03T12:00:01.0000000Z" `
            -ExecutablePath "C:\Tools\Ollama\ollama.exe" -Port 11434 `
            -CreatedByLauncher $false),
        (New-DemoProcessRecord -Role "backend" -ProcessId 502 `
            -StartTimeUtc "2026-08-03T12:00:02.0000000Z" `
            -ExecutablePath $Layout.BackendUvicorn -Port 8080 `
            -CreatedByLauncher $true `
            -StandardOutputLog (Join-Path $logDirectory "backend.stdout.log") `
            -StandardErrorLog (Join-Path $logDirectory "backend.stderr.log")),
        (New-DemoProcessRecord -Role "frontend" -ProcessId 503 `
            -StartTimeUtc "2026-08-03T12:00:03.0000000Z" `
            -ExecutablePath $Layout.BackendPython -Port 8001 `
            -CreatedByLauncher $true `
            -StandardOutputLog (Join-Path $logDirectory "frontend.stdout.log") `
            -StandardErrorLog (Join-Path $logDirectory "frontend.stderr.log"))
    )
    $state
}

function Copy-DemoTestObject {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $Value | ConvertTo-Json -Depth 8 | ConvertFrom-Json
}

function Read-TestState {
    param(
        [Parameter(Mandatory = $true)]
        [object]$State,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Layout,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $path = Join-Path $temporaryRoot ("state-" + $Name + ".json")
    Write-DemoState -State $State -StatePath $path
    Read-DemoState -StatePath $path -Layout $Layout
}

function Invoke-FakeShutdownEvents {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Processes,
        [Parameter(Mandatory = $true)]
        [bool]$ModelLoadedByLauncher
    )

    $events = New-Object System.Collections.ArrayList
    $state = [pscustomobject]@{
        model_loaded_by_launcher = $ModelLoadedByLauncher
        processes = $Processes
    }
    $stop = {
        param($record)
        [void]$events.Add("stop:$($record.role)")
        [pscustomobject]@{ Stopped = $true; Reason = "fake" }
    }.GetNewClosure()
    $unload = {
        param($currentState)
        [void]$events.Add("unload")
        [pscustomobject]@{ Attempted = $true; Succeeded = $true }
    }.GetNewClosure()
    [void](Invoke-DemoShutdownSequence -State $state `
            -StopProcessAction $stop -UnloadModelAction $unload)
    @($events)
}

try {
    [void](New-Item -ItemType Directory -Path $temporaryRoot -Force)

    Invoke-DemoTestCase "powershell_syntax" {
        $files = @(Get-ChildItem -LiteralPath $demoRoot -Recurse -File |
                Where-Object { $_.Extension -in @(".ps1", ".psm1") })
        Assert-True ($files.Count -ge 6) "Expected all launcher PowerShell files."
        foreach ($file in $files) {
            $tokens = $null
            $errors = $null
            [void][System.Management.Automation.Language.Parser]::ParseFile(
                $file.FullName,
                [ref]$tokens,
                [ref]$errors
            )
            Assert-Equal $errors.Count 0 "PowerShell parser errors in $($file.Name)"
        }
    }

    Invoke-DemoTestCase "windows_powershell_5_1" {
        [void](Assert-WindowsPowerShellCompatibility -PowerShellInfo ([pscustomobject]@{
                    OS = "Windows_NT"; MajorVersion = 5
                }))
    }

    Invoke-DemoTestCase "unsupported_powershell" {
        Assert-ThrowsLike {
            Assert-WindowsPowerShellCompatibility -PowerShellInfo ([pscustomobject]@{
                    OS = "Windows_NT"; MajorVersion = 4
                })
        } "5\.1"
    }

    Invoke-DemoTestCase "missing_frontend_repository" {
        Assert-ThrowsLike {
            Assert-RequiredDemoPath -Path "C:\missing frontend" -PathType Container `
                -Label "Frontend repository" -Exists $false
        } "Frontend repository"
    }

    Invoke-DemoTestCase "missing_backend_repository" {
        Assert-ThrowsLike {
            Assert-RequiredDemoPath -Path "C:\missing backend" -PathType Container `
                -Label "Backend repository" -Exists $false
        } "Backend repository"
    }

    Invoke-DemoTestCase "missing_backend_virtual_environment" {
        Assert-ThrowsLike {
            Assert-RequiredDemoPath -Path "C:\missing venv\python.exe" -PathType Leaf `
                -Label "Backend virtual-environment Python" -Exists $false
        } "virtual-environment"
    }

    Invoke-DemoTestCase "accepted_checkpoint" {
        $constants = Get-LocalDemoConstants
        [void](Assert-DemoCheckpointFacts -FrontendCommitExists $true `
                -FrontendTagTarget $constants.AcceptedFrontendCommit `
                -FrontendContainsAcceptedCommit $true `
                -BackendHead $constants.AcceptedBackendCommit `
                -FrontendClean $true -BackendClean $true)
    }

    Invoke-DemoTestCase "missing_accepted_checkpoint" {
        $constants = Get-LocalDemoConstants
        Assert-ThrowsLike {
            Assert-DemoCheckpointFacts -FrontendCommitExists $false `
                -FrontendTagTarget $constants.AcceptedFrontendCommit `
                -FrontendContainsAcceptedCommit $true `
                -BackendHead $constants.AcceptedBackendCommit `
                -FrontendClean $true -BackendClean $true
        } "commit is missing"
    }

    Invoke-DemoTestCase "changed_accepted_tag" {
        $constants = Get-LocalDemoConstants
        Assert-ThrowsLike {
            Assert-DemoCheckpointFacts -FrontendCommitExists $true `
                -FrontendTagTarget "0000000000000000000000000000000000000000" `
                -FrontendContainsAcceptedCommit $true `
                -BackendHead $constants.AcceptedBackendCommit `
                -FrontendClean $true -BackendClean $true
        } "tag target"
    }

    Invoke-DemoTestCase "missing_gpu" {
        Assert-ThrowsLike {
            Assert-DemoGpuFacts -Controllers @() -NvidiaSmiExitCode 0 `
                -NvidiaRows (New-HealthyNvidiaRows)
        } "was not found"
    }

    Invoke-DemoTestCase "gpu_code_43" {
        Assert-ThrowsLike {
            Assert-DemoGpuFacts -Controllers @([pscustomobject]@{
                    Name = "NVIDIA GeForce RTX 4060 Laptop GPU"
                    Status = "Error"
                    ConfigManagerErrorCode = 43
                }) -NvidiaSmiExitCode 0 -NvidiaRows (New-HealthyNvidiaRows)
        } "ConfigManagerErrorCode=43"
    }

    Invoke-DemoTestCase "nvidia_smi_failure" {
        Assert-ThrowsLike {
            Assert-DemoGpuFacts -Controllers (New-HealthyGpuControllers) `
                -NvidiaSmiExitCode 1 -NvidiaRows @()
        } "nvidia-smi failed"
    }

    Invoke-DemoTestCase "healthy_gpu" {
        $gpu = Assert-DemoGpuFacts -Controllers (New-HealthyGpuControllers) `
            -NvidiaSmiExitCode 0 -NvidiaRows (New-HealthyNvidiaRows)
        Assert-Equal $gpu.UsedMiB 5447 "GPU VRAM measurement"
    }

    Invoke-DemoTestCase "missing_ollama" {
        Assert-ThrowsLike {
            Assert-RequiredDemoPath -Path "C:\missing\ollama.exe" -PathType Leaf `
                -Label "Ollama executable" -Exists $false
        } "Ollama"
    }

    Invoke-DemoTestCase "missing_qwen_model" {
        Assert-ThrowsLike {
            Assert-RequiredDemoPath -Path "C:\missing\qwen3\8b" -PathType Leaf `
                -Label "Installed qwen3:8b manifest" -Exists $false
        } "qwen3:8b"
    }

    Invoke-DemoTestCase "occupied_frontend_port" {
        Assert-ThrowsLike {
            Resolve-DemoPortPolicy -Port 8001 -Listeners @([pscustomobject]@{
                    Port = 8001; Address = "127.0.0.1"; ProcessId = 44
                })
        } "PID 44"
    }

    Invoke-DemoTestCase "occupied_backend_port" {
        Assert-ThrowsLike {
            Resolve-DemoPortPolicy -Port 8080 -Listeners @([pscustomobject]@{
                    Port = 8080; Address = "127.0.0.1"; ProcessId = 45
                })
        } "PID 45"
    }

    Invoke-DemoTestCase "preexisting_loopback_ollama" {
        $policy = Resolve-DemoPortPolicy -Port 11434 -ExpectedOllamaPath `
            "C:\Tools\Ollama\ollama.exe" -Listeners @([pscustomobject]@{
                    Port = 11434
                    Address = "127.0.0.1"
                    ProcessId = 46
                    ProcessName = "ollama"
                    ProcessPath = "C:\Tools\Ollama\ollama.exe"
                    ProcessCommandLine = '"C:\Tools\Ollama\ollama.exe" serve'
                })
        Assert-Equal $policy.Disposition "preexisting_ollama" "Ollama disposition"
        Assert-Equal $policy.ProcessId 46 "Ollama owner PID"
    }

    Invoke-DemoTestCase "preexisting_ollama_without_admin_command_line" {
        $policy = Resolve-DemoPortPolicy -Port 11434 -ExpectedOllamaPath `
            "C:\Tools\Ollama\ollama.exe" -Listeners @([pscustomobject]@{
                    Port = 11434
                    Address = "127.0.0.1"
                    ProcessId = 146
                    ProcessName = "ollama"
                    ProcessPath = "C:\Tools\Ollama\ollama.exe"
                    ProcessCommandLine = $null
                })
        Assert-Equal $policy.Disposition "preexisting_ollama" `
            "Non-admin Ollama verification"
    }

    Invoke-DemoTestCase "visible_nonserve_ollama_rejected" {
        Assert-ThrowsLike {
            Resolve-DemoPortPolicy -Port 11434 -ExpectedOllamaPath `
                "C:\Tools\Ollama\ollama.exe" -Listeners @([pscustomobject]@{
                        Port = 11434
                        Address = "127.0.0.1"
                        ProcessId = 147
                        ProcessName = "ollama"
                        ProcessPath = "C:\Tools\Ollama\ollama.exe"
                        ProcessCommandLine = 'ollama.exe run qwen3:8b'
                    })
        } "serve process"
    }

    Invoke-DemoTestCase "unrelated_process_on_11434" {
        Assert-ThrowsLike {
            Resolve-DemoPortPolicy -Port 11434 -ExpectedOllamaPath `
                "C:\Tools\Ollama\ollama.exe" -Listeners @([pscustomobject]@{
                        Port = 11434
                        Address = "127.0.0.1"
                        ProcessId = 47
                        ProcessName = "python"
                        ProcessPath = "C:\Tools\python.exe"
                        ProcessCommandLine = 'python.exe server.py'
                    })
        } "unrelated PID 47"
    }

    Invoke-DemoTestCase "non_loopback_ollama" {
        Assert-ThrowsLike {
            Resolve-DemoPortPolicy -Port 11434 -ExpectedOllamaPath `
                "C:\Tools\Ollama\ollama.exe" -Listeners @([pscustomobject]@{
                        Port = 11434
                        Address = "0.0.0.0"
                        ProcessId = 48
                        ProcessName = "ollama"
                        ProcessPath = "C:\Tools\Ollama\ollama.exe"
                        ProcessCommandLine = '"C:\Tools\Ollama\ollama.exe" serve'
                    })
        } "only on 127\.0\.0\.1"
    }

    Invoke-DemoTestCase "netstat_listener_parser" {
        $rows = @(ConvertFrom-DemoNetstatRows -Port 11434 -Lines @(
                "  TCP    127.0.0.1:11434      0.0.0.0:0      LISTENING       246",
                "  TCP    0.0.0.0:8080         0.0.0.0:0      LISTENING       247",
                "  TCP    [::1]:11434          [::]:0         LISTENING       248"
            ))
        Assert-Equal $rows.Count 2 "Netstat port filtering"
        Assert-Equal $rows[0].Address "127.0.0.1" "IPv4 listener parsing"
        Assert-Equal $rows[0].ProcessId 246 "Listener PID parsing"
        Assert-Equal $rows[1].Address "::1" "IPv6 listener parsing"
    }

    Invoke-DemoTestCase "listener_query_fails_closed" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "lib\LocalDemo.Windows.psm1"
        ) -Raw
        $start = $source.IndexOf("function Get-DemoPortListeners")
        $end = $source.IndexOf("function Get-DemoOllamaProcessFacts", $start)
        $body = $source.Substring($start, $end - $start)
        Assert-True ($body -match "(?s)Get-NetTCPConnection.+-ErrorAction Stop") `
            "Primary listener query does not fail closed."
        Assert-True ($body -match "netstat\.exe") "Netstat fallback is missing."
        Assert-True ($body -match '\$LASTEXITCODE -ne 0') `
            "Netstat failure is not checked."
        Assert-True ($body -match "TCP listener inspection failed") `
            "Listener-query failure contract is missing."
    }

    Invoke-DemoTestCase "owned_listener_same_pid" {
        $launch = New-FakeProcessRecord -Role "backend_launcher" `
            -ProcessId 601 -Path "C:\Tools\uvicorn.exe" -Port 8080
        $fact = [pscustomobject]@{
            ProcessId = 601
            ExecutablePath = $launch.executable_path
            StartTimeUtc = $launch.start_time_utc
        }
        $listeners = {
            param($port)
            @([pscustomobject]@{
                    Address = "127.0.0.1"; ProcessId = 601
                })
        }
        $facts = { param($targetId) $fact }.GetNewClosure()
        $result = Wait-DemoOwnedListener -Port 8080 -LaunchRecord $launch `
            -TimeoutSeconds 1 -ListenerProvider $listeners `
            -ProcessFactProvider $facts
        Assert-Equal $result.ProcessId 601 "Same-PID listener ownership"
    }

    Invoke-DemoTestCase "owned_listener_verified_child" {
        $launch = New-FakeProcessRecord -Role "backend_launcher" `
            -ProcessId 602 -Path "C:\Tools\uvicorn.exe" -Port 8080
        $launchFact = [pscustomobject]@{
            ProcessId = 602
            ExecutablePath = $launch.executable_path
            StartTimeUtc = $launch.start_time_utc
        }
        $childFact = [pscustomobject]@{
            ProcessId = 603
            ExecutablePath = "C:\Python\python.exe"
            StartTimeUtc = "2026-08-03T12:00:01.0000000Z"
        }
        $listeners = {
            param($port)
            @([pscustomobject]@{
                    Address = "127.0.0.1"; ProcessId = 603
                })
        }
        $facts = {
            param($targetId)
            if ($targetId -eq 602) { $launchFact } else { $childFact }
        }.GetNewClosure()
        $parents = {
            param($targetId)
            if ($targetId -eq 603) { 602 } else { 0 }
        }
        $result = Wait-DemoOwnedListener -Port 8080 -LaunchRecord $launch `
            -TimeoutSeconds 1 -ListenerProvider $listeners `
            -ProcessFactProvider $facts -ParentProcessIdProvider $parents
        Assert-Equal $result.ProcessId 603 "Verified-child listener ownership"
    }

    Invoke-DemoTestCase "unrelated_listener_winner_rejected" {
        $launch = New-FakeProcessRecord -Role "backend_launcher" `
            -ProcessId 604 -Path "C:\Tools\uvicorn.exe" -Port 8080
        $launchFact = [pscustomobject]@{
            ProcessId = 604
            ExecutablePath = $launch.executable_path
            StartTimeUtc = $launch.start_time_utc
        }
        $otherFact = [pscustomobject]@{
            ProcessId = 605
            ExecutablePath = "C:\Other\python.exe"
            StartTimeUtc = "2026-08-03T12:00:01.0000000Z"
        }
        $facts = {
            param($targetId)
            if ($targetId -eq 604) { $launchFact } else { $otherFact }
        }.GetNewClosure()
        $parents = { param($targetId) 999 }
        Assert-ThrowsLike {
            Wait-DemoOwnedListener -Port 8080 -LaunchRecord $launch `
                -TimeoutSeconds 1 -ListenerProvider {
                    param($port)
                    @([pscustomobject]@{
                            Address = "127.0.0.1"; ProcessId = 605
                        })
                } -ProcessFactProvider $facts `
                -ParentProcessIdProvider $parents
        } "unrelated process won"
    }

    Invoke-DemoTestCase "listener_identity_race_rejected" {
        $launch = New-FakeProcessRecord -Role "backend_launcher" `
            -ProcessId 606 -Path "C:\Tools\uvicorn.exe" -Port 8080
        $fact = [pscustomobject]@{
            ProcessId = 606
            ExecutablePath = $launch.executable_path
            StartTimeUtc = $launch.start_time_utc
        }
        $script:listenerCallCount = 0
        $listeners = {
            param($port)
            $script:listenerCallCount += 1
            $owner = if ($script:listenerCallCount -eq 1) { 606 } else { 607 }
            @([pscustomobject]@{
                    Address = "127.0.0.1"; ProcessId = $owner
                })
        }
        $facts = { param($targetId) $fact }.GetNewClosure()
        Assert-ThrowsLike {
            Wait-DemoOwnedListener -Port 8080 -LaunchRecord $launch `
                -TimeoutSeconds 1 -ListenerProvider $listeners `
                -ProcessFactProvider $facts
        } "changed before it was recorded"
    }

    Invoke-DemoTestCase "warmup_failure" {
        Assert-ThrowsLike {
            Assert-DemoWarmupResult -ExitCode 1 `
                -StandardOutput "NOT_READY local_model_unavailable" -TimedOut $false
        } "READY contract"
    }

    Invoke-DemoTestCase "warmup_timeout" {
        Assert-ThrowsLike {
            Assert-DemoWarmupResult -ExitCode -1 -StandardOutput "" -TimedOut $true
        } "bounded launcher timeout"
    }

    Invoke-DemoTestCase "warmup_ready" {
        $seconds = Assert-DemoWarmupResult -ExitCode 0 `
            -StandardOutput "READY elapsed_seconds=9.695" -TimedOut $false
        Assert-Equal $seconds 9.695 "Warm-up duration"
    }

    Invoke-DemoTestCase "warmup_failure_rollback_sequence" {
        $events = Invoke-FakeShutdownEvents -ModelLoadedByLauncher $true `
            -Processes @(
                (New-FakeProcessRecord -Role "ollama" -ProcessId 301 -Port 11434)
            )
        Assert-Equal ($events -join ",") "unload,stop:ollama" `
            "Warm-up failure rollback"
    }

    Invoke-DemoTestCase "cpu_only_model" {
        Assert-ThrowsLike {
            Get-DemoOllamaAllocation -Output (
                "NAME ID SIZE PROCESSOR CONTEXT UNTIL`nqwen3:8b abc 5 GB 100% CPU 4096 30m"
            )
        } "not allocated 100%"
    }

    Invoke-DemoTestCase "gpu_model_allocation" {
        $allocation = Get-DemoOllamaAllocation -Output (
            "NAME ID SIZE PROCESSOR CONTEXT UNTIL`nqwen3:8b abc 5 GB 100% GPU 4096 30m"
        )
        Assert-Equal $allocation "100% GPU" "GPU allocation"
    }

    Invoke-DemoTestCase "gpu_model_allocation_api" {
        $allocation = Get-DemoOllamaAllocationFromApi -Body ([pscustomobject]@{
                models = @([pscustomobject]@{
                        name = "qwen3:8b"
                        model = "qwen3:8b"
                        size = 5368709120
                        size_vram = 5368709120
                    })
            })
        Assert-Equal $allocation.Allocation "100% GPU" "API GPU allocation"
        Assert-Equal $allocation.VramMiB 5120 "API VRAM allocation"
    }

    Invoke-DemoTestCase "backend_health_failure" {
        Assert-ThrowsLike {
            Assert-DemoBackendHealth -Health ([pscustomobject]@{
                    HttpStatus = 503
                    Body = [pscustomobject]@{
                        status = "degraded"
                        snapshot_loaded = $false
                        curve_snapshot_loaded = $false
                        event_id = "coldwave_2026_01"
                        data_release = "coldwave_2026_01_r1"
                        method_version = "data_driven_resilience_v0"
                        row_count = 0
                        curve_row_count = 0
                        curve_section_count = 0
                        timezone_status = "unverified_local_clock_time"
                    }
                })
        } "health"
    }

    Invoke-DemoTestCase "backend_health_success" {
        [void](Assert-DemoBackendHealth -Health ([pscustomobject]@{
                    HttpStatus = 200
                    Body = [pscustomobject]@{
                        status = "ok"
                        snapshot_loaded = $true
                        curve_snapshot_loaded = $true
                        event_id = "coldwave_2026_01"
                        data_release = "coldwave_2026_01_r1"
                        method_version = "data_driven_resilience_v0"
                        row_count = 10029
                        curve_row_count = 3026967
                        curve_section_count = 3842
                        timezone_status = "unverified_local_clock_time"
                    }
                }))
    }

    Invoke-DemoTestCase "backend_health_failure_rollback_sequence" {
        $events = Invoke-FakeShutdownEvents -ModelLoadedByLauncher $true `
            -Processes @(
                (New-FakeProcessRecord -Role "ollama" -ProcessId 302 -Port 11434),
                (New-FakeProcessRecord -Role "backend" -ProcessId 303 -Port 8080)
            )
        Assert-Equal ($events -join ",") "stop:backend,unload,stop:ollama" `
            "Backend-health rollback"
    }

    Invoke-DemoTestCase "frontend_startup_failure" {
        Assert-ThrowsLike { Assert-DemoFrontendResponse -HttpStatus 503 } "HTTP 200"
    }

    Invoke-DemoTestCase "frontend_failure_rollback_sequence" {
        $events = Invoke-FakeShutdownEvents -ModelLoadedByLauncher $true `
            -Processes @(
                (New-FakeProcessRecord -Role "ollama" -ProcessId 304 -Port 11434),
                (New-FakeProcessRecord -Role "backend" -ProcessId 305 -Port 8080),
                (New-FakeProcessRecord -Role "frontend" -ProcessId 306 -Port 8001)
            )
        Assert-Equal ($events -join ",") `
            "stop:frontend,stop:backend,unload,stop:ollama" `
            "Frontend failure rollback"
    }

    Invoke-DemoTestCase "model_tags_exact" {
        $installed = Test-DemoModelInstalledFromApi -TagsBody ([pscustomobject]@{
                models = @([pscustomobject]@{ name = "qwen3:8b" })
            })
        Assert-True $installed "Exact model tag was not recognized."
        $wrong = Test-DemoModelInstalledFromApi -TagsBody ([pscustomobject]@{
                models = @([pscustomobject]@{ name = "qwen3:latest" })
            })
        Assert-True (-not $wrong) "A different tag was accepted."
    }

    Invoke-DemoTestCase "rollback_after_partial_startup" {
        $records = @(
            (New-FakeProcessRecord -Role "ollama" -ProcessId 101 -Port 11434),
            (New-FakeProcessRecord -Role "backend" -ProcessId 102 -Port 8080),
            (New-FakeProcessRecord -Role "frontend" -ProcessId 103 -Port 8001)
        )
        $roles = @(Get-DemoOwnedStopPlan -Processes $records | ForEach-Object { $_.role })
        Assert-Equal ($roles -join ",") "frontend,backend,ollama" "Rollback order"
    }

    Invoke-DemoTestCase "behavioral_shutdown_sequence" {
        $events = New-Object System.Collections.ArrayList
        $records = @(
            (New-FakeProcessRecord -Role "ollama" -ProcessId 201 -Port 11434),
            (New-FakeProcessRecord -Role "backend" -ProcessId 202 -Port 8080),
            (New-FakeProcessRecord -Role "frontend" -ProcessId 203 -Port 8001)
        )
        $state = [pscustomobject]@{
            model_loaded_by_launcher = $true
            processes = $records
        }
        $stop = {
            param($record)
            [void]$events.Add("stop:$($record.role)")
            [pscustomobject]@{ Stopped = $true; Reason = "fake" }
        }.GetNewClosure()
        $unload = {
            param($currentState)
            [void]$events.Add("unload")
            [pscustomobject]@{ Attempted = $true; Succeeded = $true }
        }.GetNewClosure()
        $result = Invoke-DemoShutdownSequence -State $state `
            -StopProcessAction $stop -UnloadModelAction $unload
        Assert-Equal ($events -join ",") `
            "stop:frontend,stop:backend,unload,stop:ollama" `
            "Behavioral shutdown order"
        Assert-Equal $result.ProcessResults.Count 3 "Shutdown result count"
    }

    Invoke-DemoTestCase "cleared_helper_is_durably_pruned_before_unload" {
        $events = New-Object System.Collections.ArrayList
        $oldHelper = New-FakeProcessRecord -Role "ollama_cli" -ProcessId 601 `
            -Path "C:\Tools\Ollama\ollama.exe" -Port 0
        $ollama = New-FakeProcessRecord -Role "ollama" -ProcessId 602 `
            -Path "C:\Tools\Ollama\ollama.exe" -Port 11434
        $state = [pscustomobject]@{
            model_loaded_by_launcher = $true
            processes = @($oldHelper, $ollama)
        }
        $statePath = Join-Path $temporaryRoot "helper-prune-order.json"
        Write-DemoState -State $state -StatePath $statePath
        $stop = {
            param($record)
            [void]$events.Add("stop:$($record.role)")
            $result = [pscustomobject]@{ Stopped = $true; Reason = "fake" }
            Remove-DemoClearedTransientProcessRecord -State $state -Record $record `
                -StopResult $result -StatePath $statePath
            if ($record.role -eq "ollama_cli") {
                [void]$events.Add("persist-prune:old")
            }
            $result
        }.GetNewClosure()
        $unload = {
            param($currentState)
            Assert-Equal @($currentState.processes | Where-Object {
                    $_.role -eq "ollama_cli"
                }).Count 0 "Old helper remained when unload started"
            [void]$events.Add("unload:start")
            $newHelper = New-FakeProcessRecord -Role "ollama_cli" -ProcessId 603 `
                -Path "C:\Tools\Ollama\ollama.exe" `
                -Start "2026-08-03T12:00:05.0000000Z" -Port 0
            $currentState.processes = @($currentState.processes) + @($newHelper)
            Write-DemoState -State $currentState -StatePath $statePath
            [void]$events.Add("persist-register:new")
            [pscustomobject]@{ Attempted = $true; Succeeded = $false }
        }.GetNewClosure()
        [void](Invoke-DemoShutdownSequence -State $state `
                -StopProcessAction $stop -UnloadModelAction $unload)
        Assert-Equal ($events -join ",") `
            "stop:ollama_cli,persist-prune:old,unload:start,persist-register:new,stop:ollama" `
            "Stopped-helper prune and replacement order"
        $helperRecords = @($state.processes | Where-Object { $_.role -eq "ollama_cli" })
        Assert-Equal $helperRecords.Count 1 "Replacement helper record count"
        Assert-Equal $helperRecords[0].process_id 603 "Replacement helper PID"
    }

    Invoke-DemoTestCase "helper_prune_write_failure_aborts_before_unload" {
        $oldHelper = New-FakeProcessRecord -Role "ollama_cli" -ProcessId 604 `
            -Path "C:\Tools\Ollama\ollama.exe" -Port 0
        $ollama = New-FakeProcessRecord -Role "ollama" -ProcessId 605 `
            -Path "C:\Tools\Ollama\ollama.exe" -Port 11434
        $state = [pscustomobject]@{
            model_loaded_by_launcher = $true
            processes = @($oldHelper, $ollama)
        }
        $invalidStatePath = Join-Path $temporaryRoot "state-path-is-directory"
        [void](New-Item -ItemType Directory -Path $invalidStatePath -Force)
        $unloadEvents = New-Object System.Collections.ArrayList
        $stop = {
            param($record)
            $result = [pscustomobject]@{ Stopped = $true; Reason = "fake" }
            Remove-DemoClearedTransientProcessRecord -State $state -Record $record `
                -StopResult $result -StatePath $invalidStatePath
            $result
        }.GetNewClosure()
        $unload = {
            param($currentState)
            [void]$unloadEvents.Add("unload")
            [pscustomobject]@{ Attempted = $true; Succeeded = $true }
        }.GetNewClosure()
        Assert-ThrowsLike {
            Invoke-DemoShutdownSequence -State $state `
                -StopProcessAction $stop -UnloadModelAction $unload
        } "."
        Assert-Equal $unloadEvents.Count 0 `
            "Unload ran after helper-prune persistence failed"
        Assert-Equal @($state.processes | Where-Object {
                $_.role -eq "ollama_cli" -and $_.process_id -eq 604
            }).Count 1 "Prior helper authorization was not restored"
    }

    Invoke-DemoTestCase "failed_upstream_defers_ollama" {
        $events = New-Object System.Collections.ArrayList
        $state = [pscustomobject]@{
            model_loaded_by_launcher = $true
            processes = @(
                (New-FakeProcessRecord -Role "ollama" -ProcessId 611 -Port 11434),
                (New-FakeProcessRecord -Role "backend" -ProcessId 612 -Port 8080)
            )
        }
        $stop = {
            param($record)
            [void]$events.Add("stop:$($record.role)")
            if ($record.role -eq "backend") {
                return [pscustomobject]@{ Stopped = $false; Reason = "force_failed" }
            }
            [pscustomobject]@{ Stopped = $true; Reason = "fake" }
        }.GetNewClosure()
        $unload = {
            param($currentState)
            [void]$events.Add("unload")
            [pscustomobject]@{ Attempted = $true; Succeeded = $true }
        }.GetNewClosure()
        $result = Invoke-DemoShutdownSequence -State $state `
            -StopProcessAction $stop -UnloadModelAction $unload
        Assert-Equal ($events -join ",") "stop:backend" `
            "Dependency shutdown was not deferred"
        Assert-True $result.OllamaShutdownDeferred "Ollama deferral flag"
    }

    Invoke-DemoTestCase "preexisting_ollama_not_stopped" {
        $records = @(
            (New-FakeProcessRecord -Role "ollama" -ProcessId 104 -Owned $false -Port 11434),
            (New-FakeProcessRecord -Role "backend" -ProcessId 105 -Port 8080)
        )
        $roles = @(Get-DemoOwnedStopPlan -Processes $records | ForEach-Object { $_.role })
        Assert-Equal ($roles -join ",") "backend" "Pre-existing Ollama stop plan"
    }

    Invoke-DemoTestCase "behavioral_preexisting_ollama_preserved" {
        $events = New-Object System.Collections.ArrayList
        $records = @(
            (New-FakeProcessRecord -Role "ollama" -ProcessId 204 -Owned $false `
                -Port 11434),
            (New-FakeProcessRecord -Role "backend" -ProcessId 205 -Port 8080)
        )
        $state = [pscustomobject]@{
            model_loaded_by_launcher = $false
            processes = $records
        }
        $stop = {
            param($record)
            [void]$events.Add("stop:$($record.role)")
            [pscustomobject]@{ Stopped = $true; Reason = "fake" }
        }.GetNewClosure()
        $unload = {
            param($currentState)
            [void]$events.Add("unload")
            [pscustomobject]@{ Attempted = $true; Succeeded = $true }
        }.GetNewClosure()
        [void](Invoke-DemoShutdownSequence -State $state `
                -StopProcessAction $stop -UnloadModelAction $unload)
        Assert-Equal ($events -join ",") "stop:backend" `
            "Pre-existing Ollama received a lifecycle mutation"
    }

    Invoke-DemoTestCase "preexisting_service_only_unloads_launcher_model" {
        $events = Invoke-FakeShutdownEvents -ModelLoadedByLauncher $true `
            -Processes @(
                (New-FakeProcessRecord -Role "ollama" -ProcessId 206 -Owned $false `
                    -Port 11434),
                (New-FakeProcessRecord -Role "backend" -ProcessId 207 -Port 8080)
            )
        Assert-Equal ($events -join ",") "stop:backend,unload" `
            "Pre-existing Ollama process was included in stop sequence"
    }

    Invoke-DemoTestCase "repeated_start_active" {
        $records = @(
            (New-FakeProcessRecord -Role "ollama" -ProcessId 104 -Owned $false `
                -Path "C:\Tools\Ollama\ollama.exe" -Port 11434),
            (New-FakeProcessRecord -Role "backend" -ProcessId 105 -Port 8080),
            (New-FakeProcessRecord -Role "frontend" -ProcessId 106 -Port 8001)
        )
        $state = [pscustomobject]@{ status = "ready"; processes = $records }
        $actualMap = @{}
        foreach ($record in $records) {
            $actualMap[[string]$record.process_id] = [pscustomobject]@{
                ProcessId = $record.process_id
                ExecutablePath = $record.executable_path
                StartTimeUtc = $record.start_time_utc
            }
        }
        $disposition = Get-DemoSessionDisposition -State $state `
            -ActualProcesses $actualMap
        Assert-Equal $disposition "active" "Repeated start disposition"
    }

    Invoke-DemoTestCase "ready_session_with_stuck_helper_is_partial" {
        $state = [pscustomobject]@{
            status = "ready"
            processes = @(
                (New-FakeProcessRecord -Role "backend" -ProcessId 701 -Port 8080),
                (New-FakeProcessRecord -Role "nvidia_smi" -ProcessId 702 `
                    -Path "C:\Windows\System32\nvidia-smi.exe" -Port 0)
            )
        }
        $actuals = @{
            "701" = [pscustomobject]@{
                ProcessId = 701
                ExecutablePath = "C:\Tools\python.exe"
                StartTimeUtc = "2026-08-03T12:00:00.0000000Z"
            }
            "702" = [pscustomobject]@{
                ProcessId = 702
                ExecutablePath = "C:\Windows\System32\nvidia-smi.exe"
                StartTimeUtc = "2026-08-03T12:00:00.0000000Z"
            }
        }
        Assert-Equal (Get-DemoSessionDisposition -State $state `
                -ActualProcesses $actuals) "partial" `
            "A stuck helper must require explicit shutdown."
    }

    Invoke-DemoTestCase "ready_session_missing_one_service_is_partial" {
        $records = @(
            (New-FakeProcessRecord -Role "ollama" -ProcessId 110 -Owned $false `
                -Path "C:\Tools\Ollama\ollama.exe" -Port 11434),
            (New-FakeProcessRecord -Role "backend" -ProcessId 111 -Port 8080),
            (New-FakeProcessRecord -Role "frontend" -ProcessId 112 -Port 8001)
        )
        $actualMap = @{}
        foreach ($record in @($records | Where-Object { $_.role -ne "ollama" })) {
            $actualMap[[string]$record.process_id] = [pscustomobject]@{
                ProcessId = $record.process_id
                ExecutablePath = $record.executable_path
                StartTimeUtc = $record.start_time_utc
            }
        }
        $state = [pscustomobject]@{ status = "ready"; processes = $records }
        $disposition = Get-DemoSessionDisposition -State $state `
            -ActualProcesses $actualMap
        Assert-Equal $disposition "partial" `
            "Missing pre-existing Ollama was ignored"
    }

    Invoke-DemoTestCase "partial_session_blocks_start" {
        $record = New-FakeProcessRecord -ProcessId 107
        $state = [pscustomobject]@{ status = "starting"; processes = @($record) }
        $actual = [pscustomobject]@{
            ProcessId = 107
            ExecutablePath = $record.executable_path
            StartTimeUtc = $record.start_time_utc
        }
        $disposition = Get-DemoSessionDisposition -State $state `
            -ActualProcesses @{ "107" = $actual }
        Assert-Equal $disposition "partial" "Partial session disposition"
    }

    Invoke-DemoTestCase "stale_pid_file" {
        $record = New-FakeProcessRecord -ProcessId 108
        $state = [pscustomobject]@{ status = "ready"; processes = @($record) }
        $disposition = Get-DemoSessionDisposition -State $state -ActualProcesses @{}
        Assert-Equal $disposition "stale" "Stale state disposition"
    }

    Invoke-DemoTestCase "pid_reuse_protection" {
        $record = New-FakeProcessRecord -ProcessId 109
        $reused = [pscustomobject]@{
            ProcessId = 109
            ExecutablePath = "C:\Tools\unrelated.exe"
            StartTimeUtc = "2026-08-03T13:00:00.0000000Z"
        }
        Assert-True (-not (Test-DemoProcessIdentity -Record $record `
                    -ActualProcess $reused)) "Reused PID was accepted."
    }

    Invoke-DemoTestCase "model_unload_requires_identity_revalidation" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "lib\LocalDemo.Windows.psm1"
        ) -Raw
        $start = $source.IndexOf("function Invoke-DemoVerifiedModelUnload")
        $end = $source.IndexOf("function Test-DemoModelInstalledFromApi", $start)
        $body = $source.Substring($start, $end - $start)
        Assert-True ($body -match "Assert-DemoOllamaServiceIdentity") `
            "Model unload lacks immediate process/listener identity validation."
        Assert-True ($body.IndexOf("Assert-DemoOllamaServiceIdentity") -lt
            $body.IndexOf('Arguments @("stop"')) `
            "Model unload occurs before identity validation."
    }

    Invoke-DemoTestCase "repeated_stop" {
        $missingState = Join-Path $temporaryRoot "missing-session.json"
        $layout = [pscustomobject]@{
            LogsRoot = Join-Path $temporaryRoot "missing-logs"
            BackendPython = Join-Path $temporaryRoot "python.exe"
            BackendUvicorn = Join-Path $temporaryRoot "uvicorn.exe"
        }
        Assert-True ($null -eq (Read-DemoState -StatePath $missingState `
                    -Layout $layout)) `
            "Missing state must be an idempotent no-op."
    }

    Invoke-DemoTestCase "paths_containing_spaces" {
        $fakeScriptRoot = Join-Path $temporaryRoot `
            "repo with spaces\data\front-end\sptc-demo\local-demo"
        $backendVenv = Join-Path $temporaryRoot `
            "repo with spaces\services\resilience-agent\.venv"
        $basePython = Join-Path $temporaryRoot "base Python\python.exe"
        [void](New-Item -ItemType Directory -Path $backendVenv -Force)
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $basePython) `
            -Force)
        [System.IO.File]::WriteAllText(
            (Join-Path $backendVenv "pyvenv.cfg"),
            "executable = $basePython",
            ([System.Text.UTF8Encoding]::new($false))
        )
        $layout = Get-LocalDemoLayout -ScriptRoot $fakeScriptRoot
        $expectedRoot = Join-Path $temporaryRoot "repo with spaces"
        Assert-Equal (ConvertTo-NormalizedDemoPath $layout.WorkspaceRoot) `
            (ConvertTo-NormalizedDemoPath $expectedRoot) "Workspace path derivation"
        Assert-Equal (ConvertTo-NormalizedDemoPath $layout.BackendSupervisorPython) `
            (ConvertTo-NormalizedDemoPath $basePython) "Supervisor Python derivation"
    }

    Invoke-DemoTestCase "invalid_venv_config_fails_closed" {
        $fakeScriptRoot = Join-Path $temporaryRoot `
            "invalid-venv\data\front-end\sptc-demo\local-demo"
        $backendVenv = Join-Path $temporaryRoot `
            "invalid-venv\services\resilience-agent\.venv"
        [void](New-Item -ItemType Directory -Path $backendVenv -Force)
        [System.IO.File]::WriteAllText(
            (Join-Path $backendVenv "pyvenv.cfg"),
            "executable = relative-python.exe",
            ([System.Text.UTF8Encoding]::new($false))
        )
        $layout = Get-LocalDemoLayout -ScriptRoot $fakeScriptRoot
        Assert-True (-not (Test-Path -LiteralPath $layout.BackendSupervisorPython `
                -PathType Leaf)) `
            "An invalid venv base-Python configuration did not fail closed."
    }

    Invoke-DemoTestCase "runtime_reparse_point_rejected" {
        $demoPath = Join-Path $temporaryRoot "runtime-safety-demo"
        $targetPath = Join-Path $temporaryRoot "runtime-safety-target"
        $runtimePath = Join-Path $demoPath ".runtime"
        [void](New-Item -ItemType Directory -Path $demoPath -Force)
        [void](New-Item -ItemType Directory -Path $targetPath -Force)
        $layout = [pscustomobject]@{
            DemoRoot = $demoPath
            RuntimeRoot = $runtimePath
            LogsRoot = Join-Path $runtimePath "logs"
            StatePath = Join-Path $runtimePath "active-session.json"
            LockPath = Join-Path $runtimePath "lifecycle.lock"
        }
        [void](Assert-DemoRuntimePathSafety -Layout $layout)
        try {
            [void](New-Item -ItemType Junction -Path $runtimePath -Target $targetPath)
            Assert-ThrowsLike {
                Assert-DemoRuntimePathSafety -Layout $layout
            } "reparse"
        } finally {
            if (Test-Path -LiteralPath $runtimePath) {
                Remove-Item -LiteralPath $runtimePath -Force
            }
        }
    }

    Invoke-DemoTestCase "captured_process_path_with_spaces" {
        $spaceRoot = Join-Path $temporaryRoot "command path with spaces"
        [void](New-Item -ItemType Directory -Path $spaceRoot -Force)
        $scriptPath = Join-Path $spaceRoot "echo argument.ps1"
        [System.IO.File]::WriteAllText(
            $scriptPath,
            'param([string]$Value) [Console]::Write($Value)',
            ([System.Text.UTF8Encoding]::new($false))
        )
        $powerShellPath = Join-Path $PSHOME "powershell.exe"
        $result = Invoke-DemoCapturedProcess -FilePath $powerShellPath `
            -ArgumentList @("-NoProfile", "-File", $scriptPath, "alpha beta") `
            -Environment @{} -TimeoutSeconds 5
        Assert-Equal $result.ExitCode 0 "Spaced-path command exit"
        Assert-Equal $result.Output "alpha beta" "Spaced-path argument preservation"
    }

    Invoke-DemoTestCase "captured_process_timeout_is_bounded" {
        $scriptPath = Join-Path $temporaryRoot "bounded-timeout.ps1"
        [System.IO.File]::WriteAllText(
            $scriptPath,
            'Start-Sleep -Seconds 10',
            ([System.Text.UTF8Encoding]::new($false))
        )
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $result = Invoke-DemoCapturedProcess `
            -FilePath (Join-Path $PSHOME "powershell.exe") `
            -ArgumentList @("-NoProfile", "-File", $scriptPath) `
            -Environment @{} -TimeoutSeconds 1
        Assert-True $result.TimedOut "Bounded command did not time out."
        Assert-True (-not $result.CleanupFailed) "Timed-out command was not cleaned up."
        Assert-True ($null -ne $result.ProcessFact) `
            "Timed-out helper identity was not retained."
        Assert-True ($watch.Elapsed.TotalSeconds -lt 6) "Bounded command exceeded cleanup bound."
    }

    Invoke-DemoTestCase "process_environment_restored" {
        $name = "SPTC_DEMO_TEST_ENV"
        $original = [Environment]::GetEnvironmentVariable($name, "Process")
        try {
            [Environment]::SetEnvironmentVariable($name, "before", "Process")
            $seen = Invoke-WithTemporaryProcessEnvironment `
                -Environment @{ SPTC_DEMO_TEST_ENV = "child-only" } `
                -Action {
                    [Environment]::GetEnvironmentVariable(
                        "SPTC_DEMO_TEST_ENV",
                        "Process"
                    )
                }
            Assert-Equal $seen "child-only" "Child environment value"
            Assert-Equal (
                [Environment]::GetEnvironmentVariable($name, "Process")
            ) "before" "Parent process environment restoration"
        } finally {
            [Environment]::SetEnvironmentVariable($name, $original, "Process")
        }
    }

    Invoke-DemoTestCase "state_schema_operational_only" {
        $state = New-DemoState -SessionId "test-session" `
            -CreatedAtUtc "2026-08-03T12:00:00Z" `
            -LogDirectory (Join-Path $temporaryRoot "logs")
        $json = $state | ConvertTo-Json -Depth 8
        foreach ($forbidden in @("chat", "prompt", "evidence", "npmrds", "api_key")) {
            Assert-True ($json -notmatch $forbidden) "State contains forbidden field $forbidden."
        }
    }

    Invoke-DemoTestCase "atomic_state_round_trip" {
        $statePath = Join-Path $temporaryRoot "state with spaces\active-session.json"
        $sessionId = [guid]::NewGuid().ToString("D")
        $logsRoot = Join-Path $temporaryRoot "logs"
        $layout = [pscustomobject]@{
            LogsRoot = $logsRoot
            BackendPython = Join-Path $temporaryRoot "python.exe"
            BackendUvicorn = Join-Path $temporaryRoot "uvicorn.exe"
        }
        $state = New-DemoState -SessionId $sessionId `
            -CreatedAtUtc "2026-08-03T12:00:00Z" `
            -LogDirectory (Join-Path $logsRoot $sessionId)
        Write-DemoState -State $state -StatePath $statePath
        $state.status = "starting"
        Write-DemoState -State $state -StatePath $statePath
        $loaded = Read-DemoState -StatePath $statePath -Layout $layout
        Assert-Equal $loaded.session_id $sessionId "Repeated atomic state round trip"
        Assert-True (-not (Test-Path -LiteralPath "$statePath.tmp")) `
            "Temporary state file remains."
        Assert-True (-not (Test-Path -LiteralPath "$statePath.bak")) `
            "Backup state file remains."
    }

    Invoke-DemoTestCase "lifecycle_lock_is_exclusive" {
        $lockPath = Join-Path $temporaryRoot "lock test\lifecycle.lock"
        $first = Enter-DemoLifecycleLock -LockPath $lockPath
        try {
            Assert-ThrowsLike {
                $second = Enter-DemoLifecycleLock -LockPath $lockPath
                if ($null -ne $second) {
                    $second.Dispose()
                }
            } "already running"
        } finally {
            $first.Dispose()
        }
        $third = Enter-DemoLifecycleLock -LockPath $lockPath
        $third.Dispose()
        Assert-True (Test-Path -LiteralPath $lockPath -PathType Leaf) `
            "Persistent lock inode was unexpectedly removed."
    }

    Invoke-DemoTestCase "bounded_session_logs" {
        $logsRoot = Join-Path $temporaryRoot "bounded logs"
        $session = Join-Path $logsRoot ([guid]::NewGuid().ToString("D"))
        [void](New-Item -ItemType Directory -Path $session -Force)
        $logPath = Join-Path $session "backend.stderr.log"
        [System.IO.File]::WriteAllBytes($logPath, (New-Object byte[] 2048))
        Limit-DemoLogFile -Path $logPath -MaximumBytes 512
        Assert-Equal (Get-Item -LiteralPath $logPath).Length 512 `
            "Log file retention bound"
        Assert-ThrowsLike {
            Limit-DemoSessionLogs -LogDirectory $temporaryRoot -LogsRoot $logsRoot
        } "outside|non-session"
    }

    Invoke-DemoTestCase "supervisor_caps_continuous_service_logs" {
        $runtimeLogs = Join-Path $demoRoot ".runtime\logs"
        $sessionId = [guid]::NewGuid().ToString("D")
        $session = Join-Path $runtimeLogs $sessionId
        [void](New-Item -ItemType Directory -Path $session -Force)
        $stdoutLog = Join-Path $session "frontend.stdout.log"
        $stderrLog = Join-Path $session "frontend.stderr.log"
        $writerScript = Join-Path $temporaryRoot "noisy_service.py"
        [System.IO.File]::WriteAllText(
            $writerScript,
            @'
import sys
import time

chunk = b"x" * 32768
for _ in range(320):
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()
    sys.stderr.buffer.write(chunk)
    sys.stderr.buffer.flush()
    time.sleep(0.01)
'@,
            ([System.Text.UTF8Encoding]::new($false))
        )
        $supervisor = $null
        try {
            $layout = Get-LocalDemoLayout -ScriptRoot $demoRoot
            $baseResult = Invoke-DemoCapturedProcess `
                -FilePath $layout.BackendPython `
                -ArgumentList @("-c", "import sys; print(sys._base_executable)") `
                -Environment @{} -TimeoutSeconds 5
            Assert-Equal $baseResult.ExitCode 0 "Base Python discovery"
            $basePython = $baseResult.Output.Trim()
            $supervisor = Start-DemoSupervisedProcess `
                -SupervisorPython $basePython `
                -SupervisorScript (Join-Path $demoRoot "supervise_service.py") `
                -ServiceFilePath $basePython `
                -ServiceArguments @($writerScript) `
                -WorkingDirectory $temporaryRoot -Environment @{} `
                -StandardOutputLog $stdoutLog -StandardErrorLog $stderrLog `
                -StartGatePath (Join-Path $session "frontend.start.gate") `
                -StartGateToken ($gateToken = [guid]::NewGuid().ToString("D"))
            Open-DemoSupervisorGate `
                -GatePath (Join-Path $session "frontend.start.gate") `
                -Token $gateToken -LogDirectory $session -LogsRoot $runtimeLogs
            $observedActiveBound = $false
            while (-not $supervisor.HasExited) {
                foreach ($path in @($stdoutLog, $stderrLog)) {
                    if (Test-Path -LiteralPath $path -PathType Leaf) {
                        $length = (Get-Item -LiteralPath $path).Length
                        Assert-True ($length -le 1114112) `
                            "An active writer exceeded the service-log hard bound."
                        if ($length -gt 1048576) {
                            $observedActiveBound = $true
                        }
                    }
                }
                Start-Sleep -Milliseconds 5
            }
            Assert-True ($supervisor.WaitForExit(15000)) `
                "Noisy supervised service did not exit."
            Assert-Equal $supervisor.ExitCode 0 "Supervisor exit"
            Assert-True $observedActiveBound `
                "The active log-bound interval was not observed."
            foreach ($path in @($stdoutLog, $stderrLog)) {
                $length = (Get-Item -LiteralPath $path).Length
                Assert-True ($length -gt 0) "Supervisor log is empty."
                Assert-True ($length -le 1114112) `
                    "Writer-owned service log exceeded its hard bound."
            }
        } finally {
            if ($null -ne $supervisor -and -not $supervisor.HasExited) {
                $supervisor.Kill()
                [void]$supervisor.WaitForExit(3000)
            }
            if (Test-Path -LiteralPath $session -PathType Container) {
                Remove-Item -LiteralPath $session -Recurse -Force
            }
        }
    }

    Invoke-DemoTestCase "supervisor_job_kills_owned_service_on_exit" {
        $runtimeLogs = Join-Path $demoRoot ".runtime\logs"
        $sessionId = [guid]::NewGuid().ToString("D")
        $session = Join-Path $runtimeLogs $sessionId
        [void](New-Item -ItemType Directory -Path $session -Force)
        $stdoutLog = Join-Path $session "backend.stdout.log"
        $stderrLog = Join-Path $session "backend.stderr.log"
        $pidPath = Join-Path $temporaryRoot "supervised service.pid"
        $grandchildPidPath = Join-Path $temporaryRoot "supervised grandchild.pid"
        $serviceScript = Join-Path $temporaryRoot "long_running_service.py"
        $grandchildScript = Join-Path $temporaryRoot "immediate_grandchild.py"
        [System.IO.File]::WriteAllText(
            $grandchildScript,
            @'
import os
from pathlib import Path
import sys
import time

Path(sys.argv[1]).write_text(str(os.getpid()), encoding="ascii")
while True:
    time.sleep(0.1)
'@,
            ([System.Text.UTF8Encoding]::new($false))
        )
        [System.IO.File]::WriteAllText(
            $serviceScript,
            @'
import os
from pathlib import Path
import subprocess
import sys
import time

subprocess.Popen([sys.executable, sys.argv[3], sys.argv[2]])
Path(sys.argv[1]).write_text(str(os.getpid()), encoding="ascii")
while True:
    time.sleep(0.1)
'@,
            ([System.Text.UTF8Encoding]::new($false))
        )
        $supervisor = $null
        $ownedRecords = @()
        try {
            $layout = Get-LocalDemoLayout -ScriptRoot $demoRoot
            $supervisor = Start-DemoSupervisedProcess `
                -SupervisorPython $layout.BackendSupervisorPython `
                -SupervisorScript (Join-Path $demoRoot "supervise_service.py") `
                -ServiceFilePath $layout.BackendSupervisorPython `
                -ServiceArguments @(
                    $serviceScript, $pidPath, $grandchildPidPath, $grandchildScript
                ) `
                -WorkingDirectory $temporaryRoot -Environment @{} `
                -StandardOutputLog $stdoutLog -StandardErrorLog $stderrLog `
                -StartGatePath (Join-Path $session "backend.start.gate") `
                -StartGateToken ($gateToken = [guid]::NewGuid().ToString("D"))
            Start-Sleep -Milliseconds 200
            Assert-True (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) `
                "The service started before its supervisor was durably acknowledged."
            Open-DemoSupervisorGate -GatePath (Join-Path $session "backend.start.gate") `
                -Token $gateToken -LogDirectory $session -LogsRoot $runtimeLogs
            $deadline = [DateTime]::UtcNow.AddSeconds(5)
            while ((-not (Test-Path -LiteralPath $pidPath -PathType Leaf) -or
                    -not (Test-Path -LiteralPath $grandchildPidPath -PathType Leaf)) -and
                [DateTime]::UtcNow -lt $deadline) {
                Start-Sleep -Milliseconds 50
            }
            Assert-True (Test-Path -LiteralPath $pidPath -PathType Leaf) `
                "The supervised service did not publish its PID."
            Assert-True (Test-Path -LiteralPath $grandchildPidPath -PathType Leaf) `
                "The immediate grandchild did not publish its PID."
            foreach ($ownedId in @(
                    [int](Get-Content -LiteralPath $pidPath -Raw),
                    [int](Get-Content -LiteralPath $grandchildPidPath -Raw)
                )) {
                $ownedFact = Get-DemoProcessFact -ProcessId $ownedId
                Assert-True ($null -ne $ownedFact) `
                    "A supervised process was not active."
                $ownedRecords += New-DemoProcessRecordFromFact -Role "backend" `
                    -ProcessFact $ownedFact -Port 8080 -CreatedByLauncher $true
            }

            Stop-Process -Id $supervisor.Id -Force -ErrorAction Stop
            [void]$supervisor.WaitForExit(3000)
            $deadline = [DateTime]::UtcNow.AddSeconds(5)
            do {
                $remaining = @($ownedRecords | Where-Object {
                        $actual = Get-DemoProcessFact -ProcessId ([int]$_.process_id)
                        Test-DemoProcessIdentity -Record $_ -ActualProcess $actual
                    })
                if ($remaining.Count -eq 0) {
                    break
                }
                Start-Sleep -Milliseconds 50
            } while ([DateTime]::UtcNow -lt $deadline)
            Assert-Equal $remaining.Count 0 `
                "A service descendant survived termination of its owning supervisor."
        } finally {
            if ($null -ne $supervisor -and -not $supervisor.HasExited) {
                Stop-Process -Id $supervisor.Id -Force -ErrorAction SilentlyContinue
                [void]$supervisor.WaitForExit(3000)
            }
            foreach ($record in @($ownedRecords)) {
                $actual = Get-DemoProcessFact -ProcessId ([int]$record.process_id)
                if (Test-DemoProcessIdentity -Record $record -ActualProcess $actual) {
                    Stop-Process -Id ([int]$record.process_id) -Force `
                        -ErrorAction SilentlyContinue
                }
            }
            if (Test-Path -LiteralPath $session -PathType Container) {
                Remove-Item -LiteralPath $session -Recurse -Force
            }
        }
    }

    Invoke-DemoTestCase "bounded_supervisor_registers_before_service_start" {
        $runtimeLogs = Join-Path $demoRoot ".runtime\logs"
        $sessionId = [guid]::NewGuid().ToString("D")
        $session = Join-Path $runtimeLogs $sessionId
        [void](New-Item -ItemType Directory -Path $session -Force)
        $stdoutLog = Join-Path $session "warmup.stdout.log"
        $stderrLog = Join-Path $session "warmup.stderr.log"
        $gatePath = Join-Path $session "warmup.start.gate"
        $markerPath = Join-Path $temporaryRoot "bounded service started.marker"
        $serviceScript = Join-Path $temporaryRoot "bounded_registered_service.py"
        [System.IO.File]::WriteAllText(
            $serviceScript,
            @'
from pathlib import Path
import sys

Path(sys.argv[1]).write_text("started", encoding="ascii")
print("READY elapsed_seconds=0.001")
'@,
            ([System.Text.UTF8Encoding]::new($false))
        )
        $events = New-Object System.Collections.Generic.List[string]
        $register = {
            param($processFact)
            if (Test-Path -LiteralPath $markerPath) {
                throw "The service ran before registration."
            }
            [void]$events.Add("register:$($processFact.ProcessId)")
        }.GetNewClosure()
        $unregister = {
            param($processFact)
            [void]$events.Add("unregister:$($processFact.ProcessId)")
        }.GetNewClosure()
        try {
            $layout = Get-LocalDemoLayout -ScriptRoot $demoRoot
            $result = Invoke-DemoBoundedProcess `
                -SupervisorPython $layout.BackendSupervisorPython `
                -SupervisorScript (Join-Path $demoRoot "supervise_service.py") `
                -FilePath $layout.BackendSupervisorPython `
                -ArgumentList @($serviceScript, $markerPath) `
                -WorkingDirectory $temporaryRoot -Environment @{} `
                -StandardOutputLog $stdoutLog -StandardErrorLog $stderrLog `
                -TimeoutSeconds 5 -StartGatePath $gatePath `
                -LogDirectory $session -LogsRoot $runtimeLogs `
                -RegisterProcessAction $register `
                -UnregisterProcessAction $unregister
            Assert-Equal $result.ExitCode 0 "Bounded supervisor exit"
            Assert-True (-not $result.CleanupFailed) `
                "Bounded supervisor unexpectedly required cleanup."
            Assert-True (Test-Path -LiteralPath $markerPath -PathType Leaf) `
                "The registered bounded service did not run."
            Assert-Equal $events.Count 2 "Registration event count"
            Assert-True ($events[0] -match '^register:\d+$') `
                "Registration did not occur first."
            Assert-True ($events[1] -match '^unregister:\d+$') `
                "Unregistration did not occur after exit."
        } finally {
            if (Test-Path -LiteralPath $session -PathType Container) {
                Remove-Item -LiteralPath $session -Recurse -Force
            }
        }
    }

    Invoke-DemoTestCase "valid_ready_state_contract" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "valid-ready")
        $state = New-ValidReadyDemoState -Layout $layout
        $loaded = Read-TestState -State $state -Layout $layout -Name "valid-ready"
        Assert-Equal $loaded.status "ready" "Ready state status"
        Assert-Equal @($loaded.processes).Count 3 "Ready state process inventory"
    }

    Invoke-DemoTestCase "valid_starting_state_contract" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "valid-starting")
        $sessionId = [guid]::NewGuid().ToString("D")
        $state = New-DemoState -SessionId $sessionId `
            -CreatedAtUtc "2026-08-03T12:00:00.0000000Z" `
            -LogDirectory (Join-Path $layout.LogsRoot $sessionId)
        $loaded = Read-TestState -State $state -Layout $layout -Name "valid-starting"
        Assert-Equal $loaded.status "starting" "Starting state status"
    }

    Invoke-DemoTestCase "valid_child_service_state_contract" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "valid-child")
        $state = New-ValidReadyDemoState -Layout $layout
        $backend = @($state.processes | Where-Object {
                $_.role -eq "backend"
            }) | Select-Object -First 1
        $backend.executable_path = "C:\Python\python.exe"
        $backend.launcher_process_id = 520
        $launcher = New-DemoProcessRecord -Role "backend_launcher" `
            -ProcessId 520 -StartTimeUtc "2026-08-03T12:00:01.5000000Z" `
            -ExecutablePath $layout.BackendSupervisorPython -Port 8080 `
            -CreatedByLauncher $true
        $state.processes = @($state.processes) + @($launcher)
        $loaded = Read-TestState -State $state -Layout $layout -Name "valid-child"
        Assert-Equal @($loaded.processes).Count 4 "Child-service state inventory"
    }

    Invoke-DemoTestCase "state_rejects_unmatched_child_service" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "bad-child")
        $state = New-ValidReadyDemoState -Layout $layout
        $backend = @($state.processes | Where-Object {
                $_.role -eq "backend"
            }) | Select-Object -First 1
        $backend.executable_path = "C:\Python\python.exe"
        $backend.launcher_process_id = 999
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "bad-child"
        } "unmatched child-service"
    }

    Invoke-DemoTestCase "state_rejects_invalid_session_metadata" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "bad-session")
        $mutations = @(
            @{ Name = "guid"; Apply = { param($s) $s.session_id = "not-a-guid" } },
            @{ Name = "status"; Apply = { param($s) $s.status = "stopped" } },
            @{ Name = "browser"; Apply = { param($s) $s.browser_url = "http://example.test" } },
            @{ Name = "model"; Apply = { param($s) $s.model_name = "other" } },
            @{ Name = "created"; Apply = { param($s) $s.created_at_utc = "yesterday" } }
        )
        foreach ($mutation in $mutations) {
            $state = New-ValidReadyDemoState -Layout $layout
            & $mutation.Apply $state
            Assert-ThrowsLike {
                Read-TestState -State $state -Layout $layout `
                    -Name ("bad-session-" + $mutation.Name)
            } "invalid|timestamp"
        }
    }

    Invoke-DemoTestCase "state_rejects_invalid_lifecycle_metadata" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "bad-lifecycle")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.ollama_preexisting = "true"
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "bad-bool"
        } "lifecycle"

        $state = New-ValidReadyDemoState -Layout $layout
        $state.ports.backend = "8080"
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "bad-port-type"
        } "lifecycle"

        $state = New-ValidReadyDemoState -Layout $layout
        $state.model_loaded_by_launcher = $true
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "bad-residency"
        } "lifecycle"
    }

    Invoke-DemoTestCase "state_rejects_log_directory_escape" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "log-escape")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.log_directory = Join-Path $temporaryRoot "outside-logs"
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "log-escape"
        } "outside the runtime root"
    }

    Invoke-DemoTestCase "state_rejects_role_and_port_conflicts" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "role-conflict")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[2].role = "unknown"
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "unknown-role"
        } "authorization"

        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[2].port = 8080
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "wrong-role-port"
        } "authorization"
    }

    Invoke-DemoTestCase "state_rejects_duplicate_role_and_pid" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "duplicate")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[2].role = "backend"
        $state.processes[2].port = 8080
        $state.processes[2].executable_path = $layout.BackendUvicorn
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "duplicate-role"
        } "conflicting"

        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[2].process_id = $state.processes[1].process_id
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "duplicate-pid"
        } "conflicting"
    }

    Invoke-DemoTestCase "state_rejects_unauthorized_processes" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "unauthorized")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[1].executable_path = "C:\Other\python.exe"
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "wrong-executable"
        } "unauthorized executable"

        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[1].created_by_launcher = $false
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "preexisting-backend"
        } "Only a verified Ollama"
    }

    Invoke-DemoTestCase "state_rejects_process_log_escape" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "process-log")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes[1].stdout_log = Join-Path $temporaryRoot "outside.log"
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "process-log-escape"
        } "outside the session log directory"
    }

    Invoke-DemoTestCase "state_rejects_incomplete_ready_inventory" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "ready-missing")
        $state = New-ValidReadyDemoState -Layout $layout
        $state.processes = @($state.processes | Where-Object {
                $_.role -ne "frontend"
            })
        Assert-ThrowsLike {
            Read-TestState -State $state -Layout $layout -Name "ready-missing"
        } "missing a required service"
    }

    Invoke-DemoTestCase "state_rejects_invalid_ready_metadata" {
        $layout = New-TestStateLayout -Root (Join-Path $temporaryRoot "ready-metadata")
        $mutations = @(
            @{ Name = "ready-at"; Apply = { param($s) $s.ready_at_utc = "bad" } },
            @{ Name = "startup"; Apply = { param($s) $s.startup_seconds = "10" } },
            @{ Name = "warmup"; Apply = { param($s) $s.warmup_seconds = -1 } },
            @{ Name = "vram"; Apply = { param($s) $s.gpu_vram_used_mib = $true } },
            @{ Name = "allocation"; Apply = { param($s) $s.gpu_allocation = "100% CPU" } }
        )
        foreach ($mutation in $mutations) {
            $state = New-ValidReadyDemoState -Layout $layout
            & $mutation.Apply $state
            Assert-ThrowsLike {
                Read-TestState -State $state -Layout $layout `
                    -Name ("ready-metadata-" + $mutation.Name)
            } "readiness metadata"
        }
    }

    Invoke-DemoTestCase "startup_order" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "start-local-chatbot-demo.ps1"
        ) -Raw
        $orderedMarkers = @(
            '$stage = "NVIDIA GPU verification"',
            '$stage = "Ollama loopback startup"',
            '$stage = "qwen3:8b explicit warm-up"',
            '$stage = "GPU allocation verification"',
            '$stage = "FastAPI startup"',
            '$stage = "frontend startup"',
            '$stage = "browser open"'
        )
        $positions = @($orderedMarkers | ForEach-Object { $source.IndexOf($_) })
        Assert-True (-not ($positions -contains -1)) "A startup stage marker is missing."
        for ($index = 1; $index -lt $positions.Count; $index += 1) {
            Assert-True ($positions[$index] -gt $positions[$index - 1]) `
                "Startup stage order is incorrect."
        }
    }

    Invoke-DemoTestCase "launcher_role_parameter_contracts" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "start-local-chatbot-demo.ps1"
        ) -Raw
        $helperStart = $source.IndexOf("function Register-FailedDemoHelper")
        $helperEnd = $source.IndexOf("function Add-StartedServiceRecords", $helperStart)
        $helperBody = $source.Substring($helperStart, $helperEnd - $helperStart)
        Assert-True ($helperBody -match
            'ValidateSet\("ollama_cli",\s*"nvidia_smi"\)') `
            "Helper role validation does not match its callers."
        $serviceStart = $source.IndexOf("function Start-TrackedDemoProcess")
        $serviceEnd = $source.IndexOf("function Invoke-LaunchFailureRollback", $serviceStart)
        $serviceBody = $source.Substring($serviceStart, $serviceEnd - $serviceStart)
        Assert-True ($serviceBody -match
            'ValidateSet\("ollama",\s*"backend",\s*"frontend"\)') `
            "Service role validation does not match its callers."
    }

    Invoke-DemoTestCase "graceful_then_force" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "lib\LocalDemo.Windows.psm1"
        ) -Raw
        $start = $source.IndexOf("function Stop-DemoOwnedProcess")
        $end = $source.IndexOf("function Limit-DemoLogFile", $start)
        $body = $source.Substring($start, $end - $start)
        $close = $body.IndexOf("CloseMainWindow")
        $normal = $body.IndexOf("Stop-Process -Id")
        $recheck = $body.IndexOf("actualBeforeForce")
        $force = $body.LastIndexOf("-Force")
        Assert-True (
            $close -ge 0 -and $normal -gt $close -and $recheck -gt $normal -and
            $force -gt $recheck
        ) "Graceful, bounded, revalidated force order is missing."
    }

    Invoke-DemoTestCase "status_is_read_only" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "status-local-chatbot-demo.ps1"
        ) -Raw
        foreach ($forbidden in @(
                "Start-DemoProcess", "Stop-DemoOwnedProcess", "Write-DemoState",
                "Open-DemoBrowser", "Remove-Item"
            )) {
            Assert-True ($source -notmatch [regex]::Escape($forbidden)) `
                "Status contains mutating operation $forbidden."
        }
    }

    Invoke-DemoTestCase "static_local_only_safety" {
        $operationalFiles = @(Get-ChildItem -LiteralPath $demoRoot -Recurse -File |
                Where-Object {
                    $_.Extension -in @(".ps1", ".psm1", ".py") -and
                    $_.FullName -notlike "*\tests\*"
                })
        $source = ($operationalFiles | ForEach-Object {
                Get-Content -LiteralPath $_.FullName -Raw
            }) -join "`n"
        foreach ($forbiddenPattern in @(
                "(?i)ollama\s+pull", '(?i)@\(\s*["'']pull["'']',
                "(?i)\bsetx\b", "(?i)-Verb\s+RunAs",
                "(?i)(?:New|Set|Remove)-NetFirewallRule",
                "(?i)(?:Start|Stop|Set|New)-Service", "(?i)sc\.exe",
                "(?i)pnputil", "(?i)api[_-]?key", "(?i)https://",
                "(?i)--host\s+0\.0\.0\.0", '(?i)OLLAMA_HOST\s*=\s*["'']?0\.0\.0\.0'
            )) {
            Assert-True ($source -notmatch $forbiddenPattern) `
                "Forbidden operational pattern found: $forbiddenPattern"
        }
        Assert-True ($source -match "127\.0\.0\.1:11434") "Fixed Ollama loopback is missing."
        Assert-True ($source -match "127\.0\.0\.1:8080") "Fixed backend loopback is missing."
        Assert-True ($source -match "127\.0\.0\.1:8001") "Fixed frontend loopback is missing."
        Assert-True ($source -match "assistantMode=backend-agent") "Fixed browser mode is missing."
    }

    Invoke-DemoTestCase "exact_backend_environment" {
        $snapshot = "C:\reviewed snapshot"
        $environment = Get-DemoBackendEnvironment -SnapshotDirectory $snapshot
        Assert-Equal $environment.RESILIENCE_ASSISTANT_ENABLED "true" `
            "Assistant enablement"
        Assert-Equal $environment.RESILIENCE_MODEL_PROVIDER "ollama" `
            "Model provider"
        Assert-Equal $environment.RESILIENCE_OLLAMA_BASE_URL `
            "http://127.0.0.1:11434" "Ollama URL"
        Assert-Equal $environment.RESILIENCE_OLLAMA_MODEL "qwen3:8b" "Model"
        Assert-Equal $environment.RESILIENCE_CORS_ALLOWED_ORIGINS `
            "http://127.0.0.1:8001,http://localhost:8001" "Exact CORS origins"
        Assert-Equal $environment.RESILIENCE_ASSISTANT_TIMEOUT_SECONDS "75" `
            "Assistant timeout"
        Assert-Equal $environment.RESILIENCE_ASSISTANT_MAX_HISTORY_MESSAGES "4" `
            "History bound"
        Assert-Equal $environment.RESILIENCE_ASSISTANT_MAX_TOOL_CALLS "1" `
            "Tool-call bound"
        Assert-Equal $environment.RESILIENCE_ASSISTANT_MAX_ANSWER_WORDS "180" `
            "Answer-word bound"
    }

    Invoke-DemoTestCase "exact_loopback_launch_arguments" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "start-local-chatbot-demo.ps1"
        ) -Raw
        Assert-True ($source -match 'OLLAMA_HOST\s*=\s*"127\.0\.0\.1:11434"') `
            "Ollama loopback environment is not exact."
        Assert-True ($source -match '"--host",\s*"127\.0\.0\.1",\s*"--port",\s*"8080"') `
            "FastAPI loopback arguments are not exact."
        Assert-True ($source -match '"http\.server",\s*"8001",\s*"--bind",\s*"127\.0\.0\.1"') `
            "Frontend loopback arguments are not exact."
        Assert-True ($source -match 'Open-DemoBrowser\s+-Url\s+\$constants\.BrowserUrl') `
            "Browser is not opened with the fixed reviewed URL."
    }

    Invoke-DemoTestCase "no_permanent_environment_mutation" {
        $source = Get-Content -LiteralPath (
            Join-Path $demoRoot "lib\LocalDemo.Core.psm1"
        ) -Raw
        Assert-True ($source -match "SetEnvironmentVariable") `
            "Child environment helper is missing."
        Assert-True ($source -notmatch 'SetEnvironmentVariable\([^\)]*,\s*"(?:User|Machine)"') `
            "Permanent environment target found."
    }

    Invoke-DemoTestCase "browser_never_targets_ollama" {
        $constants = Get-LocalDemoConstants
        Assert-True ($constants.BrowserUrl -match "^http://127\.0\.0\.1:8001/") `
            "Browser URL is not the fixed frontend origin."
        Assert-True ($constants.BrowserUrl -notmatch ":11434") `
            "Browser URL exposes Ollama."
    }

    foreach ($record in $script:caseRecords) {
        Write-Output ("CASE " + ($record | ConvertTo-Json -Compress))
    }
    $summary = [ordered]@{
        total_cases = $script:passed + $script:failed
        passed_cases = $script:passed
        failed_cases = $script:failed
        overall_result = if ($script:failed -eq 0) { "pass" } else { "fail" }
    }
    Write-Output ("SUMMARY " + ($summary | ConvertTo-Json -Compress))
    if ($script:failed -gt 0) {
        exit 1
    }
} finally {
    $resolvedTemp = [System.IO.Path]::GetFullPath($temporaryRoot)
    $systemTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTemp.StartsWith($systemTemp) -and
        (Split-Path -Leaf $resolvedTemp).StartsWith("sptc local demo tests ") -and
        (Test-Path -LiteralPath $resolvedTemp -PathType Container)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
