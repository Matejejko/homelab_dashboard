Step-by-step setup

1 — Copy the files onto your server
bash# From your PC, SCP the whole folder to your server
scp -r homelab/ user@192.168.1.100:~/homelab

# Or if you're already on the server, just create the folder structure manually

2 — Install system dependencies (one time)
bashsudo apt update
sudo apt install python3 python3-pip python3-venv nodejs npm lm-sensors -y

# Optional: detect temperature sensors

sudo sensors-detect --auto
3 — Run the automated setup script
bashcd ~/homelab
chmod +x setup.sh
./setup.sh
That's it. The script does everything — installs Python packages, builds the React app, sets your server's IP automatically, and registers two systemd services that start on boot.
4 — Open the dashboard
http://YOUR-SERVER-IP:3000
The API runs on port 8000, the dashboard on port 3000.

Manual setup (if you prefer not to use the script)
bash# Backend
cd ~/homelab
python3 -m venv venv
venv/bin/pip install -r backend/requirements.txt
venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --app-dir backend

# Frontend (separate terminal)

cd ~/homelab/frontend
echo "REACT_APP_API_URL=http://YOUR-SERVER-IP:8000" > .env
npm install
npm run build
npx serve -s build -l 3000

Edit your services list
bashnano ~/homelab/backend/services.json
Just add/remove entries. The backend reloads the file on every /api/services request — no restart needed.
Useful commands
bashsudo systemctl status homelab-dashboard-api # is backend running?
sudo journalctl -u homelab-dashboard-api -f # live backend logs
sudo systemctl restart homelab-dashboard-api # restart after changes
Notes

Temperature requires lm-sensors to be installed. It'll show "Not available" otherwise — no crash.
Services are checked by actually doing an HTTP request to localhost:PORT. Any response (even a login page) = online. Timeout = offline.
The API has a /docs page (Swagger UI) at http://YOUR-IP:8000/docs so you can inspect the raw data.
