"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { signIn } from "next-auth/react";
import { login } from "@/store/authSlice";
import type { AppDispatch, RootState } from "@/store/store";
import { apiFetch, setToken } from "@/lib/clientAuth";
import { isValidEmail } from "@/lib/validation";
import { ShowcaseBento } from "@/app/components/Showcase";
import { ThemeToggle } from "@/app/components/ThemeProvider";
import {
  Alert,
  BackLink,
  Button,
  Eyebrow,
  Icon,
  Label,
    Spinner,
  inputClass,
} from "@/app/components/ui";

const SHOWCASE_STEPS = [
  { title: "See your fit", body: "Jobs are ranked against your profile, with the reasons shown." },
  { title: "Track every application", body: "Follow each one from submitted to offer." },
  { title: "Talk to the hiring team", body: "Messages stay with your application." },
] as const;

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

/**
 * The Google callback can only hand us an error *code* in the query string — it
 * deliberately no longer passes the signed token back, because that landed in
 * browser history and referrer headers.
 */
const OAUTH_ERRORS: Record<string, string> = {
  google_failed:
    "We could not complete Google sign-in. Please try again, or sign in with your email and password.",
  user_not_found:
    "No NextHire account uses that Google address yet. Create an account first, then sign in with Google.",
};

function dashboardFor(role: string): string {
  return role === "COMPANY" ? "/company/dashboard" : "/seeker/dashboard";
}

/**
 * `?next=` comes from the URL, so it is attacker-controllable. Only same-origin
 * relative paths are honoured: `//evil.com` and `/\evil.com` are protocol-relative
 * URLs rather than paths, and would turn this form into an open redirect.
 */
function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

