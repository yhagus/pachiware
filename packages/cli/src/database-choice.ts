// The database question `pachiware init` asks. Kept apart from the command so tests can answer it.
// The URL prefixes follow detectEngine in the database package, which the agent checks at start.

export type Engine = "sqlite" | "postgres" | "mongodb";
export type DockerEngine = Exclude<Engine, "sqlite">;

export const ENGINE_NAMES: Record<Engine, string> = { sqlite: "SQLite", postgres: "PostgreSQL", mongodb: "MongoDB" };

/** Asks one question and returns the answer, or `fallback` when nothing is typed or no one can answer. */
export type Ask = (question: string, fallback: string) => Promise<string>;

export interface DatabaseChoice {
  engine: Engine;
  url: string;
  label: string;
  /** Docker runs this database, so setup starts its container first. */
  docker: boolean;
}

export interface ChoiceOptions {
  database?: string;
  postgresUrl?: string;
  mongodbUrl?: string;
  dockerEngine?: string;
  currentUrl?: string;
  /** The URL of each engine's compose service, as this installation's .env configures it. */
  dockerUrls: Record<DockerEngine, string>;
}

export const DATABASE_QUESTION = "Database: 1) SQLite  2) PostgreSQL  3) MongoDB  4) Docker";
export const DOCKER_QUESTION = "Docker runs: 1) PostgreSQL 18  2) MongoDB 8.0";
export const SQLITE_URL = "sqlite:./data/pachiware.db";
const POSTGRES_EXAMPLE = "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent";
const MONGODB_EXAMPLE = "mongodb://localhost:27017/pachiware?replicaSet=rs0";

/** The engine a database URL names. Anything that is not PostgreSQL or MongoDB is left to the agent's own check. */
export function engineOfUrl(url = ""): Engine {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) return "postgres";
  if (lower.startsWith("mongodb://") || lower.startsWith("mongodb+srv://")) return "mongodb";
  return "sqlite";
}

function pick(answer: string, choices: Record<string, string[]>, problem: string): string {
  const normalized = answer.trim().toLowerCase();
  const found = Object.entries(choices).find(([, names]) => names.includes(normalized));
  if (!found) throw new Error(problem);
  return found[0];
}

function postgresUrl(url: string): string {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error("Provide a valid PostgreSQL URL with a database name.");
  if (parsed.hash) throw new Error("PostgreSQL URL credentials must be URL-encoded (for example, # becomes %23).");
  return parsed.toString();
}

// Not parsed with URL: a replica set URL lists several hosts, which URL rejects.
function mongodbUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^mongodb(\+srv)?:\/\/([^@/?]*@)?[^@/?]+/i.test(trimmed)) throw new Error("Provide a MongoDB URL that starts with mongodb:// or mongodb+srv:// and names a host.");
  return trimmed;
}

export async function chooseDatabase(options: ChoiceOptions, ask: Ask): Promise<DatabaseChoice> {
  const current = engineOfUrl(options.currentUrl);
  const answer = options.database
    || (options.postgresUrl ? "postgres" : "")
    || (options.mongodbUrl ? "mongodb" : "")
    || await ask(DATABASE_QUESTION, { sqlite: "1", postgres: "2", mongodb: "3" }[current]);
  const choice = pick(answer, {
    sqlite: ["1", "sqlite"],
    postgres: ["2", "postgres", "postgresql"],
    mongodb: ["3", "mongodb", "mongo"],
    docker: ["4", "docker"],
  }, "Choose sqlite, postgres, mongodb or docker.");

  if (choice === "postgres") {
    const url = options.postgresUrl || await ask("PostgreSQL connection URL:", current === "postgres" ? options.currentUrl! : POSTGRES_EXAMPLE);
    return { engine: "postgres", url: postgresUrl(url), label: "PostgreSQL (external)", docker: false };
  }
  if (choice === "mongodb") {
    const url = options.mongodbUrl || await ask("MongoDB connection URL (a replica set or Atlas):", current === "mongodb" ? options.currentUrl! : MONGODB_EXAMPLE);
    return { engine: "mongodb", url: mongodbUrl(url), label: "MongoDB (external)", docker: false };
  }
  if (choice === "docker") {
    const engine = pick(options.dockerEngine || await ask(DOCKER_QUESTION, current === "mongodb" ? "2" : "1"), {
      postgres: ["1", "postgres", "postgresql"],
      mongodb: ["2", "mongodb", "mongo"],
    }, "Docker runs postgres or mongodb.") as DockerEngine;
    const label = engine === "mongodb" ? "MongoDB 8.0 replica set (bundled Docker)" : "PostgreSQL 18 (bundled Docker)";
    return { engine, url: options.dockerUrls[engine], label, docker: true };
  }
  return { engine: "sqlite", url: SQLITE_URL, label: "SQLite (zero-config)", docker: false };
}

/** The compose command that starts the chosen engine's container and Redis, and waits until they are healthy. */
export function composeUpArgs(engine: Engine): string[] {
  if (engine === "mongodb") return ["compose", "--profile", "mongo", "up", "-d", "--wait", "--wait-timeout", "90", "mongo", "redis"];
  return ["compose", "up", "-d", "--wait", "--wait-timeout", "60"];
}

/** Refuses a choice of another engine than the one this installation's records are in (ADR 0010). */
export function assertSameEngine(recorded: string | undefined, chosen: Engine): void {
  if (!recorded || recorded === chosen) return;
  const name = (engine: string) => ENGINE_NAMES[engine as Engine] ?? engine;
  throw new Error(
    `This installation keeps its records in ${name(recorded)}, but you chose ${name(chosen)}. ` +
      `The database engine cannot change after setup, so nothing was changed. Choose ${name(recorded)} again, ` +
      `or see "Start Over on Another Database Engine" in the README.`,
  );
}
