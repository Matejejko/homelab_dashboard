# Homelab Dashboard — k3s Setup Guide

Runs as two pods in a `homelab` namespace. The backend reads real host hardware metrics via mounted `/proc` and `/sys`, and auto-discovers services from k8s Services, Docker containers, and an optional ConfigMap.

```
Browser → NodePort :30300 → frontend (nginx)
                                ├── /          → React static files
                                └── /api/*     → backend pod :8000
                                                    ├── /api/system    (psutil → host /proc /sys)
                                                    ├── /api/services  (k8s + Docker auto-discovery)
                                                    └── /api/config    (network IPs for LAN/ZT/TS)
```

---

## Prerequisites

```bash
# k3s
curl -sfL https://get.k3s.io | sh -

# Docker (needed to build images)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

---

## Step-by-Step Deploy

### 1 — Clone the repo

```bash
git clone https://github.com/Matejejko/homelab_dashboard.git
cd homelab_dashboard
```

### 2 — Configure your IPs

Edit `02-backend.yaml` and set these environment variables:

```yaml
- name: DASHBOARD_LAN_IP
  value: "192.168.0.101"       # ← your server's LAN IP
- name: DASHBOARD_ZT_IP
  value: ""                    # ← your ZeroTier IP (or leave empty)
- name: DASHBOARD_TS_IP
  value: ""                    # ← your Tailscale IP (or leave empty)
```

These IPs are used by the frontend to build access URLs for each service. Each service card gets a **LAN** button, and optionally **ZeroTier** and **Tailscale** buttons if those IPs are set.

You can also change them later via the **Settings** button in the dashboard UI (saved to browser localStorage).

### 3 — Run the deploy script

```bash
chmod +x deploy.sh
./deploy.sh
```

### 4 — Open the dashboard

```
http://YOUR-SERVER-IP:30300
```

---

## Service Auto-Discovery

Services are discovered automatically from **three sources** — no manual config needed:

### 1. Kubernetes Services
Every Service in the cluster is detected (except `kube-system` internals and the dashboard itself):
- **NodePort** → `http://LAN_IP:<nodePort>`
- **LoadBalancer** → external IP + port
- **ClusterIP + Ingress** → Ingress URL
- **ClusterIP without Ingress** → skipped (internal only)

### 2. Docker Containers
Any running Docker container with a published host port is detected via `/var/run/docker.sock`. Service names and icons are matched from the Docker image name (e.g., `linuxserver/jellyfin` is identified as Jellyfin).

### 3. ConfigMap (manual additions)
For services that can't be auto-detected:

```bash
sudo kubectl edit configmap homelab-services -n homelab
```

### Customizing display

**k8s Services** — annotations:
```yaml
annotations:
  homelab-dashboard/name: "Jellyfin"
  homelab-dashboard/icon: "📺"
  homelab-dashboard/group: "Media"
  homelab-dashboard/enabled: "false"   # hide
```

**Docker containers** — labels:
```yaml
labels:
  homelab-dashboard.name: "Jellyfin"
  homelab-dashboard.icon: "📺"
  homelab-dashboard.group: "Media"
  homelab-dashboard.enabled: "false"   # hide
```

---

## Group Management

The dashboard has a drag-and-drop group management UI:

1. Click **+ New Group** to create a custom group (e.g., "Game Servers", "Movies")
2. **Drag** any service card into a different group
3. **Double-click** a group name to rename it
4. Click **x** on a group header to delete it (services move to Uncategorized)

Group layout is saved to your browser's localStorage.

---

## Multi-Network Access (LAN / ZeroTier / Tailscale)

Each service card shows access buttons based on your configured IPs:

| Button | When shown | URL format |
|--------|-----------|------------|
| **LAN** | Always (if LAN IP set) | `http://<LAN_IP>:<port>` |
| **ZeroTier** | Only if ZT IP configured | `http://<ZT_IP>:<port>` |
| **Tailscale** | Only if TS IP configured | `http://<TS_IP>:<port>` |

Configure IPs in:
- **`02-backend.yaml`** → env vars `DASHBOARD_LAN_IP`, `DASHBOARD_ZT_IP`, `DASHBOARD_TS_IP`
- **Dashboard Settings** button → overrides stored in browser localStorage

---

## Updating Code

```bash
./deploy.sh
```

---

## Useful Commands

| What | Command |
|------|---------|
| Check pod status | `sudo kubectl get pods -n homelab` |
| Backend logs | `sudo kubectl logs -n homelab deploy/homelab-backend -f` |
| Frontend logs | `sudo kubectl logs -n homelab deploy/homelab-frontend -f` |
| View k8s services | `sudo kubectl get svc -A` |
| View Docker containers | `docker ps` |
| Delete everything | `sudo kubectl delete namespace homelab` |

---

## How Host Metrics Work

| Setting | Why |
|---------|-----|
| `hostNetwork: true` | Sees host network interfaces for real I/O stats |
| `hostPID: true` | Sees host processes; `/proc/1/mounts` gives real host filesystems |
| `/proc` → `/host/proc` | Real host CPU, RAM, uptime |
| `/sys` → `/host/sys` | CPU temperature sensors |
| `/` → `/host/root` | Real disk usage |
| `docker.sock` mounted | Discovers running Docker containers |
| `privileged: true` | Required to access all of the above |

---

## Repo Structure

```
homelab_dashboard/
├── main.py                          # Backend API (FastAPI + psutil)
├── Dockerfile                       # Backend image
├── requirements.txt
├── package.json                     # Frontend React deps
├── src/                             # Frontend source
├── public/                          # Frontend static
├── nginx.conf                       # Frontend nginx proxy config
├── mnt/.../frontend/Dockerfile      # Frontend multi-stage build
├── deploy.sh                        # One-command build & deploy
├── services.json                    # Local dev fallback (empty)
├── 00-namespace.yaml
├── 01-configmap.yaml                # Manual service additions (empty)
├── 02-backend.yaml                  # Backend + RBAC + IP config
├── 03-frontend.yaml                 # Frontend + NodePort
└── 04-ingress.yaml                  # Optional Traefik Ingress
```

---

## Notes

- **Temperature** shows "Not available" if `lm-sensors` is not installed on the host.
- **Disk panel** reads `/host/proc/1/mounts` to show only real host filesystems — container overlays are filtered out.
- **Service URLs** use the configured `DASHBOARD_LAN_IP` instead of localhost.
- **Multi-node clusters:** Pin the backend to a specific node with a `nodeSelector` in `02-backend.yaml`.
