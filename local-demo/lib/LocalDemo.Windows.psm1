Set-StrictMode -Version Latest

$coreModule = Join-Path $PSScriptRoot "LocalDemo.Core.psm1"
Import-Module $coreModule

$script:AllowedDemoLogNames = @(
    "ollama.stdout.log", "ollama.stderr.log",
    "warmup.stdout.log", "warmup.stderr.log",
    "backend.stdout.log", "backend.stderr.log",
    "frontend.stdout.log", "frontend.stderr.log"
)
$script:AllowedDemoControlNames = @(
    "ollama.start.gate", "warmup.start.gate",
    "backend.start.gate", "frontend.start.gate"
)

function Get-DemoPowerShellInfo {
    [CmdletBinding()]
    param()

    [pscustomobject]@{
        OS = $env:OS
        MajorVersion = [int]$PSVersionTable.PSVersion.Major
        FullVersion = [string]$PSVersionTable.PSVersion
        Edition = [string]$PSVersionTable.PSEdition
    }
}

function Resolve-DemoExecutable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName,
        [Parameter(Mandatory = $false)]
        [string[]]$Candidates = @()
    )

    $command = Get-Command $CommandName -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
        return [System.IO.Path]::GetFullPath($command.Source)
    }
    foreach ($candidate in $Candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and
            (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }
    throw "Required executable was not found: $CommandName"
}

function Assert-DemoRuntimePathSafety {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Layout
    )

    $demoRoot = ConvertTo-NormalizedDemoPath $Layout.DemoRoot
    $runtimeRoot = ConvertTo-NormalizedDemoPath $Layout.RuntimeRoot
    $logsRoot = ConvertTo-NormalizedDemoPath $Layout.LogsRoot
    if ([System.IO.Path]::GetDirectoryName($runtimeRoot) -ne $demoRoot -or
        [System.IO.Path]::GetDirectoryName($logsRoot) -ne $runtimeRoot -or
        (ConvertTo-NormalizedDemoPath (Split-Path -Parent $Layout.StatePath)) -ne
            $runtimeRoot -or
        (ConvertTo-NormalizedDemoPath (Split-Path -Parent $Layout.LockPath)) -ne
            $runtimeRoot) {
        throw "Launcher runtime paths are outside the local-demo directory."
    }
    foreach ($path in @(
            $Layout.DemoRoot, $Layout.RuntimeRoot, $Layout.LogsRoot,
            $Layout.StatePath, "$($Layout.StatePath).tmp",
            "$($Layout.StatePath).bak", $Layout.LockPath
        )) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Launcher runtime paths must not contain reparse points: $path"
        }
    }
}

function Initialize-DemoRuntime {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Layout
    )

    foreach ($path in @($Layout.RuntimeRoot, $Layout.LogsRoot)) {
        Assert-DemoRuntimePathSafety -Layout $Layout
        [void](New-Item -ItemType Directory -Path $path -Force)
        Assert-DemoRuntimePathSafety -Layout $Layout
    }
}

function Invoke-DemoGit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$GitPath,
        [Parameter(Mandatory = $true)]
        [string]$Repository,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $false)]
        [switch]$AllowFailure
    )

    $output = @(& $GitPath -C $Repository @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Git checkpoint verification failed."
    }
    [pscustomobject]@{
        ExitCode = $exitCode
        Output = ($output -join "`n").Trim()
    }
}

function Assert-DemoRepositoryCheckpoints {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Layout,
        [Parameter(Mandatory = $true)]
        [string]$GitPath
    )

    $constants = Get-LocalDemoConstants
    foreach ($repository in @($Layout.FrontendRepository, $Layout.BackendRepository)) {
        if (-not (Test-Path -LiteralPath $repository -PathType Container) -or
            -not (Test-Path -LiteralPath (Join-Path $repository ".git") -PathType Container)) {
            throw "Required Git repository is missing: $repository"
        }
    }

    $frontendCommit = Invoke-DemoGit -GitPath $GitPath `
        -Repository $Layout.FrontendRepository `
        -Arguments @("cat-file", "-e", "$($constants.AcceptedFrontendCommit)^{commit}") `
        -AllowFailure
    $tagTarget = Invoke-DemoGit -GitPath $GitPath `
        -Repository $Layout.FrontendRepository `
        -Arguments @("rev-list", "-n", "1", $constants.AcceptedFrontendTag)
    $ancestor = Invoke-DemoGit -GitPath $GitPath `
        -Repository $Layout.FrontendRepository `
        -Arguments @("merge-base", "--is-ancestor", $constants.AcceptedFrontendCommit, "HEAD") `
        -AllowFailure
    $backendHead = Invoke-DemoGit -GitPath $GitPath `
        -Repository $Layout.BackendRepository `
        -Arguments @("rev-parse", "HEAD")
    $cleanFacts = @{}
    foreach ($repository in @($Layout.FrontendRepository, $Layout.BackendRepository)) {
        $status = Invoke-DemoGit -GitPath $GitPath -Repository $repository `
            -Arguments @("status", "--porcelain=v1")
        $cleanFacts[$repository] = [string]::IsNullOrWhiteSpace($status.Output)
    }
    Assert-DemoCheckpointFacts `
        -FrontendCommitExists ($frontendCommit.ExitCode -eq 0) `
        -FrontendTagTarget $tagTarget.Output `
        -FrontendContainsAcceptedCommit ($ancestor.ExitCode -eq 0) `
        -BackendHead $backendHead.Output `
        -FrontendClean $cleanFacts[$Layout.FrontendRepository] `
        -BackendClean $cleanFacts[$Layout.BackendRepository]
}

function Get-DemoOllamaManifestPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [string]$ModelName = "qwen3:8b"
    )

    $parts = $ModelName.Split(":", 2)
    if ($parts.Count -ne 2) {
        throw "The fixed Ollama model name is invalid."
    }
    $modelsRoot = [Environment]::GetEnvironmentVariable("OLLAMA_MODELS", "Process")
    if ([string]::IsNullOrWhiteSpace($modelsRoot)) {
        $userProfile = [Environment]::GetFolderPath("UserProfile")
        $modelsRoot = Join-Path $userProfile ".ollama\models"
    }
    Join-Path $modelsRoot (
        "manifests\registry.ollama.ai\library\{0}\{1}" -f $parts[0], $parts[1]
    )
}

function Get-DemoGpuControllers {
    [CmdletBinding()]
    param()

    @(Get-CimInstance Win32_VideoController -OperationTimeoutSec 5 `
            -ErrorAction Stop | ForEach-Object {
            [pscustomobject]@{
                Name = [string]$_.Name
                Status = [string]$_.Status
                ConfigManagerErrorCode = [int]$_.ConfigManagerErrorCode
                DriverVersion = [string]$_.DriverVersion
            }
        })
}

