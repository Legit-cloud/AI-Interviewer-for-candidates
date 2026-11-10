// Frontend-only mock data layer persisted to localStorage.
// Replace these functions with real API calls when the backend is built; pages
// should only ever talk to the exported actions/selectors below.
import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type FieldOrigin = "verified" | "extracted" | "missing";

export interface Experience {
  id: string;
  role: string;
  employer: string;
  dates: string;
  summary: string;
  origin: FieldOrigin;
  confidence?: number | undefined;
  /** Where in the source document this was extracted from, e.g. "Page 1 · Experience". */
  source?: string | undefined;
}
export interface Education {
  id: string;
  school: string;
  degree: string;
  dates: string;
  origin: FieldOrigin;
  confidence?: number | undefined;
}
export interface Project {
  id: string;
  name: string;
  summary: string;
  origin: FieldOrigin;
}
export interface Certification {
  id: string;
  name: string;
  issuer: string;
  year: string;
  origin: FieldOrigin;
}
export interface Skill {
  name: string;
  origin: FieldOrigin;
}
export type DocumentStatus = "processing" | "processed" | "failed";
export interface CvDocument {
  id: string;
  name: string;
  uploadedAt: string;
  status: DocumentStatus;
  sizeKb?: number | undefined;
  pages?: number | undefined;
}
export interface Profile {
  name: string;
  headline: string;
  summary: string;
  location: string;
  language: string;
  roleFocus: string;
  experience: Experience[];
  education: Education[];
  projects: Project[];
  certifications: Certification[];
  skills: Skill[];
  documents: CvDocument[];
  /** ISO timestamp of the last time the user saved a verified profile. */
  verifiedAt?: string | undefined;
}
export interface Job {
  id: string;
  title: string;
  company: string;
  updatedAt: string;
  archived: boolean;
  source: "paste" | "upload";
  seniority: string;
  description: string;
  responsibilities: string[];
  required: string[];
  preferred: string[];
  themes: string[];
}
export const INTERVIEW_TYPES = [
  "Behavioural",
  "Technical",
  "Case",
  "System design",
  "General",
  "Custom",
] as const;
export const ANSWER_LENGTHS = ["Brief", "Standard", "Detailed"] as const;
export const RESPONSE_STYLES = ["Direct", "Conversational", "Structured", "Coaching"] as const;
export const FRAMEWORKS = [
  "STAR",
  "Problem / approach / trade-off",
  "Situation / decision / result",
  "None",
] as const;
export const LANGUAGES = ["English", "French", "Spanish", "German", "Portuguese"] as const;

export interface PrepConfig {
  jobId: string;
  interviewType: string;
  language: string;
  length: string;
  style: string;
  framework: string;
  retainTranscript: boolean;
  notes: boolean;
  savedAt?: string | undefined;
}
export type SuggestionFeedback = "useful" | "not_useful" | "incorrect";
export interface SessionQuestion {
  id: string;
  q: string;
  type: string;
  askedAt: string; // mm:ss into the session
  framework: string;
  outline: string[];
  evidence: string | null; // null => "No matching evidence found"
  caveat?: string | undefined;
  feedback?: SuggestionFeedback | undefined;
}
export interface TranscriptLine {
  t: string; // mm:ss
  speaker: "Interviewer" | "You";
  text: string;
}
export interface Session {
  id: string;
  date: string;
  jobId: string;
  durationMin: number;
  state: "completed" | "interrupted";
  transcriptRetained: boolean;
  reviewed: boolean;
  snapshot: Omit<PrepConfig, "jobId" | "savedAt">;
  questions: SessionQuestion[];
  transcript: TranscriptLine[];
  strengths: string[];
  improvements: string[];
  missedEvidence: string[];
  notes: string;
}
export interface User {
  email: string;
  verified: boolean;
  onboarded: boolean;
  createdAt: string;
}
export interface Preferences {
  length: string;
  style: string;
  framework: string;
  language: string;
  retainTranscriptDefault: boolean;
  notesDefault: boolean;
  retentionDays: 30 | 90 | 365;
  productEmails: boolean;
}
export interface ConsentEvent {
  id: string;
  at: string;
  label: string;
  detail: string;
}
export interface ExtensionState {
  connected: boolean;
  version?: string | undefined;
  connectedAt?: string | undefined;
  lastSeenAt?: string | undefined;
}
export interface AppState {
  user: User | null;
  profile: Profile | null;
  jobs: Job[];
  sessions: Session[];
  prep: PrepConfig | null;
  extension: ExtensionState;
  preferences: Preferences;
  consents: ConsentEvent[];
  /** Dismissed dashboard setup checklist. */
  checklistDismissed: boolean;
}

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

