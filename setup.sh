#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  Homelab Dashboard — One-shot setup script
#  Run as your normal user (NOT root), on Ubuntu/Debian/Raspbian
# ─────────────────────────────────────────────────────────────
set -e

# Color helpers
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
die()     { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
VENV_DIR="$SCRIPT_DIR/venv"
SERVICE_NAME="homelab-dashboard"

# ── Detect server IP ──────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
info "Detected server IP: $SERVER_IP"

# ─────────────────────────────────────────────────────────────
# STEP 1 — Python backend
# ─────────────────────────────────────────────────────────────
info "Step 1/4 — Setting up Python backend..."

command -v python3 >/dev/null 2>&1 || die "python3 not found. Install with: sudo apt install python3"
command -v pip3    >/dev/null 2>&1 || { warn "pip3 not found, installing..."; sudo apt-get install -y python3-pip; }

info "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip -q
"$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt" -q
success "Backend dependencies installed."

# Quick smoke-test
"$VENV_DIR/bin/python" -c "import psutil, fastapi, httpx, uvicorn; print('All imports OK')"

# ─────────────────────────────────────────────────────────────
# STEP 2 — Node/React frontend build
# ─────────────────────────────────────────────────────────────
info "Step 2/4 — Building React frontend..."

command -v node >/dev/null 2>&1 || die "Node.js not found. Install with: sudo apt install nodejs npm  (or use nvm)"
command -v npm  >/dev/null 2>&1 || die "npm not found."

cd "$FRONTEND_DIR"
# Write the API URL into the .env file
echo "REACT_APP_API_URL=http://$SERVER_IP:8000" > .env
info "Set REACT_APP_API_URL=http://$SERVER_IP:8000"

npm install --silent
npm run build --silent
success "Frontend built to $FRONTEND_DIR/build"

# ─────────────────────────────────────────────────────────────
# STEP 3 — Serve frontend with a static file server
# ─────────────────────────────────────────────────────────────
info "Step 3/4 — Installing 'serve' to host the frontend..."
npm install -g serve --silent 2>/dev/null || warn "Could not install 'serve' globally, try: sudo npm install -g serve"

# ─────────────────────────────────────────────────────────────
# STEP 4 — Systemd services
# ─────────────────────────────────────────────────────────────
info "Step 4/4 — Installing systemd services..."
CURRENT_USER=$(whoami)

# Backend service
cat > /tmp/${SERVICE_NAME}-api.service << EOF
[Unit]
Description=Homelab Dashboard API
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$BACKEND_DIR
ExecStart=$VENV_DIR/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Frontend service
cat > /tmp/${SERVICE_NAME}-ui.service << EOF
[Unit]
Description=Homelab Dashboard UI
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$FRONTEND_DIR
ExecStart=$(which serve) -s build -l 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/${SERVICE_NAME}-api.service /etc/systemd/system/
sudo mv /tmp/${SERVICE_NAME}-ui.service  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable  ${SERVICE_NAME}-api ${SERVICE_NAME}-ui
sudo systemctl restart ${SERVICE_NAME}-api ${SERVICE_NAME}-ui

# ─────────────────────────────────────────────────────────────
# Done!
# ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Homelab Dashboard is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  🌐 Dashboard:  ${CYAN}http://$SERVER_IP:3000${NC}"
echo -e "  ⚙️  API:        ${CYAN}http://$SERVER_IP:8000${NC}"
echo -e "  📋 API docs:   ${CYAN}http://$SERVER_IP:8000/docs${NC}"
echo ""
echo -e "  Manage services:"
echo -e "    sudo systemctl status  ${SERVICE_NAME}-api"
echo -e "    sudo systemctl status  ${SERVICE_NAME}-ui"
echo -e "    sudo journalctl -u ${SERVICE_NAME}-api -f   # live logs"
echo ""
echo -e "  Edit your services list:"
echo -e "    nano $BACKEND_DIR/services.json"
echo ""
