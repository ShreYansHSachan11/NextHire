"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
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
  Card,
  Chip,
  Eyebrow,
  Icon,
  Label,
  Meter,
  PageHeading,
  Readout,
  Skeleton,
  Spinner,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "@/app/components/ui";

interface CreatedJob {
  id: string;
  title: string;
}

/** Mirrors where the server truncates, so the counter tells the truth. */
const MAX_TITLE = 150;
const MAX_DESCRIPTION = 10000;
/**
 * `POST /api/jobs` runs `cleanString(body.experience, 60)`. The input used to
 * allow 100, so anything longer was accepted by the form and then silently
 * shortened on save — the employer never saw where it was cut.
 */
const MAX_EXPERIENCE = 60;
const MAX_SALARY = 100;
const MAX_LOCATION = 120;

/* -------------------------------------------------------------------------- */
/* AI requests                                                                 */
/* -------------------------------------------------------------------------- */

interface DescriptionDraft {
  description: string;
  skills: string[];
  suggestedTitle: string;
}

interface SkillsDraft {
  skills: string[];
}

type AssistOutcome<T> =
  | { ok: true; data: T }
  /** `unavailable` is the 503: no key on this deployment, so stop offering it. */
  | { ok: false; unavailable: boolean; message: string };

const ASSIST_FAILED = "The writing assistant is unavailable right now. Please try again later.";

/**
 * Deliberately not `apiFetch`: that helper collapses every failure into an
 * Error message, and these callers have to tell "the deployment has no model"
 * (503, hide the feature and say nothing) apart from "the call failed" (502 or
 * a network blip, worth one toast).
 *
 * Every `/api/ai/*` route shares one key, so a 503 from any of them is a fact
 * about the whole deployment and all of the assistive buttons go together.
 */
