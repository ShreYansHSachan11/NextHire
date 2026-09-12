import { NextRequest, NextResponse } from 'next/server';
import { Type } from '@google/genai';
import { requireRole, badRequest } from '@/lib/auth';
import { cleanString, cleanText } from '@/lib/validation';
import { isAiEnabled } from '@/lib/ai/config';
import { generateJson } from '@/lib/ai/gemini';
import { RATE_TIERS, checkRateLimit, rateLimited } from '@/lib/rateLimit';

/**
 * Drafting help for employers.
 *
 * Two deliberately narrow modes rather than one open-ended "write me anything"
 * endpoint: a posting draft, and a skills extraction that the job-create path
 * calls to populate `Job.skills`. Keeping the second one's shape down to
 * `{ skills }` means that caller never has to care what else the model said.
 */

export const maxDuration = 30;

const MODES = ['job-description', 'job-skills'] as const;
type Mode = (typeof MODES)[number];

/** Matches the ceiling the model is asked for, and what `Job.skills` is worth storing. */
const MAX_SKILLS = 12;
const MAX_DESCRIPTION_CHARS = 3000;

const SYSTEM_INSTRUCTION =
  'You write job postings for a hiring portal. Write inclusive, factual, plain ' +
  'copy in the second person. Use only the details the request gives you: never ' +
  'invent salary, equity, benefits, funding, company names, headcount, awards or ' +
  'legal and visa claims. Never ask for age, gender, marital status, nationality, ' +
  'religion, health or any other protected characteristic, and never use coded ' +
  'age or culture-fit language. If a detail is missing, leave it out rather than ' +
  'filling the gap.';

const DESCRIPTION_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestedTitle: { type: Type.STRING },
  },
  required: ['description', 'skills', 'suggestedTitle'],
};

const SKILLS_SCHEMA: Record<string, unknown> = {
  type: Type.OBJECT,
  properties: {
    skills: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ['skills'],
};

interface DescriptionDraft {
  description: string;
  skills: string[];
  suggestedTitle: string;
}

interface SkillsDraft {
  skills: string[];
}

function aiUnavailable() {
  return NextResponse.json(
    { error: 'AI features are not configured on this deployment.' },
    { status: 503 }
  );
}

function aiFailed() {
  return NextResponse.json(
    { error: 'The writing assistant is unavailable right now. Please try again in a moment.' },
    { status: 502 }
  );
}

/** Model output is untrusted input: cap it, trim it, and drop duplicates. */
function cleanSkillTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const entry of value) {
    const tag = cleanString(entry, 40);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_SKILLS) break;
  }

  return tags;
}

/** Only the facts the employer actually supplied reach the prompt. */
function describeContext(fields: {
  title: string;
  description: string | null;
  type: string | null;
  location: string | null;
  experience: string | null;
}): string {
  const lines = [`Job title: ${fields.title}`];
  if (fields.type) lines.push(`Employment type: ${fields.type}`);
  if (fields.location) lines.push(`Location: ${fields.location}`);
  if (fields.experience) lines.push(`Experience level: ${fields.experience}`);
  if (fields.description) lines.push('', 'Notes from the employer:', fields.description);
  return lines.join('\n');
}

/** POST /api/ai/assist - draft a posting, or pull skill tags out of one. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, 'COMPANY');
  if (guard.response) return guard.response;

  if (!isAiEnabled()) return aiUnavailable();

  // After the key check, never before it: with no key this route spends
  // nothing, so metering it would be a budget against a call that cannot
  // happen. A deployment without AI behaves exactly as it did before AI existed.
  //
  // A 429 rather than the 503 `aiUnavailable` returns, and the difference
  // matters to the client: `requestAi` treats 503 as "this deployment has no
  // model" and hides every assistive button for the session, which would turn a
  // momentary rate limit into a feature that vanished. A 429 surfaces as one
  // toast and the button stays.
  const limit = checkRateLimit(req, RATE_TIERS.AI_INTERACTIVE, guard.session);
  if (!limit.ok) return rateLimited(limit);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid request body');
  }

  const mode = body.mode;
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return badRequest(`Choose a valid assist mode: ${MODES.join(' or ')}`);
  }

  const title = cleanString(body.title, 150);
  if (!title) return badRequest('A job title is required');

  const description = cleanText(body.description, 10_000);
  const type = cleanString(body.type, 60);
  const location = cleanString(body.location, 120);
  const experience = cleanString(body.experience, 60);

  const context = describeContext({ title, description, type, location, experience });

  try {
    if ((mode as Mode) === 'job-skills') {
      const draft = await generateJson<SkillsDraft>({
        prompt: [
          'Read this job posting and list the skills it actually implies.',
          '',
          context,
          '',
          `Return up to ${MAX_SKILLS} concrete skill tags of one to three words each -`,
          'technologies, tools, methods or domain expertise that the text supports.',
          'Do not add skills the posting does not mention or clearly imply, and do',
          'not return generic filler such as "hard working" or "team player".',
        ].join('\n'),
        schema: SKILLS_SCHEMA,
        systemInstruction: SYSTEM_INSTRUCTION,
      });

      if (!draft) return aiFailed();

      return NextResponse.json({ skills: cleanSkillTags(draft.skills) });
    }

    const draft = await generateJson<DescriptionDraft>({
      prompt: [
        'Write a job posting from the details below.',
        '',
        context,
        '',
        'Return:',
        `- description: plain text under ${MAX_DESCRIPTION_CHARS} characters. Open with a short`,
        '  paragraph about the role, then a "Responsibilities" list and a "Requirements"',
        '  list, each as short lines beginning with "- ". No markdown headers, no bold,',
        '  no tables, no emoji.',
        `- skills: up to ${MAX_SKILLS} concrete skill tags of one to three words each.`,
        '- suggestedTitle: a clear, conventional title for this role. Keep the given',
        '  title if it is already clear.',
        '',
        'Use only the details above. Leave out anything you were not told.',
      ].join('\n'),
      schema: DESCRIPTION_SCHEMA,
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.4,
    });

    if (!draft) return aiFailed();

    const draftedDescription = cleanText(draft.description, MAX_DESCRIPTION_CHARS);
    if (!draftedDescription) return aiFailed();

    return NextResponse.json({
      description: draftedDescription,
      skills: cleanSkillTags(draft.skills),
      // Fall back to what the employer typed rather than handing back an empty
      // field the form would then blank out.
      suggestedTitle: cleanString(draft.suggestedTitle, 150) ?? title,
    });
  } catch (error) {
    console.error('POST /api/ai/assist failed:', error);
    return aiFailed();
  }
}
