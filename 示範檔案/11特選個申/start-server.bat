@echo off
cd /d "%~dp0"
echo Admissions Studio is running at http://127.0.0.1:4173
echo Keep this window open. Press Ctrl+C to stop the server.
python -m http.server 4173 --bind 127.0.0.1
