<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

- Node.js 22 is already installed. `npm ci` matches CI. Copy `.env.example` to `.env.local` when that file is missing. The placeholder values are enough: the landing page and sign-in render, and sign-in says Supabase is not configured. Do not block on real Supabase, VAPID, or Upstash secrets.
- Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. Next.js 16 already defaults the hostname to `0.0.0.0`.
- Checks that match `.github/workflows/ci.yml`: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` (public env can stay the placeholders from `.env.example`), then `CI=true npm run test:e2e`. Playwright Chromium is installed during environment setup.
- `npm run test:rls` needs Docker and `npx supabase start`. Docker is not part of this environment. Local Supabase is optional; the app and the Playwright smoke tests run without it.
