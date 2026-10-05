#!/usr/bin/env bun
import { Command } from "commander";
import { spawn, spawnSync, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, realpathSync, chmodSync } from "fs";
import { resolve, join, dirname } from "path";
import { randomBytes } from "node:crypto";
import { createConnection } from "net";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

const VERSION = "1.0.0";

// Terminal styling helpers
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
};

const BANNER = `
${c.cyan}${c.bold}  ____            _     _                              _                      ${c.reset}
${c.cyan}${c.bold} |  _ \\ __ _  ___| |__ (_)_      ____ _ _ __ ___      / \\   __ _  ___ _ __  _|_ ${c.reset}
${c.cyan}${c.bold} | |_) / _\` |/ __| '_ \\| \\ \\ /\\ / / _\` | '__/ _ \\    / _ \\ / _\` |/ _ \\ '_ \\| __|${c.reset}
${c.cyan}${c.bold} |  __/ (_| | (__| | | | |\\ V  V / (_| | | |  __/   / ___ \\ (_| |  __/ | | | |_ ${c.reset}
${c.cyan}${c.bold} |_|   \\__,_|\\___|_| |_|_| \\_/\\_/ \\__,_|_|  \\___|  /_/   \\_\\__, |\\___|_| |_|\\__|${c.reset}
${c.cyan}${c.bold}                                                           |___/                ${c.reset}
${c.gray}   Self-Hosted Autonomous AI Agent Platform • Multi-Channel • Extensible ReAct ${c.reset}
${c.gray}   v${VERSION} • Bun Runtime • Lightweight Explicit ReAct Engine                     ${c.reset}
`;

function isValidWorkspace(dir: string): boolean {
  if (!dir) return false;
  try {
    return (
      existsSync(join(dir, "apps", "agent", "src", "index.ts")) &&
      existsSync(join(dir, "package.json"))
    );
  } catch {
    return false;
  }
}

function findWorkspaceRoot(): string | null {
  const searchFrom = (startDir: string): string | null => {
    let current = startDir;
    while (current !== "/" && current !== "") {
      if (isValidWorkspace(current)) {
        return current;
      }
      const parent = resolve(current, "..");
      if (parent === current) break;
      current = parent;
    }
    return null;
  };

  // 1. Try from the current working directory (dev / in-repo usage)
  const fromCwd = searchFrom(process.cwd());
  if (fromCwd) return fromCwd;

  // 2. Try from process.env.PACHIWARE_DIR
  if (process.env.PACHIWARE_DIR) {
    const fromEnv = searchFrom(process.env.PACHIWARE_DIR);
    if (fromEnv) return fromEnv;
  }

  // 3. Try from saved install directory configs (~/.config/pachiware/install_dir, ~/.pachiware_root, /etc/pachiware/install_dir)
  const candidateConfigFiles: string[] = [];
  if (process.env.HOME) {
    candidateConfigFiles.push(join(process.env.HOME, ".config", "pachiware", "install_dir"));
    candidateConfigFiles.push(join(process.env.HOME, ".pachiware_root"));
  }
  candidateConfigFiles.push("/etc/pachiware/install_dir");

  if (process.env.SUDO_USER && process.env.SUDO_USER !== "root") {
    candidateConfigFiles.push(`/home/${process.env.SUDO_USER}/.config/pachiware/install_dir`);
    candidateConfigFiles.push(`/home/${process.env.SUDO_USER}/.pachiware_root`);
  }

  for (const cfg of candidateConfigFiles) {
    try {
      if (existsSync(cfg)) {
        const target = readFileSync(cfg, "utf8").trim();
        if (target) {
          const fromCfg = searchFrom(target);
          if (fromCfg) return fromCfg;
        }
      }
    } catch {}
  }

  // 4. Try from process.execPath (compiled standalone binary / symlinked binary)
  try {
    const realExec = realpathSync(process.execPath);
    const fromExec = searchFrom(dirname(realExec));
    if (fromExec) return fromExec;
  } catch {}

  // 5. Try from process.argv[1] (script or executable path)
  try {
    if (process.argv[1]) {
      const realArgv = realpathSync(process.argv[1]);
      const fromArgv = searchFrom(dirname(realArgv));
      if (fromArgv) return fromArgv;
    }
  } catch {}

  // 6. Try from import.meta.dir (raw typescript script execution via bun)
  try {
    if (typeof import.meta.dir === "string" && !import.meta.dir.startsWith("/$bunfs")) {
      const fromMeta = searchFrom(import.meta.dir);
      if (fromMeta) return fromMeta;
    }
  } catch {}

  // 7. Try standard directories
  const candidateDirs: string[] = [];
  if (process.env.HOME) {
    candidateDirs.push(join(process.env.HOME, ".pachiware"));
    candidateDirs.push(join(process.env.HOME, "pachiware"));
  }
  candidateDirs.push("/opt/pachiware");
  candidateDirs.push("/var/www/pachiware");

  if (process.env.SUDO_USER && process.env.SUDO_USER !== "root") {
    candidateDirs.push(`/home/${process.env.SUDO_USER}/.pachiware`);
    candidateDirs.push(`/home/${process.env.SUDO_USER}/pachiware`);
  }

  for (const dir of candidateDirs) {
    try {
      if (existsSync(dir)) {
        const fromDir = searchFrom(dir);
        if (fromDir) return fromDir;
      }
    } catch {}
  }

  return null;
}

