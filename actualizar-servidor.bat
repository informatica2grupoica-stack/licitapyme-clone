@echo off
chcp 65001 >nul
REM ============================================================
REM  Actualizar LicitaPyme en el notebook-servidor.
REM  Doble clic: trae el ultimo codigo de GitHub y reconstruye Docker.
REM  El %~dp0 hace que funcione sin importar donde este la carpeta.
REM ============================================================
cd /d "%~dp0"

echo ============================================================
echo   ACTUALIZANDO LICITAPYME (servidor)
echo ============================================================
echo.

echo [1/3] Trayendo ultimos cambios de GitHub...
git pull
if errorlevel 1 goto :error
echo.

echo [2/3] Reconstruyendo y levantando Docker (puede tardar varios minutos)...
docker compose up -d --build
if errorlevel 1 goto :error
echo.

echo [3/3] Estado de los contenedores:
docker compose ps
echo.

echo Buscando el link publico (esperando a cloudflared)...
timeout /t 8 /nobreak >nul
docker compose logs --tail=40 cloudflared | findstr /I "trycloudflare.com"
echo.

echo ============================================================
echo   LISTO. Si no aparece el link arriba, ejecuta:
echo   docker compose logs cloudflared ^| findstr trycloudflare
echo ============================================================
pause
exit /b 0

:error
echo.
echo *** OCURRIO UN ERROR. Revisa el mensaje de arriba. ***
echo *** (Docker Desktop encendido? Sesion de GitHub iniciada?) ***
pause
exit /b 1
