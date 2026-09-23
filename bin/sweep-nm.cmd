@echo off
rem sweep-nm 启动器 (Windows): 挑选运行时 (Bun 优先, 其次 Node) 后启动真实入口。
rem 与 sh 启动器 (bin/sweep-nm) 同逻辑; 未经 Windows 真机验证 (证据缺口)。
rem 分支结构全程只用单行 if 判定 (不用标签与括号块), 与 sh 启动器一一对应。
setlocal
set "ROOT=%~dp0.."
set "ENTRY=%ROOT%\src\cli.ts"
set "RUNNER="

where bun >nul 2>nul
if not errorlevel 1 set "RUNNER=bun"
if not defined RUNNER where node >nul 2>nul
if not defined RUNNER if not errorlevel 1 set "RUNNER=node"

if not defined RUNNER echo sweep-nm: 未找到 bun 或 node, 请至少安装其一 1>&2
if not defined RUNNER exit /b 1

"%RUNNER%" "%ENTRY%" %*
exit /b %errorlevel%
