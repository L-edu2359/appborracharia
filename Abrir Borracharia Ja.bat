@echo off
rem Dê dois cliques neste arquivo para abrir o app com o login funcionando.
rem Ele liga o servidor local e abre o navegador em http://localhost:5500
rem Deixe a janela preta aberta enquanto usa o app.
title Borracharia Ja - servidor local
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)
node server.js --open
pause
