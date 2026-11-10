// Frontend-only mock data layer persisted to localStorage.
// Replace with real API calls when the backend is built.
import { useSyncExternalStore } from "react";

export type FieldOrigin = "verified" | "extracted" | "missing";

export interface Experience {
  id: string;
  role: string;
  employer: string;
  dates: string;
  summary: string;
  origin: FieldOrigin;
  confidence?: number | undefined;
}
export interface Education {
  id: string;
  school: string;
  degree: string;
  dates: string;
  origin: FieldOrigin;
}
export interface Skill {
  name: string;
  origin: FieldOrigin;
}
export interface Profile {
  name: string;
  headline: string;
  summary: string;
  language: string;
  roleFocus: string;
  experience: Experience[];
  education: Education[];
  skills: Skill[];
  documents: { id: string; name: string; uploadedAt: string; status: "processed" | "failed" }[];
}
export interface Job {
  id: string;
  title: string;
  company: string;
  updatedAt: string;
  archived: boolean;
  description: string;
  required: string[];
  preferred: string[];
  themes: string[];
}
export interface PrepConfig {
  jobId: string;
  interviewType: string;
  language: string;
  length: string;
  style: string;
  framework: string;
  retainTranscript: boolean;
  notes: boolean;
}
export interface Session {
  id: string;
  date: string;
  jobId: string;
  durationMin: number;
  state: "completed" | "interrupted";
  transcriptRetained: boolean;
  reviewed: boolean;
  questions: { q: string; type: string; outline: string[]; evidence: string; feedback?: string }[];
  notes: string;
}
export interface User {
  email: string;
  verified: boolean;
  onboarded: boolean;
}
export interface AppState {
  user: User | null;
  profile: Profile | null;
  jobs: Job[];
  sessions: Session[];
  prep: PrepConfig | null;
  extension: { connected: boolean; version?: string; connectedAt?: string };
}

const KEY = "vren-state-v1";

export const sampleProfile = (name: string): Profile => ({
  name,
  headline: "Product Designer",
  summary: "Designer with 6 years across fintech and health products.",
  language: "English",
  roleFocus: "Product design",
  experience: [
    {
      id: "e1",
      role: "Senior Product Designer",
      employer: "Paystack",
      dates: "2022 – Present",
      summary: "Led redesign of merchant onboarding; cut drop-off from 41% to 23%.",
      origin: "extracted",
      confidence: 0.92,
    },
    {
      id: "e2",
      role: "Product Designer",
      employer: "Helium Health",
      dates: "2019 – 2022",
      summary: "Designed clinician scheduling tool used by 300+ clinics.",
      origin: "extracted",
      confidence: 0.81,
    },
  ],
  education: [
    { id: "ed1", school: "University of Lagos", degree: "B.Sc. Computer Science", dates: "2014 – 2018", origin: "extracted" },
  ],
  skills: [
    { name: "Figma", origin: "extracted" },
    { name: "User research", origin: "extracted" },
    { name: "Design systems", origin: "extracted" },
    { name: "Prototyping", origin: "extracted" },
    { name: "SQL", origin: "missing" },
  ],
  documents: [{ id: "d1", name: "CV_2026.pdf", uploadedAt: new Date().toISOString(), status: "processed" }],
});

const seedJobs: Job[] = [
  {
    id: "j1",
    title: "Lead Product Designer",
    company: "Flutterwave",
    updatedAt: new Date().toISOString(),
    archived: false,
    description: "Lead design for merchant payments. Own the design system and partner with PMs on discovery.",
    required: ["Design systems", "User research", "Fintech experience", "Stakeholder leadership"],
    preferred: ["SQL", "Mentoring"],
    themes: ["Leadership", "Onboarding funnels", "Cross-team alignment"],
  },
];

const seedSessions: Session[] = [
  {
    id: "s1",
    date: new Date(Date.now() - 86400000 * 2).toISOString(),
    jobId: "j1",
    durationMin: 42,
    state: "completed",
    transcriptRetained: true,
    reviewed: false,
    notes: "",
    questions: [
      {
        q: "Tell me about a time you improved a key product metric.",
        type: "Behavioural",
        outline: ["Situation: merchant onboarding drop-off at 41%", "Action: ran 12 interviews, rebuilt flow", "Result: drop-off fell to 23%"],
        evidence: "From your experience: Paystack — merchant onboarding redesign",
      },
      {
        q: "How do you keep a design system adopted across teams?",
        type: "Technical",
        outline: ["Contribution model with clear owners", "Usage telemetry", "Office hours"],
        evidence: "Partially supported — add a design-system example to your profile",
      },
    ],
  },
  {
    id: "s2",
    date: new Date(Date.now() - 86400000 * 6).toISOString(),
    jobId: "j1",
    durationMin: 11,
    state: "interrupted",
    transcriptRetained: false,
    reviewed: false,
    notes: "",
    questions: [],
  },
];

const empty: AppState = { user: null, profile: null, jobs: [], sessions: [], prep: null, extension: { connected: false } };

let state: AppState = empty;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...empty, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
}

export function getState(): AppState {
  load();
  return state;
}

export function setState(update: (s: AppState) => AppState) {
  load();
  state = update(state);
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((l) => l());
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getState,
    () => empty,
  );
}

export const uid = () => Math.random().toString(36).slice(2, 9);

export const auth = {
  signUp(email: string) {
    setState(() => ({ ...empty, user: { email, verified: false, onboarded: false } }));
  },
  verify() {
    setState((s) => (s.user ? { ...s, user: { ...s.user, verified: true } } : s));
  },
  signIn(email: string) {
    setState((s) =>
      s.user?.email === email
        ? s
        : {
            ...empty,
            user: { email, verified: true, onboarded: true },
            profile: sampleProfile(email.split("@")[0] ?? "Candidate"),
            jobs: seedJobs,
            sessions: seedSessions,
          },
    );
  },
  signOut() {
    setState(() => empty);
  },
};

export function completeOnboarding(name: string, language: string, roleFocus: string, withCv: boolean) {
  setState((s) => ({
    ...s,
    user: s.user ? { ...s.user, onboarded: true } : s.user,
    profile: withCv
      ? { ...sampleProfile(name), language, roleFocus }
      : { name, headline: "", summary: "", language, roleFocus, experience: [], education: [], skills: [], documents: [] },
    jobs: s.jobs.length ? s.jobs : seedJobs,
  }));
}

export function profileCompleteness(p: Profile | null) {
  if (!p) return 0;
  const parts = [p.summary, p.experience.length, p.skills.length, p.education.length, p.documents.length];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

export function matchJob(job: Job, p: Profile | null) {
  const skills = new Set((p?.skills ?? []).filter((s) => s.origin !== "missing").map((s) => s.name.toLowerCase()));
  const text = (p?.experience ?? []).map((e) => `${e.summary} ${e.employer}`).join(" ").toLowerCase();
  const all = [...job.required, ...job.preferred];
  return all.map((r) => {
    const k = r.toLowerCase();
    if (skills.has(k)) return { req: r, state: "matched" as const };
    if (k.split(" ").some((w: string) => w.length > 3 && text.includes(w))) return { req: r, state: "partial" as const };
    return { req: r, state: "gap" as const };
  });
}
