export type Child = {
  id: string
  full_name: string
  grade: string
  date_of_birth: string | null
  school_name: string | null
  school_type: string | null
  student_email: string | null
  accommodations: string | null
  has_home_device: boolean | null
  /** TimeBack XP — 0 until telemetry is wired. */
  xp?: number | null
}

export type Household = {
  id: string
  parent_name: string
  email: string
  zip: string
  status: string
  referral_code: string
  coppa_required: boolean
  /** People who signed up with this household's invite link (season). */
  referral_count?: number
  /** Signups via this link in the current calendar month (raffle window). */
  referral_count_month?: number
  children: Child[]
}
