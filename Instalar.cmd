@echo off
rem WS Monitor - cria o atalho na area de trabalho e abre o app pela primeira vez.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\Instalar-Atalho.ps1"
if errorlevel 1 (
  echo.
  echo Falha ao criar o atalho.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launcher\WS-Monitor.ps1"
