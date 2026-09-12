"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch, authHeaders } from "@/lib/clientAuth";
import {
  JOB_TYPES,
  MAX_SKILLS,
  MAX_SKILL_LENGTH,
  cleanTagList,
  isJobType,
} from "@/lib/validation";
import {
  Alert,
  BADGE_TONES,
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  Card,
  Chip,
  Eyebrow,
  formatDate,
  Icon,
  inputClass,
  JobStateBadge,
  Label,
  PageHeading,
  Readout,
  Skeleton,
  Spinner,
} from "@/app/components/ui";

interface JobDetail {
  id: string;
  title: string;
  description: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
  /** A `Job` scalar; the detail route returns it alongside the rest. */
  skills?: string[] | null;
  companyId: string;
  isActive: boolean;
  createdAt: string;
  company?: { name: string } | null;
  _count?: { applications: number };
  /** Computed server-side; ownership is enforced there too. */
  isOwner?: boolean;
}

interface JobFormState {
  title: string;
  description: string;
  salary: string;
  experience: string;
  location: string;
  type: string;
  skills: string[];
  isActive: boolean;
}

/**
 * Every cap here mirrors what `PUT /api/jobs/:jobId` actually stores.
 *
 * `experience` in particular used to allow 100 characters in the form while the
 * route runs `cleanString(body.experience, 60)` — anything longer was accepted,
 * silently shortened on save, and the employer only found out by re-reading the
 * posting.
 */
const MAX_TITLE = 150;
const MAX_DESCRIPTION = 10000;
const MAX_EXPERIENCE = 60;
const MAX_SALARY = 100;
const MAX_LOCATION = 120;

/*
 * The skill caps are deliberately *not* re-declared here. `MAX_SKILLS` (25) and
 * `MAX_SKILL_LENGTH` (40) are imported from `lib/validation`, which is the same
 * module `cleanTagList` lives in and the same one `PUT /api/jobs/:jobId` calls
 * — so the counter, the input's `maxLength` and the server's truncation point
 * cannot drift apart the way the `experience` cap once did.
 */

/**
 * Single source of truth for form shape, so the dirty check compares like with
 * like.
 *
 * `skills` is copied out of the loaded posting verbatim rather than re-cleaned:
 * the baseline has to be exactly what the row holds, or a posting stored under
 * an older rule would render as "unsaved" the instant it loaded, and the
 * employer would be nagged into a write they never asked for.
 */
function toForm(job: JobDetail): JobFormState {
  return {
    title: job.title ?? "",
    description: job.description ?? "",
    salary: job.salary ?? "",
    experience: job.experience ?? "",
    location: job.location ?? "",
    type: job.type ?? "",
    skills: Array.isArray(job.skills)
      ? job.skills.filter((skill): skill is string => typeof skill === "string")
      : [],
    isActive: job.isActive,
  };
}

/* -------------------------------------------------------------------------- */
/* AI requests                                                                 */
/* -------------------------------------------------------------------------- */

/** The whole of what `POST /api/ai/assist { mode: 'job-skills' }` answers with. */
interface SkillsDraft {
  skills: string[];
}

type AiOutcome<T> =
  | { ok: true; data: T }
  /** `unavailable` is the 503: no key on this deployment, so stop offering it. */
  | { ok: false; unavailable: boolean; message: string };

const AI_FAILED = "That assistant is unavailable right now. Please try again in a moment.";

/**
 * Deliberately not `apiFetch`: that helper collapses every failure into one
 * Error message, and these callers have to tell "this deployment has no model"
 * (503, hide the feature and say nothing) apart from "the call failed" (502 or
 * a network blip, worth one toast).
 */
async function requestAi<T>(path: string, body: Record<string, unknown>): Promise<AiOutcome<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });

    if (res.status === 503) return { ok: false, unavailable: true, message: "" };

    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const message =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : AI_FAILED;
      return { ok: false, unavailable: false, message };
    }

    return { ok: true, data: data as T };
  } catch (error) {
    console.error("AI request failed:", error);
    return { ok: false, unavailable: false, message: AI_FAILED };
  }
}

/* -------------------------------------------------------------------------- */
/* Inclusivity check — POST /api/ai/review { mode: 'inclusivity' }             */
/* -------------------------------------------------------------------------- */

/** The three buckets the route returns, in the employer's language. */
const FINDING_LABELS: Record<string, string> = {
  exclusionary: "Narrows the pool",
  requirement: "Requirement worth questioning",
  jargon: "Insider jargon",
};

interface Finding {
  phrase: string;
  category: string;
  why: string;
  rewrite: string;
}

interface InclusivityReview {
  findings: Finding[];
  summary: string;
}

/**
 * Swaps the first occurrence of `phrase` for `rewrite`.
 *
 * The route guarantees `phrase` was located verbatim in the draft it was sent,
 * which is what makes a blind replace safe — but `String.replace` with a string
 * pattern also expands `$&`, `$1` and `$'` inside the *replacement*, and a
 * rewrite is arbitrary prose that may well contain a dollar sign. Going through
 * a replacer function turns that substitution off entirely.
 */
function applyRewrite(description: string, phrase: string, rewrite: string): string {
  return description.replace(phrase, () => rewrite);
}

/* -------------------------------------------------------------------------- */
/* Screening questions                                                         */
/* -------------------------------------------------------------------------- */

/** Every cap mirrors `PUT /api/jobs/:jobId/questions`, which is the authority. */
const MAX_QUESTIONS = 10;
const MAX_PROMPT_CHARS = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 80;
/** `POST /api/ai/screening` will not return more than this however many we ask. */
const MAX_SUGGESTIONS = 8;

const QUESTION_KINDS = [
  { value: "TEXT", label: "Short text" },
  { value: "BOOLEAN", label: "Yes / No" },
  { value: "SINGLE_CHOICE", label: "Pick one" },
  { value: "NUMBER", label: "Number" },
] as const;

type QuestionKind = (typeof QUESTION_KINDS)[number]["value"];

/** Stored as these two literals so a knockout comparison has something to match. */
const BOOLEAN_ANSWERS = ["Yes", "No"] as const;

interface QuestionDraft {
  /** Local only. React keys have to survive a reorder and an edit of the prompt. */
  key: string;
  /** Set for a question already stored against this posting. */
  id: string | null;
  prompt: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
  knockout: boolean;
  expected: string | null;
  /** From a suggestion, shown once; never sent to the server. */
  rationale: string;
}

/** What `GET | PUT /api/jobs/:jobId/questions` returns to the owning company. */
interface StoredQuestion {
  id: string;
  prompt: string;
  kind: string;
  options: string[];
  required: boolean;
  knockout?: boolean;
  expected?: string | null;
  position: number;
}

interface Suggestion {
  prompt: string;
  kind: string;
  options: string[];
  required: boolean;
  knockout: boolean;
  expected: string | null;
  rationale: string;
}

let questionKeySeed = 0;
const nextQuestionKey = () => `question-${(questionKeySeed += 1)}`;

function isQuestionKind(value: string): value is QuestionKind {
  return QUESTION_KINDS.some((kind) => kind.value === value);
}

/** Trims, drops empties and de-duplicates exactly the way the route does. */
function cleanOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of options) {
    const option = raw.trim().replace(/\s+/g, " ").slice(0, MAX_OPTION_CHARS);
    if (!option) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(option);
    if (cleaned.length >= MAX_OPTIONS) break;
  }
  return cleaned;
}

/** The answers a knockout could be compared against, or none. */
function answerChoices(question: QuestionDraft): string[] {
  if (question.kind === "BOOLEAN") return [...BOOLEAN_ANSWERS];
  if (question.kind === "SINGLE_CHOICE") return cleanOptions(question.options);
  // TEXT and NUMBER have no single correct form, so they can never be knockouts.
  return [];
}

/**
 * Keeps a draft in a shape the questions route would accept, so the editor can
 * never build a set that only fails at save time.
 *
 * Changing the answer type invalidates the choices and the expected answer, and
 * a knockout with nothing to compare against is dropped — the server drops it
 * too, and a checkbox that silently means nothing is worse than one that turns
 * itself off in front of you.
 */
