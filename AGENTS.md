## Project rules
- The web app talks to the FastAPI backend (`backend/`) through `src/lib/api.ts` and `src/lib/store.ts`. Add new data access in `store.ts` and keep pages thin.
- The Chrome extension (`extension/`) is a thin client: it pairs with a session, relays tab audio when the user presses Start capture, and displays answers. Do not put CV data, AI keys or business logic in it.
- Answers are written in the candidate's first person and are never canned. If the AI provider is unavailable, show "Answer unavailable" rather than placeholder text.
- Never add code that hides the product from screen sharing, proctoring or monitoring, or disguises the extension (see docs/PRD.md §2.3 and §21.7).
- Backend tests: `cd backend && uv run pytest`. Web: `npm test`. Extension: `cd extension && npm test`.
