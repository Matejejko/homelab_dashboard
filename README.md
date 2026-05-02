# Homelab Dashboard

A self-hosted dashboard for a single-node **k3s** homelab. It surfaces real host hardware metrics, auto-discovers your services from Kubernetes and Docker, health-checks them, and shows who is currently connected to the box on a world map.

Two pods, one namespace (`homelab`), one command to deploy.

```
Browser → NodePort :30300 → frontend (nginx + React)
                                ├── /          → React SPA (static files)
                                └── /api/*     → backend pod :8000 (FastAPI)
                                                    ├── /api/system    psutil reads host /proc /sys
                                                    ├── /api/services  k8s + Docker auto-discovery + health
                                                    ├── /api/config    LAN / ZeroTier / Tailscale IPs
                                                    └── /api/devices   conntrack → connected clients
```

---

## Features

- **Host metrics** — CPU %, frequency, cores/threads, load average, RAM, disk usage per real filesystem, temperature, uptime, network throughput. Read directly from the host's `/proc` and `/sys` (the backend bypasses the container's mount namespace by reading `/proc/1/mounts`).
- **Service auto-discovery** — Three sources merged automatically:
  - Kubernetes Services (NodePort, LoadBalancer, ClusterIP behind an Ingress, plus Traefik `IngressRoute` CRDs)
  - Docker containers with published host ports (via `/var/run/docker.sock`)
  - Optional ConfigMap entries for things that don't fit either
- **Health checks** — Each discovered service is HTTP-pinged; the card shows online/offline + response time.
- **Connected devices** — Backend reads the kernel's `conntrack` table to see real client IPs through k3s NAT, classifies them as LAN / Tailscale / ZeroTier / WAN, and (for WAN) geolocates them via ip-api.com.
- **World map** — Leaflet (CartoDB Voyager / Dark Matter) with pins for every connected device.
- **Multi-network URLs** — Each service card has LAN / Tailscale / ZeroTier buttons; URLs are rebuilt from whichever IPs you've configured.
- **Customizable UI** — Drag-and-drop service groups, per-card name/icon/description overrides (browser localStorage), or set them at the source via Docker labels and k8s annotations.
- **Theming** — Auto-follows OS dark/light preference, can be toggled in the header.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.12, FastAPI, uvicorn, psutil, httpx, kubernetes client |
| Frontend | React 18, plain CSS variables (no Tailwind/MUI), Leaflet.js |
| Container runtime | Docker (build), k3s containerd (runtime) |
| Orchestration | k3s (single-node), Traefik Ingress (optional) |
| Reverse proxy | nginx inside the frontend pod (`/api/*` → backend Service) |

---

## Prerequisites

Run on the same Linux host that runs k3s:

```bash
# k3s
curl -sfL https://get.k3s.io | sh -

# Docker (needed to build the images)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

The deploy script also assumes `kubectl` is on `PATH` (k3s installs it at `/usr/local/bin/kubectl`).

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/Matejejko/homelab_dashboard.git
cd homelab_dashboard
```

### 2. (Optional) Pre-configure the disk filter

`02-backend.yaml` shows all real block-device filesystems by default. To restrict the disk panel to specific mounts:

```yaml
- name: DASHBOARD_DISKS
  value: "/, /home"   # comma-separated mount points or device names
```

Everything else (LAN/ZT/TS IPs, server location, conntrack timeout) is filled in interactively by the deploy script.

### 3. Run the deploy script

```bash
chmod +x deploy.sh
./deploy.sh
```

The script walks you through:

1. **Server location** — geolocates your public IP via ip-api.com (used to pin the server on the map). Accept the auto-detected city, enter coordinates manually, or keep current.
2. **LAN IP** — auto-detected from `hostname -I`.
3. **Tailscale IP** — auto-detected via `tailscale ip` or the `tailscale0` interface; can be left blank.
4. **ZeroTier IP** — auto-detected via `zerotier-cli` or `zt*` interfaces; can be left blank.
5. **Device-detection timeout** — how long a disconnected client stays visible. Sets `net.netfilter.nf_conntrack_tcp_timeout_established`, loads the `nf_conntrack` module if needed, and persists both across reboots.

It then:

1. Builds `homelab-backend:latest` and `homelab-frontend:latest` with Docker.
2. Imports both into k3s containerd (`k3s ctr images import`) — no registry needed.
3. Applies `00-namespace.yaml` → `03-frontend.yaml`.
4. Restarts both Deployments and waits for rollout.

### 4. Open the dashboard

```
http://YOUR-SERVER-IP:30300
```

To redeploy after a code or config change, just run `./deploy.sh` again.

---

## Configuration Reference

All backend config is environment variables in `02-backend.yaml`:

