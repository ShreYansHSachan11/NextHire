"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDispatch } from "react-redux";
import Navbar from "@/app/components/Navbar";
import { useToast } from "@/app/components/Toast";
import { useAuthGuard } from "@/app/hooks/useAuthGuard";
import { updateProfile } from "@/store/authSlice";
import { apiFetch, setToken } from "@/lib/clientAuth";
import {
  Alert,
  Card,
  CardHeader,
  Icon,
  Label,
  PageHeading,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!user) return;
    setFormData({
      name: user.name ?? "",
      email: user.email ?? "",
      profile: user.profile ?? "",
      website: user.website ?? "",
      industry: user.industry ?? "",
      size: user.size ?? "",
      location: user.location ?? "",
      description: user.description ?? "",
    });
  }, [user]);

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    if (error) setError("");
    if (success) setSuccess("");
  };

  const validate = (): string | null => {
    if (!formData.name.trim()) return "Company name is required";
    if (!formData.email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(formData.email.trim())) {
      return "Please enter a valid email address";
    }
    if (!isPlausibleWebsite(formData.website)) {
      return "Please enter a valid website, for example example.com";
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

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

      setSuccess("Profile updated");
      toast.success("Company profile updated");
      router.push("/company/dashboard");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Failed to update profile";
      console.error("Error updating profile:", submitError);
      setError(message);
      toast.error(message);
    } finally {
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
          className="mb-5 inline-flex items-center gap-1.5 rounded text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-white"
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

          <form onSubmit={handleSubmit} className="space-y-6 p-4 sm:p-6" noValidate>
            {/* Announced so a validation failure is not silent for screen readers. */}
            <div aria-live="polite">
              {error && <Alert variant="error">{error}</Alert>}
              {success && <Alert variant="success">{success}</Alert>}
            </div>

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
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className={inputClass}
                  placeholder="Acme Inc."
                  required
                />
              </div>

              <div>
                <Label htmlFor="email" required>
                  Email address
                </Label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className={inputClass}
                  placeholder="hiring@acme.com"
                  required
                />
              </div>

              <div>
                <Label htmlFor="website" hint="You can leave off https:// — we will add it for you.">
                  Website
                </Label>
                <input
                  // Deliberately not type="url": the browser would reject a bare
                  // `example.com`, which the server happily normalises.
                  type="text"
                  inputMode="url"
                  id="website"
                  name="website"
                  value={formData.website}
                  onChange={handleInputChange}
                  className={inputClass}
                  placeholder="example.com"
                />
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
                className={`${inputClass} resize-y`}
                placeholder="Tell candidates about your company, mission and values..."
              />
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
                className={`${inputClass} resize-y`}
                placeholder="History, achievements, culture, and what candidates can expect when working with you..."
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-200 pt-5 dark:border-gray-700 sm:flex-row">
              <button type="submit" disabled={saving} className={`${buttonPrimary} sm:flex-1`}>
                {saving ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Saving
                  </>
                ) : (
                  <>
                    <Icon.check className="h-4 w-4" />
                    Save changes
                  </>
                )}
              </button>

              <Link href="/company/dashboard" className={`${buttonSecondary} sm:flex-1`}>
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
