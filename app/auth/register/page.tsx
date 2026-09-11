"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { signIn } from "next-auth/react";
import { login } from "@/store/authSlice";
import type { AppDispatch, RootState } from "@/store/store";
import { apiFetch, setToken } from "@/lib/clientAuth";
import { MIN_PASSWORD_LENGTH, isValidEmail, validatePassword } from "@/lib/validation";
import { ThemeToggle } from "@/app/components/ThemeProvider";
import {
  Alert,
  Card,
  Eyebrow,
  Icon,
  Label,
  NumberedItem,
  Spinner,
  buttonPrimary,
  inputClass,
} from "@/app/components/ui";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "SEEKER" | "COMPANY" | "ADMIN";
  companyId?: string;
  company?: { name: string };
}

interface AuthResponse {
  message: string;
  token: string;
  user: AuthUser;
}

/** Only these two are selectable — the server rejects a self-assigned ADMIN. */
type SelectableRole = "SEEKER" | "COMPANY";

interface RoleOption {
  value: SelectableRole;
  /** Mono micro-label, so the two cards are distinguishable before you read them. */
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    value: "SEEKER",
    eyebrow: "Candidate",
    title: "I'm looking for a job",
    description: "Browse roles, apply in a click and message hiring teams directly.",
    icon: <Icon.search className="h-3.5 w-3.5" />,
  },
  {
    value: "COMPANY",
    eyebrow: "Employer",
    title: "I'm hiring",
    description:
      "Creates a company workspace named after you, where you post jobs and review applicants. You can rename it later from your company profile.",
    icon: <Icon.briefcase className="h-3.5 w-3.5" />,
  },
];

