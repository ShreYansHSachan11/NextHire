"use client";

import React, { useState } from "react";
import Link from "next/link";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch } from "@/lib/clientAuth";
import { JOB_TYPES, isJobType } from "@/lib/validation";
import {
  Alert,
  Card,
  CardHeader,
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

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((current) => ({ ...current, [name]: value }));
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
        }),
      });

      setCreated(job);
      setFormData(EMPTY_FORM);
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
                  <Label htmlFor="description" required>
                    Job description
                  </Label>
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
