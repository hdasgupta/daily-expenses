# Rehabilitation Center Expense Tracker

Full-stack expense tracker using Node/Express + PostgreSQL (Neon) + React/Vite.

## Quick start

1. Copy `backend/.env.example` to `backend/.env` and configure Neon/S3/SMTP settings.
2. Copy `frontend/.env.example` to `frontend/.env`.
3. Run `npm install` in both `backend` and `frontend`.
4. Start backend with `npm run dev` and frontend with `npm run dev`.
5. The backend automatically creates the schema and seeds the requested admin account on first startup.

Default admin: `wbffmh@gmail.com` / `Admin@12345`

For production, change the default password immediately.
