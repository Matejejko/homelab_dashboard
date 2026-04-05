#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Homelab Dashboard — k3s deploy script
#  Run this on the server that runs k3s.
#  Re-run it any time you change code or the services ConfigMap.
# ─────────────────────────────────────────────────────────────────────────────
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
die()     { echo -e "${RED}[ERR]${NC}   $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_IP=$(hostname -I | awk '{print $1}')
BACKEND_YAML="$SCRIPT_DIR/02-backend.yaml"

# ── Preflight ─────────────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || die "docker not found. Install docker: https://docs.docker.com/engine/install/"
command -v kubectl >/dev/null 2>&1 || die "kubectl not found. k3s installs it at /usr/local/bin/kubectl"
command -v k3s     >/dev/null 2>&1 || die "k3s not found. Install: curl -sfL https://get.k3s.io | sh -"

# ── Interactive setup ─────────────────────────────────────────────────────────

# --- Server location ---
echo ""
echo -e "${BOLD}── Server Location ──${NC}"

# Try to auto-detect location from public IP
AUTO_LAT="" ; AUTO_LNG="" ; AUTO_CITY=""
if command -v curl >/dev/null 2>&1; then
    GEO_JSON=$(curl -sf --max-time 5 "http://ip-api.com/json/?fields=lat,lon,city,country" 2>/dev/null || true)
    if [ -n "$GEO_JSON" ]; then
        AUTO_LAT=$(echo "$GEO_JSON" | grep -oP '"lat":\s*\K[-0-9.]+' 2>/dev/null || true)
        AUTO_LNG=$(echo "$GEO_JSON" | grep -oP '"lon":\s*\K[-0-9.]+' 2>/dev/null || true)
        AUTO_CITY=$(echo "$GEO_JSON" | grep -oP '"city":\s*"\K[^"]+' 2>/dev/null || true)
        AUTO_COUNTRY=$(echo "$GEO_JSON" | grep -oP '"country":\s*"\K[^"]+' 2>/dev/null || true)
    fi
fi

# Read current values from yaml
CUR_LAT=$(grep -A1 'DASHBOARD_SERVER_LAT' "$BACKEND_YAML" | grep 'value:' | head -1 | sed 's/.*value: *"\?\([^"]*\)"\?/\1/' || echo "0")
CUR_LNG=$(grep -A1 'DASHBOARD_SERVER_LNG' "$BACKEND_YAML" | grep 'value:' | head -1 | sed 's/.*value: *"\?\([^"]*\)"\?/\1/' || echo "0")

if [ -n "$AUTO_LAT" ] && [ -n "$AUTO_LNG" ]; then
    echo -e "  Auto-detected location: ${GREEN}${AUTO_CITY}, ${AUTO_COUNTRY}${NC} (${AUTO_LAT}, ${AUTO_LNG})"
    echo -e "  Current in config:      (${CUR_LAT}, ${CUR_LNG})"
    echo ""
    echo -e "  ${BOLD}1)${NC} Use auto-detected: ${AUTO_CITY} (${AUTO_LAT}, ${AUTO_LNG})"
    echo -e "  ${BOLD}2)${NC} Enter manually"
    echo -e "  ${BOLD}3)${NC} Keep current (${CUR_LAT}, ${CUR_LNG})"
    echo ""
    read -rp "  Choose [1/2/3] (default: 1): " LOC_CHOICE
    LOC_CHOICE=${LOC_CHOICE:-1}
else
    echo -e "  Could not auto-detect location."
    echo -e "  Current in config: (${CUR_LAT}, ${CUR_LNG})"
    echo ""
    echo -e "  ${BOLD}1)${NC} Enter manually"
    echo -e "  ${BOLD}2)${NC} Keep current (${CUR_LAT}, ${CUR_LNG})"
    echo ""
    read -rp "  Choose [1/2] (default: 2): " LOC_CHOICE
    if [ "$LOC_CHOICE" = "1" ]; then
        LOC_CHOICE=2  # map to manual
    else
        LOC_CHOICE=3  # map to keep
    fi
fi

case "$LOC_CHOICE" in
    1)
        NEW_LAT="$AUTO_LAT"
        NEW_LNG="$AUTO_LNG"
        success "Using auto-detected: ${AUTO_CITY} (${NEW_LAT}, ${NEW_LNG})"
        ;;
    2)
        read -rp "  Latitude: " NEW_LAT
        read -rp "  Longitude: " NEW_LNG
        if [ -z "$NEW_LAT" ] || [ -z "$NEW_LNG" ]; then
            warn "Empty input — keeping current values"
            NEW_LAT="$CUR_LAT"
            NEW_LNG="$CUR_LNG"
        else
            success "Using manual: (${NEW_LAT}, ${NEW_LNG})"
        fi
        ;;
    *)
        NEW_LAT="$CUR_LAT"
        NEW_LNG="$CUR_LNG"
        success "Keeping current: (${NEW_LAT}, ${NEW_LNG})"
        ;;
esac

