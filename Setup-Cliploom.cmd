@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if errorlevel 1 goto fail
if exist requirements-lock.txt (
  ".venv\Scripts\python.exe" -m pip install -r requirements-lock.txt
) else (
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
if errorlevel 1 goto fail
".venv\Scripts\python.exe" setup_local.py
if errorlevel 1 goto fail
echo Setup complete. Open Start-Cliploom.cmd.
pause
exit /b 0
:fail
echo Setup failed. Keep this window open and share the error message.
pause
exit /b 1
