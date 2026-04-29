# Tool QR Register

A simple local QR asset system for logging tools out and back in.

## Open it

Open `index.html` in a browser, or run the local server if you want camera scanning to work more reliably:

```powershell
& "C:\Users\VodiaTrinidad\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

Then visit:

```text
http://localhost:4173
```

## What it does

- Starts with the registered Jundee Milwaukee tooling from `milwaukee reg jundee.xlsx`.
- Add tools with their own asset number, name, category, and home location.
- Generate printable QR labels for every tool.
- Scan a QR code or type the asset number.
- Log a tool out to a person with notes.
- Return a tool.
- Email foremen when a tool is logged out or returned.
- Lock tool add/remove and register import behind admin mode.
- Keep a movement history.
- Export and import a JSON backup.

## Render setup

Create a Render Web Service from this folder/repo.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

```text
ADMIN_PIN=choose-a-secure-pin
SMTP_HOST=your-mail-server
SMTP_PORT=587
SMTP_USER=your-email-login
SMTP_PASS=your-email-password-or-app-password
SMTP_FROM=tool-register@yourdomain.com
FOREMAN_EMAILS=foreman1@example.com,foreman2@example.com
SITE_NAME=Jundee
DATA_FILE=/var/data/tool-register.json
```

For permanent storage on Render, add a persistent disk and set `DATA_FILE` to a path on that disk, for example `/var/data/tool-register.json`.

## Notes

The register saves data in the browser on this computer. Use **Export backup** regularly if the register matters operationally.

When hosted on Render, the register saves to the server data file instead of only this browser.

The default local admin PIN is `1234`. On Render, set `ADMIN_PIN` in the environment variables.

QR rendering uses the `qrcodejs` browser library from jsDelivr. If the computer is offline, the register still works, but QR images may not render until the page has internet access.

The source register contains duplicate asset numbers `JT014` and `JB031`. Their QR labels include the serial number so each physical item can still be logged separately. The duplicated asset numbers should be corrected in the master register when practical.
