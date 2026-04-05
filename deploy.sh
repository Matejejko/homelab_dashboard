#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Homelab Dashboard — k3s deploy script
#  Run this on the server that runs k3s.
#  Re-run it any time you change code or the services ConfigMap.
# ─────────────────────────────────────────────────────────────────────────────
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $1"; }
success() { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
die()     { echo -e "${RED}[ERR]${NC}   $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_IP=$(hostname -I | awk '{print $1}')

# ── Preflight ─────────────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || die "docker not found. Install docker: https://docs.docker.com/engine/install/"
command -v kubectl >/dev/null 2>&1 || die "kubectl not found. k3s installs it at /usr/local/bin/kubectl"
command -v k3s     >/dev/null 2>&1 || die "k3s not found. Install: curl -sfL https://get.k3s.io | sh -"

# ── Step 1 — Build Docker images ─────────────────────────────────────────────
# Backend Dockerfile is at the repo root alongside main.py / requirements.txt
info "Step 1/4 — Building backend image..."
docker build -t homelab-backend:latest "$SCRIPT_DIR"
success "homelab-backend:latest built"

# Frontend Dockerfile lives in mnt/user-data/outputs/homelab-k3s/frontend/
# but nginx.conf is at the repo root, so we pass the root as build context.
info "Step 1/4 — Building frontend image..."
docker build -t homelab-frontend:latest \
  -f "$SCRIPT_DIR/mnt/user-data/outputs/homelab-k3s/frontend/Dockerfile" \
  "$SCRIPT_DIR"
success "homelab-frontend:latest built"

# ── Step 2 — Import images into k3s containerd ───────────────────────────────
# k3s uses its own containerd, separate from Docker.
# We export from Docker and import into k3s.
info "Step 2/4 — Importing images into k3s containerd..."
docker save homelab-backend:latest  | sudo k3s ctr images import -
docker save homelab-frontend:latest | sudo k3s ctr images import -
success "Images imported into k3s"

# ── Step 3 — Apply Kubernetes manifests ──────────────────────────────────────
# Manifests live at the repo root (no k8s/ subdirectory).
# Apply in order — namespace first, then configmap, then workloads.
# 04-ingress.yaml is NOT applied here; it's optional (see README).
info "Step 3/4 — Applying manifests..."
sudo kubectl apply -f "$SCRIPT_DIR/00-namespace.yaml"
sudo kubectl apply -f "$SCRIPT_DIR/01-configmap.yaml"
sudo kubectl apply -f "$SCRIPT_DIR/02-backend.yaml"
sudo kubectl apply -f "$SCRIPT_DIR/03-frontend.yaml"
success "Manifests applied"

# ── Step 4 — Wait for rollout ─────────────────────────────────────────────────
# On re-deploys we force a restart so pods pick up the newly imported images
# (imagePullPolicy: Never means k3s won't re-pull on its own).
# On a fresh install the restart is a no-op but still safe.
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
