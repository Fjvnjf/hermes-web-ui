const DEFAULT_BASE_URL = ''
const USER_PROFILES_STORAGE_KEY = 'hermes_current_user_profiles'
const USER_DEFAULT_PROFILE_STORAGE_KEY = 'hermes_current_user_default_profile'
const ACTIVE_PROFILE_STORAGE_KEY = 'hermes_active_profile_name'

function getBaseUrl(): string {
  if (import.meta.env.VITE_HERMES_PREVIEW === '1') return DEFAULT_BASE_URL
  return localStorage.getItem('hermes_server_url') || DEFAULT_BASE_URL
}

export function getApiKey(): string {
  return localStorage.getItem('hermes_api_key') || ''
}

export function setServerUrl(url: string) {
  localStorage.setItem('hermes_server_url', url)
}

export function setApiKey(key: string) {
  localStorage.setItem('hermes_api_key', key)
}

export function clearApiKey() {
  localStorage.removeItem('hermes_api_key')
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

export type StoredUserRole =
  | 'super_admin'
  | 'owner'
  | 'admin'
  | 'employee'
  | 'research_assistant'
  | 'financial_analyst'
  | 'regulatory_consultant'
  | 'investor_viewer'
  | 'developer_admin'

export function getStoredUserRole(): StoredUserRole | null {
  const token = getApiKey()
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const data = JSON.parse(atob(padded)) as { role?: unknown }
    const role = data.role
    return role === 'super_admin' ||
      role === 'owner' ||
      role === 'admin' ||
      role === 'employee' ||
      role === 'research_assistant' ||
      role === 'financial_analyst' ||
      role === 'regulatory_consultant' ||
      role === 'investor_viewer' ||
      role === 'developer_admin'
      ? role
      : null
  } catch {
    return null
  }
}

export function isStoredSuperAdmin(): boolean {
  return getStoredUserRole() === 'super_admin'
}

function isScopedBusinessRole(role: StoredUserRole | null): boolean {
  return role === 'employee' ||
    role === 'research_assistant' ||
    role === 'financial_analyst' ||
    role === 'regulatory_consultant' ||
    role === 'investor_viewer'
}

export function setStoredUserProfileContext(input: {
  role?: StoredUserRole | null
  profiles?: string[]
  defaultProfile?: string | null
}) {
  const profiles = Array.isArray(input.profiles)
    ? input.profiles.map(profile => profile.trim()).filter(Boolean)
    : []
  const defaultProfile = input.defaultProfile && profiles.includes(input.defaultProfile)
    ? input.defaultProfile
    : profiles[0] || null

  localStorage.setItem(USER_PROFILES_STORAGE_KEY, JSON.stringify(profiles))
  if (defaultProfile) localStorage.setItem(USER_DEFAULT_PROFILE_STORAGE_KEY, defaultProfile)
  else localStorage.removeItem(USER_DEFAULT_PROFILE_STORAGE_KEY)

  if (!isScopedBusinessRole(input.role || null)) return

  const activeProfile = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)
  if (defaultProfile && (!activeProfile || !profiles.includes(activeProfile))) {
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, defaultProfile)
    return
  }

  if (!defaultProfile) {
    localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY)
  }
}

export function clearStoredUserProfileContext() {
  localStorage.removeItem(USER_PROFILES_STORAGE_KEY)
  localStorage.removeItem(USER_DEFAULT_PROFILE_STORAGE_KEY)
}

export function getStoredUserProfiles(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_PROFILES_STORAGE_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.map(profile => String(profile || '').trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

export function getStoredDefaultProfile(): string | null {
  return localStorage.getItem(USER_DEFAULT_PROFILE_STORAGE_KEY) || getStoredUserProfiles()[0] || null
}

export function getActiveProfileName(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)
}

function bodyHasProfileSelector(body: BodyInit | null | undefined): boolean {
  if (typeof body !== 'string') return false
  try {
    const parsed = JSON.parse(body) as { profile?: unknown }
    return typeof parsed?.profile === 'string' && parsed.profile.trim().length > 0
  } catch {
    return false
  }
}

function shouldAttachProfileHeader(path: string, options: RequestInit): boolean {
  try {
    const url = new URL(path, 'http://hermes.local')
    if (url.searchParams.has('profile')) return false
    if (url.pathname.startsWith('/api/hermes/profiles')) return false
    if (isProfileWideSessionCollection(url.pathname)) return false
  } catch {
    if (path.startsWith('/api/hermes/profiles')) return false
    if (isProfileWideSessionCollection(path.split('?')[0] || path)) return false
  }
  return !bodyHasProfileSelector(options.body)
}

function isProfileWideSessionCollection(pathname: string): boolean {
  return pathname === '/api/hermes/sessions' ||
    pathname === '/api/hermes/sessions/batch-delete' ||
    pathname === '/api/hermes/search/sessions' ||
    pathname === '/api/hermes/sessions/search' ||
    pathname === '/api/hermes/sessions/conversations'
}

function emitAuthNotice(kind: 'expired' | 'forbidden') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('hermes-auth-notice', { detail: { kind } }))
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getBaseUrl()
  const url = `${base}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  }

  const apiKey = getApiKey()
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  // Inject active profile header for request-scoped endpoints. Explicit profile
  // selectors in the URL/body and profile-name routes are validated directly.
  const profileName = getActiveProfileName()
  if (profileName && shouldAttachProfileHeader(path, options)) {
    headers['X-Hermes-Profile'] = profileName
  }

  const res = await fetch(url, { ...options, headers })

  // Global 401 handler — clear local auth for BFF endpoints without leaving the dashboard shell.
  // Proxied gateway requests should not trigger logout
  const isLocalBff = !path.startsWith('/api/hermes/v1/') &&
    !path.startsWith('/v1/')

  if (res.status === 401 && isLocalBff) {
    clearApiKey()
    clearStoredUserProfileContext()
    emitAuthNotice('expired')
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403 && isLocalBff) {
      if (text.includes('User is disabled or does not exist')) {
        clearApiKey()
        clearStoredUserProfileContext()
        emitAuthNotice('expired')
      } else {
        emitAuthNotice('forbidden')
      }
    }
    throw new Error(`API Error ${res.status}: ${text || res.statusText}`)
  }

  return res.json()
}

export function getBaseUrlValue(): string {
  return getBaseUrl()
}
