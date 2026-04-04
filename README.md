# 🖥️ Homelab Dashboard — k3s Setup Guide

Runs as two pods in a `homelab` namespace. The backend reads real host hardware metrics via mounted `/proc` and `/sys`. The frontend nginx proxies `/api/*` to the backend — no hardcoded IPs anywhere.

```
Browser → NodePort :30300 → frontend (nginx)
                                ├── /          → React static files
                                └── /api/*     → backend pod :8000
                                                    ├── /api/system    (psutil → host /proc /sys)
                                                    └── /api/services  (HTTP ping each service)
```

---

## Prerequisites

Install these on your server if not already present:

```bash
# k3s
curl -sfL https://get.k3s.io | sh -

# Docker (needed to build images)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

---

## Step-by-Step Deploy

### Step 1 — Clone / copy the project onto your server

```bash
scp -r homelab-k3s/ user@192.168.1.100:~/homelab-k3s
# or git clone, rsync, etc.
```

### Step 2 — Edit your services list

Open `k8s/01-configmap.yaml` and update the services to match what's actually running on your server:

```bash
nano ~/homelab-k3s/k8s/01-configmap.yaml
```

Each entry:
```json
{ "name": "Jellyfin", "desc": "Media server", "url": "http://localhost:8096", "group": "Media", "icon": "📺" }
```

> **Tip:** Use `localhost` URLs — the backend pod runs with `hostNetwork: true` so it sees your host's ports directly.

### Step 3 — Run the deploy script

```bash
cd ~/homelab-k3s
chmod +x deploy.sh
./deploy.sh
```

This will:
1. Build both Docker images
2. Import them into k3s's containerd (k3s doesn't use Docker's image store)
3. Apply all manifests in `k8s/`
4. Wait for both pods to become ready

### Step 4 — Open the dashboard

```
http://YOUR-SERVER-IP:30300
```

---

## Updating Services (no rebuild needed)

Edit the ConfigMap directly — changes take effect on the next `/api/services` poll:

```bash
sudo kubectl edit configmap homelab-services -n homelab
```

---

## Updating Code

After changing any source file, just re-run the deploy script:

```bash
./deploy.sh
```

It rebuilds the images, re-imports them, and does a rolling restart.

---

## Optional: Traefik Ingress (port 80)

k3s ships with Traefik. Apply the ingress to get a clean URL on port 80:

```bash
sudo kubectl apply -f k8s/04-ingress.yaml
```

Then access at `http://YOUR-SERVER-IP` instead of `:30300`.

To use a hostname like `homelab.local`, edit the `host:` field in `04-ingress.yaml` and add an entry to your router's DNS or your PC's `/etc/hosts`:
```
192.168.1.100   homelab.local
```

---

## Useful Commands

| What | Command |
|------|---------|
| Check pod status | `sudo kubectl get pods -n homelab` |
| Backend logs (live) | `sudo kubectl logs -n homelab deploy/homelab-backend -f` |
| Frontend logs (live) | `sudo kubectl logs -n homelab deploy/homelab-frontend -f` |
| Describe a failing pod | `sudo kubectl describe pod -n homelab <pod-name>` |
| Edit services live | `sudo kubectl edit configmap homelab-services -n homelab` |
| Delete everything | `sudo kubectl delete namespace homelab` |

---

## How Host Metrics Work

The backend pod is configured with:

| Setting | Why |
|---------|-----|
| `hostNetwork: true` | Sees host network interfaces → real I/O stats |
| `hostPID: true` | Sees host processes → accurate CPU/load |
| `/proc` mounted at `/host/proc` | psutil reads real host CPU, RAM, uptime |
| `/sys` mounted at `/host/sys` | psutil reads real CPU temperature sensors |
| `/` mounted at `/host/root` | psutil reads real disk usage |
| `privileged: true` | Required to access the above |

---

## Notes

- **Temperature** shows "Not available" if `lm-sensors` is not installed on the host. Everything else still works.
- **Service URLs** should use `localhost` (not `127.0.0.1` or the node IP) because `hostNetwork: true` makes `localhost` resolve to the host.
- **Multi-node clusters:** The backend only reads metrics from whichever node it's scheduled on. Pin it to a specific node with a `nodeSelector` in `k8s/02-backend.yaml` if needed.
- **API docs:** The backend Swagger UI is only reachable from inside the cluster: `http://homelab-backend.homelab.svc:8000/docs`
