import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { inviteUrlForCode, isSupabaseConfigured, supabase } from './lib/supabase'
import type { Child, Household } from './types'

type View = 'loading' | 'auth' | 'dashboard' | 'unconfigured'
type AuthMode = 'signin' | 'create'

const SEASON_START = new Date('2026-10-05T00:00:00-05:00')

const DEMO_HOUSEHOLD: Household = {
  id: 'demo',
  parent_name: 'Jessie Wang',
  email: 'parent@example.com',
  zip: '78704',
  status: 'registered',
  referral_code: 'SPD-7K2Q',
  coppa_required: true,
  children: [
    { id: '1', full_name: 'Maya Wang', grade: '7th', date_of_birth: '2013-05-12', school_name: 'Kealing Middle School', school_type: 'Public', student_email: 'maya@example.com', accommodations: null, has_home_device: true },
    { id: '2', full_name: 'Leo Wang', grade: '6th', date_of_birth: '2014-09-03', school_name: 'Kealing Middle School', school_type: 'Public', student_email: null, accommodations: null, has_home_device: true },
  ],
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const t = new Date()
  let a = t.getFullYear() - d.getFullYear()
  const m = t.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--
  return a
}

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const diff = Math.max(0, target.getTime() - now)
  return {
    days: Math.floor(diff / 86400000),
    hrs: Math.floor((diff % 86400000) / 3600000),
    mins: Math.floor((diff % 3600000) / 60000),
    secs: Math.floor((diff % 60000) / 1000),
    live: diff === 0,
  }
}

const isDemo = new URLSearchParams(window.location.search).has('demo')

