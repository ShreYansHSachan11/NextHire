# NextHire — Project Audit & Remediation Plan

Full sweep of the portal: API layer, auth, data model, page logic, UI/UX and configuration.
Findings are grouped by type and severity. Everything marked **[FIX]** is addressed in this pass;
items marked **[NEW]** are features that were missing and are being added.

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low / polish

---

## 1. Security & authorization

The API layer is almost entirely unauthenticated. Any anonymous caller can read and mutate
every record in the database.

| # | Severity | Where | Issue |
|---|---|---|---|
| 1.1 | 🔴 | `app/api/users/route.ts` | `PUT`/`DELETE`/`POST` have **no auth at all**. Anyone can update or delete any user by id, or create a user with `role: "ADMIN"` and an unhashed password. **[FIX]** |
| 1.2 | 🔴 | `app/api/jobs/route.ts` | `POST`/`PUT`/`DELETE` unauthenticated. Anyone can post jobs under any `companyId`, edit or delete any company's job. `PUT` spreads the whole body into `data`, so `companyId`/`createdAt` can be overwritten. **[FIX]** |
| 1.3 | 🔴 | `app/api/jobs/[jobId]/route.ts` | `PUT`/`DELETE` unauthenticated and unscoped — any job can be edited/deleted by anyone. **[FIX]** |
| 1.4 | 🔴 | `app/api/applications/route.ts` | `GET` with no `companyId` dumps **every application in the system** (names, emails, resumes). `POST` trusts a client-supplied `userId` — you can apply on behalf of another user. `DELETE` unauthenticated. **[FIX]** |
| 1.5 | 🔴 | `app/api/messages/route.ts` | `GET` with no `conversationId` returns **every message in the system**; with one, it returns any conversation's messages without membership check. `POST` trusts client `senderId` → impersonation. `PUT`/`DELETE` unauthenticated. **[FIX]** |
| 1.6 | 🔴 | `app/api/conversations/route.ts` | No auth; `GET?userId=`/`?companyId=` lets anyone enumerate another party's conversations. `POST` can create a conversation between arbitrary user/company. **[FIX]** |
| 1.7 | 🔴 | `app/api/notifications/route.ts` | No auth. Anyone can read another user's notifications, mark them read, or spam-create notifications. **[FIX]** |
| 1.8 | 🔴 | `app/api/resumes/route.ts` | `GET` returns **all resumes of all users**. `POST`/`PUT`/`DELETE` unauthenticated — you can overwrite or delete anyone's resume. No file type/size validation on upload. **[FIX]** |
| 1.9 | 🟠 | `app/api/companies/route.ts` | `POST`/`PUT`/`DELETE` unauthenticated — anyone can rename or delete any company. **[FIX]** |
| 1.10 | 🟠 | `app/api/debug/token/route.ts`, `app/api/test-db/route.ts` | Debug endpoints shipped to production; `test-db` leaks env presence and raw DB error strings. **[FIX — removed]** |
| 1.11 | 🟠 | `app/api/auth/route.ts` | `GET /api/auth` echoes the decoded JWT. Registration accepts an arbitrary `role`, so anyone can self-register as `ADMIN`. No password-strength or email-format validation server-side. **[FIX]** |
| 1.12 | 🟠 | `app/api/auth/google-callback/route.ts` | Puts the **signed JWT in the redirect URL query string** (`?googleAuth=...`) — it lands in browser history, referrers and server logs. The cookie is already set, so the param is redundant. **[FIX]** |
| 1.13 | 🟠 | `env-template.txt` | Contains what look like **real Cloudinary credentials** and a real DB password, committed to the repo. **[FIX — replaced with placeholders; rotate the keys.]** |
| 1.14 | 🟡 | login/register/dashboards | Auth cookie is written from JS with `httpOnly: false`, no `secure`, no `sameSite`. Readable by any XSS. Kept readable (Redux rehydration depends on it) but now set with `SameSite=Lax` + `Secure` in production, and centralised in one helper. **[FIX]** |
| 1.15 | 🟡 | app-wide | No route middleware — protected pages are guarded only by client-side redirects that flash content first. **[NEW — `middleware.ts`]** |
| 1.16 | 🔵 | `socket-server.js` | `cors.origin: "*"`, and `/emit-message` accepts an unauthenticated POST from anywhere, so anyone can inject fake messages into any conversation room. **[FIX — shared-secret + origin allowlist]** |

---

## 2. Logical / data bugs

