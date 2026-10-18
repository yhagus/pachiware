/**
 * How a search matches words (#209), shared by file search, Task search, the commit filter and the Work item title filter.
 * Words are matched whole after a light stem, so "normalisasi", "normalization" and "normalize" meet while "log" never
 * matches "blog". Indonesian and English filler words leave a query. No dictionary and no embedding model (ADR 0013).
 */

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

/**
 * The light stem of one lower-case word: an Indonesian particle (`-nya`, then `-lah`, `-kah`, `-pun`) comes off, then a
 * loanword ending, else an English plural and one more ending. Each cut leaves a minimum root, so short words stay whole.
 * Prefixes (`me-`, `di-`, `ber-`) are never stripped. A word with a digit or an inner mark is left as it is.
 */
export function stem(word: string): string {
  if (word.length < 4 || !LETTERS.test(word)) return word;
  let w = cut(word, "nya", 4) ?? word;
  for (const particle of ["lah", "kah", "pun"]) { const c = cut(w, particle, 5); if (c) { w = c; break; } }
  for (const [end, root] of LOANWORD) { const c = cut(w, end, root); if (c) return c; }
  if (/(?:sh|ch|x|z|ss)es$/.test(w) && w.length > 5) w = w.slice(0, -2);
  else if (/[^su]s$/.test(w) && w.length > 4 && !/is$/.test(w)) w = w.slice(0, -1);
  for (const [end, root] of ENDINGS) { const c = cut(w, end, root); if (c) return c; }
  return w;
}

/** The stems of a text's words: each word, and, for a word with inner marks, its parts too. `parts` counts the plain words. */
function textWords(text: string): { stems: string[]; parts: number } {
  const stems: string[] = [];
  let parts = 0;
  for (const word of text.toLowerCase().match(WORD) ?? []) {
    const pieces = word.match(PART) ?? [];
    if (pieces.length > 1) stems.push(word);
    for (const p of pieces) { stems.push(stem(p)); parts++; }
  }
  return { stems, parts };
}

/**
 * The terms of one query: its words' stems, filler words left out unless nothing else is left. A word with inner marks is
 * split into its parts, unless it holds a digit ("inv-00042", "2.4"), which is matched whole.
 */
export function queryTerms(query: string): string[] {
  const words = (query.toLowerCase().match(WORD) ?? []).flatMap((w) => (/\d/.test(w) ? [w] : w.match(PART) ?? []));
  const topical = words.filter((w) => !FILLER.has(w));
  return [...new Set((topical.length ? topical : words).map(stem))];
}

/** The terms of each query, queries without any dropped. */
export const queriesTerms = (queries: string[]): string[][] => queries.map(queryTerms).filter((q) => q.length);

/** `query` and each of `queries` that is text, in that order: the wordings a tool was asked to search. */
export const wordingsOf = (query: unknown, queries: unknown): string[] => [query, ...(Array.isArray(queries) ? queries : [])].filter((q): q is string => typeof q === "string");

/**
 * A query term matches a text word with the same stem, or a plain word (letters only) its stem starts, when the term has at least
 * 4 letters. A word with inner marks ("pricing.md", "inv-00042") matches only whole, its parts already being words of their own.
 */
const prefixes = (term: string, word: string) => term.length >= 4 && word !== term && word.startsWith(term) && LETTERS.test(word);
export const termMatches = (term: string, word: string) => word === term || prefixes(term, word);

/** How many words of `counts` a term matches. */
function countOf(counts: Map<string, number>, term: string): number {
  let n = counts.get(term) ?? 0;
  if (term.length >= 4) for (const [word, c] of counts) if (prefixes(term, word)) n += c;
  return n;
}

const tally = (stems: string[]) => {
  const counts = new Map<string, number>();
  for (const s of stems) counts.set(s, (counts.get(s) ?? 0) + 1);
  return counts;
};

/** Whether a text holds every term of at least one query: how Tasks, commits and Work item titles match. */
export function holdsQuery(queries: string[][], text: string): boolean {
  const counts = tally(textWords(text).stems);
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
  return { head: tally(textWords(head.join("\n")).stems), body: tally(words.stems), length: words.parts, lines };
}

/** How often each matched term occurs in a file's name, keyword header and body. */
export type TermCounts = Record<string, [name: number, head: number, body: number]>;

const MAX_LINES = 3, MAX_LINE_CHARS = 200;

/**
 * The terms a file holds in its name, keyword header or body, how often each occurs per field, and up to three searched lines
 * holding the most of them (ties go to the earlier line). Null when it holds none. A file matched only by name may return no lines.
 */
export function matchWords(terms: string[], name: string, words: FileWords): { held: string[]; counts: TermCounts; length: number; lines: { line: number; text: string }[] } | null {
  const named = tally(textWords(name).stems), counts: TermCounts = {};
  for (const t of terms) {
    const c: [number, number, number] = [countOf(named, t), countOf(words.head, t), countOf(words.body, t)];
    if (c[0] || c[1] || c[2]) counts[t] = c;
  }
  const held = Object.keys(counts);
  if (!held.length) return null;
  const lines = words.lines
    .map((l) => { const stems = textWords(l.text).stems; return { l, held: held.filter((t) => stems.some((s) => termMatches(t, s))).length }; })
    .filter((x) => x.held > 0)
    .sort((a, b) => b.held - a.held || a.l.line - b.l.line)
    .slice(0, MAX_LINES)
    .map(({ l }) => ({ line: l.line, text: l.text.slice(0, MAX_LINE_CHARS) }));
  return { held, counts, length: words.length, lines };
}

/**
 * A name or keyword header word weighs this many body words; BM25's saturation and length constants for the body. A body shorter
 * than MIN_LENGTH words counts as that long, so a short file is not ranked up for being short and equal short files keep date order.
 */
const NAME_WEIGHT = 3, HEAD_WEIGHT = 3, K1 = 1.2, B = 0.75, MIN_LENGTH = 50;

/**
 * A file's score for the queries: BM25 over its name, keyword header and body, where each held term adds its inverse document
 * frequency (`idf`) scaled by how often it occurs, repetition and length counting in the body only; then scaled by how fully the
 * best-covered query is held, so a file holding every term of a query outranks one holding a few of the same weight.
 */
export function scoreOf(m: { held: string[]; counts: TermCounts; length: number }, queries: string[][], idf: (term: string) => number, averageLength: number): number {
  const norm = 1 - B + B * (Math.max(m.length, MIN_LENGTH) / Math.max(averageLength, MIN_LENGTH));
  const sum = m.held.reduce((total, t) => {
    const [name, head, body] = m.counts[t]!, tf = NAME_WEIGHT * name + HEAD_WEIGHT * head + body / norm;
    return total + idf(t) * (tf / (K1 + tf));
  }, 0);
  const held = new Set(m.held);
  const coverage = Math.max(0, ...queries.map((q) => q.filter((t) => held.has(t)).length / q.length));
  return sum * (0.5 + 0.5 * coverage);
}