const KEY = "vren-state-v2";
const now = () => new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.now() - 86400000 * d).toISOString();

export const defaultPreferences: Preferences = {
  length: "Brief",
  style: "Structured",
  framework: "STAR",
  language: "English",
  retainTranscriptDefault: false,
  notesDefault: true,
  retentionDays: 90,
  productEmails: false,
};

export const sampleProfile = (name: string): Profile => ({
  name,
  headline: "Senior Product Designer",
  summary:
    "Product designer with six years across fintech and health products. Focused on onboarding, design systems, and research-led decisions.",
  location: "Lagos, Nigeria",
  language: "English",
  roleFocus: "Product design",
  experience: [
    {
      id: "e1",
      role: "Senior Product Designer",
      employer: "Paystack",
      dates: "2022 – Present",
      summary:
        "Led the redesign of merchant onboarding; cut drop-off from 41% to 23% in one quarter after 12 merchant interviews.",
      origin: "extracted",
      confidence: 0.92,
      source: "Page 1 · Experience",
    },
    {
      id: "e2",
      role: "Product Designer",
      employer: "Helium Health",
      dates: "2019 – 2022",
      summary: "Designed a clinician scheduling tool now used by 300+ clinics across three countries.",
      origin: "extracted",
      confidence: 0.81,
      source: "Page 1 · Experience",
    },
    {
      id: "e3",
      role: "Design Intern",
      employer: "Andela",
      dates: "2018 – 2019",
      summary: "",
      origin: "missing",
      confidence: 0.44,
      source: "Page 2 · Experience",
    },
  ],
  education: [
    {
      id: "ed1",
      school: "University of Lagos",
      degree: "B.Sc. Computer Science",
      dates: "2014 – 2018",
      origin: "extracted",
      confidence: 0.95,
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Merchant design system",
      summary: "Built and documented 60+ components adopted by four product squads.",
      origin: "extracted",
    },
  ],
  certifications: [
    { id: "c1", name: "Google UX Design Certificate", issuer: "Google", year: "2020", origin: "extracted" },
  ],
  skills: [
    { name: "Figma", origin: "extracted" },
    { name: "User research", origin: "extracted" },
    { name: "Design systems", origin: "extracted" },
    { name: "Prototyping", origin: "extracted" },
    { name: "Stakeholder leadership", origin: "verified" },
    { name: "SQL", origin: "missing" },
  ],
  documents: [
    { id: "d1", name: "CV_2026.pdf", uploadedAt: now(), status: "processed", sizeKb: 184, pages: 2 },
  ],
});

const emptyProfile = (name: string, language: string, roleFocus: string): Profile => ({
  name,
  headline: "",
  summary: "",
  location: "",
  language,
  roleFocus,
  experience: [],
  education: [],
  projects: [],
  certifications: [],
  skills: [],
  documents: [],
});

const seedJobs = (): Job[] => [
  {
    id: "j1",
    title: "Lead Product Designer",
    company: "Flutterwave",
    updatedAt: daysAgo(1),
    archived: false,
    source: "paste",
    seniority: "Lead",
    description:
      "Lead design for merchant payments. Own the design system and partner with PMs on discovery across onboarding and checkout.",
    responsibilities: [
      "Own the merchant payments design system",
      "Partner with product managers on discovery",
      "Mentor a team of four designers",
    ],
    required: ["Design systems", "User research", "Fintech experience", "Stakeholder leadership"],
    preferred: ["SQL", "Mentoring"],
    themes: ["Leadership", "Onboarding funnels", "Cross-team alignment"],
  },
  {
    id: "j2",
    title: "Senior Product Designer, Growth",
    company: "Moniepoint",
    updatedAt: daysAgo(4),
    archived: false,
    source: "upload",
    seniority: "Senior",
    description: "Drive activation and retention experiments for the business banking app.",
    responsibilities: ["Design and ship growth experiments", "Work with data on funnel analysis"],
    required: ["Prototyping", "Experimentation", "Figma"],
    preferred: ["SQL"],
    themes: ["Experiment design", "Activation metrics"],
  },
  {
    id: "j3",
    title: "Product Designer",
    company: "Kuda",
    updatedAt: daysAgo(40),
    archived: true,
    source: "paste",
    seniority: "Mid",
    description: "Design savings and budgeting features.",
    responsibilities: ["Design savings features"],
    required: ["Figma", "User research"],
    preferred: [],
    themes: ["Consumer finance"],
  },
];

