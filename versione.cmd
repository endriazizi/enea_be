@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM === Timestamp semplice (compatibile ovunque) ===
for /f "tokens=1-3 delims=/:. " %%a in ("%date% %time%") do (
  set TS=%%c%%b%%a_%%d%%e%%f
)
set LOG=ENV_SNAPSHOT_%TS%.txt

(
  echo ===============================================
  echo ENV SNAPSHOT - %date% %time%
  echo PC: %COMPUTERNAME%
  echo USER: %USERNAME%
  echo CWD: %CD%
  echo ===============================================
  echo.
) > "%LOG%"

call :run node -v
call :run npm -v
call :run where node
call :run where npm
call :run where nvm
call :run nvm version
call :run nvm current
call :run nvm list
call :run git --version
call :run npx -v
call :run npx ionic --version
call :run npx ng version
call :run npm config get prefix
call :run npm config get cache

echo.
echo ✅ Snapshot completato.
echo 📄 Log salvato in: "%CD%\%LOG%"
echo.
endlocal
exit /b 0

:run
set CMDLINE=%*
echo -------------------------------------------------
echo %CMDLINE%
echo -------------------------------------------------
>> "%LOG%" echo -------------------------------------------------
>> "%LOG%" echo %CMDLINE%
>> "%LOG%" echo -------------------------------------------------

REM Esegui tramite cmd /c per evitare problemi di parsing/quote
cmd /c "%CMDLINE%" 1>> "%LOG%" 2>&1

>> "%LOG%" echo.
echo.
exit /b 0
