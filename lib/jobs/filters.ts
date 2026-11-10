/**
 * The Location and Experience filters on /jobs: how a posting's free-text
 * `location` and `experience` columns are read into the options people pick.
 *
 * Both columns are free text — typed into the post-a-job form, or copied from a
 * careers board by `lib/jobs/import.ts` — so offering their distinct values as
 * options produced "Delhi", "Delhi NCR", "Delhi-NCR" and "Delhi, Delhi ·
 * Bangalore, Karnataka · …" as four separate choices, and "10–14 years" beside
 * "10–15 years". Here each value is read into a small, stable vocabulary
 * instead: one option per place, and five ranges of years.
 *
 * Nothing here touches the database. `app/api/jobs/route.ts` groups the
 * active corpus by each column, hands the distinct values to these functions,
 * and filters with `column IN (the values that read as the chosen options)`.
 * Facet counts and the filter are therefore computed from one reading of one
 * set of strings, so a count can never promise a job the filter then drops —
 * and no column or migration is needed to store the reading.
 */

import { KNOWN_CITIES, KNOWN_REGIONS, type KnownLocation } from '@/lib/ai/search';

/* -------------------------------------------------------------------------- */
/* Location                                                                    */
/* -------------------------------------------------------------------------- */

/** How the Location list groups its options. */
export type PlaceKind = 'remote' | 'city' | 'region';

export interface Place {
  /** Lowercased display name; the identity of the option. */
  key: string;
  /** What the option says, and what goes in the URL. */
  name: string;
  kind: PlaceKind;
  /** Other spellings, for the search box in the Location list ("Bangalore"). */
  also?: string[];
}

const REMOTE: Place = { key: 'remote', name: 'Remote', kind: 'remote' };

/** Words that mean "you can work from anywhere", wherever they appear. */
const REMOTE_WORDS = /\b(?:remote(?:ly)?|work from home|wfh|anywhere(?: in the world)?|worldwide)\b/i;

/** The same, removable from a part once it has been read as Remote. */
const REMOTE_WORDS_GLOBAL = new RegExp(REMOTE_WORDS.source, 'gi');

/**
 * Where one posting lists several places, it joins them with one of these.
 * " · " is the importer's own separator; the rest are what people type
 * ("Mumbai / Bangalore", "UK - London").
 */
const PART_SEPARATORS = /\s*·\s*|\s*\/\s*|\s*\|\s*|\s*;\s*|\s+[-–—]\s+/;

/** Trailing words that describe the site rather than name the place. */
const SITE_WORDS = /\b(?:office|hq|headquarters|campus|area|district|region|metro(?:politan)?)\b\.?/gi;

/** Fragments that are not a place at all; never offered as one. */
const NOT_A_PLACE =
  /^(?:any|all|various|multiple|other|others|select|flexible|hybrid|global|international|n\/?a|tbd|job|jobs|home)\b/i;

const LETTER = String.raw`\p{L}\p{N}`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Gazetteer {
  /** One alternation, longest name first, so "Greater Noida" beats "Noida". */
  pattern: RegExp;
  /** Case-sensitive column-only spellings ("US", "DE"). */
  aliasPattern: RegExp | null;
  byName: Map<string, Place>;
  byAlias: Map<string, Place>;
}

function shortName(entry: KnownLocation): string {
  return entry.short ?? entry.label.split(',')[0].trim();
}

function buildGazetteer(entries: readonly KnownLocation[], kind: PlaceKind): Gazetteer {
  const byName = new Map<string, Place>();
  const byAlias = new Map<string, Place>();

  for (const entry of entries) {
    const name = shortName(entry);
    const also = entry.names.filter((spelling) => spelling.toLowerCase() !== name.toLowerCase());
    const place: Place = { key: name.toLowerCase(), name, kind, ...(also.length ? { also } : {}) };
    for (const spelling of [...entry.names, name, entry.label]) {
      byName.set(spelling.toLowerCase(), place);
    }
    for (const alias of entry.aliases ?? []) byAlias.set(alias, place);
  }

  // Whole words only, by Unicode letter rather than `\b`, which is ASCII-only
  // and would never find a boundary after the "ó" of "Kraków".
  const alternation = (names: string[]) =>
    names
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');

  return {
    pattern: new RegExp(`(?<![${LETTER}])(?:${alternation([...byName.keys()])})(?![${LETTER}])`, 'giu'),
    aliasPattern: byAlias.size
      ? new RegExp(`(?<![${LETTER}])(?:${alternation([...byAlias.keys()])})(?![${LETTER}])`, 'gu')
      : null,
    byName,
    byAlias,
  };
}

