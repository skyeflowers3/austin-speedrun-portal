# Austin Speedrun — Parent portal

Parent dashboard after Speedrun registration. Same Supabase project as the [marketing site](../austin-speedrun) and [tracker](../austin-speedrun-tracker).

**Auth:** email + password for day-to-day login. First-time / forgot-password uses a one-time set-up link (Supabase recovery email).

## How login works

1. Parent registers on the marketing site (same email).
2. Open this portal → enter email → **Email me a set-up link** → set a password.
3. Later visits → **Log in** with that email/password.
4. Demo Season Hub: open `/?demo` (no Supabase required).

## Setup

1. Run [`../austin-speedrun-tracker/supabase/patch-portal-auth.sql`](../austin-speedrun-tracker/supabase/patch-portal-auth.sql) in the SQL Editor.
2. Supabase → Authentication → URL configuration:
   - **Site URL:** `http://localhost:5173` (local) or your deployed portal URL
   - **Redirect URLs:** add `http://localhost:5173/**` (and production later)
3. Copy env and run:

```bash
cp .env.example .env
# same VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY as the tracker
npm install
npm run dev
```

4. On the marketing site, set `portalUrl` in `assets/supabase-config.js` to this origin.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | http://localhost:5173 |
| `npm run build` | Production build |
| `./deploy.sh` | Deploy `dist/` to the S3 website bucket |
