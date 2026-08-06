# Austin Speedrun — Parent portal

Parent dashboard after Speedrun registration. Same Supabase project as the [marketing site](../austin-speedrun) and [tracker](../austin-speedrun-tracker).

**Auth:** email + password (no magic links, no Resend).

## How login works

1. Parent registers on the marketing site (same email).
2. Open this portal → **Create password** (email + new password).
3. Later visits → **Sign in** with that email/password.
4. Optional: change password while logged in.

No auth email is sent on login, so you won’t hit Supabase’s email rate limit during normal use.

## One Supabase setting (important)

Dashboard → **Authentication** → **Sign In / Providers** → **User Signups**:

- Turn **Confirm email** **OFF**

## Optional: set password for existing Auth users

If someone already logged in via magic link, `Create password` needs:

```bash
cd ../austin-speedrun-tracker
supabase functions deploy set-portal-password --no-verify-jwt
```

Quick manual fix instead: **Authentication → Users** → delete that email → **Create password** again on the portal.

## Setup

1. Run [`../austin-speedrun-tracker/supabase/patch-portal-auth.sql`](../austin-speedrun-tracker/supabase/patch-portal-auth.sql) in the SQL Editor.
2. Copy env and run:

```bash
cp .env.example .env
# same VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY as the tracker
npm install
npm run dev
```

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | http://localhost:5173 |
| `npm run build` | Production build |
