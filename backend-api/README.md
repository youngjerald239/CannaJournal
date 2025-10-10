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

---

## Postgres Setup (No Docker / Virtualization Issues)

You saw a Docker error about virtualization not detected. You can still run Postgres using one of these approaches:

### Option A: Native Windows Installer (Fastest Offline)
1. Download the EnterpriseDB Postgres installer: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
2. Choose version 16 (or 15). During install note:
   - Superuser: `postgres`
   - Password: (pick something strong)
   - Port: 5432 (default)
3. After install, open "Stack Builder" ONLY if you need extras (you can skip).
4. Create an application user and database (replace PASSWORD_HERE):
   ```sql
   CREATE ROLE cjuser LOGIN PASSWORD 'cjpass';
   CREATE DATABASE cannajournal OWNER cjuser;
   GRANT ALL PRIVILEGES ON DATABASE cannajournal TO cjuser;
   ```
   You can run this via pgAdmin (Query Tool) or psql:
   ```bash
   psql -U postgres -h localhost -d postgres -c "CREATE ROLE cjuser LOGIN PASSWORD 'cjpass';"
   psql -U postgres -h localhost -d postgres -c "CREATE DATABASE cannajournal OWNER cjuser;"
   ```
5. Set `DATABASE_URL` in `backend-api/.env` (already present):
   ```
   DATABASE_URL=postgres://cjuser:cjpass@localhost:5432/cannajournal
   ```
6. Run migrations & seed:
   ```bash
   cd backend-api
   npm run migrate
   node ./scripts/migrate-json-to-pg.js  # optional backfill
   node server.js
   ```

### Option B: Hosted / Cloud Postgres (No Local Install)
Pick any free Postgres provider (Neon, Supabase, Render, Railway):
1. Create a new Postgres project.
2. Copy the connection string and adapt to this format:
   ```
   DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME
   ```
   If the provider requires SSL, add (or keep) `PGSSL=true` in `.env`.
3. Run the migration locally (your machine connects remotely):
   ```bash
   cd backend-api
   npm run migrate
   node scripts/migrate-json-to-pg.js
   ```
4. Start backend (`node server.js`) then start frontend (`npm start` in project root or `npm run dev`).

### Option C: Lightweight Portable Postgres (Only if others blocked)
You can download a portable Postgres ZIP (unofficial) and run `pg_ctl` manually. Generally Option A is simpler unless you lack install permissions.

---

## Enabling Virtualization (If You Want Docker Later)
Docker Desktop requires hardware virtualization (Intel VT-x / AMD-V) plus WSL2. Steps:
1. Check status: Open Task Manager > Performance > CPU. Look for "Virtualization: Enabled". If Disabled:
2. Reboot into BIOS/UEFI:
   - Intel: Enable "Intel Virtualization Technology".
   - AMD: Enable "SVM Mode".
3. In Windows (as Administrator) enable required features:
   ```powershell
   dism /online /enable-feature /featurename:Microsoft-Hyper-V /all /norestart
   dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   ```
4. Reboot.
5. Install WSL kernel (if prompted):
   ```powershell
   wsl --install
   ```
6. In Docker Desktop settings ensure "Use the WSL 2 based engine" is checked.

After virtualization is enabled you can run:
```bash
cd backend-api
docker compose up -d
```

---

## Verifying Postgres Mode
When backend starts you should see either:
```
[pg] Connected. Loading strains/users from DB.
[mode] Backend running in Postgres mode
```
or fallback:
```
[pg] Disabled (init failed): ...
[mode] Backend running in JSON file fallback mode (pg init failed)
```
If you expected Postgres mode but got fallback:
1. Confirm `DATABASE_URL` is set (echo it or add a console.log before init).
2. Check connectivity: `psql <connection parts>` or use `ping`/`tracert` for remote host.
3. If SSL needed set `PGSSL=true`.
4. Re-run `npm run migrate` to ensure schema exists.

---

## Quick Dev Workflow (without Docker)
```bash
# 1. Ensure Postgres reachable (native or cloud)
cd backend-api
npm run migrate
node scripts/migrate-json-to-pg.js   # optional
node server.js                       # starts API on 5002

# 2. In another terminal (project root) start frontend
cd ..
npm start
```

Or use the combined script (requires Postgres already up):
```bash
npm run dev
```

---

## Connection String Troubleshooting
Error: `getaddrinfo ENOTFOUND` → Host in `DATABASE_URL` invalid.
Error: `password authentication failed` → Wrong user/pass or role lacks LOGIN.
Error: `ECONNREFUSED` → Service not listening (firewall or port mismatch).
Error: `certificate has expired` → Set `PGSSL=false` for local or configure proper SSL.

---

## Rollback to JSON Fallback
Simply comment out `DATABASE_URL` in `.env` and restart the backend. It will stop querying Postgres and only use JSON files.

