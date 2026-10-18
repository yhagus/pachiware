/**
 * How a search matches words (#209), shared by file search, Task search, the commit filter and the Work item title filter.
 * Words are matched whole after a light stem, so "normalisasi", "normalization" and "normalize" meet while "log" never
 * matches "blog". Indonesian and English filler words leave a query. An Indonesian prefix gives a word a second, weaker reading
 * ("diimplementasikan" meets "implementasi"), a small work vocabulary pairs Indonesian and English words ("rilis", "release"),
 * and a base word meeting a derived one ("normal", "normalisasi") weighs less (#223, ADR 0015). No embedding model (ADR 0013).
 */
import { WORK_VOCABULARY } from "./vocabulary.js";

/** Words that carry no topic in a question, Indonesian then English. A query made only of them is searched as written. */
const FILLER = new Set([
  "yang", "dan", "di", "ke", "dari", "untuk", "dengan", "pada", "ini", "itu", "apa", "apakah", "siapa", "kapan", "mana", "bagaimana",
  "gimana", "kenapa", "mengapa", "berapa", "sudah", "udah", "belum", "pernah", "akan", "sedang", "juga", "saja", "aja", "tidak", "nggak",
  "gak", "bukan", "ada", "adalah", "atau", "tapi", "karena", "jadi", "soal", "tentang", "sih", "dong", "ya", "bisa", "harus", "mau",
  "oleh", "kita", "kami", "saya", "aku", "kamu", "dia", "mereka", "tersebut", "masih", "telah", "bahwa", "agar", "supaya", "kalau",
  "jika", "sampai", "sejak", "semua", "setiap", "tiap", "dibahas", "membahas", "dibicarakan", "diomongin",
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "about", "from", "by", "is", "are", "was", "were", "be",
  "been", "being", "has", "have", "had", "do", "does", "did", "what", "who", "when", "where", "which", "why", "how", "whether", "ever",
  "any", "we", "our", "us", "you", "your", "i", "me", "my", "they", "them", "it", "its", "this", "that", "these", "those", "there",
  "can", "could", "would", "should", "will", "not", "so", "if", "then", "than", "also", "just", "still", "yet", "already", "again",
  "talked", "discussed", "mentioned",
]);

