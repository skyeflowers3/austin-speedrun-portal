import { useCallback, useEffect, useRef, useState } from 'react'
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
  referral_count: 0,
  referral_count_month: 0,
  children: [
    { id: '1', full_name: 'Maya Wang', grade: '7th', date_of_birth: '2013-05-12', school_name: 'Kealing Middle School', school_type: 'Public', student_email: 'maya@example.com', accommodations: null, has_home_device: true },
    { id: '2', full_name: 'Leo Wang', grade: '6th', date_of_birth: '2014-09-03', school_name: 'Kealing Middle School', school_type: 'Public', student_email: null, accommodations: null, has_home_device: true },
  ],
}

const INVITE_SHARE_MESSAGE =
  'Join us in the Austin Speedrun — a free middle-school contest with real prizes. Sign up with my link:'

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

function canNativeShare(data: ShareData): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof navigator.canShare === 'function') {
    try {
      return navigator.canShare(data)
    } catch {
      return false
    }
  }
  return true
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
  const [dashErr, setDashErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)

  /** PostgREST occasionally rejects a brand-new Auth JWT as "issued at future" (tiny clock skew). */
  const rpcHousehold = useCallback(async () => {
    if (!supabase) return { data: null, error: new Error('Supabase not configured') }
    const delays = [0, 1500, 3000]
    let last: { data: unknown; error: { message: string } | null } = { data: null, error: null }
    for (const ms of delays) {
      if (ms) await new Promise((r) => setTimeout(r, ms))
      const res = await supabase.rpc('get_my_household')
      last = res
      if (!res.error) return res
      if (!/issued at future/i.test(res.error.message)) return res
    }
    return last
  }, [])

  const loadHousehold = useCallback(async () => {
    if (!supabase) return
    setDashErr('')
    const { data, error } = await rpcHousehold()
    if (error) {
      setDashErr(
        /no registration found/i.test(error.message)
          ? 'No Speedrun registration found for this email. Register on the main site first, then create a portal password here.'
          : /issued at future/i.test(error.message)
            ? 'Login worked, but the session needs a second to settle. Tap Try again.'
            : error.message,
      )
      setHousehold(null)
      return
    }
    const row = (typeof data === 'string' ? JSON.parse(data) : data) as Household
    setHousehold(row)
  }, [rpcHousehold])

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
    const { error } = await rpcHousehold()
    if (error) {
      if (/issued at future/i.test(error.message)) {
        // Session is valid; dashboard load will retry. Don't sign them out.
        return true
      }
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

        // Only registered participants can create a portal password (server-side check).
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

        setErr(
          provisionBody?.error ||
            provisioned.error?.message ||
            'Could not create portal password. Try again, or ask staff to deploy set-portal-password.',
        )
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: mail,
        password,
      })
      if (error) {
        setErr(
          /invalid login/i.test(error.message)
            ? 'That email or password didn’t work. First time? Tap Sign up.'
            : error.message,
        )
        return
      }
      await ensureHouseholdOrSignOut()
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setHousehold(null)
    setPassword('')
    setPassword2('')
  }

  async function copyInvite() {
    if (!household?.referral_code) return
    const text = inviteUrlForCode(household.referral_code)
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
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
            ? 'Log in with the email and password you created for the portal.'
            : 'First time? Use the same email you registered with, and choose a password. No email required.'}
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
            Log in
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
            Sign up
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
            {authMode === 'create' ? 'Sign up' : 'Log in'}
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
      <TopBar
        email={isDemo ? household?.email : session?.user?.email}
        onSignOut={() => void signOut()}
        demo={isDemo}
        onChangePassword={isDemo ? undefined : () => setShowChangePassword((v) => !v)}
        changingPassword={showChangePassword}
      />
      {showChangePassword && !isDemo ? (
        <ChangePasswordCard
          className="mt-4"
          onDone={() => setShowChangePassword(false)}
          onCancel={() => setShowChangePassword(false)}
        />
      ) : null}
      {dashErr ? (
        <Card className="mt-6">
          <p className="text-red-700">{dashErr}</p>
          <button type="button" onClick={() => void loadHousehold()} className="mt-4 text-sm font-semibold text-[var(--orange)]">Try again</button>
        </Card>
      ) : !household ? (
        <p className="mt-6 text-[var(--dim)]">Loading your registration…</p>
      ) : (
        <Dashboard
          household={household}
          onCopy={() => void copyInvite()}
          copied={copied}
          onChildrenChanged={() => void loadHousehold()}
        />
      )}
    </div>
  )
}

/* ------------------------------- dashboard ------------------------------- */

const CHILD_GRADES = ['6th', '7th', '8th']
const SCHOOL_TYPES = ['Public', 'Private', 'Charter', 'Microschool', 'Homeschool']

