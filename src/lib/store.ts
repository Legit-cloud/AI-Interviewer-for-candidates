// Frontend store synchronized with the FastAPI + PostgreSQL backend (/v1/*).
// Demo mode (unauthenticated sample workspace) remains available for local preview.
import { useSyncExternalStore } from "react";
import {
  apiFetch,
  getStoredTokens,
  hasAuthSession,
  setStoredTokens,
  type AuthTokens,
} from "@/lib/api";

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
  id?: string | undefined;
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
export const RESPONSE_STYLES = ["Direct", "Conversational", "Structured"] as const;
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
  askedAt: string;
  framework: string;
  outline: string[];
  evidence: string | null;
  caveat?: string | undefined;
  feedback?: SuggestionFeedback | undefined;
}
export interface TranscriptLine {
  t: string;
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
export interface AppState {
  user: User | null;
  profile: Profile | null;
  jobs: Job[];
  sessions: Session[];
  prep: PrepConfig | null;
  preferences: Preferences;
  consents: ConsentEvent[];
  checklistDismissed: boolean;
}

/* ------------------------------------------------------------------ */
/* Seed data (Demo Workspace)                                          */
/* ------------------------------------------------------------------ */

const KEY = "vren-state-v2";
const PENDING_VERIFY_TOKEN_KEY = "vren-pending-verify-token";
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
      dates: "2022 - Present",
      summary:
        "Led the redesign of merchant onboarding; cut drop-off from 41% to 23% in one quarter after 12 merchant interviews.",
      origin: "extracted",
      confidence: 0.92,
      source: "Page 1 - Experience",
    },
    {
      id: "e2",
      role: "Product Designer",
      employer: "Helium Health",
      dates: "2019 - 2022",
      summary:
        "Designed a clinician scheduling tool now used by 300+ clinics across three countries.",
      origin: "extracted",
      confidence: 0.81,
      source: "Page 1 - Experience",
    },
    {
      id: "e3",
      role: "Design Intern",
      employer: "Andela",
      dates: "2018 - 2019",
      summary: "",
      origin: "missing",
      confidence: 0.44,
      source: "Page 2 - Experience",
    },
  ],
  education: [
    {
      id: "ed1",
      school: "University of Lagos",
      degree: "B.Sc. Computer Science",
      dates: "2014 - 2018",
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
    {
      id: "c1",
      name: "Google UX Design Certificate",
      issuer: "Google",
      year: "2020",
      origin: "extracted",
    },
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
    {
      id: "d1",
      name: "CV_2026.pdf",
      uploadedAt: now(),
      status: "processed",
      sizeKb: 184,
      pages: 2,
    },
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
        evidence: "Paystack - merchant onboarding redesign",
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
        evidence: "Merchant design system - 60+ components, four squads",
        caveat: "Adoption numbers are not in your profile. Do not quote a figure.",
      },
      {
        id: "q3",
        q: "Have you written SQL to analyse funnels yourself?",
        type: "Technical",
        askedAt: "23:05",
        framework: "Direct",
        outline: [
          "Answer the approach first: group step events by user_id and session timestamp to spot the biggest drop-off step",
          "Tie to your workflow: explain how you already define funnel events with analysts and iterate on onboarding flows",
          "Close clearly: mention you're comfortable reading/editing queries when needed to move fast",
        ],
        evidence: null,
      },
    ],
    transcript: [
      {
        t: "04:12",
        speaker: "Interviewer",
        text: "Tell me about a time you improved a key product metric.",
      },
      {
        t: "04:20",
        speaker: "You",
        text: "At Paystack, merchant onboarding had a 41% drop-off. I ran twelve interviews with merchants...",
      },
      {
        t: "11:47",
        speaker: "Interviewer",
        text: "How do you keep a design system adopted across teams?",
      },
      {
        t: "11:55",
        speaker: "You",
        text: "We set up a contribution model where each squad had an owner...",
      },
      {
        t: "23:05",
        speaker: "Interviewer",
        text: "Have you written SQL to analyse funnels yourself?",
      },
    ],
    strengths: [
      "Quantified the onboarding result clearly",
      "Answered the SQL question honestly instead of overstating",
    ],
    improvements: ["Lead with the outcome before the context", "Name the stakeholders you aligned"],
    missedEvidence: [
      "Helium Health scheduling tool (300+ clinics) fits the scale question at 31:10",
    ],
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
        evidence: "Paystack - merchant onboarding redesign",
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
  {
    id: "c2",
    at: daysAgo(14),
    label: "Transcript retention off by default",
    detail: "Default setting",
  },
];

