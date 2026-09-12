# NextHire

A full-stack job portal built with Next.js 15 (App Router), Prisma, PostgreSQL, Tailwind CSS v4 and Socket.IO.

Job seekers browse and apply to roles, upload a résumé, track application status and message employers.
Companies post jobs, review applicants, move them through a hiring pipeline and reply in-app.

## Features

- Email/password and Google authentication, with JWT sessions
- Job posting, editing, opening/closing and deletion
- Applications with status pipeline (Pending → Shortlisted → Interview → Accepted/Rejected)
- Résumé upload to Cloudinary, visible to the companies you applied to
- Real-time messaging between companies and applicants
- In-app notifications for new applications, status changes and messages
- Light/dark theme, responsive from 360px up

**Powered by Gemini** — all optional, see [`AI.md`](./AI.md):

- Semantic matching between a candidate's profile and every open role, with an
  explainable facet breakdown rather than one opaque percentage
- Semantic search: "someone who has scaled a real-time backend" finds the right
  roles even when none of those words appear in the posting
- Résumé → structured profile extraction (headline, seniority, skills, summary)
- Applicant ranking by fit, for the hiring side
- Drafting help for job descriptions

## Prerequisites

- Node.js 18.18+
- PostgreSQL
- A Cloudinary account (résumé uploads)
- A Google OAuth client (optional — Google sign-in is skipped if unset)
- A Gemini API key (optional — every AI feature is skipped if unset)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure the environment**

   ```bash
   cp env-template.txt .env
   ```

   Fill in every value. At minimum you need `DATABASE_URL`, `JWT_SECRET` and the three
   `CLOUDINARY_*` variables. Generate secrets with `openssl rand -base64 48`.

   `GEMINI_API_KEY` is optional. Without it the portal runs exactly as it does
   today — match scores simply do not appear and search falls back to keyword
   filtering. With it, run a one-off backfill after your first migration:
   `POST /api/ai/reindex` as an ADMIN user.

3. **Set up the database**

   ```bash
   npm run db:generate
   npm run db:migrate
   ```

   Two migrations run here. `20260910120000_harden_schema` adds unique constraints
   on `(userId, jobId)` for applications and `(userId, companyId)` for conversations;
   it de-duplicates existing rows first, keeping the earliest of each pair, so
   **take a backup before running it against real data.** `20260910130000_ai_embeddings`
   then adds the vector tables and the AI-derived profile columns — that one is
   purely additive.

4. **Run it**

   ```bash
   npm run dev:both     # Next.js + the Socket.IO server
   # or separately:
   npm run dev
   npm run dev:socket
   ```

   Open <http://localhost:3000>.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run dev:socket` | Standalone Socket.IO server |
| `npm run dev:both` | Both of the above |
| `npm run build` | `prisma generate` then `next build` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm run db:migrate` | Apply migrations in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:studio` | Prisma Studio |

## Project structure

```
app/
├── api/                 # Route handlers — every one authorises via lib/auth.ts
├── auth/                # Sign in / register
├── company/             # Company dashboard and profile
├── seeker/              # Seeker dashboard, profile and messages
├── jobs/                # Public feed, job detail, post and edit
├── applications/        # Company applicant review
├── conversations/       # Company messaging
├── components/          # Navbar, NotificationBell, Toast, ThemeProvider, ui kit
└── hooks/               # useAuthGuard
lib/                     # auth, clientAuth, validation, prisma, env, socketContext
├── ai/                  # Gemini: embeddings, matching, semantic search
middleware.ts            # Edge routing guard for protected pages
prisma/                  # Schema and migrations
store/                   # Redux store and slices
```

## API

All routes return JSON. Errors are `{ "error": "<human-readable message>" }`.
Authentication is a JWT sent either as the `token` cookie or an
`Authorization: Bearer <token>` header; **every mutating route authorises the
caller server-side** — ownership is never taken from the request body.

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/api/auth` | Public — `action: register \| login \| logout` |
| `GET` | `/api/auth` | Authenticated — returns the current session |
| `GET` | `/api/jobs` | Public feed of active jobs |
| `GET` | `/api/jobs?companyId=` | Owning company — includes applicants |
| `POST` | `/api/jobs` | Company — `companyId` comes from the session |
| `GET` | `/api/jobs/:id` | Public — adds `hasApplied` / `isOwner` when signed in |
| `PUT` `PATCH` `DELETE` | `/api/jobs/:id` | Owning company |
| `GET` | `/api/applications` | Seeker: own only · Company: own jobs only |
| `POST` | `/api/applications` | Seeker — `userId` from the session |
| `PATCH` | `/api/applications` | Owning company — notifies the applicant |
| `DELETE` | `/api/applications` | Applicant (withdraw) or owning company |
| `GET` `POST` | `/api/conversations` | Participants only; requires an existing application |
| `GET` `POST` | `/api/messages` | Conversation participants only |
| `GET` `PATCH` `DELETE` | `/api/notifications` | Own notifications only |
| `GET` `POST` `DELETE` | `/api/resumes` | Own résumé; readable by companies you applied to |
| `GET` | `/api/users/:id` | Full record for self; minimal public shape otherwise |
| `PUT` `DELETE` | `/api/users/:id` | Self or admin — `PUT` re-issues the JWT |
| `GET` | `/api/stats` | Public — counts for the homepage |
| `GET` | `/api/jobs/recommended` | Seeker — roles ranked against their profile |
| `POST` | `/api/ai/resume` | Seeker — parse their résumé into a profile |
| `POST` | `/api/ai/assist` | Company — draft a description, extract skills |
| `GET` `POST` | `/api/ai/reindex` | Admin — index health, backfill embeddings |

## Security notes

- Passwords are hashed with bcrypt (cost 12) and must be 8+ characters with a letter and a digit.
- The `ADMIN` role cannot be self-assigned at registration; grant it directly in the database.
- The auth cookie is deliberately readable by JS (the Redux store rehydrates from it) and is set
  `SameSite=Lax`, `Secure` in production. Treat XSS as session-compromising and keep the CSP tight.
- `middleware.ts` is a routing convenience only — it decodes the JWT without verifying the
  signature, because `jsonwebtoken` cannot run on the edge runtime. Real authorisation is in the
  API routes.
- The Socket.IO server requires `SOCKET_EMIT_SECRET` and `SOCKET_ALLOWED_ORIGINS` in production
  and refuses to start without them, so nobody can forge chat messages into a room.

## AI safety

- Model output is treated as untrusted input: everything generated is sanitised
  and length-capped before it is stored.
- Embedding vectors are never serialised to a client.
- Résumé parsing is grounded — the model is instructed to extract only what the
  document evidences, and every extracted field stays editable by the user.
- No AI feature is load-bearing. Posting, applying, messaging and uploading all
  succeed whether or not the model is reachable.

See [`AI.md`](./AI.md) for the full design.

---

See [`AUDIT.md`](./AUDIT.md) for the record of issues found and fixed in the
hardening pass, and [`DEPLOYMENT.md`](./DEPLOYMENT.md) for hosting instructions.
