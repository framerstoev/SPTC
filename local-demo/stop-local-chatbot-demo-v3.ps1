#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateRange(1, 10)]
    [int]$GraceSeconds = 3
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# The unload closure must resolve the shared script's private cleanup helper.
. (Join-Path $PSScriptRoot "stop-local-chatbot-demo.ps1") `
    -LauncherProfile v3 @PSBoundParameters
