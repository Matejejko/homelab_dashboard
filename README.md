# Homelab Dashboard

A self-hosted dashboard for a single-node **k3s** homelab. It shows real host metrics, auto-discovers your services from Kubernetes and Docker, health-checks them, and draws the peers this server is talking to on a world map.

Two pods, one namespace (`homelab`), one command to deploy. Access is protected by a login.

```
Browser → NodePort :30300 → frontend (unprivileged nginx + React)
                                ├── /          → static app
                                └── /api/*     → backend pod :8000 (FastAPI)
                                                    ├── /api/auth/*    login, logout, session, password
                                                    ├── /api/system    host CPU, RAM, disks, temperature
                                                    ├── /api/services  k8s + Docker discovery + health
                                                    ├── /api/config    server addresses (read from interfaces), map tile key
                                                    ├── /api/network   conntrack → peers, direction, bytes
                                                    └── /api/health    liveness (the only open data route)
```

> **Plain HTTP only.** The dashboard has no TLS. Do **not** port-forward it to the internet. Reach it over your LAN, Tailscale or ZeroTier. See [Security](#security).

---

## Features

- **Host metrics**: CPU, RAM, temperature, uptime, network throughput and disk usage per real filesystem, read from the host's `/proc` and `/sys`.
- **Service auto-discovery** from Kubernetes Services (NodePort, LoadBalancer, Ingress, Traefik `IngressRoute`), Docker containers with published ports, and an optional ConfigMap.
- **Health checks** that fit the service: web pages are requested over HTTP, game servers and other non-web services are checked on their TCP or UDP port. See [How "online" is decided](#how-online-is-decided).
- **Network map**: peers from the kernel's conntrack table (TCP and UDP, IPv4 and IPv6, inbound and outbound), classified as LAN / Tailscale / ZeroTier / WAN, with byte counters when the kernel provides them.
- **Honest locations**: a peer is drawn only where real data puts it. Everything else is listed as "not on map" with the reason.
- **Multi-network links**: each service card links to the server's LAN, ZeroTier and Tailscale address. The addresses are read live from the network interfaces.
- **Customisable**: flat or grouped view, drag-and-drop between groups, per-service name / icon / description, manual map pins, dark and light theme.
- **Self-contained**: font and map library are bundled. The only third-party requests the page makes are map tiles.

---

## Security

### First login

There is one account, `admin`. The first time the backend starts it generates a random one-time password and stores it, readable by root only, on the host:

```
/var/lib/homelab-dashboard/initial-admin-password
```

`deploy.sh` prints the username and that password at the end of the deployment, for as long as the file exists. To read it again:

```bash
sudo cat /var/lib/homelab-dashboard/initial-admin-password
```

Sign in with it and the dashboard asks for a new password (12 to 256 characters) before showing anything else. Once you have changed it, the file is deleted. Change it again any time under **Settings → Change password**; that signs out every other session.

### Password reset

Delete the account file on the host and restart the backend. A new one-time password is generated exactly as on first start.

```bash
sudo rm /var/lib/homelab-dashboard/auth.json
sudo kubectl rollout restart deployment/homelab-backend -n homelab
sudo cat /var/lib/homelab-dashboard/initial-admin-password
```

### What is enforced, and where

The backend pod uses `hostNetwork`, so port **8000 on the host reaches the API directly**, without passing through the frontend's nginx. Every control therefore lives in the backend itself:

- Every `/api/*` route needs a session, except `/api/health`, `/api/auth/login` and `/api/auth/session`.
- Passwords are stored as scrypt hashes (N=2^15, r=8, p=3, random 16-byte salt) in `auth.json`, mode 0600.
- The session is a random token in an `HttpOnly`, `SameSite=Strict` cookie. Sessions live in memory: 12 hours idle, 7 days at most, and all of them end when the backend restarts.
- After 5 failed logins in a row, **all** logins are refused for 60 seconds, doubling up to 15 minutes. The lock is global because every client arrives from the same address behind the NodePort. Someone on your network can therefore lock you out for a while by guessing; they cannot get in that way.
- Requests that change state must carry an `Origin` header matching the host they were sent to. Scripts need to send it too, for example `curl -H "Origin: http://SERVER:30300" ...`.
- No CORS, no `/docs`, no `/openapi.json`.
- The frontend sends a Content-Security-Policy, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and runs as a non-root nginx with a read-only filesystem and no capabilities.
- Service URLs are accepted only when they are `http://` or `https://`.

### What is not protected

- **No TLS.** On plain HTTP anyone who can see the traffic between your browser and the server can read the password and the session cookie. This is why the dashboard must stay on networks you trust: the LAN, Tailscale or ZeroTier (the last two encrypt the path themselves). Never port-forward 30300, 8000 or the Ingress to the internet.
- **Cookies are shared across ports.** Browsers send the session cookie to every HTTP service on the same host name or IP, whatever the port. Any other service on this server could read it. Only run services you trust on the same address.
- The backend is privileged by design (see [below](#why-the-backend-needs-so-much-privilege)). Treat access to the dashboard as access to information about the whole host.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.14, FastAPI, uvicorn, psutil, httpx, kubernetes client (versions pinned in `backend/requirements.txt`) |
| Frontend | React 19, Vite 8, Leaflet 1.9, plain CSS (versions locked in `frontend/package-lock.json`) |
| Images | `python:3.14-slim`, `node:26-alpine` (build only), `nginxinc/nginx-unprivileged:1.30-alpine` |
| Orchestration | k3s (single node), Traefik Ingress (optional) |
| Font | JetBrainsMono Nerd Font, self-hosted (SIL OFL 1.1, licence in `frontend/src/assets/fonts/OFL.txt`) |

---

## Prerequisites

On the Linux host that runs k3s:

```bash
# k3s
curl -sfL https://get.k3s.io | sh -

# Docker (to build the images)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

`kubectl` must be on `PATH` (k3s installs it at `/usr/local/bin/kubectl`).

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/Matejejko/homelab_dashboard.git
cd homelab_dashboard
```

### 2. Name your network interfaces

The server's addresses are not typed in anywhere. The backend reads them from the interfaces named in `02-backend.yaml`, on every request, so a changed DHCP lease or a VPN that comes up later is picked up by itself. Check the names with `ip a` and edit them if yours differ:

```yaml
- name: DASHBOARD_LAN_IFACE
  value: "enp7s0"
- name: DASHBOARD_TS_IFACE
  value: "tailscale0"
- name: DASHBOARD_ZT_IFACE
  value: "ztsjsl3deb"
```

An interface that does not exist is reported as an empty address, and the matching link on the service cards is disabled. `deploy.sh` warns about it but carries on.

Optionally restrict the disk panel:

```yaml
- name: DASHBOARD_DISKS
  value: "/, /home"   # comma-separated mount points or device names
```

### 3. Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

The script:

1. Asks for the **server location** (it can look it up from your public IP through ip-api.com, or you enter coordinates). It is where the server and LAN peers are drawn.
2. Checks that the three configured **interfaces** exist and warns if one does not.
3. Asks for the **connection timeout**: how long a closed connection stays visible (`net.netfilter.nf_conntrack_tcp_timeout_established`).
4. Turns on **conntrack byte accounting** (`net.netfilter.nf_conntrack_acct=1`), persisted in `/etc/sysctl.d/99-homelab-conntrack-acct.conf`, and makes sure the `nf_conntrack` module loads at boot so that setting applies.
5. Builds `homelab-backend:latest` from `backend/` and `homelab-frontend:latest` from `frontend/`, imports both into k3s containerd, applies manifests `00` to `03` and waits for the rollout.
6. Prints the dashboard URL and, on a first deployment, the one-time login.

### 4. Open the dashboard

```
http://YOUR-SERVER-IP:30300
```

Run `./deploy.sh` again after any code or configuration change.

---

## Configuration Reference

Environment variables of the backend, in `02-backend.yaml`:

| Variable | Value in the manifest | Description |
|---|---|---|
| `DASHBOARD_LAN_IFACE` | `enp7s0` | Interface whose IPv4 address is the server's LAN address. Its subnet defines "LAN". |
| `DASHBOARD_TS_IFACE` | `tailscale0` | Tailscale interface. |
| `DASHBOARD_ZT_IFACE` | `ztsjsl3deb` | ZeroTier interface. Its subnet defines "ZeroTier". |
| `DASHBOARD_DATA_DIR` | `/data` | Holds `auth.json` and the one-time password. Mounted from `/var/lib/homelab-dashboard` on the host. |
| `DASHBOARD_SERVER_LAT` / `DASHBOARD_SERVER_LNG` | set by `deploy.sh` | Server position on the map. `0` / `0` means not set. |
| `DASHBOARD_DISKS` | *(empty)* | Comma-separated mount points or device names; empty shows all. |
| `HOST_PROC` / `HOST_SYS` / `HOST_ROOT` | `/host/proc` / `/host/sys` / `/host/root` | Where the host filesystems are mounted in the pod. |
| `SERVICES_FILE` | `/config/services.json` | Manual services, mounted from the ConfigMap. |

Files in `/var/lib/homelab-dashboard` on the host (mounted at `/data`):

| File | Purpose |
|---|---|
| `auth.json` | The account: scrypt hash and salt. Delete it to reset the password. |
| `initial-admin-password` | The one-time password. Exists only until the first password change. |
| `carto-api-key` | Optional. Your CARTO Basemaps API key for the map tiles, see [Map tiles need a CARTO API key](#map-tiles-need-a-carto-api-key). |

Per browser (localStorage): theme, groups, service overrides, manual map pins and, optionally, a server location that overrides the one from the manifest. Server addresses are never stored in the browser.

---

## Service Auto-Discovery

Sources are merged on every poll; discovery results are cached for 10 seconds. The first source to name a service wins.

### 1. Kubernetes Services

Every Service except those in `kube-system`, `kube-public`, `kube-node-lease` and the dashboard's own:

- **NodePort** → `http://localhost:<nodePort>` (the cards link to it through the LAN / ZeroTier / Tailscale address)
- **LoadBalancer** → external IP or hostname and port
- **ClusterIP with an Ingress** → the Ingress URL (`networking.k8s.io/v1` and Traefik `IngressRoute`)
- **ClusterIP without an Ingress** → skipped

### 2. Docker containers

Running containers with a published host port, through `/var/run/docker.sock`. Names and icons come from a keyword table matched against the image name (`KNOWN_IMAGES` in `backend/app/services.py`).

### 3. ConfigMap

For services the backend cannot see:

```bash
sudo kubectl edit configmap homelab-services -n homelab
```

```json
[{ "name": "NAS", "url": "http://192.168.0.20:5000", "port": 5000, "group": "Storage", "icon": "💾", "desc": "" }]
```

### How "online" is decided

An HTTP request is the wrong question for a Minecraft or Valheim server, so the check depends on what the dashboard knows about the service:

| Service | Check | Online when |
|---|---|---|
| **Web URL**: behind an Ingress or IngressRoute, or a URL from an annotation, label or the ConfigMap | HTTP GET | it answers with a status below 500 |
| **TCP port**: NodePort, LoadBalancer or published container port | TCP connect, then one HTTP request to see whether it is a web page | the port accepts the connection (and, if it does speak HTTP, the status is below 500) |
| **UDP port**: same sources, when the Service or container declares UDP | two one-byte datagrams | the port does not refuse them |

Things worth knowing:

- **TCP or UDP comes from the Service itself** (`spec.ports[0].protocol`), or from Docker's port type. The first port is the one shown and checked.
- **UDP has no handshake.** A healthy game server silently ignores packets it does not understand, so silence counts as online. A stopped one is refused (ICMP port unreachable, which is also what kube-proxy sends for a Service with no ready pod), and that counts as offline. UDP services therefore show no latency.
- **Certificates are not verified.** A service with a self-signed certificate is up, whatever a browser thinks of its certificate. The check sends nothing secret.
- **An Ingress is checked where it is published, not where DNS points.** The request goes to the address Kubernetes reports for the Ingress (for a Traefik IngressRoute: this node), with the Ingress host as `Host` header and TLS server name. A host name that only your browsers can resolve, or a `*.sslip.io` name that your router's DNS filters out, therefore does not read as offline. Redirects are not followed there; any answer below 500 counts. If nothing answers at that address, the URL itself is tried.
- **A port that accepts and hangs up at once is offline.** That is what a forwarder does when nothing is behind it.
- A TCP port that turned out not to speak HTTP is remembered for ten minutes, so a game server is not sent an HTTP request on every poll.
- For a service shown as a web URL, an open port is not enough: it has to answer HTTP. If a real web UI is wrongly treated as a bare port (or the other way round), set `homelab-dashboard/url` on the Service to say which it is.

### Labels and annotations

**Docker:**
```yaml
labels:
  homelab-dashboard.name: "Jellyfin"
  homelab-dashboard.icon: "📺"
  homelab-dashboard.desc: "Media server"
  homelab-dashboard.group: "Media"
  homelab-dashboard.url: "http://media.lan:8096"
  homelab-dashboard.enabled: "false"               # hide
```

**Kubernetes Service:**
```yaml
annotations:
  homelab-dashboard/name: "Jellyfin"
  homelab-dashboard/icon: "📺"
  homelab-dashboard/desc: "Media server"
  homelab-dashboard/group: "Media"
  homelab-dashboard/url: "https://jellyfin.example.com"
  homelab-dashboard/enabled: "false"
```

A URL from any source is used only if it starts with `http://` or `https://`. Anything else is ignored: a label falls back to the discovered port, a ConfigMap entry is shown without a link.

---

## Network Map

The backend runs `conntrack -L` for IPv4 and IPv6 (falling back to `/proc/net/nf_conntrack`) and keeps TCP flows in state `ESTABLISHED` and UDP flows marked `[ASSURED]`. Each flow is judged by its **original** direction:

- from outside to this host, a pod or a container → **inbound**, the peer is the source
- from this host, a pod or a container to outside → **outbound**, the peer is the destination
- everything else (pod to pod, loopback, link-local, multicast, broadcast) is ignored

Pods (`10.42.0.0/16`), cluster services (`10.43.0.0/16`) and the subnets of `docker0`, `br-*`, `cni*` and `flannel*` are internal: their addresses never appear as peers.

| Type | Shape and colour | Rule |
|---|---|---|
| ZeroTier | square, orange | inside the subnet of `DASHBOARD_ZT_IFACE` |
| Tailscale | diamond, violet | `100.64.0.0/10` or `fd7a:115c:a1e0::/48` |
| LAN | circle, blue | inside the subnet of `DASHBOARD_LAN_IFACE`, or any other private range |
| WAN | triangle, pink | everything else |

Direction is shown by the line, never by colour alone: dots moving toward the server are inbound, dashes moving away are outbound, a solid line is both. The peer list repeats it as an arrow and a word. Line weight grows with bytes (log scale), or with the number of flows when byte accounting is off.

### Where peers are drawn

| Peer | On the map? |
|---|---|
| WAN | At the position ip-api.com returns for the address. Until it has answered: *geolocation pending*. |
| LAN | At the server. All LAN peers share one **Local network · N** badge on the server marker; its popup lists them. |
| Tailscale, direct connection | At the position of the peer's public endpoint, read from `tailscaled`. The peer's Tailscale hostname is shown. |
| Tailscale, relayed | Not on map: *relayed, no direct endpoint*. |
| ZeroTier | Not on map: *private address*. There is no reliable way to tie a ZeroTier address to a physical endpoint, so none is guessed. |

Nothing is ever placed at an invented position.

### Map tiles need a CARTO API key

The basemap comes from CARTO (`dark_all` and `light_all`). **Since 25 September 2026 CARTO no longer serves these tiles without an API key**: a request without one gets a blank tile reading "API KEY REQUIRED" instead of the map. Markers, lines, popups and the peer list do not depend on the tiles and work either way.

A key is free for personal use. Request one at <https://carto.com/basemaps/apikey> (it arrives by e-mail), then save it on the server, alone in this file:

```bash
sudo mkdir -p /var/lib/homelab-dashboard
echo 'YOUR-KEY' | sudo tee /var/lib/homelab-dashboard/carto-api-key >/dev/null
sudo chmod 600 /var/lib/homelab-dashboard/carto-api-key
```

No restart and no redeploy: the backend reads the file on every `/api/config` request, so open dashboards pick it up within a minute, or at once on reload. To change the key, overwrite the file; to stop using it, delete the file.

- The key is kept **out of the repository and the manifests** on purpose. It is handed only to signed-in browsers (in `/api/config`, as `tile_key`), which add it to the tile URLs as `?key=...`. It is never written to the logs.
- Paste the key exactly as issued. Keys are case-sensitive, and CARTO treats a wrong or incomplete key as no key: the notice stays and no error is shown. Your browser also caches tiles, so reload after adding a key.
- Leave the key **without website restrictions**. CARTO checks restricted keys against the `Referer` header, and this dashboard sends `Referrer-Policy: no-referrer`, so a restricted key is refused ("Map tiles unavailable" then appears on the map).
- CARTO's terms require the attribution and its notices to stay visible. Do not hide the notice with CSS.

### Accuracy

**Locations are IP-geolocation estimates: city-level at best. Mobile and VPN users appear at their carrier or VPN exit.** A marker shows roughly where an address is registered, not where a person is.

### Privacy: ip-api.com

To place WAN peers and direct Tailscale endpoints, their **IP addresses are sent to ip-api.com over unencrypted HTTP** (the free endpoint offers no HTTPS). At most 100 addresses per poll are looked up, the busiest peers first; results are cached for 24 hours (up to 5,000 entries) and the service's rate-limit headers are honoured. If you do not want addresses to leave your network, block `ip-api.com` for this host: WAN peers then stay listed as *geolocation pending* and everything else keeps working.

### Byte counters

Bytes per peer need `net.netfilter.nf_conntrack_acct=1`, which `deploy.sh` enables. Flows that already existed when it was switched on have no counters. Without accounting the list says so and ranks peers by flows.

### Limits

- At most 200 peers are returned, the busiest first; the list says when it is a subset.
- Markers of peers in the same city overlap. Use the peer list: clicking a row pans to the marker and opens its popup.
- The map follows the data until you pan or zoom; **Fit** turns that back on.
- You can add **manual pins** under Settings (hollow markers). They are positions you chose, not measurements.
- Polling: system 5 s, network 10 s, services 15 s, addresses 60 s.

---

## Editing Services in the UI

- **Pencil** on a card: name, icon, description and group (saved in the browser; "Reset to default" removes the override).
- **Grouped** view: drag cards between groups, rename or delete a group with the buttons next to its title (or double-click the title), **+ Group** to add one.

---

## Multi-Network Access

| Link | Active when | URL |
|---|---|---|
| LAN | the LAN interface has an IPv4 address | `http://<LAN address>:<port>` |
| ZeroTier | the ZeroTier interface has one and the service has a host port | `http://<ZeroTier address>:<port>` |
| Tailscale | the Tailscale interface has one and the service has a host port | `http://<Tailscale address>:<port>` |

---

## Optional: Traefik Ingress (port 80)

```bash
sudo kubectl apply -f 04-ingress.yaml
```

It matches any host on port 80 by default. This is still plain HTTP: the same rule applies, keep it off the internet.

---

## Why the Backend Needs So Much Privilege

| Setting | Why |
|---|---|
| `hostNetwork: true` | real interface addresses and I/O counters; conntrack sees the host's table |
| `hostPID: true` | `/proc/1/mounts` is the host's mount table |
| `/proc`, `/sys`, `/` mounted | CPU, RAM, temperature, disk usage; the Tailscale socket under `/run` |
| `/var/run/docker.sock` | container discovery |
| `/var/lib/homelab-dashboard` → `/data` | the account file survives pod restarts |
| `privileged: true` | reading host `/proc` and `/sys`, running `conntrack` |

A consequence of `hostNetwork` is that the API listens on the host's port 8000. That is why authentication is enforced in the backend and not in nginx.

---

## Development

```bash
# Backend tests
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest

# Backend, locally
DASHBOARD_DATA_DIR=./data uvicorn app.main:create_app --factory --port 8000

# Frontend (the dev server proxies /api to 127.0.0.1:8000)
cd frontend
npm ci
npm run dev
npm run build
```

---

## Useful Commands

| What | Command |
|---|---|
| Pod status | `sudo kubectl get pods -n homelab` |
| Backend logs (logins are logged, never secrets) | `sudo kubectl logs -n homelab deploy/homelab-backend -f` |
| Frontend logs | `sudo kubectl logs -n homelab deploy/homelab-frontend -f` |
| One-time password | `sudo cat /var/lib/homelab-dashboard/initial-admin-password` |
| Set the map tile key | `echo 'YOUR-KEY' \| sudo tee /var/lib/homelab-dashboard/carto-api-key >/dev/null` |
| Edit manual services | `sudo kubectl edit configmap homelab-services -n homelab` |
| Is byte accounting on? | `sysctl net.netfilter.nf_conntrack_acct` |
| Change the connection timeout | `sudo sysctl -w net.netfilter.nf_conntrack_tcp_timeout_established=300` |
| Tear everything down | `sudo kubectl delete namespace homelab` (the account file stays in `/var/lib/homelab-dashboard`) |

---

## Repo Structure

```
homelab_dashboard/
├── backend/
│   ├── app/
│   │   ├── main.py            # app factory and routes
│   │   ├── auth.py            # account, sessions, throttle, request checks
│   │   ├── system.py          # host metrics, interface addresses
│   │   ├── services.py        # discovery and health checks
│   │   ├── network.py         # conntrack parsing, classification, Tailscale
│   │   └── geo.py             # ip-api.com lookups and cache
│   ├── tests/                 # pytest suite and conntrack fixtures
│   ├── requirements.txt       # pinned runtime dependencies
│   ├── requirements-dev.txt   # + pytest
│   ├── services.json          # fallback for manual services
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/        # one React component per file
│   │   ├── hooks/             # polling, theme
│   │   ├── styles/            # tokens, base, dashboard, network
│   │   └── assets/fonts/      # JetBrainsMono Nerd Font + OFL.txt
│   ├── package.json, package-lock.json, vite.config.js, index.html
│   ├── nginx.conf             # static files, /api proxy, security headers
│   └── Dockerfile             # node build stage → unprivileged nginx
├── deploy.sh                  # interactive build + import + apply + rollout
├── 00-namespace.yaml
├── 01-configmap.yaml          # manual services
├── 02-backend.yaml            # ServiceAccount, RBAC, Deployment, Service, env
├── 03-frontend.yaml           # Deployment (non-root, read-only) + NodePort :30300
└── 04-ingress.yaml            # optional Traefik Ingress on port 80
```

---

## Notes & Gotchas

- **"API KEY REQUIRED" on the map** is CARTO's notice for tile requests without a valid key. Put your key in `/var/lib/homelab-dashboard/carto-api-key`, see [Map tiles need a CARTO API key](#map-tiles-need-a-carto-api-key).
- **Sessions end when the backend restarts** (every `./deploy.sh`): sign in again.
- **Temperature** shows "n/a" when the host has no readable sensor.
- **A UDP service shows "online" without a latency.** That is expected, see [How "online" is decided](#how-online-is-decided).
- **Multi-node clusters**: the backend must run on the node whose hardware you care about. Add a `nodeSelector` in `02-backend.yaml`.
- **Clearing localStorage** resets theme, groups, overrides, manual pins and the browser's own server location. It does not sign you out.
- **Recreate** is the backend's update strategy because two `hostNetwork` pods cannot both bind port 8000.