function normaliseQuestion(question: QuestionDraft): QuestionDraft {
  const options = question.kind === "SINGLE_CHOICE" ? question.options : [];
  const choices = answerChoices({ ...question, options });
  const expected =
    question.expected && choices.includes(question.expected) ? question.expected : null;
  return { ...question, options, expected, knockout: question.knockout && expected !== null };
}

/** Client-side mirror of the route's per-question rules. */
function questionProblem(question: QuestionDraft, index: number): string | null {
  if (!question.prompt.trim()) return `Screening question ${index + 1} needs a prompt`;
  if (question.kind === "SINGLE_CHOICE" && cleanOptions(question.options).length < MIN_OPTIONS) {
    return `Screening question ${index + 1} needs at least ${MIN_OPTIONS} choices`;
  }
  return null;
}

/** The exact body `PUT /api/jobs/:jobId/questions` expects. */
function toQuestionPayload(questions: QuestionDraft[]) {
  return questions.map((question) => ({
    id: question.id,
    prompt: question.prompt.trim().slice(0, MAX_PROMPT_CHARS),
    kind: question.kind,
    options: question.kind === "SINGLE_CHOICE" ? cleanOptions(question.options) : [],
    required: question.required,
    knockout: question.knockout,
    expected: question.expected,
  }));
}

function storedToDraft(stored: StoredQuestion): QuestionDraft {
  return normaliseQuestion({
    key: nextQuestionKey(),
    id: stored.id,
    prompt: stored.prompt,
    kind: isQuestionKind(stored.kind) ? stored.kind : "TEXT",
    options: Array.isArray(stored.options) ? stored.options : [],
    required: stored.required !== false,
    knockout: stored.knockout === true,
    expected: stored.expected ?? null,
    rationale: "",
  });
}

/* -------------------------------------------------------------------------- */
/* Section model                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The same four numbered, collapsible sections the post form uses, so the two
 * halves of the authoring pair read as one editor. See the long note on `STEPS`
 * in `app/jobs/post/page.tsx` for the research behind the shape.
 *
 * The rail here reports *save state* rather than completeness: an existing
 * posting is already valid, and the only question worth answering at a glance
 * is which part of it has edits that have not gone out yet. That matters more
 * on this page than on the post form, because the screening questions save on
 * their own button — so "unsaved" was previously a single line at the bottom of
 * the page that could not tell the employer which of the two writes it meant.
 */
