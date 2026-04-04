# 🖥️ Homelab Dashboard — Setup Guide

A real-time system + services dashboard for your home server.  
Backend runs on **port 8000** · Frontend runs on **port 3000**

---

## Before You Start

Make sure you have these installed on your server:

```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv nodejs npm lm-sensors -y
```

> **Optional — enable CPU temperature monitoring:**
> ```bash
> sudo sensors-detect --auto
> ```

---

## Setup

### Step 1 — Copy files to your server

From your local PC, transfer the project folder:

```bash
scp -r homelab/ user@192.168.1.100:~/homelab
```

Or if you're already logged into the server, place the files directly under `~/homelab/`.

---

### Step 2 — Run the setup script

```bash
cd ~/homelab
chmod +x setup.sh
./setup.sh
```

The script automatically:
- Creates a Python virtual environment and installs backend dependencies
- Detects your server's local IP and writes it into the frontend config
- Builds the React frontend
- Registers two systemd services that start on boot

---

### Step 3 — Open the dashboard

Once the script finishes, open your browser to:

```
http://YOUR-SERVER-IP:3000
```

---

## Manual Setup (no script)

If you prefer to run things yourself, use two terminal windows:

**Terminal 1 — Backend API**
```bash
cd ~/homelab
python3 -m venv venv
venv/bin/pip install -r backend/requirements.txt
venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend
```

**Terminal 2 — Frontend**
```bash
cd ~/homelab/frontend
echo "REACT_APP_API_URL=http://YOUR-SERVER-IP:8000" > .env
npm install
npm run build
npx serve -s build -l 3000
```

> Replace `YOUR-SERVER-IP` with your actual server IP, e.g. `192.168.1.100`

---

## Adding / Removing Services

Edit the services config file — no restart required, the backend reloads it on every request:

```bash
nano ~/homelab/backend/services.json
```

Each service entry looks like this:

```json
{
  "name": "Jellyfin",
  "desc": "Media server",
  "url": "http://localhost:8096",
  "group": "Media",
  "icon": "📺"
}
```

| Field   | Required | Description |
|---------|----------|-------------|
| `name`  | ✅ | Display name |
| `url`   | ✅ | Full URL the backend will ping to check status |
| `group` | ✅ | Tab group — `Media`, `Network`, `Dev`, `Home`, or any custom label |
| `desc`  | ❌ | Short description shown on the card |
| `icon`  | ❌ | Any emoji |

---

## Useful Commands

| What | Command |
|------|---------|
| Check backend status | `sudo systemctl status homelab-dashboard-api` |
| Check frontend status | `sudo systemctl status homelab-dashboard-ui` |
| View live backend logs | `sudo journalctl -u homelab-dashboard-api -f` |
| Restart backend | `sudo systemctl restart homelab-dashboard-api` |
| Restart frontend | `sudo systemctl restart homelab-dashboard-ui` |

---

## API Reference

The backend exposes these endpoints (useful for debugging):

| Endpoint | Returns |
|----------|---------|
| `GET /api/system` | CPU, RAM, disk, uptime, temperature, network I/O |
| `GET /api/services` | Service list with live status and ping times |
| `GET /api/health` | Simple `{ ok: true }` heartbeat |
| `GET /docs` | Interactive Swagger UI for the API |

Browse the API directly: `http://YOUR-SERVER-IP:8000/docs`

---

## Notes

- **Temperature** shows "Not available" if `lm-sensors` isn't installed — the dashboard won't crash, it just skips that card.
- **Service status** is determined by sending an HTTP request to `localhost:PORT`. Any response — even a login page or a 401 — counts as **online**. A timeout or connection refused = **offline**.
- **Ping time** shown on each service card is the real round-trip time measured by the backend at check time.
