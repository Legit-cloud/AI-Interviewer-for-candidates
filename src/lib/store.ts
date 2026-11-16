// Frontend store synchronized with the FastAPI + PostgreSQL backend (/v1/*).
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  apiFetch,
  API_BASE,
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
  "CAR",
  "SOAR",
  "Problem / approach / trade-off",
  "Situation / decision / result",
  "None",
] as const;
export const LANGUAGES = [
  "English",
  "French",
  "Spanish",
  "German",
  "Portuguese",
  "Italian",
  "Dutch",
  "Polish",
  "Russian",
  "Ukrainian",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Hindi",
  "Bengali",
  "Urdu",
  "Indonesian",
  "Malay",
  "Vietnamese",
  "Thai",
  "Filipino",
  "Japanese",
  "Korean",
  "Chinese",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Greek",
  "Czech",
  "Romanian",
  "Hungarian",
  "Swahili",
  "Yoruba",
] as const; // keep in sync with backend/app/core/languages.py

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
  code?: string | undefined;
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
export interface SessionReview {
  generatedAt: string;
  aiAvailable: boolean;
  usedTranscript: boolean;
  stats: {
    questions: number;
    byType: Record<string, number>;
    answersFromCv: number;
    answersDirect: number;
    requiredSkills: string[];
    skillsCovered: string[];
    skillsNotCovered: string[];
    cvNotUsed: string[];
  };
  ai: {
    summary: string;
    strengths: string[];
    improvements: string[];
    perQuestion: { index: number; note: string }[];
    nextSteps: string[];
  } | null;
}

export interface Session {
  review?: SessionReview | undefined;
  id: string;
  date: string;
  jobId: string;
  durationMin: number;
  state: "completed" | "interrupted" | "live";
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
  /** Language the answers are written in. Empty means the same as the interview language. */
  answerLanguage: string;
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
/* Local state                                                         */
/* ------------------------------------------------------------------ */

const KEY = "vren-state-v2";
const PENDING_VERIFY_TOKEN_KEY = "vren-pending-verify-token";
const now = () => new Date().toISOString();
const daysAgo = (d: number) => new Date(Date.now() - 86400000 * d).toISOString();

export const defaultPreferences: Preferences = {
  answerLanguage: "",
  length: "Brief",
  style: "Structured",
  framework: "STAR",
  language: "English",
  retainTranscriptDefault: false,
  notesDefault: true,
  retentionDays: 90,
  productEmails: false,
};

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
  answer_language?: string;
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
  questions: BackendQuestionDto[];
}

