# canna-bee

Modern cannabis journal and community feed built with React, Node/Express, Postgres, and Docker. Post photos/videos, track strains and entries, and browse a public feed with hashtag highlighting. Admin can upload images for interactive guides. Production-style deploy uses Nginx and S3-compatible storage (AWS S3 or MinIO) with a migration tool for legacy uploads.

Key features
- Public feed with pagination, reactions, delete (author/admin), hashtag highlighting
- Media uploads: multiple files, progress, drag/drop reorder, client-side compression, thumbnails, dimensions
- Tokenized media ([media:UUID]) hydrated on read; backfill migration for legacy items
- Admin-only guides hub with images per tip, sticky TOC, lightbox, checklists, FAQ
- Auth with signed cookie/JWT, role-gated routes, rate limits, CSP via Helmet
- Deployable stack: Postgres + API + Nginx; S3/MinIO for durable media; local-disk fallback

Quick start (dev)
- Install: npm install (root) and npm install in backend-api
- Run dev (concurrently): npm run dev
- API at http://localhost:5002, SPA at http://localhost:3000

Docker (prod-style)
- docker compose -f compose.full.yaml up -d --build
- Web: http://localhost:8080 (SPA + /api reverse proxy)
- MinIO (optional): http://localhost:9001; set S3_* env in backend-api/.env

Recruiters / Hiring Managers
- Resume: docs/Resume.md
- LinkedIn About: docs/LinkedInAbout.md