| # | Severity | Where | Issue |
|---|---|---|---|
| 2.1 | 🔴 | `app/seeker/dashboard/page.tsx` | Fetches `/api/applications` **with no user filter**, so the seeker's dashboard lists *every application by every user*, and the "Total / Pending / Interviews / Accepted" stat cards count strangers' applications. **[FIX]** |
| 2.2 | 🔴 | `app/seeker/dashboard/page.tsx` | Fetches `/api/resumes` (all resumes) and filters client-side — other users' resume URLs are exposed to the browser. **[FIX]** |
| 2.3 | 🔴 | `app/jobs/post/page.tsx` | `useEffect` is declared **after** a conditional `return null`. This violates the rules of hooks: when auth state flips, React throws *"Rendered fewer hooks than expected"* and the page crashes. **[FIX]** |
| 2.4 | 🔴 | `post`, `edit-job`, `applications`, both `conversations` pages | No hydration guard. On first paint Redux is empty (rehydration happens in an effect), so a **logged-in user is bounced to `/auth/login`** every time they land on these pages directly or refresh. **[FIX]** |
| 2.5 | 🟠 | `app/seeker/dashboard/page.tsx` | "Message" resolves the employer by **company *name* substring search** and takes `companies[0]`. Two companies with similar names → messages the wrong company. The job already carries `companyId`. **[FIX]** |
| 2.6 | 🟠 | `app/jobs/post/page.tsx` | The "Create Company" fallback POSTs to `/api/companies`, which ignores `userId`. It creates an **orphan company** and never links it to the user, so the user still can't post. Also the button sits inside `<form>` without `type="button"`, so it *submits the form* instead. **[FIX]** |
| 2.7 | 🟠 | `app/company/profile/edit/page.tsx` | Editing the company profile updates `User.name` only — `Company.name` is never touched, so job cards keep showing the old employer name forever. **[FIX — kept in sync]** |
| 2.8 | 🟠 | profile edit pages + `AuthRehydrator` | After a profile update the JWT cookie still holds the old `name`/`companyName`. `AuthRehydrator` re-reads the cookie on the next load and **overwrites the fresh Redux state with stale values** — the edit looks like it was silently reverted. **[FIX — token re-issued on profile update]** |
| 2.9 | 🟠 | both conversation pages | Sender appends the message locally *and* receives its own socket broadcast → **every sent message appears twice**. Masked (not fixed) by `key={id-index}`. **[FIX — dedupe by message id]** |
| 2.10 | 🟠 | `app/jobs/[jobId]/page.tsx` | No "already applied" check. The Apply button is always enabled; clicking it on a job you already applied to just throws a 409 error banner. **[FIX]** |
| 2.11 | 🟠 | `app/jobs/[jobId]/page.tsx` | An **inactive/closed job still shows an enabled Apply button**; the failure only surfaces after the round-trip. **[FIX]** |
| 2.12 | 🟠 | `app/jobs/[jobId]/edit/page.tsx` | Deleting a job that has applications fails on a foreign-key constraint and surfaces as a generic 500. **[FIX — applications cascade-deleted inside a transaction, with a confirm that states the consequence]** |
| 2.13 | 🟠 | `app/api/auth/[...nextauth]/route.ts` | `redirect()` ignores its arguments and always sends users to `/api/auth/google-callback`, breaking sign-out and any `callbackUrl`. Google sign-ins are also hard-coded to `SEEKER` with an empty password, so such an account can also log in via the password form if a blank-ish password ever hashes through. **[FIX]** |
| 2.14 | 🟡 | `app/api/messages/route.ts` | Socket emit is hard-coded to `http://localhost:3002` → **real-time chat silently dies in production**. Also `POST` spreads raw `data` into `prisma.message.create`. **[FIX]** |
| 2.15 | 🟡 | `app/api/applications/route.ts` | Status changes generate **no notification** for the seeker, and new applications generate none for the company. The bell is therefore near-useless. **[NEW]** |
| 2.16 | 🟡 | `app/components/NotificationBell.tsx` | Renders only for `SEEKER`; companies get no notifications at all. It also parses the company name **out of the notification text** with a regex to build a link — brittle and breaks on any company name containing `":"`. **[FIX — structured `link` field]** |
| 2.17 | 🟡 | `prisma/schema.prisma` | No `@@unique([userId, jobId])` on `Application` — the duplicate-apply guard is a racy `findFirst`, so double-clicking Apply can create two applications. Same for `Conversation(userId, companyId)`. No indexes on the FK columns used by every list query. **[FIX — migration added]** |
| 2.18 | 🟡 | `prisma/schema.prisma` | `Job.jobId` is an unused nullable unique column; `User.profile` duplicates `Company.profile`. Left in place (data-preserving) but documented. |
| 2.19 | 🟡 | `app/jobs/page.tsx` | Filter dropdowns are hard-coded to `Bangalore / Mumbai / Remote` and `Full Time / Remote / Internship`, which don't match the values the post-job form actually writes (`Part Time`, `Contract`, any free-text location). Most filters therefore match nothing. Matching is also case-sensitive `includes`. **[FIX — options derived from live data, case-insensitive]** |
| 2.20 | 🟡 | `app/jobs/page.tsx` | Every card shows an "Active/Inactive" badge, but the public feed only ever returns active jobs — the badge is always green and meaningless. **[FIX — replaced with a "new" indicator]** |
| 2.21 | 🔵 | `app/api/companies/route.ts` | `mode: 'insensitive'` is passed inside an untyped `whereClause` object; it works but is unchecked by TS. Cleaned up. |
| 2.22 | 🔵 | `app/api/resumes/route.ts` | `export const config = { api: { bodyParser: false } }` is a **Pages-Router** directive and does nothing in the App Router. Cloudinary `destroy` derives the public id from the URL filename, which breaks for any nested/versioned path. **[FIX]** |
| 2.23 | 🔵 | `lib/prisma.ts` | `log: ['query']` in production floods logs with every SQL statement. `validateEnv()` runs at import time and throws during build. **[FIX]** |

