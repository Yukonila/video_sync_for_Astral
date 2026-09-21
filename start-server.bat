@echo off
cd /d "%~dp0server"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
)

node index.js