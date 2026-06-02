[CmdletBinding()]
param(
    [switch]$Full
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Python = if ($env:PRTS_MCP_PYTHON) {
    $env:PRTS_MCP_PYTHON
} else {
    "E:\Anaconda3\envs\python311\python.exe"
}
$PythonSrc = Join-Path $RepoRoot "python\src"
$PythonVenv = Join-Path $RepoRoot "python\.venv\bin\python.exe"
$TsDir = Join-Path $RepoRoot "ts"

$Failures = 0
$Warnings = 0

function Invoke-Required {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Script
    )

    Write-Host ""
    Write-Host "== $Name =="
    try {
        & $Script
        Write-Host "[OK] $Name"
    } catch {
        $script:Failures += 1
        Write-Host "[FAIL] $Name"
        Write-Host $_.Exception.Message
    }
}

function Invoke-Warning {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )

    $script:Warnings += 1
    Write-Host "[WARN] $Message"
}

Write-Host "Repo root: $RepoRoot"
Write-Host "Python: $Python"

Invoke-Required "PowerShell 7+" {
    $version = $PSVersionTable.PSVersion
    Write-Host "PowerShell $version"
    if ($version.Major -lt 7) {
        throw "Use C:\Program Files\PowerShell\7\pwsh.exe for this repo."
    }
}

Invoke-Required "Python runtime" {
    if (-not (Test-Path -LiteralPath $Python)) {
        throw "Missing Python interpreter: $Python"
    }

    $probe = @'
import importlib.metadata as md
import sys

import mcp
import pydantic
import pytest

print(sys.executable)
print(sys.version.split()[0])
print("mcp=" + md.version("mcp"))
print("pydantic=" + md.version("pydantic"))
print("pytest=" + md.version("pytest"))
'@
    & $Python -c $probe
}

Invoke-Required "Python local source import" {
    $oldPythonPath = $env:PYTHONPATH
    try {
        $env:PYTHONPATH = $PythonSrc
        & $Python -c "from prts_mcp.server import main; print('prts_mcp.server import ok')"
    } finally {
        $env:PYTHONPATH = $oldPythonPath
    }
}

if (Test-Path -LiteralPath $PythonVenv) {
    $venvProbe = & $PythonVenv -c "import importlib.util as u; print(u.find_spec('mcp'))"
    if ($venvProbe -eq "None") {
        Invoke-Warning "python\.venv exists but lacks mcp; use $Python instead."
    }
}

Invoke-Required "Node runtime" {
    $nodeVersion = & node -v
    Write-Host "node=$nodeVersion"
    if ($nodeVersion -notmatch '^v(\d+)\.') {
        throw "Could not parse Node version: $nodeVersion"
    }
    if ([int]$Matches[1] -lt 22) {
        throw "Node >=22 is required by ts/package.json."
    }
}

Invoke-Required "npm PowerShell-safe shim" {
    $npmCmd = Get-Command npm.cmd -ErrorAction Stop
    Write-Host "npm.cmd=$($npmCmd.Source)"
    & npm.cmd -v

    $bareNpm = Get-Command npm -ErrorAction SilentlyContinue
    if ($bareNpm -and $bareNpm.Source -like "*.ps1") {
        Invoke-Warning "bare npm resolves to $($bareNpm.Source); prefer npm.cmd in PowerShell."
    }
}

Invoke-Required "TypeScript dependencies" {
    $tsc = Join-Path $TsDir "node_modules\typescript\bin\tsc"
    $tsx = Join-Path $TsDir "node_modules\tsx\dist\cli.mjs"
    if (-not (Test-Path -LiteralPath $tsc)) {
        throw "Missing TypeScript dependency tree. Run npm.cmd ci in ts\ if dependencies need reinstalling."
    }
    if (-not (Test-Path -LiteralPath $tsx)) {
        throw "Missing tsx dependency tree. Run npm.cmd ci in ts\ if dependencies need reinstalling."
    }
    Write-Host "typescript and tsx are installed under ts\node_modules"
}

if ($Full) {
    Invoke-Required "Python tests" {
        Push-Location (Join-Path $RepoRoot "python")
        try {
            & $Python -m pytest tests -q
        } finally {
            Pop-Location
        }
    }

    Invoke-Required "TypeScript tests" {
        Push-Location $TsDir
        try {
            & npm.cmd test
        } finally {
            Pop-Location
        }
    }

    Invoke-Required "TypeScript typecheck" {
        Push-Location $TsDir
        try {
            & npm.cmd run typecheck
        } finally {
            Pop-Location
        }
    }
}

Write-Host ""
Write-Host "Runtime check complete: $Failures failure(s), $Warnings warning(s)."
if ($Failures -gt 0) {
    exit 1
}