async function requestAi<T>(path: string, body: Record<string, unknown>): Promise<AssistOutcome<T>> {
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
          : ASSIST_FAILED;
      return { ok: false, unavailable: false, message };
    }

    return { ok: true, data: data as T };
  } catch (error) {
    console.error("AI request failed:", error);
    return { ok: false, unavailable: false, message: ASSIST_FAILED };
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

/** Every cap here mirrors `PUT /api/jobs/:jobId/questions`, which is the authority. */
const MAX_QUESTIONS = 10;
const MAX_PROMPT_CHARS = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MAX_OPTION_CHARS = 80;
/** `POST /api/ai/screening` will not return more than this however many we ask for. */
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
  /** Null here — nothing is persisted until the posting itself exists. */
  id: string | null;
  prompt: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
  knockout: boolean;
  expected: string | null;
  /** The model's note on what the question probes. Shown once; never sent back. */
  rationale: string;
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

/** The answers a knockout could be compared against, or none. */
function answerChoices(question: QuestionDraft): string[] {
  if (question.kind === "BOOLEAN") return [...BOOLEAN_ANSWERS];
  if (question.kind === "SINGLE_CHOICE") return cleanOptions(question.options);
  // TEXT and NUMBER have no single correct form, so they can never be knockouts.
  return [];
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

function suggestionToDraft(suggestion: Suggestion): QuestionDraft {
  const kind = isQuestionKind(suggestion.kind) ? suggestion.kind : "TEXT";
  return normaliseQuestion({
    key: nextQuestionKey(),
    id: null,
    prompt: suggestion.prompt,
    kind,
    options: Array.isArray(suggestion.options) ? suggestion.options : [],
    required: suggestion.required !== false,
    knockout: suggestion.knockout === true,
    expected: suggestion.expected ?? null,
    rationale: suggestion.rationale ?? "",
  });
}

const EMPTY_FORM = {
  title: "",
  description: "",
  salary: "",
  experience: "",
  location: "",
  type: "",
};

/* -------------------------------------------------------------------------- */
/* Step model                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The form is grouped into four named steps with a progress rail above them.
 *
 * It is deliberately *not* a wizard. Baymard's checkout research is the reason:
 * across seven years of testing they could not show accordion or multi-page
 * checkouts outperforming a single page, and concluded that "what users are
 * asked to do, and how they are asked to do it" matters far more than the
 * number of pages — with visible progress indication and logical field grouping
 * named as the layout factors that actually move the needle.
 *   https://baymard.com/blog/accordion-style-checkout
 *
 * So: real grouping, a rail that says how far along the posting is, and a
 * review before submit (NN/g's wizard guidance — show the steps, highlight
 * where you are, and let people leave and come back), but every field stays on
 * one page and nothing is gated behind a "Next" button. A step can be folded
 * away once it is done; none of them is ever hidden from the employer.
 *   https://www.nngroup.com/articles/wizards/
 *
 * The headers follow the APG accordion pattern — a `button` as the only child
 * of a heading, carrying `aria-expanded` and `aria-controls`.
 *   https://www.w3.org/WAI/ARIA/apg/patterns/accordion/
 */
const STEPS = [
  {
    id: "role",
    number: "01",
    title: "The role",
    description: "What the job is, in your own words. This is what the match engine reads.",
  },
  {
    id: "particulars",
    number: "02",
    title: "Particulars",
    description: "Type, location, pay and skills — the facts candidates filter and self-select on.",
  },
  {
    id: "screening",
    number: "03",
    title: "Screening questions",
    description: "Optional. Questions applicants answer when they apply.",
  },
  {
    id: "review",
    number: "04",
    title: "Review and post",
    description: "Everything as it will be stored, on one screen, before it goes live.",
  },
] as const;

type StepId = (typeof STEPS)[number]["id"];

/** `done` and `todo` are the two required states; `optional` never blocks a post. */
type StepTone = "done" | "todo" | "optional";

/** Steps 1 and 2 hold everything the API refuses a posting without. */
const REQUIRED_STEPS = 2;

export default function PostJobPage() {
  // Every hook must run before any early return. The previous version put a
  // `useEffect` *after* a conditional `return null`, so React threw
  // "Rendered fewer hooks than expected" the moment auth state flipped.
  const { ready, allowed, user } = useAuthGuard(["COMPANY"]);
  const toast = useToast();

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedJob | null>(null);

  const [skills, setSkills] = useState<string[]>([]);
  // A suggestion request can resolve after the employer has typed another tag,
  // and the state captured when the request went out would be stale by then.
  // The ref is the live list; every write goes through `applySkills`.
  const skillsRef = useRef<string[]>([]);
  const applySkills = (next: string[]) => {
    skillsRef.current = next;
    setSkills(next);
  };
  const [skillInput, setSkillInput] = useState("");
  /** Announced politely so the tag list is usable without seeing it. */
  const [skillNotice, setSkillNotice] = useState("");

  // Optimistic: the buttons are offered until an AI endpoint answers 503 once.
  // After that they stay hidden for the session and the form is exactly the
  // form a deployment without a Gemini key has always had.
  const [aiAvailable, setAiAvailable] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [draft, setDraft] = useState<DescriptionDraft | null>(null);

  /* --------------------------- inclusivity check -------------------------- */

  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<InclusivityReview | null>(null);
  /** Phrases already swapped in, so a done finding reads as done, not as stale. */
  const [appliedPhrases, setAppliedPhrases] = useState<string[]>([]);
  const [reviewNotice, setReviewNotice] = useState("");

  /* -------------------------- screening questions ------------------------- */

  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [suggestingQuestions, setSuggestingQuestions] = useState(false);
  const [questionNotice, setQuestionNotice] = useState("");
  /**
   * The posting and its questions are two separate writes. When the first
   * succeeds and the second does not, the job is live and the questions are
   * not — say so and offer the retry rather than pretending both landed.
   */
  const [questionsUnsaved, setQuestionsUnsaved] = useState(false);
  const [retryingQuestions, setRetryingQuestions] = useState(false);

  /* -------------------------------- steps -------------------------------- */

  /**
   * Which step panels are open. Everything starts open: folding a section away
   * is a convenience for an employer who has finished it, never something the
   * form does to them. A collapsed panel is `hidden`, so its fields leave the
   * tab order — which is exactly why `jumpToStep` re-opens a step before
   * sending anyone to it.
   */
  const [openSteps, setOpenSteps] = useState<Record<StepId, boolean>>({
    role: true,
    particulars: true,
    screening: true,
    review: true,
  });

  const toggleStep = (id: StepId) =>
    setOpenSteps((current) => ({ ...current, [id]: !current[id] }));

  /**
   * Opens a step and puts focus on its header.
   *
   * Focus rather than `scrollIntoView`: moving focus scrolls the header into
   * view *and* takes a keyboard or screen-reader user with it, which a scroll
   * alone does not. The frame delay is because the panel has to be in the DOM
   * before the browser will scroll to it.
   */
  const jumpToStep = (id: StepId) => {
    setOpenSteps((current) => ({ ...current, [id]: true }));
    requestAnimationFrame(() => {
      document.getElementById(`step-toggle-${id}`)?.focus();
    });
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  /* ------------------------------ skill tags ------------------------------ */

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
        ? `${added === 1 ? "Skill added" : `${added} skills added`}. ${skillsRef.current.length} of ${MAX_SKILLS}.`
        : wasFull
          ? `Skill limit reached — ${MAX_SKILLS} of ${MAX_SKILLS}.`
          : "That skill is already on the list."
    );
  };

  const removeSkill = (tag: string) => {
    const next = skillsRef.current.filter((skill) => skill !== tag);
    applySkills(next);
    setSkillNotice(`${tag} removed. ${next.length} of ${MAX_SKILLS}.`);
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

  /* ---------------------------- drafting help ----------------------------- */

  const handleDraft = async () => {
    const title = formData.title.trim();
    if (!title || drafting) return;

    setDrafting(true);
    const outcome = await requestAi<DescriptionDraft>("/api/ai/assist", {
      mode: "job-description",
      title,
      // Whatever is already in the box is passed as notes, not overwritten:
      // the model works from the employer's own words where there are any.
      description: formData.description.trim() || undefined,
      type: formData.type || undefined,
      location: formData.location.trim() || undefined,
      experience: formData.experience.trim() || undefined,
    });
    setDrafting(false);

    if (outcome.ok) {
      setDraft(outcome.data);
      return;
    }
    if (outcome.unavailable) {
      setAiAvailable(false);
      return; // Not an error the employer can act on — say nothing.
    }
    toast.error(outcome.message);
  };

  const handleSuggestSkills = async () => {
    const title = formData.title.trim();
    const description = formData.description.trim();
    if (!title || !description || suggesting) return;

    setSuggesting(true);
    const outcome = await requestAi<SkillsDraft>("/api/ai/assist", {
      mode: "job-skills",
      title,
      description,
    });
    setSuggesting(false);

    if (outcome.ok) {
      const added = mergeSkills(outcome.data.skills);
      setSkillNotice(
        added > 0
          ? `${added} suggested ${added === 1 ? "skill" : "skills"} added. Remove any that do not fit.`
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

  /** The draft only reaches the form when the employer says so. */
  const acceptDraftDescription = () => {
    if (!draft) return;
    setFormData((current) => ({
      ...current,
      description: draft.description.slice(0, MAX_DESCRIPTION),
    }));
    setDraft(null);
    // Any findings were about the old text; keeping them on screen next to a
    // wholly different description would invite applying a stale rewrite.
    setReview(null);
    setAppliedPhrases([]);
    toast.success("Draft inserted — read it through and edit before posting.");
  };

  /* --------------------------- inclusivity check -------------------------- */

  const handleInclusivityCheck = async () => {
    const description = formData.description.trim();
    if (!description || reviewing) return;

    setReviewing(true);
    setReviewNotice("");
    const outcome = await requestAi<InclusivityReview>("/api/ai/review", {
      mode: "inclusivity",
      title: formData.title.trim() || undefined,
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
          ? "Inclusivity check finished. Nothing flagged in this draft."
          : `Inclusivity check finished. ${count} ${count === 1 ? "suggestion" : "suggestions"} to read.`
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
   * The phrase was verbatim in the draft when the check ran, but the employer
   * may have kept typing since. Re-checking against the live description here
   * is the difference between a safe replace and one that quietly does nothing
   * — and the button is already disabled in that case, so this is the guard for
   * the race where the text changes between paint and click.
   */
  const applyFinding = (finding: Finding) => {
    const current = formData.description;

    if (!current.includes(finding.phrase)) {
      setReviewNotice(
        "That wording is no longer in the description. Run the check again so it reads the current draft."
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

    setFormData((form) => ({ ...form, description: next }));
    setAppliedPhrases((applied) => [...applied, finding.phrase]);
    setReviewNotice(`Applied. “${finding.phrase}” is now “${finding.rewrite}”.`);
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
    setQuestions((current) => current.filter((question) => question.key !== key));
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
    const title = formData.title.trim();
    if (!title || suggestingQuestions) return;

    const room = MAX_QUESTIONS - questions.length;
    if (room <= 0) {
      setQuestionNotice(`You already have the maximum of ${MAX_QUESTIONS} questions.`);
      return;
    }

    setSuggestingQuestions(true);
    const outcome = await requestAi<{ questions: Suggestion[]; filtered: number }>(
      "/api/ai/screening",
      {
        title,
        description: formData.description.trim() || undefined,
        skills: skillsRef.current,
        location: formData.location.trim() || undefined,
        experience: formData.experience.trim() || undefined,
        count: Math.min(room, MAX_SUGGESTIONS),
      }
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
        ? `${additions.length} suggested ${additions.length === 1 ? "question" : "questions"} added below. Edit or remove anything that does not fit.`
        : "No new questions to suggest for this posting."
    );
  };

  /** Used by the submit path and by the retry in the success banner. */
  const saveQuestions = async (jobId: string) => {
    await apiFetch(`/api/jobs/${jobId}/questions`, {
      method: "PUT",
      body: JSON.stringify({ questions: toQuestionPayload(questions) }),
    });
  };

  const retrySaveQuestions = async () => {
    if (!created || retryingQuestions) return;
    setRetryingQuestions(true);
    try {
      await saveQuestions(created.id);
      setQuestionsUnsaved(false);
      setQuestions([]);
      toast.success("Screening questions saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the screening questions");
    } finally {
      setRetryingQuestions(false);
    }
  };

  /* -------------------------------- submit -------------------------------- */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Belt and braces alongside the disabled button: a second Enter press while
    // the request is in flight must not create a second posting.
    if (loading) return;

    setError("");
    setCreated(null);
    setQuestionsUnsaved(false);

    const title = formData.title.trim();
    const description = formData.description.trim();

    /*
     * Every refusal below names the step that owns it and sends the employer
     * there. A message about a field inside a folded-away panel is a dead end,
     * and this is the form where that is most likely — so the error and the
     * navigation to it are one action.
     */
    const refuse = (message: string, step: StepId) => {
      setError(message);
      jumpToStep(step);
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

    // Validated before the posting is created, not after: a question the route
    // would reject should not cost the employer a live job with no questions.
    for (let index = 0; index < questions.length; index += 1) {
      const problem = questionProblem(questions[index], index);
      if (problem) {
        refuse(problem, "screening");
        return;
      }
    }

    setLoading(true);

    try {
      // `companyId` is deliberately absent: the server derives it from the
      // session, and used to accept whatever the client claimed.
      const job = await apiFetch<CreatedJob>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          title,
          description,
          salary: formData.salary.trim() || null,
          experience: formData.experience.trim() || null,
          location: formData.location.trim() || null,
          type: formData.type,
          // Cleaned again on the server. Read from the ref rather than the
          // render's copy: a tag committed by the input's own blur as the
          // submit button went down is already in the ref.
          skills: skillsRef.current,
        }),
      });

      setCreated(job);

      // The questions are a second write to a different route. The posting is
      // already live at this point, so a failure here is reported on its own
      // terms instead of being rolled into "job posting failed".
      let questionsSaved = true;
      if (questions.length > 0) {
        try {
          await saveQuestions(job.id);
        } catch (questionError) {
          console.error("Saving screening questions failed:", questionError);
          questionsSaved = false;
          setQuestionsUnsaved(true);
        }
      }

      setFormData(EMPTY_FORM);
      applySkills([]);
      setSkillInput("");
      setSkillNotice("");
      setDraft(null);
      setReview(null);
      setAppliedPhrases([]);
      setReviewNotice("");
      // Kept on screen when the save failed, so the retry has something to send.
      if (questionsSaved) {
        setQuestions([]);
        setQuestionNotice("");
      }

      toast.success(
        questionsSaved ? "Job posted." : "Job posted, but the screening questions did not save."
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Job posting failed";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  if (!ready || !allowed) {
    /*
     * `useAuthGuard` is already redirecting. Hold this page's own shell rather
     * than swapping the whole viewport for a centred spinner: the navbar
     * staying put is the difference between "still loading" and "something
     * went wrong", and the blocks below are the size of what replaces them, so
     * nothing jumps. Same reasoning as the sibling `loading.tsx`.
     */
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navbar />
        <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <p className="sr-only" role="status">
            Loading the job form
          </p>
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-2.5 h-8 w-48" />
          <Skeleton className="mt-3 h-4 w-full max-w-lg" />
          <Skeleton className="mt-6 h-28 w-full rounded-xl" />
          <Skeleton className="mt-4 h-72 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  const hasCompany = Boolean(user?.companyId);
  const descriptionLength = formData.description.length;
  const atDescriptionLimit = descriptionLength >= MAX_DESCRIPTION;
  // The assistant writes *from* something; with no title it has nothing to go on.
  const titleFilled = formData.title.trim().length > 0;
  const descriptionFilled = formData.description.trim().length > 0;
  const canSuggestSkills = titleFilled && descriptionFilled;
  const skillsFull = skills.length >= MAX_SKILLS;
  const questionsFull = questions.length >= MAX_QUESTIONS;
  const suggestedTitleIsNew =
    !!draft && draft.suggestedTitle.trim().toLowerCase() !== formData.title.trim().toLowerCase();

  /* ------------------------------ step state ------------------------------ */

  const typeChosen = isJobType(formData.type);
  const roleDone = titleFilled && descriptionFilled;
  const particularsDone = typeChosen;

  /**
   * What each step's pill says. Derived rather than stored, so it cannot drift
   * from what `handleSubmit` actually checks — the two read the same booleans.
   */
  const stepStatus: Record<StepId, { tone: StepTone; label: string }> = {
    role: roleDone
      ? { tone: "done", label: "Ready" }
      : { tone: "todo", label: titleFilled ? "Description needed" : "Title needed" },
    particulars: particularsDone
      ? { tone: "done", label: "Ready" }
      : { tone: "todo", label: "Job type needed" },
    screening: {
      tone: "optional",
      label:
        questions.length === 0
          ? "None — optional"
          : `${questions.length} ${questions.length === 1 ? "question" : "questions"}`,
    },
    review: {
      tone: roleDone && particularsDone ? "done" : "todo",
      label: roleDone && particularsDone ? "Ready to post" : "Waiting on the steps above",
    },
  };

  const requiredDone = (roleDone ? 1 : 0) + (particularsDone ? 1 : 0);

  /** Everything still standing between this draft and a live posting. */
  const blockers: { step: StepId; label: string }[] = [];
  if (!titleFilled) blockers.push({ step: "role", label: "The posting needs a job title." });
  if (!descriptionFilled) {
    blockers.push({ step: "role", label: "The posting needs a description." });
  }
  if (!typeChosen) blockers.push({ step: "particulars", label: "Choose a job type." });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/company/dashboard" className={`${buttonGhost} -ml-2.5 mb-4`}>
          <Icon.arrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <PageHeading
          eyebrow="Company · New posting"
          title="Post a job"
          description="Everything you write here is what the match engine reads, so the more specific the role, the sharper the candidate list."
          className="mb-6"
        />

        {created && (
          <Alert variant="success" className="mb-6">
            <p className="font-semibold">&ldquo;{created.title}&rdquo; is live.</p>

            {questionsUnsaved && (
              <p className="mt-2">
                The posting saved, but its screening questions did not. They are still in the form
                below — nothing has been lost.
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {questionsUnsaved && (
                <button
                  type="button"
                  onClick={() => void retrySaveQuestions()}
                  disabled={retryingQuestions}
                  className={`${buttonSecondary} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {retryingQuestions ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Icon.check className="h-4 w-4" />
                      Save the questions
                    </>
                  )}
                </button>
              )}
              <Link href={`/jobs/${created.id}`} className="btn-ink btn-touch">
                View the posting
                <Icon.arrowUpRight className="h-4 w-4" />
              </Link>
              <Link href="/company/dashboard" className="btn-outline btn-touch">
                Back to dashboard
              </Link>
            </div>
          </Alert>
        )}

        {!hasCompany && (
          <Alert variant="warning" className="mb-6">
            <p className="font-semibold">Your account is not linked to a company yet.</p>
            <p className="mt-1">
              Jobs are posted on behalf of a company workspace, and we could not find one for this
              account. Signing out and back in usually refreshes the link. If it persists, contact
              support and we will connect your account.
            </p>
          </Alert>
        )}

        {error && (
          <Alert variant="error" className="mb-6">
            <span id="post-job-error">{error}</span>
          </Alert>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <StepRail status={stepStatus} requiredDone={requiredDone} onJump={jumpToStep} />

          <div className="mt-4 space-y-3">
            <StepCard
              step={STEPS[0]}
              status={stepStatus.role}
              open={openSteps.role}
              onToggle={() => toggleStep("role")}
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
                    placeholder="e.g. Senior Software Engineer"
                    value={formData.title}
                    onChange={handleChange}
                    required
                    maxLength={MAX_TITLE}
                    aria-describedby="title-hint"
                    className={inputClass}
                  />
                  {/* Counters are machine output, so they sit in mono and align
                      right — the eye finds them without them competing with the
                      label. */}
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
                    {aiAvailable && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDraft()}
                          disabled={!titleFilled || drafting}
                          aria-describedby={titleFilled ? undefined : "ai-draft-hint"}
                          className={`${buttonSecondary} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {drafting ? (
                            <>
                              <Spinner className="h-4 w-4" />
                              Drafting…
                            </>
                          ) : (
                            <>
                              <Icon.spark className="h-4 w-4" />
                              Draft with AI
                            </>
                          )}
                        </button>

                        {/* Same interaction as drafting: one button, a result
                            panel below the field, nothing applied until asked. */}
                        <button
                          type="button"
                          onClick={() => void handleInclusivityCheck()}
                          disabled={!descriptionFilled || reviewing}
                          aria-describedby={descriptionFilled ? undefined : "ai-review-hint"}
                          className={`${buttonGhost} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {reviewing ? (
                            <>
                              <Spinner className="h-4 w-4" />
                              Reading the draft…
                            </>
                          ) : (
                            <>
                              <Icon.spark className="h-4 w-4" />
                              Check the wording
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {aiAvailable && !titleFilled && (
                    <p id="ai-draft-hint" className="eyebrow mb-2">
                      Add a job title to draft from
                    </p>
                  )}
                  {/* Not gated on `titleFilled` as well: the button above is
                      `aria-describedby` this, and with both conditions the hint
                      was absent in the empty state — exactly where a disabled
                      control most needs to say why. Each hint now renders on
                      precisely the condition that disables its own button. */}
                  {aiAvailable && !descriptionFilled && (
                    <p id="ai-review-hint" className="eyebrow mb-2">
                      Write a description to check it
                    </p>
                  )}
                  <textarea
                    id="description"
                    name="description"
                    placeholder="Describe the role, the day-to-day work, and what you are looking for…"
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

                  {/* The draft lands here, never in the textarea: whatever the
                      employer has already written stays untouched until they
                      choose to replace it. */}
                  {draft && (
                    <Card grid className="mt-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                          <Icon.spark className="h-4 w-4" />
                          <Eyebrow as="span" accent>
                            AI draft · unsaved
                          </Eyebrow>
                        </span>
                        <Readout className="text-xs text-gray-500 dark:text-gray-400">
                          {draft.description.length.toLocaleString()} chars
                        </Readout>
                      </div>

                      <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                        Written by the model from the details above. Read it, correct anything it
                        got wrong, and nothing is posted until you submit the form.
                      </p>

                      <div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                        {draft.description}
                      </div>

                      {suggestedTitleIsNew && (
                        <div className="mt-4">
                          <Eyebrow>Suggested title</Eyebrow>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <Chip>{draft.suggestedTitle}</Chip>
                            <button
                              type="button"
                              onClick={() =>
                                setFormData((current) => ({
                                  ...current,
                                  title: draft.suggestedTitle.slice(0, MAX_TITLE),
                                }))
                              }
                              className={buttonGhost}
                            >
                              <Icon.check className="h-4 w-4" />
                              Use this title
                            </button>
                          </div>
                        </div>
                      )}

                      {draft.skills.length > 0 && (
                        <div className="mt-4">
                          <Eyebrow>Suggested skills · tap to add</Eyebrow>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {draft.skills.map((skill) => {
                              const already = skills.some(
                                (existing) => existing.toLowerCase() === skill.toLowerCase()
                              );
                              return (
                                <button
                                  key={skill}
                                  type="button"
                                  onClick={() => {
                                    const added = mergeSkills([skill]);
                                    setSkillNotice(
                                      added > 0
                                        ? `${skill} added. ${skillsRef.current.length} of ${MAX_SKILLS}.`
                                        : `Skill limit reached — ${MAX_SKILLS} of ${MAX_SKILLS}.`
                                    );
                                  }}
                                  disabled={already || skillsFull}
                                  className="rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Chip
                                    icon={
                                      already ? (
                                        <Icon.check className="h-3 w-3" />
                                      ) : (
                                        <Icon.plus className="h-3 w-3" />
                                      )
                                    }
                                    accent={already}
                                  >
                                    {skill}
                                    <span className="sr-only">
                                      {already ? " already added" : " — add to skills"}
                                    </span>
                                  </Chip>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-3 dark:border-gray-700 sm:flex-row">
                        <button
                          type="button"
                          onClick={acceptDraftDescription}
                          className={`${buttonSecondary} w-full sm:w-auto`}
                        >
                          <Icon.check className="h-4 w-4" />
                          Use this description
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft(null)}
                          className={`${buttonGhost} w-full justify-center sm:w-auto`}
                        >
                          <Icon.x className="h-4 w-4" />
                          Discard draft
                        </button>
                      </div>
                    </Card>
                  )}

                  {/* Findings sit under the field, in the same panel language as
                      the AI draft above. Advisory throughout: nothing here can
                      stop the posting going out. */}
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
                        Suggestions only — none of this blocks the posting. Apply what you agree
                        with and ignore the rest.
                      </p>

                      {review.findings.length === 0 ? (
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                          Nothing flagged in this draft.
                        </p>
                      ) : (
                        <ul className="mt-3 space-y-3">
                          {review.findings.map((finding) => {
                            const done = appliedPhrases.includes(finding.phrase);
                            // Recomputed every render, so the button disables the
                            // moment the employer edits that wording away.
                            const stillPresent = formData.description.includes(finding.phrase);

                            return (
                              <li
                                key={finding.phrase}
                                className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
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
                                    Applied to the description
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
                                  /* The employer edited the draft after the check
                                     ran. We will not guess at a near-match. */
                                  <p className="mt-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                                    This wording is no longer in the description. Run the check
                                    again to read the current draft.
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
            </StepCard>

            <StepCard
              step={STEPS[1]}
              status={stepStatus.particulars}
              open={openSteps.particulars}
              onToggle={() => toggleStep("particulars")}
            >
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <Label htmlFor="type" required hint="Candidates filter the feed by this.">
                    Job type
                  </Label>
                  {/* Sourced from the shared list so this never drifts away from
                      the filters on the public jobs feed. */}
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
                  <Label htmlFor="location" hint="Optional. Leave empty if the location is flexible.">
                    Location
                  </Label>
                  <input
                    type="text"
                    id="location"
                    name="location"
                    placeholder="e.g. Bangalore, or Remote"
                    value={formData.location}
                    onChange={handleChange}
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
                    placeholder="e.g. ₹18–25 LPA"
                    value={formData.salary}
                    onChange={handleChange}
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
                    placeholder="e.g. 3–5 years"
                    value={formData.experience}
                    onChange={handleChange}
                    maxLength={MAX_EXPERIENCE}
                    className={inputClass}
                  />
                </div>

                {/* Skills are a facet of the match score in their own right, so
                    they are worth collecting as tags rather than leaving buried
                    in the prose. */}
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
                        disabled={!canSuggestSkills || suggesting || skillsFull}
                        aria-describedby={canSuggestSkills ? undefined : "skills-ai-hint"}
                        className={`${buttonGhost} mb-2 disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {suggesting ? (
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
                            <button
                              type="button"
                              onClick={() => removeSkill(skill)}
                              aria-label={`Remove ${skill}`}
                              // 24x24 hit area (WCAG 2.2 AA target minimum) held
                              // inside the chip by negative margins, so the
                              // target grows without the chip doing the same.
                              className="-my-1 -mr-1.5 flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-100"
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
                    // Sized for a pasted *list*, not for one tag.
                    //
                    // This used to be `MAX_SKILL_LENGTH`, which the browser
                    // applies to the paste itself — so pasting
                    // "React, TypeScript, Node.js, PostgreSQL, Kubernetes" was
                    // silently clipped to 40 characters before `onChange` ever
                    // saw a comma to split on, and most of the list was lost.
                    // Each individual tag is still cut to `MAX_SKILL_LENGTH` by
                    // `cleanTagList` when it is committed, which is the same
                    // code the API runs.
                    maxLength={MAX_SKILL_LENGTH * MAX_SKILLS}
                    placeholder={
                      skillsFull ? "Skill limit reached" : "e.g. TypeScript, Postgres, Figma"
                    }
                    className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                  />

                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <p id="skills-ai-hint" className="eyebrow">
                      {aiAvailable && !canSuggestSkills
                        ? "Add a title and description to suggest skills"
                        : "Backspace on an empty field removes the last tag"}
                    </p>
                    {/* Amber at the cap, matching the editor on the other side
                        of this pair — a counter that goes quiet at the limit is
                        the one moment it has something to say. */}
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

                  <p aria-live="polite" className="eyebrow mt-1 normal-case tracking-normal">
                    {skillNotice}
                  </p>
                </div>
              </div>
            </StepCard>

            {/* Step 3 — screening questions. The editor itself is plain
                persistence, so it is offered on every deployment; only the
                "suggest" button depends on a model being configured. */}
            <StepCard
              step={STEPS[2]}
              status={stepStatus.screening}
              open={openSteps.screening}
              onToggle={() => toggleStep("screening")}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  Applicants answer these when they apply, and you see the answers on the
                  application. Up to {MAX_QUESTIONS}.
                </p>
                {aiAvailable && (
                  <button
                    type="button"
                    onClick={() => void handleSuggestQuestions()}
                    disabled={!titleFilled || suggestingQuestions || questionsFull}
                    aria-describedby="screening-ai-hint"
                    className={`${buttonGhost} flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {suggestingQuestions ? (
                      <>
                        <Spinner className="h-4 w-4" />
                        Drafting questions…
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

              {aiAvailable && (
                <p id="screening-ai-hint" className="eyebrow mt-2">
                  {questionsFull
                    ? `Maximum of ${MAX_QUESTIONS} questions reached`
                    : !titleFilled
                      ? "Add a job title to draft questions from"
                      : "Suggestions are drafts — read each one before you post"}
                </p>
              )}

              {questions.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  No screening questions yet. Post without them, or add one below.
                </p>
              ) : (
                <ol className="mt-4 space-y-4">
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
            </StepCard>

            {/* Step 4 — the review. NN/g's wizard guidance asks for a place to
                check the whole thing before it commits; this is it, and it
                prints the values as they will be *stored* rather than as they
                look in the boxes above. */}
            <StepCard
              step={STEPS[3]}
              status={stepStatus.review}
              open={openSteps.review}
              onToggle={() => toggleStep("review")}
            >
              {blockers.length > 0 ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40 sm:p-4">
                  <Eyebrow as="h3">Before this can be posted</Eyebrow>
                  <ul className="mt-2 space-y-2">
                    {blockers.map((blocker) => (
                      <li
                        key={blocker.label}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-amber-900 dark:text-amber-100"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon.warning className="h-4 w-4 flex-shrink-0" />
                          {blocker.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => jumpToStep(blocker.step)}
                          className={buttonGhost}
                        >
                          Go to step {STEPS.findIndex((s) => s.id === blocker.step) + 1}
                          <Icon.arrowRight className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="flex items-start gap-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">
                  <Icon.checkCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600 dark:text-green-400" />
                  Everything required is filled in. Read it through below — the posting goes live
                  the moment you submit.
                </p>
              )}

              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <ReviewRow label="Job title" value={formData.title.trim()} />
                <ReviewRow label="Job type" value={formData.type} />
                <ReviewRow label="Location" value={formData.location.trim()} fallback="Not stated" />
                <ReviewRow label="Salary range" value={formData.salary.trim()} fallback="Not stated" />
                <ReviewRow
                  label="Experience"
                  value={formData.experience.trim()}
                  fallback="Not stated"
                />
                <ReviewRow
                  label="Skill tags"
                  value={skills.length > 0 ? `${skills.length} of ${MAX_SKILLS}` : ""}
                  fallback="None"
                  mono
                />
              </dl>

              {skills.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {skills.map((skill) => (
                    <li key={skill}>
                      <Chip>{skill}</Chip>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Eyebrow as="h3">Description</Eyebrow>
                  <Readout className="text-xs text-gray-500 dark:text-gray-400">
                    {descriptionLength.toLocaleString()} chars
                  </Readout>
                </div>
                {descriptionFilled ? (
                  <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    {formData.description.trim()}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Nothing written yet.
                  </p>
                )}
              </div>

              <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
                <Eyebrow as="h3">Screening questions</Eyebrow>
                {questions.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    None. Candidates apply with a message and a résumé only.
                  </p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {questions.map((question, index) => (
                      <li
                        key={question.key}
                        className="border-l-2 border-gray-200 pl-3 text-sm leading-relaxed text-gray-700 dark:border-gray-700 dark:text-gray-200"
                      >
                        <span className="mono mr-2 text-xs text-gray-500 dark:text-gray-400">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {question.prompt.trim() || (
                          <span className="text-amber-700 dark:text-amber-400">
                            No prompt written yet
                          </span>
                        )}
                        {/* The flag is repeated here in the same words the
                            editor used, so the last thing read before posting
                            still says a knockout marks rather than rejects. */}
                        {question.knockout && question.expected && (
                          <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                            Answers other than “{question.expected}” are marked for your attention.
                            Nobody is filtered out.
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-end">
                <p className="eyebrow text-center sm:mr-auto sm:text-left">
                  {hasCompany
                    ? "Posting goes live immediately"
                    : "Your account is not linked to a company"}
                </p>
                <Link href="/company/dashboard" className={`${buttonSecondary} w-full sm:w-auto`}>
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={loading || !hasCompany}
                  aria-busy={loading || undefined}
                  aria-describedby={error ? "post-job-error" : undefined}
                  className={`${buttonPrimary} w-full sm:w-auto`}
                >
                  {loading ? (
                    <>
                      <Spinner className="h-4 w-4" decorative />
                      Posting…
                    </>
                  ) : (
                    <>
                      <Icon.plus className="h-4 w-4" />
                      Post job
                    </>
                  )}
                </button>
              </div>
            </StepCard>
          </div>
        </form>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local pieces                                                                */
/* -------------------------------------------------------------------------- */

/*
 * The three components below are defined here rather than in `ui.tsx`: a
 * stepped authoring form is this page's problem and the posting editor's, not
 * the design system's, and the kit is owned elsewhere. If a third surface ever
 * needs them, that is the moment to promote them.
 */

/** Tone map for a step's state pill. Not colour alone — each carries a word. */
const STEP_PILL_STYLES: Record<StepTone, string> = {
  done: "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200",
  todo: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  optional:
    "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function StepPill({ tone, label }: { tone: StepTone; label: string }) {
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider ${STEP_PILL_STYLES[tone]}`}
    >
      {tone === "done" && <Icon.check className="h-3 w-3 flex-shrink-0" />}
      {tone === "todo" && <Icon.warning className="h-3 w-3 flex-shrink-0" />}
      {label}
    </span>
  );
}

/**
 * Progress rail for the four steps.
 *
 * Sticky from `sm` up, where there is vertical room to spare: progress that
 * scrolls off the top is not progress indication. It stays below the navbar's
 * `z-40` so it can never cover the primary navigation.
 */
function StepRail({
  status,
  requiredDone,
  onJump,
}: {
  status: Record<StepId, { tone: StepTone; label: string }>;
  requiredDone: number;
  onJump: (id: StepId) => void;
}) {
  return (
    <div className="panel p-3 sm:sticky sm:top-16 sm:z-20 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Eyebrow as="h2">Post a job · {STEPS.length} steps</Eyebrow>
        <Eyebrow as="span">
          <Readout>{requiredDone}</Readout>
          {" / "}
          <Readout>{REQUIRED_STEPS}</Readout> required steps ready
        </Eyebrow>
      </div>

      <Meter
        value={requiredDone}
        max={REQUIRED_STEPS}
        strongAt={100}
        label={`${requiredDone} of ${REQUIRED_STEPS} required steps ready`}
        className="mt-2"
      />

      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onJump(step.id)}
              className="interactive flex w-full flex-col items-start gap-1 rounded-lg border border-gray-200 px-2.5 py-2 text-left dark:border-gray-700"
            >
              <span className="flex w-full min-w-0 items-baseline gap-1.5">
                <Readout className="text-xs text-gray-500 dark:text-gray-400">
                  {step.number}
                </Readout>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900 dark:text-white">
                  {step.title}
                </span>
              </span>
              {/* Repeats the panel's own pill so the state is legible from the
                  rail without opening anything. */}
              <span
                className={`mono truncate text-[10px] uppercase tracking-wider ${
                  status[step.id].tone === "todo"
                    ? "text-amber-700 dark:text-amber-400"
                    : status[step.id].tone === "done"
                      ? "text-green-700 dark:text-green-400"
                      : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {status[step.id].label}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One collapsible step.
 *
 * APG accordion shape: the toggle is a `button` and the only child of the
 * heading, it carries `aria-expanded` and `aria-controls`, and the panel is
 * `hidden` rather than unmounted so `aria-controls` always points at a real
 * element and the browser's in-page search can still find a folded field.
 */
function StepCard({
  step,
  status,
  open,
  onToggle,
  children,
}: {
  step: (typeof STEPS)[number];
  status: { tone: StepTone; label: string };
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const panelId = `step-panel-${step.id}`;

  return (
    // `scroll-mt` clears the sticky navbar, and the sticky rail on top of it
    // from `sm` up — without it a jumped-to step lands underneath both.
    <section id={`step-${step.id}`} className="panel scroll-mt-20 sm:scroll-mt-44">
      <h2>
        <button
          type="button"
          id={`step-toggle-${step.id}`}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="interactive flex w-full items-start gap-3 rounded-xl px-4 py-4 text-left focus-inset sm:px-6"
        >
          <Readout className="mt-0.5 text-sm font-semibold text-gray-500 dark:text-gray-400">
            {step.number}
          </Readout>

          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
              {step.title}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {step.description}
            </span>
          </span>

          <span className="flex flex-shrink-0 items-center gap-2">
            <span className="hidden sm:block">
              <StepPill tone={status.tone} label={status.label} />
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
        <StepPill tone={status.tone} label={status.label} />
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

/** One label/value pair in the review step. */
function ReviewRow({
  label,
  value,
  fallback = "—",
  mono = false,
}: {
  label: string;
  value: string;
  /** Shown when the field is empty, in a quieter colour than a real value. */
  fallback?: string;
  mono?: boolean;
}) {
  const filled = value.trim().length > 0;
  return (
    <div className="min-w-0">
      <Eyebrow as="dt">{label}</Eyebrow>
      <dd
        className={`mt-1 break-words text-sm ${mono ? "mono " : ""}${
          filled
            ? "font-medium text-gray-900 dark:text-white"
            : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {filled ? value : fallback}
      </dd>
    </div>
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
        <Eyebrow as="span">Question {position}</Eyebrow>
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
