# GoalOS 2026 — GitHub Pages + Google Sheets edition

Interactive private goal/finance/loan tracker. Deploy all files at the root of a GitHub Pages repository.

- **Google Sheets is the cloud data store** (with readable tables + lossless hidden JSON snapshot).
- **Local cache** works temporarily offline; pending edits sync after reconnect, subject to conflict checks.
- **No Google Drive backup, no Gmail reminders, no Apps Script.**
- Your original Excel converted JSON is **not included in this public website ZIP**.
- See **SETUP_SHEETS.md** for deployment, Google Cloud OAuth, permissions, and troubleshooting.

**First use:** Set OAuth Client ID in `site-config.js` → publish → Connect Google → Create private Sheet → Import your private JSON → Save all data to Sheet.

If you already have a Sheet from this version: Connect Google → Paste Sheet URL → Use this Sheet → Load data from Sheet.

Important: Do not manually edit the readable Sheet tabs; edit in the GoalOS app so cloud state stays consistent. Your Sheet and account should remain private and active. Export JSON periodically for independent backup.