/** A word of letters and digits, with inner marks kept ("inv-00042", "2.4", "on-call"). */
const WORD = /[\p{L}\p{N}]+(?:[-._'’][\p{L}\p{N}]+)*/gu;
const PART = /[\p{L}\p{N}]+/gu;
const LETTERS = /^\p{L}+$/u;

const cut = (word: string, end: string, root: number) => (word.endsWith(end) && word.length - end.length >= root ? word.slice(0, -end.length) : null);
/** Indonesian loanword endings, tried on the whole word first: "normalisasi", "implementasi", "prioritas". */
const LOANWORD: [string, number][] = [["isasi", 4], ["itas", 4], ["asi", 4]];
/** One ending at most, longest first: English derivations and inflections, then Indonesian suffixes. */
const ENDINGS: [string, number][] = [
  ["isation", 4], ["ization", 4], ["izing", 4], ["ising", 4], ["ized", 4], ["ised", 4], ["ize", 4], ["ise", 4], ["ation", 4],
  ["ity", 4], ["ion", 4], ["ing", 3], ["ed", 3], ["ly", 4], ["kan", 4], ["an", 4], ["i", 4],
];
/** The endings that make a new word from a base ("normal" → "normalisasi", "normalize", "normality"), as against inflections. */
const DERIVATIONAL = new Set(["isasi", "itas", "asi", "isation", "ization", "izing", "ising", "ized", "ised", "ize", "ise", "ation", "ity", "ion"]);
/** Verb endings: a verb form ("implemented", "jalankan") is the same word as its base and as its derived nouns. */
const VERBAL = new Set(["ing", "ed", "kan", "i"]);
/** Indonesian suffixes a loanword ending may stand before: "implementasikan". */
const INDONESIAN_SUFFIX = new Set(["kan", "an", "i"]);

/**
 * A word's light stem and what came off it: a derivational ending ("normalisasi"), a verb ending ("implemented"), or neither
 * ("normal"). Only a base word meeting a derived one is a likely collision of two meanings.
 */
type Kind = "base" | "derived" | "verb";
interface Form { stem: string; kind: Kind }

const loanword = (w: string) => { for (const [end, root] of LOANWORD) { const c = cut(w, end, root); if (c) return c; } return null; };

/**
 * The light stem of one lower-case word: an Indonesian particle (`-nya`, then `-lah`, `-kah`, `-pun`) comes off, then a
 * loanword ending, else an English plural and one more ending (an Indonesian suffix may uncover a loanword ending:
 * "implementasikan"). Each cut leaves a minimum root, so short words stay whole. A word with a digit or an inner mark is
 * left as it is. Prefixes are not stripped here: `secondaryOf` does that.
 */
function analyse(word: string): Form {
  if (word.length < 4 || !LETTERS.test(word)) return { stem: word, kind: "base" };
  let w = cut(word, "nya", 4) ?? word;
  for (const particle of ["lah", "kah", "pun"]) { const c = cut(w, particle, 5); if (c) { w = c; break; } }
  const loan = loanword(w);
  if (loan) return { stem: loan, kind: "derived" };
  if (/(?:sh|ch|x|z|ss)es$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (/[^su]s$/.test(w) && w.length > 4 && !/is$/.test(w)) w = w.slice(0, -1);
  for (const [end, root] of ENDINGS) {
    const c = cut(w, end, root);
    if (!c) continue;
    const under = INDONESIAN_SUFFIX.has(end) ? loanword(c) : null;
    return { stem: under ?? c, kind: under || DERIVATIONAL.has(end) ? "derived" : VERBAL.has(end) ? "verb" : "base" };
  }
  return { stem: w, kind: "base" };
}

export const stem = (word: string): string => analyse(word).stem;

/** Indonesian prefixes, longest first. */
const PREFIXES = ["meng", "meny", "peng", "peny", "ber", "ter", "mem", "men", "pem", "pen", "be", "di", "ke", "me", "pe", "se"];

/**
 * A stem's secondary form: the longest Indonesian prefix that leaves a root of at least 4 letters taken off, then the usual
 * endings, so "diimplementasikan" also reads "implement" and "dirilis" "rilis". No sound is restored ("memakai" stays "akai").
 */
function secondaryOf(form: Form): Form | null {
  if (!LETTERS.test(form.stem)) return null;
  const prefix = PREFIXES.find((p) => form.stem.startsWith(p) && form.stem.length - p.length >= 4);
  if (!prefix) return null;
  const root = analyse(form.stem.slice(prefix.length));
  const kinds = [form.kind, root.kind];
  return { stem: root.stem, kind: kinds.includes("derived") ? "derived" : kinds.includes("verb") ? "verb" : "base" };
}

/** A form as a term or tally key: its stem, with "+" when derived and "*" when a verb form. */
const MARKS: Record<Kind, string> = { base: "", derived: "+", verb: "*" };
const keyOf = (f: Form) => f.stem + MARKS[f.kind];
const formOf = (key: string): Form => {
  const kind: Kind = key.length < 2 ? "base" : key.endsWith("+") ? "derived" : key.endsWith("*") ? "verb" : "base";
  return { stem: kind === "base" ? key : key.slice(0, -1), kind };
};

/** Each stem of the work vocabulary, with the stems of its counterparts. */
const COUNTERPARTS = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of WORK_VOCABULARY) {
    const stems = [...new Set(group.map((w) => analyse(w.toLowerCase()).stem))];
    for (const s of stems) for (const other of stems) if (other !== s) {
      if (!map.has(s)) map.set(s, new Set());
      map.get(s)!.add(other);
    }
  }
  return map;
})();

/** A word as matching sees it: its form, and its secondary form when it has a prefix. */
interface WordForms { form: Form; secondary: Form | null }
const WORDS = new Map<string, WordForms>();
function wordForms(key: string): WordForms {
  let w = WORDS.get(key);
  if (!w) {
    if (WORDS.size > 50_000) WORDS.clear();
    const form = formOf(key);
    w = { form, secondary: secondaryOf(form) };
    WORDS.set(key, w);
  }
  return w;
}

/** What one query term matches: its own form and its vocabulary counterparts, then its secondary form and that one's counterparts. */
interface Reading { stem: string; kind: Kind; secondary: boolean }
const READINGS = new Map<string, Reading[]>();
function readingsOf(term: string): Reading[] {
  let r = READINGS.get(term);
  if (!r) {
    const { form, secondary } = wordForms(term);
    const of = (f: Form, isSecondary: boolean): Reading[] => [f.stem, ...(COUNTERPARTS.get(f.stem) ?? [])].map((stem) => ({ stem, kind: f.kind, secondary: isSecondary }));
    r = [...of(form, false), ...(secondary ? of(secondary, true) : [])];
    READINGS.set(term, r);
  }
  return r;
}