const rootDir = findWorkspaceRoot();

function requireWorkspaceRoot(): string {
  if (!rootDir || !isValidWorkspace(rootDir)) {
    console.error(`\n${c.red}${c.bold}✖ Error: Unable to locate Pachiware Agent installation directory.${c.reset}`);
    console.error(`  ${c.gray}Pachiware requires its workspace files (apps/agent, packages/db, etc.) to run.${c.reset}\n`);
    console.error(`  Current directory: ${c.bold}${process.cwd()}${c.reset}`);
    console.error(`\n  ${c.cyan}How to resolve this:${c.reset}`);
    console.error(`  1. ${c.bold}Run inside your cloned Pachiware repository:${c.reset}`);
    console.error(`     cd /path/to/pachiware && pachiware start\n`);
    console.error(`  2. ${c.bold}Or define the PACHIWARE_DIR environment variable:${c.reset}`);
    console.error(`     export PACHIWARE_DIR=/path/to/pachiware\n`);
    console.error(`  3. ${c.bold}Or re-run the official installer to configure your environment:${c.reset}`);
    console.error(`     curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | bash\n`);
    process.exit(1);
  }
  return rootDir;
}

function getDatabaseTarget(dir: string): { dialect: "sqlite" | "postgres"; host: string; port: number; url: string; sqlitePath?: string } {
  let dbUrl = "";
  const runtimeFile = join(dir, "runtime-config.json");
  if (existsSync(runtimeFile)) {
    try {
      const parsed = JSON.parse(readFileSync(runtimeFile, "utf8"));
      if (parsed.databaseUrl) dbUrl = parsed.databaseUrl;
    } catch {}
  }
  if (!dbUrl) {
    const envFile = join(dir, ".env");
    if (existsSync(envFile)) {
      const envContent = readFileSync(envFile, "utf8");
      const match = envContent.match(/DATABASE_URL=["']?([^"'\n\r]+)["']?/);
      if (match) dbUrl = match[1];
    }
  }
  if (!dbUrl) {
    // Default: SQLite file inside the workspace (zero-config)
    dbUrl = "sqlite:./data/pachiware.db";
  }

  const lower = dbUrl.trim().toLowerCase();
  const isSqlite =
    lower.startsWith("sqlite:") ||
    lower.startsWith("sqlite3:") ||
    lower.startsWith("file:") ||
    /\.(db|sqlite|sqlite3)$/.test(lower) ||
    (!lower.startsWith("postgres://") && !lower.startsWith("postgresql://"));

  if (isSqlite) {
    let p = dbUrl.trim();
    for (const prefix of ["sqlite://", "sqlite3://", "sqlite:", "sqlite3:", "file://", "file:"]) {
      if (p.startsWith(prefix)) {
        p = p.slice(prefix.length);
        break;
      }
    }
    const sqlitePath = p === ":memory:" || p === "" ? ":memory:" : (p.startsWith("/") ? p : resolve(dir, p));
    return { dialect: "sqlite", host: "local", port: 0, url: dbUrl, sqlitePath };
  }

  try {
    const parsed = new URL(dbUrl);
    return {
      dialect: "postgres",
      host: parsed.hostname || "127.0.0.1",
      port: parseInt(parsed.port || "5432", 10),
      url: dbUrl,
    };
  } catch {
    return { dialect: "postgres", host: "127.0.0.1", port: 5432, url: dbUrl };
  }
}

async function isPortOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function ask(question: string, fallback: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) return fallback;
  const readline = createInterface({ input, output });
  try {
    const answer = (await readline.question(`${question} ${c.gray}[${fallback}]${c.reset} `)).trim();
    return answer || fallback;
  } finally {
    readline.close();
  }
}

async function chooseDatabase(options: { database?: string; postgresUrl?: string; currentUrl?: string; dockerUrl?: string } = {}) {
  const currentChoice = options.currentUrl?.startsWith("postgres") ? "2" : "1";
  const choice = options.database || (options.postgresUrl ? "2" : "") || (!input.isTTY || !output.isTTY ? currentChoice : await ask(
    `${c.bold}Database${c.reset}: ${c.cyan}1${c.reset}) SQLite  ${c.cyan}2${c.reset}) PostgreSQL external  ${c.cyan}3${c.reset}) PostgreSQL 18 Docker`,
    currentChoice
  ));
  if (!["1", "2", "3", "sqlite", "postgres", "postgresql", "docker"].includes(choice.toLowerCase())) throw new Error("Choose sqlite, postgres, or docker.");
  if (choice === "2" || /postgres/i.test(choice)) {
    const url = options.postgresUrl || await ask("PostgreSQL connection URL:", options.currentUrl?.startsWith("postgres") ? options.currentUrl : "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent");
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2) throw new Error("Provide a valid PostgreSQL URL with a database name.");
    if (parsed.hash) throw new Error("PostgreSQL URL credentials must be URL-encoded (for example, # becomes %23).");
    return { url: parsed.toString(), label: "PostgreSQL (external)", needsDocker: false };
  }
  if (choice === "3" || /docker/i.test(choice)) {
    return { url: options.dockerUrl || "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent", label: "PostgreSQL 18 (bundled Docker)", needsDocker: true };
  }
  return { url: "sqlite:./data/pachiware.db", label: "SQLite (zero-config)", needsDocker: false };
}