export default function App() {
  const [view, setView] = useState<View>(
    isDemo ? 'dashboard' : isSupabaseConfigured ? 'loading' : 'unconfigured',
  )
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [household, setHousehold] = useState<Household | null>(isDemo ? DEMO_HOUSEHOLD : null)
  const [zipCount, setZipCount] = useState<number | null>(isDemo ? 41 : null)
  const [dashErr, setDashErr] = useState('')
  const [copied, setCopied] = useState(false)

  const loadHousehold = useCallback(async () => {
    if (!supabase) return
    setDashErr('')
    const { data, error } = await supabase.rpc('get_my_household')
    if (error) {
      setDashErr(
        /no registration found/i.test(error.message)
          ? 'No Speedrun registration found for this email. Register on the main site first, then create a portal password here.'
          : error.message,
      )
      setHousehold(null)
      return
    }
    const row = (typeof data === 'string' ? JSON.parse(data) : data) as Household
    setHousehold(row)
    if (row?.zip) {
      const { count } = await supabase
        .from('participants')
        .select('id', { count: 'exact', head: true })
        .eq('zip', row.zip)
      setZipCount(count ?? null)
    }
  }, [])

  useEffect(() => {
    if (isDemo || !supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setView(data.session ? 'dashboard' : 'auth')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setView(next ? 'dashboard' : 'auth')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!isDemo && view === 'dashboard' && session) void loadHousehold()
  }, [view, session, loadHousehold])

  async function ensureHouseholdOrSignOut() {
    if (!supabase) return false
    const { error } = await supabase.rpc('get_my_household')
    if (error) {
      await supabase.auth.signOut()
      setErr(
        /no registration found/i.test(error.message)
          ? 'No Speedrun registration for that email. Register on the main site first.'
          : error.message,
      )
      return false
    }
    return true
  }

  async function onAuthSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErr('')
    const mail = email.trim().toLowerCase()
    if (!mail.includes('@') || !password) {
      setErr('Enter email and password.')
      return
    }

    setBusy(true)
    try {
      if (authMode === 'create') {
        if (password.length < 8) {
          setErr('Use at least 8 characters.')
          return
        }
        if (password !== password2) {
          setErr('Passwords do not match.')
          return
        }

        // Prefer admin set-password when the Auth user already exists so we
        // don't show a bare "User already registered".
        const provisioned = await supabase.functions.invoke('set-portal-password', {
          body: { email: mail, password },
        })
        const provisionBody =
          typeof provisioned.data === 'string'
            ? JSON.parse(provisioned.data)
            : provisioned.data

        if (!provisioned.error && provisionBody?.ok) {
          const { error: signErr } = await supabase.auth.signInWithPassword({
            email: mail,
            password,
          })
          if (signErr) {
            setErr(signErr.message)
            return
          }
          await ensureHouseholdOrSignOut()
          return
        }

        if (provisionBody?.error && /no registration found/i.test(String(provisionBody.error))) {
          setErr('No Speedrun registration for that email. Register on the main site first.')
          return
        }

        // Fallback: brand-new Auth user (requires Confirm email OFF in Supabase)
        const { data, error } = await supabase.auth.signUp({
          email: mail,
          password,
        })
        if (error) {
          if (/already|registered|exists/i.test(error.message)) {
            setErr(
              'This email already has a portal login. Use Sign in, or deploy the set-portal-password function to reset.',
            )
          } else {
            setErr(error.message)
          }
          return
        }
        if (!data.session) {
          setErr(
            'Account created, but email confirmation is still on. In Supabase → Sign In / Providers → User Signups, turn off “Confirm email”, then change to Sign in.',
          )
          return
        }
        await ensureHouseholdOrSignOut()
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: mail,
          password,
        })
        if (error) {
          setErr(
            /invalid login/i.test(error.message)
              ? 'That email or password didn’t work. First time? Use Create password.'
              : error.message,
          )
          return
        }
        await ensureHouseholdOrSignOut()
      }
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setHousehold(null)
    setZipCount(null)
    setPassword('')
    setPassword2('')
  }

  async function copyInvite() {
    if (!household?.referral_code) return
    try {
      await navigator.clipboard.writeText(inviteUrlForCode(household.referral_code))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  if (view === 'unconfigured') {
    return (
      <AuthShell>
        <h1 className="font-display text-2xl font-bold">Parent portal</h1>
        <p className="mt-3 text-[var(--dim)]">
          Add <code className="text-sm">.env</code> from <code className="text-sm">.env.example</code> with your
          Supabase URL and anon key, then restart the dev server.
        </p>
      </AuthShell>
    )
  }

  if (view === 'loading') {
    return <div className="grid min-h-screen place-items-center text-[var(--dim)]">Loading…</div>
  }

  if (view === 'auth') {
    return (
      <AuthShell subtitle="Parent portal">
        <p className="text-[var(--dim)] leading-relaxed">
          {authMode === 'signin'
            ? 'Sign in with the email and password you created for the portal.'
            : 'First time? Use the same email you registered with, and choose a password. No email link required.'}
        </p>

        <div className="mt-5 flex gap-2 rounded-xl bg-[rgba(0,0,0,0.04)] p-1">
          <button
            type="button"
            onClick={() => {
              setAuthMode('signin')
              setErr('')
              setPassword('')
              setPassword2('')
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              authMode === 'signin' ? 'bg-white shadow-sm' : 'text-[var(--dim)]'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode('create')
              setErr('')
              setPassword('')
              setPassword2('')
            }}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
              authMode === 'create' ? 'bg-white shadow-sm' : 'text-[var(--dim)]'
            }`}
          >
            Create password
          </button>
        </div>

        <form onSubmit={onAuthSubmit} className="mt-5 space-y-4" autoComplete="off">
          <Field label="Email">
            <input
              type="email"
              name="asr-portal-email"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@example.com"
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              name="asr-portal-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder={authMode === 'create' ? 'At least 8 characters' : 'Your password'}
              required
            />
          </Field>
          {authMode === 'create' ? (
            <Field label="Confirm password">
              <input
                type="password"
                name="asr-portal-password-confirm"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className={inputCls}
                required
              />
            </Field>
          ) : null}
          {err ? <Alert kind="err">{err}</Alert> : null}
          <PrimaryBtn busy={busy}>
            {authMode === 'create' ? 'Create password' : 'Sign in'}
          </PrimaryBtn>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-[var(--dim2)]">
          Only emails that registered for the Speedrun can create a portal login.
        </p>
      </AuthShell>
    )
  }

  // DASHBOARD
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-8 sm:py-12">
      <TopBar email={isDemo ? household?.email : session?.user?.email} onSignOut={() => void signOut()} demo={isDemo} />
      {dashErr ? (
        <Card className="mt-6">
          <p className="text-red-700">{dashErr}</p>
          <button type="button" onClick={() => void loadHousehold()} className="mt-4 text-sm font-semibold text-[var(--orange)]">Try again</button>
        </Card>
      ) : !household ? (
        <p className="mt-6 text-[var(--dim)]">Loading your registration…</p>
      ) : (
        <Dashboard household={household} zipCount={zipCount} onCopy={() => void copyInvite()} copied={copied} />
      )}
    </div>
  )
}

/* ------------------------------- dashboard ------------------------------- */

function Dashboard({ household, zipCount, onCopy, copied }: { household: Household; zipCount: number | null; onCopy: () => void; copied: boolean }) {
  const cd = useCountdown(SEASON_START)
  const invite = household.referral_code ? inviteUrlForCode(household.referral_code) : ''
  const first = household.parent_name?.split(' ')[0] || 'there'
  const under13 = household.children.filter((c) => (ageFromDob(c.date_of_birth) ?? 99) < 13)

  return (
    <div className="mt-6 space-y-5">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[var(--ink)] p-7 text-white sm:p-9">
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-[var(--orange)] opacity-25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-[var(--teal)] opacity-15 blur-3xl" />
        <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-[var(--yellow)]">Your Speedrun · Season 01</p>
        <h1 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.05]">Hey {first}, you’re in.</h1>
        <p className="mt-2 max-w-lg text-white/65">
          {cd.live ? 'The season is live. Time to climb.' : 'Registration is confirmed. This is your season command center.'}
        </p>
        <div className="mt-7">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Season starts in</p>
          <div className="mt-2.5 flex items-end gap-3.5 sm:gap-4">
            <CountUnit n={cd.days} l="days" /><Sep /><CountUnit n={cd.hrs} l="hrs" /><Sep />
            <CountUnit n={cd.mins} l="min" /><Sep /><CountUnit n={cd.secs} l="sec" />
          </div>
          <p className="mt-4 font-mono text-xs text-white/45">Oct 5, 2026 · TimeBack + baseline assessment unlock day one</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Stat n={String(household.children.length)} l={household.children.length === 1 ? 'Child' : 'Kids'} acc="var(--orange)" />
        <Stat n={zipCount != null ? String(zipCount) : '—'} l={`Team ${household.zip}`} acc="var(--teal)" />
        <Stat n={household.referral_code} l="Referral code" acc="var(--pink)" mono />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Your competitors</h2>
          <a href={invite || '#'} className="font-mono text-xs font-bold uppercase tracking-wide text-[var(--orange)] hover:underline">+ Add a child</a>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {household.children.length === 0
            ? <p className="text-[var(--dim)]">No children on file yet.</p>
            : household.children.map((c) => <ChildCard key={c.id} child={c} />)}
        </div>
      </Card>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <span className="live-dot h-2.5 w-2.5 rounded-full bg-[var(--green)]" />
            <h2 className="font-display text-xl font-bold">Team {household.zip}</h2>
          </div>
          <p className="mt-3 text-[var(--dim)]">
            <b className="text-[var(--ink)]">{zipCount ?? '—'} {zipCount === 1 ? 'family' : 'families'}</b> on your zip’s team so far.
            Every zip hands out <b className="text-[var(--ink)]">3 × $1,000</b> prizes: top math, top reader, hardest worker.
          </p>
          <p className="mt-3 text-sm text-[var(--dim)]">Fill out your zip and your kids race fewer people for those local prizes.</p>
        </Card>
        <Card>
          <h2 className="font-display text-xl font-bold">Invite &amp; earn referrals</h2>
          <p className="mt-2 text-sm text-[var(--dim)]">Share your link so friends count as your referrals when they sign up.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={invite} aria-label="Invite link"
              className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm" />
            <button type="button" onClick={onCopy}
              className="rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-xl font-bold">Your next steps</h2>
        <ul className="mt-4 space-y-3">
          <Step done label="Registration submitted" sub={`${household.children.length} ${household.children.length === 1 ? 'child' : 'children'} on file`} />
          <Step done={!household.coppa_required} label="Sign consent forms"
            sub={under13.length ? `Required for ${under13.map((c) => c.full_name.split(' ')[0]).join(', ')} (under 13). We’ll email the forms.` : 'No under-13 consent needed.'} />
          <Step label="Set up TimeBack accounts" sub="We’ll email a setup link for each child before Oct 5." />
          <Step label="Take the baseline assessment" sub="Unlocks on Oct 5, the starting line." />
        </ul>
      </Card>

      <Card>
        <h2 className="font-display text-xl font-bold">What your kids are playing for</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Prize amt="$100K" acc="var(--orange)" label="Grand crown" sub="Top math or reading, metro-wide" />
          <Prize amt="$10K" acc="var(--orange)" label="Grade champion" sub="Best in their grade" />
          <Prize amt="$50K" acc="var(--yellow)" label="Effort grand" sub="Most TimeBack XP, any kid" />
          <Prize amt="$1K×3" acc="var(--teal)" label="Zip prizes" sub={`In team ${household.zip}`} />
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------- pieces ------------------------------- */

const inputCls = 'mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none transition focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/20'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-sm font-medium">{label}</span>{children}</label>
}

function Alert({ kind, children }: { kind: 'err' | 'ok'; children: React.ReactNode }) {
  return <p className={`rounded-lg px-3 py-2.5 text-sm ${kind === 'err' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>{children}</p>
}

function PrimaryBtn({ busy, children }: { busy?: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={busy}
      className="w-full rounded-xl bg-[var(--ink)] px-4 py-3.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
      {busy ? 'Working…' : children}
    </button>
  )
}

function AuthShell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Wordmark /></div>
        <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--card)] shadow-[0_30px_80px_-40px_rgba(60,40,10,0.5)]">
          <div className="h-1.5 w-full bg-gradient-to-r from-[var(--orange)] via-[var(--pink)] to-[var(--teal)]" />
          <div className="p-7 sm:p-8">
            {subtitle ? <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-[var(--orange)]">{subtitle}</p> : null}
            <div className={subtitle ? 'mt-4' : ''}>{children}</div>
          </div>
        </div>
        <p className="mt-5 text-center font-mono text-[11px] uppercase tracking-wider text-[var(--dim2)]">Austin Speedrun · GT School</p>
      </div>
    </div>
  )
}