function Invoke-DemoNvidiaSmi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$NvidiaSmiPath
    )

    $commandResult = Invoke-DemoCapturedProcess -FilePath $NvidiaSmiPath `
        -ArgumentList @(
            "--query-gpu=name,driver_version,memory.total,memory.used,memory.free",
            "--format=csv,noheader,nounits"
        ) -Environment @{} -TimeoutSeconds 10
    $output = @($commandResult.Output -split "`r?`n" | Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        })
    $exitCode = $commandResult.ExitCode
    $rows = @()
    if ($exitCode -eq 0) {
        foreach ($line in $output) {
            $fields = @([string]$line -split "," | ForEach-Object { $_.Trim() })
            if ($fields.Count -eq 5) {
                $rows += [pscustomobject]@{
                    Name = $fields[0]
                    DriverVersion = $fields[1]
                    TotalMiB = [int]$fields[2]
                    UsedMiB = [int]$fields[3]
                    FreeMiB = [int]$fields[4]
                }
            }
        }
    }
    [pscustomobject]@{
        ExitCode = $exitCode
        Rows = $rows
        TimedOut = $commandResult.TimedOut
        CleanupFailed = $commandResult.CleanupFailed
        ProcessFact = $commandResult.ProcessFact
    }
}

function Get-DemoProcessFact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    for ($attempt = 0; $attempt -lt 5; $attempt += 1) {
        $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            return $null
        }
        try {
            $path = [string]$process.Path
            $start = $process.StartTime.ToUniversalTime().ToString("o")
            return [pscustomobject]@{
                ProcessId = [int]$process.Id
                ProcessName = [string]$process.ProcessName
                ExecutablePath = $path
                StartTimeUtc = $start
                CommandLine = $null
            }
        } catch {
            try {
                if ($process.HasExited) {
                    return $null
                }
            } catch {
                if ($null -eq (Get-Process -Id $ProcessId `
                            -ErrorAction SilentlyContinue)) {
                    return $null
                }
            }
        }
        if ($attempt -lt 4) {
            Start-Sleep -Milliseconds 50
        }
    }
    throw "Process identity inspection failed for PID $ProcessId."
}

function ConvertFrom-DemoNetstatRows {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Lines,
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $rows = @()
    foreach ($line in $Lines) {
        if ([string]$line -match
            '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
            if ([int]$matches[2] -ne $Port) {
                continue
            }
            $rows += [pscustomobject]@{
                Address = $matches[1].Trim("[", "]")
                ProcessId = [int]$matches[3]
            }
        }
    }
    @($rows)
}

function Get-DemoPortListeners {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $connections = @()
    $usedNetstatFallback = $false
    try {
        $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port `
                -ErrorAction Stop)
    } catch [Microsoft.Management.Infrastructure.CimException] {
        $usedNetstatFallback = $true
    } catch [Microsoft.PowerShell.Cmdletization.Cim.CimJobException] {
        $usedNetstatFallback = $true
    } catch [System.UnauthorizedAccessException] {
        $usedNetstatFallback = $true
    } catch {
        if ($_.Exception.Message -match "(?i)access.*denied|拒绝访问") {
            $usedNetstatFallback = $true
        } else {
            throw "TCP listener inspection failed for port $Port."
        }
    }
    $listeners = @()
    if ($usedNetstatFallback) {
        $netstatPath = Resolve-DemoExecutable -CommandName "netstat.exe" -Candidates @(
            (Join-Path $env:windir "System32\netstat.exe")
        )
        $netstatOutput = @(& $netstatPath "-ano" "-p" "tcp" 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "TCP listener inspection failed for port $Port."
        }
        foreach ($row in @(ConvertFrom-DemoNetstatRows -Lines $netstatOutput `
                    -Port $Port)) {
            $fact = Get-DemoProcessFact -ProcessId ([int]$row.ProcessId)
            $listeners += [pscustomobject]@{
                Port = $Port
                Address = [string]$row.Address
                ProcessId = [int]$row.ProcessId
                ProcessName = if ($null -eq $fact) { $null } else { $fact.ProcessName }
                ProcessPath = if ($null -eq $fact) { $null } else { $fact.ExecutablePath }
                ProcessCommandLine = if ($null -eq $fact) { $null } else { $fact.CommandLine }
            }
        }
    } else {
        foreach ($connection in $connections) {
            $fact = Get-DemoProcessFact -ProcessId ([int]$connection.OwningProcess)
            $listeners += [pscustomobject]@{
                Port = $Port
                Address = [string]$connection.LocalAddress
                ProcessId = [int]$connection.OwningProcess
                ProcessName = if ($null -eq $fact) { $null } else { $fact.ProcessName }
                ProcessPath = if ($null -eq $fact) { $null } else { $fact.ExecutablePath }
                ProcessCommandLine = if ($null -eq $fact) { $null } else { $fact.CommandLine }
            }
        }
    }
    @($listeners)
}

function Get-DemoOllamaProcessFacts {
    [CmdletBinding()]
    param()

    $facts = @()
    foreach ($process in @(Get-Process -Name "ollama" -ErrorAction SilentlyContinue)) {
        $fact = Get-DemoProcessFact -ProcessId ([int]$process.Id)
        if ($null -ne $fact) {
            $facts += $fact
        }
    }
    @($facts)
}

function Get-DemoParentProcessId {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    if ($null -eq ("LocalDemo.NativeProcess" -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LocalDemo {
    public static class NativeProcess {
        [StructLayout(LayoutKind.Sequential)]
        private struct ProcessBasicInformation {
            public IntPtr Reserved1;
            public IntPtr PebBaseAddress;
            public IntPtr Reserved2_0;
            public IntPtr Reserved2_1;
            public IntPtr UniqueProcessId;
            public IntPtr InheritedFromUniqueProcessId;
        }

        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(
            IntPtr processHandle,
            int processInformationClass,
            ref ProcessBasicInformation processInformation,
            int processInformationLength,
            out int returnLength
        );

        public static int GetParentProcessId(int processId) {
            using (Process process = Process.GetProcessById(processId)) {
                ProcessBasicInformation information = new ProcessBasicInformation();
                int returnLength;
                int status = NtQueryInformationProcess(
                    process.Handle,
                    0,
                    ref information,
                    Marshal.SizeOf(information),
                    out returnLength
                );
                if (status != 0) {
                    throw new InvalidOperationException(
                        "NtQueryInformationProcess failed with status " + status
                    );
                }
                return information.InheritedFromUniqueProcessId.ToInt32();
            }
        }
    }
}
'@
    }
    try {
        [LocalDemo.NativeProcess]::GetParentProcessId($ProcessId)
    } catch {
        throw "Parent-process inspection failed for PID $ProcessId."
    }
}

function Test-DemoProcessDescendant {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,
        [Parameter(Mandatory = $true)]
        [object]$AncestorRecord,
        [Parameter(Mandatory = $false)]
        [scriptblock]$ParentProcessIdProvider,
        [Parameter(Mandatory = $false)]
        [scriptblock]$ProcessFactProvider
    )

    if ($null -eq $ParentProcessIdProvider) {
        $ParentProcessIdProvider = {
            param($targetProcessId)
            Get-DemoParentProcessId -ProcessId $targetProcessId
        }
    }
    if ($null -eq $ProcessFactProvider) {
        $ProcessFactProvider = {
            param($targetProcessId)
            Get-DemoProcessFact -ProcessId $targetProcessId
        }
    }
    if ($ProcessId -eq [int]$AncestorRecord.process_id) {
        $actualAncestor = & $ProcessFactProvider $ProcessId
        return Test-DemoProcessIdentity -Record $AncestorRecord `
            -ActualProcess $actualAncestor
    }
    $visited = @{}
    $currentId = $ProcessId
    while ($currentId -gt 0 -and -not $visited.ContainsKey([string]$currentId)) {
        $visited[[string]$currentId] = $true
        try {
            $parentId = [int](& $ParentProcessIdProvider $currentId)
        } catch {
            return $false
        }
        if ($parentId -eq [int]$AncestorRecord.process_id) {
            $actualAncestor = & $ProcessFactProvider $parentId
            return Test-DemoProcessIdentity -Record $AncestorRecord `
                -ActualProcess $actualAncestor
        }
        $currentId = $parentId
    }
    $false
}