---

## 3. UI / UX issues

| # | Severity | Where | Issue |
|---|---|---|---|
| 3.1 | 🔴 | `app/jobs/post/page.tsx` | **Developer debug panels are shipped to end users**: a yellow "Test Job Creation / Test API" box, a purple "List All Companies" box, a grey "User Information" dump (email, role, raw company id) and a blue "Debug Info" strip. **[FIX — all removed]** |
| 3.2 | 🟠 | Tailwind v4 vs `tailwind.config.js` | The project uses Tailwind **v4** (`@import "tailwindcss"`), which **ignores `tailwind.config.js` unless explicitly loaded**. So `darkMode: 'class'` never applied and the hundreds of `dark:` classes fire off the **OS setting** instead — while `globals.css` hard-codes a white `body`. Result: on a dark-mode OS the app renders dark cards on a light page with unreadable seams. **[FIX — config wired in, class-based dark mode, explicit theme toggle]** |
| 3.3 | 🟠 | `page.tsx`, `jobs/post`, `jobs/[id]/edit`, `applications`, `seeker/profile/edit` | These pages have **no dark styling at all**, so half the app flips to dark and half stays white. **[FIX]** |
| 3.4 | 🟠 | app-wide | **No shared navigation.** Every page hand-rolls its own header; the jobs feed has no logout, the company side has no notification bell, and the "Profile" link goes to a dashboard. **[NEW — shared `Navbar` component]** |
| 3.5 | 🟠 | `app/page.tsx` | The hero **"Post a Job"** button links to `/auth/register` even for a signed-in company. Its two hero buttons are `text-3xl` with `py-8` — enormous next to everything else. **[FIX — role-aware target, sane sizing]** |
| 3.6 | 🟠 | `app/page.tsx` | The whole footer is **dead links** (`href="#"` ×11), and the stats ("10,000+ Active Jobs", "95% Success Rate") plus all three testimonials are **fabricated**. **[FIX — real links; stats now driven by live counts; testimonials labelled as illustrative]** |
| 3.7 | 🟠 | `app/auth/register/page.tsx` | The **Google button does nothing** — no `onClick`. Login has one; register doesn't. **[FIX]** |
| 3.8 | 🟠 | app-wide | `alert()` used for user-facing errors in 6 places; failures elsewhere are only `console.error` so the user sees nothing happen. **[FIX — inline toasts]** |
| 3.9 | 🟠 | `app/company/dashboard/page.tsx` | Job rows render the location/clock icons **even when `location`/`type` are null**, leaving orphan icons with blank text. **[FIX]** |
| 3.10 | 🟠 | `app/company/dashboard/page.tsx` | No way to **activate/deactivate or delete a job** from the dashboard — you must open the edit page. No applicant resume link either, though the data is fetched. **[NEW]** |
| 3.11 | 🟡 | both conversation pages | `onKeyPress` is deprecated and doesn't fire for all inputs; no Shift+Enter newline; no empty-state CTA; message list doesn't group by day. **[FIX]** |
| 3.12 | 🟡 | `app/applications/page.tsx` | Not responsive — `flex items-start justify-between` with a fixed `ml-6` sidebar overflows on mobile. Download button hard-codes a `.pdf` extension regardless of the real file type. **[FIX]** |
| 3.13 | 🟡 | `app/auth/login/page.tsx` | The "Don't have an account?" link has no top margin and sits flush against the Google button. No "show password" toggle. **[FIX]** |
| 3.14 | 🟡 | `app/auth/register/page.tsx` | No password confirmation field, no strength hint beyond a static line, and the "I am a" select doesn't explain that choosing *Company* creates a company workspace. **[FIX]** |
| 3.15 | 🟡 | `seeker/dashboard` | The "My Resume" quick-action is an `<a href="#my-resume">` styled as a card — it looks identical to the two `Link` cards next to it but only scrolls. Resume upload has no file-type/size validation, so a 40 MB `.zip` gets sent to Cloudinary before failing. **[FIX]** |
| 3.16 | 🟡 | `seeker/dashboard`, `company/dashboard` | `router.push()` is called **during render** when unauthenticated — React logs *"Cannot update a component while rendering a different component"*. **[FIX — moved into an effect]** |
| 3.17 | 🟡 | `globals.css` | A global `* { transition-property: background-color, border-color, color, fill, stroke }` animates **every element on the page**, including during theme switch and on first paint. **[FIX — scoped]** |
| 3.18 | 🟡 | `app/layout.tsx` | No `viewport` export, no `lang`-aware metadata, no theme-color, no favicon/OG tags beyond the default. Body font is `Inter` via `next/font` but `globals.css` overrides it with `Arial, Helvetica, sans-serif`. **[FIX]** |
| 3.19 | 🔵 | multiple | `console.log` debug noise in production paths — 60+ statements including `AuthRehydrator` logging the decoded JWT and `/api/auth` logging user records. **[FIX]** |
| 3.20 | 🔵 | `page.tsx`, dashboards | The briefcase SVG path is malformed (`a2 2 0 00-2-2v2` opens a stray sub-path), rendering a slightly broken icon in ~8 places. **[FIX]** |
| 3.21 | 🔵 | app-wide | No `loading.tsx` / `error.tsx` / `not-found.tsx`; a thrown error shows the raw Next.js overlay in dev and a blank page in prod. **[NEW]** |
| 3.22 | 🔵 | `test-socket.html` | A stray manual test harness sitting in the project root. **[FIX — removed]** |

