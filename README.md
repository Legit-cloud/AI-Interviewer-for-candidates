# Vren AI

**Live interview answers in your own words.** Vren AI listens to the interviewer, spots each question, and writes a short answer you can say out loud, using your real CV and the job description. It also lets you practise first and reviews each interview afterwards.

It is honest by design: answers use only facts from your CV, you decide what to say, and the app never tries to hide itself from screen sharing, proctoring or monitoring.

## What it does

- **Live answers.** Questions are spotted from the interviewer's voice. Each gets a short, spoken-style answer that streams in as it is written. You choose the length, the style, and a story format (STAR, CAR or SOAR).
- **Grounded in you.** Answers draw on your verified CV. Figures and employers that are not in your CV are removed. When your CV does not cover a question, the answer says how you would approach it. It never claims experience you do not have.
- **Coding questions and screenshots.** A coding question gets a spoken idea plus a short code block. Paste a screenshot of a question, or press a button in the extension, and Vren reads it and answers.
- **Practice.** A mock interview for your job: Vren asks the questions, you answer by typing or speaking, and it scores each answer, says what to change, and writes a stronger answer from your CV.
- **Review.** After each interview: what was asked, which job skills came up, how much of your CV was used, and an AI coaching summary on request.
- **Many languages.** 34 interview languages, with a separate language for the answers.
- **Three ways to listen.** The web app, a Chrome extension for browser tabs, and a desktop app for Zoom, Teams and other apps. Phone and in-person interviews use your microphone.
- **Keeps working.** If one AI provider fails the next is tried (your own gateway if set, then OpenAI, then Gemini). If none works you are told plainly; nothing is faked.

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
        └───── web app ───────────┘  (CV, jobs, settings, practice, history, review)
```

The web app does the setup and the thinking happens on the server. The extension and the desktop app only capture sound and show answers. A session has one capture app at a time; the other can be set to only show answers.

## What is where

| Folder | What it is | Start here |
|---|---|---|
| `src/` | Web app (TanStack Start, React 19): CV, jobs, **Live interview**, **Practice**, history, settings | `src/routes/` |
| `backend/` | API (FastAPI, SQLAlchemy): speech-to-text, question detection, answers, practice, review | `backend/app/modules/` |
| `extension/` | Chrome extension (WXT, Manifest V3) for interviews in a browser tab | [`extension/README.md`](extension/README.md) |
| `desktop/` | Desktop app (Tauri, Rust) for native meeting apps | [`desktop/README.md`](desktop/README.md) |
| `docs/` | The product requirements and the original design notes | [`docs/PRD.md`](docs/PRD.md) |

## Run it

You need Node 20+, [uv](https://docs.astral.sh/uv/) and Python 3.12+.

```sh
npm install
cp backend/.env.example backend/.env       # then add your keys, see below
uv --directory backend sync
uv --directory backend run alembic upgrade head
npm run dev                                 # web on :5173, API on :8000
```

For a quick start without Postgres, set `DATABASE_URL=sqlite+aiosqlite:///./storage/vren_local.db` in `backend/.env`.

**Run `alembic upgrade head` again after every update.** If you skip it, starting a live session fails with a server error.

### Keys (`backend/.env`)

The easiest setup needs only an OpenAI key and/or a Gemini key:

| You want | Set |
|---|---|
| Answers | `OPENAI_API_KEY` and/or `GEMINI_API_KEY`. They are tried in that order, so if one fails the other answers. (`LLM_API_KEY` is for AgentRouter or any other OpenAI-compatible service and is tried first if set.) |
| Speech to text | Nothing extra. The OpenAI key is reused for Whisper, or the Gemini key if there is no OpenAI key. For the fastest transcription add `STT_PROVIDER=deepgram` and `DEEPGRAM_API_KEY`. |

A key that is rejected (401) is skipped for ten minutes, so one bad key does not slow every answer. Keys stay on the server and are never sent to the browser.

Check your keys before an interview: `uv --directory backend run python -m scripts.try_answers`. It tests each provider, says what is wrong with any that fail, and prints sample answers. You can also see what the server can use at `http://localhost:8000/v1/health` (the `ai` section).

### Use it

1. Sign in, add your CV and a job.
2. Open **Live interview**, press **Start**, and you get a 6-digit code.
3. Open the Chrome extension or the desktop app, type the code, and press Start there.
4. Questions are answered as they are asked. Afterwards open **Sessions** for the review.
5. Want practice first? Open **Practice**.

Build the extension with `npm run ext:build` (then load `extension/dist/chrome-mv3` in Chrome). The desktop app is run and built as described in [`desktop/README.md`](desktop/README.md).

## Tests

```sh
npm run test:all                                              # web, backend and extension
cargo test --manifest-path desktop/Cargo.toml -p vren-capture-core   # desktop core
```

## Honest status

Built and tested: the backend (97 tests), the web app, the extension's logic and its sound-relay engine (checked in a real browser with a fake microphone), and the desktop app's core (21 tests, plus a run against a real server).

Not yet proven:

- Nothing has been run with a real AI key or a real interview call. Answer quality is tuned from research, not from real use.
- Chrome's one-click tab capture needs a real toolbar click, so it can only be confirmed by hand in Chrome.
- The desktop app has been built and run on Linux only. Windows and macOS builds are untested, and a Mac needs a virtual sound device (see its README).
- Not built: mobile apps, billing, and production hosting.

## Principles

- Answers use only facts from the candidate's CV. Nothing is invented, and nothing is canned: when the AI is unavailable the app says so.
- Capture starts only when you press Start and can always be stopped.
- The app does not hide from screen sharing, proctoring or monitoring, does not disguise itself, and does not claim to be undetectable. Before each live session you confirm that assistive tools are allowed in that interview. See `docs/PRD.md` §2.3 and §21.7.

## Docs

- [`docs/PRD.md`](docs/PRD.md): what the product is and why
- [`docs/notes/`](docs/notes/): the original design notes
- `AGENTS.md`: rules for working in this repo