const empty: AppState = {
  user: null,
  profile: null,
  jobs: [],
  sessions: [],
  prep: null,
  preferences: defaultPreferences,
  consents: [],
  checklistDismissed: false,
};

/* ------------------------------------------------------------------ */
/* Backend DTO types & mappers                                         */
/* ------------------------------------------------------------------ */

interface BackendItemDto {
  id: string;
  kind: "experience" | "education" | "project" | "certification";
  title: string;
  organization: string;
  dates_text: string;
  summary: string;
  origin: FieldOrigin;
  confidence: number;
  source_location: string;
}

interface BackendProfileDto {
  full_name: string;
  headline: string;
  summary: string;
  location: string;
  language: string;
  role_focus: string;
  checklist_dismissed: boolean;
  verified_at: string | null;
  experiences: BackendItemDto[];
  education: BackendItemDto[];
  projects: BackendItemDto[];
  certifications: BackendItemDto[];
  skills: { id: string; name: string; origin: FieldOrigin }[];
  documents: {
    id: string;
    file_name: string;
    created_at: string;
    status: string;
    size_bytes: number;
    page_count: number;
  }[];
}

interface BackendJobDto {
  id: string;
  title: string;
  company: string;
  seniority: string;
  source: string;
  raw_text: string;
  responsibilities: string[];
  required_skills: string[];
  preferred_skills: string[];
  themes: string[];
  archived: boolean;
  updated_at: string;
}

interface BackendPreferencesDto {
  language: string;
  length: string;
  style: string;
  framework: string;
  retain_transcript_default: boolean;
  notes_default: boolean;
  retention_days: number;
  product_emails: boolean;
  consent_history: { id: string; created_at: string; label: string; detail: string }[];
}

interface BackendSessionDto {
  id: string;
  job_id: string | null;
  state: string;
  duration_min: number;
  transcript_retained: boolean;
  reviewed: boolean;
  snapshot: Record<string, unknown>;
  strengths: string[];
  improvements: string[];
  missed_evidence: string[];
  note: string;
  started_at: string;
  transcript: { speaker: string; text: string; timestamp_label: string }[];
  questions: {
    id: string;
    question_text: string;
    question_type: string;
    asked_at: string;
    framework: string;
    outline: string[];
    evidence_ref: string;
    caveat: string;
    feedback: string;
  }[];
}

function mapFeedbackFromBackend(fb: string): SuggestionFeedback | undefined {
  if (fb === "helpful") return "useful";
  if (fb === "not_relevant") return "not_useful";
  return undefined;
}

function mapFeedbackToBackend(
  fb: SuggestionFeedback | undefined,
): "helpful" | "not_relevant" | "none" {
  if (fb === "useful") return "helpful";
  if (fb === "not_useful" || fb === "incorrect") return "not_relevant";
  return "none";
}

function mapProfileDto(dto: BackendProfileDto): Profile {
  return {
    name: dto.full_name || "Candidate",
    headline: dto.headline || "",
    summary: dto.summary || "",
    location: dto.location || "",
    language: dto.language || "English",
    roleFocus: dto.role_focus || "",
    verifiedAt: dto.verified_at ?? undefined,
    experience: dto.experiences.map((e) => ({
      id: e.id,
      role: e.title,
      employer: e.organization,
      dates: e.dates_text,
      summary: e.summary,
      origin: e.origin,
      confidence: e.confidence,
      source: e.source_location,
    })),
    education: dto.education.map((e) => ({
      id: e.id,
      school: e.organization || e.title,
      degree: e.title,
      dates: e.dates_text,
      origin: e.origin,
      confidence: e.confidence,
    })),
    projects: dto.projects.map((p) => ({
      id: p.id,
      name: p.title,
      summary: p.summary,
      origin: p.origin,
    })),
    certifications: dto.certifications.map((c) => ({
      id: c.id,
      name: c.title,
      issuer: c.organization,
      year: c.dates_text,
      origin: c.origin,
    })),
    skills: dto.skills.map((s) => ({
      id: s.id,
      name: s.name,
      origin: s.origin,
    })),
    documents: dto.documents.map((d) => ({
      id: d.id,
      name: d.file_name,
      uploadedAt: d.created_at,
      status: d.status === "parsed" ? "processed" : d.status === "failed" ? "failed" : "processing",
      sizeKb: Math.max(1, Math.round(d.size_bytes / 1024)),
      pages: d.page_count,
    })),
  };
}

