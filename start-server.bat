@echo off
REM start-server.bat — sets the Firebase credential path for this session, then starts
REM the app. Run this instead of typing "set GOOGLE_APPLICATION_CREDENTIALS=..." by hand
REM every time you open a new terminal window.
REM
REM If your servicekey.json ever moves to a different folder, update the path on the
REM next line to match — nothing else in this file needs to change.
set GOOGLE_APPLICATION_CREDENTIALS=C:\Users\srini\Claude Apps\Runsheet\servicekey.json

REM %~dp0 is this .bat file's own folder — this makes sure "npm start" runs from the
REM correct project folder even if you double-click this file from somewhere else
REM (like a desktop shortcut), rather than needing to already be in the right folder.
cd /d "%~dp0"

npm start

REM Keeps the window open after the server stops or crashes, so you can actually read
REM whatever error it printed instead of the window vanishing immediately.
pause
