import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { JOB_TYPES, SENIORITY_LEVELS, type SeniorityLevel } from '@/lib/validation';
import { RETRIEVAL_DEPTH, RRF_K } from './config';
import { embedQueryCached, getActiveJobVectors } from './cache';
import { cosineSimilarity } from './vector';
import type { SemanticHit } from './matching';

/**
 * Hybrid job retrieval — the lexical and vector arms, fused by rank.
 *
 * `semanticJobSearch` embedded the query and scanned every stored vector. That
 * is a good recall engine and a poor precision one: embeddings blur rare literal
 * tokens, so searching a company name, `K8s`, `SRE` or a framework version — the
 * queries where the user already knows exactly what they want — retrieved
 * poorly. It also spent a model call and read the whole corpus per keystroke-
 * driven search, and treated "remote senior Go above 120k" as four words to
 * embed rather than three filters and one word.
 *
 * This module fixes all four:
 *
 *   1. A Postgres full-text arm runs beside the vector arm, so literal tokens
 *      are matched literally (`lexicalSearch`).
 *   2. Query vectors are cached and job vectors are held in process
 *      (`lib/ai/cache.ts`).
 *   3. Structured filters are parsed out of the query and applied as SQL
 *      predicates; only the prose remainder is embedded (`parseQuery`).
 *   4. With no key, no vector, or a failed embedding call it returns the
 *      lexical ranking rather than `null` — strictly better than today, where
 *      search gave up and the client fell back to substring filtering.
 */

/* -------------------------------------------------------------------------- */
/* Query understanding                                                         */
/* -------------------------------------------------------------------------- */

export type FilterKey = 'remote' | 'seniority' | 'type' | 'minSalary' | 'location';

/** Employment types a query may filter to — the same allowlist the post-a-job form writes. */
export type JobType = (typeof JOB_TYPES)[number];

export interface SearchFilters {
  /** True for remote-only, false for on-site-only, absent when unstated. */
  remote?: boolean;
  seniority?: SeniorityLevel;
  type?: JobType;
  minSalary?: number;
  /**
   * A place, canonicalised to a `KNOWN_LOCATIONS` label ("Berlin, Germany").
   *
   * Set by the parser only when the query named a place the gazetteer below
   * recognises. A caller that sets it from somewhere else — an explicit
   * Location select on the feed, a saved search — may pass any string;
   * `locationPredicate` degrades to a plain substring match on values it does
   * not recognise, so an unknown city still filters sensibly.
   */
  location?: string;
}

/**
 * One filter, as the UI shows it back to the user.
 *
 * `token` is the literal text from the query that produced the filter, which is
 * what makes the chip removable: the client rebuilds the query from the
 * remainder plus the tokens of the chips that are left, and re-parsing that
 * string yields exactly the filters that were kept.
 */
export interface SearchFilterChip {
  key: FilterKey;
  label: string;
  token: string;
}

export interface ParsedQuery {
  filters: SearchFilters;
  chips: SearchFilterChip[];
  /** What is left once the filter words are removed. This is what gets embedded. */
  remainder: string;
}

/**
 * Salary figures below this are not a compensation band.
 *
 * "over 5 years", "3+ yoe" and a bare "12" (lakhs, or a multiple nobody stated)
 * all parse as small numbers. Treating them as a salary floor would silently
 * filter the corpus on a misreading, so anything under the floor is discarded
 * and the query keeps those words instead.
 */
const SALARY_FLOOR = 1000;

/** Nothing legitimate is above this; it exists to bound a typo like `120kk`. */
const SALARY_CEILING = 100_000_000;

/** Time units that follow a number in a *duration*, never in a salary. */
const DURATION_UNIT = String.raw`(?!\s*(?:years?|yrs?|yoe|months?|mos?|weeks?|days?|hours?|hrs?)\b)`;