function TopBar({ email, onSignOut, demo }: { email?: string | null; onSignOut: () => void; demo?: boolean }) {
  return (
    <header className="flex items-center justify-between gap-4">
      <Wordmark small />
      <div className="flex items-center gap-3">
        {email ? <span className="hidden text-sm text-[var(--dim)] sm:inline">{email}</span> : null}
        {demo
          ? <span className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-mono text-xs font-bold uppercase text-[var(--dim)]">Demo</span>
          : <button type="button" onClick={onSignOut} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium transition hover:bg-[var(--bg2)]">Sign out</button>}
      </div>
    </header>
  )
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`grid place-items-center rounded-xl bg-[var(--ink)] font-display font-bold text-white ${small ? 'h-9 w-9 text-lg' : 'h-12 w-12 text-2xl'}`}>S</span>
      <div className="leading-tight">
        <div className={`font-display font-bold tracking-tight ${small ? 'text-base' : 'text-xl'}`}>AUSTIN <span className="text-[var(--orange)]">SPEEDRUN</span></div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--dim)]">Parent Portal · GT School</div>
      </div>
    </div>
  )
}

function ChildCard({ child }: { child: Child }) {
  const age = ageFromDob(child.date_of_birth)
  const under13 = age != null && age < 13
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card2)] p-4 transition hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="font-display text-lg font-bold">{child.full_name}</div>
        {under13
          ? <span className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">Consent needed</span>
          : <span className="whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">Ready</span>}
      </div>
      <div className="mt-1.5 text-sm text-[var(--dim)]">{[child.grade, child.school_name].filter(Boolean).join(' · ')}</div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Pill>{child.school_type || 'School'}</Pill>
        {age != null ? <Pill>Age {age}</Pill> : null}
        <Pill>{child.has_home_device ? 'Device ✓' : 'No device'}</Pill>
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-[var(--bg2)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--dim)]">{children}</span>
}

