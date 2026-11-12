# Vren AI

Live interview answers for any role. Vren AI listens to the interviewer, spots each question, and writes a short answer in your own words, using your real CV and the job description.

## How the pieces fit

```
 interviewer's voice                                          you
        │                                                      ▲
        ▼                                                      │
 ┌──────────────┐  audio   ┌──────────────┐  answers   ┌───────────────┐
 │ capture      │ ───────▶ │   backend    │ ─────────▶ │ display       │
 │ extension OR │          │  speech→text │            │ side panel,   │
 │ desktop app  │          │  question    │            │ on-page box,  │
 └──────────────┘          │  answer (AI) │            │ desktop box,  │
        ▲                  └──────────────┘            │ web live page │
        │ 6-digit code            ▲                    └───────────────┘
        └───── web app ───────────┘  (CV, jobs, settings, history, review)
```

The web app does the thinking and setup. The extension and the desktop app only capture sound and show answers.

## What is where

| Folder | What it is | Start here |
|---|---|---|
| `src/` | Web app (TanStack Start, React 19). Sign in, CV, jobs, **Live interview**, **Mock interview**, history, settings | `src/routes/` |
| `backend/` | API (FastAPI, SQLAlchemy). Speech-to-text, question detection, answers, review | `backend/app/modules/` |
| `extension/` | Chrome extension (WXT, Manifest V3) for interviews in a browser tab | `extension/README.md` |
| `desktop/` | Desktop app (Tauri) for interviews in Zoom, Teams and other apps | `desktop/README.md` |
| `docs/` | The product requirements (`PRD.md`) and design notes | `docs/PRD.md` |

Only one capture app can be connected to a session at a time. Use the extension for browser meetings and the desktop app for native apps. They never fight: the second one is told plainly that another app is already listening.

## Run it

You need Node 20+, [uv](https://docs.astral.sh/uv/) and Python 3.12+.

```sh
npm install
cp backend/.env.example backend/.env       # then edit it, see "Keys" below
uv --directory backend sync
uv --directory backend run alembic upgrade head
npm run dev                                 # web on :5173, API on :8000
```

For a quick start without Postgres, set `DATABASE_URL=sqlite+aiosqlite:///./storage/vren_local.db` in `backend/.env`.

Run `alembic upgrade head` again after every update. If you skip it, starting a live session fails with a server error.

### Keys (`backend/.env`)

| You want | Set |
|---|---|
| Answers | `LLM_API_KEY` (AgentRouter or any OpenAI-compatible API). Optional backups, tried in order: `OPENAI_API_KEY`, then `GEMINI_API_KEY` |
| Speech to text | `STT_PROVIDER=deepgram` and `DEEPGRAM_API_KEY` |

Check what the server sees at `http://localhost:8000/v1/health` (the `ai` section). To try the answers with your own key before an interview: `uv --directory backend run python -m scripts.try_answers`.

### Use it

1. Sign in, add your CV and a job.
2. Open **Live interview**, press **Start**, and you get a 6-digit code.
3. Open the Vren extension (or desktop app) and type the code. Press Start there.
4. Questions are answered as they are asked. When you finish, open **Sessions** for the review.

**Mock interview** lets you practise first: Vren asks you questions for a job, you answer, and it tells you how to improve.

## Tests

```sh
npm test                                   # web
uv --directory backend run pytest -q       # backend
npm --prefix extension test                # extension
cargo test --manifest-path desktop/capture-core/Cargo.toml   # desktop core
```

## Docs

- [`docs/PRD.md`](docs/PRD.md): what the product is and why
- [`docs/notes/`](docs/notes/): the original design notes
- `AGENTS.md`: rules for working in this repo