const CITIES = buildGazetteer(KNOWN_CITIES, 'city');
const REGIONS = buildGazetteer(KNOWN_REGIONS, 'region');

/**
 * The country each known city belongs to, read off its label ("Bengaluru,
 * India" → India), so that picking India also finds a posting that only says
 * "Bengaluru".
 */
const COUNTRY_OF_CITY = new Map<string, Place>();
for (const entry of KNOWN_CITIES) {
  const country = entry.label.split(',').slice(1).join(',').trim();
  const place = country ? REGIONS.byName.get(country.toLowerCase()) : undefined;
  if (place) COUNTRY_OF_CITY.set(shortName(entry).toLowerCase(), place);
}

function findAll(gazetteer: Gazetteer, text: string): Place[] {
  const found: Place[] = [];
  for (const match of text.matchAll(gazetteer.pattern)) {
    const place = gazetteer.byName.get(match[0].toLowerCase());
    if (place) found.push(place);
  }
  if (gazetteer.aliasPattern) {
    for (const match of text.matchAll(gazetteer.aliasPattern)) {
      const place = gazetteer.byAlias.get(match[0]);
      if (place) found.push(place);
    }
  }
  return found;
}

/**
 * A place nobody listed in the gazetteer, read off the text itself: the part
 * before the first comma, minus words like "Office". "Basel, Basel-Stadt,
 * Switzerland" and "Basel, Switzerland" both become Basel, so an unknown city
 * still folds into one option. Returns null for anything that does not look
 * like a place name — a stray code, a sentence, or text mangled on import.
 */