| Env Var | Default | Description |
|---|---|---|
| `DASHBOARD_LAN_IP` | auto-detect (UDP probe to 8.8.8.8) | LAN IP used to build service URLs |
| `DASHBOARD_ZT_IP` | *(empty)* | ZeroTier IP — empty greys out the ZT button |
| `DASHBOARD_TS_IP` | *(empty)* | Tailscale IP — empty greys out the TS button |
| `DASHBOARD_DISKS` | *(empty)* | Comma-separated mount points or device names; empty = show all |
| `DASHBOARD_SERVER_LAT` | `0` | Server latitude for the world map |
| `DASHBOARD_SERVER_LNG` | `0` | Server longitude for the world map |
| `HOST_PROC` / `HOST_SYS` / `HOST_ROOT` | `/host/proc` / `/host/sys` / `/host/root` | Where the host filesystems are mounted in the pod |
| `SERVICES_FILE` | `/config/services.json` | Path to the manual-services JSON (mounted from ConfigMap) |

LAN / ZT / TS IPs can also be overridden per-browser via the in-app **Settings** modal (saved to localStorage).

---

## Service Auto-Discovery

The backend merges services from three sources on every `/api/services` poll:

### 1. Kubernetes Services

Every Service in the cluster is considered, except those in `kube-system` / `kube-public` / `kube-node-lease` and the dashboard's own pods. Each is mapped to a URL:

- **NodePort** → `http://localhost:<nodePort>` (the frontend rewrites this against `LAN_IP` for display)
- **LoadBalancer** → external IP/hostname + port
- **ClusterIP + Ingress** → URL from the Ingress (standard `networking.k8s.io/v1` plus Traefik `IngressRoute` CRDs in groups `traefik.io` and `traefik.containo.us`)
- **ClusterIP without Ingress** → skipped (internal only)

### 2. Docker Containers

Any running container with a published host port is detected via `/var/run/docker.sock`. Friendly names and icons come from a built-in keyword table that matches against the image name (Jellyfin, Sonarr, Pi-hole, Nextcloud, Home Assistant, etc. — see `KNOWN_IMAGES` in `main.py`).

### 3. ConfigMap (manual)

For services the backend can't see (running on a different host, bare-metal, etc.):

```bash
sudo kubectl edit configmap homelab-services -n homelab
```

Change takes effect on the next service poll — no pod restart needed.

### Customizing services at the source

Skip the per-browser overrides and label things directly in your infrastructure.

**Docker (compose label):**
```yaml
labels:
  homelab-dashboard.name: "Jellyfin"
  homelab-dashboard.icon: "📺"
  homelab-dashboard.desc: "Media server"
  homelab-dashboard.group: "Media"
  homelab-dashboard.url: "http://media.lan:8096"   # optional override
  homelab-dashboard.enabled: "false"               # hide from dashboard
```

**Kubernetes (Service annotation):**
```yaml
annotations:
  homelab-dashboard/name: "Jellyfin"
  homelab-dashboard/icon: "📺"
  homelab-dashboard/desc: "Media server"
  homelab-dashboard/group: "Media"
  homelab-dashboard/url: "https://jellyfin.example.com"
  homelab-dashboard/enabled: "false"
```

---

## Editing Services in the UI

- **Pencil icon** on a card → override name, icon, description (saved to localStorage; "Reset to Default" removes overrides).
- **Grouped view** (header toggle) → drag-and-drop cards between groups, double-click to rename a group, **+ Group** to create one.
- The flat view is the default; switch to grouped only when you actually want to organize.

---

## World Map & Connected Devices

Below the services section the dashboard renders a Leaflet map alongside a list of currently connected clients.

The backend runs `conntrack -L -p tcp --state ESTABLISHED` (the CLI is installed in the image) and parses the result. Falls back to `/proc/net/nf_conntrack` if the CLI isn't usable — both are reachable thanks to `privileged: true` and `hostNetwork: true`. Pod-to-pod (10.42.0.0/16) and ClusterIP (10.43.0.0/16) traffic is filtered out so only real clients show up.

| Type | Pin colour | How detected |
|---|---|---|
| LAN | Blue | RFC1918 private IP |
| Tailscale | Purple | CGNAT range `100.64.0.0/10` |
| ZeroTier | Orange | `10.147.0.0/16` (default ZT range) |
| WAN | Orange | Public IP — geolocated via ip-api.com batch endpoint |
| Server | Green | Your configured `DASHBOARD_SERVER_LAT/LNG` |