const baseSnapshot = {
  interviewType: "Behavioural",
  language: "English",
  length: "Brief",
  style: "Structured",
  framework: "STAR",
  retainTranscript: true,
  notes: true,
};

const seedSessions = (): Session[] => [
  {
    id: "s1",
    date: daysAgo(2),
    jobId: "j1",
    durationMin: 42,
    state: "completed",
    transcriptRetained: true,
    reviewed: false,
    snapshot: baseSnapshot,
    notes: "",
    questions: [
      {
        id: "q1",
        q: "Tell me about a time you improved a key product metric.",
        type: "Behavioural",
        askedAt: "04:12",
        framework: "STAR",
        outline: [
          "Situation: merchant onboarding drop-off sat at 41%",
          "Action: ran 12 merchant interviews and rebuilt the flow",
          "Result: drop-off fell to 23% within one quarter",
        ],
        evidence: "Paystack · merchant onboarding redesign",
      },
      {
        id: "q2",
        q: "How do you keep a design system adopted across teams?",
        type: "Technical",
        askedAt: "11:47",
        framework: "Problem / approach / trade-off",
        outline: [
          "Problem: components drift when squads ship fast",
          "Approach: contribution model with clear owners and office hours",
          "Trade-off: slower first release, far less rework",
        ],
        evidence: "Merchant design system · 60+ components, four squads",
        caveat: "Adoption numbers are not in your profile. Do not quote a figure.",
      },
      {
        id: "q3",
        q: "Have you written SQL to analyse funnels yourself?",
        type: "Technical",
        askedAt: "23:05",
        framework: "None",
        outline: [
          "Be direct: SQL is not part of your verified experience",
          "Describe how you partnered with analysts on funnel data",
          "Mention willingness to learn if relevant",
        ],
        evidence: null,
      },
    ],
    transcript: [
      { t: "04:12", speaker: "Interviewer", text: "Tell me about a time you improved a key product metric." },
      {
        t: "04:20",
        speaker: "You",
        text: "At Paystack, merchant onboarding had a 41% drop-off. I ran twelve interviews with merchants…",
      },
      { t: "11:47", speaker: "Interviewer", text: "How do you keep a design system adopted across teams?" },
      { t: "11:55", speaker: "You", text: "We set up a contribution model where each squad had an owner…" },
      { t: "23:05", speaker: "Interviewer", text: "Have you written SQL to analyse funnels yourself?" },
    ],
    strengths: [
      "Quantified the onboarding result clearly",
      "Answered the SQL question honestly instead of overstating",
    ],
    improvements: ["Lead with the outcome before the context", "Name the stakeholders you aligned"],
    missedEvidence: ["Helium Health scheduling tool (300+ clinics) fits the scale question at 31:10"],
  },
  {
    id: "s2",
    date: daysAgo(6),
    jobId: "j2",
    durationMin: 11,
    state: "interrupted",
    transcriptRetained: false,
    reviewed: false,
    snapshot: { ...baseSnapshot, retainTranscript: false, interviewType: "General" },
    notes: "",
    questions: [
      {
        id: "q4",
        q: "Walk me through your portfolio.",
        type: "General",
        askedAt: "02:30",
        framework: "None",
        outline: ["Open with the Paystack onboarding case", "Close with the design system"],
        evidence: "Paystack · merchant onboarding redesign",
      },
    ],
    transcript: [],
    strengths: [],
    improvements: [],
    missedEvidence: [],
  },
];

const seedConsents = (): ConsentEvent[] => [
  { id: "c1", at: daysAgo(14), label: "Terms and privacy accepted", detail: "Version 1.0" },
  { id: "c2", at: daysAgo(14), label: "Transcript retention off by default", detail: "Default setting" },
];

const empty: AppState = {
  user: null,
  profile: null,
  jobs: [],
  sessions: [],
  prep: null,
  extension: { connected: false },
  preferences: defaultPreferences,
  consents: [],
  checklistDismissed: false,
};

/* ------------------------------------------------------------------ */
/* Store core                                                          */
/* ------------------------------------------------------------------ */

