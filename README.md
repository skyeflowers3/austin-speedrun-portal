# Austin Speedrun — Parent portal

Parent dashboard after Speedrun registration. Same Supabase project as the [marketing site](../austin-speedrun) and [tracker](../austin-speedrun-tracker).

**Auth (current):** email + password on one page — **Sign in** / **Create password**. No auth emails. Only emails already in `participants` can create a portal login (`set-portal-password` Edge Function).

**Parked for later:** Resend set-password emails via `send-portal-setup-link` (needs a verified sending domain). Code lives in the tracker repo; don’t wire it into signup until then.

## How login works

1. Parent registers on the marketing site (same email).
2. Open this portal → **Create password**.
3. Later visits → **Sign in**.
4. Demo Season Hub: `/?demo`.

## Edge Function (required)

```bash
cd ../austin-speedrun-tracker
supabase functions deploy set-portal-password --no-verify-jwt
```

## Supabase Auth settings

Dashboard → **Authentication** → **Providers** → **Email**:

- Prefer **Allow new users to sign up** = **OFF** (accounts are created by `set-portal-password` after registration)
- **Confirm email** = **OFF**

## Setup

1. Run [`../austin-speedrun-tracker/supabase/patch-portal-auth.sql`](../austin-speedrun-tracker/supabase/patch-portal-auth.sql) in the SQL Editor.
2. Copy env and run:

```bash
cp .env.example .env
# same VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY as the tracker
npm install
npm run dev
```

Local portal: http://localhost:5180 (pinned so it doesn’t collide with the tracker on 5173).

3. On the marketing site, set `portalUrl` in `assets/supabase-config.js` to this origin (or the deployed portal URL).

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | http://localhost:5180 |
| `npm run build` | Production build |
| `./deploy.sh` | Deploy `dist/` to the S3 website bucket |

## Later: Resend set-password emails

When you have a verified domain in Resend:

1. Deploy `send-portal-setup-link` and set `RESEND_API_KEY` / `PORTAL_FROM_EMAIL` / `PORTAL_URL`
2. Call it from marketing signup (or re-enable the portal “email me a link” UI)
3. Optionally drop Create password in favor of email-only first-time setup
