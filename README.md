# Inspectria

Included features:
- Dashboard summary cards
- Report filtering
- Excel export
- Admin user management
- Multi-organization SaaS data isolation
- PostgreSQL backend storage

## Report archive

Completed checklist and walkthrough reports older than 90 days automatically
leave the active lists and dashboard totals. The cutoff uses the completion time;
exactly 90-day-old reports remain active. Walkthrough drafts remain active
regardless of age. Legacy completed walkthroughs without a completion timestamp
use their last update time (or creation time).

Reports and photos are preserved in the database. Open **Archive** on the
Completed Reports / My Reports screen to browse older reports, 20 at a time,
and open their details for the usual export and email actions. The archive is
loaded only when opened, with the same organization and user access rules as
active reports. No scheduled job or permanent deletion is required.

The backend list APIs accept `archived=true`, `offset` (default 0), and `limit`
(default 20, maximum 50) for archive requests. Normal list requests return only
active reports. Restart the backend to apply this behavior and its database
indexes, and rebuild the frontend for the archive controls.

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

## Email Delivery
Report emails are sent through SMTP. For a Natro/XMail mailbox, add the mailbox
settings to `backend/.env`:
```bash
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=reports@yourdomain.com
SMTP_PASS=your-mailbox-password
MAIL_FROM="Inspectria Reports <reports@yourdomain.com>"
CONTACT_TO=info@yourdomain.com
PUBLIC_APP_URL=https://inspectria.com
```

Use the exact hostname, port, and security mode shown in the Natro control
panel if they differ from this example. Restart the backend after changing
these values. You can verify the SMTP connection with:
```bash
cd backend
npm run email:verify
```

Template share emails use `info@inspectria.com` as the sender and include an
import link based on `PUBLIC_APP_URL`.

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
