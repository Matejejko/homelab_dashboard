# Homelab Dashboard — k3s Setup Guide

Runs as two pods in a `homelab` namespace. The backend reads real host hardware metrics via mounted `/proc` and `/sys`, and auto-discovers services from k8s Services, Docker containers, and an optional ConfigMap.

```
Browser → NodePort :30300 → frontend (nginx)
                                ├── /          → React static files
                                └── /api/*     → backend pod :8000
                                                    ├── /api/system    (psutil → host /proc /sys)
                                                    └── /api/services  (k8s + Docker auto-discovery)
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

### 1 — Clone the repo onto your server

```bash
git clone https://github.com/Matejejko/homelab_dashboard.git
cd homelab_dashboard
```

### 2 — Run the deploy script

```bash
chmod +x deploy.sh
./deploy.sh
```

This will:
1. Build the backend Docker image (from `Dockerfile` at repo root)
2. Build the frontend Docker image (multi-stage React + nginx)
3. Import both images into k3s's containerd
4. Apply all manifests (namespace, configmap, backend, frontend)
5. Wait for pods to become ready

### 3 — Open the dashboard

```
http://YOUR-SERVER-IP:30300
```

---

## Service Auto-Discovery

Services are discovered automatically from **three sources** (no manual config needed):

### 1. Kubernetes Services
Every Service in the cluster is detected (except `kube-system` internals and the dashboard itself). The URL is determined by:
- **NodePort** services → `http://localhost:<nodePort>`
- **LoadBalancer** services → external IP + port
- **ClusterIP** services → `http://<name>.<namespace>.svc:<port>`
- **Ingress** attached to a service → Ingress host/path URL

### 2. Docker Containers
Any running Docker container with a published host port is detected via `/var/run/docker.sock`. Well-known ports (Jellyfin 8096, Sonarr 8989, Radarr 7878, etc.) get automatic names and icons.

### 3. ConfigMap (manual additions)
For services that can't be auto-detected (e.g. on another host), add them to the ConfigMap:

```bash
sudo kubectl edit configmap homelab-services -n homelab
```

### Customizing display with annotations/labels

**k8s Services** — add annotations:
```yaml
annotations:
  homelab-dashboard/name:  "Jellyfin"
  homelab-dashboard/desc:  "Media server"
  homelab-dashboard/group: "Media"
  homelab-dashboard/icon:  "📺"
  homelab-dashboard/url:   "http://..."
  homelab-dashboard/enabled: "false"   # hide this service
```

**Docker containers** — add labels:
```yaml
labels:
  homelab-dashboard.name: "Jellyfin"
  homelab-dashboard.group: "Media"
  homelab-dashboard.icon: "📺"
  homelab-dashboard.enabled: "false"   # hide this container
```

---

## Updating Code

After changing source files, re-run:

```bash
./deploy.sh
```

It rebuilds images, re-imports them, and does a rolling restart.

---

## Optional: Traefik Ingress (port 80)

k3s ships with Traefik. Apply the ingress to access on port 80:

```bash
sudo kubectl apply -f 04-ingress.yaml
```

Then visit `http://YOUR-SERVER-IP` instead of `:30300`.

---

## Useful Commands

| What | Command |
|------|---------|
| Check pod status | `sudo kubectl get pods -n homelab` |
| Backend logs (live) | `sudo kubectl logs -n homelab deploy/homelab-backend -f` |
| Frontend logs (live) | `sudo kubectl logs -n homelab deploy/homelab-frontend -f` |
| Describe a failing pod | `sudo kubectl describe pod -n homelab <pod-name>` |
| View k8s services | `sudo kubectl get svc -A` |
| View Docker containers | `docker ps` |
| Delete everything | `sudo kubectl delete namespace homelab` |

---

## How Host Metrics Work

| Setting | Why |
|---------|-----|
| `hostNetwork: true` | Sees host network interfaces for real I/O stats |
| `hostPID: true` | Sees host processes for accurate CPU/load; `/proc/1/mounts` gives real host filesystems |
| `/proc` mounted at `/host/proc` | psutil reads real host CPU, RAM, uptime |
| `/sys` mounted at `/host/sys` | psutil reads real CPU temperature sensors |
| `/` mounted at `/host/root` | psutil probes real disk usage through host root |
| `docker.sock` mounted | Discovers running Docker containers and their ports |
| `privileged: true` | Required to access all of the above |

---

## Repo Structure

```
homelab_dashboard/
├── main.py              # Backend API (FastAPI + psutil)
├── Dockerfile           # Backend image
├── requirements.txt     # Python dependencies
├── package.json         # Frontend React dependencies
├── src/                 # Frontend React source
├── public/              # Frontend static assets
├── nginx.conf           # Frontend nginx proxy config
├── mnt/.../frontend/Dockerfile  # Frontend multi-stage build
├── deploy.sh            # One-command build & deploy
├── services.json        # Local dev fallback (empty by default)
├── 00-namespace.yaml    # k8s Namespace
├── 01-configmap.yaml    # Manual service additions (empty by default)
├── 02-backend.yaml      # Backend Deployment + RBAC + Service
├── 03-frontend.yaml     # Frontend Deployment + NodePort Service
└── 04-ingress.yaml      # Optional Traefik Ingress
```

---

## Notes

- **Temperature** shows "Not available" if `lm-sensors` is not installed on the host.
- **Disk panel** reads from `/host/proc/1/mounts` to show only real host filesystems (ext4, xfs, btrfs, etc.) — container overlays are filtered out.
- **Service URLs** use `localhost` because `hostNetwork: true` makes localhost resolve to the host.
- **Multi-node clusters:** The backend only reads metrics from whichever node it's scheduled on. Pin it with a `nodeSelector` in `02-backend.yaml` if needed.
