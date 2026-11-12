# Vren AI

Clear, natural interview preparation and live question guidance for any role or industry.

Vren AI pairs your background and target job descriptions with a FastAPI + PostgreSQL backend and a React web dashboard to deliver concise, first-person talking points and structured interview preparation. It works across technical and non-technical fields (digital marketing, 3D art, product design, operations, engineering, and more) and helps you answer questions both grounded in your CV and outside your prior experience without sounding scripted.

## Architecture & Key Features

- **Web Dashboard (`src/`):** TanStack Start / Router, React 19, Tailwind CSS v4, Vite 8
  - Account auth with email verification, CV upload and experience review (`/app/profile`), target job extraction and gap analysis (`/app/jobs`), response style preparation (`/app/prepare`), post-session review (`/app/sessions`), and privacy/account controls (`/app/settings`).
- **FastAPI Backend (`backend/`):** FastAPI, SQLAlchemy 2 (async), Alembic migrations, PostgreSQL (or local SQLite)
  - Live WebSocket pipeline (`/v1/live/{session_id}`), scoped session tokens, STT adapter (Deepgram, OpenAI-compatible Whisper, or offline prompt mode), question detection, and natural guidance generation.
- **Storage:** Private local CV storage (`backend/storage/uploads/`, gitignored). Raw audio is processed in memory and not stored on disk.

## Collaborator Setup

Your local database data and `.env` secrets are **not** committed to Git. Collaborators run their own isolated database using the versioned Alembic migrations in `backend/alembic/`.

### Prerequisites

- Node.js v20+ and npm
- Python 3.12+ and [`uv`](https://docs.astral.sh/uv/)
- Docker Desktop (easiest for Postgres) or a local PostgreSQL 16+ installation

### 1. Clone and install dependencies

```sh
git clone https://github.com/krusty-hub/Vren-AI.git
cd Vren-AI
npm install
uv --directory backend sync
```

### 2. Configure `backend/.env` and start the database

```sh
cp backend/.env.example backend/.env
```

Choose one database option:

- **Option A: Docker Postgres (recommended)**
  ```sh
  docker compose -f backend/docker-compose.yml up -d
  ```
- **Option B: Your own local PostgreSQL**
  Create a database named `vren_ai` and set `DATABASE_URL` inside `backend/.env`.
- **Option C: Zero-install SQLite file**
  Set `DATABASE_URL=sqlite+aiosqlite:///./storage/vren_local.db` in `backend/.env`.

Then create all database tables via Alembic:

```sh
uv --directory backend run alembic upgrade head
```

*(Optional)* Configure AI and Speech-to-Text in `backend/.env`:
- `LLM_API_KEY` (AgentRouter/OpenAI-compatible) or `GEMINI_API_KEY`: enables live AI CV extraction and custom answer generation (deterministic role-based fallbacks still run if unset).
- `STT_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` (or `STT_PROVIDER=openai_compatible` + `STT_API_KEY`): enables live audio transcription.

### 3. Run web app and backend together

```sh
npm run dev
```

This uses `concurrently` to start Vite on `http://localhost:5173` and FastAPI on `http://127.0.0.1:8000` (with `/v1/*` API & WebSocket traffic proxied automatically).

## How to Use Vren AI

1. **Prepare in the Web Dashboard (`http://localhost:5173`):**
   - Sign up and verify your account, then complete onboarding by uploading a CV or entering your role focus and background.
   - Add one or more target job descriptions in **Jobs** and tune your preferred answer length, style, and framework in **Prepare** or **Settings**.
2. **Review Sessions & Settings:**
   - Review past interview sessions, transcripts, and talking points in **Sessions**, and manage your profile, preferences, and data export in **Settings**.

## Available Scripts

- `npm run dev`: Run Vite web app and FastAPI backend concurrently
- `npm run dev:web`: Run only the frontend Vite server
- `npm run dev:api`: Run only the FastAPI server (`--reload`)
- `npm run build`: Build client and SSR/Nitro bundles for production
- `npm run test`: Run frontend unit tests (`vitest`)
- `uv --directory backend run pytest -v`: Run backend integration & WebSocket tests
- `npm run lint`: Run ESLint across the frontend