function mapJobDto(j: BackendJobDto): Job {
  return {
    id: j.id,
    title: j.title,
    company: j.company,
    updatedAt: j.updated_at,
    archived: j.archived,
    source: j.source === "upload" ? "upload" : "paste",
    seniority: j.seniority,
    description: j.raw_text,
    responsibilities: j.responsibilities,
    required: j.required_skills,
    preferred: j.preferred_skills,
    themes: j.themes,
  };
}

function mapSessionDto(s: BackendSessionDto): Session {
  const snap = s.snapshot || {};
  return {
    id: s.id,
    date: s.started_at,
    jobId: s.job_id || "",
    durationMin: s.duration_min,
    state: s.state === "paused" || s.state === "ready" ? "interrupted" : "completed",
    transcriptRetained: s.transcript_retained,
    reviewed: s.reviewed,
    snapshot: {
      interviewType: String(snap["interviewType"] || "Behavioural"),
      language: String(snap["language"] || "English"),
      length: String(snap["length"] || "Brief"),
      style: String(snap["style"] || "Structured"),
      framework: String(snap["framework"] || "STAR"),
      retainTranscript: s.transcript_retained,
      notes: Boolean(snap["notes"] ?? true),
    },
    questions: s.questions.map((q) => ({
      id: q.id,
      q: q.question_text,
      type: q.question_type,
      askedAt: q.asked_at,
      framework: q.framework,
      outline: q.outline,
      evidence: q.evidence_ref || null,
      caveat: q.caveat || undefined,
      feedback: mapFeedbackFromBackend(q.feedback),
    })),
    transcript: s.transcript.map((t) => ({
      t: t.timestamp_label,
      speaker: t.speaker === "You" ? "You" : "Interviewer",
      text: t.text,
    })),
    strengths: s.strengths,
    improvements: s.improvements,
    missedEvidence: s.missed_evidence,
    notes: s.note || "",
  };
}

/* ------------------------------------------------------------------ */
/* Store core                                                          */
/* ------------------------------------------------------------------ */

let state: AppState = empty;
let loaded = false;
let hydratePromise: Promise<void> | null = null;
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
  if (hasAuthSession()) {
    void hydrateFromBackend();
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
export const delay = (ms = 650) => new Promise((r) => setTimeout(r, ms));

function consent(label: string, detail: string): ConsentEvent {
  return { id: uid(), at: now(), label, detail };
}

export async function hydrateFromBackend(): Promise<void> {
  if (typeof window === "undefined" || !hasAuthSession()) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const [me, profileDto, jobsDto, prefsDto, sessionsDto] = await Promise.all([
        apiFetch<{ user: User }>("/v1/me"),
        apiFetch<BackendProfileDto>("/v1/profile"),
        apiFetch<BackendJobDto[]>("/v1/jobs?include_archived=true"),
        apiFetch<BackendPreferencesDto>("/v1/preparation/preferences"),
        apiFetch<BackendSessionDto[]>("/v1/sessions"),
      ]);

      const retention =
        prefsDto.retention_days === 30 || prefsDto.retention_days === 365
          ? prefsDto.retention_days
          : 90;

      setState((prev) => ({
        ...prev,
        user: me.user,
        profile: mapProfileDto(profileDto),
        checklistDismissed: profileDto.checklist_dismissed,
        jobs: jobsDto.map(mapJobDto),
        sessions: sessionsDto.map(mapSessionDto),
        preferences: {
          language: prefsDto.language || "English",
          length: prefsDto.length || "Brief",
          style: prefsDto.style || "Structured",
          framework: prefsDto.framework || "STAR",
          retainTranscriptDefault: prefsDto.retain_transcript_default,
          notesDefault: prefsDto.notes_default,
          retentionDays: retention,
          productEmails: prefsDto.product_emails,
        },
        consents: (prefsDto.consent_history || []).map((c) => ({
          id: c.id,
          at: c.created_at,
          label: c.label,
          detail: c.detail,
        })),
      }));
    } catch {
      if (!getStoredTokens()) {
        setState(() => empty);
      }
    } finally {
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const auth = {
  async signUpWithPassword(email: string, password: string) {
    const res = await apiFetch<{
      user: User;
      dev_verification_token?: string | null;
    }>(
      "/v1/auth/signup",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      { auth: false },
    );
    if (typeof window !== "undefined" && res.dev_verification_token) {
      sessionStorage.setItem(PENDING_VERIFY_TOKEN_KEY, res.dev_verification_token);
    }
    setState(() => ({
      ...empty,
      user: res.user,
      consents: [consent("Terms and privacy accepted", "Version 1.0")],
    }));
    return res;
  },
  async verifyWithBackend(explicitToken?: string) {
    const token =
      explicitToken ||
      (typeof window !== "undefined" ? sessionStorage.getItem(PENDING_VERIFY_TOKEN_KEY) : null);
    if (!token) {
      throw new Error("Verification token is missing. Request a new verification email.");
    }
    const tokens = await apiFetch<AuthTokens & { user: User }>(
      "/v1/auth/verify",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
      { auth: false },
    );
    setStoredTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
    });
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(PENDING_VERIFY_TOKEN_KEY);
    }
    await hydrateFromBackend();
    return tokens.user;
  },
  async resendVerification(email: string) {
    const res = await apiFetch<{ status: string; dev_token?: string | null }>(
      "/v1/auth/resend-verification",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
      { auth: false },
    );
    if (typeof window !== "undefined" && res.dev_token) {
      sessionStorage.setItem(PENDING_VERIFY_TOKEN_KEY, res.dev_token);
    }
    return res;
  },
  async signInWithPassword(email: string, password: string) {
    const tokens = await apiFetch<AuthTokens & { user: User }>(
      "/v1/auth/signin",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
      { auth: false },
    );
    setStoredTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
    });
    await hydrateFromBackend();
    return tokens.user;
  },
  async forgotPassword(email: string) {
    return apiFetch<{ status: string }>(
      "/v1/auth/forgot-password",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
      { auth: false },
    );
  },
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
  /** Demo sign-in loads a populated sample workspace without backend auth tokens. */
  signIn(email: string) {
    setStoredTokens(null);
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
    setStoredTokens(null);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(PENDING_VERIFY_TOKEN_KEY);
    }
    setState(() => empty);
  },
};