const CURRENCY = String.raw`[$£€₹]?\s*`;
const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)\s*([kmKM]?)`;

/**
 * Ordered by how explicit the signal is. Every alternative is tried and the
 * earliest match in the string that yields a plausible figure wins, so
 * "5+ years, paying over 120k" reads the salary rather than the experience.
 */
const SALARY_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`\b(?:above|over|at least|more than|greater than|minimum|min\.?|starting at|paying|upwards of|north of|from)\s+${CURRENCY}${AMOUNT}\b${DURATION_UNIT}`,
    'gi'
  ),
  new RegExp(String.raw`>=?\s*${CURRENCY}${AMOUNT}\b${DURATION_UNIT}`, 'gi'),
  new RegExp(String.raw`${CURRENCY}${AMOUNT}\s*\+${DURATION_UNIT}`, 'gi'),
  // A currency symbol on its own is signal enough: "$120k backend role".
  new RegExp(String.raw`[$£€₹]\s*${AMOUNT}\b${DURATION_UNIT}`, 'gi'),
];

const REMOTE_PATTERN = /\b(?:fully\s+)?(?:remote(?:ly)?|work from home|wfh|distributed team)\b/i;
const ONSITE_PATTERN = /\b(?:on[\s-]?site|in[\s-]?office|in[\s-]?person)\b/i;

/**
 * `JOB_TYPES` includes `Remote`, which is deliberately absent here: "remote" is
 * read as the location filter instead, because postings express it as a
 * location at least as often as they do as an employment type, and the remote
 * predicate below checks both columns.
 */
const TYPE_PATTERNS: ReadonlyArray<{ type: JobType; pattern: RegExp }> = [
  { type: 'Full Time', pattern: /\bfull[\s-]?time\b|\bfulltime\b/i },
  { type: 'Part Time', pattern: /\bpart[\s-]?time\b|\bparttime\b/i },
  { type: 'Internship', pattern: /\binternships?\b/i },
  { type: 'Contract', pattern: /\bcontract(?:or|ing)?\b|\bfreelance\b/i },
];

/**
 * Seniority synonyms, most senior first.
 *
 * Precedence matters for a query like "senior staff engineer" — either reading
 * is defensible, so the order simply has to be *decided* rather than left to
 * whichever regex happens to run first.
 */
const SENIORITY_PATTERNS: ReadonlyArray<{ level: SeniorityLevel; pattern: RegExp }> = [
  { level: 'Director', pattern: /\bdirector\b|\bhead of\b|\bvp\b/i },
  { level: 'Principal', pattern: /\bprincipal\b/i },
  { level: 'Staff', pattern: /\bstaff\b/i },
  { level: 'Lead', pattern: /\b(?:tech(?:nical)?\s+)?lead\b/i },
  { level: 'Senior', pattern: /\bsenior\b|\bsr\.?(?=\s|$)/i },
  { level: 'Mid', pattern: /\bmid[\s-]?level\b|\bmid\b|\bintermediate\b/i },
  { level: 'Junior', pattern: /\bjunior\b|\bjr\.?(?=\s|$)/i },
  { level: 'Entry', pattern: /\bentry[\s-]?level\b|\bentry\b|\bnew grad\b|\bgraduate\b|\bfresher\b/i },
  { level: 'Intern', pattern: /\bintern\b/i },
];

/* ---- Location ------------------------------------------------------------ */

/**
 * One place the parser is willing to recognise.
 *
 * Location is the first *open-ended* dimension in this parser, and it is the
 * one where being wrong is expensive: seniority or employment type read off a
 * closed vocabulary, but "in X" will happily hand any noun to a filter that
 * then removes most of the corpus before ranking. The answer used here is a
 * closed vocabulary again — a curated gazetteer — so the open-endedness is
 * bounded by data rather than by a model call on the request path.
 *
 * The cost of that choice is honest and bounded: a city nobody listed here is
 * simply not parsed, the words stay in the remainder, and the query is ranked
 * as prose exactly as it is today. The cost of the alternative — a generic
 * `in (\w+)` rule — is that "Engineer in Test" silently searches a city called
 * Test and returns nothing. Under-matching degrades to today's behaviour;
 * over-matching does not degrade to anything.
 */
interface KnownLocation {
  /**
   * Canonical label. This is the chip's text and the value carried in
   * `SearchFilters.location`, so it is also the key `locationPredicate` looks
   * needles up by — changing one means changing the other.
   */
  label: string;
  /** Spellings a query may use. Matched whole-word and case-insensitively. */
  names: string[];
  /**
   * Substrings matched against `Job.location`. Defaults to `names`.
   *
   * Overridden wherever a name is an abbreviation a posting would never write
   * out ("UK", "NYC", "SF"): `%uk%` inside a free-text column matches far more
   * than the United Kingdom, and the spelled-out needle already covers the
   * query that used the abbreviation.
   */
  needles?: string[];
}

/**
 * Places deliberately *absent* from the gazetteer, because the word is load
 * bearing somewhere else in a job query and a false positive costs more than
 * the miss:
 *
 *   Mobile (AL), Reading, Bath, Derby, Hull, Sale, Cork, Nice, Split, Male,
 *   York, Victoria, Washington, Georgia — ordinary English or ordinary names.
 *   Java (Indonesia), Jakarta (Jakarta EE), Phoenix (the Elixir framework),
 *   Delphi — a place name that is also a thing people write code in.
 *
 * The test for adding an entry is not "is it a city" but "would a job seeker
 * ever type this word meaning anything else".
 */
const KNOWN_LOCATIONS: readonly KnownLocation[] = [
  /* Europe */
  { label: 'Berlin, Germany', names: ['Berlin'] },
  { label: 'Munich, Germany', names: ['Munich', 'München', 'Muenchen'] },
  { label: 'Hamburg, Germany', names: ['Hamburg'] },
  { label: 'Frankfurt, Germany', names: ['Frankfurt'] },
  { label: 'Cologne, Germany', names: ['Cologne', 'Köln'] },
  { label: 'Stuttgart, Germany', names: ['Stuttgart'] },
  { label: 'London, United Kingdom', names: ['London'] },
  { label: 'Manchester, United Kingdom', names: ['Manchester'] },
  { label: 'Edinburgh, United Kingdom', names: ['Edinburgh'] },
  { label: 'Glasgow, United Kingdom', names: ['Glasgow'] },
  { label: 'Birmingham, United Kingdom', names: ['Birmingham'] },
  { label: 'Bristol, United Kingdom', names: ['Bristol'] },
  { label: 'Leeds, United Kingdom', names: ['Leeds'] },
  { label: 'Cambridge, United Kingdom', names: ['Cambridge'] },
  { label: 'Oxford, United Kingdom', names: ['Oxford'] },
  { label: 'Cardiff, United Kingdom', names: ['Cardiff'] },
  { label: 'Belfast, United Kingdom', names: ['Belfast'] },
  { label: 'Dublin, Ireland', names: ['Dublin'] },
  { label: 'Amsterdam, Netherlands', names: ['Amsterdam'] },
  { label: 'Rotterdam, Netherlands', names: ['Rotterdam'] },
  { label: 'Utrecht, Netherlands', names: ['Utrecht'] },
  { label: 'Eindhoven, Netherlands', names: ['Eindhoven'] },
  { label: 'Brussels, Belgium', names: ['Brussels', 'Bruxelles'] },
  { label: 'Paris, France', names: ['Paris'] },
  { label: 'Lyon, France', names: ['Lyon'] },
  { label: 'Toulouse, France', names: ['Toulouse'] },
  { label: 'Madrid, Spain', names: ['Madrid'] },
  { label: 'Barcelona, Spain', names: ['Barcelona'] },
  { label: 'Valencia, Spain', names: ['Valencia'] },
  { label: 'Lisbon, Portugal', names: ['Lisbon', 'Lisboa'] },
  { label: 'Porto, Portugal', names: ['Porto'] },
  { label: 'Milan, Italy', names: ['Milan', 'Milano'] },
  { label: 'Rome, Italy', names: ['Rome', 'Roma'] },
  { label: 'Zurich, Switzerland', names: ['Zurich', 'Zürich'] },
  { label: 'Geneva, Switzerland', names: ['Geneva'] },
  { label: 'Vienna, Austria', names: ['Vienna', 'Wien'] },
  { label: 'Prague, Czechia', names: ['Prague', 'Praha'] },
  { label: 'Warsaw, Poland', names: ['Warsaw', 'Warszawa'] },
  { label: 'Kraków, Poland', names: ['Kraków', 'Krakow', 'Cracow'] },
  { label: 'Wrocław, Poland', names: ['Wrocław', 'Wroclaw'] },
  { label: 'Budapest, Hungary', names: ['Budapest'] },
  { label: 'Bucharest, Romania', names: ['Bucharest'] },
  { label: 'Sofia, Bulgaria', names: ['Sofia'] },
  { label: 'Athens, Greece', names: ['Athens'] },
  { label: 'Stockholm, Sweden', names: ['Stockholm'] },
  { label: 'Gothenburg, Sweden', names: ['Gothenburg', 'Göteborg'] },
  { label: 'Oslo, Norway', names: ['Oslo'] },
  { label: 'Copenhagen, Denmark', names: ['Copenhagen', 'København'] },
  { label: 'Helsinki, Finland', names: ['Helsinki'] },
  { label: 'Tallinn, Estonia', names: ['Tallinn'] },
  { label: 'Vilnius, Lithuania', names: ['Vilnius'] },
  { label: 'Riga, Latvia', names: ['Riga'] },
  { label: 'Istanbul, Türkiye', names: ['Istanbul'] },

  /* North America */
  { label: 'New York, United States', names: ['New York City', 'New York', 'NYC'], needles: ['New York'] },
  {
    label: 'San Francisco, United States',
    names: ['San Francisco Bay Area', 'San Francisco', 'Bay Area', 'SF'],
    needles: ['San Francisco', 'Bay Area'],
  },
  { label: 'Seattle, United States', names: ['Seattle'] },
  { label: 'Austin, United States', names: ['Austin'] },
  { label: 'Chicago, United States', names: ['Chicago'] },
  { label: 'Boston, United States', names: ['Boston'] },
  { label: 'Denver, United States', names: ['Denver'] },
  { label: 'Atlanta, United States', names: ['Atlanta'] },
  { label: 'Los Angeles, United States', names: ['Los Angeles'] },
  { label: 'San Diego, United States', names: ['San Diego'] },
  { label: 'San Jose, United States', names: ['San Jose'] },
  { label: 'Portland, United States', names: ['Portland'] },
  { label: 'Miami, United States', names: ['Miami'] },
  { label: 'Dallas, United States', names: ['Dallas'] },
  { label: 'Houston, United States', names: ['Houston'] },
  { label: 'Philadelphia, United States', names: ['Philadelphia'] },
  { label: 'Pittsburgh, United States', names: ['Pittsburgh'] },
  { label: 'Minneapolis, United States', names: ['Minneapolis'] },
  { label: 'Detroit, United States', names: ['Detroit'] },
  { label: 'Nashville, United States', names: ['Nashville'] },
  { label: 'Raleigh, United States', names: ['Raleigh'] },
  { label: 'Charlotte, United States', names: ['Charlotte'] },
  { label: 'Salt Lake City, United States', names: ['Salt Lake City'] },
  { label: 'Toronto, Canada', names: ['Toronto'] },
  { label: 'Vancouver, Canada', names: ['Vancouver'] },
  { label: 'Montreal, Canada', names: ['Montreal', 'Montréal'] },
  { label: 'Ottawa, Canada', names: ['Ottawa'] },
  { label: 'Mexico City, Mexico', names: ['Mexico City', 'CDMX'], needles: ['Mexico City'] },

  /* South America */
  { label: 'São Paulo, Brazil', names: ['São Paulo', 'Sao Paulo'] },
  { label: 'Rio de Janeiro, Brazil', names: ['Rio de Janeiro'] },
  { label: 'Buenos Aires, Argentina', names: ['Buenos Aires'] },
  { label: 'Bogotá, Colombia', names: ['Bogotá', 'Bogota'] },
  { label: 'Santiago, Chile', names: ['Santiago'] },
  { label: 'Lima, Peru', names: ['Lima'] },
  { label: 'Montevideo, Uruguay', names: ['Montevideo'] },

  /* Asia and the Pacific */
  { label: 'Bengaluru, India', names: ['Bengaluru', 'Bangalore'] },
  { label: 'Mumbai, India', names: ['Mumbai', 'Bombay'] },
  { label: 'New Delhi, India', names: ['New Delhi', 'Delhi'] },
  { label: 'Hyderabad, India', names: ['Hyderabad'] },
  { label: 'Chennai, India', names: ['Chennai'] },
  { label: 'Pune, India', names: ['Pune'] },
  { label: 'Kolkata, India', names: ['Kolkata'] },
  { label: 'Gurugram, India', names: ['Gurugram', 'Gurgaon'] },
  { label: 'Noida, India', names: ['Noida'] },
  { label: 'Ahmedabad, India', names: ['Ahmedabad'] },
  { label: 'Singapore', names: ['Singapore'] },
  { label: 'Hong Kong', names: ['Hong Kong'] },
  { label: 'Tokyo, Japan', names: ['Tokyo'] },
  { label: 'Osaka, Japan', names: ['Osaka'] },
  { label: 'Seoul, South Korea', names: ['Seoul'] },
  { label: 'Shanghai, China', names: ['Shanghai'] },
  { label: 'Beijing, China', names: ['Beijing'] },
  { label: 'Shenzhen, China', names: ['Shenzhen'] },
  { label: 'Taipei, Taiwan', names: ['Taipei'] },
  { label: 'Bangkok, Thailand', names: ['Bangkok'] },
  { label: 'Kuala Lumpur, Malaysia', names: ['Kuala Lumpur'] },
  { label: 'Manila, Philippines', names: ['Manila'] },
  { label: 'Ho Chi Minh City, Vietnam', names: ['Ho Chi Minh City', 'Saigon'] },
  { label: 'Hanoi, Vietnam', names: ['Hanoi'] },
  { label: 'Sydney, Australia', names: ['Sydney'] },
  { label: 'Melbourne, Australia', names: ['Melbourne'] },
  { label: 'Brisbane, Australia', names: ['Brisbane'] },
  { label: 'Perth, Australia', names: ['Perth'] },
  { label: 'Auckland, New Zealand', names: ['Auckland'] },
  { label: 'Wellington, New Zealand', names: ['Wellington'] },

  /* Middle East and Africa */
  { label: 'Dubai, United Arab Emirates', names: ['Dubai'] },
  { label: 'Abu Dhabi, United Arab Emirates', names: ['Abu Dhabi'] },
  { label: 'Tel Aviv, Israel', names: ['Tel Aviv'] },
  { label: 'Cairo, Egypt', names: ['Cairo'] },
  { label: 'Nairobi, Kenya', names: ['Nairobi'] },
  { label: 'Lagos, Nigeria', names: ['Lagos'] },
  { label: 'Cape Town, South Africa', names: ['Cape Town'] },
  { label: 'Johannesburg, South Africa', names: ['Johannesburg'] },

  /* US states, because postings write "Austin, Texas" as often as "Austin" */
  { label: 'California', names: ['California'] },
  { label: 'Texas', names: ['Texas'] },
  { label: 'Illinois', names: ['Illinois'] },
  { label: 'Massachusetts', names: ['Massachusetts'] },
  { label: 'Colorado', names: ['Colorado'] },
  { label: 'Oregon', names: ['Oregon'] },
  { label: 'Arizona', names: ['Arizona'] },
  { label: 'Utah', names: ['Utah'] },
  { label: 'Florida', names: ['Florida'] },
  { label: 'Pennsylvania', names: ['Pennsylvania'] },
  { label: 'New Jersey', names: ['New Jersey'] },
  { label: 'North Carolina', names: ['North Carolina'] },
  { label: 'Minnesota', names: ['Minnesota'] },
  { label: 'Michigan', names: ['Michigan'] },
  { label: 'Ohio', names: ['Ohio'] },
  { label: 'Tennessee', names: ['Tennessee'] },

  /* Countries. A country only matches a posting whose own location names the
     country — "in Germany" will not find a posting that says only "Berlin".
     That is the honest reading of a free-text column, and it under-matches
     rather than over-matches, which is the direction this parser leans. */
  { label: 'Germany', names: ['Germany', 'Deutschland'] },
  { label: 'United Kingdom', names: ['United Kingdom', 'UK', 'Britain'], needles: ['United Kingdom'] },
  { label: 'Ireland', names: ['Ireland'] },
  { label: 'France', names: ['France'] },
  { label: 'Spain', names: ['Spain'] },
  { label: 'Portugal', names: ['Portugal'] },
  { label: 'Italy', names: ['Italy'] },
  { label: 'Netherlands', names: ['Netherlands', 'Holland'], needles: ['Netherlands'] },
  { label: 'Belgium', names: ['Belgium'] },
  { label: 'Switzerland', names: ['Switzerland'] },
  { label: 'Austria', names: ['Austria'] },
  { label: 'Poland', names: ['Poland'] },
  { label: 'Czechia', names: ['Czechia', 'Czech Republic'] },
  { label: 'Sweden', names: ['Sweden'] },
  { label: 'Norway', names: ['Norway'] },
  { label: 'Denmark', names: ['Denmark'] },
  { label: 'Finland', names: ['Finland'] },
  { label: 'Estonia', names: ['Estonia'] },
  { label: 'Romania', names: ['Romania'] },
  { label: 'Bulgaria', names: ['Bulgaria'] },
  { label: 'Hungary', names: ['Hungary'] },
  { label: 'Greece', names: ['Greece'] },
  { label: 'Türkiye', names: ['Türkiye', 'Turkiye', 'Turkey'] },
  { label: 'United States', names: ['United States', 'USA'], needles: ['United States'] },
  { label: 'Canada', names: ['Canada'] },
  { label: 'Mexico', names: ['Mexico'] },
  { label: 'Brazil', names: ['Brazil'] },
  { label: 'Argentina', names: ['Argentina'] },
  { label: 'Chile', names: ['Chile'] },
  { label: 'Colombia', names: ['Colombia'] },
  { label: 'India', names: ['India'] },
  { label: 'Japan', names: ['Japan'] },
  { label: 'South Korea', names: ['South Korea'] },
  { label: 'China', names: ['China'] },
  { label: 'Taiwan', names: ['Taiwan'] },
  { label: 'Thailand', names: ['Thailand'] },
  { label: 'Vietnam', names: ['Vietnam'] },
  { label: 'Malaysia', names: ['Malaysia'] },
  { label: 'Philippines', names: ['Philippines'] },
  { label: 'Australia', names: ['Australia'] },
  { label: 'New Zealand', names: ['New Zealand'] },
  { label: 'Israel', names: ['Israel'] },
  { label: 'United Arab Emirates', names: ['United Arab Emirates', 'UAE'], needles: ['United Arab Emirates'] },
  { label: 'Egypt', names: ['Egypt'] },
  { label: 'Kenya', names: ['Kenya'] },
  { label: 'Nigeria', names: ['Nigeria'] },
  { label: 'South Africa', names: ['South Africa'] },

  /* Hiring regions, which postings really do write into the location column
     ("Remote (EMEA)", "Remote (Europe)"). */
  { label: 'Europe', names: ['Europe'] },
  { label: 'EMEA', names: ['EMEA'] },
  { label: 'APAC', names: ['APAC'] },
  { label: 'LATAM', names: ['LATAM'] },
];

const LOCATION_BY_NAME = new Map<string, KnownLocation>();
const LOCATION_BY_LABEL = new Map<string, KnownLocation>();

for (const entry of KNOWN_LOCATIONS) {
  LOCATION_BY_LABEL.set(entry.label.toLowerCase(), entry);
  for (const name of entry.names) LOCATION_BY_NAME.set(name.toLowerCase(), entry);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every known spelling as one alternation, longest first.
 *
 * Length order is what makes "New York City" win over "New York", and
 * "San Francisco Bay Area" over "Bay Area" — a regex alternation takes the
 * first alternative that matches, not the longest, so the ordering has to do
 * that work.
 */
const PLACE = [...LOCATION_BY_NAME.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

/**
 * A place, optionally qualified by a second known place: "Berlin, Germany",
 * "Austin, Texas". The qualifier is swallowed so it does not survive into the
 * remainder as a stray word, but it is not read — the city is the filter.
 */
const PLACE_PHRASE = String.raw`(${PLACE})(?:\s*,\s*(?:${PLACE}))?`;

/**
 * How a query says where it wants to work, most explicit first.
 *
 * Every one of these anchors the place against `PLACE_PHRASE`, never against a
 * generic word, which is the whole false-positive defence: "Engineer in Test",
 * "work in finance" and "roles in AI" cannot match because Test, finance and
 * AI are not places this module has heard of.
 */
const LOCATION_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`\b(?:based\s+in|located\s+in|relocat(?:e|ing)\s+to|in|near|around)\s+(?:the\s+)?${PLACE_PHRASE}\b`,
    'i'
  ),
  new RegExp(String.raw`\b${PLACE_PHRASE}[\s-]based\b`, 'i'),
  // A bare trailing place: "React developer Berlin".
  new RegExp(String.raw`\b${PLACE_PHRASE}\s*$`, 'i'),
];

function findLocation(text: string): { entry: KnownLocation; index: number; text: string } | null {
  for (const pattern of LOCATION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    const entry = LOCATION_BY_NAME.get(match[1].toLowerCase());
    // Unreachable while `PLACE` is built from the same map, but a lookup miss
    // must not become an undefined filter label.
    if (!entry) continue;

    return { entry, index: match.index, text: match[0] };
  }

  return null;
}

/** How the parsed value reads back to the user, in the chip. */
function salaryLabel(amount: number): string {
  return amount >= 1000 ? `${Math.round(amount / 1000)}k+` : `${amount}+`;
}

/**
 * Turns "remote senior Go role above 120k" into
 * `{ remote: true, seniority: 'Senior', minSalary: 120000 }` plus `"Go role"`.
 *
 * **Deterministic on purpose.** A structured-output model call would do this
 * too, but it would cost a request, ~300ms and a dependency on the key being
 * present, on the request path, for a job that four regexes do exactly. It
 * would also make the parse unpredictable: a filter that silently narrows the
 * corpus has to be reproducible, testable, and identical for every user typing
 * the same words. The vocabulary here is closed — `SENIORITY_LEVELS`,
 * `JOB_TYPES`, remote/on-site, a number — which is precisely the case where a
 * model adds variance rather than coverage.
 *
 * Location is the dimension that reads as open-ended, and it is handled by
 * closing it: `KNOWN_LOCATIONS` is a gazetteer, and a place the gazetteer does
 * not carry is simply not parsed. That is the deliberate shape of the failure.
 * A model call would cover more places and would also, on some unlucky
 * phrasing, decide "Test" is a city and silently return an empty result set
 * for "Engineer in Test" — a failure the user cannot see, cannot reproduce and
 * cannot undo, because the chip would name a filter they never asked for.
 * Missing a city leaves the words in the remainder and ranks the query exactly
 * as it is ranked today, which is a failure that costs nothing.
 */
export function parseQuery(query: string): ParsedQuery {
  const source = query.trim().replace(/\s+/g, ' ');
  const filters: SearchFilters = {};
  const chips: SearchFilterChip[] = [];

  // Matched spans are blanked out as they are consumed, so a later rule cannot
  // re-read words an earlier one already claimed — "internship" is an
  // employment type, and the "intern" inside it is not also a seniority.
  let working = source;

  const consume = (index: number, length: number) => {
    working = working.slice(0, index) + ' '.repeat(length) + working.slice(index + length);
  };

  /* ---- Salary. First, because it is the only rule that owns digits. ---- */
  const salary = findSalary(working);
  if (salary) {
    filters.minSalary = salary.amount;
    chips.push({ key: 'minSalary', label: salaryLabel(salary.amount), token: salary.text.trim() });
    consume(salary.index, salary.text.length);
  }

  /* ---- Remote / on-site ---- */
  const onsite = ONSITE_PATTERN.exec(working);
  if (onsite) {
    filters.remote = false;
    chips.push({ key: 'remote', label: 'On-site', token: onsite[0] });
    consume(onsite.index, onsite[0].length);
  } else {
    const remote = REMOTE_PATTERN.exec(working);
    if (remote) {
      filters.remote = true;
      chips.push({ key: 'remote', label: 'Remote', token: remote[0] });
      consume(remote.index, remote[0].length);
    }
  }

  /* ---- Location ----
   *
   * After remote/on-site, which owns the other half of "where": `in-office`
   * and `in-person` both start with the word `in`, and letting the location
   * rule read that `in` first would leave "roles in-office" hunting for a
   * place called "office". Blanking the on-site span first makes that
   * impossible rather than unlikely. */
  const location = findLocation(working);
  if (location) {
    filters.location = location.entry.label;
    chips.push({ key: 'location', label: location.entry.label, token: location.text.trim() });
    consume(location.index, location.text.length);
  }

  /* ---- Employment type ---- */
  for (const { type, pattern } of TYPE_PATTERNS) {
    const match = pattern.exec(working);
    if (!match) continue;
    filters.type = type;
    chips.push({ key: 'type', label: type, token: match[0] });
    consume(match.index, match[0].length);
    break;
  }

  /* ---- Seniority ---- */
  for (const { level, pattern } of SENIORITY_PATTERNS) {
    const match = pattern.exec(working);
    if (!match) continue;
    filters.seniority = level;
    chips.push({ key: 'seniority', label: level, token: match[0] });
    consume(match.index, match[0].length);
    break;
  }

  return { filters, chips, remainder: tidyRemainder(working) };
}

function findSalary(text: string): { amount: number; index: number; text: string } | null {
  let best: { amount: number; index: number; text: string } | null = null;

  for (const pattern of SALARY_PATTERNS) {
    // `lastIndex` is shared state on a /g regex, so it is reset per use rather
    // than trusted to be where the previous call left it.
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const amount = toAmount(match[1], match[2]);
      if (amount === null || match.index === undefined) continue;
      if (best === null || match.index < best.index) {
        best = { amount, index: match.index, text: match[0] };
      }
    }
  }

  return best;
}

function toAmount(digits: string | undefined, suffix: string | undefined): number | null {
  if (!digits) return null;

  const base = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;

  const unit = suffix?.toLowerCase();
  const amount = unit === 'k' ? base * 1000 : unit === 'm' ? base * 1_000_000 : base;

  if (amount < SALARY_FLOOR || amount > SALARY_CEILING) return null;
  return Math.round(amount);
}

/**
 * Cleans up what the filter rules left behind.
 *
 * Whitespace and dangling punctuation only. Stopwords are deliberately left
 * alone: `to_tsvector` drops them anyway, and the embedding model reads natural
 * phrasing better than a de-worded one, so stripping them would be work that
 * can only make the remainder worse.
 */
function tidyRemainder(working: string): string {
  return working
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)[-–—,;:/&+]+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether anything was actually parsed out. */
export function hasFilters(filters: SearchFilters): boolean {
  return (
    filters.remote !== undefined ||
    filters.seniority !== undefined ||
    filters.type !== undefined ||
    filters.minSalary !== undefined ||
    filters.location !== undefined
  );
}

/* -------------------------------------------------------------------------- */
/* SQL fragments                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The lexical document, character for character as `Job_fulltext_idx` defines
 * it (see `20260911100000_ai_phase_two/migration.sql`).
 *
 * An expression index is only usable when the query's expression parses to the
 * same tree, so this is not a place to tidy the formatting or re-order a column:
 * any edit here silently drops the search from a bitmap index scan to a full
 * scan with a `to_tsvector` call per row, and nothing fails visibly.
 */
const JOB_TSVECTOR = Prisma.sql`to_tsvector('english',
    coalesce(j."title", '') || ' ' ||
    coalesce(j."location", '') || ' ' ||
    coalesce(j."type", '') || ' ' ||
    coalesce(j."description", ''))`;

/** ILIKE patterns per seniority level, matched against the title or the experience column. */
const SENIORITY_SQL: Record<SeniorityLevel, string[]> = {
  Intern: ['%intern%'],
  Entry: ['%entry%', '%graduate%', '%fresher%'],
  Junior: ['%junior%', 'jr %', '% jr%'],
  Mid: ['%mid%', '%intermediate%'],
  Senior: ['%senior%', 'sr %', '% sr%'],
  Lead: ['%lead%'],
  Staff: ['%staff%'],
  Principal: ['%principal%'],
  Director: ['%director%', '%head of%', '%vp %'],
};

/**
 * Salary predicate.
 *
 * `Job.salary` is free text ("$160k", "$120,000 - $150,000", "12 LPA",
 * "Competitive"), so the top of the band is extracted in SQL: every
 * digits-and-commas run with an optional `k`, take the maximum. The pattern
 * cannot match anything but digits and commas, which is what makes the
 * `::numeric` cast safe — a cast error here would be a 500, not a bad ranking.
 *
 * Two deliberate exclusions from the exclusion:
 *
 * - **Unstated salary stays in.** Most postings do not name a figure, and the
 *   codebase's existing convention is that missing data is neutral rather than
 *   a penalty (see `scoreLocation`). Dropping every silent posting would leave
 *   almost nothing behind and make the filter feel broken.
 * - **Figures under `SALARY_FLOOR` stay in.** The comparison is currency-blind,
 *   so "12 LPA" is not on the same scale as "120000" and cannot be honestly
 *   compared with it. A row is only removed when a comparable figure was parsed
 *   *and* it fell short.
 */
function salaryPredicate(minSalary: number): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1
    FROM (
      SELECT MAX(
        CASE WHEN lower(t[2]) = 'k' THEN replace(t[1], ',', '')::numeric * 1000
             ELSE replace(t[1], ',', '')::numeric END
      ) AS top
      FROM regexp_matches(coalesce(j."salary", ''), '([0-9][0-9,]*)\\s*([kK]?)', 'g') AS t
    ) s
    WHERE s.top >= ${SALARY_FLOOR} AND s.top < ${minSalary}
  )`;
}