function unlistedPlace(part: string): Place | null {
  const head = part.split(',')[0].replace(SITE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if (!head || NOT_A_PLACE.test(head)) return null;
  if (head.length < 3 || head.length > 40) return null;
  if (!/^\p{L}[\p{L}\p{M} .'’-]*$/u.test(head)) return null;
  // Mojibake ("ÙØ³ÙØ·") is all Latin-1 punctuation-letters; a real name with
  // accents ("Zürich", "Île-de-France") is mostly plain letters.
  const plain = head.replace(/[^A-Za-z]/g, '').length;
  if (plain < head.replace(/[^\p{L}]/gu, '').length * 0.6) return null;

  // Kept as written ("Ciudad de México"), unless written all in lower case.
  const name =
    head === head.toLowerCase()
      ? head.replace(/(^|[\s-])(\p{Ll})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase())
      : head;
  return { key: name.toLowerCase(), name, kind: 'city' };
}

/**
 * Every place one posting's location names, deduplicated.
 *
 * "Noida, Uttar Pradesh · Bangalore, Karnataka · Gurugram, Haryana" names three
 * cities (and India, through them), so the posting is found under each. Within
 * a part, a city wins over the state or country written beside it: "Dallas,
 * Texas" is filed under Dallas, not Texas.
 */
export function placesIn(raw: string | null | undefined): Place[] {
  const text = raw?.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const found = new Map<string, Place>();
  const add = (place: Place) => {
    if (!found.has(place.key)) found.set(place.key, place);
  };

  // Remote is a property of the whole posting, whatever part it is written in:
  // "Remote · India", "Germany - Remote", "United Kingdom (Remote)".
  if (REMOTE_WORDS.test(text)) add(REMOTE);

  for (const rawPart of text.split(PART_SEPARATORS)) {
    const saidRemote = REMOTE_WORDS.test(rawPart);
    const part = rawPart
      .replace(REMOTE_WORDS_GLOBAL, ' ')
      .replace(/[()[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,:-]+|[\s,:-]+$/g, '');
    if (!part) continue;

    const cities = findAll(CITIES, part);
    if (cities.length > 0) {
      for (const city of cities) {
        add(city);
        const country = COUNTRY_OF_CITY.get(city.key);
        if (country) add(country);
      }
      continue;
    }

    const regions = findAll(REGIONS, part);
    // "Remote job" or "Your Remote US Home Office" is a description of remote
    // work, not a place to offer; only a recognised name is taken from it.
    const unlisted = saidRemote ? null : unlistedPlace(part);
    // A head that names a known region ("Switzerland", "The Netherlands") is
    // that region, not an unlisted place of the same name.
    if (unlisted && findAll(REGIONS, unlisted.name).length === 0) add(unlisted);
    for (const region of regions) add(region);
  }

  return [...found.values()];
}

/**
 * The places a filter value asks for.
 *
 * A value picked from the list is a place's own name and maps to that place.
 * Anything else — an old link carrying `?location=Bangalore`, or a raw posting
 * location such as "Bangalore, Karnataka" from before the list was folded — is
 * read the same way a posting is, so it lands on Bengaluru as well. A value
 * that names no recognisable place is kept as itself and simply matches what
 * it matches.
 */
export function placesForFilter(value: string): Place[] {
  const lower = value.trim().toLowerCase();
  if (!lower) return [];
  if (lower === REMOTE.key) return [REMOTE];

  const known = CITIES.byName.get(lower) ?? REGIONS.byName.get(lower);
  if (known) return [known];

  const read = placesIn(value);
  // A raw posting location also yields the country its cities are in; asking
  // for "Bangalore, Karnataka" is asking for Bengaluru, not for all of India.
  const cities = read.filter((place) => place.kind !== 'region');
  if (cities.length > 0) return cities;
  if (read.length > 0) return read;

  return [{ key: lower, name: value.trim(), kind: 'city' }];
}

/* -------------------------------------------------------------------------- */
/* Experience                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The experience ranges offered on /jobs.
 *
 * India-first job boards (Naukri, foundit) ask in years and talk about
 * "freshers" for the 0–1 band; LinkedIn uses levels (Internship, Entry level,
 * Associate, Mid-Senior, Director, Executive) instead. Years are what our own
 * postings mostly state ("3–5 years", "5+ years"), and five ranges keep every
 * level LinkedIn distinguishes while staying short enough to scan. Each range
 * includes its lower bound and stops short of its upper one, so a "1–3 years"
 * posting is 1–3 and not also 3–5.
 */
export const EXPERIENCE_BUCKETS = [
  { id: '0-1', label: 'Fresher (0–1 years)', from: 0, to: 1 },
  { id: '1-3', label: '1–3 years', from: 1, to: 3 },
  { id: '3-5', label: '3–5 years', from: 3, to: 5 },
  { id: '5-10', label: '5–10 years', from: 5, to: 10 },
  { id: '10-plus', label: '10+ years', from: 10, to: Infinity },
] as const;

/** Postings that state no experience, or none we can read. */
export const EXPERIENCE_NOT_STATED = { id: 'not-stated', label: 'Not specified' } as const;

export type ExperienceBucketId =
  | (typeof EXPERIENCE_BUCKETS)[number]['id']
  | typeof EXPERIENCE_NOT_STATED.id;

const BUCKET_IDS = new Set<string>([
  ...EXPERIENCE_BUCKETS.map((bucket) => bucket.id),
  EXPERIENCE_NOT_STATED.id,
]);

/** Display order, with "Not specified" last. */
export const EXPERIENCE_ORDER: readonly ExperienceBucketId[] = [
  ...EXPERIENCE_BUCKETS.map((bucket) => bucket.id),
  EXPERIENCE_NOT_STATED.id,
];

export function experienceBucketLabel(id: string): string {
  if (id === EXPERIENCE_NOT_STATED.id) return EXPERIENCE_NOT_STATED.label;
  return EXPERIENCE_BUCKETS.find((bucket) => bucket.id === id)?.label ?? id;
}

/** Years covered by [from, to], as the ranges they overlap. */
function bucketsForRange(from: number, to: number): ExperienceBucketId[] {
  if (from === to) {
    const bucket = EXPERIENCE_BUCKETS.find((b) => from >= b.from && from < b.to);
    return bucket ? [bucket.id] : [];
  }
  return EXPERIENCE_BUCKETS.filter((b) => from < b.to && to > b.from).map((b) => b.id);
}

/**
 * "5+ years" is a floor with no ceiling. Read literally it would sit under
 * every range above five, and "1+ years" under all of them, which buries the
 * ranges in junior postings. Treated instead as the range the floor falls in
 * plus the one above: 5+ is 5–10 and 10+, 3+ is 3–5 and 5–10.
 */
function bucketsForFloor(from: number): ExperienceBucketId[] {
  const index = EXPERIENCE_BUCKETS.findIndex((b) => from >= b.from && from < b.to);
  if (index === -1) return [];
  return EXPERIENCE_BUCKETS.slice(index, index + 2).map((b) => b.id);
}

/**
 * Seniority words, for postings that give a level instead of years — the
 * importer's `seniorityFromTitle` writes these, and people type them. The
 * years follow what Indian postings typically ask of each level.
 */
const SENIORITY_YEARS: ReadonlyArray<{ pattern: RegExp; buckets: ExperienceBucketId[] }> = [
  { pattern: /\b(?:intern(?:ship)?|trainee|apprentice|working student)\b/i, buckets: ['0-1'] },
  {
    pattern: /\b(?:fresher|freshers|fresh graduate|graduate|entry[\s-]?level|no experience|new grad)\b/i,
    buckets: ['0-1'],
  },
  { pattern: /\b(?:junior|jr\.?)(?![\p{L}])/iu, buckets: ['0-1', '1-3'] },
  { pattern: /\bassociate\b/i, buckets: ['1-3'] },
  { pattern: /\b(?:mid[\s-]?level|mid[\s-]?senior|intermediate)\b/i, buckets: ['3-5'] },
  { pattern: /\b(?:principal|director|head|vp|vice president|executive|chief)\b/i, buckets: ['10-plus'] },
  { pattern: /\b(?:staff|lead|architect)\b/i, buckets: ['5-10', '10-plus'] },
  { pattern: /\b(?:senior|sr\.?)(?![\p{L}])/iu, buckets: ['3-5', '5-10'] },
];

const NUMBER = String.raw`(\d{1,2}(?:\.\d)?)`;
const MONTHS = String.raw`\s*(?:months?|mos?)\b`;

/**
 * The ranges a posting's experience text falls in. Never empty: text with no
 * years and no level in it is "Not specified".
 */
export function experienceBuckets(raw: string | null | undefined): ExperienceBucketId[] {
  const text = raw?.replace(/\s+/g, ' ').trim();
  if (!text) return [EXPERIENCE_NOT_STATED.id];

  const inMonths = new RegExp(MONTHS, 'i').test(text);
  const scale = (n: string) => (inMonths ? Number(n) / 12 : Number(n));

  const range = text.match(new RegExp(String.raw`${NUMBER}\s*(?:-|–|—|to)\s*${NUMBER}`, 'i'));
  if (range) {
    const from = scale(range[1]);
    const to = scale(range[2]);
    if (to >= from) {
      const buckets = bucketsForRange(from, to);
      if (buckets.length) return buckets;
    }
  }

  const floor =
    text.match(new RegExp(String.raw`${NUMBER}\s*(?:\+|plus\b)`, 'i')) ??
    text.match(new RegExp(String.raw`(?:minimum(?:\s+of)?|min\.?|at least|over|more than)\s*${NUMBER}`, 'i'));
  if (floor) {
    const buckets = bucketsForFloor(scale(floor[1]));
    if (buckets.length) return buckets;
  }

  const single = text.match(new RegExp(String.raw`${NUMBER}\s*(?:years?|yrs?|months?|mos?)\b`, 'i'));
  if (single) {
    const buckets = bucketsForRange(scale(single[1]), scale(single[1]));
    if (buckets.length) return buckets;
  }

  for (const { pattern, buckets } of SENIORITY_YEARS) {
    if (pattern.test(text)) return buckets;
  }

  return [EXPERIENCE_NOT_STATED.id];
}

/**
 * The ranges an `?experience=` value asks for. A range id maps to itself; an
 * old link carrying a raw value ("3–5 years", "Senior") is read the way a
 * posting is.
 */
export function experienceForFilter(value: string): ExperienceBucketId[] {
  const id = value.trim().toLowerCase();
  if (BUCKET_IDS.has(id)) return [id as ExperienceBucketId];
  if (id === 'fresher' || id === '0-1 years') return ['0-1'];
  return experienceBuckets(value);
}