function titleCase(s: string) {
  return s
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export async function completeOnboarding(
  name: string,
  language: string,
  roleFocus: string,
  withCv: boolean,
  cvFile?: File | null,
) {
  setState((s) => ({
    ...s,
    user: s.user ? { ...s.user, onboarded: true } : s.user,
    profile:
      withCv && !hasAuthSession()
        ? { ...sampleProfile(name), language, roleFocus }
        : emptyProfile(name, language, roleFocus),
    preferences: { ...s.preferences, language },
  }));

  if (!hasAuthSession()) return;

  await apiFetch("/v1/profile/onboarding", {
    method: "POST",
    body: JSON.stringify({
      full_name: name || "Candidate",
      language,
      role_focus: roleFocus,
      ai_consent: true,
      transcript_consent: false,
    }),
  });

  if (cvFile) {
    const fd = new FormData();
    fd.append("file", cvFile);
    await apiFetch("/v1/documents", { method: "POST", body: fd });
  }
  await hydrateFromBackend();
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function updateProfile(patch: Partial<Profile>) {
  setState((s) => (s.profile ? { ...s, profile: { ...s.profile, ...patch } } : s));
  if (hasAuthSession()) {
    void apiFetch("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.name !== undefined ? { full_name: patch.name } : {}),
        ...(patch.headline !== undefined ? { headline: patch.headline } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.roleFocus !== undefined ? { role_focus: patch.roleFocus } : {}),
      }),
    });
  }
}

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

  if (hasAuthSession()) {
    void (async () => {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const syncItem = async (
        id: string,
        kind: "experience" | "education" | "project" | "certification",
        title: string,
        organization: string,
        datesText: string,
        summary: string,
        origin: FieldOrigin,
      ) => {
        const body = {
          kind,
          title: title || "Item",
          organization,
          dates_text: datesText,
          summary,
          origin: origin === "missing" ? "missing" : "verified",
        };
        if (uuidRe.test(id)) {
          await apiFetch(`/v1/profile/experiences/${id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
        } else {
          await apiFetch("/v1/profile/experiences", {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
      };

      for (const exp of profile.experience) {
        await syncItem(
          exp.id,
          "experience",
          exp.role,
          exp.employer,
          exp.dates,
          exp.summary,
          exp.origin,
        );
      }
      for (const ed of profile.education) {
        await syncItem(
          ed.id,
          "education",
          ed.degree || ed.school,
          ed.school,
          ed.dates,
          "",
          ed.origin,
        );
      }
      for (const proj of profile.projects) {
        await syncItem(proj.id, "project", proj.name, "", "", proj.summary, proj.origin);
      }
      for (const cert of profile.certifications) {
        await syncItem(
          cert.id,
          "certification",
          cert.name,
          cert.issuer,
          cert.year,
          "",
          cert.origin,
        );
      }
      await apiFetch("/v1/profile/verify", {
        method: "POST",
        body: JSON.stringify({
          full_name: profile.name,
          headline: profile.headline,
          summary: profile.summary,
          location: profile.location,
          language: profile.language,
          role_focus: profile.roleFocus,
          skills: profile.skills.filter((s) => s.origin !== "missing").map((s) => s.name),
        }),
      });
      await hydrateFromBackend();
    })();
  }
}

export async function addDocument(file: {
  name: string;
  sizeKb: number;
  file?: File;
}): Promise<string> {
  const tempId = uid();
  const doc: CvDocument = {
    id: tempId,
    name: file.name,
    uploadedAt: now(),
    status: "processing",
    sizeKb: file.sizeKb,
  };
  setState((s) => {
    const base = s.profile ?? emptyProfile("Candidate", "English", "");
    return { ...s, profile: { ...base, documents: [doc, ...base.documents] } };
  });

  if (file.file && hasAuthSession()) {
    try {
      const fd = new FormData();
      fd.append("file", file.file);
      const res = await apiFetch<{ document: { id: string } }>("/v1/documents", {
        method: "POST",
        body: fd,
      });
      await hydrateFromBackend();
      return res.document.id;
    } catch (err) {
      setState((s) =>
        s.profile
          ? {
              ...s,
              profile: {
                ...s.profile,
                documents: s.profile.documents.map((d) =>
                  d.id === tempId ? { ...d, status: "failed" as const } : d,
                ),
              },
            }
          : s,
      );
      throw err;
    }
  }

  // Fallback simulation for demo workspace without backend tokens
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
            d.id === tempId ? { ...d, status: "processed" as const, pages: 2 } : d,
          ),
        },
      };
    });
  }, 1500);
  return tempId;
}

export function deleteDocument(id: string) {
  setState((s) =>
    s.profile
      ? {
          ...s,
          profile: { ...s.profile, documents: s.profile.documents.filter((d) => d.id !== id) },
        }
      : s,
  );
  if (hasAuthSession()) {
    void apiFetch(`/v1/documents/${id}`, { method: "DELETE" }).then(() => hydrateFromBackend());
  }
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

export function extractJob(
  text: string,
): Pick<Job, "required" | "preferred" | "themes" | "responsibilities"> {
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

export async function addJobAsync(
  job: Omit<Job, "id" | "updatedAt" | "archived">,
): Promise<string> {
  if (hasAuthSession()) {
    const created = await apiFetch<BackendJobDto>("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        title: job.title,
        company: job.company,
        seniority: job.seniority,
        source: job.source,
        raw_text: job.description,
        responsibilities: job.responsibilities,
        required_skills: job.required,
        preferred_skills: job.preferred,
        themes: job.themes,
      }),
    });
    const mapped = mapJobDto(created);
    setState((s) => ({ ...s, jobs: [mapped, ...s.jobs] }));
    return mapped.id;
  }
  const id = uid();
  setState((s) => ({ ...s, jobs: [{ ...job, id, updatedAt: now(), archived: false }, ...s.jobs] }));
  return id;
}

export function addJob(job: Omit<Job, "id" | "updatedAt" | "archived">) {
  const tempId = uid();
  setState((s) => ({
    ...s,
    jobs: [{ ...job, id: tempId, updatedAt: now(), archived: false }, ...s.jobs],
  }));
  if (hasAuthSession()) {
    void apiFetch<BackendJobDto>("/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        title: job.title,
        company: job.company,
        seniority: job.seniority,
        source: job.source,
        raw_text: job.description,
        responsibilities: job.responsibilities,
        required_skills: job.required,
        preferred_skills: job.preferred,
        themes: job.themes,
      }),
    }).then((created) => {
      const mapped = mapJobDto(created);
      setState((s) => ({
        ...s,
        jobs: s.jobs.map((j) => (j.id === tempId ? mapped : j)),
      }));
    });
  }
  return tempId;
}

export function updateJob(id: string, patch: Partial<Job>) {
  setState((s) => ({
    ...s,
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: now() } : j)),
  }));
  if (hasAuthSession()) {
    void apiFetch(`/v1/jobs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.company !== undefined ? { company: patch.company } : {}),
        ...(patch.seniority !== undefined ? { seniority: patch.seniority } : {}),
        ...(patch.description !== undefined ? { raw_text: patch.description } : {}),
        ...(patch.responsibilities !== undefined
          ? { responsibilities: patch.responsibilities }
          : {}),
        ...(patch.required !== undefined ? { required_skills: patch.required } : {}),
        ...(patch.preferred !== undefined ? { preferred_skills: patch.preferred } : {}),
        ...(patch.themes !== undefined ? { themes: patch.themes } : {}),
        ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      }),
    });
  }
}