function Stat({ n, l, acc, mono }: { n: string; l: string; acc: string; mono?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <span className="absolute left-0 top-0 h-1 w-full" style={{ background: acc }} />
      <div className={`font-display font-bold ${mono ? 'font-mono text-lg tracking-tight' : 'text-2xl sm:text-3xl'}`} style={{ color: acc }}>{n}</div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--dim)] sm:text-[11px]">{l}</div>
    </div>
  )
}

function CountUnit({ n, l }: { n: number; l: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-display text-4xl font-bold tabular-nums text-[var(--yellow)] sm:text-5xl">{String(n).padStart(2, '0')}</span>
      <span className="mt-1 font-mono text-[10px] uppercase tracking-wider text-white/45">{l}</span>
    </div>
  )
}
function Sep() { return <span className="font-display pb-6 text-2xl font-bold text-white/25">:</span> }

function Step({ done, label, sub }: { done?: boolean; label: string; sub?: string }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold ${done ? 'bg-[var(--green)] text-white' : 'border-2 border-[var(--line2)] text-transparent'}`}>✓</span>
      <div>
        <div className={`font-semibold ${done ? 'text-[var(--dim)] line-through' : ''}`}>{label}</div>
        {sub ? <div className="text-sm text-[var(--dim)]">{sub}</div> : null}
      </div>
    </li>
  )
}

function Prize({ amt, acc, label, sub }: { amt: string; acc: string; label: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card2)] p-4">
      <div className="font-display text-2xl font-bold" style={{ color: acc }}>{amt}</div>
      <div className="mt-1 font-semibold">{label}</div>
      <div className="mt-0.5 text-xs text-[var(--dim)]">{sub}</div>
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm ${className}`}>{children}</div>
}
