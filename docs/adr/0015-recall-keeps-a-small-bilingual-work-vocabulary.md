# Recall keeps a small hand-written bilingual work vocabulary

People in a Guild ask in Indonesian about Kept material written in English, and the other way round. Some common work words share no stem across the two languages ("rilis" and "release", "rapat" and "meeting", "anggaran" and "budget"), so the shared word matching (`packages/skills/src/workspace/terms.ts`) could not make them meet. We keep a hand-written list of about 140 Indonesian–English groups of such words (`packages/skills/src/workspace/vocabulary.ts`). A search term also matches the words of its group, at full weight, and a file holding a counterpart counts as holding the term. The list grows only through the retrieval benchmark: a new pair must not lose a hit there.

The same change adds two rules that need no word list. An Indonesian word with a prefix (`di-`, `ter-`, `ber-`, `meng-`, `pe-` and the rest) gets a second, half-weight reading with the prefix off, so "diimplementasikan" meets "implementasi". A base word meeting a derived one ("normal" against "normalisasi", "real" against "realisasi") weighs a quarter, so a shared stem does not outrank the topic; a verb form ("implemented", "jalankan") is never treated as a base word for this.

## Considered options

- **Ask the model to expand the question into Indonesian and English wordings, and nothing else.** Rejected as the only measure: the tools already ask for it, but weaker models a tenant brings often send one wording, and the benchmark showed the pairs missing.
- **An embedding model.** Rejected by ADR 0013.
- **A dictionary stemmer such as Sastrawi.** Rejected: a large dependency for a light stem that the benchmark shows is enough; prefix removal without sound restoration ("memakai" stays "akai") covers the common cases.

## Consequences

- The vocabulary is code, not tenant data: a tenant cannot add words. A word with two common work meanings is left out rather than paired.
- A word that only looks prefixed in English ("direct", "select") gets a stray second reading; it matches only whole and weighs half, so the harm is small.
