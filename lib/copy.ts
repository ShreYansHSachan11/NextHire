/**
 * Shared product copy for the claims that must not drift.
 *
 * Only strings that say something we are *accountable* for live here — the
 * honesty caveats attached to the match score. Ordinary page prose stays at its
 * call site, where it is easier to read in context.
 *
 * The reason these are centralised is the one the codebase already made for
 * `BADGE_BASE` in `ui.tsx`: two copies of a sentence agree until somebody edits
 * one. That matters more than usual here, because these sentences are the
 * product's claim about what an automated score does and does not decide.
 * Employment is an EU AI Act Annex III high-risk use and NYC Local Law 144
 * constrains how an automated employment tool may be described, so "the two
 * caveats happen to agree" is not a good enough guarantee.
 *
 * The seeker and employer wordings differ on purpose — they answer different
 * worries ("am I wasting my time?" versus "can I trust this ordering?") — but
 * both carry the same load-bearing claim: the score sorts, it does not decide.
 *
 * See DESIGN-NOTES.md §4.5.
 */

/**
 * Shown under the seeker's match breakdown on a job page.
 *
 * The second half is the part that cannot be softened: a candidate reading a
 * low number needs to know it did not remove them from anything.
 */
export const MATCH_CAVEAT_SEEKER =
  "Scored by comparing your profile with this posting. It is guidance to help you decide where to spend your time, not a decision — the company reads every application it receives.";

/**
 * Shown above the employer's candidate queue when it is sorted by fit.
 *
 * "Not an assessment" rather than "not a decision": the employer is the one
 * making the decision, so the claim being disclaimed is different — that the
 * number is not a judgement of the person.
 */
export const MATCH_CAVEAT_EMPLOYER =
  "Fit is a sorting aid, not an assessment. It reads the profile against the posting and knows nothing else about the person — read the application before you decide.";
