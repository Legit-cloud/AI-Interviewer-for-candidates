# Vren AI

**Calm, honest interview guidance grounded in your real experience.**

Vren AI is an interview preparation and live-guidance workspace that pairs your CV and verified candidate profile with target job descriptions to deliver concise, evidence-backed talking points during browser interviews, without fabricating experience or hiding capture state.

## Core Principles

- **Candidate truth over fluency**: Extracted CV items are marked with origin badges (`Extracted`, `Verified by you`, or `Missing`), and Vren AI highlights skill gaps instead of inventing claims.
- **Explicit capture control**: Designed around user-initiated, visible, and stoppable tab-audio and microphone controls.
- **Short, scannable guidance**: Concise bullet outlines and answer frameworks (`STAR`, etc.) designed to be read at a glance while speaking.
- **Privacy by default**: Transcript retention and session notes are opt-in and exportable or deletable from settings.

## Current Scope

This repository currently contains the **Vren AI web application frontend**. Application state is persisted in a `localStorage` mock store ([`src/lib/store.ts`](src/lib/store.ts)) so workflows can be explored end-to-end before connecting the backend API and Chrome extension (see the Product Requirements Document in this directory).

### Routes & Views

| Route | Description |
| --- | --- |
| `/` | Product landing page and live side-panel preview |
| `/auth` | Sign in, sign up, password reset, and verification flow |
| `/onboarding` | 3-step setup (profile focus, CV upload, extension connection) |
| `/app` | Candidate dashboard with setup checklist |
| `/app/profile` | Structured candidate profile (experience, education, projects, skills, documents) |
| `/app/profile/review` | Two-pane review and verification of extracted CV fields |
| `/app/jobs` | Manage active and archived job descriptions (paste or file upload) |
| `/app/jobs/:jobId` | Job requirement breakdown and honest gap analysis |
| `/app/prepare` | Configure interview type, language, response style, retention, and companion preview |
| `/app/sessions` | Session history (including completed and interrupted sessions) |
| `/app/sessions/:sessionId` | Question-by-question session review, evidence citations, transcript, and notes |
| `/app/settings` | Privacy controls, consent history, data export (`vren-export.json`), and account deletion |

## Tech Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) & [TanStack Router](https://tanstack.com/router) (file-based routing)
- **UI & Styling:** React 19, Tailwind CSS v4, shadcn/ui (Radix UI), Phosphor Icons, Motion
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

- `npm run dev`: Start the Vite development server
- `npm run build`: Build client and SSR/Nitro bundles for production
- `npm run build:dev`: Build in development mode
- `npm run preview`: Preview the production build locally
- `npm run test`: Run unit tests once with Vitest
- `npm run test:watch`: Run Vitest in watch mode
- `npm run lint`: Run ESLint across the repository
- `npm run format`: Format files with Prettier
