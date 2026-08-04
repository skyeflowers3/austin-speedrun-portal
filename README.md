# Austin Speedrun — Parent portal

Parent-facing dashboard after Speedrun signup. Same Supabase project as the [marketing site](../austin-speedrun) and [tracker](../austin-speedrun-tracker).

**MVP:** magic-link login → kids on file + referral code / invite link.

## How login works

1. Parent registers on `parents.html#join` (success screen unchanged).
2. Supabase Auth emails a **magic link** to the portal (built-in — no Resend).
3. Parent opens the **stable portal URL** (this app). Bookmark it.
4. If signed out later, enter email here to get a **new** magic link.

## Setup

1. In Supabase SQL Editor, run [`../austin-speedrun-tracker/supabase/patch-portal-auth.sql`](../austin-speedrun-tracker/supabase/patch-portal-auth.sql).
2. Supabase → Authentication → URL configuration:
   - **Site URL:** `http://localhost:5173` (local) or your deployed portal URL
   - **Redirect URLs:** add `http://localhost:5173/**` (and production later)
3. Copy env and run:

```bash
cp .env.example .env
# paste same VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY as the tracker
npm install
npm run dev
```

4. On the marketing site, set `portalUrl` in `assets/supabase-config.js` to this origin.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | Local portal (default http://localhost:5173) |
| `npm run build` | Production build |

## Notes

- No Resend / Edge Function required for login emails.
- `provision-portal-login` in the tracker repo is unused for now (password-email experiment).
- Open anon RLS on `participants` / `children` still exists for the staff Tracker; tighten before public launch.