/** A match through a secondary form weighs this much; one between a base word and a derived one ("normal", "normalisasi") this much. */
const SECONDARY_WEIGHT = 0.5, BASE_DERIVED_WEIGHT = 0.25;
const collides = (a: Kind, b: Kind) => (a === "base" && b === "derived") || (a === "derived" && b === "base");

/** A plain word (letters only) a term's stem starts, when the stem has at least 4 letters ("audio" starts "audiobook"). */
const prefixes = (term: string, word: string) => term.length >= 4 && word !== term && word.startsWith(term) && LETTERS.test(word);

/**
 * How much a text word (a tally key) counts toward a query term, 0 when it does not match. A reading matches the word's stem, or a
 * plain word its stem starts; a secondary form on either side matches only whole and weighs half. A match between a base word and
 * a derived one weighs less; both base, both derived, or either a verb form weighs fully. The best reading counts.
 */
function weightOf(term: string, word: string): number {
  const { form, secondary } = wordForms(word);
  let best = 0;
  for (const r of readingsOf(term)) {
    const side = (f: Form, viaSecondary: boolean) => {
      const hit = viaSecondary || r.secondary ? f.stem === r.stem : f.stem === r.stem || prefixes(r.stem, f.stem);
      if (!hit) return 0;
      return (viaSecondary || r.secondary ? SECONDARY_WEIGHT : 1) * (collides(f.kind, r.kind) ? BASE_DERIVED_WEIGHT : 1);
    };
    best = Math.max(best, side(form, false), secondary ? side(secondary, true) : 0);
    if (best === 1) break;
  }
  return best;
}

/** The forms of a text's words: each word, and, for a word with inner marks, its parts too. `parts` counts the plain words. */
function textWords(text: string): { keys: string[]; parts: number } {
  const keys: string[] = [];
  let parts = 0;
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    const pieces = word.match(PART) ?? [];
    if (pieces.length > 1) keys.push(word);
    for (const p of pieces) { keys.push(keyOf(analyse(p))); parts++; }
  }
  return { keys, parts };
}

/**
 * The terms of one query: its words' forms, filler words left out unless nothing else is left. A word with inner marks is
 * split into its parts, unless it holds a digit ("inv-00042", "2.4"), which is matched whole.
 */
export function queryTerms(query: string): string[] {
  const words = (query.toLowerCase().match(WORD) ?? []).flatMap((w) => (/\d/.test(w) ? [w] : w.match(PART) ?? []));
  const topical = words.filter((w) => !FILLER.has(w));
  return [...new Set((topical.length ? topical : words).map((w) => keyOf(analyse(w))))];
}

/** The terms of each query, queries without any dropped. */
export const queriesTerms = (queries: string[]): string[][] => queries.map(queryTerms).filter((q) => q.length);

/** `query` and each of `queries` that is text, in that order: the wordings a tool was asked to search. */
export const wordingsOf = (query: unknown, queries: unknown): string[] => [query, ...(Array.isArray(queries) ? queries : [])].filter((q): q is string => typeof q === "string");

/** How many words of `counts` a term matches, each weighed by `weightOf`, and the weight of its best match. */
function matchOf(counts: Map<string, number>, term: string): { n: number; best: number } {
  let n = 0, best = 0;
  for (const [word, c] of counts) { const w = weightOf(term, word); if (w) { n += c * w; best = Math.max(best, w); } }
  return { n, best };
}
const countOf = (counts: Map<string, number>, term: string) => matchOf(counts, term).n;

const tally = (keys: string[]) => {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
};

/** Whether a text holds every term of at least one query: how Tasks, commits and Work item titles match. */
export function holdsQuery(queries: string[][], text: string): boolean {
  const counts = tally(textWords(text).keys);
  return queries.some((terms) => terms.every((t) => countOf(counts, t) > 0));
}

/** The lines `topics: [...]` and `keywords: [...]` that `addKeywords` writes, and a Daily log's head ends with. */
const KEYWORD_LINE = /^(topics|keywords): \[.*\]$/;
const HEAD = /^---\r?\n([\s\S]*?\r?\n)?---(\r?\n|$)/;

