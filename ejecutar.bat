@echo off
chcp 65001 >nul
title Frutix - Lanzador Local
cd /d "%~dp0"

echo ============================================================
echo    FRUTIX - Fruit Ninja Air   (modo LOCAL para la expo)
echo ============================================================
echo.
echo   Frontend:  http://localhost:3000   (se abre solo)
echo   Backend :  http://localhost:8000
echo.
echo   NOTA: el juego, la deteccion de manos y la musica funcionan
echo   SIN internet. Iniciar sesion y guardar puntajes usan Supabase
echo   (nube), asi que eso si necesita algo de conexion.
echo.
echo ------------------------------------------------------------

REM --- Dependencias del frontend (solo la primera vez, requiere internet) ---
if not exist "frontend_web\node_modules" (
  echo [setup] Instalando dependencias del frontend ^(1a vez, requiere internet^)...
  pushd frontend_web
  call npm install
  popd
)

REM --- Dependencias de Python (idempotente; si ya estan, no hace nada) ---
echo [setup] Comprobando dependencias de Python...
python -m pip install -q -r requirements.txt 2>nul

echo.
echo [1/2] Iniciando BACKEND (FastAPI/uvicorn) en una ventana aparte...
start "Frutix Backend" cmd /k "cd /d "%~dp0" && python -m uvicorn api.index:app --host 127.0.0.1 --port 8000"

echo [2/2] Iniciando FRONTEND (Vite)... el navegador se abrira solo.
echo.
echo   Para DETENER todo: cierra esta ventana y la del backend.
echo ------------------------------------------------------------
cd frontend_web
call npm run dev

pause