/**
 * Location predicate.
 *
 * `Job.location` is free text — "Berlin, Germany", "Remote (EMEA)",
 * "Singapore (on-site)" — so the match is a case-insensitive substring rather
 * than an equality test: a filter of "Berlin, Germany" has to find a posting
 * that says only "Berlin", and vice versa. Every spelling the gazetteer knows
 * for the place is tried, which is what lets a query for "Bengaluru" find a
 * posting advertised in "Bangalore".
 *
 * Note what this predicate cannot use: the `pg_trgm` GIN index is on
 * `Job.title` and the full-text one is an expression index over the prose
 * columns, so neither is available to a leading-wildcard ILIKE on `location`.
 * This is a sequential scan over a column of short strings, which is the right
 * trade at this corpus size; a `gin (lower("location") gin_trgm_ops)` index is
 * the migration to write if it ever stops being.
 *
 * A value the gazetteer does not carry — which is what an explicit Location
 * select on the feed, or a saved search, would hand it — degrades to a single
 * substring match on the value itself rather than being ignored. LIKE
 * metacharacters in that value are escaped, so a user-supplied `%` filters for
 * a literal percent sign instead of matching everything.
 *
 * Postings with no location are excluded. Unlike `salary`, where silence means
 * "not advertised" and the codebase's convention is that missing data is
 * neutral, a row that does not say where it is cannot satisfy "in Berlin".
 */