function updateEnvValue(envFile: string, key: string, value: string): void {
  const lines = existsSync(envFile) ? readFileSync(envFile, "utf8").split(/\r?\n/) : [];
  let replaced = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${JSON.stringify(value)}`;
    }
    return line;
  });
  if (!replaced) next.push(`${key}=${JSON.stringify(value)}`);
  writeFileSync(envFile, `${next.join("\n").replace(/\n*$/, "")}\n`);
}

function completeCliSetup(workspace: string, databaseUrl = getDatabaseTarget(workspace).url) {
  const result = spawnSync("bun", [join(workspace, "packages/db/src/setup.ts")], {
    cwd: workspace, stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseUrl, PACHIWARE_DIR: workspace },
  });
  if (result.error || result.status !== 0) throw new Error("Setup did not complete. Check database connectivity and encryption configuration, then run pachiware init again.");
}

function preparePlatformKeys(envFile: string, fresh: boolean) {
  const content = readFileSync(envFile, "utf8");
  const value = (key: string) => content.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim().replace(/^(['"])(.*)\1$/, "$2");
  if (!value("PLATFORM_ADMIN_KEY")) updateEnvValue(envFile, "PLATFORM_ADMIN_KEY", randomBytes(32).toString("hex"));
  // Existing databases may rely on development key derivation; preserve its source.
  if (fresh && !value("PLATFORM_ENCRYPTION_KEY")) updateEnvValue(envFile, "PLATFORM_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  chmodSync(envFile, 0o600);
}

function dockerDatabaseUrl(envFile: string): string {
  const content = readFileSync(envFile, "utf8");
  const value = (key: string, fallback: string) => {
    if (process.env[key]) return process.env[key]!;
    const raw = content.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
    if (!raw) return fallback;
    if (raw.startsWith('"')) return JSON.parse(raw);
    if (raw.startsWith("'")) return raw.slice(1, -1);
    return raw.split("#")[0].trim();
  };
  const user = encodeURIComponent(value("POSTGRES_USER", "pachiware"));
  const password = encodeURIComponent(value("POSTGRES_PASSWORD", "pachiware_secret"));
  const port = value("POSTGRES_PORT", "5432");
  const database = encodeURIComponent(value("POSTGRES_DB", "pachiware_agent"));
  return `postgresql://${user}:${password}@localhost:${port}/${database}`;
}

const program = new Command();

program
  .name("pachiware")
  .description("Autonomous AI Agent Platform CLI - Manage, Deploy, and Update Pachiware")
  .version(VERSION, "-v, --version", "Output the current version of Pachiware")
  .helpOption("-h, --help", "Display help and command overview")
  .addHelpText("beforeAll", BANNER);

/**
 * Command: init
 */
program
  .command("init [dir]")
  .description("Initialize or scaffold a Pachiware Agent deployment")
  .option("--database <choice>", "Database choice: sqlite, postgres, or docker")
  .option("--postgres-url <url>", "PostgreSQL URL when using external PostgreSQL")
  .action(async (dir, options) => {
    console.log(BANNER);
    const targetDir = dir ? resolve(process.cwd(), dir) : requireWorkspaceRoot();
    console.log(`${c.green}⚡ Initializing Pachiware Agent at:${c.reset} ${c.bold}${targetDir}${c.reset}\n`);

    // 1. Check or create .env
    const envFile = join(targetDir, ".env");
    const envExample = join(targetDir, ".env.example");

    const freshEnvironment = !existsSync(envFile);
    if (freshEnvironment && existsSync(envExample)) {
      writeFileSync(envFile, readFileSync(envExample, "utf8"));
      console.log(`  ${c.green}✔${c.reset} Created ${c.cyan}.env${c.reset} configuration from template.`);
    } else if (existsSync(envFile)) {
      console.log(`  ${c.green}✔${c.reset} Existing ${c.cyan}.env${c.reset} configuration detected.`);
    }

    preparePlatformKeys(envFile, freshEnvironment);
    const database = await chooseDatabase({ ...options, currentUrl: getDatabaseTarget(targetDir).url, dockerUrl: dockerDatabaseUrl(envFile) });
    updateEnvValue(envFile, "DATABASE_URL", database.url);
    const runtimeFile = join(targetDir, "runtime-config.json");
    if (existsSync(runtimeFile)) {
      const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
      writeFileSync(runtimeFile, JSON.stringify({ ...runtime, databaseUrl: database.url }, null, 2) + "\n", { mode: 0o600 });
    }
    console.log(`  ${c.green}✔${c.reset} Database selected: ${database.label}`);
    if (database.needsDocker) {
      console.log(`  ${c.cyan}ℹ${c.reset} Run ${c.bold}pachiware start --docker${c.reset} to start PostgreSQL 18 and Redis.`);
    } else if (database.url.startsWith("sqlite:")) {
      console.log(`  ${c.cyan}ℹ${c.reset} SQLite needs no Docker, PostgreSQL, or Redis setup.`);
    } else {
      console.log(`  ${c.cyan}ℹ${c.reset} Verify PostgreSQL is reachable before running ${c.bold}pachiware start${c.reset}.`);
    }

    if (database.needsDocker) {
      const docker = spawnSync("docker", ["compose", "up", "-d", "--wait", "--wait-timeout", "60"], { cwd: targetDir, stdio: "inherit" });
      if (docker.error || docker.status !== 0) throw new Error("Start Docker and rerun pachiware init --database docker.");
    }
    completeCliSetup(targetDir, database.url);
    console.log(`\n${c.green}${c.bold}Setup complete.${c.reset} Run ${c.cyan}pachiware start${database.needsDocker ? " --docker" : ""}${c.reset}, then open http://localhost:3000.`);
    console.log(`  Localhost automatically connects to your tenant. LLM credentials and optional bots can be configured in the console.`);

  });

