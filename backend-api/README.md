Running the backend API (Windows)

1. Install dependencies (only needed once):

   cd C:\Users\young\ReactProjects\Cannabees\canna-journal\backend-api
   npm install

2. Start the server (keep the terminal open):

   node server.js

   or for auto-reload during development (requires nodemon):

   npx nodemon server.js

3. Test endpoints (from another terminal):

   curl http://localhost:5002/strains
   curl http://localhost:5002/mappings

Notes
- Data is persisted to `data/strains.json` and `data/mappings.json` when you add or update via the API.
- If you get EADDRINUSE, find the PID listening on port 5002 and kill it, e.g.: 

   powershell -Command "Get-NetTCPConnection -LocalPort 5002 | Select-Object -ExpandProperty OwningProcess"
   powershell -Command "Stop-Process -Id <PID> -Force"