function Start-DemoSupervisedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SupervisorPython,
        [Parameter(Mandatory = $true)]
        [string]$SupervisorScript,
        [Parameter(Mandatory = $true)]
        [string]$ServiceFilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$ServiceArguments,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment,
        [Parameter(Mandatory = $true)]
        [string]$StandardOutputLog,
        [Parameter(Mandatory = $true)]
        [string]$StandardErrorLog,
        [Parameter(Mandatory = $true)]
        [string]$StartGatePath,
        [Parameter(Mandatory = $true)]
        [string]$StartGateToken
    )

    $argumentsJson = ConvertTo-Json -InputObject @($ServiceArguments) -Compress
    $argumentsBase64 = [Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes($argumentsJson)
    )
    $supervisorArguments = @(
        $SupervisorScript,
        "--executable", $ServiceFilePath,
        "--working-directory", $WorkingDirectory,
        "--arguments-base64", $argumentsBase64,
        "--stdout-log", $StandardOutputLog,
        "--stderr-log", $StandardErrorLog,
        "--start-gate", $StartGatePath,
        "--start-token", $StartGateToken
    )
    Invoke-WithTemporaryProcessEnvironment -Environment $Environment -Action {
        Start-Process -FilePath $SupervisorPython `
            -ArgumentList (ConvertTo-DemoCommandLine -Arguments $supervisorArguments) `
            -WorkingDirectory (Split-Path -Parent $SupervisorScript) `
            -WindowStyle Hidden -PassThru
    }
}

function Open-DemoSupervisorGate {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$GatePath,
        [Parameter(Mandatory = $true)]
        [string]$Token,
        [Parameter(Mandatory = $true)]
        [string]$LogDirectory,
        [Parameter(Mandatory = $true)]
        [string]$LogsRoot
    )

    $parsedToken = [guid]::Empty
    if (-not [guid]::TryParse($Token, [ref]$parsedToken) -or
        $Token -ne $parsedToken.ToString("D")) {
        throw "The supervisor start token is invalid."
    }
    $sessionId = [guid]::Empty
    $sessionLeaf = Split-Path -Leaf $LogDirectory
    if (-not [guid]::TryParse($sessionLeaf, [ref]$sessionId) -or
        $sessionLeaf -ne $sessionId.ToString("D") -or
        (ConvertTo-NormalizedDemoPath (Split-Path -Parent $LogDirectory)) -ne
            (ConvertTo-NormalizedDemoPath $LogsRoot) -or
        (ConvertTo-NormalizedDemoPath (Split-Path -Parent $GatePath)) -ne
            (ConvertTo-NormalizedDemoPath $LogDirectory) -or
        (Split-Path -Leaf $GatePath) -notin $script:AllowedDemoControlNames) {
        throw "The supervisor start gate path is not authorized."
    }
    foreach ($path in @($LogsRoot, $LogDirectory)) {
        $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Supervisor start gates cannot use reparse-point directories."
        }
    }
    $temporaryPath = "$GatePath.tmp"
    foreach ($path in @($GatePath, $temporaryPath)) {
        if (Test-Path -LiteralPath $path) {
            throw "A supervisor start gate already exists."
        }
    }
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $Token,
            ([System.Text.Encoding]::ASCII)
        )
        [System.IO.File]::Move($temporaryPath, $GatePath)
    } finally {
        if ([System.IO.File]::Exists($temporaryPath)) {
            [System.IO.File]::Delete($temporaryPath)
        }
    }
}

function Invoke-DemoBoundedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$SupervisorPython,
        [Parameter(Mandatory = $true)]
        [string]$SupervisorScript,
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment,
        [Parameter(Mandatory = $true)]
        [string]$StandardOutputLog,
        [Parameter(Mandatory = $true)]
        [string]$StandardErrorLog,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)]
        [string]$StartGatePath,
        [Parameter(Mandatory = $true)]
        [string]$LogDirectory,
        [Parameter(Mandatory = $true)]
        [string]$LogsRoot,
        [Parameter(Mandatory = $true)]
        [scriptblock]$RegisterProcessAction,
        [Parameter(Mandatory = $true)]
        [scriptblock]$UnregisterProcessAction
    )

    $startGateToken = [guid]::NewGuid().ToString("D")
    $process = Start-DemoSupervisedProcess -SupervisorPython $SupervisorPython `
        -SupervisorScript $SupervisorScript -ServiceFilePath $FilePath `
        -ServiceArguments $ArgumentList -WorkingDirectory $WorkingDirectory `
        -Environment $Environment -StandardOutputLog $StandardOutputLog `
        -StandardErrorLog $StandardErrorLog -StartGatePath $StartGatePath `
        -StartGateToken $startGateToken
    $registered = $false
    $gateOpened = $false
    try {
        $knownProcessFact = [pscustomobject]@{
            ProcessId = [int]$process.Id
            ProcessName = "python"
            ExecutablePath = [System.IO.Path]::GetFullPath($SupervisorPython)
            StartTimeUtc = $process.StartTime.ToUniversalTime().ToString("o")
        }
    } catch {
        try {
            if (-not $process.HasExited) {
                $process.Kill()
            }
            [void]$process.WaitForExit(16000)
        } catch {
            # The start gate prevents an unrecorded service from launching.
        }
        throw "A bounded supervisor identity could not be captured."
    }
    try {
        try {
            $processFact = Get-DemoProcessFact -ProcessId ([int]$process.Id)
        } catch {
            $processFact = $knownProcessFact
        }
        if ($null -eq $processFact) {
            $processFact = $knownProcessFact
        }
        & $RegisterProcessAction $processFact
        $registered = $true
        Open-DemoSupervisorGate -GatePath $StartGatePath `
            -Token $startGateToken -LogDirectory $LogDirectory -LogsRoot $LogsRoot
        $gateOpened = $true

        $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
        $cleanupFailed = $false
        if ($timedOut) {
            try {
                if (-not $process.HasExited) {
                    $process.Kill()
                }
            } catch {
                $cleanupFailed = $true
            }
            if (-not $cleanupFailed -and -not $process.WaitForExit(3000)) {
                $cleanupFailed = $true
            }
        } else {
            $process.WaitForExit()
        }
        if (-not $cleanupFailed) {
            & $UnregisterProcessAction $processFact
            $registered = $false
        }
        return [pscustomobject]@{
            ExitCode = if ($timedOut) { -1 } else { [int]$process.ExitCode }
            TimedOut = $timedOut
            CleanupFailed = $cleanupFailed
            ProcessFact = $processFact
            StandardOutput = if (-not $cleanupFailed -and
                (Test-Path -LiteralPath $StandardOutputLog)) {
                Get-Content -LiteralPath $StandardOutputLog -Raw
            } else { "" }
            StandardError = if (-not $cleanupFailed -and
                (Test-Path -LiteralPath $StandardErrorLog)) {
                Get-Content -LiteralPath $StandardErrorLog -Raw
            } else { "" }
        }
    } catch {
        $originalError = $_
        $cleanupFailed = $false
        try {
            if (-not $process.HasExited) {
                $process.Kill()
            }
            $waitMilliseconds = if ($gateOpened) { 3000 } else { 16000 }
            if (-not $process.WaitForExit($waitMilliseconds)) {
                $cleanupFailed = $true
            }
        } catch {
            $cleanupFailed = $true
        }
        if ($registered -and -not $cleanupFailed) {
            & $UnregisterProcessAction $processFact
        }
        if ($cleanupFailed -and -not $registered) {
            & $RegisterProcessAction $knownProcessFact
        }
        throw $originalError
    }
}

function ConvertTo-DemoCommandLine {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$Arguments
    )

    @($Arguments | ForEach-Object {
            if ($_ -match '[\s"]') {
                '"' + $_.Replace('"', '\"') + '"'
            } else {
                $_
            }
        }) -join " "
}

function Invoke-DemoCapturedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment,
        [Parameter(Mandatory = $false)]
        [int]$TimeoutSeconds = 10
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = ConvertTo-DemoCommandLine -Arguments $ArgumentList
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($name in $Environment.Keys) {
        $startInfo.EnvironmentVariables[$name] = [string]$Environment[$name]
    }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "A bounded local command could not be started."
    }
    try {
        $knownProcessFact = [pscustomobject]@{
            ProcessId = [int]$process.Id
            ProcessName = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)
            ExecutablePath = [System.IO.Path]::GetFullPath($FilePath)
            StartTimeUtc = $process.StartTime.ToUniversalTime().ToString("o")
        }
    } catch {
        try {
            if (-not $process.HasExited) {
                $process.Kill()
                if (-not $process.WaitForExit(3000)) {
                    throw "cleanup did not complete"
                }
            }
        } catch {
            throw "A bounded command started but its identity and cleanup could not be verified."
        }
        throw "A bounded command started but its identity could not be captured."
    }
    try {
        $processFact = Get-DemoProcessFact -ProcessId ([int]$process.Id)
    } catch {
        $processFact = $knownProcessFact
    }
    if ($null -eq $processFact) {
        $processFact = $knownProcessFact
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    $cleanupFailed = $false
    if ($timedOut) {
        try {
            if (-not $process.HasExited) {
                $process.Kill()
            }
        } catch {
            $cleanupFailed = $true
        }
        if (-not $cleanupFailed -and -not $process.WaitForExit(3000)) {
            $cleanupFailed = $true
        }
    } else {
        $process.WaitForExit()
    }
    if ($cleanupFailed) {
        return [pscustomobject]@{
            ExitCode = -1
            TimedOut = $timedOut
            CleanupFailed = $true
            ProcessFact = $processFact
            Output = ""
            ErrorOutput = ""
        }
    }
    [pscustomobject]@{
        ExitCode = if ($timedOut) { -1 } else { [int]$process.ExitCode }
        TimedOut = $timedOut
        CleanupFailed = $false
        ProcessFact = $processFact
        Output = [string]$stdoutTask.GetAwaiter().GetResult()
        ErrorOutput = [string]$stderrTask.GetAwaiter().GetResult()
    }
}

function Wait-DemoOwnedListener {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [object]$LaunchRecord,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds,
        [Parameter(Mandatory = $false)]
        [scriptblock]$ListenerProvider,
        [Parameter(Mandatory = $false)]
        [scriptblock]$ProcessFactProvider,
        [Parameter(Mandatory = $false)]
        [scriptblock]$ParentProcessIdProvider
    )

    if ($null -eq $ListenerProvider) {
        $ListenerProvider = {
            param($targetPort)
            @(Get-DemoPortListeners -Port $targetPort)
        }
    }
    if ($null -eq $ProcessFactProvider) {
        $ProcessFactProvider = {
            param($targetProcessId)
            Get-DemoProcessFact -ProcessId $targetProcessId
        }
    }
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $launchFact = & $ProcessFactProvider ([int]$LaunchRecord.process_id)
        if (-not (Test-DemoProcessIdentity -Record $LaunchRecord `
                -ActualProcess $launchFact)) {
            throw "The launched process identity changed or exited before listener readiness."
        }
        $listeners = @(& $ListenerProvider $Port)
        if ($listeners.Count -gt 0) {
            if (@($listeners | Where-Object { $_.Address -ne "127.0.0.1" }).Count -gt 0) {
                throw "Service on port $Port opened a non-loopback listener."
            }
            $ownerIds = @($listeners | ForEach-Object { $_.ProcessId } | Select-Object -Unique)
            if ($ownerIds.Count -ne 1) {
                throw "Service on port $Port has ambiguous listener ownership."
            }
            $ownerId = [int]$ownerIds[0]
            $isOwned = Test-DemoProcessDescendant -ProcessId $ownerId `
                -AncestorRecord $LaunchRecord `
                -ParentProcessIdProvider $ParentProcessIdProvider `
                -ProcessFactProvider $ProcessFactProvider
            if (-not $isOwned) {
                throw "An unrelated process won port $Port during startup."
            }
            $ownerFact = & $ProcessFactProvider $ownerId
            if ($null -eq $ownerFact) {
                throw "The owned listener process exited before its identity was recorded."
            }
            $ownerRecord = [pscustomobject]@{
                process_id = [int]$ownerFact.ProcessId
                executable_path = [string]$ownerFact.ExecutablePath
                start_time_utc = [string]$ownerFact.StartTimeUtc
            }
            $finalListeners = @(& $ListenerProvider $Port)
            $finalFact = & $ProcessFactProvider $ownerId
            $finalListenerMatches = (
                $finalListeners.Count -gt 0 -and
                @($finalListeners | Where-Object {
                        $_.Address -ne "127.0.0.1" -or
                        [int]$_.ProcessId -ne $ownerId
                    }).Count -eq 0
            )
            if (-not $finalListenerMatches -or
                -not (Test-DemoProcessIdentity -Record $ownerRecord `
                    -ActualProcess $finalFact) -or
                -not (Test-DemoProcessDescendant -ProcessId $ownerId `
                    -AncestorRecord $LaunchRecord `
                    -ParentProcessIdProvider $ParentProcessIdProvider `
                    -ProcessFactProvider $ProcessFactProvider)) {
                throw "The owned listener identity changed before it was recorded."
            }
            return $finalFact
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the loopback listener on port $Port."
}

function Assert-DemoRecordedServiceIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Record
    )

    $expectedPorts = @{ ollama = 11434; backend = 8080; frontend = 8001 }
    $role = [string]$Record.role
    if (-not $expectedPorts.ContainsKey($role) -or
        [int]$Record.port -ne [int]$expectedPorts[$role]) {
        throw "The recorded service role or port is invalid."
    }
    $actual = Get-DemoProcessFact -ProcessId ([int]$Record.process_id)
    if (-not (Test-DemoProcessIdentity -Record $Record -ActualProcess $actual)) {
        throw "The recorded $($Record.role) process identity no longer matches."
    }
    $listeners = @(Get-DemoPortListeners -Port ([int]$Record.port))
    if ($listeners.Count -eq 0 -or
        @($listeners | Where-Object {
                $_.Address -ne "127.0.0.1" -or
                [int]$_.ProcessId -ne [int]$Record.process_id
            }).Count -gt 0) {
        throw "The recorded $($Record.role) listener identity no longer matches."
    }
    $ownerIds = @($listeners | ForEach-Object {
            [int]$_.ProcessId
        } | Select-Object -Unique)
    if ($ownerIds.Count -ne 1) {
        throw "The recorded $($Record.role) listener ownership is ambiguous."
    }
    $actual
}

function Assert-DemoOllamaServiceIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Record
    )

    if ([string]$Record.role -ne "ollama" -or [int]$Record.port -ne 11434) {
        throw "The recorded Ollama service role is invalid."
    }
    Assert-DemoRecordedServiceIdentity -Record $Record
}

function Assert-DemoChildServiceLink {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Record,
        [Parameter(Mandatory = $true)]
        [object]$State
    )

    if ($null -eq $Record.launcher_process_id) {
        return
    }
    $launcherRole = "$($Record.role)_launcher"
    $launcherRecord = @($State.processes | Where-Object {
            $_.role -eq $launcherRole -and
            [int]$_.process_id -eq [int]$Record.launcher_process_id
        }) | Select-Object -First 1
    if ($null -eq $launcherRecord -or
        -not (Test-DemoProcessDescendant `
            -ProcessId ([int]$Record.process_id) `
            -AncestorRecord $launcherRecord)) {
        throw "The recorded $($Record.role) child-service relationship no longer matches."
    }
}

function Wait-DemoHttpJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $watch = [Diagnostics.Stopwatch]::StartNew()
    $lastError = $null
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 `
                -ErrorAction Stop
            return [pscustomobject]@{
                HttpStatus = [int]$response.StatusCode
                Body = $response.Content | ConvertFrom-Json
            }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the local endpoint: $Url ($lastError)"
}