function LoginForm() {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  /**
   * Whether the banner is about the credentials in the boxes, as opposed to a
   * Google redirect that failed. Only the former should mark the two inputs
   * invalid — an OAuth error flagged both fields before the user had typed
   * anything, so a screen reader announced "invalid entry" on an empty box.
   */
  const [credentialsRejected, setCredentialsRejected] = useState(false);
  /** Per-field problems caught before the request, keyed by input name. */
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);
  /** Separate from `loading`: the two sign-in routes must not disable each other's spinner. */
  const [googleLoading, setGoogleLoading] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useDispatch<AppDispatch>();
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  const next = useMemo(() => safeNext(searchParams.get("next")), [searchParams]);

  // Redux rehydrates from the cookie inside an effect, so "already signed in"
  // is only knowable after mount.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !user) return;
    router.replace(next ?? dashboardFor(user.role));
  }, [hydrated, isAuthenticated, user, next, router]);

  // Surface OAuth failures redirected back from the Google callback.
  useEffect(() => {
    const code = searchParams.get("error");
    if (!code) return;
    setCredentialsRejected(false);
    setError(OAUTH_ERRORS[code] ?? "Sign-in failed. Please try again.");
  }, [searchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((current) => ({ ...current, [name]: value }));
    // Clear a field's own complaint as soon as it is being addressed; the
    // banner-level error stays until the next submit answers it.
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCredentialsRejected(false);

    // Catch the two things we can be certain about without a round trip. The
    // server remains the authority on whether the pair is actually valid.
    const email = formData.email.trim();
    const fieldIssues: { email?: string; password?: string } = {};
    if (!email) fieldIssues.email = "Enter the email address you signed up with";
    else if (!isValidEmail(email)) fieldIssues.email = "Enter a valid email address";
    if (!formData.password) fieldIssues.password = "Enter your password";

    if (fieldIssues.email || fieldIssues.password) {
      setFieldErrors(fieldIssues);
      // Focus rather than only paint: a keyboard or screen-reader user should
      // land on the field that needs them, not hunt for the red text.
      (fieldIssues.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      const data = await apiFetch<AuthResponse>("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          action: "login",
          email: formData.email.trim(),
          password: formData.password,
        }),
      });

      // The server sets the cookie as well; writing it here too keeps the
      // SameSite/Secure flags identical whichever path produced it.
      setToken(data.token);
      dispatch(login({ user: data.user, token: data.token }));

      router.push(next ?? dashboardFor(data.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t sign you in");
      setCredentialsRejected(true);
      // Only stop the spinner on failure: on success we are navigating away and
      // re-enabling the form would let a double-click fire a second login.
      setLoading(false);
    }
  };

  const errorId = error ? "login-error" : undefined;
  const busy = loading || googleLoading;

  const handleGoogle = () => {
    setError("");
    setCredentialsRejected(false);
    setGoogleLoading(true);
    // `signIn` navigates away; if it ever resolves without doing so, the button
    // would otherwise stay stuck in its loading state.
    void Promise.resolve(signIn("google")).finally(() => setGoogleLoading(false));
  };

  return (
    <main id="main-content" className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Form column. `min-h-screen` here rather than on the grid child keeps the
          single-column phone layout full-height too. */}
      <div className="flex min-h-screen flex-col">
        {/* A sign-in screen gets a deliberately minimal header rather than the app
            navbar — there is nothing to navigate to until you are signed in. */}
        <header className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded"
          >
            <span className="tile tile-ink h-9 w-9">
              <Icon.graph className="h-5 w-5" />
            </span>
            <span className="wordmark text-gray-900 dark:text-white">
              NextHire
            </span>
          </Link>
          <ThemeToggle />
        </header>

        <div className="flex flex-1 items-center justify-center px-4 pb-12 pt-2 sm:px-6 lg:px-10">
          <div className="panel w-full max-w-md p-6 sm:p-8">
            {/* The wordmark above links home too, but a logo does not read as a
                way back. This screen carries no navbar, so someone who arrived
                cold — a shared link, a bounce from a protected page — otherwise
                has only the browser's own button to leave with. */}
            <BackLink href="/" className="mb-5">
              Back to NextHire
            </BackLink>

            <div className="mb-7">
              <Eyebrow className="mb-2">Sign in</Eyebrow>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white sm:text-4xl">
                Welcome back
              </h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Sign in to see your matches, applications and messages.
              </p>
            </div>

            {error && (
              <Alert variant="error" className="mb-6">
                <span id={errorId}>{error}</span>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate aria-busy={loading}>
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
                  aria-invalid={fieldErrors.email || credentialsRejected ? true : undefined}
                  aria-describedby={
                    [fieldErrors.email ? "email-error" : null, errorId].filter(Boolean).join(" ") ||
                    undefined
                  }
                  className={inputClass}
                />
                {fieldErrors.email && (
                  <p id="email-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {fieldErrors.email}
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
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    aria-invalid={fieldErrors.password || credentialsRejected ? true : undefined}
                    aria-describedby={
                      [fieldErrors.password ? "password-error" : null, errorId]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="password-error" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* `Button` rather than a hand-rolled pending state: the spinner it
                  substitutes for `iconEnd` is decorative, where the bare
                  `<Spinner>` this used to render carried its own `role="status"`
                  and announced "Loading" over the top of the button's real
                  label. `disabled={busy}` keeps the two sign-in routes mutually
                  exclusive while only this one claims the spinner. */}
              <Button
                type="submit"
                variant="primary"
                block
                className="py-3"
                loading={loading}
                loadingLabel="Signing in"
                disabled={busy}
                iconEnd={<Icon.arrowRight className="h-4 w-4" />}
              >
                {/* The label says so as well as the spinner. A 16px disc is easy
                    to miss on a button someone has just looked away from, and
                    this is the one wait in the product every user meets. The
                    usual argument against a changing label — the control
                    resizing mid-press — does not apply to a `block` button,
                    which is the full width of the form either way. */}
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            {/* Hairline rule with the label sitting on it. The label paints the
                page canvas so the rule reads as passing behind it. */}
            <div className="my-7 flex items-center gap-3">
              <span className="flex-1 border-t border-gray-200 dark:border-gray-700" aria-hidden="true" />
              <Eyebrow as="span">Or continue with</Eyebrow>
              <span className="flex-1 border-t border-gray-200 dark:border-gray-700" aria-hidden="true" />
            </div>

            {/* Same primitive as the submit above, so both sign-in routes report
                being in flight identically. `secondary` is the `btn-outline
                btn-touch` pair this spelled out by hand. */}
            <Button
              type="button"
              variant="secondary"
              block
              className="py-3"
              onClick={handleGoogle}
              loading={googleLoading}
              loadingLabel="Redirecting to Google"
              disabled={busy}
              icon={<GoogleIcon />}
            >
              Google
            </Button>

            <p className="mt-8 border-t border-gray-200 pt-6 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
              Don&apos;t have an account?{" "}
              <Link
                href="/auth/register"
                className="link font-semibold"
              >
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* Context panel. Hidden outright below `lg` rather than stacked, so a phone
          gets the form and nothing competing with it. */}
      {/*
        No `overflow-hidden`, and the panel is centred with `my-auto` on the
        content rather than `justify-center` here. Those two together used to
        cut the panel off at the top *and* the bottom at once: a flex column
        that centres content taller than itself overflows equally at both ends,
        and clipping it meant the wordmark and the "Create a profile" line were
        simply gone, with no scroll to reach them. Auto margins centre the block
        while there is room to spare and collapse to nothing when there is not,
        so a short window or a page zoomed to 200% grows the panel instead of
        eating its first and last rows (WCAG 2.2 SC 1.4.4).

        The clip was never load-bearing: the graph-paper layer below is
        `absolute inset-0`, which cannot escape the box it is measured from.
      */}
      {/* `.grid-field` rather than a hand-rolled pair of gradients on a
          decorative div: `.band-dark` now scopes `--grid-line` to the light
          rule colour it needs, so the shared class works here and brings its
          mask with it — the graph paper fades out behind the copy instead of
          running underneath it. */}
      <aside className="band-dark aurora sticky top-3 m-3 hidden min-h-[calc(100vh-1.5rem)] self-start rounded-[2rem] lg:flex lg:flex-col lg:px-10 lg:py-12 xl:px-14">
        <div className="my-auto w-full max-w-lg">
          <Eyebrow accent>
            Why NextHire
          </Eyebrow>
          <h2 className="mt-3 text-4xl font-semibold leading-[1.1] text-white xl:text-5xl">
            Start with the best fit.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-gray-400">
            NextHire compares every job with every profile, so job seekers and employers both see the best matches first.
          </p>

          <ShowcaseBento className="mt-8" steps={SHOWCASE_STEPS} />

          <p className="mt-6 text-sm text-gray-300">
            New to NextHire?{" "}
            <Link
              href="/auth/register"
              className="rounded font-semibold text-white underline underline-offset-2"
            >
              Create an account
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

export default function LoginPage() {
  // `useSearchParams` requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        // A blank screen here said nothing to anyone; the same centred spinner
        // the rest of the app uses at least announces itself.
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="h-10 w-10" label="Loading sign-in" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
