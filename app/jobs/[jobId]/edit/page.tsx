"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import { JOB_TYPES, isJobType } from "@/lib/validation";
import {
  Alert,
  Card,
  CardHeader,
  Eyebrow,
  Icon,
  JobStateBadge,
  Label,
  PageHeading,
  Readout,
  Spinner,
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  formatDate,
  inputClass,
} from "@/app/components/ui";

interface JobDetail {
  id: string;
  title: string;
  description: string;
  salary?: string | null;
  experience?: string | null;
  location?: string | null;
  type?: string | null;
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
  isActive: boolean;
}

const MAX_TITLE = 150;
const MAX_DESCRIPTION = 10000;

/** Single source of truth for form shape, so the dirty check compares like with like. */
function toForm(job: JobDetail): JobFormState {
  return {
    title: job.title ?? "",
    description: job.description ?? "",
    salary: job.salary ?? "",
    experience: job.experience ?? "",
    location: job.location ?? "",
    type: job.type ?? "",
    isActive: job.isActive,
  };
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

  useEffect(() => {
    if (!allowed) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setLoadError("");
        const data = await apiFetch<JobDetail>(`/api/jobs/${jobId}`);
        if (cancelled) return;
        setJob(data);
        setFormData(toForm(data));
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

  const isDirty = useMemo(() => {
    if (!job || !formData) return false;
    return JSON.stringify(formData) !== JSON.stringify(toForm(job));
  }, [job, formData]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const target = e.target;
    const value =
      target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    setFormData((current) => (current ? { ...current, [target.name]: value } : current));
    setSaved(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData) return;

    setFormError("");

    const title = formData.title.trim();
    const description = formData.description.trim();

    if (!title) {
      setFormError("Job title is required");
      return;
    }
    if (!description) {
      setFormError("Job description is required");
      return;
    }
    if (!isJobType(formData.type)) {
      setFormError("Choose a job type");
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
        setJob(updated);
        setFormData(toForm(updated));
      }
      setSaved(true);
      toast.success("Changes saved.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update job";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(async () => {
    if (!job) return;

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
      router.push("/company/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete job";
      setFormError(message);
      toast.error(message);
      setDeleting(false);
    }
  }, [job, jobId, router, toast]);

  /* ---------------------------------------------------------------------- */

  if (!ready || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-blue-600 dark:bg-gray-900 dark:text-blue-400">
        <Spinner label="Loading…" />
      </div>
    );
  }

  const notOwner = job?.isOwner === false;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href="/company/dashboard" className={`${buttonGhost} -ml-2.5 mb-4`}>
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
                {formError}
              </Alert>
            )}

            {saved && !isDirty && (
              <Alert variant="success" className="mb-6">
                Changes saved.{" "}
                <Link href={`/jobs/${job.id}`} className="font-medium underline underline-offset-2">
                  View the posting
                </Link>
              </Alert>
            )}

            <Card>
              <CardHeader
                eyebrow="Draft"
                title="Job details"
                description="Changes go live as soon as you save."
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
                      <Label htmlFor="description" required>
                        Job description
                      </Label>
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
                        <Readout className="text-xs text-gray-500 dark:text-gray-400">
                          {formData.description.length.toLocaleString()}/
                          {MAX_DESCRIPTION.toLocaleString()}
                        </Readout>
                      </p>
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
                        value={formData.salary}
                        onChange={handleChange}
                        placeholder="e.g. ₹18–25 LPA"
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
                        value={formData.experience}
                        onChange={handleChange}
                        placeholder="e.g. 3–5 years"
                        maxLength={100}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </section>

                {/* A bare checkbox never explained what "active" actually does,
                    so the state badge and its consequence lead, and the control
                    itself sits on the right as a switch. */}
                <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
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

                <div className="mt-8 flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-end">
                  <p className="eyebrow text-center sm:mr-auto sm:text-left" aria-live="polite">
                    {isDirty ? "Unsaved changes" : "Everything is saved"}
                  </p>
                  <Link href="/company/dashboard" className={`${buttonSecondary} w-full sm:w-auto`}>
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={saving || deleting || !isDirty}
                    className={`${buttonPrimary} w-full sm:w-auto`}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
