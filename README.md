# Vren AI

Clear, natural interview preparation and live question guidance for any role or industry.

Vren AI pairs your background and target job descriptions with a FastAPI + PostgreSQL backend and a lightweight Chrome Manifest V3 always-on-screen floating widget extension to deliver concise, first-person talking points during live interviews. It works across technical and non-technical fields (digital marketing, 3D art, product design, operations, engineering, and more) and helps you answer questions both grounded in your CV and outside your prior experience without sounding scripted.

## Architecture & Key Features

- **Web Dashboard (`src/`):** TanStack Start / Router, React 19, Tailwind CSS v4, Vite 8
  - Account auth with email verification, CV upload and experience review (`/app/profile`), target job extraction and gap analysis (`/app/jobs`), response style preparation (`/app/prepare`), post-session review (`/app/sessions`), and privacy/revocation controls (`/app/settings`).
- **Chrome MV3 Extension (`extension/`):** WXT, React 19, TypeScript, Tailwind CSS v4
  - Single resizable, draggable always-on-screen floating widget injected via isolated Shadow DOM across web pages (`widget.content.tsx`): starts as a floating clickable **V** icon, expands into a Pine & Paper floating assistant with free corner/edge resizing and `S / M / L` size presets, and collapses back via Minimize (`_`) while remembering position and size across domains.
  - One-click webapp pairing via a localhost-only bridge (`POST /v1/extensions/pair` -> `POST /v1/extensions/exchange`), with pairing-code copy and direct email sign-in fallbacks.
  - Unified in-widget audio capture: choose **Current Chrome tab** (silent `chrome.tabCapture` when invoked from Chrome's toolbar, or automatic in-widget `getDisplayMedia` share prompt) or **Window / screen** (for desktop Zoom/Teams apps or entire monitors), paired cleanly with your extension microphone (`permissions.html`) on two separate channels.
  - Answer-first live layout with a persistent role/CV context bar, `Answer` and `Transcript` tabs, streaming first-person bullet points, `Alt+H` quick note hiding, and a slim quick-ask bar when STT is offline.
  - MV3 Offscreen `AudioWorklet` capture pipeline with automatic speaker passthrough for tab audio, bounded in-memory frame queuing, and exponential-backoff WebSocket reconnection.
- **FastAPI Backend (`backend/`):** FastAPI, SQLAlchemy 2 (async), Alembic migrations, PostgreSQL (or local SQLite)
  - Live WebSocket pipeline (`/v1/live/{session_id}`), scoped session tokens, STT adapter (OpenAI-compatible Whisper, Gemini audio, or offline prompt mode), question detection, and natural guidance generation.
- **Storage:** Private local CV storage (`backend/storage/uploads/`, gitignored). Raw audio is processed in memory and not stored on disk.

## Collaborator Setup

Your local database data and `.env` secrets are **not** committed to Git. Collaborators run their own isolated database using the versioned Alembic migrations in `backend/alembic/`.

### Prerequisites

- Node.js v20+ and npm
- Python 3.12+ and [`uv`](https://docs.astral.sh/uv/)
- Docker Desktop (easiest for Postgres) or a local PostgreSQL 16+ installation
- Google Chrome (or another Chromium browser supporting Manifest V3 extensions)

### 1. Clone and install dependencies

```sh
git clone https://github.com/krusty-hub/Vren-AI.git
cd Vren-AI
npm install
npm --prefix extension install
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
- `STT_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` (or `STT_PROVIDER=openai_compatible` + `STT_API_KEY`): enables live audio transcription from Chrome tab audio and microphone. When `STT_PROVIDER=offline` (default), you can still type or paste interviewer questions directly inside the floating widget during a live session.

### 3. Run web app and backend together

```sh
npm run dev
```

This uses `concurrently` to start Vite on `http://localhost:5173` and FastAPI on `http://127.0.0.1:8000` (with `/v1/*` API & WebSocket traffic proxied automatically).

### 4. Build and load the Chrome Extension

```sh
npm run build:ext
```

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Click **Load unpacked** and select `extension/dist/chrome-mv3` (the folder containing `manifest.json`).

## How to Use Vren AI

1. **Prepare in the Web Dashboard (`http://localhost:5173`):**
   - Sign up and verify your account, then complete onboarding by uploading a CV or entering your role focus and background.
   - Add one or more target job descriptions in **Jobs** and tune your preferred answer length, style, and framework in **Prepare** or **Settings**.
2. **Pair the Chrome Extension:**
   - Open `http://localhost:5173/app/settings` while the extension is loaded and click **Connect extension**. If the extension is installed, it pairs automatically in one click (or copy the 15-minute pairing code / sign in directly inside the floating widget).
   - You can revoke extension access anytime from **Settings**, which immediately invalidates extension API calls.
3. **Run a Live Interview Session:**
   - Open your browser interview tab (such as Google Meet, Zoom web, or Microsoft Teams) or desktop Zoom/Teams app, then click the floating **V** icon (or Vren AI toolbar icon) to open the widget.
   - Choose your target job, interview type, and interview location (**Current Chrome tab** or **Window / screen**). Click **Allow mic** if prompted so Chrome opens the one-time extension mic permission tab.
   - Drag the header to place Vren AI anywhere on screen, resize from any corner/edge or `S / M / L` preset pills, press `Alt+H` anytime to hide/show notes, or click Minimize (`_`) to return it to the draggable floating icon.
   - Click **Start session** to view concise, first-person talking points under the **Answer** tab and speaker-separated **Transcript** turns. Use **Pause / Resume** or **Stop** at any time, then click **Review session on dashboard** to inspect saved feedback.

## Available Scripts

- `npm run dev`: Run Vite web app and FastAPI backend concurrently
- `npm run dev:web`: Run only the frontend Vite server
- `npm run dev:api`: Run only the FastAPI server (`--reload`)
- `npm run dev:ext`: Run the Chrome Manifest V3 extension in WXT dev mode
- `npm run build`: Build client and SSR/Nitro bundles for production
- `npm run build:ext`: Generate extension icons and build `extension/dist/chrome-mv3`
- `npm run test`: Run frontend unit tests (`vitest`)
- `npm --prefix extension run test`: Run Chrome extension unit tests
- `npm --prefix extension run typecheck`: Typecheck Chrome extension TypeScript files
- `uv --directory backend run pytest -v`: Run backend integration & WebSocket tests
- `npm run lint`: Run ESLint across the frontend