let state: AppState = empty;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      state = {
        ...empty,
        ...parsed,
        preferences: { ...defaultPreferences, ...(parsed.preferences ?? {}) },
      };
    }
  } catch {
    /* ignore corrupt storage */
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
/** Simulated network latency so every async action shows a pending state. */
export const delay = (ms = 650) => new Promise((r) => setTimeout(r, ms));

function consent(label: string, detail: string): ConsentEvent {
  return { id: uid(), at: now(), label, detail };
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const auth = {
  signUp(email: string) {
    setState(() => ({
      ...empty,
      user: { email, verified: false, onboarded: false, createdAt: now() },
      consents: [consent("Terms and privacy accepted", "Version 1.0")],
    }));
  },
  verify() {
    setState((s) => (s.user ? { ...s, user: { ...s.user, verified: true } } : s));
  },
  /** Demo sign-in: any valid email/password loads a populated sample workspace. */
  signIn(email: string) {
    setState((s) =>
      s.user?.email === email
        ? s
        : {
            ...empty,
            user: { email, verified: true, onboarded: true, createdAt: daysAgo(14) },
            profile: sampleProfile(titleCase(email.split("@")[0] ?? "Candidate")),
            jobs: seedJobs(),
            sessions: seedSessions(),
            consents: seedConsents(),
          },
    );
  },
  signOut() {
    setState(() => empty);
  },
};

function titleCase(s: string) {
  return s
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function completeOnboarding(name: string, language: string, roleFocus: string, withCv: boolean) {
  setState((s) => ({
    ...s,
    user: s.user ? { ...s.user, onboarded: true } : s.user,
    profile: withCv
      ? { ...sampleProfile(name), language, roleFocus }
      : emptyProfile(name, language, roleFocus),
    preferences: { ...s.preferences, language },
  }));
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function updateProfile(patch: Partial<Profile>) {
  setState((s) => (s.profile ? { ...s, profile: { ...s.profile, ...patch } } : s));
}

/** Marks every extracted (non-missing) field as verified by the user. */
export function saveVerifiedProfile(profile: Profile) {
  const verify = <T extends { origin: FieldOrigin }>(items: T[]) =>
    items.map((i) => (i.origin === "extracted" ? { ...i, origin: "verified" as const } : i));
  setState((s) => ({
    ...s,
    profile: {
      ...profile,
      experience: verify(profile.experience),
      education: verify(profile.education),
      projects: verify(profile.projects),
      certifications: verify(profile.certifications),
      skills: verify(profile.skills),
      verifiedAt: now(),
    },
  }));
}

export function addDocument(file: { name: string; sizeKb: number }) {
  const doc: CvDocument = {
    id: uid(),
    name: file.name,
    uploadedAt: now(),
    status: "processing",
    sizeKb: file.sizeKb,
  };
  setState((s) => {
    const base = s.profile ?? emptyProfile("Candidate", "English", "");
    return { ...s, profile: { ...base, documents: [doc, ...base.documents] } };
  });
  // Simulate background extraction; merge sample extraction when profile is empty.
  setTimeout(() => {
    setState((s) => {
      if (!s.profile) return s;
      const sample = sampleProfile(s.profile.name);
      const isEmpty = s.profile.experience.length === 0;
      return {
        ...s,
        profile: {
          ...(isEmpty
            ? {
                ...s.profile,
                headline: s.profile.headline || sample.headline,
                summary: s.profile.summary || sample.summary,
                experience: sample.experience,
                education: sample.education,
                projects: sample.projects,
                certifications: sample.certifications,
                skills: sample.skills,
              }
            : s.profile),
          documents: s.profile.documents.map((d) =>
            d.id === doc.id ? { ...d, status: "processed" as const, pages: 2 } : d,
          ),
        },
      };
    });
  }, 2400);
  return doc.id;
}

export function deleteDocument(id: string) {
  setState((s) =>
    s.profile ? { ...s, profile: { ...s.profile, documents: s.profile.documents.filter((d) => d.id !== id) } } : s,
  );
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

/** Naive client-side extraction stand-in for the backend job parser. */
export function extractJob(text: string): Pick<Job, "required" | "preferred" | "themes" | "responsibilities"> {
  const known = [
    "Design systems",
    "User research",
    "Figma",
    "Prototyping",
    "SQL",
    "Mentoring",
    "Stakeholder leadership",
    "Experimentation",
    "Fintech experience",
    "Accessibility",
    "TypeScript",
    "React",
    "System design",
    "Python",
    "Data analysis",
  ];
  const lower = text.toLowerCase();
  const found = known.filter((k) => lower.includes(k.toLowerCase().split(" ")[0] ?? ""));
  const lines = text
    .split(/\n|\.\s/)
    .map((l) => l.replace(/^[-•*\s]+/, "").trim())
    .filter((l) => l.length > 20)
    .slice(0, 5);
  return {
    required: found.slice(0, 4),
    preferred: found.slice(4, 7),
    themes: found.length ? ["Role fit", "Collaboration"] : [],
    responsibilities: lines,
  };
}

export function addJob(job: Omit<Job, "id" | "updatedAt" | "archived">) {
  const id = uid();
  setState((s) => ({ ...s, jobs: [{ ...job, id, updatedAt: now(), archived: false }, ...s.jobs] }));
  return id;
}

export function updateJob(id: string, patch: Partial<Job>) {
  setState((s) => ({
    ...s,
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: now() } : j)),
  }));
}

export function deleteJob(id: string) {
  setState((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) }));
}

