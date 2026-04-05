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

### 2 — Configure your environment

Edit `02-backend.yaml` and set the environment variables under the `env:` section:

```yaml
env:
  # ... (HOST_PROC, HOST_SYS, HOST_ROOT, SERVICES_FILE are pre-set)

  # ── Your server's LAN IP (used in service URLs) ──
  - name: DASHBOARD_LAN_IP
    value: "192.168.0.101"

  # ── ZeroTier IP (leave empty to show button as disabled) ──
  - name: DASHBOARD_ZT_IP
    value: ""

  # ── Tailscale IP (leave empty to show button as disabled) ──
  - name: DASHBOARD_TS_IP
    value: ""

  # ── Disk filter (see "Disk Monitoring" section below) ──
  - name: DASHBOARD_DISKS
    value: ""

  # ── Server location for the world map ──
  - name: DASHBOARD_SERVER_LAT
    value: "48.1486"
  - name: DASHBOARD_SERVER_LNG
    value: "17.1077"
```

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

## Configuration Reference

All configuration is done via environment variables in `02-backend.yaml`.

| Env Var | Default | Description |
|---------|---------|-------------|
| `DASHBOARD_LAN_IP` | auto-detect | Your server's LAN IP for service URLs |
| `DASHBOARD_ZT_IP` | *(empty)* | ZeroTier IP — leave empty to disable ZT button |
| `DASHBOARD_TS_IP` | *(empty)* | Tailscale IP — leave empty to disable TS button |
| `DASHBOARD_DISKS` | *(empty)* | Comma-separated mount points or device names to monitor |
| `DASHBOARD_SERVER_LAT` | `0` | Server latitude for the world map |
| `DASHBOARD_SERVER_LNG` | `0` | Server longitude for the world map |

You can also override LAN/ZT/TS IPs from the dashboard UI via **Settings** (saved to browser localStorage).

After changing env vars, redeploy:
```bash
./deploy.sh
```

---

## Disk Monitoring

By default, the dashboard shows **all real block-device filesystems** detected on the host (ext4, xfs, btrfs, etc.). Container overlays, tmpfs, and virtual filesystems are filtered out.

### Filtering to specific disks

Set `DASHBOARD_DISKS` in `02-backend.yaml` to show only the disks you care about:

```yaml
# Show only root and /home:
- name: DASHBOARD_DISKS
  value: "/, /home"

# Show by device name:
- name: DASHBOARD_DISKS
  value: "/dev/sda1, /dev/nvme0n1p2"

# Show all (default — leave empty):
- name: DASHBOARD_DISKS
  value: ""
```

The filter matches against **mount point** (e.g. `/`, `/home`, `/data`) or **device name** (e.g. `/dev/sda1`). Comma-separated, spaces are trimmed.

### How it works

The backend reads the host's real mount table from `/host/proc/1/mounts` (PID 1 = host init process), bypassing the container's mount namespace. Disk usage is probed through the host root mount at `/host/root`.

---

## Service Auto-Discovery

Services are discovered automatically from **three sources** — no manual config needed:

### 1. Kubernetes Services
Every Service in the cluster is detected (except `kube-system` and the dashboard itself):
- **NodePort** → `http://LAN_IP:<nodePort>`
- **LoadBalancer** → external IP + port
- **ClusterIP + Ingress** → Ingress URL
- **ClusterIP without Ingress** → skipped (internal only)

### 2. Docker Containers
Any running Docker container with a published host port is detected via `/var/run/docker.sock`. Service names and icons are matched from the Docker image name (e.g., `linuxserver/jellyfin` is identified as "Jellyfin").

### 3. ConfigMap (manual additions)
For services that can't be auto-detected:

```bash
sudo kubectl edit configmap homelab-services -n homelab
```

---

## Editing Services in the Dashboard

Click the **pencil icon** on any service card to edit:

- **Display name** — override the auto-detected name
- **Icon** — set a custom emoji
- **Description** — add or change the description
- **Service info** — read-only panel showing the original name, port, URL, and auto-detected group

