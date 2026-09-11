"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { updateProfile } from "@/store/authSlice";
import { apiFetch, setToken } from "@/lib/clientAuth";
import { isValidEmail } from "@/lib/validation";
import {
  Alert,
  Card,
  CardHeader,
  Icon,
  Label,
  PageHeading,
  Readout,
  Spinner,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "@/app/components/ui";

interface CompanyProfileForm {
  name: string;
  email: string;
  profile: string;
  website: string;
  industry: string;
  size: string;
  location: string;
  description: string;
}

/** `PUT /api/users/:id` answers with the user plus a freshly signed token. */
interface UpdateUserResponse {
  id: string;
  name: string;
  email: string;
  role: "SEEKER" | "COMPANY" | "ADMIN";
  companyId?: string;
  company?: { name: string } | null;
  profile?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  description?: string | null;
  token: string;
}

const INDUSTRIES = [
  "Technology",
  "Healthcare",
  "Finance",
  "Education",
  "Manufacturing",
  "Retail",
  "Marketing",
  "Consulting",
  "Real Estate",
  "Other",
];

const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"];

/**
 * The server's own caps (`cleanText` in `PUT /api/users/:id`). Enforced here too
 * so a long paragraph is stopped at the box rather than silently truncated
 * after a save that reported success.
 */
const DESCRIPTION_MAX = 5000;
const PROFILE_MAX = 2000;

const EMPTY_FORM: CompanyProfileForm = {
  name: "",
  email: "",
  profile: "",
  website: "",
  industry: "",
  size: "",
  location: "",
  description: "",
};

/**
 * Mirrors `cleanUrl` on the server: a bare `example.com` is accepted and
 * normalised there, so the form must not reject it either.
 */
function isPlausibleWebsite(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return /^[^\s.]+(\.[^\s.]+)+$/.test(url.hostname);
  } catch {
    return false;
  }
}