---

## 4. Accessibility

| # | Severity | Issue |
|---|---|---|
| 4.1 | 🟠 | Notification dropdown, mobile menu and chat lists are `<div onClick>` — not focusable, not keyboard-operable, no `role`/`aria-expanded`. **[FIX]** |
| 4.2 | 🟠 | `seeker/profile/edit` inputs have **placeholders but no `<label>`**. Several selects and the resume file input are unlabelled. **[FIX]** |
| 4.3 | 🟡 | Status "badges" convey state by colour only; icons carry no `aria-label`. Decorative SVGs lack `aria-hidden`. **[FIX]** |
| 4.4 | 🟡 | No skip-link, no focus-visible styling, notification dropdown doesn't trap or restore focus and doesn't close on `Escape`. **[FIX]** |
| 4.5 | 🔵 | `animate-pulse` on the unread badge runs indefinitely — ignores `prefers-reduced-motion`. **[FIX]** |

---

## 5. Configuration & build

| # | Severity | Issue |
|---|---|---|
| 5.1 | 🟠 | `next.config.ts` uses `images.domains`, deprecated in Next 15 → `remotePatterns`. `env: { CUSTOM_KEY }` is dead config. **[FIX]** |
| 5.2 | 🟠 | `package.json` has no `typecheck` script and `lint` points at `next lint`, which is removed in Next 15. There is no ESLint config in the repo at all. **[FIX]** |
| 5.3 | 🟡 | `lib/socketContext.tsx` falls back to the placeholder `https://your-socket-server.vercel.app` in production and hard-codes `localhost:3002` in dev; `forceNew: true` plus a manual retry loop fights Socket.IO's own reconnection and can open duplicate sockets. **[FIX]** |
| 5.4 | 🟡 | `store/Provider.tsx` types `children` as `any`. `lib/socketContext.tsx` types `sendMessage(data: any)`. **[FIX]** |
| 5.5 | 🔵 | Two Prisma migrations both named `init`; the second is the real schema. Left as-is (history), new migration appended. |
| 5.6 | 🔵 | `deploy.sh` / `DEPLOYMENT.md` / `README.md` reference the removed debug routes and the old env template. **[FIX]** |

---

## 6. New features added in this pass