function Dashboard({
  household,
  onCopy,
  copied,
  onChildrenChanged,
}: {
  household: Household
  onCopy: () => void
  copied: boolean
  onChildrenChanged: () => void
}) {
  const cd = useCountdown(SEASON_START)
  const invite = household.referral_code ? inviteUrlForCode(household.referral_code) : ''
  const first = household.parent_name?.split(' ')[0] || 'there'
  const under13 = household.children.filter((c) => (ageFromDob(c.date_of_birth) ?? 99) < 13)
  const consentNeeded = household.coppa_required
  const [showAddChild, setShowAddChild] = useState(false)

  const nextSteps = (
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
  )

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

      {consentNeeded ? nextSteps : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold">Your kids</h2>
          {!showAddChild ? (
            <button
              type="button"
              onClick={() => setShowAddChild(true)}
              className="font-mono text-xs font-bold uppercase tracking-wide text-[var(--orange)] hover:underline"
            >
              + Add a child
            </button>
          ) : null}
        </div>
        {showAddChild ? (
          <AddChildForm
            onCancel={() => setShowAddChild(false)}
            onSaved={() => {
              setShowAddChild(false)
              onChildrenChanged()
            }}
          />
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {household.children.length === 0 && !showAddChild
            ? <p className="text-[var(--dim)]">No children on file yet.</p>
            : household.children.map((c) => <ChildCard key={c.id} child={c} />)}
        </div>
      </Card>

      {consentNeeded ? null : nextSteps}

      <Card>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-bold">Invite a Friend</h2>
            <p className="mt-1 text-sm text-[var(--dim)]">
              <b className="text-[var(--ink)]">{household.referral_count_month ?? 0}</b>
              {' '}{(household.referral_count_month ?? 0) === 1 ? 'referral' : 'referrals'} this month
              <span className="text-[var(--dim2)]">
                {' · '}{household.referral_count ?? 0} season
                {(household.referral_count ?? 0) === 1 ? ' referral' : ' referrals'}
              </span>
            </p>
          </div>
          <InfoTip
            label="How referral prizes work"
            body={
              <>
                A referral counts after your friend finishes the <b>baseline assessment</b> and
                completes <b>5 hours on TimeBack</b>. Monthly raffle entries reset each month;
                season referrals count toward the top-referrer prizes.
              </>
            }
          />
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--dim)]">
          <li>
            <b className="text-[var(--ink)]">Top referrers:</b> win up to{' '}
            <b className="text-[var(--orange)]">$5,000</b>{' '}
            <span className="text-[var(--dim2)]">($5,000 / $3,000 / $2,000)</span>
          </li>
          <li>
            <b className="text-[var(--ink)]">Monthly raffle:</b> each referral gets you and your
            friend an entry to win <b className="text-[var(--teal)]">$1,000</b>
          </li>
        </ul>
        <InviteActions inviteUrl={invite} copied={copied} onCopy={onCopy} />
      </Card>

      <Card>
        <h2 className="font-display text-xl font-bold">What your kids are playing for</h2>
        <p className="mt-1 text-sm text-[var(--dim)]">Score prizes use the final assessment. Effort prizes use TimeBack XP.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Prize
            amt="2 × $100K"
            acc="var(--orange)"
            label="Final crowns"
            sub="Highest final math & highest final reading"
          />
          <Prize
            amt="6 × $10K"
            acc="var(--orange)"
            label="Grade finals"
            sub="Top final math & reading in each grade"
          />
          <Prize
            amt="$50K"
            acc="var(--yellow)"
            label="Effort grand"
            sub="Most TimeBack XP over the whole season"
          />
          <Prize
            amt="$5K / mo"
            acc="var(--teal)"
            label="Monthly effort"
            sub="Most TimeBack XP that calendar month"
          />
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

function InfoTip({ label, body }: { label: string; body: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-6 w-6 place-items-center rounded-full border border-[var(--line)] bg-white text-xs font-bold text-[var(--dim)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
      >
        i
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute right-0 z-20 mt-2 w-[min(18.5rem,calc(100vw-3rem))] rounded-xl border border-[var(--line)] bg-white p-3 text-left text-xs leading-relaxed text-[var(--dim)] shadow-lg"
        >
          <p>{body}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 font-semibold text-[var(--orange)] hover:underline"
          >
            Got it
          </button>
        </div>
      ) : null}
    </div>
  )
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

function TopBar({
  email,
  onSignOut,
  demo,
  onChangePassword,
  changingPassword,
}: {
  email?: string | null
  onSignOut: () => void
  demo?: boolean
  onChangePassword?: () => void
  changingPassword?: boolean
}) {
  return (
    <header className="flex items-center justify-between gap-4">
      <Wordmark small />
      <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        {email ? <span className="hidden text-sm text-[var(--dim)] sm:inline">{email}</span> : null}
        {demo ? (
          <span className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-mono text-xs font-bold uppercase text-[var(--dim)]">Demo</span>
        ) : (
          <>
            {onChangePassword ? (
              <button
                type="button"
                onClick={onChangePassword}
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium transition hover:bg-[var(--bg2)]"
              >
                {changingPassword ? 'Close' : 'Change password'}
              </button>
            ) : null}
            <button type="button" onClick={onSignOut} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium transition hover:bg-[var(--bg2)]">Sign out</button>
          </>
        )}
      </div>
    </header>
  )
}

function ChangePasswordCard({
  onDone,
  onCancel,
  className = '',
}: {
  onDone: () => void
  onCancel: () => void
  className?: string
}) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setErr('')
    setOk(false)
    if (pw.length < 8) {
      setErr('Use at least 8 characters.')
      return
    }
    if (pw !== pw2) {
      setErr('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) {
        setErr(error.message)
        return
      }
      setOk(true)
      setPw('')
      setPw2('')
      setTimeout(onDone, 900)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={className}>
      <h2 className="font-display text-xl font-bold">Change password</h2>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-4 grid gap-3 sm:max-w-md">
        <Field label="New password">
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        {err ? <Alert kind="err">{err}</Alert> : null}
        {ok ? <Alert kind="ok">Password updated.</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Update password'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold hover:bg-[var(--bg2)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

function InviteActions({
  inviteUrl,
  copied,
  onCopy,
}: {
  inviteUrl: string
  copied: boolean
  onCopy: () => void
}) {
  const [shareErr, setShareErr] = useState('')
  // iOS duplicates the URL if both `text` and `url` are set — put the link in text only.
  const shareData: ShareData = {
    title: 'Austin Speedrun',
    text: `${INVITE_SHARE_MESSAGE}\n${inviteUrl}`,
  }
  const showShare = Boolean(inviteUrl) && canNativeShare(shareData)

  async function onShare() {
    setShareErr('')
    try {
      await navigator.share(shareData)
    } catch (e) {
      // AbortError = user dismissed the sheet; ignore.
      if (e instanceof DOMException && e.name === 'AbortError') return
      // Fall back to copy so mobile still has a path if share fails.
      onCopy()
      setShareErr('Share unavailable — link copied instead.')
      window.setTimeout(() => setShareErr(''), 3000)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <input
        readOnly
        value={inviteUrl}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
        className="min-w-0 w-full rounded-xl border border-[var(--orange)]/30 bg-white px-3 py-3 text-sm touch-manipulation"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="min-h-11 flex-1 rounded-xl bg-[var(--orange)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 touch-manipulation sm:flex-none"
        >
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {showShare ? (
          <button
            type="button"
            onClick={() => void onShare()}
            className="min-h-11 flex-1 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg2)] touch-manipulation sm:flex-none"
          >
            Share
          </button>
        ) : null}
      </div>
      {shareErr ? <p className="text-sm text-[var(--teal)]">{shareErr}</p> : null}
    </div>
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

function AddChildForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('')
  const [dob, setDob] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [schoolType, setSchoolType] = useState('')
  const [studentEmail, setStudentEmail] = useState('')
  const [accommodations, setAccommodations] = useState('')
  const [hasDevice, setHasDevice] = useState(true)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setFormErr('')
    if (!fullName.trim() || !grade || !dob || !schoolName.trim() || !schoolType) {
      setFormErr('Name, date of birth, grade, school name, and school type are required.')
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('add_my_child', {
        p_full_name: fullName.trim(),
        p_grade: grade,
        p_date_of_birth: dob,
        p_school_name: schoolName.trim(),
        p_school_type: schoolType,
        p_student_email: studentEmail.trim() || null,
        p_accommodations: accommodations.trim() || null,
        p_has_home_device: hasDevice,
      })
      if (error) {
        setFormErr(error.message)
        return
      }
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card2)] p-4">
      <h3 className="text-sm font-semibold text-[var(--ink)]">Add a child</h3>
      <p className="mt-1 text-xs text-[var(--dim)]">Same details as registration. Under-13 kids may need consent forms.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Full legal name</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Date of birth</span>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Grade</span>
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            required
          >
            <option value="">Select…</option>
            {CHILD_GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">School name</span>
          <input
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            required
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">School type</span>
          <select
            value={schoolType}
            onChange={(e) => setSchoolType(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            required
          >
            <option value="">Select…</option>
            {SCHOOL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">
            Student email <span className="font-normal text-[var(--dim)]">(optional, 13+)</span>
          </span>
          <input
            type="email"
            value={studentEmail}
            onChange={(e) => setStudentEmail(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">
            Accommodations <span className="font-normal text-[var(--dim)]">(optional)</span>
          </span>
          <input
            value={accommodations}
            onChange={(e) => setAccommodations(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
            placeholder="IEP / 504"
          />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={hasDevice}
            onChange={(e) => setHasDevice(e.target.checked)}
            className="size-4"
          />
          <span>Device + reliable internet at home</span>
        </label>
      </div>
      {formErr ? <div className="mt-3"><Alert kind="err">{formErr}</Alert></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--orange)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save child'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--bg2)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
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

      <div className="mt-3 rounded-xl bg-white/80 px-3 py-2.5">
        <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-[var(--dim2)]">TimeBack XP</div>
        <div className="font-display text-2xl font-bold leading-none text-[var(--orange)] tabular-nums">
          {child.xp ?? 0}
        </div>
      </div>

      <div className="mt-3 text-sm text-[var(--dim)]">
        {[child.grade, child.school_name].filter(Boolean).join(' · ')}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
