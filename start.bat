@echo off
title Jade Pebble Workspace
setlocal
cd /d "%~dp0"

set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
set "URL=http://127.0.0.1:4173"
set "OLLAMA_URL=http://127.0.0.1:11434"

rem ── 1. Ollama (local AI). Start it only if it is not already answering. ──
curl -s -o nul -m 2 "%OLLAMA_URL%/api/version" >nul 2>&1
if errorlevel 1 (
  if exist "%OLLAMA_EXE%" (
    echo [1/2] Starting Ollama...
    start "Ollama" /min "%OLLAMA_EXE%" serve
    for /l %%i in (1,1,30) do (
      ping -n 2 127.0.0.1 >nul
      curl -s -o nul -m 2 "%OLLAMA_URL%/api/version" >nul 2>&1
      if not errorlevel 1 goto ollamaUp
    )
    echo       Ollama did not start, AI agents will show as unreachable.
  ) else (
    echo [1/2] Ollama not found; install it or set OLLAMA_EXE in this file.
  )
) else (
  echo [1/2] Ollama already running.
)
:ollamaUp

rem ── 2. The Jade Pebble server. Start only if port 4173 is quiet. ──
curl -s -o nul -m 2 "%URL%/api/health" >nul 2>&1
if errorlevel 1 (
  echo [2/2] Starting Jade Pebble server...
  start "Jade Pebble" /min cmd /c "node src\server\index.js"
  for /l %%i in (1,1,20) do (
    ping -n 2 127.0.0.1 >nul
    curl -s -o nul -m 2 "%URL%/api/health" >nul 2>&1
    if not errorlevel 1 goto serverUp
  )
  echo       Server did not start. Check that Node.js 22+ is installed.
) else (
  echo [2/2] Jade Pebble server already running.
)
:serverUp

echo.
echo  Jade Pebble is ready:  %URL%
start "" "%URL%"
ping -n 5 127.0.0.1 >nul
