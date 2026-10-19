// A module of its own, importing nothing, so the bot's fixed text (language.ts) can name the types without an import cycle.

/** The extensions a place files as Documents. */
export const DOCUMENT_TYPES = ["pdf", "docx", "xlsx", "html", "htm", "csv", "md", "txt"] as const;

/** Document types as people and the model name them: upper case, each once, an .htm page named HTML like an .html one. */
export const typeNames = (types: readonly string[]) => [...new Set(types.map((type) => (type === "htm" ? "html" : type).toUpperCase()))];
