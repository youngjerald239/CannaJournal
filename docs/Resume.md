# Jerald [Last Name]

Location • Remote • young.jerald32@gmail.com • linkedin.com/in/jerald • github.com/youngjerald239

## Summary
Product‑minded Full‑Stack JavaScript developer who ships end‑to‑end features—UX through API to deploy. Built canna‑bee, a media‑rich React + Node/Express app with a public feed, multi‑file uploads (progress/compression), and an admin guides hub. Backend uses Postgres with migrations and tokenized media ([media:UUID]) hydrated on read. The stack runs in Docker with Nginx and S3‑compatible storage (AWS S3 or MinIO), including a migration tool to move local uploads to object storage.

## Skills
- Frontend: React, React Router, Tailwind CSS, Testing Library, SPA routing
- Backend: Node.js, Express, REST APIs, JWT auth, Multer uploads, Postgres (SQL/migrations)
- DevOps: Docker/Compose, Nginx reverse proxy, AWS SDK v3, S3/MinIO, CI (GitHub Actions)
- Practices: Env‑driven config, rate limiting, Helmet/CSP, caching, basic test automation

## Projects
### canna‑bee — Full‑Stack Cannabis Journal
- Built public feed with pagination, reactions, hashtag highlighting, and delete (author/admin)
- Implemented media uploads: multi‑file, drag/drop reorder, client‑side compression, progress UI, dimensions/thumbnails
- Designed tokenized media ([media:UUID]) with hydration on read; added backfill migration for legacy posts
- Added admin‑only Guides hub with per‑tip images, sticky TOC/scrollspy, lightbox, checklists, FAQ
- Integrated S3‑compatible storage (MinIO/AWS S3) with public URLs and a migration tool to move local uploads and update DB references
- Containerized the stack with Docker Compose (Postgres, API, Nginx) and configured SPA hosting + /api reverse proxy; added CSP, CORS, and rate limiting
- Wrote Jest/Supertest suites for core API flows; stabilized ESLint in key pages

Repo: https://github.com/youngjerald239 (project folder: Cannabees/canna‑journal)
Live demo: [add link if deployed]

## Links
- GitHub: github.com/youngjerald239
- LinkedIn: linkedin.com/in/jerald
- Project: Cannabees/canna‑journal (canna‑bee)