function Wait-DemoHttpStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $watch = [Diagnostics.Stopwatch]::StartNew()
    $lastError = $null
    while ($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 `
                -ErrorAction Stop
            return [int]$response.StatusCode
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the local page: $Url ($lastError)"
}

function Invoke-DemoOllamaCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$OllamaPath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $false)]
        [int]$TimeoutSeconds = 10
    )

    Invoke-DemoCapturedProcess -FilePath $OllamaPath -ArgumentList $Arguments `
        -Environment @{ OLLAMA_HOST = "127.0.0.1:11434" } `
        -TimeoutSeconds $TimeoutSeconds
}

function Invoke-DemoVerifiedModelUnload {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$OllamaRecord,
        [Parameter(Mandatory = $true)]
        [object]$State,
        [Parameter(Mandatory = $true)]
        [string]$OllamaPath,
        [Parameter(Mandatory = $true)]
        [string]$ModelName
    )

    if ((ConvertTo-NormalizedDemoPath $OllamaRecord.executable_path) -ne
        (ConvertTo-NormalizedDemoPath $OllamaPath)) {
        throw "The recorded Ollama executable does not match the installed executable."
    }
    [void](Assert-DemoOllamaServiceIdentity -Record $OllamaRecord)
    Assert-DemoChildServiceLink -Record $OllamaRecord -State $State
    $result = Invoke-DemoOllamaCommand -OllamaPath $OllamaPath `
        -Arguments @("stop", $ModelName)
    $succeeded = (
        -not $result.TimedOut -and -not $result.CleanupFailed -and
        $result.ExitCode -eq 0
    )
    [pscustomobject]@{
        Succeeded = $succeeded
        Reason = if ($succeeded) {
            "unloaded"
        } else {
            "bounded_command_failed"
        }
        CommandResult = $result
    }
}

