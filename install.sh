#!/usr/bin/env bash
# ==============================================================================
# Pachiware Agent — One-Line Server Installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | bash
#   or ./install.sh
# ==============================================================================

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

tty_prompt() {
  local question="$1"
  local fallback="$2"
  if [ -r /dev/tty ]; then
    printf "%b" "$question" > /dev/tty
    IFS= read -r answer < /dev/tty || answer=""
    echo "${answer:-$fallback}"
  else
    echo "$fallback"
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file="$INSTALL_DIR/.env"
  local tmp="${file}.pachiware.tmp"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ ("^" key "=") { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

echo -e "${CYAN}${BOLD}"
cat << 'EOF'
  ____            _     _                              _                      
 |  _ \ __ _  ___| |__ (_)_      ____ _ _ __ ___      / \   __ _  ___ _ __  _|_ 
 | |_) / _` |/ __| '_ \| \ \ /\ / / _` | '__/ _ \    / _ \ / _` |/ _ \ '_ \| __|
 |  __/ (_| | (__| | | | |\ V  V / (_| | | |  __/   / ___ \ (_| |  __/ | | | |_ 
 |_|   \__,_|\___|_| |_|_| \_/\_/ \__,_|_|  \___|  /_/   \_\__, |\___|_| |_|\__|
                                                           |___/                
EOF
echo -e "${NC}"
echo -e "${BOLD}Installing Pachiware Agent CLI on your server...${NC}\n"

# 1. Detect Operating System & Arch
OS="$(uname -s)"
ARCH="$(uname -m)"
echo -e "  ${CYAN}→ System detected:${NC} $OS ($ARCH)"

# 2. Check or Install Bun Runtime
if ! command -v bun &> /dev/null; then
  echo -e "  ${YELLOW}→ Bun runtime not found. Installing Bun...${NC}"
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
else
  echo -e "  ${GREEN}✔ Bun is already installed:${NC} $(bun --version)"
fi

# 3. Check Git & Docker (Optional)
if ! command -v git &> /dev/null; then
  echo -e "  ${YELLOW}→ Git not found. Attempting to install git...${NC}"
  if command -v apt-get &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y git
  elif command -v yum &> /dev/null; then
    sudo yum install -y git
  else
    echo -e "  ${RED}✖ Git is required. Please install git and re-run.${NC}"
    exit 1
  fi
fi

if ! command -v docker &> /dev/null; then
  echo -e "  ${CYAN}ℹ Docker is not installed (optional).${NC}"
  echo -e "    Note: Docker is only needed if you want to use the bundled PostgreSQL/Redis containers."
else
  echo -e "  ${GREEN}✔ Docker is installed (optional container runner):${NC} $(docker --version)"
fi

# 4. Target Installation Directory
INSTALL_DIR="${PACHIWARE_DIR:-$HOME/.pachiware}"
if [ -d "$PWD/apps/agent" ] && [ -f "$PWD/docker-compose.yml" ]; then
  # Running directly inside repository clone
  INSTALL_DIR="$PWD"
  echo -e "  ${CYAN}→ Installing directly from existing workspace:${NC} $INSTALL_DIR"
else
  echo -e "  ${CYAN}→ Setting up deployment in:${NC} $INSTALL_DIR"
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "  ${CYAN}→ Updating existing repository in:${NC} $INSTALL_DIR"
    git -C "$INSTALL_DIR" pull
  elif [ ! -d "$INSTALL_DIR" ] || [ ! -f "$INSTALL_DIR/apps/agent/src/index.ts" ]; then
    echo -e "  ${CYAN}→ Cloning repository into:${NC} $INSTALL_DIR"
    rm -rf "$INSTALL_DIR" 2>/dev/null || true
    git clone https://github.com/yhagus/pachiware.git "$INSTALL_DIR"
  fi
fi

cd "$INSTALL_DIR"

# Save install directory pointer for global CLI discovery
mkdir -p "$HOME/.config/pachiware" 2>/dev/null || true
echo "$INSTALL_DIR" > "$HOME/.config/pachiware/install_dir" 2>/dev/null || true
echo "$INSTALL_DIR" > "$HOME/.pachiware_root" 2>/dev/null || true

# If running under sudo, also save for the original user
if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
  SUDO_HOME=$(eval echo "~$SUDO_USER")
  mkdir -p "$SUDO_HOME/.config/pachiware" 2>/dev/null || true
  echo "$INSTALL_DIR" > "$SUDO_HOME/.config/pachiware/install_dir" 2>/dev/null || true
  echo "$INSTALL_DIR" > "$SUDO_HOME/.pachiware_root" 2>/dev/null || true
  chown -R "$SUDO_USER" "$SUDO_HOME/.config/pachiware" 2>/dev/null || true
fi

# 5. Copy .env if missing
if [ ! -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/.env.example" ]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  echo -e "  ${GREEN}✔ Created default .env configuration.${NC}"
fi

# 6. Choose the database explicitly. Piped curl installs use SQLite unless
# PACHIWARE_DATABASE or PACHIWARE_POSTGRES_URL is provided.
DB_CHOICE="${PACHIWARE_DATABASE:-}"
if [ -z "$DB_CHOICE" ] && [ ! -r /dev/tty ] && grep -q '^DATABASE_URL=' "$INSTALL_DIR/.env"; then
  echo -e "  ${CYAN}ℹ Existing DATABASE_URL preserved for non-interactive install.${NC}"
  DB_CHOICE="preserve"
elif [ -z "$DB_CHOICE" ]; then
  DB_CHOICE="$(tty_prompt "Choose database: [1] SQLite (zero-config), [2] PostgreSQL external, [3] PostgreSQL 18 Docker [1]: " "1")"
fi
case "$(printf '%s' "$DB_CHOICE" | tr '[:upper:]' '[:lower:]')" in
  preserve) ;;
  2|postgres|postgresql)
    POSTGRES_URL="${PACHIWARE_POSTGRES_URL:-}"
    if [ -z "$POSTGRES_URL" ]; then
      POSTGRES_URL="$(tty_prompt "PostgreSQL URL [postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent]: " "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent")"
    fi
    set_env_value "DATABASE_URL" "$POSTGRES_URL"
    echo -e "  ${GREEN}✔ PostgreSQL selected.${NC} Ensure the server is reachable before pachiware start."
    ;;
  3|docker)
    set_env_value "DATABASE_URL" "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent"
    echo -e "  ${GREEN}✔ PostgreSQL 18 Docker selected.${NC} Run: pachiware start --docker"
    ;;
  *)
    set_env_value "DATABASE_URL" "sqlite:./data/pachiware.db"
    echo -e "  ${GREEN}✔ SQLite selected.${NC} No Docker, PostgreSQL, or Redis setup is required."
    ;;
esac

# 7. Install dependencies & build CLI
echo -e "  ${CYAN}→ Building CLI binary...${NC}"
bun install --frozen-lockfile 2>/dev/null || bun install
mkdir -p "$INSTALL_DIR/bin"
bun build "$INSTALL_DIR/packages/cli/src/index.ts" --compile --outfile="$INSTALL_DIR/bin/pachiware"

# 7. Symlink pachiware to global PATH
BIN_TARGET="/usr/local/bin/pachiware"
BUN_BIN="$HOME/.bun/bin/pachiware"

if [ -w "/usr/local/bin" ]; then
  ln -sf "$INSTALL_DIR/bin/pachiware" "$BIN_TARGET"
  echo -e "  ${GREEN}✔ Linked binary to:${NC} $BIN_TARGET"
elif command -v sudo &> /dev/null; then
  sudo ln -sf "$INSTALL_DIR/bin/pachiware" "$BIN_TARGET" 2>/dev/null && \
    echo -e "  ${GREEN}✔ Linked binary to:${NC} $BIN_TARGET (via sudo)" || true
fi

if [ -d "$HOME/.bun/bin" ]; then
  ln -sf "$INSTALL_DIR/bin/pachiware" "$BUN_BIN"
  echo -e "  ${GREEN}✔ Linked binary to:${NC} $BUN_BIN"
fi
mkdir -p "$HOME/.local/bin"
ln -sf "$INSTALL_DIR/bin/pachiware" "$HOME/.local/bin/pachiware"
echo -e "  ${GREEN}✔ Linked binary to:${NC} $HOME/.local/bin/pachiware"

echo -e "\n${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD} 🎉 Pachiware Agent CLI installed successfully!${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "You can now run:"
echo -e "  ${CYAN}pachiware --help${NC}          Show all available commands"
echo -e "  ${CYAN}pachiware doctor${NC}          Verify system health and configuration"
echo -e "  ${CYAN}pachiware start${NC}           Launch Agent & Web GUI (connects to DB & Redis in .env)"
echo -e "  ${CYAN}pachiware start --docker${NC}  Launch Agent and spin up bundled Postgres & Redis"
echo -e "  ${CYAN}pachiware update${NC}          Pull latest updates, migrations & restart"
echo -e "  ${CYAN}pachiware status${NC}          Inspect real-time system status"
echo -e "  ${CYAN}pachiware uninstall${NC}       Completely remove Pachiware CLI and services"
echo -e "${GREEN}${BOLD}======================================================${NC}\n"
