"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch, setToken } from "@/lib/clientAuth";
import {
  MAX_SKILLS,
  MAX_SKILL_LENGTH,
  SENIORITY_LEVELS,
  cleanSeniority,
  cleanTagList,
  isValidEmail,
} from "@/lib/validation";
import { updateProfile } from "@/store/authSlice";
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
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "@/app/components/ui";

/** Shape returned by `PUT /api/users/:id` — the user row plus a freshly signed token. */
interface UpdateProfileResponse {
  id: string;
  name: string;
  email: string;
  role: "SEEKER" | "COMPANY" | "ADMIN";
  profile?: string | null;
  companyId?: string | null;
  company?: { name: string } | null;
  token: string;
}

interface FormState {
  name: string;
  email: string;
  profile: string;
  /** The matching fields. Held as strings because they come from inputs. */
  headline: string;
  seniority: string;
  years: string;
}

const PROFILE_MAX = 2000;
const HEADLINE_MAX = 140;
const YEARS_MAX = 60;

/**
 * What an empty years box sends.
 *
 * `PUT /api/users/:id` gates the four matching fields on presence, so the key
 * has to be there — and it clamps years with `Number()`, which reads both
 * `null` and `""` as a literal zero years of experience. A non-numeric value is
 * the only thing that round-trips as "not specified", so that is what goes.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The matching half of a user row, read off whatever object is to hand.
 *
 * The JWT carries only session fields, so the rehydrated store normally has
 * none of these — `GET /api/users/:id` is the fallback. Seeding matters more
 * than it looks: the four fields are sent on every save, so a form that never
 * learned the stored values would wipe them the first time someone edited
 * their name.
 */
function readSignal(source: unknown): {
  headline: string;
  seniority: string;
  years: string;
  skills: string[];
} | null {
  if (!isRecord(source)) return null;
  const years = Number(source.yearsOfExp);
  return {
    headline: typeof source.headline === "string" ? source.headline : "",
    seniority: cleanSeniority(source.seniority) ?? "",
    years: Number.isFinite(years) && source.yearsOfExp !== null ? String(Math.trunc(years)) : "",
    skills: cleanTagList(source.skills),
  };
}

