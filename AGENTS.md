# World Cup 2026 Prediction League — Agent Instructions

## After every `git push`

After every `git push` command, immediately check the Cloudflare Pages deployment status by running:

```sh
./scripts/check-deploy.sh
```

Report the status, commit hash, and any errors.

Do NOT use the Cloudflare MCP for this — always use the script.

## Service Worker Cache

SW cache version is injected at build time by Vite plugin. No manual bumps needed.

## Git Rules

- NEVER use `--no-verify` on git push or git commit. Always let the pre-push hook run.

## Features Backlog

After completing any feature, always update `FEATURES.md`:
- Move the item from pending to Completed
- If it was from "Low Priority" or "Medium Priority", remove it from that section

## Database Access

Credentials are in `site/.env.local`. Use these for direct Supabase queries when debugging.

## Key Commands

- `npm run prepush` — lint + type-check + tests (same as pre-push hook)
- `npm run dev` — start local dev server (port 8000)
- `npm test` — run unit tests
- `node site/scripts/scrape-match-details.mjs` — re-scrape Wikipedia for match detail (lineups, cards, etc.)

## Deployment

- Cloudflare Pages project name: `worldcup`
- Domain: `worldcup-1jo.pages.dev`
- Auto-deploys on push to `master`
- Build: `npm install && npm run build` in the `site/` directory
