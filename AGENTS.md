# Codex Instructions for PRTS-MCP

This file is intentionally repo-local so a fresh Codex session starts with the
known-good runtime on this Windows workstation.

## Startup Reads

- Read `CLAUDE.md` and `docs/dev/STYLE.md` before non-trivial code changes.
- Use `STATUS.md` for current project shape and version state.
- Use `ROADMAP.md` / `ROADMAP.zh-CN.md` when planning feature work.

## Runtime Environment

- Shell: prefer `C:\Program Files\PowerShell\7\pwsh.exe` with UTF-8 output.
- Python: use `E:\Anaconda3\envs\python311\python.exe` for this repo.
- Do not use ambient `python` from PATH for validation. On this machine it
  resolves to MSYS/WindowsApps before the intended conda environment.
- Do not use `python\.venv` for Python MCP tests. It was created from MSYS
  Python 3.12 and currently lacks the real `mcp` runtime dependency.
- For local-source Python imports, set `PYTHONPATH` to
  `F:\2026-Spring\PRTS-MCP\python\src`.
- Node: use the Volta Node image already selected by `ts/package.json`
  (`node` currently resolves to Node 24.14.0; project requires Node >=22).
- In PowerShell, use `npm.cmd` / `npx.cmd` instead of bare `npm` / `npx`.
  Bare commands resolve to Volta-generated `.ps1` shims first on this host, and
  those shims can fail while the `.cmd` shims work.

## Quick Verification

Run the repo-local environment audit first when a session starts or when command
behavior looks suspicious:

```powershell
.\scripts\check-runtime.ps1
```

Run the full validation set before merging runtime-sensitive changes:

```powershell
.\scripts\check-runtime.ps1 -Full
```

Equivalent manual commands:

```powershell
Push-Location python
& 'E:\Anaconda3\envs\python311\python.exe' -m pytest tests -q
Pop-Location

Push-Location ts
npm.cmd test
npm.cmd run typecheck
Pop-Location
```