function Test-DemoModelInstalledFromApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TagsBody,
        [Parameter(Mandatory = $false)]
        [string]$ModelName = "qwen3:8b"
    )

    @($TagsBody.models | Where-Object {
            $name = if ($null -ne $_.PSObject.Properties["name"]) {
                [string]$_.name
            } else { "" }
            $model = if ($null -ne $_.PSObject.Properties["model"]) {
                [string]$_.model
            } else { "" }
            $name -eq $ModelName -or $model -eq $ModelName
        }).Count -gt 0
}

function New-DemoProcessRecordFromFact {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$ProcessFact,
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

    New-DemoProcessRecord -Role $Role -ProcessId $ProcessFact.ProcessId `
        -StartTimeUtc $ProcessFact.StartTimeUtc `
        -ExecutablePath $ProcessFact.ExecutablePath -Port $Port `
        -CreatedByLauncher $CreatedByLauncher `
        -LauncherProcessId $LauncherProcessId `
        -StandardOutputLog $StandardOutputLog -StandardErrorLog $StandardErrorLog
}

function Write-DemoState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$State,
        [Parameter(Mandatory = $true)]
        [string]$StatePath
    )

    $parent = Split-Path -Parent $StatePath
    [void](New-Item -ItemType Directory -Path $parent -Force)
    $temporaryPath = "$StatePath.tmp"
    $backupPath = "$StatePath.bak"
    $json = $State | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText(
        $temporaryPath,
        $json,
        ([System.Text.UTF8Encoding]::new($false))
    )
    $backupOwnedForCleanup = $false
    try {
        if ([System.IO.File]::Exists($StatePath)) {
            if ([System.IO.Directory]::Exists($backupPath)) {
                throw "The launcher state backup path is unexpectedly a directory."
            }
            if ([System.IO.File]::Exists($backupPath)) {
                $backupAttributes = [System.IO.File]::GetAttributes($backupPath)
                if (($backupAttributes -band
                        [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "The launcher state backup path must not be a reparse point."
                }
                [System.IO.File]::Delete($backupPath)
            }
            $backupOwnedForCleanup = $true
            [System.IO.File]::Replace(
                $temporaryPath,
                $StatePath,
                $backupPath,
                $true
            )
        } else {
            [System.IO.File]::Move($temporaryPath, $StatePath)
        }
    } finally {
        if ([System.IO.File]::Exists($temporaryPath)) {
            [System.IO.File]::Delete($temporaryPath)
        }
        if ($backupOwnedForCleanup -and [System.IO.File]::Exists($backupPath)) {
            [System.IO.File]::Delete($backupPath)
        }
    }
}

function Remove-DemoClearedTransientProcessRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$State,
        [Parameter(Mandatory = $true)]
        [object]$Record,
        [Parameter(Mandatory = $true)]
        [object]$StopResult,
        [Parameter(Mandatory = $true)]
        [string]$StatePath
    )

    if ($Record.role -notin @("ollama_cli", "nvidia_smi", "warmup")) {
        return
    }
    if (-not $StopResult.Stopped -and $StopResult.Reason -notin @(
            "already_stopped", "identity_mismatch_or_absent"
        )) {
        return
    }

    $previousProcesses = @($State.processes)
    $matches = @($previousProcesses | Where-Object {
            $_.role -eq $Record.role -and
            [int]$_.process_id -eq [int]$Record.process_id -and
            [string]$_.start_time_utc -ceq [string]$Record.start_time_utc -and
            (ConvertTo-NormalizedDemoPath $_.executable_path) -eq
                (ConvertTo-NormalizedDemoPath $Record.executable_path)
        })
    if ($matches.Count -ne 1) {
        throw "The cleared transient helper does not have one exact state record."
    }

    try {
        $State.processes = @($previousProcesses | Where-Object {
                -not ($_.role -eq $Record.role -and
                    [int]$_.process_id -eq [int]$Record.process_id -and
                    [string]$_.start_time_utc -ceq [string]$Record.start_time_utc -and
                    (ConvertTo-NormalizedDemoPath $_.executable_path) -eq
                        (ConvertTo-NormalizedDemoPath $Record.executable_path))
            })
        Write-DemoState -State $State -StatePath $StatePath
    } catch {
        $State.processes = @($previousProcesses)
        throw
    }
}

function Test-DemoNonNegativeNumber {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [object]$Value
    )

    if ($null -eq $Value -or $Value -is [bool]) {
        return $false
    }
    $isNumber = (
        $Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64] -or
        $Value -is [single] -or $Value -is [double] -or
        $Value -is [decimal]
    )
    if (-not $isNumber) {
        return $false
    }
    $number = [double]$Value
    (-not [double]::IsNaN($number)) -and
        (-not [double]::IsInfinity($number)) -and $number -ge 0
}

function Test-DemoIntegerValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [object]$Value
    )

    if ($null -eq $Value -or $Value -is [bool]) {
        return $false
    }
    $Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int32] -or $Value -is [uint32] -or
        $Value -is [int64] -or $Value -is [uint64]
}

function Read-DemoState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$StatePath,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Layout
    )

    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        return $null
    }
    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    } catch {
        throw "The launcher state file is malformed and cannot authorize process changes."
    }
    $constants = Get-LocalDemoConstants
    if (-not (Test-DemoIntegerValue $state.schema_version) -or
        [int]$state.schema_version -ne $constants.RuntimeSchemaVersion -or
        [string]::IsNullOrWhiteSpace([string]$state.session_id) -or
        [string]::IsNullOrWhiteSpace([string]$state.status) -or
        [string]::IsNullOrWhiteSpace([string]$state.log_directory) -or
        $null -eq $state.processes) {
        throw "The launcher state file has an unsupported or incomplete schema."
    }
    $parsedSessionId = [guid]::Empty
    if (-not [guid]::TryParse([string]$state.session_id, [ref]$parsedSessionId) -or
        $state.status -notin @("starting", "ready") -or
        $state.browser_url -ne $constants.BrowserUrl -or
        $state.model_name -ne $constants.ModelName) {
        throw "The launcher state file has invalid session metadata."
    }
    $parsedCreatedAt = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse(
            [string]$state.created_at_utc,
            [ref]$parsedCreatedAt
        )) {
        throw "The launcher state file has an invalid startup timestamp."
    }
    if ($state.ollama_preexisting -isnot [bool] -or
        $state.model_preexisting_resident -isnot [bool] -or
        $state.model_loaded_by_launcher -isnot [bool] -or
        ($state.model_preexisting_resident -eq $true -and
            $state.model_loaded_by_launcher -eq $true) -or
        -not (Test-DemoIntegerValue $state.ports.ollama) -or
        -not (Test-DemoIntegerValue $state.ports.backend) -or
        -not (Test-DemoIntegerValue $state.ports.frontend) -or
        [int]$state.ports.ollama -ne 11434 -or
        [int]$state.ports.backend -ne 8080 -or
        [int]$state.ports.frontend -ne 8001) {
        throw "The launcher state file has invalid lifecycle metadata."
    }
    $expectedLogDirectory = Join-Path $Layout.LogsRoot ([string]$state.session_id)
    $normalizedLogDirectory = ConvertTo-NormalizedDemoPath $state.log_directory
    if ($normalizedLogDirectory -ne
        (ConvertTo-NormalizedDemoPath $expectedLogDirectory)) {
        throw "The launcher state log directory is outside the runtime root."
    }
    $normalizedLogDirectoryWithSeparator = $normalizedLogDirectory + "\"
    $rolePorts = @{
        ollama = 11434
        ollama_launcher = 11434
        ollama_cli = 0
        nvidia_smi = 0
        warmup = 0
        backend = 8080
        backend_launcher = 8080
        frontend = 8001
        frontend_launcher = 8001
    }
    $seenRoles = @{}
    $seenProcessIds = @{}
    $recordsByRole = @{}
    foreach ($record in @($state.processes)) {
        if ([string]::IsNullOrWhiteSpace([string]$record.role) -or
            -not (Test-DemoIntegerValue $record.process_id) -or
            [int]$record.process_id -le 0 -or
            [string]::IsNullOrWhiteSpace([string]$record.start_time_utc) -or
            [string]::IsNullOrWhiteSpace([string]$record.executable_path) -or
            -not (Test-DemoIntegerValue $record.port) -or
            [int]$record.port -lt 0 -or
            $record.address -ne "127.0.0.1" -or
            $record.created_by_launcher -isnot [bool] -or
            ($null -ne $record.launcher_process_id -and
                (-not (Test-DemoIntegerValue $record.launcher_process_id) -or
                    [int]$record.launcher_process_id -le 0))) {
            throw "The launcher state file contains an invalid process identity."
        }
        $role = [string]$record.role
        if (-not $rolePorts.ContainsKey($role) -or
            [int]$record.port -ne [int]$rolePorts[$role] -or
            $seenRoles.ContainsKey($role) -or
            $seenProcessIds.ContainsKey([string]$record.process_id)) {
            throw "The launcher state file contains conflicting process authorization."
        }
        $seenRoles[$role] = $true
        $recordsByRole[$role] = $record
        $seenProcessIds[[string]$record.process_id] = $true
        if ($record.created_by_launcher -eq $false -and $role -ne "ollama") {
            throw "Only a verified Ollama service may be recorded as pre-existing."
        }
        if (-not [System.IO.Path]::IsPathRooted([string]$record.executable_path)) {
            throw "A launcher process executable path is not absolute."
        }
        $executableName = [System.IO.Path]::GetFileName(
            [string]$record.executable_path
        ).ToLowerInvariant()
        $validExecutable = switch ($role) {
            "ollama" { $executableName -eq "ollama.exe"; break }
            "ollama_launcher" {
                (ConvertTo-NormalizedDemoPath $record.executable_path) -eq
                    (ConvertTo-NormalizedDemoPath $Layout.BackendSupervisorPython)
                break
            }
            "ollama_cli" { $executableName -eq "ollama.exe"; break }
            "nvidia_smi" { $executableName -eq "nvidia-smi.exe"; break }
            "warmup" {
                (ConvertTo-NormalizedDemoPath $record.executable_path) -eq
                    (ConvertTo-NormalizedDemoPath $Layout.BackendSupervisorPython)
                break
            }
            "backend_launcher" {
                (ConvertTo-NormalizedDemoPath $record.executable_path) -eq
                    (ConvertTo-NormalizedDemoPath $Layout.BackendSupervisorPython)
                break
            }
            "backend" {
                (ConvertTo-NormalizedDemoPath $record.executable_path) -in @(
                    (ConvertTo-NormalizedDemoPath $Layout.BackendUvicorn),
                    (ConvertTo-NormalizedDemoPath $Layout.BackendPython)
                ) -or (
                    $null -ne $record.launcher_process_id -and
                    $executableName -eq "python.exe"
                )
                break
            }
            "frontend_launcher" {
                (ConvertTo-NormalizedDemoPath $record.executable_path) -eq
                    (ConvertTo-NormalizedDemoPath $Layout.BackendSupervisorPython)
                break
            }
            "frontend" {
                (ConvertTo-NormalizedDemoPath $record.executable_path) -eq
                    (ConvertTo-NormalizedDemoPath $Layout.BackendPython) -or (
                    $null -ne $record.launcher_process_id -and
                    $executableName -eq "python.exe"
                )
                break
            }
            default { $false }
        }
        if (-not $validExecutable) {
            throw "The launcher state contains an unauthorized executable for role $role."
        }
        $parsedStart = [DateTimeOffset]::MinValue
        if (-not [DateTimeOffset]::TryParse(
                [string]$record.start_time_utc,
                [ref]$parsedStart
            )) {
            throw "The launcher state contains an invalid process start timestamp."
        }
        foreach ($logPath in @($record.stdout_log, $record.stderr_log)) {
            if ([string]::IsNullOrWhiteSpace([string]$logPath)) {
                continue
            }
            $normalizedLog = ConvertTo-NormalizedDemoPath $logPath
            if (-not ($normalizedLog + "\").StartsWith(
                    $normalizedLogDirectoryWithSeparator
                )) {
                throw "A launcher process log path is outside the session log directory."
            }
        }
    }
    foreach ($record in @($state.processes)) {
        $role = [string]$record.role
        $isLauncherRole = $role -in @(
            "ollama_launcher", "backend_launcher", "frontend_launcher", "warmup",
            "ollama_cli", "nvidia_smi"
        )
        if ($isLauncherRole -and $null -ne $record.launcher_process_id) {
            throw "A launcher record cannot itself have a launcher-process link."
        }
        if ($null -eq $record.launcher_process_id) {
            continue
        }
        if ($role -notin @("ollama", "backend", "frontend") -or
            $record.created_by_launcher -ne $true) {
            throw "The launcher state contains an invalid child-service link."
        }
        $launcherRole = "${role}_launcher"
        if (-not $recordsByRole.ContainsKey($launcherRole) -or
            [int]$recordsByRole[$launcherRole].process_id -ne
                [int]$record.launcher_process_id -or
            $recordsByRole[$launcherRole].created_by_launcher -ne $true) {
            throw "The launcher state contains an unmatched child-service link."
        }
    }
    $ollamaRecord = @($state.processes | Where-Object {
            $_.role -eq "ollama"
        }) | Select-Object -First 1
    if ($state.ollama_preexisting -eq $true -and
        ($null -eq $ollamaRecord -or $ollamaRecord.created_by_launcher -ne $false)) {
        throw "The launcher state has inconsistent pre-existing Ollama metadata."
    }
    if ($null -ne $ollamaRecord -and $state.ollama_preexisting -eq $false -and
        $ollamaRecord.created_by_launcher -ne $true) {
        throw "The launcher state has inconsistent Ollama ownership metadata."
    }
    if ($state.status -eq "ready" -and
        (-not $seenRoles.ContainsKey("frontend") -or
            -not $seenRoles.ContainsKey("backend") -or
            -not $seenRoles.ContainsKey("ollama"))) {
        throw "A ready launcher state is missing a required service role."
    }
    if ($state.status -eq "ready") {
        $parsedReadyAt = [DateTimeOffset]::MinValue
        $readyMetadataValid = (
            [DateTimeOffset]::TryParse(
                [string]$state.ready_at_utc,
                [ref]$parsedReadyAt
            ) -and
            (Test-DemoNonNegativeNumber $state.startup_seconds) -and
            (Test-DemoNonNegativeNumber $state.warmup_seconds) -and
            (Test-DemoNonNegativeNumber $state.gpu_vram_used_mib) -and
            $state.gpu_allocation -eq "100% GPU" -and
            ($state.model_preexisting_resident -eq $true -or
                $state.model_loaded_by_launcher -eq $true) -and
            $parsedReadyAt -ge $parsedCreatedAt
        )
        if (-not $readyMetadataValid) {
            throw "A ready launcher state has invalid readiness metadata."
        }
    }
    $state
}

function Enter-DemoLifecycleLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LockPath
    )

    $parent = Split-Path -Parent $LockPath
    [void](New-Item -ItemType Directory -Path $parent -Force)
    try {
        [System.IO.File]::Open(
            $LockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    } catch {
        throw "Another local demo start/stop operation is already running."
    }
}

function Get-DemoActualProcessMap {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Records
    )

    $map = @{}
    foreach ($record in $Records) {
        $key = [string]$record.process_id
        if (-not $map.ContainsKey($key)) {
            $map[$key] = Get-DemoProcessFact -ProcessId ([int]$record.process_id)
        }
    }
    $map
}

function Stop-DemoOwnedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Record,
        [Parameter(Mandatory = $false)]
        [int]$GraceSeconds = 3
    )

    if ($Record.created_by_launcher -ne $true) {
        return [pscustomobject]@{ Stopped = $false; Reason = "preexisting" }
    }
    $actual = Get-DemoProcessFact -ProcessId ([int]$Record.process_id)
    if (-not (Test-DemoProcessIdentity -Record $Record -ActualProcess $actual)) {
        return [pscustomobject]@{ Stopped = $false; Reason = "identity_mismatch_or_absent" }
    }
    $process = Get-Process -Id ([int]$Record.process_id) -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        return [pscustomobject]@{ Stopped = $false; Reason = "already_stopped" }
    }
    try {
        [void]$process.CloseMainWindow()
        if ($process.WaitForExit($GraceSeconds * 1000)) {
            return [pscustomobject]@{ Stopped = $true; Reason = "graceful" }
        }
    } catch {
        if ($null -eq (Get-DemoProcessFact -ProcessId ([int]$Record.process_id))) {
            return [pscustomobject]@{ Stopped = $true; Reason = "already_stopped" }
        }
    }
    $actualBeforeNormalStop = Get-DemoProcessFact -ProcessId ([int]$Record.process_id)
    if (-not (Test-DemoProcessIdentity -Record $Record `
            -ActualProcess $actualBeforeNormalStop)) {
        return [pscustomobject]@{
            Stopped = $false
            Reason = "identity_changed_before_normal_stop"
        }
    }
    Stop-Process -Id ([int]$Record.process_id) -ErrorAction SilentlyContinue
    try {
        if ($process.WaitForExit($GraceSeconds * 1000)) {
            return [pscustomobject]@{ Stopped = $true; Reason = "normal_stop" }
        }
    } catch {
        if ($null -eq (Get-DemoProcessFact -ProcessId ([int]$Record.process_id))) {
            return [pscustomobject]@{ Stopped = $true; Reason = "normal_stop" }
        }
    }

    $actualBeforeForce = Get-DemoProcessFact -ProcessId ([int]$Record.process_id)
    if (-not (Test-DemoProcessIdentity -Record $Record -ActualProcess $actualBeforeForce)) {
        return [pscustomobject]@{ Stopped = $false; Reason = "identity_changed_before_force" }
    }
    Stop-Process -Id ([int]$Record.process_id) -Force -ErrorAction SilentlyContinue
    try {
        $process.WaitForExit($GraceSeconds * 1000) | Out-Null
    } catch {
        # The final identity check below determines whether termination succeeded.
    }
    $remaining = Get-DemoProcessFact -ProcessId ([int]$Record.process_id)
    [pscustomobject]@{
        Stopped = ($null -eq $remaining)
        Reason = if ($null -eq $remaining) { "forced" } else { "force_failed" }
    }
}