# Update 02-backend.yaml with new coordinates
sed -i "/DASHBOARD_SERVER_LAT/{n;s/value: .*/value: \"${NEW_LAT}\"/}" "$BACKEND_YAML"
sed -i "/DASHBOARD_SERVER_LNG/{n;s/value: .*/value: \"${NEW_LNG}\"/}" "$BACKEND_YAML"

# --- Conntrack device timeout ---
echo ""
echo -e "${BOLD}── Device Detection Timeout ──${NC}"
echo -e "  Controls how long a disconnected device stays visible."
echo -e "  This sets the kernel conntrack TCP timeout."
echo ""

CUR_TIMEOUT=$(sudo sysctl -n net.netfilter.nf_conntrack_tcp_timeout_established 2>/dev/null || echo "unknown")
if [ "$CUR_TIMEOUT" != "unknown" ]; then
    CUR_MINS=$((CUR_TIMEOUT / 60))
    echo -e "  Current timeout: ${CYAN}${CUR_MINS} minutes${NC} (${CUR_TIMEOUT}s)"
else
    echo -e "  Current timeout: ${YELLOW}unknown${NC} (conntrack module may not be loaded)"
fi
echo ""
read -rp "  Timeout in minutes (press Enter to keep current, 0 to skip): " TIMEOUT_MINS

if [ -n "$TIMEOUT_MINS" ] && [ "$TIMEOUT_MINS" != "0" ]; then
    TIMEOUT_SECS=$((TIMEOUT_MINS * 60))

    # Load conntrack module if needed
    if ! lsmod | grep -q nf_conntrack; then
        info "Loading nf_conntrack kernel module..."
        sudo modprobe nf_conntrack
    fi

    sudo sysctl -w net.netfilter.nf_conntrack_tcp_timeout_established="$TIMEOUT_SECS" >/dev/null 2>&1
    success "Timeout set to ${TIMEOUT_MINS} minutes (${TIMEOUT_SECS}s)"

    # Persist across reboots
    echo "nf_conntrack" | sudo tee /etc/modules-load.d/nf_conntrack.conf >/dev/null 2>&1
    sudo mkdir -p /etc/sysctl.d
    echo "net.netfilter.nf_conntrack_tcp_timeout_established=${TIMEOUT_SECS}" | sudo tee /etc/sysctl.d/99-conntrack.conf >/dev/null 2>&1
    success "Persisted for reboots"
else
    success "Keeping current timeout"
fi

echo ""

# ── Step 1 — Build Docker images ─────────────────────────────────────────────
info "Step 1/4 — Building backend image..."
docker build -t homelab-backend:latest "$SCRIPT_DIR"
success "homelab-backend:latest built"

info "Step 1/4 — Building frontend image..."
docker build -t homelab-frontend:latest \
  -f "$SCRIPT_DIR/mnt/user-data/outputs/homelab-k3s/frontend/Dockerfile" \
  "$SCRIPT_DIR"
success "homelab-frontend:latest built"

# ── Step 2 — Import images into k3s containerd ───────────────────────────────
info "Step 2/4 — Importing images into k3s containerd..."
docker save homelab-backend:latest  | sudo k3s ctr images import -
docker save homelab-frontend:latest | sudo k3s ctr images import -
success "Images imported into k3s"

# ── Step 3 — Apply Kubernetes manifests ──────────────────────────────────────
info "Step 3/4 — Applying manifests..."
sudo kubectl apply -f "$SCRIPT_DIR/00-namespace.yaml"
sudo kubectl apply -f "$SCRIPT_DIR/01-configmap.yaml"
sudo kubectl apply -f "$SCRIPT_DIR/02-backend.yaml"
sudo kubectl apply -f "$SCRIPT_DIR/03-frontend.yaml"
success "Manifests applied"

# ── Step 4 — Wait for rollout ─────────────────────────────────────────────────
info "Step 4/4 — Waiting for pods to be ready..."
sudo kubectl rollout restart deployment/homelab-backend  -n homelab 2>/dev/null || true
sudo kubectl rollout restart deployment/homelab-frontend -n homelab 2>/dev/null || true
sudo kubectl rollout status  deployment/homelab-backend  -n homelab --timeout=120s
sudo kubectl rollout status  deployment/homelab-frontend -n homelab --timeout=120s

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Homelab Dashboard deployed to k3s!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  🌐 Dashboard (NodePort):  ${CYAN}http://$NODE_IP:30300${NC}"
echo -e "  🌐 Dashboard (Ingress):   ${CYAN}http://$NODE_IP${NC}  (if ingress applied)"
echo -e "  ⚙️  API (internal only):   homelab-backend.homelab.svc:8000"
echo ""
echo -e "  Useful commands:"
echo -e "    sudo kubectl get pods -n homelab"
echo -e "    sudo kubectl logs -n homelab deploy/homelab-backend -f"
echo -e "    sudo kubectl logs -n homelab deploy/homelab-frontend -f"
echo ""
echo -e "  Edit services (no rebuild needed):"
echo -e "    sudo kubectl edit configmap homelab-services -n homelab"
echo ""
