# Austin Speedrun — Parent portal

Parent dashboard after Speedrun registration. Same Supabase project as the [marketing site](../austin-speedrun) and [tracker](../austin-speedrun-tracker).

**Auth:** email + password on one page (**Sign in** / **Create password**). No magic links, no auth emails.

## How login works

1. Parent registers on the marketing site (same email).
2. Open this portal → **Create password** (email + new password).
3. Later visits → **Sign in** with that email/password.
4. Demo Season Hub: open `/?demo` (no Supabase required).

Only emails already in `participants` can create a portal login / stay signed in.

## One Supabase setting (important)

Dashboard → **Authentication** → **Sign In / Providers** → **User Signups**:

- Turn **Confirm email** **OFF**

## Optional: set password for existing Auth users

If someone already logged in via an old magic-link flow, **Create password** needs:

```bash
cd ../austin-speedrun-tracker
supabase functions deploy set-portal-password --no-verify-jwt
```

## Setup

1. Run [`../austin-speedrun-tracker/supabase/patch-portal-auth.sql`](../austin-speedrun-tracker/supabase/patch-portal-auth.sql) in the SQL Editor.
2. Copy env and run:

```bash
cp .env.example .env
# same VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY as the tracker
npm install
npm run dev
```

3. On the marketing site, set `portalUrl` in `assets/supabase-config.js` to this origin.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | http://localhost:5173 |
| `npm run build` | Production build |
| `./deploy.sh` | Deploy `dist/` to the S3 website bucket |
