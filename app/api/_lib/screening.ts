/**
 * One fact about screening questions that two routes both have to know.
 *
 * Not a route: an underscore-prefixed folder is a private folder in the App
 * Router and is never mapped to a URL. It exists because Next 15 rejects any
 * export from a `route.ts` other than the handlers themselves, so a constant
 * shared between `jobs/[jobId]/questions` and `applications` has nowhere else
 * to live inside `app/api`.
 *
 * ---------------------------------------------------------------------------
 * RETIRED QUESTIONS
 * ---------------------------------------------------------------------------
 * `ApplicationAnswer.questionId` cascades on delete, so removing a question
 * destroys every answer anybody ever gave to it — words a candidate wrote,
 * under time pressure, that cannot be recovered and that they cannot be asked
 * to write again.
 *
 * An employer who removes a question is asking for one thing: stop asking it.
 * They are not asking to erase what people already said. So a question that has
 * collected answers is not deleted, it is **retired**: the row stays, its
 * answers stay readable on the applications it belongs to, and it drops out of
 * every list that decides what a posting asks. A question nobody answered is
 * still deleted outright — there is nothing to protect and no reason to keep
 * the clutter.
 *
 * Retirement is encoded as a `position` at or above `RETIRED_POSITION`.
 * `MAX_QUESTIONS` is 10, so live positions are 0-9 and there is no ambiguity —
 * but this is a sentinel in a column that otherwise means sort order, and that
 * is worth being honest about. It is here rather than in the schema because
 * the proper shape is a column of its own (`retiredAt DateTime?` on
 * `JobQuestion`, with the readers filtering on `retiredAt: null`), and adding
 * one is a migration. Anyone making that change should replace this constant
 * and the three `position` clauses that reference it; nothing else depends on
 * the encoding.
 *
 * Every read that decides *what a posting asks* must exclude retired rows:
 *
 *   - `GET  /api/jobs/:jobId/questions`  — the applicant's form and the owner's editor
 *   - `PUT  /api/jobs/:jobId/questions`  — the set being replaced
 *   - `POST /api/applications`           — validation, and which answers are required
 *
 * Reads that decide *what was answered* must not: an answer is shown with the
 * question it answered, retired or not, on both the employer's view and the
 * candidate's own.
 */

/** A question at or above this position is retired: kept for its answers, never asked. */
export const RETIRED_POSITION = 1000;

/** `where` fragment for the questions a posting currently asks. */
export const ASKED_QUESTIONS = { position: { lt: RETIRED_POSITION } } as const;
