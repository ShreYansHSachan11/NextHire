"use client";

import React, { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useRouter } from "next/navigation";
import Link from "next/link";

import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { apiFetch, setToken } from "@/lib/clientAuth";
import { isValidEmail } from "@/lib/validation";
import { updateProfile } from "@/store/authSlice";
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
}

const PROFILE_MAX = 2000;

export default function EditSeekerProfilePage() {
  const { ready, allowed, user } = useAuthGuard(["SEEKER"]);
  const router = useRouter();
  const dispatch = useDispatch();
  const toast = useToast();

  const [form, setForm] = useState<FormState>({ name: "", email: "", profile: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed the form once the store has rehydrated. Keyed on the user id so it
  // doesn't clobber what the user is typing on every unrelated store update.
  useEffect(() => {
    if (!user) return;
    setForm({ name: user.name ?? "", email: user.email ?? "", profile: user.profile ?? "" });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) next.name = "Please enter your name";
    else if (form.name.trim().length > 100) next.name = "Name must be 100 characters or fewer";
    if (!isValidEmail(form.email)) next.email = "Please enter a valid email address";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (!user) return;
    if (!validate()) return;

    setSaving(true);
    try {
      const updated = await apiFetch<UpdateProfileResponse>(`/api/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          profile: form.profile.trim(),
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

          <form onSubmit={handleSubmit} noValidate className="space-y-6 p-4 sm:p-6">
            {formError && <Alert variant="error">{formError}</Alert>}

            <div>
              <Label htmlFor="name" required>
                Full name
              </Label>
              <input
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
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                autoComplete="email"
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