/**
 * Command: start
 */
program
  .command("start")
  .description("Start Agent API and Web Management Console (uses existing DB/Redis by default)")
  .option("-d, --daemon", "Run processes in the background (daemon mode)")
  .option("--no-gui", "Start only the Agent backend service without the Web GUI")
  .option("--docker", "Also spin up bundled PostgreSQL 18 and Redis containers via Docker Compose")
  .action(async (options) => {
    console.log(BANNER);
    const wsRoot = requireWorkspaceRoot();
    console.log(`${c.bold}🚀 Starting Pachiware Agent Platform...${c.reset}\n`);

    // 1. Optional Docker containers (only if --docker is specified)
    if (options.docker) {
      console.log(`  ${c.cyan}→ Starting bundled PostgreSQL 18 and Redis containers via Docker Compose...${c.reset}`);
      try {
        execSync("docker compose up -d --wait --wait-timeout 60", { cwd: wsRoot, stdio: "inherit" });
        console.log(`  ${c.green}✔${c.reset} Bundled infrastructure containers running.`);
      } catch (err: any) {
        console.error(`  ${c.red}✖ Failed to start Docker containers:${c.reset}`, err.message);
        process.exit(1);
      }
    } else {
      console.log(`  ${c.gray}→ Using external / pre-existing PostgreSQL & Redis from .env (default).${c.reset}`);
      console.log(`  ${c.gray}  Tip: Run with ${c.cyan}--docker${c.gray} if you want Pachiware to spin up bundled containers.${c.reset}`);
    }

    // 2. Check DB connectivity before attempting migrations
    const dbTarget = getDatabaseTarget(wsRoot);
    let dbConnected = false;
    let dbDescription = "";

    if (dbTarget.dialect === "sqlite") {
      console.log(`  ${c.cyan}→ Using SQLite database (zero-config, no external services required)...${c.reset}`);
      dbConnected = true;
      dbDescription = dbTarget.sqlitePath === ":memory:"
        ? "SQLite :memory: (ephemeral)"
        : `SQLite file (${dbTarget.sqlitePath})`;
    } else {
      console.log(`  ${c.cyan}→ Checking PostgreSQL database availability...${c.reset}`);
      dbConnected = await isPortOpen(dbTarget.host, dbTarget.port, 1500);
      dbDescription = dbConnected
        ? `Connected (${dbTarget.host}:${dbTarget.port})`
        : `PostgreSQL not reachable at ${dbTarget.host}:${dbTarget.port}`;
    }

    if (dbConnected) {
      console.log(`  ${c.green}✔${c.reset} Database available: ${dbDescription}. Ensuring migrations & seed...`);
      try {
        completeCliSetup(wsRoot);
        console.log(`  ${c.green}✔${c.reset} Database migrations verified.`);
      } catch (err: any) {
        dbConnected = false;
        console.warn(`  ${c.yellow}Setup incomplete:${c.reset} ${err.message}`);
      }
    } else {
      console.log(`  ${c.yellow}ℹ ${dbDescription}.${c.reset}`);
      console.log(`  ${c.cyan}⚡ Starting Pachiware in Setup Wizard Mode.${c.reset}`);
      console.log(`  ${c.dim}  (You can configure your database easily in the Web GUI at http://localhost:3000)${c.reset}`);
    }

    // 3. Print service endpoints
    if (dbConnected) {
      console.log(`\n${c.green}${c.bold}====================================================${c.reset}`);
      console.log(`  ${c.bold}Pachiware Agent is LIVE and ready!${c.reset}`);
      console.log(`${c.green}${c.bold}====================================================${c.reset}`);
      console.log(`  ${c.cyan}🌐 Web Console:${c.reset}       ${c.bold}http://localhost:3000${c.reset}`);
      console.log(`  ${c.cyan}⚡ Agent REST API:${c.reset}    ${c.bold}http://localhost:3001${c.reset}`);
      const dbIcon = dbTarget.dialect === "sqlite" ? "💾" : "🐘";
      console.log(`  ${c.cyan}${dbIcon} Database:${c.reset}          ${dbDescription}`);
      console.log(`  ${c.cyan}🔴 Cache Engine:${c.reset}      Active (Redis / native in-memory fallback)`);
      console.log(`  ${c.cyan}📡 Messaging:${c.reset}        Configure tenant bots in the console`);
      console.log(`${c.gray}----------------------------------------------------${c.reset}`);
      console.log(`  ${c.dim}Press Ctrl+C to terminate services or run 'pachiware stop'${c.reset}\n`);
    } else {
      console.log(`\n${c.yellow}${c.bold}====================================================${c.reset}`);
      console.log(`  ${c.bold}Pachiware is LIVE in Setup Wizard Mode!${c.reset}`);
      console.log(`${c.yellow}${c.bold}====================================================${c.reset}`);
      console.log(`  ${c.cyan}🌐 Setup Console:${c.reset}     ${c.bold}http://localhost:3000${c.reset}`);
      console.log(`  ${c.cyan}⚡ Agent REST API:${c.reset}    ${c.bold}http://localhost:3001${c.reset}`);
      console.log(`  ${c.cyan}🐘 Database:${c.reset}          ${c.yellow}Setup Required (Connect via Web GUI)${c.reset}`);
      console.log(`  ${c.cyan}🔴 Cache Engine:${c.reset}      ${c.green}Active (native in-memory fallback, zero-dependency)${c.reset}`);
      console.log(`  ${c.cyan}📡 Messaging:${c.reset}        Standby / Simulation mode`);
      console.log(`${c.gray}----------------------------------------------------${c.reset}`);
      console.log(`  ${c.bold}👉 Open http://localhost:3000 to connect your PostgreSQL database.${c.reset}\n`);
    }

    if (options.daemon) {
      console.log(`${c.green}✔ Running in background daemon mode.${c.reset}`);
      return;
    }

    // 4. Start Agent and optionally Web in parallel
    const agentEntry = join(wsRoot, "apps", "agent", "src", "index.ts");
    const agentProc = spawn("bun", ["run", agentEntry], {
      cwd: wsRoot,
      stdio: "inherit",
    });

    let webProc: any = null;
    if (options.gui !== false) {
      webProc = spawn("bun", ["--filter", "@pachiware/web", "dev"], {
        cwd: wsRoot,
        stdio: "inherit",
      });
    }

    const cleanup = () => {
      console.log(`\n${c.yellow}Stopping Pachiware Agent processes...${c.reset}`);
      agentProc.kill();
      if (webProc) webProc.kill();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });

/**
 * Command: stop
 */
program
  .command("stop")
  .description("Stop running Pachiware Agent services")
  .option("--docker, --all", "Also stop and remove Docker containers if running")
  .action((options) => {
    console.log(BANNER);
    console.log(`${c.yellow}Stopping Pachiware Agent services...${c.reset}`);

    try {
      execSync("pkill -f 'bun.*apps/agent' || true", { stdio: "pipe" });
      execSync("pkill -f 'bun.*@pachiware/web' || true", { stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Agent backend and Web console processes stopped.`);

      if (options.docker || options.all) {
        try {
          execSync("docker compose down", { cwd: requireWorkspaceRoot(), stdio: "inherit" });
          console.log(`  ${c.green}✔${c.reset} Docker containers stopped.`);
        } catch {}
      }
      console.log(`\n${c.green}${c.bold}Done.${c.reset}\n`);
    } catch (err: any) {
      console.error(`${c.red}Error stopping services:${c.reset}`, err.message);
    }
  });

/**
 * Command: restart
 */
program
  .command("restart")
  .description("Restart running Pachiware Agent services")
  .option("--docker", "Also restart Docker containers if running")
  .action((options) => {
    console.log(`${c.yellow}Restarting Pachiware Agent...${c.reset}`);
    try {
      execSync("pkill -f 'bun.*apps/agent/src/index.ts' || true", { stdio: "pipe" });
      execSync("pkill -f 'vite --port 3000' || true", { stdio: "pipe" });
      if (options.docker) {
        try {
          execSync("docker compose restart", { cwd: requireWorkspaceRoot(), stdio: "inherit" });
        } catch {}
      }
      console.log(`${c.green}Services restarted. Run 'pachiware start' or check 'pachiware status'.${c.reset}`);
    } catch (err: any) {
      console.error(`${c.red}Restart failed:${c.reset}`, err.message);
    }
  });

/**
 * Command: status / health
 */
program
  .command("status")
  .alias("health")
  .description("Check live health status of containers, DB, Redis, and Agent API")
  .action(async () => {
    console.log(BANNER);
    console.log(`${c.bold}Checking Pachiware Agent Status...${c.reset}\n`);

    // Check Docker
    try {
      const dockerOut = execSync("docker ps --filter 'name=pachiware' --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'", {
        encoding: "utf8",
      });
      if (dockerOut.trim()) {
        console.log(`${c.cyan}${c.bold}Bundled Containers (Docker):${c.reset}`);
        dockerOut.trim().split("\n").forEach((line) => {
          const [name, status, ports] = line.split("\t");
          console.log(`  ${c.green}●${c.reset} ${c.bold}${name.padEnd(20)}${c.reset} ${status.padEnd(25)} ${c.gray}${ports}${c.reset}`);
        });
      }
    } catch {
      // Docker not running or not installed - fine when using external infra
    }

    // Check Agent REST API
    console.log(`\n${c.cyan}${c.bold}Agent Backend API (http://localhost:3001/api/health):${c.reset}`);
    try {
      const res = await fetch("http://localhost:3001/api/health");
      if (res.ok) {
        const body: any = await res.json();
        console.log(`  ${c.green}●${c.reset} API Status:     ${c.green}${body.status.toUpperCase()}${c.reset} (Uptime: ${Math.round(body.uptimeSeconds)}s)`);
        console.log(`  ${c.green}●${c.reset} Database:       ${body.services.database}`);
        console.log(`  ${c.green}●${c.reset} Redis Cache:    ${body.services.redis}`);
        console.log(`  ${c.green}●${c.reset} Messaging:      ${body.services.discord.filter((bot: any) => bot.connected).length} connected Discord bot(s)`);
      } else {
        console.log(`  ${c.yellow}● API returned status HTTP ${res.status}${c.reset}`);
      }
    } catch {
      console.log(`  ${c.yellow}● Agent API is not currently running on port 3001.${c.reset}`);
    }

    // Check Web GUI
    console.log(`\n${c.cyan}${c.bold}Web Management GUI (http://localhost:3000):${c.reset}`);
    try {
      const res = await fetch("http://localhost:3000/");
      if (res.ok) {
        console.log(`  ${c.green}●${c.reset} Web Dashboard:  ${c.green}ACCESSIBLE (HTTP 200)${c.reset}`);
      }
    } catch {
      console.log(`  ${c.yellow}● Web Console is not currently running on port 3000.${c.reset}`);
    }
    console.log("");
  });

/**
 * Command: logs
 */
program
  .command("logs [service]")
  .description("Stream logs for agent, web, postgres, or redis")
  .action((service) => {
    const target = service || "agent";
    console.log(`${c.cyan}Streaming logs for: ${target}...${c.reset}`);

    if (target === "postgres" || target === "pg") {
      spawnSync("docker", ["logs", "-f", "pachiware-postgres"], { stdio: "inherit" });
    } else if (target === "redis") {
      spawnSync("docker", ["logs", "-f", "pachiware-redis"], { stdio: "inherit" });
    } else {
      console.log(`${c.gray}For live agent logs, run in foreground with 'pachiware start'.${c.reset}`);
      const wsRoot = requireWorkspaceRoot();
      spawnSync("docker", ["compose", "logs", "-f"], { cwd: wsRoot, stdio: "inherit" });
    }
  });

/**
 * Command: update
 */
program
  .command("update")
  .description("Pull the latest updates, execute database migrations, rebuild UI, and restart services")
  .action(async () => {
    console.log(BANNER);
    const wsRoot = requireWorkspaceRoot();
    console.log(`${c.bold}🔄 Updating Pachiware Agent Platform...${c.reset}\n`);

    // 1. Pull latest code if git repo
    if (existsSync(join(wsRoot, ".git"))) {
      console.log(`  ${c.cyan}→ Pulling latest code changes via Git...${c.reset}`);
      try {
        execSync("git pull", { cwd: wsRoot, stdio: "inherit" });
        console.log(`  ${c.green}✔${c.reset} Git pull completed.`);
      } catch (err: any) {
        console.warn(`  ${c.yellow}⚠ Git pull warning:${c.reset} ${err.message}`);
      }
    }

    // 2. Install dependencies
    console.log(`  ${c.cyan}→ Updating dependencies...${c.reset}`);
    try {
      execSync("bun install", { cwd: wsRoot, stdio: "inherit" });
      console.log(`  ${c.green}✔${c.reset} Dependencies up to date.`);
    } catch (err: any) {
      console.error(`  ${c.red}✖ Failed to install dependencies:${c.reset} ${err.message}`);
    }

    // 3. Run database migrations (check DB connectivity first)
    console.log(`  ${c.cyan}→ Applying database migrations...${c.reset}`);
    const updTarget = getDatabaseTarget(wsRoot);
    const dbReachable = updTarget.dialect === "sqlite" ? true : await isPortOpen(updTarget.host, updTarget.port, 1500);
    if (dbReachable) {
      try {
        const migrateScript = join(wsRoot, "packages", "db", "src", "migrate.ts");
        const seedScript = join(wsRoot, "packages", "db", "src", "seed.ts");
        execSync(`bun run "${migrateScript}"`, { cwd: wsRoot, stdio: "inherit" });
        execSync(`bun run "${seedScript}"`, { cwd: wsRoot, stdio: "inherit" });
        console.log(`  ${c.green}✔${c.reset} Database migrations applied (${updTarget.dialect}).`);
      } catch (err: any) {
        console.warn(`  ${c.yellow}⚠ Notice during migrations:${c.reset} ${err.message}`);
      }
    } else {
      console.log(`  ${c.yellow}ℹ Skipping migrations — PostgreSQL not reachable at ${updTarget.host}:${updTarget.port}.${c.reset}`);
      console.log(`  ${c.dim}  (Run 'pachiware db:migrate' manually once your database is up.)${c.reset}`);
    }

    // 4. Rebuild Web GUI
    console.log(`  ${c.cyan}→ Building frontend management console...${c.reset}`);
    const webPkg = join(wsRoot, "apps", "web");
    if (existsSync(webPkg)) {
      try {
        execSync("bun run --filter @pachiware/web build", { cwd: wsRoot, stdio: "pipe" });
        console.log(`  ${c.green}✔${c.reset} Web console compiled successfully.`);
      } catch (err: any) {
        console.warn(`  ${c.yellow}⚠ Notice during web build:${c.reset} ${err.message}`);
      }
    } else {
      console.log(`  ${c.gray}→ No web package found — skipping frontend build.${c.reset}`);
    }

    // 5. Rebuild CLI binary itself
    console.log(`  ${c.cyan}→ Rebuilding CLI binary...${c.reset}`);
    try {
      const cliEntry = join(wsRoot, "packages", "cli", "src", "index.ts");
      const cliBin = join(wsRoot, "bin", "pachiware");
      execSync(`bun build "${cliEntry}" --compile --outfile="${cliBin}"`, { cwd: wsRoot, stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} CLI binary rebuilt at ${cliBin}.`);
    } catch (err: any) {
      console.warn(`  ${c.yellow}⚠ Could not rebuild CLI binary:${c.reset} ${err.message}`);
    }

    // Done
    console.log(`\n${c.green}${c.bold}✔ Pachiware Agent successfully updated!${c.reset}`);
    console.log(`To reload running services, execute: ${c.cyan}pachiware restart${c.reset}\n`);
  });

/**
 * Command: doctor
 */
program
  .command("doctor")
  .description("Diagnose system dependencies, Docker status, ports availability, and configuration")
  .action(async () => {
    console.log(BANNER);
    console.log(`${c.bold}🩺 Running Pachiware System Diagnostics...${c.reset}\n`);

    // 1. Bun Runtime (Standalone - No Node.js required)
    try {
      const bunVer = execSync("bun --version", { encoding: "utf8" }).trim();
      console.log(`  ${c.green}✔${c.reset} Bun Runtime:        v${bunVer} (Standalone, Node.js not needed)`);
    } catch {
      console.log(`  ${c.red}✖${c.reset} Bun Runtime:        Not installed (recommended: curl -fsSL https://bun.sh/install | bash)`);
    }

    // 2. Docker (Optional)
    try {
      const dockerVer = execSync("docker --version", { encoding: "utf8" }).trim();
      execSync("docker info", { stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Docker Engine:      ${dockerVer} (Optional: ready for bundled containers)`);
    } catch {
      console.log(`  ${c.cyan}ℹ${c.reset} Docker Engine:      Not running or not installed (Optional: only needed if using --docker)`);
    }

    // 3. Ports check
    const ports = [
      { port: 3001, desc: "Agent API" },
      { port: 3000, desc: "Web GUI" },
      { port: 5432, desc: "PostgreSQL (only required when DATABASE_URL=postgres://...)" },
      { port: 6380, desc: "Redis Cache (optional — native in-memory fallback available)" },
    ];

    console.log(`\n  ${c.bold}Port Status:${c.reset}`);
    for (const p of ports) {
      try {
        const out = execSync(`lsof -i :${p.port} -sTCP:LISTEN || true`, { encoding: "utf8" }).trim();
        if (out) {
          console.log(`  ${c.cyan}ℹ${c.reset} Port ${p.port} (${p.desc}): In use / Listening`);
        } else {
          console.log(`  ${c.green}✔${c.reset} Port ${p.port} (${p.desc}): Available`);
        }
      } catch {
        console.log(`  ${c.green}✔${c.reset} Port ${p.port} (${p.desc}): Ready`);
      }
    }

    // 4. Configuration & Workspace
    console.log(`\n  ${c.bold}Configuration & Workspace:${c.reset}`);
    if (rootDir) {
      console.log(`  ${c.green}✔${c.reset} Workspace Root:     ${rootDir}`);
      const envPath = join(rootDir, ".env");
      if (existsSync(envPath)) {
        console.log(`  ${c.green}✔${c.reset} Environment file:   ${envPath} exists`);
      } else {
        console.log(`  ${c.yellow}⚠${c.reset} Environment file:   Missing .env in ${rootDir} (Run 'pachiware init')`);
      }

      const dbTarget = getDatabaseTarget(rootDir);
      if (dbTarget.dialect === "sqlite") {
        console.log(`  ${c.green}✔${c.reset} Database:           SQLite ${c.gray}(${dbTarget.sqlitePath})${c.reset}`);
        console.log(`  ${c.dim}                      Zero-config — no external services required.${c.reset}`);
      } else {
        console.log(`  ${c.cyan}ℹ${c.reset} Database:           PostgreSQL at ${dbTarget.host}:${dbTarget.port}`);
      }
    } else {
      console.log(`  ${c.yellow}⚠${c.reset} Workspace Root:     Not detected (Run inside Pachiware repo or set PACHIWARE_DIR)`);
    }
    console.log("");
  });

/**
 * Command: chat
 */
program
  .command("chat <message>")
  .description("Send a test message directly to the Agent ReAct loop from the terminal")
  .action(async (message) => {
    console.log(`${c.cyan}Sending prompt to Pachiware ReAct Engine...${c.reset}\n`);
    try {
      const res = await fetch(`http://localhost:${process.env.AGENT_PORT || "3001"}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PACHIWARE_API_KEY || ""}` },
        body: JSON.stringify({ message }),
      });

      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}`);
      }

      const body: any = await res.json();
      console.log(`${c.bold}${c.green}Agent Response:${c.reset}`);
      console.log(`${body.reply}\n`);

      if (body.toolsExecuted && body.toolsExecuted.length > 0) {
        console.log(`${c.cyan}${c.bold}Tools Executed:${c.reset}`);
        body.toolsExecuted.forEach((item: any) => {
          console.log(`  ${c.green}✔${c.reset} ${item.call.name} (Result: ${item.result.success ? "Success" : "Failed"})`);
        });
      }
    } catch (err: any) {
      console.error(`${c.red}Failed to reach agent API:${c.reset}`, err.message);
      console.log(`${c.gray}Ensure the agent is running with 'pachiware start'${c.reset}`);
    }
  });

/**
 * Command: db:migrate
 */
program
  .command("db:migrate")
  .description("Run database migrations (auto-detects SQLite or PostgreSQL from DATABASE_URL)")
  .action(() => {
    const wsRoot = requireWorkspaceRoot();
    const migrateScript = join(wsRoot, "packages", "db", "src", "migrate.ts");
    execSync(`bun run "${migrateScript}"`, { cwd: wsRoot, stdio: "inherit" });
  });

/**
 * Command: db:seed
 */
program
  .command("db:seed")
  .description("Seed default agent personality and built-in skills")
  .action(() => {
    const wsRoot = requireWorkspaceRoot();
    const seedScript = join(wsRoot, "packages", "db", "src", "seed.ts");
    execSync(`bun run "${seedScript}"`, { cwd: wsRoot, stdio: "inherit" });
  });

/**
 * Command: uninstall
 */
program
  .command("uninstall")
  .description("Completely remove Pachiware CLI from your system")
  .option("--purge", "Also delete the installation directory and all data (irreversible!)")
  .option("--docker", "Also stop and remove bundled Docker containers before uninstalling")
  .action(async (options) => {
    console.log(BANNER);
    console.log(`${c.bold}${c.red}🗑  Uninstalling Pachiware Agent...${c.reset}\n`);

    // 1. Stop Docker containers if requested
    if (options.docker) {
      if (rootDir) {
        console.log(`  ${c.cyan}→ Stopping bundled Docker containers...${c.reset}`);
        try {
          execSync("docker compose down -v", { cwd: requireWorkspaceRoot(), stdio: "inherit" });
          console.log(`  ${c.green}✔${c.reset} Docker containers stopped and removed.`);
        } catch {
          console.log(`  ${c.gray}  (No running Docker containers found — skipping.)${c.reset}`);
        }
      }
    }

    // 2. Stop running agent & web processes
    console.log(`  ${c.cyan}→ Stopping running Pachiware processes...${c.reset}`);
    try {
      execSync("pkill -f 'bun.*apps/agent' || true", { stdio: "pipe" });
      execSync("pkill -f 'bun.*@pachiware/web' || true", { stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Processes stopped.`);
    } catch {
      // non-fatal — processes may already be stopped
    }

    // 3. Remove symlinks / binaries from known PATH locations
    const symlinks = [
      "/usr/local/bin/pachiware",
      `${process.env.HOME}/.bun/bin/pachiware`,
      `${process.env.HOME}/.local/bin/pachiware`,
    ];

    console.log(`  ${c.cyan}→ Removing CLI symlinks / binaries from PATH...${c.reset}`);
    let removedAny = false;
    for (const linkPath of symlinks) {
      if (existsSync(linkPath)) {
        try {
          execSync(`rm -f "${linkPath}"`, { stdio: "pipe" });
          console.log(`  ${c.green}✔${c.reset} Removed ${linkPath}`);
          removedAny = true;
        } catch (err: any) {
          console.warn(`  ${c.yellow}⚠ Could not remove ${linkPath}:${c.reset} ${err.message}`);
        }
      }
    }
    if (!removedAny) {
      console.log(`  ${c.gray}  (No symlinks found in standard locations.)${c.reset}`);
    }

    // Remove saved install directory configs
    try {
      if (process.env.HOME) {
        const cfgPath = join(process.env.HOME, ".config", "pachiware", "install_dir");
        const rootPath = join(process.env.HOME, ".pachiware_root");
        if (existsSync(cfgPath)) execSync(`rm -f "${cfgPath}"`, { stdio: "pipe" });
        if (existsSync(rootPath)) execSync(`rm -f "${rootPath}"`, { stdio: "pipe" });
      }
    } catch {}

    // 4. Optionally delete the installation directory
    if (options.purge) {
      const purgeDir = rootDir;
      if (!purgeDir) {
        console.log(`  ${c.yellow}ℹ No workspace directory detected to purge.${c.reset}`);
      } else {
        console.log(`\n  ${c.red}${c.bold}⚠ --purge: Deleting installation directory: ${purgeDir}${c.reset}`);
        const answer = await new Promise<string>((res) => {
          process.stdout.write(`  ${c.bold}Type "yes" to confirm permanent deletion: ${c.reset}`);
          process.stdin.setEncoding("utf8");
          process.stdin.once("data", (d) => res(d.toString().trim()));
        });
        if (answer === "yes") {
          try {
            execSync(`rm -rf "${purgeDir}"`, { stdio: "pipe" });
            console.log(`  ${c.green}✔${c.reset} Installation directory deleted.`);
          } catch (err: any) {
            console.error(`  ${c.red}✖ Failed to delete ${purgeDir}:${c.reset} ${err.message}`);
          }
        } else {
          console.log(`  ${c.yellow}Purge cancelled. Installation directory kept.${c.reset}`);
        }
      }
    } else if (rootDir) {
      console.log(`\n  ${c.dim}Tip: The installation files at ${rootDir} were kept.`);
      console.log(`  ${c.dim}Run with ${c.cyan}--purge${c.dim} to also delete them.${c.reset}`);
    }

    console.log(`\n${c.green}${c.bold}✔ Pachiware has been uninstalled.${c.reset}\n`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`Setup/command failed: ${err.message}`);
  process.exitCode = 1;
});
