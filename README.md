# Vren AI

**Calm, honest interview guidance grounded in your real experience.**

Vren AI is an interview preparation and live-guidance workspace that pairs your CV and verified candidate profile with target job descriptions to deliver concise, evidence-backed talking points during browser interviews — without fabricating experience or hiding capture state.

## Core Principles

- **Candidate truth over fluency** — Extracted CV items are marked with origin badges (`Extracted`, `Verified by you`, or `Missing`), and Vren AI highlights skill gaps instead of inventing claims.
- **Explicit capture control** — Designed around user-initiated, visible, and stoppable tab-audio and microphone controls.
- **Short, scannable guidance** — Concise bullet outlines and answer frameworks (`STAR`, etc.) designed to be read at a glance while speaking.
- **Privacy by default** — Transcript retention and session notes are opt-in and exportable/deletable from settings.

## Current Scope

This repository currently contains the **Vren AI web application frontend**. Application state is persisted in a `localStorage` mock store ([`src/lib/store.ts`](src/lib/store.ts)) so workflows can be explored end-to-end before connecting the backend API and Chrome extension (see [`Vren AI — Product Requirements Document.md`](Vren%20AI%20—%20Product%20Requirements%20Document.md)).

### Routes & Views

| Route | Description |
| --- | --- |
| `/` | Product landing page and live side-panel preview |
| `/auth` | Sign in, sign up, and verification flow |
| `/onboarding` | 3-step setup (profile focus, CV upload, extension connection) |
| `/app` | Candidate dashboard |
| `/app/profile` | Structured candidate profile (experience, education, skills, documents) |
| `/app/profile/review` | Review and verify extracted CV fields |
| `/app/jobs` | Manage target job descriptions |
| `/app/jobs/:jobId` | Job requirement breakdown and honest gap analysis |
| `/app/prepare` | Configure interview type, language, response style, and retention preferences |
| `/app/sessions` | Session history (including completed and interrupted sessions) |
| `/app/sessions/:sessionId` | Question-by-question session review, evidence citations, and notes |
| `/app/settings` | Privacy controls, data export (`vren-export.json`), and account settings |

## Tech Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) & [TanStack Router](https://tanstack.com/router) (file-based routing)
- **UI & Styling:** React 19, Tailwind CSS v4, shadcn/ui (Radix UI), Lucide icons
- **State & Data:** TanStack React Query, `localStorage` mock store (`useSyncExternalStore`)
- **Tooling:** Vite 8, Nitro, TypeScript, Vitest, ESLint, Prettier

## Getting Started

### Prerequisites

- Node.js (v20+ recommended) and npm

### Installation & Development

```sh
git clone https://github.com/krusty-hub/Vren-AI.git
cd Vren-AI
npm install
npm run dev
```

## Available Scripts

- `npm run dev` — Start the Vite development server
- `npm run build` — Build client and SSR/Nitro bundles for production
- `npm run build:dev` — Build in development mode
- `npm run preview` — Preview the production build locally
- `npm run test` — Run unit tests once with Vitest
- `npm run test:watch` — Run Vitest in watch mode
- `npm run lint` — Run ESLint across the repository
- `npm run format` — Format files with Prettier