function locationPredicate(location: string): Prisma.Sql {
  const entry = LOCATION_BY_LABEL.get(location.trim().toLowerCase());
  const needles = entry ? (entry.needles ?? entry.names) : [location.trim()];

  const clauses = needles.map(
    (needle) =>
      Prisma.sql`coalesce(j."location", '') ILIKE ${`%${needle.replace(/[\\%_]/g, '\\$&')}%`}`
  );

  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`;
}

/**
 * The parsed filters as SQL. Every value is a bound parameter — user text never
 * reaches the statement itself.
 */
function filterPredicates(filters: SearchFilters): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];

  if (filters.remote === true) {
    conditions.push(Prisma.sql`(
      coalesce(j."type", '') ILIKE '%remote%'
      OR coalesce(j."location", '') ILIKE '%remote%'
      OR coalesce(j."title", '') ILIKE '%remote%'
    )`);
  } else if (filters.remote === false) {
    conditions.push(Prisma.sql`(
      coalesce(j."type", '') NOT ILIKE '%remote%'
      AND coalesce(j."location", '') NOT ILIKE '%remote%'
    )`);
  }

  if (filters.seniority) {
    // A floor, not an equality test.
    //
    // Measured: "remote senior Go role above 120k" was filtering out a Staff
    // posting — remote, $185k, 8+ years — because its title says "Staff" and
    // not "Senior". Someone asking for senior work wants that role; excluding it
    // dropped the whole structured query from 99.0 to 81.8 nDCG. Seniority is an
    // ordered ladder, so the filter matches the level asked for and everything
    // above it, and over-qualification is left for the match score to weigh
    // rather than removed from the corpus before ranking.
    const floor = SENIORITY_LEVELS.indexOf(filters.seniority);
    const patterns = SENIORITY_LEVELS.slice(floor)
      .flatMap((level) => SENIORITY_SQL[level])
      .map(
        (pattern) =>
          Prisma.sql`coalesce(j."title", '') ILIKE ${pattern} OR coalesce(j."experience", '') ILIKE ${pattern}`
      );
    conditions.push(Prisma.sql`(${Prisma.join(patterns, ' OR ')})`);
  }

  if (filters.type) {
    // Postings spell it "Full Time", "full-time" and "Full-time"; normalising
    // both sides is cheaper than four ILIKE alternatives.
    conditions.push(
      Prisma.sql`replace(lower(coalesce(j."type", '')), '-', ' ') = ${filters.type.toLowerCase()}`
    );
  }

  if (typeof filters.minSalary === 'number') {
    conditions.push(salaryPredicate(filters.minSalary));
  }

  if (filters.location) {
    conditions.push(locationPredicate(filters.location));
  }

  return conditions;
}

/* -------------------------------------------------------------------------- */
/* Retrieval arms                                                              */
/* -------------------------------------------------------------------------- */

interface RankedRow {
  id: string;
  rank: number;
}

/**
 * Full-text arm.
 *
 * `websearch_to_tsquery` rather than `plainto_tsquery` because it understands
 * what people already type into a search box — quoted phrases, `or`, and a
 * leading `-` to exclude — and it never raises a syntax error on input it does
 * not understand, which `to_tsquery` would.
 */
async function lexicalSearch(
  text: string,
  filters: SearchFilters,
  depth: number
): Promise<RankedRow[]> {
  const conditions = [Prisma.sql`j."isActive" = true`, ...filterPredicates(filters)];

  // Nothing to match on: the query was pure filters ("remote full time above
  // 120k"). The filtered listing itself is then the lexical arm, newest first.
  if (!text) {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT j."id"
      FROM "Job" j
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY j."createdAt" DESC
      LIMIT ${depth}
    `);
    return rows.map((row, index) => ({ id: row.id, rank: rows.length - index }));
  }

  const rows = await prisma.$queryRaw<RankedRow[]>(Prisma.sql`
    SELECT j."id",
           ts_rank(${JOB_TSVECTOR}, websearch_to_tsquery('english', ${text})) AS rank
    FROM "Job" j
    WHERE ${Prisma.join(
      [...conditions, Prisma.sql`${JOB_TSVECTOR} @@ websearch_to_tsquery('english', ${text})`],
      ' AND '
    )}
    ORDER BY rank DESC, j."createdAt" DESC
    LIMIT ${depth}
  `);

  return rows;
}