export function jobCompleteness(job: Job) {
  const parts = [job.description.length > 40, job.required.length > 0, job.responsibilities.length > 0, job.themes.length > 0];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

/* ------------------------------------------------------------------ */
/* Preparation & sessions                                              */
/* ------------------------------------------------------------------ */

export function savePrep(cfg: PrepConfig) {
  setState((s) => ({ ...s, prep: { ...cfg, savedAt: now() } }));
}

export function setSuggestionFeedback(sessionId: string, questionId: string, feedback: SuggestionFeedback) {
  setState((s) => ({
    ...s,
    sessions: s.sessions.map((x) =>
      x.id === sessionId
        ? {
            ...x,
            questions: x.questions.map((q) =>
              q.id === questionId ? { ...q, feedback: q.feedback === feedback ? undefined : feedback } : q,
            ),
          }
        : x,
    ),
  }));
}

export function updateSession(id: string, patch: Partial<Session>) {
  setState((s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
}

export function deleteSession(id: string) {
  setState((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }));
}

/* ------------------------------------------------------------------ */
/* Extension, preferences, data controls                               */
/* ------------------------------------------------------------------ */

export function connectExtension() {
  setState((s) => ({
    ...s,
    extension: { connected: true, version: "0.9.2", connectedAt: now(), lastSeenAt: now() },
    consents: [consent("Chrome extension connected", "Version 0.9.2"), ...s.consents],
  }));
}

export function revokeExtension() {
  setState((s) => ({
    ...s,
    extension: { connected: false },
    consents: [consent("Extension access revoked", "All extension tokens invalidated"), ...s.consents],
  }));
}

export function updatePreferences(patch: Partial<Preferences>) {
  setState((s) => {
    const consents = [...s.consents];
    if (patch.retainTranscriptDefault !== undefined && patch.retainTranscriptDefault !== s.preferences.retainTranscriptDefault)
      consents.unshift(
        consent(
          patch.retainTranscriptDefault ? "Transcript retention default on" : "Transcript retention default off",
          "Applies to new sessions only",
        ),
      );
    if (patch.retentionDays !== undefined && patch.retentionDays !== s.preferences.retentionDays)
      consents.unshift(consent("Retention period changed", `${patch.retentionDays} days`));
    return { ...s, preferences: { ...s.preferences, ...patch }, consents };
  });
}

export function dismissChecklist() {
  setState((s) => ({ ...s, checklistDismissed: true }));
}

export function exportData() {
  const { user, profile, jobs, sessions, preferences, consents } = getState();
  return JSON.stringify({ exportedAt: now(), user, profile, jobs, sessions, preferences, consents }, null, 2);
}

export function deleteAllSessions() {
  setState((s) => ({ ...s, sessions: [] }));
}

export function deleteAccount() {
  setState(() => empty);
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function profileCompleteness(p: Profile | null) {
  if (!p) return 0;
  const parts = [p.summary, p.experience.length, p.skills.length, p.education.length, p.documents.length];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

export function unverifiedCount(p: Profile | null) {
  if (!p) return 0;
  return [...p.experience, ...p.education, ...p.projects, ...p.certifications, ...p.skills].filter(
    (i) => i.origin !== "verified",
  ).length;
}

export type MatchState = "matched" | "partial" | "gap";
export function matchJob(job: Job, p: Profile | null) {
  const skills = new Set((p?.skills ?? []).filter((s) => s.origin !== "missing").map((s) => s.name.toLowerCase()));
  const text = [...(p?.experience ?? []).map((e) => `${e.summary} ${e.employer} ${e.role}`), ...(p?.projects ?? []).map((x) => `${x.name} ${x.summary}`)]
    .join(" ")
    .toLowerCase();
  const all = [...job.required.map((r) => ({ r, required: true })), ...job.preferred.map((r) => ({ r, required: false }))];
  return all.map(({ r, required }) => {
    const k = r.toLowerCase();
    if (skills.has(k)) return { req: r, required, state: "matched" as MatchState };
    if (k.split(" ").some((w: string) => w.length > 3 && text.includes(w)))
      return { req: r, required, state: "partial" as MatchState };
    return { req: r, required, state: "gap" as MatchState };
  });
}

export function jobById(jobs: Job[], id: string | undefined) {
  return jobs.find((j) => j.id === id);
}
