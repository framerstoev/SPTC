#requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/LocalDemo.Core.psm1') -Force -ArgumentList v3-dev
Import-Module (Join-Path $PSScriptRoot 'lib/LocalDemo.Windows.psm1') -Force -ArgumentList v3-dev
Write-V3DevStatus -Layout (Get-LocalDemoLayout -ScriptRoot $PSScriptRoot)
