import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { inviteUrlForCode, isSupabaseConfigured, supabase } from './lib/supabase'
import type { Household } from './types'

type View = 'loading' | 'auth' | 'dashboard' | 'unconfigured'
type AuthMode = 'signin' | 'create'

export default function App() {
  const [view, setView] = useState<View>(
    isSupabaseConfigured ? 'loading' : 'unconfigured',
  )
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loginErr, setLoginErr] = useState('')
  const [sending, setSending] = useState(false)
  const [household, setHousehold] = useState<Household | null>(null)
  const [dashErr, setDashErr] = useState('')
  const [copied, setCopied] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

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
  }, [])

  useEffect(() => {
    if (!supabase) return

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
    if (view === 'dashboard' && session) {
      void loadHousehold()
    }
  }, [view, session, loadHousehold])

  async function ensureHouseholdOrSignOut() {
    if (!supabase) return false
    const { error } = await supabase.rpc('get_my_household')
    if (error) {
      await supabase.auth.signOut()
      setLoginErr(
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
    setLoginErr('')
    const trimmed = email.trim().toLowerCase()
    if (!trimmed.includes('@') || !password) {
      setLoginErr('Enter email and password.')
      return
    }

    setSending(true)
    try {
      if (authMode === 'create') {
        if (password.length < 8) {
          setLoginErr('Use at least 8 characters.')
          return
        }
        if (password !== password2) {
          setLoginErr('Passwords do not match.')
          return
        }

        // Prefer admin set-password when the Auth user already exists (e.g. from an
        // earlier magic-link login) so we don't show a bare "User already registered".
        const provisioned = await supabase.functions.invoke('set-portal-password', {
          body: { email: trimmed, password },
        })
        const provisionBody =
          typeof provisioned.data === 'string'
            ? JSON.parse(provisioned.data)
            : provisioned.data

        if (!provisioned.error && provisionBody?.ok) {
          const { error: signErr } = await supabase.auth.signInWithPassword({
            email: trimmed,
            password,
          })
          if (signErr) {
            setLoginErr(signErr.message)
            return
          }
          const ok = await ensureHouseholdOrSignOut()
          if (!ok) return
          return
        }

        // Fallback: brand-new Auth user
        const { data, error } = await supabase.auth.signUp({
          email: trimmed,
          password,
        })
        if (error) {
          if (/already|registered|exists/i.test(error.message)) {
            setLoginErr(
              'This email already has a portal login from an earlier email-link sign-in, but no password yet. Quick fix: Supabase → Authentication → Users → delete that user → Create password here again. Or deploy the set-portal-password function.',
            )
          } else {
            setLoginErr(error.message)
          }
          return
        }
        if (!data.session) {
          setLoginErr(
            'Account created, but email confirmation is still on. In Supabase → Sign In / Providers → User Signups, turn off “Confirm email”, then sign in.',
          )
          return
        }
        const ok = await ensureHouseholdOrSignOut()
        if (!ok) return
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        })
        if (error) {
          setLoginErr(error.message)
          return
        }
        const ok = await ensureHouseholdOrSignOut()
        if (!ok) return
      }
    } finally {
      setSending(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setPwErr('')
    setPwMsg('')
    if (newPassword.length < 8) {
      setPwErr('Use at least 8 characters.')
      return
    }
    if (newPassword !== newPassword2) {
      setPwErr('Passwords do not match.')
      return
    }
    setPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPwSaving(false)
    if (error) {
      setPwErr(error.message)
      return
    }
    setNewPassword('')
    setNewPassword2('')
    setPwMsg('Password updated.')
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
            Add <code className="text-sm">.env</code> from <code className="text-sm">.env.example</code>, then
            restart the dev server.
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

  if (view === 'auth') {
    return (
      <Shell>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--orange)]">
            Austin Speedrun
          </p>
          <h1 className="font-display mt-2 text-3xl font-bold tracking-tight">Parent portal</h1>
          <p className="mt-3 text-[var(--dim)] leading-relaxed">
            {authMode === 'signin'
              ? 'Sign in with the email and password you created for the portal.'
              : 'First time? Use the same email you registered with, and choose a password. No email link required.'}
          </p>

          <div className="mt-5 flex gap-2 rounded-xl bg-[rgba(0,0,0,0.04)] p-1">
            <button
              type="button"
              onClick={() => {
                setAuthMode('signin')
                setLoginErr('')
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
                setLoginErr('')
                setEmail('')
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

          <form
            onSubmit={onAuthSubmit}
            className="mt-5 space-y-4"
            autoComplete="off"
          >
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                name="asr-portal-email"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none focus:border-[var(--orange)]"
                placeholder="you@example.com"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                name="asr-portal-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none focus:border-[var(--orange)]"
                required
              />
            </label>
            {authMode === 'create' ? (
              <label className="block">
                <span className="text-sm font-medium">Confirm password</span>
                <input
                  type="password"
                  name="asr-portal-password-confirm"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none focus:border-[var(--orange)]"
                  required
                />
              </label>
            ) : null}
            {loginErr ? <p className="text-sm text-red-700">{loginErr}</p> : null}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-xl bg-[var(--ink)] px-4 py-3.5 font-semibold text-white disabled:opacity-60"
            >
              {sending
                ? authMode === 'create'
                  ? 'Creating…'
                  : 'Signing in…'
                : authMode === 'create'
                  ? 'Create password'
                  : 'Sign in'}
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

          <Card>
            <h2 className="font-display text-xl font-bold">Change password</h2>
            <form onSubmit={changePassword} className="mt-4 space-y-3">
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none focus:border-[var(--orange)]"
              />
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                placeholder="Confirm new password"
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3.5 py-3 outline-none focus:border-[var(--orange)]"
              />
              {pwErr ? <p className="text-sm text-red-700">{pwErr}</p> : null}
              {pwMsg ? <p className="text-sm text-emerald-800">{pwMsg}</p> : null}
              <button
                type="submit"
                disabled={pwSaving}
                className="rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {pwSaving ? 'Saving…' : 'Update password'}
              </button>
            </form>
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
