# Secrets & Postgres Hardening Guide

## 1. Environment Variables (Minimum Set)
Required (process exits if missing or weak):
- JWT_SECRET (>= 32 random chars recommended)
- ADMIN_USER (non-default in production)
- ADMIN_PASS (>=12 chars, 3+ categories: lower, upper, digit, symbol)
- JOURNAL_TOKEN (>= 32 random chars)

Optional (enables Postgres):
- DATABASE_URL=postgres://user:pass@host:5432/dbname
- PGSSL=true (set to true when using a managed PG with TLS)

Optional tuning:
- PORT=5002
- ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com

## 2. Generating Strong Secrets
Use OpenSSL or Node.js:
```
# 48 random bytes base64 (~64 chars)
openssl rand -base64 48

# Hex (64 chars)
openssl rand -hex 32

# Node one-liner
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```
Rotate secrets by setting new value, restarting service, and invalidating active sessions if needed.

## 3. Postgres Migration Workflow
1. Provision database (local Docker or managed).
2. Export DATABASE_URL and PGSSL if needed.
3. Run: `npm run migrate` (idempotent; creates tables; seeds strains if empty).
4. Start server: `npm start` (it will load strains/users from DB if available).

## 4. Password Storage
Currently: PBKDF2 100k iterations, 64-byte hash, 16-byte salt.
Upgrade Path:
- Introduce ARGON2_SECRET_PEPPER (optional) + argon2id hashing library.
- Store algorithm + params per user row (e.g. password_algo, password_meta JSON).

## 5. Session & JWT
- JWT payload only carries sid + role + username + exp.
- Sessions stored in-memory; production upgrade: Redis for session map & OAuth state tokens.
- Set secure cookie (SESSION) only in production (done automatically when NODE_ENV=production).

## 6. Defense-in-Depth To Add Next
- rate limiting already present (global + auth).
- Add account lock after N failed logins (Redis counter) later.
- Add audit log table (user_logins) capturing IP/hash, user-agent.
- Apply row-level ownership checks once moving additional logic into SQL queries.

## 7. Rotating Admin Credentials
- Change ADMIN_PASS in env => restart service.
- Force logout of existing admin sessions (purge sessions Map or Redis).

## 8. Backups
- Use pg_dump nightly; keep 7 daily + 4 weekly.
- Store encrypted: gpg or KMS-managed at-rest encryption.

## 9. Monitoring
- Add health probe /health (already present) to orchestrator.
- Add connection pool metrics (pg_stat_activity) to dashboard.

## 10. Secret Handling Anti-Patterns to Avoid
- Never commit .env files with real values.
- Avoid reusing the same secret string for multiple purposes.
- Do not print secrets in logs (ensure logging scrubber for future debug statements).

---
This document will evolve as we add Redis, Argon2, and structured logging.
