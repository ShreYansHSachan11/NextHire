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
  CardHeader,
  Chip,
  Eyebrow,
  Icon,
  Label,
  PageHeading,
  Readout,
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

/* -------------------------------------------------------------------------- */
/* Drafting help — POST /api/ai/assist                                         */
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
 * Error message, and this caller has to tell "the deployment has no model"
 * (503, hide the feature and say nothing) apart from "the call failed" (502 or
 * a network blip, worth one toast).
 */
async function requestAssist<T>(body: Record<string, unknown>): Promise<AssistOutcome<T>> {
  try {
    const res = await fetch("/api/ai/assist", {
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
    console.error("AI assist request failed:", error);
    return { ok: false, unavailable: false, message: ASSIST_FAILED };
  }
}

const EMPTY_FORM = {
  title: "",
  description: "",
  salary: "",
  experience: "",
  location: "",
  type: "",
};

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

  // Optimistic: the buttons are offered until the endpoint answers 503 once.
  // After that they stay hidden for the session and the form is exactly the
  // form a deployment without a Gemini key has always had.
  const [aiAvailable, setAiAvailable] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [draft, setDraft] = useState<DescriptionDraft | null>(null);

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
    const outcome = await requestAssist<DescriptionDraft>({
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
    const outcome = await requestAssist<SkillsDraft>({ mode: "job-skills", title, description });
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
    toast.success("Draft inserted — read it through and edit before posting.");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreated(null);

    const title = formData.title.trim();
    const description = formData.description.trim();

    if (!title) {
      setError("Job title is required");
      return;
    }
    if (!description) {
      setError("Job description is required");
      return;
    }
    if (!isJobType(formData.type)) {
      setError("Choose a job type");
      return;
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
      setFormData(EMPTY_FORM);
      applySkills([]);
      setSkillInput("");
      setSkillNotice("");
      setDraft(null);
      toast.success("Job posted.");
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
    // `useAuthGuard` is already redirecting; render a placeholder rather than
    // flashing the form.
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-blue-600 dark:bg-gray-900 dark:text-blue-400">
        <Spinner label="Loading…" />
      </div>
    );
  }

  const hasCompany = Boolean(user?.companyId);
  const descriptionLength = formData.description.length;
  const atDescriptionLimit = descriptionLength >= MAX_DESCRIPTION;
  // The assistant writes *from* something; with no title it has nothing to go on.
  const titleFilled = formData.title.trim().length > 0;
  const canSuggestSkills = titleFilled && formData.description.trim().length > 0;
  const skillsFull = skills.length >= MAX_SKILLS;
  const suggestedTitleIsNew =
    !!draft && draft.suggestedTitle.trim().toLowerCase() !== formData.title.trim().toLowerCase();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
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
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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

        <Card>
          <CardHeader
            eyebrow="Draft"
            title="Job details"
            description="Only the title, description and job type are required — everything else helps candidates self-select."
          />

          <form onSubmit={handleSubmit} className="px-4 py-5 sm:px-6 sm:py-6" noValidate>
            {/* Section 1 — the role itself. */}
            <section aria-labelledby="section-role">
              <h3 id="section-role" className="eyebrow mb-4">
                01 · The role
              </h3>

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
                      <button
                        type="button"
                        onClick={() => void handleDraft()}
                        disabled={!titleFilled || drafting}
                        aria-describedby={titleFilled ? undefined : "ai-draft-hint"}
                        className={`${buttonSecondary} mb-2 disabled:cursor-not-allowed disabled:opacity-50`}
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
                    )}
                  </div>
                  {aiAvailable && !titleFilled && (
                    <p id="ai-draft-hint" className="eyebrow mb-2">
                      Add a job title to draft from
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
                                  className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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
                </div>
              </div>
            </section>

            {/* Section 2 — the particulars, on a hairline divider. */}
            <section
              aria-labelledby="section-particulars"
              className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700"
            >
              <h3 id="section-particulars" className="eyebrow mb-4">
                02 · Particulars
              </h3>

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
                    maxLength={120}
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
                    maxLength={100}
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
                    maxLength={100}
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
                              className="-mr-0.5 rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-gray-100"
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
                    maxLength={MAX_SKILL_LENGTH}
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
                    <Readout className="text-xs text-gray-500 dark:text-gray-400">
                      {skills.length}/{MAX_SKILLS}
                    </Readout>
                  </div>

                  <p aria-live="polite" className="eyebrow mt-1 normal-case tracking-normal">
                    {skillNotice}
                  </p>
                </div>
              </div>
            </section>

            <div className="mt-8 flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row sm:justify-end">
              <Link href="/company/dashboard" className={`${buttonSecondary} w-full sm:w-auto`}>
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !hasCompany}
                className={`${buttonPrimary} w-full sm:w-auto`}
              >
                {loading ? (
                  "Posting…"
                ) : (
                  <>
                    <Icon.plus className="h-4 w-4" />
                    Post job
                  </>
                )}
              </button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