function Limit-DemoLogFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $false)]
        [int]$MaximumBytes = 1048576
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }
    $item = Get-Item -LiteralPath $Path
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to truncate a reparse-point log file."
    }
    if ($item.Length -le $MaximumBytes) {
        return
    }
    $source = [System.IO.File]::OpenRead($Path)
    try {
        [void]$source.Seek(-$MaximumBytes, [System.IO.SeekOrigin]::End)
        $buffer = New-Object byte[] $MaximumBytes
        $read = $source.Read($buffer, 0, $MaximumBytes)
    } finally {
        $source.Dispose()
    }
    $temporaryPath = "$Path.trim"
    [System.IO.File]::WriteAllBytes($temporaryPath, $buffer[0..($read - 1)])
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Limit-DemoSessionLogs {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LogDirectory,
        [Parameter(Mandatory = $true)]
        [string]$LogsRoot
    )

    $sessionId = [guid]::Empty
    $sessionLeaf = Split-Path -Leaf $LogDirectory
    if (-not [guid]::TryParse($sessionLeaf, [ref]$sessionId) -or
        $sessionLeaf -ne $sessionId.ToString("D")) {
        throw "Refusing to access a non-session log directory."
    }
    $normalizedRoot = (ConvertTo-NormalizedDemoPath $LogsRoot) + "\"
    $normalizedDirectory = (ConvertTo-NormalizedDemoPath $LogDirectory) + "\"
    if (-not $normalizedDirectory.StartsWith($normalizedRoot)) {
        throw "Refusing to access logs outside the launcher runtime root."
    }
    if (-not (Test-Path -LiteralPath $LogDirectory -PathType Container)) {
        return
    }
    $rootItem = Get-Item -LiteralPath $LogsRoot -ErrorAction Stop
    $directoryItem = Get-Item -LiteralPath $LogDirectory -ErrorAction Stop
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to access a reparse-point log directory."
    }
    foreach ($name in $script:AllowedDemoLogNames) {
        $path = Join-Path $LogDirectory $name
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            Limit-DemoLogFile -Path $path
        }
    }
    foreach ($name in $script:AllowedDemoControlNames) {
        $path = Join-Path $LogDirectory $name
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to remove a reparse-point supervisor gate."
            }
            Remove-Item -LiteralPath $path -Force
        }
    }
}

