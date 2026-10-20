@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title SIGIE - Instalador y lanzador (Windows)
cd /d "%~dp0"

echo =========================================================
echo   SIGIE - Sistema de Gestion de Inventario Escolar
echo   Instalador / lanzador para Windows
echo =========================================================
echo.
echo Carpeta del sistema:
echo   %cd%
echo.

REM ---------------------------------------------------------------
REM 1) Verificar si Node.js ya esta instalado
REM ---------------------------------------------------------------
where node >nul 2>nul
if %errorlevel% NEQ 0 goto :sinnode
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
node -e "var v=process.versions.node.split('.');process.exit((v[0]>22||(v[0]==22&&v[1]>=13))?0:1)" >nul 2>nul
if %errorlevel%==0 (
    echo [OK] Node.js detectado ^(version !NODE_VER!^).
    goto :arrancar
)
echo [!] Tu Node.js ^(version !NODE_VER!^) es antiguo. SIGIE necesita Node.js 22.13 o
echo     superior, que trae incluida la base de datos SQLite.
goto :instalar

:sinnode
echo [!] No se detecto Node.js en esta computadora.
:instalar
echo     Node.js es necesario para correr el servidor local del sistema
echo     ^(la parte que guarda la base de datos en esta misma carpeta^).
echo.

REM ---------------------------------------------------------------
REM 2) Intentar instalar Node.js automaticamente con winget
REM    (winget viene incluido en Windows 10/11 actualizados; si el
REM     equipo no lo tiene, se pasa directo a la instalacion manual)
REM ---------------------------------------------------------------
where winget >nul 2>nul
if %errorlevel% NEQ 0 goto :manual

echo Se instalara Node.js automaticamente con winget ^(Instalador de
echo aplicaciones de Windows^). Puede pedir permisos de administrador
echo y tardar uno o dos minutos. Requiere conexion a internet.
echo.
pause

winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if %errorlevel% NEQ 0 (
    echo.
    echo [!] winget no pudo completar la instalacion automatica.
    goto :manual
)

echo.
echo =========================================================
echo  Node.js se instalo correctamente.
echo  IMPORTANTE: cierra esta ventana y vuelve a hacer doble
echo  clic en este mismo archivo para continuar.
echo =========================================================
pause
exit /b 0

:manual
echo.
echo =========================================================
echo  Vamos a abrir la pagina oficial de descarga de Node.js.
echo    1. Descarga e instala la version "LTS" para Windows
echo       ^(dejar todas las opciones del instalador por defecto^).
echo    2. Cuando termine la instalacion, vuelve a ejecutar
echo       este mismo archivo (Iniciar_SIGIE_Windows.bat).
echo =========================================================
start "" "https://nodejs.org/es/download"
pause
exit /b 1

REM ---------------------------------------------------------------
REM 3) Arrancar el servidor local y abrir el navegador
REM    (no hace falta "npm install": server.js usa solo modulos de Node.js)
REM ---------------------------------------------------------------
:arrancar
if not exist "server.js" (
    echo [ERROR] No se encontro server.js en esta carpeta.
    echo         Asegurate de ejecutar este archivo desde la carpeta
    echo         completa del sistema SIGIE ^(la que tiene index.html,
    echo         core.js, app.js, server.js, etc. todos juntos^).
    pause
    exit /b 1
)

if not exist "data" mkdir "data"

echo.
echo Iniciando el servidor local de SIGIE...
echo La base de datos se guardara en:
echo   %cd%\data\sigie.db  ^(base de datos SQLite^)
echo.
echo Se abrira una ventana negra: es el servidor corriendo. NO la
echo cierres mientras uses el sistema. Cuando termines de usar SIGIE,
echo puedes cerrarla (o simplemente apagar la computadora).
echo.

start "SIGIE - Servidor (no cerrar mientras uses el sistema)" cmd /k node server.js
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/"

echo Listo. El sistema deberia abrirse solo en tu navegador.
echo Si no se abrio automaticamente, entra manualmente a:
echo   http://localhost:3000/
echo.
pause
exit /b 0
