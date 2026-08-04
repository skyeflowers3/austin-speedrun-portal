import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(
  url &&
    anonKey &&
    !url.includes('YOUR_PROJECT_REF') &&
    anonKey !== 'your_anon_key_here',
)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null

export const marketingSiteUrl = (
  import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined
)?.replace(/\/$/, '') || 'http://127.0.0.1:8000'

export function inviteUrlForCode(code: string) {
  const url = new URL('parents.html', `${marketingSiteUrl}/`)
  url.searchParams.set('ref', code)
  url.hash = 'join'
  return url.toString()
}
