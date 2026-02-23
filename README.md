# 🛡️ Rei-Warden Backup Manager

A full-stack web application to manage and monitor [Vaultwarden](https://github.com/dani-garcia/vaultwarden) backups to cloud storage providers via [rclone](https://rclone.org/).

## Features

- **Dashboard** — Live status cards (Last Backup Time, Storage Used, Backup Status), real-time progress, manual backup trigger
- **Cloud Provider Configuration** — Google Drive, Dropbox, and OneDrive support via rclone
- **Log Viewer** — Terminal-style scrollable log output with live polling
- **Retention Policy** — Automatically delete backups older than N days; optional cron schedule
- **Authentication** — Password-protected dashboard (env-var configurable)
- **Docker-first** — Runs alongside Vaultwarden via `docker compose`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS (dark mode) |
| Backend | Node.js 20 + Express |
| Cloud sync | [rclone](https://rclone.org/) |
| Archive | `tar` (gzip) |
| Containers | Docker + Docker Compose |

---

## Quick Start (Google Cloud VM)

### 1. Provision a VM

Create a VM in Google Cloud Console or with `gcloud`:

```bash
gcloud compute instances create rei-warden \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --tags=http-server,https-server \
  --zone=us-central1-a
```

Open port 3001 (and 8080 for Vaultwarden):

```bash
gcloud compute firewall-rules create allow-warden \
  --allow tcp:3001,tcp:8080 \
  --target-tags http-server,https-server
```

### 2. Install Docker

SSH into the VM and run:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin
sudo apt-get install -y docker-compose-plugin
```

### 3. Clone and configure

```bash
git clone https://github.com/duynguyen2626/rei-warden-manager.git
cd rei-warden-manager

# Create your environment file
cp backend/.env.example .env
```

Edit `.env`:

```env
# Password to log in to the dashboard
APP_PASSWORD=your_very_secure_password

# A long random string for JWT signing (generate with: openssl rand -hex 64)
JWT_SECRET=your_jwt_secret_here
```

### 4. Launch

```bash
docker compose up -d
```

- **Rei-Warden Manager**: http://&lt;VM_IP&gt;:3001
- **Vaultwarden**: http://&lt;VM_IP&gt;:8080

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `APP_PASSWORD` | `changeme` | Dashboard login password (plain text or bcrypt hash) |
| `JWT_SECRET` | *(random)* | Secret for JWT signing — **set this in production** |
| `PORT` | `3001` | Backend port |
| `DATA_DIR` | `/vw-data` | Path to Vaultwarden data directory |
| `BACKUP_DIR` | `/backups` | Local staging directory for archives |
| `LOG_FILE` | `/var/log/backup.log` | Path to backup log file |
| `CONFIG_DIR` | `/app/config` | Directory for persistent settings (remotes, retention, password hash) |
| `RCLONE_CONFIG_FILE` | `/root/.config/rclone/rclone.conf` | Path to the rclone config file used by backend |

---

## Configuring Cloud Providers

### Google Drive

1. On a **local machine** (with rclone installed), run:
   ```bash
   rclone authorize "drive"
   ```
   This opens a browser for OAuth2 consent and prints a token JSON.

2. In the Rei-Warden Manager UI → **Cloud Config** → **Add Remote**:
   - Type: `Google Drive`
   - Client ID / Client Secret: your Google Cloud OAuth credentials
   - Token: paste the JSON token from the `rclone authorize` step
   - Destination folder: e.g., `VaultwardenBackups`

### Dropbox

1. Create a Dropbox app at https://www.dropbox.com/developers/apps
2. Run `rclone authorize "dropbox"` locally to get a token
3. In the UI, fill in App Key, App Secret, and Token

### OneDrive

1. Register an app in Azure portal (App registrations)
2. Run `rclone authorize "onedrive"` locally to get a token
3. In the UI, fill in Client ID, Client Secret, and optionally Tenant ID

---

## Backup Flow

1. **Archive**: `tar -czf backup-<timestamp>.tar.gz /vw-data/`
2. **Upload**: `rclone copy` to all configured remotes
3. **Retention**: Files older than the retention window are deleted from remotes
4. **Status**: Updated in the dashboard in real-time

---

## Scheduled Backups

In **Settings**, enter a cron expression (e.g., `0 2 * * *` for 2 AM daily). The schedule is saved to `/app/config/settings.json` and restored on container restart.

---

## Security Notes

- All API routes (except `/api/auth/login`) require a valid JWT
- Login endpoint is rate-limited (20 requests / 15 minutes)
- Remote names are validated against an allowlist (`[a-zA-Z0-9_-]`)
- File paths are escaped before shell interpolation
- Vaultwarden data is mounted **read-only** inside the backup manager container

---

## Development

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (in another terminal)
cd frontend && npm install && npm run dev
```

The frontend dev server proxies API requests to `http://localhost:3001` by default (configure via `VITE_API_URL`).

---

## Docker Volumes

| Volume | Purpose |
|---|---|
| `vw-data` | Shared with Vaultwarden (mounted read-only in backup manager) |
| `backups` | Local staging for `.tar.gz` archives |
| `config` | Persistent settings and rclone configuration (settings.json, rclone.conf) |
| `logs` | Backup logs |

---

## License

MIT