export function deleteJob(id: string) {
  setState((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) }));
  if (hasAuthSession()) {
    void apiFetch(`/v1/jobs/${id}`, { method: "DELETE" });
  }
}

export function jobCompleteness(job: Job) {
  const parts = [
    job.description.length > 40,
    job.required.length > 0,
    job.responsibilities.length > 0,
    job.themes.length > 0,
  ];
  return Math.round((parts.filter(Boolean).length / parts.length) * 100);
}

/* ------------------------------------------------------------------ */
/* Preparation & sessions                                              */
/* ------------------------------------------------------------------ */

export function savePrep(cfg: PrepConfig) {
  setState((s) => ({ ...s, prep: { ...cfg, savedAt: now() } }));
  if (hasAuthSession()) {
    void apiFetch("/v1/preparation/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        language: cfg.language,
        length: cfg.length,
        style: cfg.style,
        framework: cfg.framework,
        retain_transcript_default: cfg.retainTranscript,
        notes_default: cfg.notes,
      }),
    });
  }
}

export async function createPracticeSessionAsync(job: Job, cfg: PrepConfig): Promise<string> {
  if (hasAuthSession()) {
    const created = await apiFetch<BackendSessionDto>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.id,
        state: "listening",
        transcript_retained: cfg.retainTranscript,
      }),
    });
    await apiFetch(`/v1/sessions/${created.id}/suggest`, {
      method: "POST",
      body: JSON.stringify({
        question_text: `Walk me through a project relevant to ${job.title}.`,
        question_type: cfg.interviewType,
        asked_at: "03:18",
      }),
    });
    await apiFetch(`/v1/sessions/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        state: "ended",
        duration_min: 18,
      }),
    });
    await hydrateFromBackend();
    return created.id;
  }

  const id = uid();
  const firstExp = getState().profile?.experience[0];
  setState((s) => ({
    ...s,
    sessions: [
      {
        id,
        date: now(),
        jobId: job.id,
        durationMin: 18,
        state: "completed",
        transcriptRetained: cfg.retainTranscript,
        reviewed: false,
        snapshot: {
          interviewType: cfg.interviewType,
          language: cfg.language,
          length: cfg.length,
          style: cfg.style,
          framework: cfg.framework,
          retainTranscript: cfg.retainTranscript,
          notes: cfg.notes,
        },
        questions: [
          {
            id: uid(),
            q: `Walk me through a project relevant to ${job.title}.`,
            type: cfg.interviewType,
            askedAt: "03:18",
            framework: cfg.framework,
            outline: firstExp?.summary
              ? [
                  `Context: ${firstExp.role} at ${firstExp.employer}`,
                  `Action & outcome: ${firstExp.summary}`,
                ]
              : [
                  "Describe a project directly from your experience",
                  "Focus on measurable outcomes",
                ],
            evidence: firstExp ? `${firstExp.employer} - ${firstExp.role}` : null,
          },
        ],
        transcript: cfg.retainTranscript
          ? [
              {
                t: "03:18",
                speaker: "Interviewer",
                text: `Walk me through a project relevant to ${job.title}.`,
              },
            ]
          : [],
        strengths: ["Grounded answer in verified background"],
        improvements: ["Keep opening context under 20 seconds"],
        missedEvidence: [],
        notes: "",
      },
      ...s.sessions,
    ],
  }));
  return id;
}

export interface LiveServerEvent {
  event_id: string;
  session_id: string;
  type: string;
  [key: string]: unknown;
}

export interface LiveAnswer {
  id: string;
  question_text: string;
  question_type: string;
  asked_at: string;
  framework: string;
  answer: string;
  lines: string[];
  key_points: string[];
  source_label: string;
  caveat: string;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export type LiveConnection = "connecting" | "connected" | "reconnecting" | "closed";

export interface LiveSessionHandle {
  sessionId: string;
  pairing: PairingCode;
  refreshPairingCode: () => Promise<PairingCode>;
  revokePairing: () => Promise<void>;
  /** Types a question as if the interviewer had asked it, to test the flow without audio. */
  simulate: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Closes this page's socket without ending the session. */
  close: () => void;
}

const LIVE_MAX_RECONNECTS = 6;

/**
 * Creates a live session, issues a pairing code for the extension, and attaches this page as a
 * display client. The page only shows events; the extension (or the test box) feeds questions in.
 * If the socket drops it reconnects and asks the server to replay what it missed.
 */
export async function startLiveSession(
  opts: { jobId: string | null; retainTranscript: boolean },
  onEvent: (event: LiveServerEvent) => void,
  onConnection: (state: LiveConnection) => void,
): Promise<LiveSessionHandle> {
  const created = await apiFetch<BackendSessionDto>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({
      job_id: opts.jobId,
      state: "ready",
      transcript_retained: opts.retainTranscript,
      rules_acknowledged: true,
    }),
  });
  const sessionId = created.id;

  const fetchCode = async (): Promise<PairingCode> => {
    const res = await apiFetch<{ code: string; expires_at: string }>(
      `/v1/sessions/${sessionId}/pairing-code`,
      { method: "POST" },
    );
    return { code: res.code, expiresAt: res.expires_at };
  };
  const pairing = await fetchCode();

  const tokenRes = await apiFetch<{ ws_token: string; ws_path: string }>(
    `/v1/sessions/${sessionId}/token?role=display`,
    { method: "POST" },
  );

  let socket: WebSocket | null = null;
  let lastEventId = "";
  let attempts = 0;
  let finished = false;
  let intentionallyClosed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const connect = () => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const replay = lastEventId ? `&last_event_id=${encodeURIComponent(lastEventId)}` : "";
    const url = `${proto}//${window.location.host}${tokenRes.ws_path}?token=${encodeURIComponent(tokenRes.ws_token)}${replay}`;
    const ws = new WebSocket(url);
    socket = ws;
    onConnection(attempts === 0 ? "connecting" : "reconnecting");

    ws.addEventListener("open", () => {
      attempts = 0;
      onConnection("connected");
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "client.heartbeat" }));
      }, 20000);
    });
    ws.addEventListener("message", (evt) => {
      try {
        const parsed = JSON.parse(String(evt.data)) as LiveServerEvent;
        if (parsed.event_id) lastEventId = parsed.event_id;
        if (parsed.type === "session.finalized" || parsed.type === "session.expired")
          finished = true;
        onEvent(parsed);
      } catch {
        /* ignore non-JSON WS message */
      }
    });
    ws.addEventListener("close", (evt) => {
      clearInterval(heartbeat);
      // 44xx codes are deliberate server refusals (ended, expired, revoked): do not retry.
      const refused = evt.code >= 4400 && evt.code < 4500;
      if (intentionallyClosed || finished || refused || attempts >= LIVE_MAX_RECONNECTS) {
        onConnection("closed");
        return;
      }
      attempts += 1;
      onConnection("reconnecting");
      setTimeout(connect, Math.min(1000 * 2 ** (attempts - 1), 8000));
    });
  };
  connect();

  const send = (payload: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  return {
    sessionId,
    pairing,
    refreshPairingCode: fetchCode,
    revokePairing: async () => {
      await apiFetch(`/v1/sessions/${sessionId}/pairing/revoke`, { method: "POST" });
    },
    simulate: (text: string) => send({ type: "transcript.simulate", source: "tab", text }),
    pause: () => send({ type: "session.pause" }),
    resume: () => send({ type: "session.resume" }),
    stop: () => send({ type: "session.stop" }),
    close: () => {
      intentionallyClosed = true;
      clearInterval(heartbeat);
      socket?.close(1000);
    },
  };
}