function dashboardFor(role: string): string {
  return role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard";
}

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "SEEKER" as SelectableRole,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** Separate from `loading`: the two sign-up routes must not disable each other's spinner. */
  const [googleLoading, setGoogleLoading] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const dispatch = useDispatch<AppDispatch>();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  // Redux rehydrates from the cookie inside an effect, so "already signed in"
  // is only knowable after mount.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !user) return;
    router.replace(dashboardFor(user.role));
  }, [hydrated, isAuthenticated, user, router]);

  // Mirrors the rules the server now enforces, so a rejection is never the
  // first time the user hears about them.
  const rules = useMemo(
    () => [
      { label: `At least ${MIN_PASSWORD_LENGTH} characters`, met: formData.password.length >= MIN_PASSWORD_LENGTH },
      { label: "Contains a letter", met: /[a-zA-Z]/.test(formData.password) },
      { label: "Contains a number", met: /[0-9]/.test(formData.password) },
    ],
    [formData.password]
  );

  const passwordError = validatePassword(formData.password);
  const emailError =
    formData.email.trim() && !isValidEmail(formData.email) ? "Enter a valid email address" : null;
  const mismatch =
    formData.confirmPassword.length > 0 && formData.confirmPassword !== formData.password;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((current) => ({ ...current, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setError("");

    const name = formData.name.trim();
    const email = formData.email.trim();

    // Each branch focuses the field it is complaining about: the banner sits at
    // the top of a long form, so on a phone it can be a screenful away from the
    // submit button the user just pressed.
    if (!name) {
      setError("Please enter your full name");
      nameRef.current?.focus();
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address");
      emailRef.current?.focus();
      return;
    }
    if (passwordError) {
      setError(passwordError);
      passwordRef.current?.focus();
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError("The two passwords do not match");
      confirmRef.current?.focus();
      return;
    }

    setLoading(true);

    try {
      const data = await apiFetch<AuthResponse>("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          action: "register",
          name,
          email,
          password: formData.password,
          role: formData.role,
        }),
      });

      // The server sets the cookie as well; writing it here too keeps the
      // SameSite/Secure flags identical whichever path produced it.
      setToken(data.token);
      dispatch(login({ user: data.user, token: data.token }));

      router.push(dashboardFor(data.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      // Keep the form disabled only while the request is in flight; on success
      // we navigate away, so re-enabling would allow a duplicate submission.
      setLoading(false);
    }
  };

  const showEmailError = Boolean(emailError) && (submitted || formData.email.length > 0);
  const nameError = submitted && !formData.name.trim() ? "Please enter your full name" : null;
  const busy = loading || googleLoading;

  const handleGoogle = () => {
    setError("");
    setGoogleLoading(true);
    // `signIn` navigates away; if it ever resolves without doing so, the button
    // would otherwise stay stuck in its loading state.
    void Promise.resolve(signIn("google")).finally(() => setGoogleLoading(false));
  };

  return (
    <main id="main-content" className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Form column. `min-h-screen` here rather than on the grid child keeps the
          single-column phone layout full-height too. */}
      <div className="flex min-h-screen flex-col">
        {/* Minimal header, matching the sign-in screen: the full app navbar has
            nothing useful to offer someone who has no account yet. */}
        <header className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-white dark:bg-white dark:text-gray-900">
              <Icon.graph className="h-5 w-5" />
            </span>
            <span className="mono text-sm font-bold uppercase tracking-[0.14em] text-gray-900 dark:text-white">
              NextHire
            </span>
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-4 pb-12 pt-2 sm:px-6 lg:px-10">
          <div className="w-full max-w-md">
            <div className="mb-7">
              <Eyebrow className="mb-2">Account · New</Eyebrow>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
                Create your account
              </h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                It takes a minute, and it is free.
              </p>
            </div>

            {error && (
              <Alert variant="error" className="mb-6">
                <span id="register-error">{error}</span>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-busy={loading}>
              <div>
                <Label htmlFor="name" required>
                  Full name
                </Label>
                <input
                  ref={nameRef}
                  type="text"
                  id="name"
                  name="name"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  maxLength={120}
                  aria-invalid={Boolean(nameError) || undefined}
                  aria-describedby={nameError ? "name-error" : undefined}
                  className={inputClass}
                />
                {nameError && (
                  <p id="name-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                    {nameError}
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
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  aria-invalid={showEmailError || undefined}
                  aria-describedby={showEmailError ? "email-error" : undefined}
                  className={inputClass}
                />
                {showEmailError && (
                  <p id="email-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                    {emailError}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="password" required>
                  Password
                </Label>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    type={showPassword ? "text" : "password"}
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    placeholder="Create a password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    aria-invalid={(submitted && Boolean(passwordError)) || undefined}
                    aria-describedby="password-rules"
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:text-white"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>

                {/* A live checklist beats the old static "at least 6 characters"
                    line, which no longer matched what the server accepts. The
                    rules are machine-checked, so they are set in mono. */}
                <ul id="password-rules" className="mt-2.5 space-y-1.5">
                  {rules.map((rule) => (
                    <li
                      key={rule.label}
                      className={`mono flex items-center gap-2 text-[11px] ${
                        rule.met
                          ? "text-green-700 dark:text-green-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {rule.met ? (
                        <Icon.check className="h-3.5 w-3.5 flex-shrink-0" />
                      ) : (
                        // An unmet rule gets a neutral dot rather than a hollow
                        // tick, so only the emerald ticks read as confirmation.
                        <span
                          className="ml-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300 dark:bg-gray-600"
                          aria-hidden="true"
                        />
                      )}
                      <span>{rule.label}</span>
                      <span className="sr-only">{rule.met ? " — met" : " — not met yet"}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <Label htmlFor="confirmPassword" required>
                  Confirm password
                </Label>
                <input
                  ref={confirmRef}
                  type={showPassword ? "text" : "password"}
                  id="confirmPassword"
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="Re-enter your password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                  aria-invalid={mismatch || undefined}
                  aria-describedby={mismatch ? "confirm-error" : undefined}
                  className={inputClass}
                />
                {mismatch && (
                  <p id="confirm-error" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                    The two passwords do not match.
                  </p>
                )}
              </div>

              {/* A bare "I am a" select never explained that picking Company
                  provisions a whole workspace, which is what the server does. */}
              <fieldset>
                <legend className="eyebrow mb-2">How will you use NextHire?</legend>
                <div className="space-y-3">
                  {ROLE_OPTIONS.map((option) => {
                    const selected = formData.role === option.value;
                    return (
                      // The label wraps the card so the whole surface is a hit
                      // target, while the control underneath stays a real radio.
                      <label
                        key={option.value}
                        htmlFor={`role-${option.value}`}
                        className="block cursor-pointer"
                      >
                        <Card
                          signal={selected}
                          className={`flex gap-3 p-3 transition-colors focus-within:ring-2 focus-within:ring-blue-500 sm:p-4 ${
                            selected ? "" : "hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                        >
                          <input
                            type="radio"
                            id={`role-${option.value}`}
                            name="role"
                            value={option.value}
                            checked={selected}
                            onChange={() =>
                              setFormData((current) => ({ ...current, role: option.value }))
                            }
                            className="mt-1 h-4 w-4 flex-shrink-0 accent-green-600 dark:accent-green-400"
                          />
                          <span className="min-w-0">
                            <Eyebrow as="span" accent={selected} className="flex items-center gap-1.5">
                              {option.icon}
                              {option.eyebrow}
                            </Eyebrow>
                            <span className="mt-1.5 block text-sm font-semibold text-gray-900 dark:text-white">
                              {option.title}
                            </span>
                            <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                              {option.description}
                            </span>
                          </span>
                        </Card>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={busy}
                aria-busy={loading}
                className={`${buttonPrimary} w-full py-3`}
              >
                {loading ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Creating account…
                  </>
                ) : (
                  <>
                    Create account
                    <Icon.arrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            {/* Hairline rule with the label sitting on it. The label paints the
                page canvas so the rule reads as passing behind it. */}
            <div className="relative my-7">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <span className="w-full border-t border-gray-200 dark:border-gray-700" />
              </div>
              <div className="relative flex justify-center">
                <Eyebrow as="span" className="bg-[var(--canvas)] px-3">
                  Or continue with
                </Eyebrow>
              </div>
            </div>

            {/* This button had no handler at all and silently did nothing.
                `type="button"` also stops it submitting the form above. */}
            <button
              type="button"
              onClick={handleGoogle}
              disabled={busy}
              aria-busy={googleLoading}
              className="btn-outline btn-touch w-full py-3"
            >
              {googleLoading ? <Spinner className="h-4 w-4" /> : <GoogleIcon />}
              <span>{googleLoading ? "Redirecting to Google…" : "Google"}</span>
            </button>
            <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
              Google sign-up creates a job seeker account.
            </p>

            <p className="mt-8 border-t border-gray-200 pt-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Already have an account?{" "}
              <Link
                href="/auth/login"
                className="rounded font-semibold text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Context panel. Hidden outright below `lg` rather than stacked, so a phone
          gets the form and nothing competing with it. */}
      <aside className="band-dark relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:px-12 xl:px-16">
        {/* `.grid-field`'s rule colour is tuned for light surfaces and disappears
            on the dark band, so the band draws its own graph paper. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
          }}
        />

        <div className="relative max-w-md">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-gray-900">
              <Icon.graph className="h-5 w-5" />
            </span>
            <span className="mono text-sm font-bold uppercase tracking-[0.14em] text-white">
              NextHire
            </span>
          </div>

          <Eyebrow accent className="mt-10">
            How it works
          </Eyebrow>
          <h2 className="mt-3 text-3xl font-bold leading-tight text-white xl:text-4xl">
            One profile. Every role, scored.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-gray-400">
            Tell us what you do — or what you are hiring for — and NextHire keeps the match running
            in the background, ranking both sides against each other as new postings arrive.
          </p>

          <div className="mt-10 space-y-7">
            <NumberedItem index={1} title="Describe the work">
              A profile or a posting, in your own words. No taxonomy to learn, no keyword games.
            </NumberedItem>
            <NumberedItem index={2} title="Read the signal">
              Every pairing gets a fit score with the reasoning attached, so a shortlist is
              defensible rather than a hunch.
            </NumberedItem>
            <NumberedItem index={3} title="Move it forward">
              Applications, statuses and messages live on the same record from first contact to
              offer.
            </NumberedItem>
          </div>

          <p className="mt-12 border-t border-white/10 pt-6 text-sm text-gray-400">
            Already have an account?{" "}
            <Link
              href="/auth/login"
              className="rounded font-semibold text-green-400 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            >
              Sign in
            </Link>
          </p>
        </div>
      </aside>
    </main>
  );
}

function EyeIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M44.5 20H24v8.5h11.7C34.7 33.1 30.1 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.5 6.5 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.3-4z"
      />
      <path
        fill="#34A853"
        d="M6.3 14.7l7 5.1C15.5 16.1 19.4 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.5 6.5 29.6 4 24 4c-7.7 0-14.2 4.4-17.7 10.7z"
      />
      <path
        fill="#FBBC05"
        d="M24 44c5.6 0 10.5-1.9 14.3-5.1l-6.6-5.4C29.7 35.1 27 36 24 36c-6.1 0-10.7-2.9-13.7-7.1l-7 5.4C9.8 41.6 16.4 44 24 44z"
      />
      <path
        fill="#EA4335"
        d="M44.5 20H24v8.5h11.7c-1.6 4.1-6.1 7.5-11.7 7.5-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.5 6.5 29.6 4 24 4c-7.7 0-14.2 4.4-17.7 10.7z"
      />
    </svg>
  );
}