export default function CompanyProfileEdit() {
  const { ready, allowed, user } = useAuthGuard(["COMPANY"]);
  const dispatch = useDispatch();
  const router = useRouter();
  const toast = useToast();

  const [formData, setFormData] = useState<CompanyProfileForm>(EMPTY_FORM);
  /** The values as last loaded or saved, so "has anything changed?" is answerable. */
  const [baseline, setBaseline] = useState<CompanyProfileForm>(EMPTY_FORM);
  /** Mirror of `baseline` for the record fetch below, which must read the
   *  current value without re-running when it changes. */
  const baselineRef = useRef<CompanyProfileForm>(EMPTY_FORM);
  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyProfileForm, string>>>({});

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const websiteRef = useRef<HTMLInputElement>(null);

  // Keyed on the user *id*, not the user object: the store hands back a new
  // object on every unrelated update, and re-seeding on those wiped whatever
  // was half-typed in the form.
  useEffect(() => {
    if (!user) return;
    const seeded: CompanyProfileForm = {
      name: user.name ?? "",
      email: user.email ?? "",
      profile: user.profile ?? "",
      website: user.website ?? "",
      industry: user.industry ?? "",
      size: user.size ?? "",
      location: user.location ?? "",
      description: user.description ?? "",
    };
    setFormData(seeded);
    setBaseline(seeded);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Then the authoritative copy, exactly as the seeker editor does.
   *
   * The seed above comes from the Redux store, which on a cold load is
   * rehydrated from the JWT — and the JWT carries only id, name, email, role
   * and company. Website, industry, size, location, description and profile
   * seeded as "" for everyone who had actually filled them in, so the form
   * opened blank and saving it wrote those blanks straight back over six real
   * columns. The route is presence-gated now, which stops the data loss, but
   * without this read the employer would still be shown an empty form and
   * would have to retype what was already on record.
   */
  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    apiFetch<Partial<CompanyProfileForm>>(`/api/users/${user.id}`)
      .then((record) => {
        if (cancelled) return;

        const stored: CompanyProfileForm = {
          name: record.name ?? user.name ?? "",
          email: record.email ?? user.email ?? "",
          profile: record.profile ?? "",
          website: record.website ?? "",
          industry: record.industry ?? "",
          size: record.size ?? "",
          location: record.location ?? "",
          description: record.description ?? "",
        };

        // Never clobber something already being typed: compare against the
        // baseline rather than the live form, and only adopt the record when
        // the user has not started editing.
        setFormData((current) =>
          (Object.keys(stored) as (keyof CompanyProfileForm)[]).some(
            (key) => current[key] !== baselineRef.current[key]
          )
            ? current
            : stored
        );
        // The unsaved-changes guard has to compare against what is really on
        // record, or this late arrival would read as an edit nobody made.
        setBaseline(stored);
      })
      .catch(() => {
        // The seeded form still works; this read only enriches it.
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(
    () => (Object.keys(baseline) as (keyof CompanyProfileForm)[]).some(
      (key) => formData[key] !== baseline[key]
    ),
    [formData, baseline]
  );

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

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    if (error) setError("");
  };

  /**
   * Client-side mirror of the server's rules. Errors land on the fields
   * themselves rather than in one banner, so it is obvious which box is wrong —
   * the server is still the authority on whether the save is accepted.
   */
  const validate = (): Partial<Record<keyof CompanyProfileForm, string>> => {
    const next: Partial<Record<keyof CompanyProfileForm, string>> = {};
    if (!formData.name.trim()) next.name = "Company name is required";
    if (!formData.email.trim()) next.email = "Email address is required";
    else if (!isValidEmail(formData.email.trim())) next.email = "Enter a valid email address";
    if (!isPlausibleWebsite(formData.website)) {
      next.website = "Enter a valid website, for example example.com";
    }
    return next;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Send the user to the first box that needs them rather than leaving them
      // to work out which of eight fields the message is about.
      const target = found.name ? nameRef : found.email ? emailRef : websiteRef;
      target.current?.focus();
      return;
    }

    setSaving(true);
    setError("");

    try {
      const { token, ...updatedUser } = await apiFetch<UpdateUserResponse>(
        `/api/users/${user.id}`,
        { method: "PUT", body: JSON.stringify(formData) }
      );

      // The cookie still held the old name/companyName, and `AuthRehydrator`
      // re-reads it on the next load — without storing the re-issued token the
      // edit silently reverts itself.
      if (token) setToken(token);
      dispatch(
        updateProfile({
          ...updatedUser,
          company: updatedUser.company ?? undefined,
          profile: updatedUser.profile ?? undefined,
          website: updatedUser.website ?? undefined,
          industry: updatedUser.industry ?? undefined,
          size: updatedUser.size ?? undefined,
          location: updatedUser.location ?? undefined,
          description: updatedUser.description ?? undefined,
        })
      );

      // Clearing the baseline before navigating stops the unsaved-changes guard
      // firing on the way out of a save that succeeded.
      setBaseline(formData);
      toast.success("Company profile updated");
      router.push("/company/dashboard");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to update profile";
      console.error("Error updating profile:", submitError);
      setError(message);
      toast.error(message);
      // Only re-enable on failure: the success path navigates away, and a form
      // that came back to life mid-push would accept a second save.
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Spinner className="h-10 w-10" label="Loading profile" />
      </div>
    );
  }

  if (!allowed) return null; // the guard is already redirecting

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />

      <main id="main-content" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/company/dashboard"
          onClick={confirmDiscard}
          className="mb-5 inline-flex items-center gap-1.5 rounded text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-white"
        >
          <Icon.arrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>

        <PageHeading
          eyebrow="Company record"
          title="Edit company profile"
          description="Update how your company appears to candidates across listings and search."
          className="mb-6"
        />

        <Card>
          <CardHeader
            eyebrow="Fields"
            title="Company information"
            description="These details show on your job listings and company profile."
          />

          <form onSubmit={handleSubmit} className="space-y-6 p-4 sm:p-6" noValidate aria-busy={saving}>
            {/* Server-side refusals only; anything caught here lands on its field. */}
            {error && <Alert variant="error">{error}</Alert>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              <div>
                {/* The hint now lives inside the <label>, so it is announced with
                    the field itself and needs no separate aria-describedby. */}
                <Label
                  htmlFor="name"
                  required
                  hint="This also renames your company on every job listing you have posted."
                >
                  Company name
                </Label>
                <input
                  ref={nameRef}
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  autoComplete="organization"
                  maxLength={100}
                  aria-invalid={Boolean(errors.name) || undefined}
                  aria-describedby={errors.name ? "name-error" : undefined}
                  className={inputClass}
                  placeholder="Acme Inc."
                  required
                />
                {errors.name && (
                  <p id="name-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {errors.name}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="email" required>
                  Email address
                </Label>
                <input
                  ref={emailRef}
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={Boolean(errors.email) || undefined}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className={inputClass}
                  placeholder="hiring@acme.com"
                  required
                />
                {errors.email && (
                  <p id="email-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {errors.email}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="website" hint="You can leave off https:// — we will add it for you.">
                  Website
                </Label>
                <input
                  ref={websiteRef}
                  // Deliberately not type="url": the browser would reject a bare
                  // `example.com`, which the server happily normalises.
                  type="text"
                  inputMode="url"
                  id="website"
                  name="website"
                  value={formData.website}
                  onChange={handleInputChange}
                  autoComplete="url"
                  aria-invalid={Boolean(errors.website) || undefined}
                  aria-describedby={errors.website ? "website-error" : undefined}
                  className={inputClass}
                  placeholder="example.com"
                />
                {errors.website && (
                  <p id="website-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {errors.website}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="industry">Industry</Label>
                <select
                  id="industry"
                  name="industry"
                  value={formData.industry}
                  onChange={handleInputChange}
                  className={inputClass}
                >
                  <option value="">Select industry</option>
                  {INDUSTRIES.map((industry) => (
                    <option key={industry} value={industry}>
                      {industry}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="size">Company size</Label>
                <select
                  id="size"
                  name="size"
                  value={formData.size}
                  onChange={handleInputChange}
                  className={inputClass}
                >
                  <option value="">Select size</option>
                  {SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} employees
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="location">Location</Label>
                <input
                  type="text"
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  autoComplete="address-level2"
                  maxLength={100}
                  className={inputClass}
                  placeholder="City, State/Country"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="description" hint="One short paragraph — it heads your company page.">
                Company description
              </Label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={4}
                maxLength={DESCRIPTION_MAX}
                className={`${inputClass} resize-y`}
                placeholder="Tell candidates about your company, mission and values..."
              />
              <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                <Readout className="text-xs font-medium">
                  {DESCRIPTION_MAX - formData.description.length}
                </Readout>{" "}
                characters remaining
              </p>
            </div>

            <div>
              <Label htmlFor="profile" hint="The long form: history, culture and what to expect.">
                Company profile
              </Label>
              <textarea
                id="profile"
                name="profile"
                value={formData.profile}
                onChange={handleInputChange}
                rows={6}
                maxLength={PROFILE_MAX}
                className={`${inputClass} resize-y`}
                placeholder="History, achievements, culture, and what candidates can expect when working with you..."
              />
              <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">
                <Readout className="text-xs font-medium">
                  {PROFILE_MAX - formData.profile.length}
                </Readout>{" "}
                characters remaining
              </p>
            </div>

            {/* Save and Cancel used to share the row equally, which read as two
                equal choices; the primary now carries its own weight, matching
                the seeker profile editor. */}
            <div className="flex flex-col gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row">
              <button type="submit" disabled={saving} aria-busy={saving} className={buttonPrimary}>
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

              <Link
                href="/company/dashboard"
                onClick={confirmDiscard}
                className={buttonSecondary}
              >
                <Icon.x className="h-4 w-4" />
                Cancel
              </Link>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