/**
 * Trigram fallback for the case full text cannot help with: a typo.
 *
 * `to_tsvector` stems, it does not spell-correct, so "backnd enginer" matches
 * nothing at all. Run only when the lexical arm came back empty, so the common
 * path never pays for it, and wrapped because `pg_trgm` is created
 * best-effort in the migration and may legitimately be absent on a locked-down
 * managed tier.
 */
async function trigramSearch(
  text: string,
  filters: SearchFilters,
  depth: number
): Promise<RankedRow[]> {
  const conditions = [
    Prisma.sql`j."isActive" = true`,
    ...filterPredicates(filters),
    Prisma.sql`j."title" % ${text}`,
  ];

  try {
    return await prisma.$queryRaw<RankedRow[]>(Prisma.sql`
      SELECT j."id", similarity(j."title", ${text}) AS rank
      FROM "Job" j
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY rank DESC, j."createdAt" DESC
      LIMIT ${depth}
    `);
  } catch {
    // No pg_trgm, no fuzzy arm. The vector arm still covers this query.
    return [];
  }
}

/** Ids passing the filters, used to mask the vector arm to the same corpus. */
async function filteredJobIds(filters: SearchFilters): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT j."id"
    FROM "Job" j
    WHERE ${Prisma.join([Prisma.sql`j."isActive" = true`, ...filterPredicates(filters)], ' AND ')}
  `);
  return new Set(rows.map((row) => row.id));
}

/**
 * Vector arm, against the in-process corpus cache rather than a fresh read of
 * every row. Returns `null` — not an empty list — when there is no vector to
 * search with, so fusion can tell "no semantic signal available" apart from
 * "semantic search found nothing".
 */
async function vectorSearch(
  text: string,
  allowed: Set<string> | null,
  depth: number
): Promise<RankedRow[] | null> {
  const queryVector = await embedQueryCached(text);
  if (!queryVector) return null;

  const corpus = await getActiveJobVectors();
  if (corpus.length === 0) return null;

  const scored: RankedRow[] = [];
  for (const entry of corpus) {
    if (allowed && !allowed.has(entry.jobId)) continue;
    scored.push({ id: entry.jobId, rank: cosineSimilarity(queryVector, entry.vector) });
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, depth);
}

/* -------------------------------------------------------------------------- */
/* Fusion                                                                      */
/* -------------------------------------------------------------------------- */

export interface HybridHit extends SemanticHit {
  /** 1-based position in the lexical ranking, or null if that arm missed it. */
  lexicalRank: number | null;
  /** 1-based position in the vector ranking, or null if that arm missed it. */
  vectorRank: number | null;
}

export type SearchMode = 'hybrid' | 'lexical' | 'filters';

export interface HybridSearchResult {
  /**
   * Element shape is exactly `SemanticHit` (`{ jobId, relevance }`) plus the two
   * rank fields, so a caller that only reads `jobId` and `relevance` — which is
   * every caller today — needs no change at all.
   */
  hits: HybridHit[];
  filters: SearchFilters;
  chips: SearchFilterChip[];
  /** The prose that was actually embedded, once filters were removed. */
  remainder: string;
  /** `lexical` means the vector arm was unavailable, not that it found nothing. */
  mode: SearchMode;
}

export interface HybridSearchOptions {
  limit?: number;
  /** Candidates each arm contributes before fusion. */
  depth?: number;
  /** Floor on the fused 0–100 figure. Defaults to 0 — see the note below. */
  minRelevance?: number;
}

/**
 * Reciprocal Rank Fusion.
 *
 * `score(doc) = Σ 1 / (RRF_K + rank_i(doc))`, over the arms that ranked it.
 *
 * The fusion is over *ranks*, never over the arms' own scores, and that is the
 * whole reason to use it here: `ts_rank` is an unbounded lexical density figure
 * whose scale depends on the document and the query, while cosine similarity is
 * a bounded [-1, 1] geometric one that, in practice, only ever varies between
 * about 0.3 and 0.9. Any weighted sum of the two would be tuning a ratio between
 * numbers that mean different things — the weights would look principled and be
 * arbitrary. Positions are comparable by construction, and `RRF_K = 60` (the
 * value from the original TREC work) flattens the head enough that a confident
 * arm cannot bully the other one out of the result.
 */
function fuse(arms: RankedRow[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();

  for (const arm of arms) {
    for (let index = 0; index < arm.length; index++) {
      const id = arm[index].id;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  }

  return scores;
}

/**
 * Hybrid search over active jobs.
 *
 * Returns `null` only when there is nothing to search for — a query under two
 * characters. Every other degradation (no API key, an embedding failure, an
 * empty corpus) comes back as a lexical-only ranking, which is the fail-soft
 * rule applied properly: the old `semanticJobSearch` returned `null` the moment
 * AI was unavailable and left the client to substring-match, which threw away a
 * perfectly good full-text index that was sitting right there.
 */
export async function hybridJobSearch(
  query: string,
  options: HybridSearchOptions = {}
): Promise<HybridSearchResult | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;

  const depth = options.depth ?? RETRIEVAL_DEPTH;
  const limit = options.limit ?? 50;
  // Default 0, unlike the old `minRelevance: 25`. That floor was a cosine
  // threshold in disguise; a fused RRF score is a position, not a similarity, so
  // the same number would mean nothing here. `depth` is the bound instead.
  const minRelevance = options.minRelevance ?? 0;

  const parsed = parseQuery(trimmed);
  const filtered = hasFilters(parsed.filters);
  const text = parsed.remainder;

  // Only masked when there is something to mask by; an unfiltered query must not
  // pay for an extra round trip.
  const allowed = filtered ? await filteredJobIds(parsed.filters) : null;

  // The arms are independent, so they run together: the vector arm's cost is a
  // possible embedding call, and there is no reason for the SQL to wait on it.
  const [lexicalSettled, vectorSettled] = await Promise.allSettled([
    lexicalSearch(text, parsed.filters, depth),
    // With no prose left, embedding the filter words we just removed would
    // reintroduce exactly the bug this module exists to fix.
    text ? vectorSearch(text, allowed, depth) : Promise.resolve(null),
  ]);

  let lexical = settled(lexicalSettled, 'lexical arm', []);
  const vector = settled(vectorSettled, 'vector arm', null);

  // Trigram is a last resort, not a second lexical arm.
  //
  // Measured: for "JavaScript engineer", full-text finds nothing (it ANDs its
  // terms), so this fired and returned DevOps, Android, Analytics and *Java*
  // Engineer — titles related only by the word "Engineer" — which then entered
  // fusion at the same weight as the vector arm's genuine hits and dragged that
  // query from 70.5 to 42.4 nDCG.
  //
  // Character similarity is a typo-tolerance mechanism. It earns its place when
  // there is nothing better, and costs accuracy whenever there is: so it runs
  // only when the vector arm produced nothing either, which in practice means
  // AI is off or the embedding call failed.
  if (lexical.length === 0 && text && (!vector || vector.length === 0)) {
    lexical = await trigramSearch(text, parsed.filters, depth);
  }

  const arms: RankedRow[][] = [lexical];
  if (vector) arms.push(vector);

  const scores = fuse(arms);
  if (scores.size === 0) {
    return { hits: [], filters: parsed.filters, chips: parsed.chips, remainder: text, mode: modeOf(text, vector) };
  }

  const lexicalPositions = positions(lexical);
  const vectorPositions = positions(vector ?? []);

  // Best achievable fused score *given the arms that actually ran*, so a
  // lexical-only result set is not scaled against a vector arm that never
  // contributed and reported as half as relevant as it is.
  const bestPossible = arms.length / (RRF_K + 1);

  const hits: HybridHit[] = [...scores.entries()]
    .map(([jobId, score]) => ({
      jobId,
      relevance: Math.max(0, Math.min(100, Math.round((score / bestPossible) * 100))),
      lexicalRank: lexicalPositions.get(jobId) ?? null,
      vectorRank: vectorPositions.get(jobId) ?? null,
    }))
    .filter((hit) => hit.relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);

  return {
    hits,
    filters: parsed.filters,
    chips: parsed.chips,
    remainder: text,
    mode: modeOf(text, vector),
  };
}

function modeOf(text: string, vector: RankedRow[] | null): SearchMode {
  if (!text) return 'filters';
  return vector ? 'hybrid' : 'lexical';
}

function positions(rows: RankedRow[]): Map<string, number> {
  return new Map(rows.map((row, index) => [row.id, index + 1]));
}

/**
 * One arm failing must not take the search with it — a Postgres hiccup should
 * leave the vector results standing, and vice versa.
 */
function settled<T>(result: PromiseSettledResult<T>, label: string, fallback: T): T {
  if (result.status === 'fulfilled') return result.value;
  console.error(`hybridJobSearch ${label} failed:`, result.reason);
  return fallback;
}
