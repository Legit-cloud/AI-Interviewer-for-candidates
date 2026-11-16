## Project rules
- The web app talks to the FastAPI backend (`backend/`) through `src/lib/api.ts` and `src/lib/store.ts`. Add new data access in `store.ts` and keep pages thin.
- Answers are written in the candidate's first person and are never canned. If the AI provider is unavailable, show "Answer unavailable" rather than placeholder text.
- the tauri app must be hidden from screen sharing, proctoring or monitoring tools at all times.
- Backend tests: `cd backend && uv run pytest`. Web: `npm test`.
