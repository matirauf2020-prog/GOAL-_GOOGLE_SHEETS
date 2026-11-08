# GoalOS 2026 — Google Sheets Sync Setup

This version uses **GitHub Pages for the website** and **your private Google spreadsheet for data**. There are **no Gmail reminders, Google Drive backups, Google Apps Script schedulers, servers, passwords, or secret API keys** in this package. All workbook data is kept *out* of the public GitHub repository.

## 1. Upload the website to GitHub Pages

1. Open the ZIP and **extract all its files** into one folder.
2. On GitHub, open your GoalOS repository (or create `goalos-2026`).
3. Upload **the extracted website files**, including `index.html`, `app.js`, `sheet-sync.js`, `styles.css`, `site-config.js`, and `sw.js`, directly into the repository root. **Do not upload the ZIP itself.**
4. In repository **Settings → Pages**, choose **Deploy from a branch → main → /(root) → Save**.
5. Wait for GitHub's deployment indication, then open `https://YOUR-USERNAME.github.io/goalos-2026/`. This HTTPS address is needed for Google OAuth.

If you already hosted an earlier version, replace the old website files, delete `drive-sync.js` and any old Gmail/Apps Script files from your repo, and refresh the website. The service worker is versioned to refresh old cached assets.

## 2. Set up Google Sheets API and OAuth (one-time)

1. Visit <https://console.cloud.google.com/> and create or select a Google Cloud project.
2. Go to **APIs & Services → Library**, find **Google Sheets API**, and click **Enable**.
3. Configure the **Google Auth Platform / OAuth consent screen** for your project. If you use an external app in testing mode, add **your Google email** as a test user. The app only needs `https://www.googleapis.com/auth/spreadsheets` and you may need to add that scope in Data Access.
4. Go to **Clients / Credentials → Create OAuth client ID → Web application**.
5. Under **Authorized JavaScript origins**, add your exact origin, e.g. `https://YOUR-USERNAME.github.io`. **Do not include** `/goalos-2026/` in the origin. If you use a custom domain, add its origin too.
6. Copy the **OAuth Client ID** (usually ends in `.apps.googleusercontent.com`). Open the downloadable website's `site-config.js` and replace the placeholder:

   ```js
   window.GOALOS_GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
   ```

7. Upload the changed `site-config.js` to your GitHub repository and wait for GitHub Pages to deploy.

**Never put an OAuth client secret, access token, password, service-account key, or private spreadsheet content into GitHub.** An OAuth **Client ID** is intended to be public and is safe in a static front-end. Granting the Sheets scope allows GoalOS to access Google spreadsheets with your authorization; only authorize apps you trust.

## 3. Connect, create your Google Sheet, and import your data

1. Open your **live GitHub Pages GoalOS** site.
2. Click **Settings & Google Sheets → Connect Google**.
3. Select the intended Google account and approve Google Sheets permission. Allow the Google popup if your browser blocks it.
4. Click **Create private Sheet**. GoalOS creates a restricted spreadsheet in your own account named `GoalOS — Personal Data (Private)`.
5. If you haven't imported your workbook yet, click **Import JSON** in GoalOS and select the private JSON that was provided separately, e.g. `GoalOS_2026_Updated_Data.json`. Do NOT add this JSON to GitHub.
6. Click **Save all data to Sheet** and look for **Saved to Sheets** on the toolbar. Verify that the `Transactions`, `Goals`, and `Loans` tabs are populated by clicking **Open my private Google Sheet**.

Changes made to transactions, tasks, loans, or workspace settings are then auto-saved to Sheets after about 1.3 seconds **while connected and authorized**. The browser also keeps a local offline copy.

## 4. Use your data on another computer or phone

1. Open the same GitHub Pages site, and **Connect Google** using the **same Google account**.
2. In Google Sheets, open the Sheet you created on the first device; copy its URL.
3. Paste it into **Existing GoalOS Google Sheet link or ID → Use this Sheet**.
4. On a fresh device with no local workspace, GoalOS loads your full cloud data. If the browser also has unrelated local data, GoalOS waits for you to choose which copy to keep. Use **Load data from Sheet** to keep the cloud copy.

This also recovers your records after browser cache deletion: use the Sheet URL and the same Google account.

## 5. Understand sync and data safety