function Remove-OldDemoLogSessions {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LogsRoot,
        [Parameter(Mandatory = $false)]
        [int]$Retain = 5,
        [Parameter(Mandatory = $false)]
        [string]$ActiveDirectory
    )

    if (-not (Test-Path -LiteralPath $LogsRoot -PathType Container)) {
        return
    }
    $rootItem = Get-Item -LiteralPath $LogsRoot -ErrorAction Stop
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to remove logs through a reparse-point root."
    }
    $normalizedRoot = (ConvertTo-NormalizedDemoPath $LogsRoot) + "\"
    $directories = @(Get-ChildItem -LiteralPath $LogsRoot -Directory |
            Sort-Object LastWriteTimeUtc -Descending)
    $kept = 0
    foreach ($directory in $directories) {
        if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to remove a reparse-point log directory."
        }
        $sessionId = [guid]::Empty
        if (-not [guid]::TryParse($directory.Name, [ref]$sessionId) -or
            $directory.Name -ne $sessionId.ToString("D")) {
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace($ActiveDirectory) -and
            (ConvertTo-NormalizedDemoPath $directory.FullName) -eq
            (ConvertTo-NormalizedDemoPath $ActiveDirectory)) {
            continue
        }
        $kept += 1
        if ($kept -le $Retain) {
            continue
        }
        $normalized = (ConvertTo-NormalizedDemoPath $directory.FullName) + "\"
        if (-not $normalized.StartsWith($normalizedRoot)) {
            throw "Refusing to remove a log directory outside the launcher runtime root."
        }
        $children = @(Get-ChildItem -LiteralPath $directory.FullName -Force)
        foreach ($child in $children) {
            if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to remove a log session containing a reparse point."
            }
            $allowedNames = @($script:AllowedDemoLogNames) +
                @($script:AllowedDemoControlNames)
            if ($child.PSIsContainer -or $child.Name -notin $allowedNames) {
                continue
            }
            Remove-Item -LiteralPath $child.FullName -Force
        }
        if (@(Get-ChildItem -LiteralPath $directory.FullName -Force).Count -eq 0) {
            Remove-Item -LiteralPath $directory.FullName -Force
        }
    }
}