Click **Reset to Default** to remove all overrides for that service.

All customizations are saved to your browser's localStorage.

### Customizing via Docker labels / k8s annotations

You can also customize services at the infrastructure level:

**Docker containers** — add labels to your docker-compose:
```yaml
labels:
  homelab-dashboard.name: "Jellyfin"
  homelab-dashboard.icon: "📺"
  homelab-dashboard.desc: "Media server"
  homelab-dashboard.group: "Media"
  homelab-dashboard.enabled: "false"   # hide this container
```

**k8s Services** — add annotations:
```yaml
annotations:
  homelab-dashboard/name: "Jellyfin"
  homelab-dashboard/icon: "📺"
  homelab-dashboard/desc: "Media server"
  homelab-dashboard/group: "Media"
  homelab-dashboard/enabled: "false"   # hide this service
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

## World Map

The dashboard includes an interactive world map (Leaflet.js with CartoDB Dark tiles) showing:

- **Server location** — green pin, configured via `DASHBOARD_SERVER_LAT`/`DASHBOARD_SERVER_LNG` env vars or Settings UI
- **Connected devices** — colored pins (blue=LAN, orange=ZeroTier, purple=Tailscale)
- **Connection lines** — dashed lines from each device to the server, color-coded by network type

### Adding devices

1. Open **Settings** in the dashboard
2. Scroll to **Connected Devices**
3. Enter device name, latitude, longitude, and connection type (LAN/ZeroTier/Tailscale)
4. Click **+** to add
5. Click **Save**

To find coordinates: search your city on Google Maps, right-click the pin, and copy the lat/lng.

Devices are stored in your browser's localStorage. The map only appears when a server location or at least one device is configured.

---

## Multi-Network Access (LAN / ZeroTier / Tailscale)

Each service card shows three access buttons:

| Button | Color | When active | URL format |
|--------|-------|-------------|------------|
| **LAN** | Blue | LAN IP is set | `http://<LAN_IP>:<port>` |
| **ZeroTier** | Orange | ZT IP is set | `http://<ZT_IP>:<port>` |
| **Tailscale** | Purple | TS IP is set | `http://<TS_IP>:<port>` |

Buttons are always visible. If the corresponding IP is not configured, the button appears grayed out with a tooltip prompting you to set the IP in Settings.

Configure IPs:
1. **`02-backend.yaml`** → env vars (server-side defaults)
2. **Dashboard Settings button** → browser-side overrides (localStorage)

A **Network IPs** card in the system stats section shows all configured IPs at a glance.

---

## Updating Code

```bash
./deploy.sh
```

---

## Optional: Traefik Ingress (port 80)

```bash
sudo kubectl apply -f 04-ingress.yaml
```

Then visit `http://YOUR-SERVER-IP` instead of `:30300`.

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
├── src/App.js                       # Frontend UI (drag-drop, edit, settings)
├── src/index.js                     # React entry point
├── public/index.html                # HTML template
├── nginx.conf                       # Frontend nginx proxy config
├── mnt/.../frontend/Dockerfile      # Frontend multi-stage build
├── deploy.sh                        # One-command build & deploy
├── services.json                    # Local dev fallback (empty)
├── 00-namespace.yaml                # k8s Namespace
├── 01-configmap.yaml                # Manual service additions (empty)
├── 02-backend.yaml                  # Backend + RBAC + all config env vars
├── 03-frontend.yaml                 # Frontend + NodePort :30300
└── 04-ingress.yaml                  # Optional Traefik Ingress (port 80)
```

---

## Notes

- **Temperature** shows "Not available" if `lm-sensors` is not installed on the host.
- **Disk panel** reads from `/host/proc/1/mounts`. Filter with `DASHBOARD_DISKS` env var.
- **Service URLs** use the configured `DASHBOARD_LAN_IP` instead of localhost.
- **Multi-node clusters:** Pin the backend to a specific node with a `nodeSelector` in `02-backend.yaml`.
- **Live clock** is displayed in the top-right corner of the dashboard.