const SECTIONS = [
  {
    id: "role",
    number: "01",
    title: "The role",
    description: "Title and description — what the match engine reads.",
  },
  {
    id: "particulars",
    number: "02",
    title: "Particulars",
    description: "Type, location, pay and skills. Saves with the role above.",
  },
  {
    id: "availability",
    number: "03",
    title: "Availability",
    description: "Whether the posting is open to new applications.",
  },
  {
    id: "screening",
    number: "04",
    title: "Screening questions",
    description: "Saved separately, on their own button.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** `dirty` is the one state that asks for action; the rest are informational. */
type SectionTone = "saved" | "dirty" | "neutral";

function suggestionToDraft(suggestion: Suggestion): QuestionDraft {
  return normaliseQuestion({
    key: nextQuestionKey(),
    id: null,
    prompt: suggestion.prompt,
    kind: isQuestionKind(suggestion.kind) ? suggestion.kind : "TEXT",
    options: Array.isArray(suggestion.options) ? suggestion.options : [],
    required: suggestion.required !== false,
    knockout: suggestion.knockout === true,
    expected: suggestion.expected ?? null,
    rationale: suggestion.rationale ?? "",
  });
}

export default function EditJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = React.use(params);

  // Without this the effect below redirected to /auth/login on every refresh,
  // because Redux is still empty during the first paint.
  const { ready, allowed } = useAuthGuard(["COMPANY"]);
  const router = useRouter();
  const toast = useToast();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [formData, setFormData] = useState<JobFormState | null>(null);
  const [loading, setLoading] = useState(true);
  // Save and delete used to share one flag, so the Delete button read
  // "Deleting…" whenever a save was in flight.
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);

  // Optimistic: every assistive button is offered until an `/api/ai/*` route
  // answers 503 once, then hidden for the session. They all share one key.
  const [aiAvailable, setAiAvailable] = useState(true);

  /* ------------------------------ skill tags ------------------------------ */

  const [skillInput, setSkillInput] = useState("");
  /** Announced politely, so the tag list is usable without seeing it. */
  const [skillNotice, setSkillNotice] = useState("");
  const [suggestingSkills, setSuggestingSkills] = useState(false);

  /**
   * The live tag list. A suggestion request can resolve after the employer has
   * typed another tag, and the copy captured when the request went out would be
   * stale by then — so every write goes through `applySkills`, which updates
   * this ref first and the form second. Seeded from the posting on load.
   */
  const skillsRef = useRef<string[]>([]);

  /* --------------------------- inclusivity check -------------------------- */

  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<InclusivityReview | null>(null);
  /** Phrases already swapped in, so a done finding reads as done, not as stale. */
  const [appliedPhrases, setAppliedPhrases] = useState<string[]>([]);
  const [reviewNotice, setReviewNotice] = useState("");

  /* -------------------------- screening questions ------------------------- */

  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  /** Serialised payload as last loaded or saved — the dirty check compares to this. */
  const [questionsBaseline, setQuestionsBaseline] = useState("[]");
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [questionsError, setQuestionsError] = useState("");
  const [savingQuestions, setSavingQuestions] = useState(false);
  const [suggestingQuestions, setSuggestingQuestions] = useState(false);
  const [questionNotice, setQuestionNotice] = useState("");

  /* -------------------------------- loading ------------------------------- */

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError("");
        const data = await apiFetch<JobDetail>(`/api/jobs/${jobId}`);
        if (cancelled) return;
        const form = toForm(data);
        setJob(data);
        setFormData(form);
        // The ref is the tag editor's source of truth; seed it with whatever
        // this posting already stores, so an untouched editor is a no-op.
        skillsRef.current = form.skills;
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Failed to load this job");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, jobId]);

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    (async () => {
      try {
        setQuestionsLoading(true);
        setQuestionsError("");
        const data = await apiFetch<{ questions: StoredQuestion[] }>(
          `/api/jobs/${jobId}/questions`
        );
        if (cancelled) return;
        const drafts = (data.questions ?? []).map(storedToDraft);
        setQuestions(drafts);
        setQuestionsBaseline(JSON.stringify(toQuestionPayload(drafts)));
      } catch (err) {
        if (cancelled) return;
        // Non-fatal: the posting itself is still editable without this panel.
        setQuestionsError(
          err instanceof Error ? err.message : "Could not load the screening questions"
        );
      } finally {
        if (!cancelled) setQuestionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, jobId]);

  /* ------------------------------ dirty state ----------------------------- */

  const isDirty = useMemo(() => {
    if (!job || !formData) return false;
    return JSON.stringify(formData) !== JSON.stringify(toForm(job));
  }, [job, formData]);

  /**
   * Whether the employer has actually touched the tag list.
   *
   * `PUT /api/jobs/:jobId` is presence-gated on `'skills' in body`, so the key
   * is what hands this page ownership of the column. It is added to the payload
   * only when this is true: an employer who rewrites the description and never
   * opens the tag editor sends no `skills` key at all, and the stored tags are
   * left exactly as they were rather than round-tripped through `cleanTagList`.
   */
  const skillsChanged = useMemo(() => {
    if (!job || !formData) return false;
    return JSON.stringify(formData.skills) !== JSON.stringify(toForm(job).skills);
  }, [job, formData]);

  const questionsDirty = useMemo(
    () => JSON.stringify(toQuestionPayload(questions)) !== questionsBaseline,
    [questions, questionsBaseline]
  );

  /**
   * Dirtiness broken out per section, for the rail.
   *
   * Derived from the same `toForm(job)` baseline the whole-form check uses, so
   * a section can never claim to be saved while `isDirty` says otherwise.
   */
  const sectionDirty: Record<SectionId, boolean> = useMemo(() => {
    if (!job || !formData) {
      return { role: false, particulars: false, availability: false, screening: questionsDirty };
    }
    const stored = toForm(job);
    return {
      role: formData.title !== stored.title || formData.description !== stored.description,
      particulars:
        formData.type !== stored.type ||
        formData.location !== stored.location ||
        formData.salary !== stored.salary ||
        formData.experience !== stored.experience ||
        JSON.stringify(formData.skills) !== JSON.stringify(stored.skills),
      availability: formData.isActive !== stored.isActive,
      screening: questionsDirty,
    };
  }, [job, formData, questionsDirty]);

  const anythingUnsaved = isDirty || questionsDirty;

  /* ------------------------------- sections ------------------------------- */

  /**
   * Which section panels are open. All open by default — folding one away is a
   * convenience for an employer who has finished with it, never something the
   * page does to them. A collapsed panel is `hidden`, so its fields leave the
   * tab order, which is why `jumpToSection` re-opens before sending anyone.
   */
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    role: true,
    particulars: true,
    availability: true,
    screening: true,
  });

  const toggleSection = (id: SectionId) =>
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));

  const jumpToSection = (id: SectionId) => {
    setOpenSections((current) => ({ ...current, [id]: true }));
    // The panel has to be in the DOM before the browser will scroll to it.
    requestAnimationFrame(() => {
      document.getElementById(`section-toggle-${id}`)?.focus();
    });
  };

  // A reload or a tab close with edits pending used to lose them silently.
  // In-app navigation is covered by the confirm on Cancel and Back below.
  useEffect(() => {
    if (!anythingUnsaved || saving || savingQuestions || deleting) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anythingUnsaved, saving, savingQuestions, deleting]);

  // Read inside `confirmDiscard`, which is handed to a `<Link>` and so must not
  // be re-created on every keystroke for the handler to see current state.
  const unsavedRef = useRef(false);
  unsavedRef.current = anythingUnsaved;

  const confirmDiscard = useCallback((event: React.MouseEvent) => {
    if (!unsavedRef.current) return;
    if (!window.confirm("Leave without saving? Your changes will be lost.")) {
      event.preventDefault();
    }
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const target = e.target;
    const value =
      target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    setFormData((current) => (current ? { ...current, [target.name]: value } : current));
    setSaved(false);
  };

  /* ------------------------------ skill tags ------------------------------ */

  const applySkills = (next: string[]) => {
    skillsRef.current = next;
    setFormData((current) => (current ? { ...current, skills: next } : current));
    setSaved(false);
  };

  /**
   * Merges tags in without ever removing one the employer typed, and caps the
   * list where the server does so nothing is silently dropped on save.
   * Returns how many actually landed, for the announcement.
   */
  const mergeSkills = (incoming: string[]): number => {
    const current = skillsRef.current;
    const seen = new Set(current.map((skill) => skill.toLowerCase()));
    const room = Math.max(0, MAX_SKILLS - current.length);
    const additions: string[] = [];

    // `cleanTagList` is the server's own cleaner: it trims, collapses runs of
    // whitespace, cuts each tag at MAX_SKILL_LENGTH and drops duplicates. What
    // goes into the list is therefore already what the route would store.
    for (const tag of cleanTagList(incoming, MAX_SKILLS)) {
      if (additions.length >= room) break;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      additions.push(tag);
    }

    if (additions.length > 0) applySkills([...current, ...additions]);
    return additions.length;
  };

  const commitSkillInput = (raw: string) => {
    if (!raw.trim()) {
      setSkillInput("");
      return;
    }
    const wasFull = skillsRef.current.length >= MAX_SKILLS;
    const added = mergeSkills(raw.split(","));
    setSkillInput("");
    setSkillNotice(
      added > 0
        ? `${added === 1 ? "Skill added" : `${added} skills added`}. ${skillsRef.current.length} of ${MAX_SKILLS}. Not saved yet.`
        : wasFull
          ? `Skill limit reached — ${MAX_SKILLS} of ${MAX_SKILLS}.`
          : "That skill is already on the list."
    );
  };

  const removeSkill = (tag: string) => {
    const next = skillsRef.current.filter((skill) => skill !== tag);
    applySkills(next);
    setSkillNotice(`${tag} removed. ${next.length} of ${MAX_SKILLS}. Not saved yet.`);
  };

  const handleSkillKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Never let the tag editor submit the whole posting.
      event.preventDefault();
      commitSkillInput(skillInput);
      return;
    }
    if (event.key === "Backspace" && skillInput === "" && skillsRef.current.length > 0) {
      event.preventDefault();
      removeSkill(skillsRef.current[skillsRef.current.length - 1]);
    }
  };

  /** Same affordance as the post form: reads the description as it stands now. */
  const handleSuggestSkills = async () => {
    const title = formData?.title.trim() ?? "";
    const description = formData?.description.trim() ?? "";
    if (!title || !description || suggestingSkills) return;

    setSuggestingSkills(true);
    const outcome = await requestAi<SkillsDraft>("/api/ai/assist", {
      mode: "job-skills",
      title,
      description,
    });
    setSuggestingSkills(false);

    if (outcome.ok) {
      const added = mergeSkills(outcome.data.skills);
      setSkillNotice(
        added > 0
          ? `${added} suggested ${added === 1 ? "skill" : "skills"} added. Remove any that do not fit, then save.`
          : "No new skills to suggest — the list already covers the posting."
      );
      return;
    }
    if (outcome.unavailable) {
      setAiAvailable(false);
      return;
    }
    toast.error(outcome.message);
  };

  /* --------------------------- inclusivity check -------------------------- */

  const handleInclusivityCheck = async () => {
    const description = formData?.description.trim() ?? "";
    if (!description || reviewing) return;

    setReviewing(true);
    setReviewNotice("");
    const outcome = await requestAi<InclusivityReview>("/api/ai/review", {
      mode: "inclusivity",
      title: formData?.title.trim() || undefined,
      description,
    });
    setReviewing(false);

    if (outcome.ok) {
      setReview(outcome.data);
      // A previous run's applied list has nothing to do with this run's findings.
      setAppliedPhrases([]);
      const count = outcome.data.findings.length;
      setReviewNotice(
        count === 0
          ? "Wording check finished. Nothing flagged in this posting."
          : `Wording check finished. ${count} ${count === 1 ? "suggestion" : "suggestions"} to read.`
      );
      return;
    }
    if (outcome.unavailable) {
      setAiAvailable(false);
      return;
    }
    toast.error(outcome.message);
  };

  /**
   * One-click apply.
   *
   * The phrase was verbatim in the description when the check ran, but the
   * employer may have kept typing since. Re-checking against the live text here
   * is the difference between a safe replace and one that quietly does nothing
   * — and the button is already hidden in that case, so this is the guard for
   * the race where the text changes between paint and click.
   */
  const applyFinding = (finding: Finding) => {
    const current = formData?.description ?? "";

    if (!current.includes(finding.phrase)) {
      setReviewNotice(
        "That wording is no longer in the description. Run the check again so it reads the current text."
      );
      return;
    }

    const next = applyRewrite(current, finding.phrase, finding.rewrite);
    if (next.length > MAX_DESCRIPTION) {
      // Silently slicing here would cut the end off the posting to make room for
      // a suggestion the employer only asked to try.
      setReviewNotice(
        `That rewrite would push the description past ${MAX_DESCRIPTION.toLocaleString()} characters. Shorten the description first.`
      );
      return;
    }

    setFormData((form) => (form ? { ...form, description: next } : form));
    setAppliedPhrases((applied) => [...applied, finding.phrase]);
    setSaved(false);
    setReviewNotice(
      `Applied to the draft — not yet saved. “${finding.phrase}” is now “${finding.rewrite}”.`
    );
  };

  /* -------------------------- screening questions ------------------------- */

  const updateQuestion = (key: string, patch: Partial<QuestionDraft>) => {
    setQuestions((current) =>
      current.map((question) =>
        question.key === key ? normaliseQuestion({ ...question, ...patch }) : question
      )
    );
  };

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return;
    setQuestions((current) => [
      ...current,
      {
        key: nextQuestionKey(),
        id: null,
        prompt: "",
        kind: "TEXT",
        options: [],
        required: true,
        knockout: false,
        expected: null,
        rationale: "",
      },
    ]);
    setQuestionNotice(`Question ${questions.length + 1} added.`);
  };

  const removeQuestion = (key: string) => {
    const index = questions.findIndex((question) => question.key === key);
    if (index === -1) return;
    const question = questions[index];

    // Removing a stored question takes its collected answers with it — the
    // schema cascades — so this one needs asking about before it happens.
    if (
      question.id &&
      !window.confirm(
        `Remove question ${index + 1}? Any answers applicants have already given to it are deleted with it, and that cannot be undone.`
      )
    ) {
      return;
    }

    setQuestions((current) => current.filter((entry) => entry.key !== key));
    setQuestionNotice(`Question ${index + 1} removed. ${questions.length - 1} remaining.`);
  };

  /** Keyboard-operable reordering — no pointer-only drag handles. */
  const moveQuestion = (key: string, delta: -1 | 1) => {
    const index = questions.findIndex((question) => question.key === key);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= questions.length) return;

    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    setQuestions(next);
    setQuestionNotice(`Moved to position ${target + 1} of ${next.length}.`);
  };

  const handleSuggestQuestions = async () => {
    if (suggestingQuestions) return;

    const room = MAX_QUESTIONS - questions.length;
    if (room <= 0) {
      setQuestionNotice(`You already have the maximum of ${MAX_QUESTIONS} questions.`);
      return;
    }

    setSuggestingQuestions(true);
    // The posting exists, so the route reads it from the database rather than
    // from anything this form claims about it.
    const outcome = await requestAi<{ questions: Suggestion[]; filtered: number }>(
      "/api/ai/screening",
      { jobId, count: Math.min(room, MAX_SUGGESTIONS) }
    );
    setSuggestingQuestions(false);

    if (!outcome.ok) {
      if (outcome.unavailable) setAiAvailable(false);
      else toast.error(outcome.message);
      return;
    }

    const existing = new Set(questions.map((question) => question.prompt.trim().toLowerCase()));
    const additions: QuestionDraft[] = [];

    for (const suggestion of outcome.data.questions ?? []) {
      if (additions.length >= room) break;
      const key = (suggestion.prompt ?? "").trim().toLowerCase();
      if (!key || existing.has(key)) continue;
      existing.add(key);
      additions.push(suggestionToDraft(suggestion));
    }

    if (additions.length > 0) setQuestions((current) => [...current, ...additions]);
    setQuestionNotice(
      additions.length > 0
        ? `${additions.length} suggested ${additions.length === 1 ? "question" : "questions"} added below. They are not saved until you save the set.`
        : "No new questions to suggest for this posting."
    );
  };

  const handleSaveQuestions = async () => {
    if (savingQuestions) return;

    setQuestionsError("");

    for (let index = 0; index < questions.length; index += 1) {
      const problem = questionProblem(questions[index], index);
      if (problem) {
        setQuestionsError(problem);
        return;
      }
    }

    // Anything stored that is not in the set any more is about to be deleted,
    // and its answers go with it.
    const keptIds = new Set(questions.map((question) => question.id).filter(Boolean));
    const baseline = JSON.parse(questionsBaseline) as { id: string | null }[];
    const removed = baseline.filter((entry) => entry.id && !keptIds.has(entry.id)).length;

    if (
      removed > 0 &&
      !window.confirm(
        `Saving removes ${removed} question${removed === 1 ? "" : "s"} from this posting. Any answers applicants already gave to ${removed === 1 ? "it" : "them"} are deleted too, and that cannot be undone.`
      )
    ) {
      return;
    }

    setSavingQuestions(true);

    try {
      const data = await apiFetch<{ questions: StoredQuestion[] }>(
        `/api/jobs/${jobId}/questions`,
        { method: "PUT", body: JSON.stringify({ questions: toQuestionPayload(questions) }) }
      );
      // Re-seed from the response: newly created questions come back with ids,
      // and without them the next save would recreate rather than update them.
      const drafts = (data.questions ?? []).map(storedToDraft);
      setQuestions(drafts);
      setQuestionsBaseline(JSON.stringify(toQuestionPayload(drafts)));
      setQuestionNotice("Screening questions saved.");
      toast.success("Screening questions saved.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not save the screening questions";
      setQuestionsError(message);
      toast.error(message);
    } finally {
      setSavingQuestions(false);
    }
  };

  /* -------------------------------- submit -------------------------------- */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt and braces alongside the disabled button: a second Enter press while
    // the request is in flight must not send a second save.
    if (!formData || saving || deleting) return;

    setFormError("");

    const title = formData.title.trim();
    const description = formData.description.trim();

    /*
     * Every refusal names the section that owns it and sends the employer
     * there. A message about a field inside a folded-away panel is a dead end —
     * the same treatment the post form gives its own blockers.
     */
    const refuse = (message: string, section: SectionId) => {
      setFormError(message);
      jumpToSection(section);
    };

    if (!title) {
      refuse("Job title is required", "role");
      return;
    }
    if (!description) {
      refuse("Job description is required", "role");
      return;
    }
    if (!isJobType(formData.type)) {
      refuse("Choose a job type", "particulars");
      return;
    }

    // Recomputed from the ref rather than read off the memo above: a tag
    // committed by the input's own blur as the save button went down is already
    // in the ref, and this is the check that decides whether it is sent at all.
    const storedSkills = job ? toForm(job).skills : skillsRef.current;
    const skillsTouched = JSON.stringify(skillsRef.current) !== JSON.stringify(storedSkills);

    // Everything the editor adds has already been through `cleanTagList`, so
    // this only bites on a posting that was stored over the caps. Refusing is
    // the point: sending it anyway would have the route quietly drop the tail,
    // and the form would then claim a list the row does not hold.
    if (
      skillsTouched &&
      JSON.stringify(cleanTagList(skillsRef.current)) !== JSON.stringify(skillsRef.current)
    ) {
      refuse(
        `Skills: keep to ${MAX_SKILLS} tags of at most ${MAX_SKILL_LENGTH} characters each. Remove the extras — saving would drop them without telling you.`,
        "particulars"
      );
      return;
    }

    const payload = {
      title,
      description,
      salary: formData.salary.trim() || null,
      experience: formData.experience.trim() || null,
      location: formData.location.trim() || null,
      type: formData.type,
      isActive: formData.isActive,
      // Presence-gated on the route. The key only appears once the tag editor
      // has been used, so an untouched editor cannot clear the stored tags —
      // and when it does appear it carries the ref, which already holds a tag
      // committed by the input's own blur as the save button went down.
      ...(skillsTouched ? { skills: skillsRef.current } : {}),
    };

    setSaving(true);

    try {
      await apiFetch(`/api/jobs/${jobId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      // Merge locally rather than trusting the response shape, so the dirty
      // check resets against exactly what we sent.
      const updated: JobDetail | null = job ? { ...job, ...payload } : null;
      if (updated) {
        const form = toForm(updated);
        setJob(updated);
        setFormData(form);
        // The tags we sent were already in the shape `cleanTagList` produces,
        // so what the route stored is what this baseline now holds.
        skillsRef.current = form.skills;
      }
      setSaved(true);
      toast.success("Job details saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update job";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!job || deleting || saving) return;

    const count = job._count?.applications ?? 0;
    // Applications now cascade with the job, so the confirm has to say so.
    const consequence =
      count > 0 ? ` Its ${count} application${count === 1 ? "" : "s"} will also be removed.` : "";

    if (!window.confirm(`Delete "${job.title}"?${consequence} This cannot be undone.`)) {
      return;
    }

    setFormError("");
    setDeleting(true);

    try {
      const result = await apiFetch<{ message: string; deletedApplications: number }>(
        `/api/jobs/${jobId}`,
        { method: "DELETE" }
      );

      const removed = result?.deletedApplications ?? 0;
      toast.success(
        removed > 0
          ? `Job deleted, along with ${removed} application${removed === 1 ? "" : "s"}.`
          : "Job deleted."
      );
      // `deleting` already suppresses the unload warning, and the posting this
      // form was editing no longer exists to be saved.
      router.push("/company/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete job";
      setFormError(message);
      toast.error(message);
      setDeleting(false);
    }
  }, [job, jobId, router, toast, deleting, saving]);

  /* ---------------------------------------------------------------------- */

  if (!ready || !allowed) {
    /*
     * `useAuthGuard` is already redirecting. Hold this page's own shell rather
     * than swapping the whole viewport for a centred spinner: the navbar
     * staying put is the difference between "still loading" and "something went
     * wrong", and the blocks below are the size of what replaces them, so
     * nothing jumps. Same reasoning as the sibling `loading.tsx`.
     */
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navbar />
        <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <p className="sr-only" role="status">
            Loading this posting
          </p>
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-2.5 h-8 w-40" />
          <Skeleton className="mt-3 h-4 w-full max-w-sm" />
          <Skeleton className="mt-6 h-28 w-full rounded-xl" />
          <Skeleton className="mt-4 h-72 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  const notOwner = job?.isOwner === false;
  const descriptionLength = formData?.description.length ?? 0;
  const atDescriptionLimit = descriptionLength >= MAX_DESCRIPTION;
  const descriptionFilled = (formData?.description.trim().length ?? 0) > 0;
  const questionsFull = questions.length >= MAX_QUESTIONS;

  const skills = formData?.skills ?? [];
  const skillsFull = skills.length >= MAX_SKILLS;
  // The assistant reads *from* the posting; with no description it has nothing
  // to extract, which on this page can only happen mid-rewrite.
  const canSuggestSkills = (formData?.title.trim().length ?? 0) > 0 && descriptionFilled;
  /**
   * A posting stored before these caps existed can be over them. Saying so is
   * the whole point: the alternative is `cleanTagList` quietly dropping the tail
   * on the next save and the employer finding out by re-reading the posting.
   */
  const skillsOverCap =
    skills.length > MAX_SKILLS || skills.some((skill) => skill.length > MAX_SKILL_LENGTH);

  /* ----------------------------- section state ---------------------------- */

  /** What each section's pill says. Derived, so it cannot drift from the saves. */
  const sectionStatus: Record<SectionId, { tone: SectionTone; label: string }> = {
    role: sectionDirty.role ? { tone: "dirty", label: "Unsaved" } : { tone: "saved", label: "Saved" },
    particulars: sectionDirty.particulars
      ? { tone: "dirty", label: "Unsaved" }
      : { tone: "saved", label: "Saved" },
    availability: sectionDirty.availability
      ? { tone: "dirty", label: "Unsaved" }
      : { tone: "neutral", label: formData?.isActive ? "Open" : "Closed" },
    screening: questionsLoading
      ? { tone: "neutral", label: "Loading" }
      : sectionDirty.screening
        ? { tone: "dirty", label: "Unsaved" }
        : {
            tone: "neutral",
            label:
              questions.length === 0
                ? "None"
                : `${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
          },
  };

  const unsavedSections = (Object.keys(sectionDirty) as SectionId[]).filter(
    (id) => sectionDirty[id]
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/company/dashboard"
          onClick={confirmDiscard}
          className={`${buttonGhost} -ml-2.5 mb-4`}
        >
          <Icon.arrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        {loading ? (
          <div className="flex justify-center py-20 text-blue-600 dark:text-blue-400">
            <Spinner label="Loading job details…" />
          </div>
        ) : loadError || !job || !formData ? (
          <Card className="p-6 text-center sm:p-8">
            <Alert variant="error" className="mb-5 text-left">
              {loadError || "Job not found"}
            </Alert>
            <Link href="/company/dashboard" className={buttonPrimary}>
              Back to dashboard
            </Link>
          </Card>
        ) : notOwner ? (
          <Card className="p-6 text-center sm:p-8">
            <Alert variant="warning" className="mb-5 text-left">
              You can only edit jobs from your company.
            </Alert>
            <Link href={`/jobs/${jobId}`} className={buttonSecondary}>
              View the posting instead
            </Link>
          </Card>
        ) : (
          <>
            <div className="mb-6">
              <PageHeading
                eyebrow="Company · Edit posting"
                title="Edit job"
                description={job.title}
                action={
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting || saving}
                    className={`${buttonDanger} w-full sm:w-auto`}
                  >
                    <Icon.trash className="h-4 w-4" />
                    {deleting ? "Deleting…" : "Delete job"}
                  </button>
                }
              />

              {/* Record telemetry for this posting: counts and timestamps are
                  machine values, so they are captioned and set in mono. */}
              <div className="mt-5 flex flex-wrap items-start gap-x-10 gap-y-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                <div>
                  <Eyebrow>Applications</Eyebrow>
                  <Readout className="mt-1 block text-xl font-semibold leading-none">
                    {typeof job._count?.applications === "number" ? job._count.applications : "—"}
                  </Readout>
                </div>
                <div>
                  <Eyebrow>Posted</Eyebrow>
                  <Readout className="mt-1 block text-xl font-semibold leading-none">
                    {formatDate(job.createdAt) || "—"}
                  </Readout>
                </div>
              </div>
            </div>

            {formError && (
              <Alert variant="error" className="mb-6">
                <span id="edit-job-error">{formError}</span>
              </Alert>
            )}

            {saved && !isDirty && (
              <Alert variant="success" className="mb-6">
                Job details saved.{" "}
                <Link href={`/jobs/${job.id}`} className="font-medium underline underline-offset-2">
                  View the posting
                </Link>
              </Alert>
            )}

            <SectionRail
              status={sectionStatus}
              unsaved={unsavedSections}
              onJump={jumpToSection}
            />

            <form onSubmit={handleSubmit} noValidate>
              <div className="mt-4 space-y-3">
                <SectionCard
                  section={SECTIONS[0]}
                  status={sectionStatus.role}
                  open={openSections.role}
                  onToggle={() => toggleSection("role")}
                >
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="title" required>
                        Job title
                      </Label>
                      <input
                        type="text"
                        id="title"
                        name="title"
                        value={formData.title}
                        onChange={handleChange}
                        required
                        maxLength={MAX_TITLE}
                        aria-describedby="title-hint"
                        className={inputClass}
                      />
                      {/* Counters are machine output, so they sit in mono and
                          align right, clear of the label. */}
                      <p id="title-hint" className="mt-1.5 text-right">
                        <Readout className="text-xs text-gray-500 dark:text-gray-400">
                          {formData.title.length}/{MAX_TITLE}
                        </Readout>
                      </p>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <Label htmlFor="description" required>
                          Job description
                        </Label>
                        {/* Same affordance as the post form: one button, a
                            result panel under the field, nothing applied until
                            asked. */}
                        {aiAvailable && (
                          <button
                            type="button"
                            onClick={() => void handleInclusivityCheck()}
                            disabled={!descriptionFilled || reviewing}
                            className={`${buttonGhost} mb-2 disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {reviewing ? (
                              <>
                                <Spinner className="h-4 w-4" />
                                Reading the posting…
                              </>
                            ) : (
                              <>
                                <Icon.spark className="h-4 w-4" />
                                Check the wording
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      <textarea
                        id="description"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        required
                        rows={8}
                        maxLength={MAX_DESCRIPTION}
                        aria-describedby="description-hint"
                        className={inputClass}
                      />
                      <p id="description-hint" className="mt-1.5 text-right">
                        <Readout
                          className={`text-xs ${
                            atDescriptionLimit
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {descriptionLength.toLocaleString()}/{MAX_DESCRIPTION.toLocaleString()}
                          {atDescriptionLimit ? " · limit reached" : ""}
                        </Readout>
                      </p>

                      {review && (
                        <Card grid className="mt-3 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                              <Icon.spark className="h-4 w-4" />
                              <Eyebrow as="span" accent>
                                Wording check · advisory
                              </Eyebrow>
                            </span>
                            <Readout className="text-xs text-gray-500 dark:text-gray-400">
                              {review.findings.length}{" "}
                              {review.findings.length === 1 ? "finding" : "findings"}
                            </Readout>
                          </div>

                          {review.summary && (
                            <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                              {review.summary}
                            </p>
                          )}

                          <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                            Suggestions only — none of this blocks the posting or your save. Apply
                            what you agree with and ignore the rest.
                          </p>

                          {review.findings.length === 0 ? (
                            <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                              Nothing flagged in this posting.
                            </p>
                          ) : (
                            <ul className="mt-3 space-y-3">
                              {review.findings.map((finding) => {
                                const done = appliedPhrases.includes(finding.phrase);
                                // Recomputed every render, so the button goes the
                                // moment the employer edits that wording away.
                                const stillPresent = formData.description.includes(finding.phrase);

                                return (
                                  <li
                                    key={finding.phrase}
                                    className="panel-sunken p-3"
                                  >
                                    <Eyebrow>
                                      {FINDING_LABELS[finding.category] ?? "Worth a second look"}
                                    </Eyebrow>

                                    <p className="mt-1.5 text-sm text-gray-900 dark:text-white">
                                      <q className="font-medium">{finding.phrase}</q>
                                    </p>

                                    <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                      {finding.why}
                                    </p>

                                    <div className="mt-2.5 border-l-2 border-green-500 bg-green-50 py-1.5 pl-3 dark:bg-green-950/30">
                                      <Eyebrow>Suggested wording</Eyebrow>
                                      <p className="mt-1 text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                                        {finding.rewrite}
                                      </p>
                                    </div>

                                    {done ? (
                                      <p className="eyebrow mt-2.5 flex items-center gap-1.5">
                                        <Icon.check className="h-3.5 w-3.5" />
                                        Applied · save to publish it
                                      </p>
                                    ) : stillPresent ? (
                                      <button
                                        type="button"
                                        onClick={() => applyFinding(finding)}
                                        className={`${buttonSecondary} mt-2.5 w-full sm:w-auto`}
                                      >
                                        <Icon.check className="h-4 w-4" />
                                        Use this wording
                                      </button>
                                    ) : (
                                      /* The employer edited the text after the
                                         check ran. We will not guess at a
                                         near-match. */
                                      <p className="mt-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                                        This wording is no longer in the description. Run the check
                                        again to read the current text.
                                      </p>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                            <button
                              type="button"
                              onClick={() => {
                                setReview(null);
                                setAppliedPhrases([]);
                                setReviewNotice("Wording check dismissed.");
                              }}
                              className={buttonGhost}
                            >
                              <Icon.x className="h-4 w-4" />
                              Dismiss
                            </button>
                          </div>
                        </Card>
                      )}

                      <p aria-live="polite" className="eyebrow mt-1.5 normal-case tracking-normal">
                        {reviewNotice}
                      </p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  section={SECTIONS[1]}
                  status={sectionStatus.particulars}
                  open={openSections.particulars}
                  onToggle={() => toggleSection("particulars")}
                >
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="type" required hint="Candidates filter the feed by this.">
                        Job type
                      </Label>
                      <select
                        id="type"
                        name="type"
                        value={formData.type}
                        onChange={handleChange}
                        required
                        className={inputClass}
                      >
                        <option value="">Select a job type</option>
                        {JOB_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <Label
                        htmlFor="location"
                        hint="Optional. Leave empty if the location is flexible."
                      >
                        Location
                      </Label>
                      <input
                        type="text"
                        id="location"
                        name="location"
                        value={formData.location}
                        onChange={handleChange}
                        placeholder="e.g. Bangalore, or Remote"
                        maxLength={MAX_LOCATION}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="salary"
                        hint="Optional, but postings that state pay get noticeably more applicants."
                      >
                        Salary range
                      </Label>
                      <input
                        type="text"
                        id="salary"
                        name="salary"
                        value={formData.salary}
                        onChange={handleChange}
                        placeholder="e.g. ₹18–25 LPA"
                        maxLength={MAX_SALARY}
                        className={inputClass}
                      />
                    </div>

                    <div>
                      <Label
                        htmlFor="experience"
                        hint="Optional. Free text — write it the way candidates would read it."
                      >
                        Experience
                      </Label>
                      <input
                        type="text"
                        id="experience"
                        name="experience"
                        value={formData.experience}
                        onChange={handleChange}
                        placeholder="e.g. 3–5 years"
                        maxLength={MAX_EXPERIENCE}
                        className={inputClass}
                      />
                    </div>

                    {/* Skills are a facet of the match score in their own right
                        (`scoreSkills`, weighted 0.18), so a posting that gets
                        rewritten without them keeps scoring against the role it
                        used to be. Same editor as the post form, and it saves on
                        the same button as the rest of the job details. */}
                    <div className="sm:col-span-2">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                        <Label
                          htmlFor="skill-input"
                          hint="Optional. Press Enter or type a comma to add a tag."
                        >
                          Skills
                        </Label>
                        {aiAvailable && (
                          <button
                            type="button"
                            onClick={() => void handleSuggestSkills()}
                            disabled={!canSuggestSkills || suggestingSkills || skillsFull}
                            aria-describedby={canSuggestSkills ? undefined : "skills-ai-hint"}
                            className={`${buttonGhost} mb-2 disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {suggestingSkills ? (
                              <>
                                <Spinner className="h-4 w-4" />
                                Reading the posting…
                              </>
                            ) : (
                              <>
                                <Icon.spark className="h-4 w-4" />
                                Suggest skills
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {skills.length > 0 && (
                        <ul className="mb-2 flex flex-wrap gap-1.5">
                          {skills.map((skill) => (
                            <li key={skill}>
                              <Chip>
                                {skill}
                                {/* Named for the tag it removes, and 24px
                                    square so it is hittable on a phone without
                                    inflating the chip. */}
                                <button
                                  type="button"
                                  onClick={() => removeSkill(skill)}
                                  aria-label={`Remove ${skill}`}
                                  // gray-500, not gray-400: the lighter grey sat
                                  // at about 2.8:1 on the chip's own background
                                  // in light mode. Matches the post form.
                                  className="-my-1 -mr-1.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-100"
                                >
                                  <Icon.x className="h-3 w-3" />
                                </button>
                              </Chip>
                            </li>
                          ))}
                        </ul>
                      )}

                      <input
                        type="text"
                        id="skill-input"
                        value={skillInput}
                        onChange={(event) => {
                          const value = event.target.value;
                          // Handles both the comma key and a pasted list.
                          if (value.includes(",")) commitSkillInput(value);
                          else setSkillInput(value);
                        }}
                        onKeyDown={handleSkillKeyDown}
                        onBlur={() => commitSkillInput(skillInput)}
                        disabled={skillsFull}
                        // Sized for a pasted *list*, not for one tag — the same
                        // fix the post form carries, which had not been brought
                        // across. `MAX_SKILL_LENGTH` here meant the browser
                        // applied the cap to the paste itself, so pasting
                        // "React, TypeScript, Node.js, PostgreSQL, Kubernetes"
                        // was clipped to 40 characters before `onChange` ever
                        // saw a comma to split on. Each individual tag is still
                        // cut to `MAX_SKILL_LENGTH` by `cleanTagList` when it is
                        // committed, which is the same code the API runs.
                        maxLength={MAX_SKILL_LENGTH * MAX_SKILLS}
                        placeholder={
                          skillsFull ? "Skill limit reached" : "e.g. TypeScript, Postgres, Figma"
                        }
                        className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                      />

                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                        <p id="skills-ai-hint" className="eyebrow">
                          {aiAvailable && !canSuggestSkills
                            ? "Write a description to suggest skills from"
                            : "Backspace on an empty field removes the last tag"}
                        </p>
                        <Readout
                          className={`text-xs ${
                            skillsFull
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {skills.length}/{MAX_SKILLS}
                        </Readout>
                      </div>

                      {skillsOverCap && (
                        <p className="mt-1.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                          This posting stores more than {MAX_SKILLS} tags, or a tag longer than{" "}
                          {MAX_SKILL_LENGTH} characters — more than the posting can hold. Editing
                          the tags is fine, but the save will ask you to trim the list first rather
                          than cut it for you.
                        </p>
                      )}

                      {skillsChanged && (
                        <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                          Saved with the job details, on the button below. Changing the tags
                          re-indexes this posting for matching, so give it a moment to settle before
                          judging the candidate list.
                        </p>
                      )}

                      <p aria-live="polite" className="eyebrow mt-1 normal-case tracking-normal">
                        {skillNotice}
                      </p>
                    </div>
                  </div>
                </SectionCard>

                {/* A bare checkbox never explained what "active" actually does,
                    so the state badge and its consequence lead, and the control
                    itself sits on the right as a switch. It is a section of its
                    own now: it is the one control on this page with an
                    immediate, public consequence, and it was previously an
                    unlabelled box between the skill editor and the save row. */}
                <SectionCard
                  section={SECTIONS[2]}
                  status={sectionStatus.availability}
                  open={openSections.availability}
                  onToggle={() => toggleSection("availability")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-[14rem] flex-1">
                    <JobStateBadge isActive={formData.isActive} />
                    <p
                      id="isActive-hint"
                      className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
                    >
                      {formData.isActive
                        ? "The job is listed on the public feed and candidates can apply."
                        : "Closing the job hides it from the public feed and stops new applications. Applications you have already received are kept."}
                    </p>
                  </div>

                  <label
                    htmlFor="isActive"
                    className="flex flex-shrink-0 cursor-pointer items-center gap-3"
                  >
                    <span className="eyebrow">Open for applications</span>
                    {/* The checkbox stays a real checkbox — visually hidden but
                        focusable — and the track/knob are its siblings, so the
                        switch is driven entirely by `peer-checked`. */}
                    <span className="relative inline-flex h-6 w-11 flex-shrink-0 items-center">
                      <input
                        type="checkbox"
                        id="isActive"
                        name="isActive"
                        checked={formData.isActive}
                        onChange={handleChange}
                        aria-describedby="isActive-hint"
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className="block h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-green-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 dark:bg-gray-600 dark:peer-checked:bg-green-500"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5"
                      />
                    </span>
                  </label>
                  </div>
                </SectionCard>

                {/* Scoped deliberately, and sitting outside the section cards
                    so it reads as the action for the three of them together.
                    With the questions saving on their own button below,
                    "everything is saved" was a claim this line had no way of
                    making good on. */}
                <div className="panel flex flex-col-reverse gap-3 p-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
                  <p className="eyebrow text-center sm:mr-auto sm:text-left" aria-live="polite">
                    {isDirty ? "Unsaved job details" : "Job details are saved"}
                  </p>
                  <Link
                    href="/company/dashboard"
                    onClick={confirmDiscard}
                    className={`${buttonSecondary} w-full sm:w-auto`}
                  >
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={saving || deleting || !isDirty}
                    aria-busy={saving || undefined}
                    aria-describedby={formError ? "edit-job-error" : undefined}
                    className={`${buttonPrimary} w-full sm:w-auto`}
                  >
                    {saving ? (
                      <>
                        <Spinner className="h-4 w-4" decorative />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Icon.check className="h-4 w-4" />
                        Save job details
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>

            {/* Screening questions live on their own route, so they save on
                their own button. Folding them into the form above would make
                one "Save job details" mean two independent writes, either of
                which can fail without the other. The skill tags, by contrast,
                are columns on the job row and go out with that same PUT. That
                is why this section sits outside the `<form>` while still
                carrying its number in the same sequence. */}
            <div className="mt-3">
              <SectionCard
                section={SECTIONS[3]}
                status={sectionStatus.screening}
                open={openSections.screening}
                onToggle={() => toggleSection("screening")}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <p className="min-w-0 flex-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                    Applicants answer these when they apply, and you see the answers on the
                    application. Up to {MAX_QUESTIONS}. They save on their own button, separately
                    from the job details above.
                  </p>
                  {aiAvailable && (
                    <button
                      type="button"
                      onClick={() => void handleSuggestQuestions()}
                      disabled={suggestingQuestions || questionsFull || questionsLoading}
                      className={`${buttonGhost} flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {suggestingQuestions ? (
                        <>
                          <Spinner className="h-4 w-4" />
                          Drafting…
                        </>
                      ) : (
                        <>
                          <Icon.spark className="h-4 w-4" />
                          Suggest questions
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="mt-4">
                {questionsError && (
                  <Alert variant="error" className="mb-4">
                    {questionsError}
                  </Alert>
                )}

                <p className="sr-only" role="status">
                  {questionsLoading ? "Loading screening questions" : ""}
                </p>

                {questionsLoading ? (
                  // Skeleton rather than a centred spinner: this block is
                  // replaced by full question editors, and a short spinner box
                  // growing into a tall list is the page's biggest layout shift.
                  <ol className="space-y-4" aria-hidden="true">
                    {Array.from({ length: 2 }, (_, index) => (
                      <li
                        key={index}
                        className="rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:p-4"
                      >
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="mt-3 h-16 w-full rounded-lg" />
                        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Skeleton className="h-11 w-full rounded-lg" />
                          <Skeleton className="h-11 w-full rounded-lg" />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <>
                    {questions.length === 0 ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        This posting has no screening questions. Candidates apply with a message and
                        a résumé only.
                      </p>
                    ) : (
                      <ol className="space-y-4">
                        {questions.map((question, index) => (
                          <QuestionEditor
                            key={question.key}
                            question={question}
                            index={index}
                            total={questions.length}
                            onChange={updateQuestion}
                            onMove={moveQuestion}
                            onRemove={removeQuestion}
                          />
                        ))}
                      </ol>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={addQuestion}
                        disabled={questionsFull}
                        className={`${buttonSecondary} disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <Icon.plus className="h-4 w-4" />
                        Add a question
                      </button>
                      <Readout className="text-xs text-gray-500 dark:text-gray-400">
                        {questions.length}/{MAX_QUESTIONS}
                      </Readout>
                    </div>

                    <p aria-live="polite" className="eyebrow mt-2 normal-case tracking-normal">
                      {questionNotice}
                    </p>

                    <div className="mt-5 flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-end">
                      <p className="eyebrow text-center sm:mr-auto sm:text-left" aria-live="polite">
                        {questionsDirty ? "Unsaved question changes" : "Questions are saved"}
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleSaveQuestions()}
                        disabled={savingQuestions || !questionsDirty}
                        aria-busy={savingQuestions || undefined}
                        className={`${buttonPrimary} w-full sm:w-auto`}
                      >
                        {savingQuestions ? (
                          <>
                            <Spinner className="h-4 w-4" decorative />
                            Saving…
                          </>
                        ) : (
                          <>
                            <Icon.check className="h-4 w-4" />
                            Save questions
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
                </div>
              </SectionCard>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces                                                                */
/* -------------------------------------------------------------------------- */

/*
 * `SectionRail` and `SectionCard` are the post form's `StepRail` / `StepCard`
 * with save state in place of completion state. They are defined here rather
 * than in `ui.tsx` for the same reason they are defined there: a stepped
 * authoring form is these two pages' problem, not the design system's, and the
 * kit is owned elsewhere. If a third surface needs them, that is the moment to
 * promote them.
 */

/** Tone map for a section's state pill. Not colour alone — each carries a word. */
const SECTION_PILL_STYLES: Record<SectionTone, string> = {
  saved: BADGE_TONES.green,
  dirty: BADGE_TONES.amber,
  neutral: BADGE_TONES.neutral,
};

function SectionPill({ tone, label }: { tone: SectionTone; label: string }) {
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider ${SECTION_PILL_STYLES[tone]}`}
    >
      {tone === "saved" && <Icon.check className="h-3 w-3 flex-shrink-0" />}
      {tone === "dirty" && <Icon.warning className="h-3 w-3 flex-shrink-0" />}
      {label}
    </span>
  );
}

/**
 * Progress rail for the four sections.
 *
 * Sticky from `sm` up, where there is vertical room to spare: a page that saves
 * in two independent writes needs a persistent answer to "what have I not saved
 * yet", and one that scrolls off the top is not one. Below the navbar's `z-40`
 * so it can never cover the primary navigation.
 */
function SectionRail({
  status,
  unsaved,
  onJump,
}: {
  status: Record<SectionId, { tone: SectionTone; label: string }>;
  unsaved: number;
  onJump: (id: SectionId) => void;
}) {
  return (
    <div className="panel p-3 sm:sticky sm:top-16 sm:z-20 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Eyebrow as="h2">Edit posting · {SECTIONS.length} sections</Eyebrow>
        <Eyebrow as="span" className={unsaved > 0 ? "text-amber-700 dark:text-amber-400" : ""}>
          {unsaved === 0
            ? "Everything saved"
            : `${unsaved} ${unsaved === 1 ? "section" : "sections"} unsaved`}
        </Eyebrow>
      </div>

      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onJump(section.id)}
              className="interactive flex w-full flex-col items-start gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-left dark:border-gray-700"
            >
              <span className="flex w-full min-w-0 items-baseline gap-1.5">
                <Readout className="text-xs text-gray-500 dark:text-gray-400">
                  {section.number}
                </Readout>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900 dark:text-white">
                  {section.title}
                </span>
              </span>
              <span
                className={`mono truncate text-[10px] uppercase tracking-wider ${
                  status[section.id].tone === "dirty"
                    ? "text-amber-700 dark:text-amber-400"
                    : status[section.id].tone === "saved"
                      ? "text-green-700 dark:text-green-400"
                      : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {status[section.id].label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One collapsible section.
 *
 * APG accordion shape: the toggle is a `button` and the only child of the
 * heading, it carries `aria-expanded` and `aria-controls`, and the panel is
 * `hidden` rather than unmounted so `aria-controls` always points at a real
 * element and the browser's in-page search can still find a folded field.
 *   https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
 */
function SectionCard({
  section,
  status,
  open,
  onToggle,
  children,
}: {
  section: (typeof SECTIONS)[number];
  status: { tone: SectionTone; label: string };
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const panelId = `section-panel-${section.id}`;

  return (
    // `scroll-mt` clears the sticky navbar, and the sticky rail on top of it
    // from `sm` up — without it a jumped-to section lands underneath both.
    <section id={`section-${section.id}`} className="panel scroll-mt-20 sm:scroll-mt-40">
      <h2>
        <button
          type="button"
          id={`section-toggle-${section.id}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="interactive flex w-full items-start gap-3 rounded-xl px-4 py-4 text-left focus-inset sm:px-6"
        >
          <Readout className="mt-0.5 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {section.number}
          </Readout>

          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
              {section.title}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {section.description}
            </span>
          </span>

          <span className="flex flex-shrink-0 items-center gap-2">
            <span className="hidden sm:block">
              <SectionPill tone={status.tone} label={status.label} />
            </span>
            <Icon.arrowRight
              className={`h-4 w-4 text-gray-500 transition-transform dark:text-gray-400 ${
                open ? "rotate-90" : ""
              }`}
            />
          </span>
        </button>
      </h2>

      {/* The pill moves below the header on phones, where it would otherwise
          squeeze the title into two or three words per line. */}
      <div className="px-4 pb-3 sm:hidden">
        <SectionPill tone={status.tone} label={status.label} />
      </div>

      <div
        id={panelId}
        hidden={!open}
        className="border-t border-gray-200 px-4 py-5 dark:border-gray-700 sm:px-6 sm:py-6"
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One screening question, fully editable.
 *
 * Reordering is a pair of buttons rather than a drag handle: a drag target is
 * unreachable by keyboard and unusable at 360px, and "move up" is the same
 * operation with a name a screen reader can read out.
 */
function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  question: QuestionDraft;
  index: number;
  total: number;
  onChange: (key: string, patch: Partial<QuestionDraft>) => void;
  onMove: (key: string, delta: -1 | 1) => void;
  onRemove: (key: string) => void;
}) {
  const promptId = `question-prompt-${question.key}`;
  const kindId = `question-kind-${question.key}`;
  const expectedId = `question-expected-${question.key}`;
  const requiredId = `question-required-${question.key}`;
  const knockoutId = `question-knockout-${question.key}`;
  const knockoutHintId = `question-knockout-hint-${question.key}`;

  const choices = answerChoices(question);
  const position = `${index + 1} of ${total}`;
  const label = question.prompt.trim() || `question ${index + 1}`;

  const setOption = (optionIndex: number, value: string) => {
    const options = [...question.options];
    options[optionIndex] = value;
    onChange(question.key, { options });
  };

  return (
    <li className="rounded-lg border border-gray-200 p-3 dark:border-gray-700 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow as="span">
          Question {position}
          {question.id ? "" : " · new"}
        </Eyebrow>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(question.key, -1)}
            disabled={index === 0}
            aria-label={`Move ${label} up`}
            className={`${buttonGhost} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <Icon.arrowRight className="h-4 w-4 -rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => onMove(question.key, 1)}
            disabled={index === total - 1}
            aria-label={`Move ${label} down`}
            className={`${buttonGhost} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <Icon.arrowRight className="h-4 w-4 rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(question.key)}
            aria-label={`Remove ${label}`}
            className={buttonGhost}
          >
            <Icon.trash className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <Label htmlFor={promptId} required>
          Question
        </Label>
        <textarea
          id={promptId}
          value={question.prompt}
          onChange={(event) => onChange(question.key, { prompt: event.target.value })}
          rows={2}
          maxLength={MAX_PROMPT_CHARS}
          placeholder="e.g. How many years have you worked with TypeScript in production?"
          className={inputClass}
        />
        <p className="mt-1.5 text-right">
          <Readout className="text-xs text-gray-500 dark:text-gray-400">
            {question.prompt.length}/{MAX_PROMPT_CHARS}
          </Readout>
        </p>
      </div>

      {question.rationale && (
        <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Suggested to probe: {question.rationale}
        </p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={kindId}>Answer type</Label>
          <select
            id={kindId}
            value={question.kind}
            onChange={(event) =>
              onChange(question.key, { kind: event.target.value as QuestionKind })
            }
            className={inputClass}
          >
            {QUESTION_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>

        {/* Only kinds with a closed answer set can carry an expected answer,
            which is exactly when the server will honour a knockout. */}
        {choices.length > 0 && (
          <div>
            <Label htmlFor={expectedId} hint="Optional. Needed before this can flag anyone.">
              Answer you are looking for
            </Label>
            <select
              id={expectedId}
              value={question.expected ?? ""}
              onChange={(event) =>
                onChange(question.key, { expected: event.target.value || null })
              }
              className={inputClass}
            >
              <option value="">No particular answer</option>
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {question.kind === "SINGLE_CHOICE" && (
        <fieldset className="mt-3">
          <legend className="eyebrow mb-2">
            Choices · {MIN_OPTIONS}–{MAX_OPTIONS}
          </legend>
          <ul className="space-y-2">
            {question.options.map((option, optionIndex) => (
              <li key={optionIndex} className="flex items-center gap-2">
                <input
                  type="text"
                  value={option}
                  onChange={(event) => setOption(optionIndex, event.target.value)}
                  maxLength={MAX_OPTION_CHARS}
                  aria-label={`Choice ${optionIndex + 1} for ${label}`}
                  placeholder={`Choice ${optionIndex + 1}`}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange(question.key, {
                      options: question.options.filter((_, at) => at !== optionIndex),
                    })
                  }
                  aria-label={`Remove choice ${optionIndex + 1} from ${label}`}
                  className={buttonGhost}
                >
                  <Icon.x className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => onChange(question.key, { options: [...question.options, ""] })}
            disabled={question.options.length >= MAX_OPTIONS}
            className={`${buttonGhost} mt-2 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Icon.plus className="h-4 w-4" />
            Add a choice
          </button>
          {cleanOptions(question.options).length < MIN_OPTIONS && (
            <p className="eyebrow mt-1.5 normal-case tracking-normal text-amber-700 dark:text-amber-400">
              A pick-one question needs at least {MIN_OPTIONS} choices before it can be saved.
            </p>
          )}
        </fieldset>
      )}

      <div className="mt-4 space-y-2.5 border-t border-gray-200 pt-3 dark:border-gray-700">
        <label htmlFor={requiredId} className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            id={requiredId}
            checked={question.required}
            onChange={(event) => onChange(question.key, { required: event.target.checked })}
            className="control h-4 w-4 rounded"
          />
          <span className="text-gray-700 dark:text-gray-200">Applicants must answer this</span>
        </label>

        <div>
          <label htmlFor={knockoutId} className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              id={knockoutId}
              checked={question.knockout}
              disabled={question.expected === null}
              onChange={(event) => onChange(question.key, { knockout: event.target.checked })}
              aria-describedby={knockoutHintId}
              className="control h-4 w-4 rounded"
            />
            <span className="text-gray-700 dark:text-gray-200">
              Flag applicants who answer differently
            </span>
          </label>
          {/* Said plainly, because the word "knockout" implies otherwise: this
              marks an application, it does not reject or hide one. */}
          <p
            id={knockoutHintId}
            className="mt-1 pl-7 text-xs leading-relaxed text-gray-500 dark:text-gray-400"
          >
            {question.expected === null
              ? "Choose the answer you are looking for first — there is nothing to compare against yet."
              : `Applications that do not answer “${question.expected}” are marked for your attention. They still arrive in your queue, and nobody is filtered out on your behalf.`}
          </p>
        </div>
      </div>
    </li>
  );
}