1. **`lib/auth.ts`** — one place to issue, verify and read the session token (cookie *or* `Authorization` header), plus `requireAuth` / `requireRole` / `requireSelfOrAdmin` helpers used by every route.
2. **`middleware.ts`** — edge guard for `/seeker/*`, `/company/*`, `/applications`, `/conversations`, `/jobs/post`, `/jobs/*/edit`, so protected pages never flash before redirecting.
3. **Shared `Navbar`** with role-aware links, notification bell for **both** roles, theme toggle and logout — replaces five hand-rolled headers.
4. **Working dark mode** — class-based, persisted, with an SSR-safe no-flash script, and dark styles filled in on the pages that lacked them.
5. **Notifications that actually fire** — company is notified on every new application; seeker is notified on every status change; both on new messages. Notifications carry a structured `link` and a `read`/`unread` filter, with "mark all read".
6. **Application lifecycle in the UI** — "Already applied" state on the job page, closed-job handling, applicant resume links, activate/deactivate + delete straight from the company dashboard.
7. **`loading.tsx` / `error.tsx` / `not-found.tsx`** and a reusable `Toast` so failures are visible instead of `console.error`.
8. **Live homepage stats** from `/api/stats` instead of invented numbers.

---

## 7. Action required by you (cannot be fixed in code)

- **Rotate the Cloudinary API key/secret and the Postgres password** that were committed in `env-template.txt`.
- Set `SOCKET_EMIT_SECRET` and `NEXT_PUBLIC_SOCKET_URL` in your environment; the socket server now rejects unauthenticated emits.
- Run `npx prisma migrate dev` to apply the new unique constraints and indexes. If your data already contains duplicate `(userId, jobId)` applications, de-duplicate before migrating.

---

## 8. Addendum — visual identity and AI (second phase)

After the remediation above, two further pieces of work landed.

### 8.1 "Signal" design system

The app previously had no shared visual language: five hand-rolled page headers,
inconsistent spacing, a Tailwind palette that fought the dark mode, and (per 3.2)
a `dark:` variant that never actually worked. That was replaced with one system:

| Piece | Where |
| --- | --- |
| Tokens, palette override, component classes | `app/globals.css` |
| Component kit (icons, cards, meters, badges, layout) | `app/components/ui.tsx` |
| Shared navigation | `app/components/Navbar.tsx` |
| Theme provider, toggle, no-flash script | `app/components/ThemeProvider.tsx` |

Principles, so future work stays coherent:

1. **Tight display type on an off-white canvas.** Headings near-black, body muted.
2. **Monospace carries machine output.** Counts, percentages, IDs, timestamps and
   status codes are set in JetBrains Mono; prose stays in Inter. This is what
   makes the product read as an instrument rather than a brochure.
3. **Hairlines, not shadows.** One-pixel borders and `divide-y` rules do the
   structural work.
4. **One accent, spent carefully.** Emerald means match quality, live state or
   confirmation — nothing else. Indigo is links and focus. Everything else is
   neutral slate. The only gradient in the product is the navbar's signal rail.
5. **Graph-paper texture marks telemetry.** `.grid-field` appears behind panels
   that show derived or live data, and nowhere else.

Two implementation notes worth keeping in mind:

- The neutral, primary and accent ramps are **overridden in `@theme`**, so every
  existing `bg-gray-50` / `border-gray-200` in the app moved onto the new palette
  without editing each call site.
- The component classes are wrapped in `@layer components`. Unlayered CSS beats
  every Tailwind utility, so `.btn-ink`'s padding would otherwise have been
  un-overridable by `px-8` at a call site.

### 8.2 Gemini-powered matching

The redesign promises AI matching, so the promise was made real rather than
decorative. Full design in [`AI.md`](./AI.md); the short version:

- `lib/ai/*` — Gemini wrapper, document builders, vector maths, embedding sync
  and the matching layer.
- `JobEmbedding` / `ProfileEmbedding` tables, plus AI-derived profile columns on
  `User` and a captured `matchScore` on `Application`
  (migration `20260910130000_ai_embeddings`, purely additive).
- Semantic search, per-role match scores with an explainable facet breakdown,
  seeker recommendations, applicant ranking by fit, résumé → profile extraction,
  and drafting help for job descriptions.

The governing constraint: **every AI feature is optional and fails soft.** With
`GEMINI_API_KEY` unset the portal behaves exactly as it did before — match scores
are `null`, search falls back to keyword filtering, and nothing errors. Embedding
writes are fire-and-forget, so a model outage can never block posting a job,
applying, messaging or uploading a résumé.
