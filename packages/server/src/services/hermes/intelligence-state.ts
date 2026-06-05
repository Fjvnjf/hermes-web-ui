import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getActiveProfileName, getProfileDir } from './hermes-profile'

export interface DashboardIntelligenceEnvelope {
  version: 1
  profile: string
  savedAt: string
  savedBy?: {
    id?: number
    username?: string
    role?: string
  }
  state: Record<string, unknown>
}

const STATE_VERSION = 1
const MAX_STATE_BYTES = 10_000_000
const TOP_LEVEL_ARRAY_KEYS = [
  'evidenceItems',
  'marketClaims',
  'competitors',
  'presentationMaterials',
  'researchJobs',
  'researchFindings',
  'financialModels',
  'dataRoomSources',
]
const SECRET_KEY_PATTERN = /api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|cookie|password|secret|jwt/i

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function statePath(profile?: string): string {
  const name = profile || getActiveProfileName() || 'default'
  return join(getProfileDir(name), 'dashboard-intelligence', 'state.json')
}

function redactSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretKeys)
  if (!isPlainRecord(value)) return value

  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    next[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactSecretKeys(child)
  }
  return next
}

export function sanitizeDashboardIntelligenceState(input: unknown): Record<string, unknown> {
  if (!isPlainRecord(input)) {
    throw Object.assign(new Error('Dashboard intelligence state must be a JSON object'), { code: 'invalid_state' })
  }

  const sanitized: Record<string, unknown> = {}
  for (const key of TOP_LEVEL_ARRAY_KEYS) {
    const value = input[key]
    sanitized[key] = Array.isArray(value) ? redactSecretKeys(value) : []
  }
  return sanitized
}

export async function readDashboardIntelligenceState(profile?: string): Promise<DashboardIntelligenceEnvelope | null> {
  try {
    const raw = await readFile(statePath(profile), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DashboardIntelligenceEnvelope>
    if (!parsed || parsed.version !== STATE_VERSION || !isPlainRecord(parsed.state)) return null
    return {
      version: STATE_VERSION,
      profile: parsed.profile || profile || getActiveProfileName() || 'default',
      savedAt: parsed.savedAt || '',
      savedBy: parsed.savedBy,
      state: parsed.state,
    }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

export async function writeDashboardIntelligenceState(input: {
  profile?: string
  state: unknown
  savedBy?: DashboardIntelligenceEnvelope['savedBy']
}): Promise<DashboardIntelligenceEnvelope> {
  const profile = input.profile || getActiveProfileName() || 'default'
  const state = sanitizeDashboardIntelligenceState(input.state)
  const envelope: DashboardIntelligenceEnvelope = {
    version: STATE_VERSION,
    profile,
    savedAt: new Date().toISOString(),
    savedBy: input.savedBy,
    state,
  }
  const serialized = JSON.stringify(envelope, null, 2)
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_STATE_BYTES) {
    throw Object.assign(new Error('Dashboard intelligence state is too large'), { code: 'state_too_large' })
  }

  const filePath = statePath(profile)
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, serialized, 'utf-8')
  await rename(tempPath, filePath)
  return envelope
}