export function setSuggestionFeedback(
  sessionId: string,
  questionId: string,
  feedback: SuggestionFeedback,
) {
  setState((s) => ({
    ...s,
    sessions: s.sessions.map((x) =>
      x.id === sessionId
        ? {
            ...x,
            questions: x.questions.map((q) =>
              q.id === questionId
                ? { ...q, feedback: q.feedback === feedback ? undefined : feedback }
                : q,
            ),
          }
        : x,
    ),
  }));

  if (hasAuthSession()) {
    const sess = getState().sessions.find((s) => s.id === sessionId);
    const updatedQ = sess?.questions.find((q) => q.id === questionId);
    void apiFetch(`/v1/sessions/${sessionId}/suggestions/${questionId}/feedback`, {
      method: "PATCH",
      body: JSON.stringify({ feedback: mapFeedbackToBackend(updatedQ?.feedback) }),
    });
  }
}

export function updateSession(id: string, patch: Partial<Session>) {
  setState((s) => ({
    ...s,
    sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
  if (hasAuthSession()) {
    void apiFetch(`/v1/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.durationMin !== undefined ? { duration_min: patch.durationMin } : {}),
        ...(patch.transcriptRetained !== undefined
          ? { transcript_retained: patch.transcriptRetained }
          : {}),
        ...(patch.reviewed !== undefined ? { reviewed: patch.reviewed } : {}),
        ...(patch.notes !== undefined ? { note: patch.notes } : {}),
        ...(patch.strengths !== undefined ? { strengths: patch.strengths } : {}),
        ...(patch.improvements !== undefined ? { improvements: patch.improvements } : {}),
        ...(patch.missedEvidence !== undefined ? { missed_evidence: patch.missedEvidence } : {}),
      }),
    });
  }
}

export function deleteSession(id: string) {
  setState((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }));
  if (hasAuthSession()) {
    void apiFetch(`/v1/sessions/${id}`, { method: "DELETE" });
  }
}

/* ------------------------------------------------------------------ */
/* Preferences & data controls                                         */
/* ------------------------------------------------------------------ */

export function updatePreferences(patch: Partial<Preferences>) {
  setState((s) => {
    const consents = [...s.consents];
    if (
      patch.retainTranscriptDefault !== undefined &&
      patch.retainTranscriptDefault !== s.preferences.retainTranscriptDefault
    )
      consents.unshift(
        consent(
          patch.retainTranscriptDefault
            ? "Transcript retention default on"
            : "Transcript retention default off",
          "Applies to new sessions only",
        ),
      );
    if (patch.retentionDays !== undefined && patch.retentionDays !== s.preferences.retentionDays)
      consents.unshift(consent("Retention period changed", `${patch.retentionDays} days`));
    return { ...s, preferences: { ...s.preferences, ...patch }, consents };
  });

  if (hasAuthSession()) {
    void apiFetch("/v1/preparation/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.length !== undefined ? { length: patch.length } : {}),
        ...(patch.style !== undefined ? { style: patch.style } : {}),
        ...(patch.framework !== undefined ? { framework: patch.framework } : {}),
        ...(patch.retainTranscriptDefault !== undefined
          ? { retain_transcript_default: patch.retainTranscriptDefault }
          : {}),
        ...(patch.notesDefault !== undefined ? { notes_default: patch.notesDefault } : {}),
        ...(patch.retentionDays !== undefined ? { retention_days: patch.retentionDays } : {}),
        ...(patch.productEmails !== undefined ? { product_emails: patch.productEmails } : {}),
      }),
    }).then(() => hydrateFromBackend());
  }
}

export function dismissChecklist() {
  setState((s) => ({ ...s, checklistDismissed: true }));
  if (hasAuthSession()) {
    void apiFetch("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({ checklist_dismissed: true }),
    });
  }
}

export function exportData() {
  const { user, profile, jobs, sessions, preferences, consents } = getState();
  return JSON.stringify(
    { exportedAt: now(), user, profile, jobs, sessions, preferences, consents },
    null,
    2,
  );
}

export function deleteAllSessions() {
  setState((s) => ({ ...s, sessions: [] }));
  if (hasAuthSession()) {
    void apiFetch("/v1/sessions", { method: "DELETE" });
  }
}

export function deleteAccount() {
  if (hasAuthSession()) {
    void apiFetch("/v1/me", { method: "DELETE" });
  }
  setStoredTokens(null);
  setState(() => empty);
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function profileCompleteness(p: Profile | null) {
  if (!p) return 0;
  const parts = [
    p.summary,
    p.experience.length,
    p.skills.length,
    p.education.length,
    p.documents.length,
  ];
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
  const skills = new Set(
    (p?.skills ?? []).filter((s) => s.origin !== "missing").map((s) => s.name.toLowerCase()),
  );
  const text = [
    ...(p?.experience ?? []).map((e) => `${e.summary} ${e.employer} ${e.role}`),
    ...(p?.projects ?? []).map((x) => `${x.name} ${x.summary}`),
  ]
    .join(" ")
    .toLowerCase();
  const all = [
    ...job.required.map((r) => ({ r, required: true })),
    ...job.preferred.map((r) => ({ r, required: false })),
  ];
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