export default function EditSeekerProfilePage() {
  const { ready, allowed, user } = useAuthGuard(["SEEKER"]);
  const router = useRouter();
  const dispatch = useDispatch();
  const toast = useToast();

  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    profile: "",
    headline: "",
    seniority: "",
    years: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [skills, setSkills] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState("");
  /** Announced to screen readers whenever the tag list changes under them. */
  const [skillNotice, setSkillNotice] = useState("");

  /**
   * False until the stored matching fields are in hand. Until then they are
   * left out of the save entirely rather than sent blank — the server's
   * presence gate exists precisely so an uninformed form cannot erase them.
   */
  const [signalLoaded, setSignalLoaded] = useState(false);
  const [signalFailed, setSignalFailed] = useState(false);
  /** Set as soon as the user touches this section, so a late fetch defers. */
  const signalEdited = useRef(false);

  /** Focus targets, so a failed validation puts the cursor in the offending box. */
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const headlineRef = useRef<HTMLInputElement>(null);
  const yearsRef = useRef<HTMLInputElement>(null);

  /** The values as last seeded or saved, so "has anything changed?" is answerable. */
  const [baseline, setBaseline] = useState<{ form: FormState; skills: string[] } | null>(null);

  // Seed the form once the store has rehydrated. Keyed on the user id so it
  // doesn't clobber what the user is typing on every unrelated store update.
  useEffect(() => {
    if (!user) return;
    const stored = readSignal(user);
    const seeded: FormState = {
      name: user.name ?? "",
      email: user.email ?? "",
      profile: user.profile ?? "",
      headline: stored?.headline ?? "",
      seniority: stored?.seniority ?? "",
      years: stored?.years ?? "",
    };
    setForm(seeded);
    if (stored) setSkills(stored.skills);
    setBaseline({ form: seeded, skills: stored?.skills ?? [] });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Then the authoritative copy. The store is seeded from the JWT, which does
  // not carry these fields, so without this read the section would open empty
  // for everyone who has ever run the resume analyser.
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    apiFetch<unknown>(`/api/users/${user.id}`)
      .then((record) => {
        if (cancelled) return;
        const stored = readSignal(record);
        if (!stored) return;
        // Never overwrite something the user has already started changing.
        if (!signalEdited.current) {
          setForm((current) => ({
            ...current,
            headline: stored.headline,
            seniority: stored.seniority,
            years: stored.years,
          }));
          setSkills(stored.skills);
          // The unsaved-changes guard has to compare against what is really on
          // record, or the late arrival of these three fields would read as an
          // edit the user never made.
          setBaseline((current) =>
            current
              ? {
                  form: {
                    ...current.form,
                    headline: stored.headline,
                    seniority: stored.seniority,
                    years: stored.years,
                  },
                  skills: stored.skills,
                }
              : current
          );
        }
        setSignalLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Could not load your matching fields:", error);
        setSignalFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    const changedField = (Object.keys(baseline.form) as (keyof FormState)[]).some(
      (key) => form[key] !== baseline.form[key]
    );
    const changedSkills =
      skills.length !== baseline.skills.length ||
      skills.some((skill, index) => skill !== baseline.skills[index]);
    return changedField || changedSkills;
  }, [form, skills, baseline]);

  // A reload or a tab close with edits pending used to lose them silently.
  // In-app navigation is covered by the confirm on Cancel and Back.
  useEffect(() => {
    if (!dirty || saving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  const confirmDiscard = (event: React.MouseEvent) => {
    if (!dirty) return;
    if (!window.confirm("Leave without saving? Your changes will be lost.")) {
      event.preventDefault();
    }
  };

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;
    if (name === "headline" || name === "seniority" || name === "years") {
      signalEdited.current = true;
    }
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  /* ---------------------------------------------------------------------- */
  /* Skills tag editor                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Adds one or many tags in a single pass.
   *
   * `cleanTagList` is the same function the API and the resume parser use, so
   * a tag typed here is trimmed, length-capped and de-duplicated by exactly the
   * rules the server would have applied anyway — no drift between the two.
   */
  const addSkills = (raw: string[]) => {
    const incoming = cleanTagList(raw, MAX_SKILLS);
    setSkillDraft("");
    if (incoming.length === 0) return;

    const merged = cleanTagList([...skills, ...incoming], MAX_SKILLS);
    const added = merged.length - skills.length;

    if (added === 0) {
      setSkillNotice(
        skills.length >= MAX_SKILLS
          ? `Skill list is full at ${MAX_SKILLS}. Remove one to add another.`
          : `${incoming[0]} is already in your skills.`
      );
      return;
    }

    signalEdited.current = true;
    setSkills(merged);
    setSkillNotice(
      added === 1
        ? `${merged[merged.length - 1]} added. ${merged.length} of ${MAX_SKILLS} skills.`
        : `${added} skills added. ${merged.length} of ${MAX_SKILLS} skills.`
    );
  };

  const removeSkill = (tag: string) => {
    signalEdited.current = true;
    const next = skills.filter((skill) => skill !== tag);
    setSkills(next);
    setSkillNotice(`${tag} removed. ${next.length} of ${MAX_SKILLS} skills.`);
  };

  const handleSkillChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target;
    // A comma anywhere means a boundary — typed, or pasted in a whole list.
    if (value.includes(",")) {
      const parts = value.split(",");
      const trailing = parts.pop() ?? "";
      addSkills(parts);
      setSkillDraft(trailing.trim());
      return;
    }
    setSkillDraft(value);
  };

  const handleSkillKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Otherwise Enter in a tag box submits the whole form.
      event.preventDefault();
      addSkills([skillDraft]);
      return;
    }
    if (event.key === "Backspace" && skillDraft === "" && skills.length > 0) {
      event.preventDefault();
      removeSkill(skills[skills.length - 1]);
    }
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = "Please enter your name";
    else if (form.name.trim().length > 100) next.name = "Name must be 100 characters or fewer";
    if (!isValidEmail(form.email)) next.email = "Please enter a valid email address";
    if (form.headline.trim().length > HEADLINE_MAX) {
      next.headline = `Headline must be ${HEADLINE_MAX} characters or fewer`;
    }
    if (form.years.trim() !== "") {
      const years = Number(form.years);
      if (!Number.isInteger(years) || years < 0 || years > YEARS_MAX) {
        next.years = `Enter a whole number between 0 and ${YEARS_MAX}`;
      }
    }
    setErrors(next);

    // Send the user to the first box that needs them; on a phone the offending
    // field is often off-screen from the submit button they just pressed.
    const target = next.name
      ? nameRef
      : next.email
        ? emailRef
        : next.headline
          ? headlineRef
          : next.years
            ? yearsRef
            : null;
    target?.current?.focus();

    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!user) return;
    if (!validate()) return;

    setSaving(true);
    try {
      // The four matching fields are presence-gated server-side: send them and
      // they are replaced wholesale, omit them and they are left alone. So they
      // go as a block, and only once this form knows what is already stored.
      const signalFields = signalLoaded
        ? {
            headline: form.headline.trim() || null,
            seniority: form.seniority || null,
            // null, not "", so the server records "unset" rather than zero years.
            yearsOfExp: form.years.trim() === "" ? null : Number(form.years),
            skills,
          }
        : {};

      const updated = await apiFetch<UpdateProfileResponse>(`/api/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          profile: form.profile.trim(),
          ...signalFields,
        }),
      });

      dispatch(
        updateProfile({
          name: updated.name,
          email: updated.email,
          profile: updated.profile ?? undefined,
        })
      );

      // The JWT embeds the name/email, so without re-storing the re-issued token
      // `AuthRehydrator` would read the stale cookie on the next load and the
      // edit would look as though it had been silently reverted (audit 2.8).
      if (updated.token) setToken(updated.token);

      // Clearing the baseline before navigating stops the unsaved-changes guard
      // firing on the way out of a save that succeeded.
      setBaseline({ form, skills });
      toast.success("Profile updated");
      router.push("/seeker/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update your profile";
      console.error("Profile update failed:", error);
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner label="Loading your profile" />
      </div>
    );
  }

  if (!allowed) return null;

  const remaining = PROFILE_MAX - form.profile.length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/seeker/dashboard"
          onClick={confirmDiscard}
          className="mb-5 inline-flex items-center gap-1.5 rounded text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <Icon.arrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <PageHeading
          eyebrow="Seeker record"
          title="Edit profile"
          description="Employers read this alongside every application you send."
          className="mb-6"
        />

        <Card>
          <CardHeader
            eyebrow="Fields"
            title="Your details"
            description="Changes take effect the moment you save."
          />

          <form
            onSubmit={handleSubmit}
            noValidate
            aria-busy={saving}
            className="space-y-6 p-4 sm:p-6"
          >
            {formError && <Alert variant="error">{formError}</Alert>}

            <div>
              <Label htmlFor="name" required>
                Full name
              </Label>
              <input
                ref={nameRef}
                id="name"
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                autoComplete="name"
                maxLength={100}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "name-error" : undefined}
                className={inputClass}
              />
              {errors.name && (
                <p id="name-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              {/* The helper line stays its own element rather than moving into
                  `<Label hint>`: `aria-describedby` points at `#email-hint`, and
                  the hint slot renders no id to point at. */}
              <Label htmlFor="email" required>
                Email address
              </Label>
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                autoComplete="email"
                inputMode="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : "email-hint"}
                className={inputClass}
              />
              {errors.email ? (
                <p id="email-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {errors.email}
                </p>
              ) : (
                <p id="email-hint" className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                  You will use this address to sign in.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="profile" hint="Optional. A short summary is enough — a few sentences.">
                About you
              </Label>
              <textarea
                id="profile"
                name="profile"
                rows={5}
                value={form.profile}
                onChange={handleChange}
                maxLength={PROFILE_MAX}
                placeholder="A short summary of your experience, skills and what you're looking for."
                className={`${inputClass} resize-y`}
              />
              {/* A counter is machine output, so it reads in mono with tabular
                  figures — the digits don't jitter as you type. */}
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                <Readout className="text-xs font-medium">{remaining}</Readout> characters remaining
              </p>
            </div>

            {/* The matching half of the profile. Separated by a rule and its
                own eyebrow rather than a second card, so it is plainly one
                form with one save. */}
            <section
              aria-labelledby="signal-heading"
              className="border-t border-gray-200 pt-6 dark:border-gray-700"
            >
              <Eyebrow className="mb-1.5 flex items-center gap-1.5" as="div">
                <Icon.graph className="h-3.5 w-3.5" />
                Profile signal
              </Eyebrow>
              <h3
                id="signal-heading"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                What we match you on
              </h3>
              <p className="mt-1 max-w-prose text-sm text-gray-500 dark:text-gray-400">
                These four fields are what job matching scores roles against — and anything the
                resume reader filled in for you can be corrected here.
              </p>

              {signalFailed && (
                <Alert variant="warning" className="mt-4">
                  We could not load your saved matching fields, so they are left untouched by this
                  save. Reload the page to edit them.
                </Alert>
              )}

              <div className="mt-5 space-y-6">
                <div>
                  <Label htmlFor="headline" hint="One line: what you do. Shown on your profile.">
                    Headline
                  </Label>
                  <input
                    id="headline"
                    name="headline"
                    type="text"
                    value={form.headline}
                    onChange={handleChange}
                    disabled={!signalLoaded}
                    maxLength={HEADLINE_MAX}
                    placeholder="Backend engineer building payment systems"
                    aria-invalid={!!errors.headline}
                    aria-describedby={errors.headline ? "headline-error" : undefined}
                    className={inputClass}
                  />
                  {errors.headline && (
                    <p
                      id="headline-error"
                      className="mt-1.5 text-sm text-red-600 dark:text-red-400"
                    >
                      {errors.headline}
                    </p>
                  )}
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="seniority">Seniority</Label>
                    <select
                      id="seniority"
                      name="seniority"
                      value={form.seniority}
                      onChange={handleChange}
                      disabled={!signalLoaded}
                      className={inputClass}
                    >
                      <option value="">Not specified</option>
                      {SENIORITY_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="years">Years of experience</Label>
                    <input
                      id="years"
                      name="years"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={YEARS_MAX}
                      step={1}
                      value={form.years}
                      onChange={handleChange}
                      disabled={!signalLoaded}
                      placeholder="Not specified"
                      aria-invalid={!!errors.years}
                      aria-describedby={errors.years ? "years-error" : undefined}
                      className={`${inputClass} mono`}
                    />
                    {errors.years && (
                      <p id="years-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                        {errors.years}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <Label htmlFor="skill-input">Skills</Label>

                  {/* The box is the field: the chips sit inside it and the ring
                      follows focus into it, so the whole thing reads as one
                      control rather than a list next to a text input. */}
                  <div className="rounded-lg border border-gray-300 bg-white p-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800">
                    {skills.length > 0 && (
                      <ul className="mb-2 flex list-none flex-wrap gap-1.5">
                        {skills.map((skill) => (
                          <li key={skill}>
                            <Chip>
                              {skill}
                              <button
                                type="button"
                                onClick={() => removeSkill(skill)}
                                disabled={!signalLoaded}
                                className="-mr-0.5 rounded p-0.5 text-gray-400 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-white"
                              >
                                <Icon.x className="h-3 w-3" />
                                <span className="sr-only">Remove {skill}</span>
                              </button>
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    )}
                    <input
                      id="skill-input"
                      type="text"
                      value={skillDraft}
                      onChange={handleSkillChange}
                      onKeyDown={handleSkillKeyDown}
                      // Tabbing away should keep what was typed, not drop it.
                      onBlur={() => addSkills([skillDraft])}
                      // Left enabled at the cap: disabling it would take away
                      // Backspace-to-remove, the only keyboard way back out.
                      disabled={!signalLoaded}
                      maxLength={MAX_SKILL_LENGTH}
                      placeholder={
                        skills.length >= MAX_SKILLS
                          ? `${MAX_SKILLS} is the limit — remove one to add another`
                          : "Type a skill, then press Enter"
                      }
                      aria-describedby="skill-hint"
                      className="w-full bg-transparent px-1.5 py-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed dark:text-white dark:placeholder:text-gray-500"
                    />
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p id="skill-hint" className="text-xs text-gray-500 dark:text-gray-400">
                      Enter or a comma adds a skill. Backspace in an empty box removes the last
                      one.
                    </p>
                    <Readout className="text-xs font-medium">
                      {skills.length} / {MAX_SKILLS}
                    </Readout>
                  </div>

                  {/* Chips appearing and vanishing is the sighted feedback; this
                      is the same event for anyone not watching the box. */}
                  <p aria-live="polite" className="sr-only">
                    {skillNotice}
                  </p>
                </div>
              </div>
            </section>

            <div
              className="flex flex-col gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row"
              aria-live="polite"
            >
              <button type="submit" disabled={saving} className={buttonPrimary}>
                {saving ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Icon.check className="h-4 w-4" />
                    Save changes
                  </>
                )}
              </button>
              <Link href="/seeker/dashboard" className={buttonSecondary}>
                Cancel
              </Link>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