function Open-DemoBrowser {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    Start-Process $Url | Out-Null
}

Export-ModuleMember -Function @(
    "Get-DemoPowerShellInfo",
    "Resolve-DemoExecutable",
    "Assert-DemoRuntimePathSafety",
    "Initialize-DemoRuntime",
    "Invoke-DemoGit",
    "Assert-DemoRepositoryCheckpoints",
    "Get-DemoOllamaManifestPath",
    "Get-DemoGpuControllers",
    "Invoke-DemoNvidiaSmi",
    "Get-DemoProcessFact",
    "ConvertFrom-DemoNetstatRows",
    "Get-DemoPortListeners",
    "Get-DemoOllamaProcessFacts",
    "Get-DemoParentProcessId",
    "Test-DemoProcessDescendant",
    "Start-DemoSupervisedProcess",
    "Open-DemoSupervisorGate",
    "Invoke-DemoBoundedProcess",
    "ConvertTo-DemoCommandLine",
    "Invoke-DemoCapturedProcess",
    "Wait-DemoOwnedListener",
    "Assert-DemoRecordedServiceIdentity",
    "Assert-DemoOllamaServiceIdentity",
    "Assert-DemoChildServiceLink",
    "Wait-DemoHttpJson",
    "Wait-DemoHttpStatus",
    "Invoke-DemoOllamaCommand",
    "Invoke-DemoVerifiedModelUnload",
    "Test-DemoModelInstalledFromApi",
    "New-DemoProcessRecordFromFact",
    "Write-DemoState",
    "Remove-DemoClearedTransientProcessRecord",
    "Read-DemoState",
    "Enter-DemoLifecycleLock",
    "Get-DemoActualProcessMap",
    "Stop-DemoOwnedProcess",
    "Limit-DemoLogFile",
    "Limit-DemoSessionLogs",
    "Remove-OldDemoLogSessions",
    "Open-DemoBrowser"
)