- **What is stored?** Your full workspace (including the original 11 imported workbook sheets, complete task history, settings, transactions, and loans) is stored losslessly in the hidden `GoalOS_State` tab. `Transactions`, `Goals`, `Loans`, `Settings`, and `Workbook_Archive` are **readable mirrors**.
- **Do not manually edit the mirror tabs** and expect GoalOS to read those changes. Edit records in the GoalOS website; mirror tabs are rewritten by the app. Cloud restore reads the hidden complete snapshot.
- The hidden snapshot uses **two slots**: new data is written to the inactive slot and the active pointer is switched only after the other write operations succeed. This reduces risk of incomplete saves, but it is not a substitute for an independent backup.
- **No connection?** GoalOS still saves edits to local browser storage. Reconnect and check for **Saved to Sheets**. Until then, those edits are **not backed up in Google Sheets**.
- **Authorization expires:** You may need to click **Connect Google** again after reopening the app or about an hour later. A static GitHub Pages site cannot renew tokens in the background when fully closed.
- **Two devices:** Avoid editing the same workspace simultaneously. If remote changes are detected, the app stops and asks you to load the remote copy or deliberately overwrite it.
- **Sharing:** In your Google Sheet, leave **Share → General access → Restricted**. Google Sheets access and retention depend on the Google account, permissions, quota, and account/service status. No system can promise data will exist forever.
- **Recommended extra protection:** Occasionally use **Export JSON** to download a separate backup and consider Google Sheets version history. Never upload a backup to a public GitHub repo.
- **Sheet ID is not a password.** The app uses Google's OAuth authorization and your Sheet permissions. It does **not** store Google access tokens in localStorage or a GitHub file.
- Google API quotas may apply. Repeated rapid changes are coalesced into a single upload.

## What you should see in Google Sheets

- **Transactions** — each entry, category, date, account, amount and notes.
- **Goals** — goal title, deadline, status, category, blockers and history.
- **Loans** — person, amount, due date, payments and current status.
- **Settings** — planning year, currency, accounts and categories.
- **Workbook_Archive** — index of imported original workbook sheets.
- **GoalOS_State** (hidden) — authoritative copy of **all** data, including the full original workbook sheet contents.

## Troubleshooting

| Issue | Fix |
| --- | --- |
| `Client ID` missing | Edit `site-config.js` and republish to GitHub. |
| `origin_mismatch` | Authorized JavaScript origin must be `https://YOUR-USERNAME.github.io` without `/repo/`; add custom origin if applicable. |
| `access blocked / app not verified` | In Google Cloud OAuth consent / Audience, add your Google account as a **test user**, then retry. |
| `Google Sheets API has not been used` | Enable **Google Sheets API** for the same project as your OAuth Client ID. |
| `Permission denied` | Sign into the Google account that owns the sheet or has edit access. |
| `Sync conflict` | Save an independent JSON backup, then choose **Load data from Sheet** or **Save all data to Sheet**. |
| Toolbar says `Google disconnected` | Reconnect. Unsent changes stay only on this device until saved. |
| Old Drive/reminder controls still appear | Confirm the **new** ZIP files replaced all old files; refresh page or clear that site's service worker cache. |

## Verify before relying on the cloud

1. Save a test transaction.
2. Wait for the top bar to show **Saved to Sheets**.
3. Open Google Sheets and check the test row.
4. Use **Load data from Sheet** on another browser or device and verify the test transaction is there.
5. Keep an exported JSON copy as an emergency fallback.


## Important: stay connected after refresh / use other devices

1. Update **all website files** from this ZIP in GitHub (including `index.html`, `app.js`, `sheet-sync.js`, `site-config.js`, `sw.js`). GitHub Pages deploys them automatically.
2. Open the live page, then press **Ctrl+Shift+R** once. If an old service worker persists, try a private window for diagnosis or clear this site's cached files (export your local JSON first — do not clear local data if it is not saved in Sheets).
3. Under **Settings & Google Sheets**, click **Connect Google** once, select the Google account with access to your Sheet, and attach the existing Sheet if needed. Do NOT create a new Sheet if your data is already saved in one.
4. Save your data and confirm it says **Saved to Sheets**. A refresh in the same tab now retains authorization until the token expires.
5. For another device, open Settings and click **Copy link for another device**. Open the link in the other device and select **Connect/Resume Google Sheets**. Sign into the same Google account, then GoalOS should load the existing Sheet.
6. The **Disconnect this device** button intentionally clears this tab's authorization and prevents automatic resume until you connect again. Your cloud data stays in the Sheet.

**Google OAuth limits:** Google's browser token model requires a user action for a new access token and does not support silent background token refresh. Even this updated site cannot promise to keep the Google account authorized for weeks or after token expiry. The Sheet association, local unsaved data, and URL handoff persist; access may require a one-click Google authorization. Never paste your OAuth client secret into public website files. If a client secret has appeared in a shared screenshot or chat, rotate it in Google Cloud Console.
