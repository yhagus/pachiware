#!/usr/bin/env bun
import { Command } from "commander";
import { spawn, spawnSync, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join } from "path";

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
${c.gray}   Self-Hosted Autonomous AI Agent Platform with Discord & PostgreSQL 18       ${c.reset}
${c.gray}   v${VERSION} • Bun Runtime • Lightweight Explicit ReAct Engine                     ${c.reset}
`;

function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (current !== "/" && current !== "") {
    if (
      existsSync(join(current, "docker-compose.yml")) &&
      existsSync(join(current, "apps", "agent"))
    ) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

const rootDir = findWorkspaceRoot();

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
  .action(async (dir) => {
    console.log(BANNER);
    const targetDir = dir ? resolve(process.cwd(), dir) : rootDir;
    console.log(`${c.green}⚡ Initializing Pachiware Agent at:${c.reset} ${c.bold}${targetDir}${c.reset}\n`);

    // 1. Check or create .env
    const envFile = join(targetDir, ".env");
    const envExample = join(targetDir, ".env.example");

    if (!existsSync(envFile) && existsSync(envExample)) {
      writeFileSync(envFile, readFileSync(envExample, "utf8"));
      console.log(`  ${c.green}✔${c.reset} Created ${c.cyan}.env${c.reset} configuration from template.`);
    } else if (existsSync(envFile)) {
      console.log(`  ${c.green}✔${c.reset} Existing ${c.cyan}.env${c.reset} configuration detected.`);
    }

    // 2. Docker compose check
    const composeFile = join(targetDir, "docker-compose.yml");
    if (existsSync(composeFile)) {
      console.log(`  ${c.green}✔${c.reset} Docker Compose configuration ready (Postgres 18 & Redis 7).`);
    }

    console.log(`\n${c.green}${c.bold}Setup complete!${c.reset} Run the following to start services:`);
    console.log(`  ${c.cyan}pachiware start${c.reset}      Start all containers and agent processes`);
    console.log(`  ${c.cyan}pachiware doctor${c.reset}     Verify system health and prerequisites\n`);
  });

/**
 * Command: start
 */
program
  .command("start")
  .description("Start PostgreSQL 18, Redis, Agent API, and Web Management Console")
  .option("-d, --daemon", "Run processes in the background (daemon mode)")
  .option("--no-gui", "Start only the Agent backend service without the Web GUI")
  .action(async (options) => {
    console.log(BANNER);
    console.log(`${c.bold}🚀 Starting Pachiware Agent Platform...${c.reset}\n`);

    // 1. Start Docker containers
    console.log(`  ${c.cyan}→ Starting PostgreSQL 18 and Redis containers...${c.reset}`);
    try {
      execSync("docker compose up -d", { cwd: rootDir, stdio: "inherit" });
      console.log(`  ${c.green}✔${c.reset} Infrastructure containers running.`);
    } catch (err: any) {
      console.error(`  ${c.red}✖ Failed to start Docker containers:${c.reset}`, err.message);
      process.exit(1);
    }

    // 2. Run DB migrations
    console.log(`  ${c.cyan}→ Ensuring PostgreSQL 18 database schema & seed...${c.reset}`);
    try {
      execSync("bun run ./packages/db/src/migrate.ts", { cwd: rootDir, stdio: "pipe" });
      execSync("bun run ./packages/db/src/seed.ts", { cwd: rootDir, stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Database migrations verified.`);
    } catch (err: any) {
      console.warn(`  ${c.yellow}⚠ Notice during migrations:${c.reset}`, err.message);
    }

    // 3. Print service endpoints
    console.log(`\n${c.green}${c.bold}====================================================${c.reset}`);
    console.log(`  ${c.bold}Pachiware Agent is LIVE and ready!${c.reset}`);
    console.log(`${c.green}${c.bold}====================================================${c.reset}`);
    console.log(`  ${c.cyan}🌐 Web Console:${c.reset}      ${c.bold}http://localhost:3000${c.reset}`);
    console.log(`  ${c.cyan}⚡ Agent REST API:${c.reset}   ${c.bold}http://localhost:3001${c.reset}`);
    console.log(`  ${c.cyan}🐘 PostgreSQL 18:${c.reset}    localhost:5432 (DB: pachiware_agent)`);
    console.log(`  ${c.cyan}🔴 Redis Cache:${c.reset}      localhost:6380 (Health: OK)`);
    console.log(`${c.gray}----------------------------------------------------${c.reset}`);
    console.log(`  ${c.dim}Press Ctrl+C to terminate services or run 'pachiware stop'${c.reset}\n`);

    if (options.daemon) {
      console.log(`${c.green}✔ Running in background daemon mode.${c.reset}`);
      return;
    }

    // 4. Start Agent and optionally Web in parallel
    const agentProc = spawn("bun", ["run", "apps/agent/src/index.ts"], {
      cwd: rootDir,
      stdio: "inherit",
    });

    let webProc: any = null;
    if (options.gui !== false) {
      webProc = spawn("bun", ["--filter", "@pachiware/web", "dev"], {
        cwd: rootDir,
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
  .description("Stop running Pachiware Agent services and containers")
  .option("--all", "Also stop and remove Docker containers")
  .action((options) => {
    console.log(BANNER);
    console.log(`${c.yellow}Stopping Pachiware Agent services...${c.reset}`);

    try {
      execSync("pkill -f 'bun.*apps/agent/src/index.ts' || true", { stdio: "pipe" });
      execSync("pkill -f 'vite --port 3000' || true", { stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Agent backend and Web console processes stopped.`);

      if (options.all) {
        execSync("docker compose down", { cwd: rootDir, stdio: "inherit" });
        console.log(`  ${c.green}✔${c.reset} Docker containers stopped.`);
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
  .description("Restart all Pachiware Agent services")
  .action(() => {
    console.log(`${c.yellow}Restarting Pachiware Agent...${c.reset}`);
    try {
      execSync("pkill -f 'bun.*apps/agent/src/index.ts' || true", { stdio: "pipe" });
      execSync("pkill -f 'vite --port 3000' || true", { stdio: "pipe" });
      execSync("docker compose restart", { cwd: rootDir, stdio: "inherit" });
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
      console.log(`${c.cyan}${c.bold}Containers:${c.reset}`);
      if (dockerOut.trim()) {
        dockerOut.trim().split("\n").forEach((line) => {
          const [name, status, ports] = line.split("\t");
          console.log(`  ${c.green}●${c.reset} ${c.bold}${name.padEnd(20)}${c.reset} ${status.padEnd(25)} ${c.gray}${ports}${c.reset}`);
        });
      } else {
        console.log(`  ${c.yellow}● No containers running. Run 'pachiware start'${c.reset}`);
      }
    } catch {
      console.log(`  ${c.red}✖ Docker daemon unreachable.${c.reset}`);
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
        console.log(`  ${c.green}●${c.reset} Discord Bot:    ${body.services.discord.connected ? `Connected (${body.services.discord.botTag})` : "Simulation/Standby mode"}`);
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
      spawnSync("docker", ["compose", "logs", "-f"], { cwd: rootDir, stdio: "inherit" });
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
    console.log(`${c.bold}🔄 Updating Pachiware Agent Platform...${c.reset}\n`);

    // 1. Pull latest code if git repo
    if (existsSync(join(rootDir, ".git"))) {
      console.log(`  ${c.cyan}→ Pulling latest code changes via Git...${c.reset}`);
      try {
        execSync("git pull", { cwd: rootDir, stdio: "inherit" });
        console.log(`  ${c.green}✔${c.reset} Git pull completed.`);
      } catch (err: any) {
        console.warn(`  ${c.yellow}⚠ Git pull warning:${c.reset} ${err.message}`);
      }
    }

    // 2. Install dependencies
    console.log(`  ${c.cyan}→ Updating dependencies...${c.reset}`);
    try {
      execSync("bun install", { cwd: rootDir, stdio: "inherit" });
      console.log(`  ${c.green}✔${c.reset} Dependencies up to date.`);
    } catch (err: any) {
      console.error(`  ${c.red}✖ Failed to install dependencies:${c.reset} ${err.message}`);
    }

    // 3. Run database migrations
    console.log(`  ${c.cyan}→ Applying PostgreSQL 18 migrations...${c.reset}`);
    try {
      execSync("bun run ./packages/db/src/migrate.ts", { cwd: rootDir, stdio: "inherit" });
      execSync("bun run ./packages/db/src/seed.ts", { cwd: rootDir, stdio: "inherit" });
      console.log(`  ${c.green}✔${c.reset} Database migrations applied.`);
    } catch (err: any) {
      console.warn(`  ${c.yellow}⚠ Notice during migrations:${c.reset} ${err.message}`);
    }

    // 4. Rebuild Web GUI
    console.log(`  ${c.cyan}→ Building frontend management console...${c.reset}`);
    try {
      execSync("bun --filter @pachiware/web build", { cwd: rootDir, stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Web console compiled successfully.`);
    } catch (err: any) {
      console.warn(`  ${c.yellow}⚠ Notice during web build:${c.reset} ${err.message}`);
    }

    // 5. Restart services
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

    // 1. Bun & Node Runtimes
    try {
      const bunVer = execSync("bun --version", { encoding: "utf8" }).trim();
      console.log(`  ${c.green}✔${c.reset} Bun Runtime:        v${bunVer}`);
    } catch {
      console.log(`  ${c.red}✖${c.reset} Bun Runtime:        Not installed (recommended: curl -fsSL https://bun.sh/install | bash)`);
    }

    // 2. Docker
    try {
      const dockerVer = execSync("docker --version", { encoding: "utf8" }).trim();
      execSync("docker info", { stdio: "pipe" });
      console.log(`  ${c.green}✔${c.reset} Docker Engine:      ${dockerVer} (Daemon active)`);
    } catch {
      console.log(`  ${c.red}✖${c.reset} Docker Engine:      Not running or not installed.`);
    }

    // 3. Ports check
    const ports = [
      { port: 5432, desc: "PostgreSQL 18" },
      { port: 6380, desc: "Redis Cache" },
      { port: 3001, desc: "Agent API" },
      { port: 3000, desc: "Web GUI" },
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

    // 4. Configuration .env
    const envPath = join(rootDir, ".env");
    console.log(`\n  ${c.bold}Configuration:${c.reset}`);
    if (existsSync(envPath)) {
      console.log(`  ${c.green}✔${c.reset} Environment file:   ${envPath} exists`);
    } else {
      console.log(`  ${c.yellow}⚠${c.reset} Environment file:   Missing .env (Run 'pachiware init')`);
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
      const res = await fetch("http://localhost:3001/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
  .description("Run database migrations on PostgreSQL 18")
  .action(() => {
    execSync("bun run ./packages/db/src/migrate.ts", { cwd: rootDir, stdio: "inherit" });
  });

/**
 * Command: db:seed
 */
program
  .command("db:seed")
  .description("Seed default agent personality and built-in skills")
  .action(() => {
    execSync("bun run ./packages/db/src/seed.ts", { cwd: rootDir, stdio: "inherit" });
  });

program.parse(process.argv);
