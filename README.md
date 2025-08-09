<<<<<<< HEAD
# texfind
Texture Finder SAMP
=======
# TexFind (Stable Deploy Build)

**What’s inside**
- Base textures import from **CSV/TSV/TXT** (supports comma/semicolon/tab/pipe OR fixed-width with 2+ spaces).
- Required headers (case-insensitive): `modelid`, `txdname`, `texturename`, `url`. If `url` is blank, it's auto-filled.
- Search & filters appear after data loaded.
- Grid preview + detail modal with copyable commands.
- Favorites with **folders**, choose-folder modal, and **Manage folders** UI (create, rename, delete with move/merge, move all).
- Favorites **encrypted export/import** (AES-GCM 256, PBKDF2-SHA256 150k). Exports `.tfx.json`.
- Robust retries: file inputs reset after success/error; buttons disabled while processing; clear error toasts.

## Deploy
1) Edit `package.json` → set `"homepage": "https://<username>.github.io/<repo>"`  
2) Install & run
```bash
npm install
npm start
npm run deploy
```
>>>>>>> 67660bb (Initial)
