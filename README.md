# Inspectria

Included features:
- Dashboard summary cards
- Report filtering
- Excel export
- Admin user management
- Multi-organization SaaS data isolation
- PostgreSQL backend storage

## SaaS user model
- `platform_admin`: manages the whole platform and can approve new organization admins.
- `admin`: manages only their own organization's users, checklists, assignments, and reports.
- `user`: can work only on assignments and reports available to their own organization.

Every tenant-owned table stores `organization_id`, and backend routes filter by the logged-in user's organization. Tenant isolation is enforced in the API, not in the browser.

## First admin users
On a fresh PostgreSQL database, the backend creates the initial platform admin and
tenant admin only when secure credentials are provided with environment variables.
There are no fallback admin passwords.

Set these before the first backend start:
```bash
export PLATFORM_ADMIN_USERNAME="your-platform-admin"
export PLATFORM_ADMIN_PASSWORD="use-a-long-random-password-1"
export DEFAULT_ADMIN_USERNAME="your-tenant-admin"
export DEFAULT_ADMIN_PASSWORD="use-a-long-random-password-2"
export DEFAULT_ORGANIZATION_NAME="Your Demo Organization"
```

Admin seed passwords must be at least 12 characters and must not be common
defaults such as `1234`, `password`, `admin`, or `ChangeMe123!`.

## PostgreSQL
Create a database and set `DATABASE_URL` before starting the backend:
```bash
createdb inspectra
export DATABASE_URL="postgres://inspectra:inspectra@localhost:5432/inspectra"
```

Or start a local PostgreSQL with Docker:
```bash
docker compose -f docker-compose.postgres.yml up -d
export DATABASE_URL="postgres://inspectra:inspectra@localhost:5432/inspectra"
```

For hosted PostgreSQL providers that require SSL:
```bash
export PGSSLMODE=require
```

See [backend/.env.example](backend/.env.example) for the supported environment variables.

## Backend
```bash
cd backend
npm install
npm start
```

## Frontend
```bash
cd frontend
npm install
npm run dev
```

## macOS
For a production-style local install on macOS, run:
```bash
chmod +x start_mod_checklist_server_forever.command install_macos_autostart.sh uninstall_macos_autostart.sh
./start_mod_checklist_server_forever.command
```

The app will be available at:
```text
http://localhost:4000
```

To start the app automatically when you log in to macOS:
```bash
./install_macos_autostart.sh
```

To remove macOS autostart:
```bash
./uninstall_macos_autostart.sh
```

Notes:
- If the project was copied from Windows, run `npm --prefix frontend install` and `npm --prefix backend install` once on the Mac. The macOS launcher also installs missing dependencies.
- Node.js and npm must be installed.
- PostgreSQL must be running and `DATABASE_URL` must point to the target database.


## Additional Features
- Admin can edit existing checklist templates
- Admin can delete checklist templates that do not have assignment history

## Server Autostart
For a production-style install on Windows:

1. Build and run the app with:
```bat
start_mod_checklist_server_forever.bat
```

2. Install automatic startup as Administrator:
```powershell
powershell -ExecutionPolicy Bypass -File .\install_windows_autostart.ps1
```

After that, Windows will start Inspectria automatically on boot and restart it if the process stops.

Important:
- A program cannot power on a fully shut down computer by itself.
- If you want the computer to wake remotely after shutdown, enable Wake-on-LAN in BIOS/UEFI and the network adapter settings, then send a Wake-on-LAN packet from another device.