Geolocation results are cached in-process for 5 minutes. WAN devices are pinned at their geo-coordinates; LAN/TS/ZT devices appear near the server (private IPs can't be located). The device list shows IP, type, total connections, and which of your services they're hitting (matched by destination port).

Polling: system every 5s, services every 15s, devices every 10s.

You can also add **manual devices** via Settings → Connected Devices (lat, lng, type) — useful for pinning known machines that aren't actively connected.

### Adjusting the timeout later

The deploy script handles this, but to change it without redeploying:

```bash
sudo sysctl -w net.netfilter.nf_conntrack_tcp_timeout_established=300   # 5 min
```

---

## Multi-Network Access

Each service card shows three buttons (LAN / ZeroTier / Tailscale). Buttons are always rendered; ones whose IP you haven't configured are greyed out with a tooltip pointing to Settings.

| Button | When active | URL pattern |
|---|---|---|
| LAN | `DASHBOARD_LAN_IP` set | `http://<LAN_IP>:<port>` |
| ZeroTier | `DASHBOARD_ZT_IP` set | `http://<ZT_IP>:<port>` |
| Tailscale | `DASHBOARD_TS_IP` set | `http://<TS_IP>:<port>` |

Server-side defaults live in `02-backend.yaml`; per-browser overrides live in localStorage (Settings modal).

---

## Optional: Traefik Ingress (port 80)

k3s ships with Traefik, so you can drop the `:30300` port:

```bash
sudo kubectl apply -f 04-ingress.yaml
```

By default it matches any host on port 80. To use a hostname, edit the `host:` field in `04-ingress.yaml` and add an entry to your local DNS / `/etc/hosts`.

---

## Why the Backend Needs So Much Privilege

| Setting | Why |
|---|---|
| `hostNetwork: true` | psutil reads real host network interfaces for I/O stats; conntrack sees the host's tracking table |
| `hostPID: true` | `/proc/1/mounts` resolves to the host init process, giving real host filesystems |
| `/proc` → `/host/proc` | Real CPU, RAM, uptime, network counters |
| `/sys` → `/host/sys` | CPU temperature sensors (`hwmon`, `thermal_zone*`) |
| `/` → `/host/root` | Real disk usage via `psutil.disk_usage` |
| `/var/run/docker.sock` mounted | Container auto-discovery |
| `privileged: true` | Required to read host `/proc` & `/sys` and to run `conntrack` |

This is why the dashboard is intended for a private homelab, not a multi-tenant cluster.

---

## Useful Commands

| What | Command |
|---|---|
| Pod status | `sudo kubectl get pods -n homelab` |
| Backend logs | `sudo kubectl logs -n homelab deploy/homelab-backend -f` |
| Frontend logs | `sudo kubectl logs -n homelab deploy/homelab-frontend -f` |
| All k8s services | `sudo kubectl get svc -A` |
| Edit manual services | `sudo kubectl edit configmap homelab-services -n homelab` |
| Running containers | `docker ps` |
| Tear everything down | `sudo kubectl delete namespace homelab` |

---

## Repo Structure

```
homelab_dashboard/
├── main.py                                      # Backend API (FastAPI + psutil)
├── Dockerfile                                   # Backend image (python:3.12-slim + conntrack)
├── requirements.txt                             # fastapi, uvicorn, psutil, httpx, kubernetes
├── package.json                                 # Frontend React deps
├── src/App.js                                   # Frontend UI (cards, drag-drop, settings, map)
├── src/App.css                                  # Theming + animations
├── src/index.js                                 # React entry point
├── public/index.html                            # HTML template
├── nginx.conf                                   # Frontend nginx (serves SPA + proxies /api/*)
├── mnt/user-data/outputs/homelab-k3s/frontend/
│   └── Dockerfile                               # Frontend multi-stage build (node → nginx)
├── deploy.sh                                    # Interactive build + import + apply + rollout
├── services.json                                # Local-dev fallback for manual services
├── 00-namespace.yaml                            # `homelab` Namespace
├── 01-configmap.yaml                            # Manual services (mounted at /config)
├── 02-backend.yaml                              # ServiceAccount + ClusterRole + Deployment + Service + env vars
├── 03-frontend.yaml                             # Frontend Deployment + NodePort :30300
└── 04-ingress.yaml                              # Optional Traefik Ingress on port 80
```

---

## Notes & Gotchas

- **Temperature** shows "Not available" when the host has no readable sensor (no `lm-sensors`, no `thermal_zone*`).
- **Disk panel** reads `/host/proc/1/mounts` to bypass the container mount namespace; without `hostPID: true` you'd see the container's view instead of the host's.
- **Multi-node clusters** — the backend must run on the node whose hardware you care about. Add a `nodeSelector` or `nodeName` in `02-backend.yaml`.
- **Frontend image rebuild** — the build context is the repo root, so any change under `src/` or `public/` requires a redeploy.
- **localStorage** is the source of truth for per-browser customizations (theme, group layout, service overrides, manual devices, IP overrides). Clearing it returns the dashboard to its server-side defaults.
- **Rolling update strategy** for the backend is `Recreate` — `hostNetwork: true` means two pods would otherwise fight over port 8000.