interface BackendQuestionDto {
  code?: string;
  id: string;
  question_text: string;
  question_type: string;
  asked_at: string;
  framework: string;
  outline: string[];
  evidence_ref: string;
  caveat: string;
  feedback: string;
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

function mapReview(raw: unknown): SessionReview | undefined {
  const r = raw as
    | {
        generated_at?: string;
        ai_available?: boolean;
        used_transcript?: boolean;
        stats?: Record<string, unknown>;
        ai?: {
          summary: string;
          strengths: string[];
          improvements: string[];
          per_question: { index: number; note: string }[];
          next_steps: string[];
        } | null;
      }
    | undefined;
  if (!r || !r.stats) return undefined;
  const st = r.stats as Record<string, never>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  return {
    generatedAt: r.generated_at ?? "",
    aiAvailable: r.ai_available === true,
    usedTranscript: r.used_transcript === true,
    stats: {
      questions: Number(st["questions"] ?? 0),
      byType: (st["by_type"] as unknown as Record<string, number>) ?? {},
      answersFromCv: Number(st["answers_from_cv"] ?? 0),
      answersDirect: Number(st["answers_direct"] ?? 0),
      requiredSkills: list(st["required_skills"]),
      skillsCovered: list(st["skills_covered"]),
      skillsNotCovered: list(st["skills_not_covered"]),
      cvNotUsed: list(st["cv_not_used"]),
    },
    ai: r.ai
      ? {
          summary: r.ai.summary,
          strengths: r.ai.strengths ?? [],
          improvements: r.ai.improvements ?? [],
          perQuestion: r.ai.per_question ?? [],
          nextSteps: r.ai.next_steps ?? [],
        }
      : null,
  };
}

function mapSessionDto(s: BackendSessionDto): Session {
  const snap = s.snapshot || {};
  return {
    id: s.id,
    date: s.started_at,
    jobId: s.job_id || "",
    durationMin: s.duration_min,
    state:
      s.state === "listening"
        ? "live"
        : s.state === "paused" || s.state === "ready"
          ? "interrupted"
          : "completed",
    transcriptRetained: s.transcript_retained,
    reviewed: s.reviewed,
    snapshot: {
      interviewType: String(snap["interview_type"] || snap["interviewType"] || "Behavioural"),
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
      code: q.code || undefined,
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
    review: mapReview(snap["review"]),
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

/** A background save failed: tell the user and reload the server's copy so the screen is not lying. */
function handleWriteError(err: unknown): undefined {
  toast.error(err instanceof Error ? err.message : "Could not save your change.", {
    description: "The page was refreshed to match what is saved.",
  });
  void hydrateFromBackend();
  return undefined;
}

/** Fire-and-forget API write with visible failure handling. */
function writeThrough<T = unknown>(path: string, init: RequestInit = {}): Promise<T | undefined> {
  return apiFetch<T>(path, init).catch(handleWriteError);
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
          answerLanguage: prefsDto.answer_language || "",
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
  /** Changes the password. The server signs out other sessions and returns fresh tokens for this one. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const tokens = await apiFetch<AuthTokens>("/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    setStoredTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || "bearer",
    });
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
    profile: emptyProfile(name, language, roleFocus),
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
    void writeThrough("/v1/profile", {
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

  // Without a signed-in session nothing can be uploaded. Remove the placeholder instead of pretending.
  setState((st) =>
    st.profile
      ? {
          ...st,
          profile: {
            ...st.profile,
            documents: st.profile.documents.filter((d) => d.id !== tempId),
          },
        }
      : st,
  );
  throw new Error("Sign in again to upload your CV.");
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
    void writeThrough(`/v1/documents/${id}`, { method: "DELETE" }).then(() => hydrateFromBackend());
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
    })
      .then((created) => {
        const mapped = mapJobDto(created);
        setState((s) => ({
          ...s,
          jobs: s.jobs.map((j) => (j.id === tempId ? mapped : j)),
        }));
      })
      .catch((err) => {
        setState((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== tempId) }));
        handleWriteError(err);
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
    void writeThrough(`/v1/jobs/${id}`, {
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
    void writeThrough(`/v1/jobs/${id}`, { method: "DELETE" });
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
  /** A short solution, for coding questions. */
  code?: string;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
}

export type LiveConnection = "connecting" | "connected" | "reconnecting" | "closed";

/* ------------------------------------------------------------------ */
/* Mock interviews                                                     */
/* ------------------------------------------------------------------ */

export interface MockFeedback {
  score: number;
  did_well: string[];
  improve: string[];
  stronger_answer: string;
  removed_claims: number;
}
export interface MockTurn {
  index: number;
  question: string;
  kind: string;
  answer: string | null;
  feedback: MockFeedback | null;
}
export interface MockSummary {
  overall: string;
  strengths: string[];
  fixes: string[];
  practise: string[];
  average_score: number;
  answered: number;
  asked: number;
}
export interface MockInterview {
  id: string;
  job_id: string | null;
  title: string;
  interview_type: string;
  state: "active" | "finished";
  turns: MockTurn[];
  summary: MockSummary | null;
  created_at: string;
}

export const mockApi = {
  list: () => apiFetch<MockInterview[]>("/v1/mock"),
  create: (jobId: string | null, interviewType: string, count: number) =>
    apiFetch<MockInterview>("/v1/mock", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, interview_type: interviewType, count }),
    }),
  answer: (id: string, index: number, answer: string) =>
    apiFetch<MockInterview>(`/v1/mock/${id}/turns/${index}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    }),
  finish: (id: string) => apiFetch<MockInterview>(`/v1/mock/${id}/finish`, { method: "POST" }),
  remove: (id: string) => apiFetch<void>(`/v1/mock/${id}`, { method: "DELETE" }),
};

/** Writes the review: always the numbers, and the coaching summary when the AI is available. */
export async function writeSessionReview(sessionId: string): Promise<void> {
  await apiFetch(`/v1/sessions/${sessionId}/review`, { method: "POST" });
  await hydrateFromBackend();
}

/** Ends a session from outside the live page (for example one left running in another tab). */
export async function endSessionById(sessionId: string): Promise<void> {
  await apiFetch(`/v1/sessions/${sessionId}/stop`, { method: "POST" });
  await hydrateFromBackend();
}

export interface LiveSessionHandle {
  sessionId: string;
  pairing: PairingCode;
  /** Answers already generated when resuming an existing session. */
  history: LiveAnswer[];
  refreshPairingCode: () => Promise<PairingCode>;
  revokePairing: () => Promise<void>;
  /** Types a question as if the interviewer had asked it, to test the flow without audio. */
  simulate: (text: string) => void;
  /** Sends a screenshot of a question or problem. Vren reads it and answers. */
  askImage: (image: Blob) => Promise<void>;
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
  opts: {
    jobId: string | null;
    retainTranscript: boolean;
    interviewType?: string;
    resumeSessionId?: string;
  },
  onEvent: (event: LiveServerEvent) => void,
  onConnection: (state: LiveConnection) => void,
): Promise<LiveSessionHandle> {
  // Resuming re-attaches to a session that is still running; otherwise a new one is created.
  let createdHere = false;
  let sessionId = opts.resumeSessionId ?? "";
  if (!sessionId) {
    const created = await apiFetch<BackendSessionDto>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        job_id: opts.jobId,
        state: "ready",
        transcript_retained: opts.retainTranscript,
        interview_type: opts.interviewType,
        rules_acknowledged: true,
      }),
    });
    sessionId = created.id;
    createdHere = true;
  }

  const fetchCode = async (): Promise<PairingCode> => {
    const res = await apiFetch<{ code: string; expires_at: string }>(
      `/v1/sessions/${sessionId}/pairing-code`,
      { method: "POST" },
    );
    return { code: res.code, expiresAt: res.expires_at };
  };
  let pairing: PairingCode;
  let tokenRes: { ws_token: string; ws_path: string };
  let history: LiveAnswer[] = [];
  try {
    pairing = await fetchCode();
    tokenRes = await apiFetch<{ ws_token: string; ws_path: string }>(
      `/v1/sessions/${sessionId}/token?role=display`,
      { method: "POST" },
    );
    if (opts.resumeSessionId) {
      const past = await apiFetch<BackendQuestionDto[]>(`/v1/sessions/${sessionId}/answers`);
      history = past
        .map((q) => ({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          asked_at: q.asked_at,
          framework: q.framework,
          answer: q.outline.join(" "),
          lines: q.outline,
          key_points: [],
          source_label: q.evidence_ref || "",
          caveat: q.caveat || "",
          code: q.code || "",
        }))
        .reverse();
    }
  } catch (err) {
    // Do not leave a half-created session behind when setup fails.
    if (createdHere)
      void apiFetch(`/v1/sessions/${sessionId}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }

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
    history,
    refreshPairingCode: fetchCode,
    revokePairing: async () => {
      await apiFetch(`/v1/sessions/${sessionId}/pairing/revoke`, { method: "POST" });
    },
    simulate: (text: string) => send({ type: "transcript.simulate", source: "tab", text }),
    askImage: async (image: Blob) => {
      const bytes = new Uint8Array(await image.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      send({ type: "image.ask", image: btoa(binary), mime: image.type || "image/png" });
    },
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
    void writeThrough(`/v1/sessions/${sessionId}/suggestions/${questionId}/feedback`, {
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
    void writeThrough(`/v1/sessions/${id}`, {
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
    void writeThrough(`/v1/sessions/${id}`, { method: "DELETE" });
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
    void writeThrough("/v1/preparation/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.answerLanguage !== undefined ? { answer_language: patch.answerLanguage } : {}),
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
    void writeThrough("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({ checklist_dismissed: true }),
    });
  }
}

/** Downloads the readable PDF report from the server. Falls back to a JSON file when offline/demo. */
export async function downloadReport(): Promise<string> {
  if (!hasAuthSession()) {
    const blob = new Blob([exportData()], { type: "application/json" });
    saveBlob(blob, "vren-ai-data.json");
    return "vren-ai-data.json";
  }
  const tokens = getStoredTokens();
  const res = await fetch(`${API_BASE}/v1/me/export.pdf`, {
    headers: tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {},
  });
  if (!res.ok) throw new Error("Could not make the report. Please try again.");
  saveBlob(await res.blob(), "vren-ai-report.pdf");
  return "vren-ai-report.pdf";
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export interface AiCheckResult {
  ok: boolean;
  message: string;
  providers: { name: string; label: string; ok: boolean; message: string }[];
  speech: { provider: string; ok: boolean; message: string };
  sample: { question: string; answer: string; seconds: number } | null;
}

/** Asks the server to try the AI and speech-to-text for real. */
export async function checkAi(): Promise<AiCheckResult> {
  return apiFetch<AiCheckResult>("/v1/ai/check", { method: "POST" });
}

export function exportData() {
  const { user, profile, jobs, sessions, preferences, consents } = getState();
  return JSON.stringify(
    { exportedAt: now(), user, profile, jobs, sessions, preferences, consents },
    null,
    2,
  );
}

/** Deletes on the server first; local state is only cleared once the server confirms. */
export async function deleteAllSessions(): Promise<void> {
  if (hasAuthSession()) {
    await apiFetch("/v1/sessions", { method: "DELETE" });
  }
  setState((s) => ({ ...s, sessions: [] }));
}

export async function deleteAccount(): Promise<void> {
  if (hasAuthSession()) {
    await apiFetch("/v1/me", { method: "DELETE" });
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
