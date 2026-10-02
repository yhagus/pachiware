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
  if [ ! -d "$INSTALL_DIR" ] || [ ! -f "$INSTALL_DIR/apps/agent/src/index.ts" ]; then
    if [ -d "$INSTALL_DIR/.git" ]; then
      echo -e "  ${CYAN}→ Updating existing clone in:${NC} $INSTALL_DIR"
      git -C "$INSTALL_DIR" pull || true
    else
      echo -e "  ${CYAN}→ Cloning repository into:${NC} $INSTALL_DIR"
      rm -rf "$INSTALL_DIR" 2>/dev/null || true
      git clone https://github.com/yhagus/pachiware.git "$INSTALL_DIR"
    fi
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

# 6. Install dependencies & build CLI
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
elif [ -d "$HOME/.bun/bin" ]; then
  ln -sf "$INSTALL_DIR/bin/pachiware" "$BUN_BIN"
  echo -e "  ${GREEN}✔ Linked binary to:${NC} $BUN_BIN"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/bin/pachiware" "$HOME/.local/bin/pachiware"
  echo -e "  ${GREEN}✔ Linked binary to:${NC} $HOME/.local/bin/pachiware"
fi

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