/** A head field holding an object or a list, such as a Daily log's whole log or a Minutes record: it repeats the body, so it is not searched. */
const RECORD_LINE = /^[\w-]+: [[{]/;

/**
 * A file's words by field, without its name: the keyword header (the topics and keywords lines of its head) and the body
 * (its text after the head, with the head's plain fields such as a title or an author). `lines` are the lines searched.
 */
export interface FileWords { head: Map<string, number>; body: Map<string, number>; length: number; lines: { line: number; text: string }[] }

export function fileWords(text: string): FileWords {
  const m = HEAD.exec(text), headLines = m ? m[0].split("\n").length - 1 : 0;
  const head: string[] = [], body: string[] = [], lines: FileWords["lines"] = [];
  text.split("\n").forEach((t, i) => {
    const inHead = i < headLines, trimmed = t.trim();
    if (inHead && (trimmed === "---" || (RECORD_LINE.test(trimmed) && !KEYWORD_LINE.test(trimmed)))) return;
    (inHead && KEYWORD_LINE.test(trimmed) ? head : body).push(t);
    lines.push({ line: i + 1, text: t });
  });
  const words = textWords(body.join("\n"));
  return { head: tally(textWords(head.join("\n")).keys), body: tally(words.keys), length: words.parts, lines };
}

/**
 * How often each matched term occurs in a file's name, keyword header and body, each match weighed by its strength, and the
 * strength of its best match (1 for its own form or a vocabulary counterpart, less through a prefix or a base word).
 */
export type TermCounts = Record<string, [name: number, head: number, body: number, strength: number]>;

const MAX_LINES = 3, MAX_LINE_CHARS = 200;

/**
 * The terms a file holds in its name, keyword header or body, how often each occurs per field, and up to three searched lines
 * holding the most of them (ties go to the earlier line). Null when it holds none. A file matched only by name may return no lines.
 */
export function matchWords(terms: string[], name: string, words: FileWords): { held: string[]; counts: TermCounts; length: number; lines: { line: number; text: string }[] } | null {
  const named = tally(textWords(name).keys), counts: TermCounts = {};
  for (const t of terms) {
    const fields = [matchOf(named, t), matchOf(words.head, t), matchOf(words.body, t)];
    if (fields.some((f) => f.n)) counts[t] = [fields[0]!.n, fields[1]!.n, fields[2]!.n, Math.max(...fields.map((f) => f.best))];
  }
  const held = Object.keys(counts);
  if (!held.length) return null;
  const lines = linesHolding(held, words.lines).slice(0, MAX_LINES).map((l) => ({ line: l.line, text: l.text.slice(0, MAX_LINE_CHARS) }));
  return { held, counts, length: words.length, lines };
}

/** The lines holding any of `terms`, with how many of them each holds: the most first, ties to the earlier line. */
export function linesHolding<L extends { line: number; text: string }>(terms: string[], lines: L[]): (L & { held: number })[] {
  return lines
    .map((l) => { const words = tally(textWords(l.text).keys); return { ...l, held: terms.filter((t) => countOf(words, t) > 0).length }; })
    .filter((l) => l.held > 0)
    .sort((a, b) => b.held - a.held || a.line - b.line);
}

/**
 * A name or keyword header word weighs this many body words; BM25's saturation and length constants for the body. A body shorter
 * than MIN_LENGTH words counts as that long, so a short file is not ranked up for being short and equal short files keep date order.
 */
const NAME_WEIGHT = 3, HEAD_WEIGHT = 3, K1 = 1.2, B = 0.75, MIN_LENGTH = 50;

/**
 * A file's score for the queries: BM25 over its name, keyword header and body, where each held term adds its inverse document
 * frequency (`idf`) scaled by how often it occurs, repetition and length counting in the body only; then scaled by how fully the
 * best-covered query is held, so a file holding every term of a query outranks one holding a few of the same weight. A term
 * held only through a weaker match covers its query by that match's strength.
 */
export function scoreOf(m: { held: string[]; counts: TermCounts; length: number }, queries: string[][], idf: (term: string) => number, averageLength: number): number {
  const norm = 1 - B + B * (Math.max(m.length, MIN_LENGTH) / Math.max(averageLength, MIN_LENGTH));
  const sum = m.held.reduce((total, t) => {
    const [name, head, body] = m.counts[t]!, tf = NAME_WEIGHT * name + HEAD_WEIGHT * head + body / norm;
    return total + idf(t) * (tf / (K1 + tf));
  }, 0);
  const strength = (t: string) => m.counts[t]?.[3] ?? 0;
  const coverage = Math.max(0, ...queries.map((q) => q.reduce((s, t) => s + strength(t), 0) / q.length));
  return sum * (0.5 + 0.5 * coverage);
}
