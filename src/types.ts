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
}

export type Household = {
  id: string
  parent_name: string
  email: string
  zip: string
  status: string
  referral_code: string
  coppa_required: boolean
  children: Child[]
}
