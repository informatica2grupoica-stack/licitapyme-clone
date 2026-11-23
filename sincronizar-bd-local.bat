@echo off
rem Refresca la base LOCAL (Docker, puerto 3308) con los datos de PRODUCCION (tunel SSH, puerto 3307).
rem Solo LEE de produccion; solo escribe en el Docker local. Requiere: Docker corriendo y el tunel SSH abierto.
rem   sincronizar-bd-local.bat          -> sin documentos_cache ni tablas *_captura (rapido)
rem   sincronizar-bd-local.bat --todo   -> todo (~1,3 GB, mas lento)
cd /d "%~dp0"
node scripts\sincronizar-bd-local.mjs %*
echo.
pause
