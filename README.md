# GoalOS — Google Sheets Stay-Connected Edition

GitHub Pages site. Upload the files **inside this folder** to your public GitHub repository root. There is no private JSON, Google client secret, Gmail, Drive backup, or reminder in this website package.

## New in this version
- Refreshing the same browser tab restores your short-lived Google Sheets authorization from sessionStorage while valid (instead of dropping it on every refresh).
- Google Sheet link, last confirmed save, and pending edits are remembered in localStorage, with clear sync status and conflict protection.
- **Disconnect this device** explicitly clears the session and prevents automatic resume, without deleting Google Sheets data.
- **Copy link for another device** shares a private, hash-fragment deep link that pre-selects the same Sheet. You must authorize with your own Google account on each device.
- When Google's token expires, click **Resume Google Sheets**. It reuses prior consent where Google allows, but a Google popup is required for security.

## Important limitations
A static GitHub Pages app cannot keep a Google OAuth token valid forever, silently renew an expired token, or automatically authorize a different browser/device. To do so securely without prompts would require a separately hosted backend and server-managed sessions. No tokens are stored in website files or localStorage; unexpired short-lived token lives only in sessionStorage in this tab.

First deployment: GitHub Pages, Google Sheets API, OAuth Web Client, OAuth test user or published app; then connect once and create or attach a Sheet. View SETUP_SHEETS.md for detailed instructions. Keep JSON backups periodically.
