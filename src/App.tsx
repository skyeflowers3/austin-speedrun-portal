import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { inviteUrlForCode, isSupabaseConfigured, supabase } from './lib/supabase'
import type { Household } from './types'

type View = 'loading' | 'login' | 'dashboard' | 'unconfigured'

export default function App() {
  const [view, setView] = useState<View>(
    isSupabaseConfigured ? 'loading' : 'unconfigured',
  )
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [loginMsg, setLoginMsg] = useState('')
  const [loginErr, setLoginErr] = useState('')
  const [sending, setSending] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
  const [dashErr, setDashErr] = useState('')
  const [copied, setCopied] = useState(false)

  const loadHousehold = useCallback(async () => {
    if (!supabase) return
    setDashErr('')
    const { data, error } = await supabase.rpc('get_my_household')
    if (error) {
      setDashErr(
        /no registration found/i.test(error.message)
          ? 'No Speedrun registration found for this email. Sign up on the main site first, then come back here.'
          : error.message,
      )
      setHousehold(null)
      return
    }
    const row = (typeof data === 'string' ? JSON.parse(data) : data) as Household
    setHousehold(row)
  }, [])

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setView(data.session ? 'dashboard' : 'login')
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setView(next ? 'dashboard' : 'login')
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (view === 'dashboard' && session) {
      void loadHousehold()
    }
  }, [view, session, loadHousehold])

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setLoginErr('')
    setLoginMsg('')
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes('@')) {
      setLoginErr('Enter the email you used to register.')
      return
    }
    setSending(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    })
    setSending(false)
    if (error) {
      setLoginErr(error.message)
      return
    }
    setLoginMsg(`Check ${trimmed} for a login link. Bookmark this page — you can request a new link anytime.`)
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    setHousehold(null)
  }

  async function copyInvite() {
    if (!household?.referral_code) return
    const link = inviteUrlForCode(household.referral_code)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  if (view === 'unconfigured') {
    return (
      <Shell>
        <Card>
          <h1 className="font-display text-3xl font-bold tracking-tight">Parent portal</h1>
          <p className="mt-3 text-[var(--dim)]">
            Add <code className="text-sm">.env</code> from <code className="text-sm">.env.example</code> with
            your Supabase URL and anon key, then restart the dev server.
          </p>
        </Card>
      </Shell>
    )
  }

  if (view === 'loading') {
    return (
      <Shell>
        <p className="text-[var(--dim)]">Loading…</p>
      </Shell>
    )
  }

  if (view === 'login') {
    return (
      <Shell>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--orange)]">
            Austin Speedrun
          </p>
          <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">Parent portal</h1>
          <p className="mt-3 text-[var(--dim)] leading-relaxed">
            Enter the email you used to register. We’ll send a one-time login link. Bookmark this page —
            come back anytime and request a new link if you’re signed out.
          </p>
          <form onSubmit={sendMagicLink} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none focus:border-[var(--orange)]"
                placeholder="you@example.com"
                required
              />
            </label>
            {loginErr ? <p className="text-sm text-red-700">{loginErr}</p> : null}
            {loginMsg ? <p className="text-sm text-emerald-800">{loginMsg}</p> : null}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-xl bg-[var(--ink)] px-4 py-3.5 font-semibold text-white disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Email me a login link'}
            </button>
          </form>
        </Card>
      </Shell>
    )
  }

  const invite = household?.referral_code
    ? inviteUrlForCode(household.referral_code)
    : ''

  return (
    <Shell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--orange)]">
            Austin Speedrun
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight">Your household</h1>
          {session?.user?.email ? (
            <p className="mt-1 text-sm text-[var(--dim)]">{session.user.email}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-medium"
        >
          Sign out
        </button>
      </header>

      {dashErr ? (
        <Card>
          <p className="text-red-700">{dashErr}</p>
          <button
            type="button"
            onClick={() => void loadHousehold()}
            className="mt-4 text-sm font-semibold text-[var(--orange)]"
          >
            Try again
          </button>
        </Card>
      ) : !household ? (
        <p className="text-[var(--dim)]">Loading your registration…</p>
      ) : (
        <div className="space-y-5">
          <Card>
            <h2 className="font-display text-xl font-bold">Children</h2>
            <ul className="mt-4 divide-y divide-[var(--line)]">
              {household.children.length === 0 ? (
                <li className="py-3 text-[var(--dim)]">No children on file yet.</li>
              ) : (
                household.children.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="font-semibold">{c.full_name}</div>
                    <div className="mt-1 text-sm text-[var(--dim)]">
                      {[c.grade, c.school_name, c.school_type].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <h2 className="font-display text-xl font-bold">Your referral link</h2>
            <p className="mt-2 text-sm text-[var(--dim)]">
              Share this so friends count as your referrals when they sign up.
            </p>
            <p className="mt-3 font-mono text-sm font-semibold tracking-wide">
              Code: {household.referral_code}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={invite}
                className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
                aria-label="Invite link"
              />
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-10 sm:py-14">
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm">
      {children}
    </div>
  )
}
