import { getActiveProfileName, getApiKey, getBaseUrlValue, request } from '../client'

export type BackupType =
  | 'full-owner'
  | 'business'
  | 'investor-approved'
  | 'code'
  | 'memory-chat'
  | 'documents'

export interface BrowserWorkspaceState {
  exportedAt: string
  localStorage: Record<string, unknown>
  excludedKeys: string[]
  notes: string[]
}

export interface BackupStatus {
  backupDir: string
  lastBackup: null | {
    file: string
    type: BackupType | 'unknown'
    createdAt: string
    size: number
    checksumFile: string | null
  }
  backups: Array<{
    file: string
    type: BackupType | 'unknown'
    createdAt: string
    size: number
    checksumFile: string | null
  }>
  schedule: {
    enabled: boolean
    schedule: string
    scheduleDisplay: string
    keepLast: number
    type: BackupType
    lastUpdatedAt: string | null
    note: string
  }
}

const SAFE_BROWSER_STATE_KEYS = [
  'hermes.rawMaterialSourcing.v1',
  'hermes.exportMarketOpportunity.v1',
  'hermes.feasibilityIntelligence.v1',
  'hermes.investmentCalculator.scenarios.v1',
  'hermes.executiveIntelligenceBoard.v1',
  'hermes.sidebar.collapsedGroups',
  'hermes_brightness',
  'hermes_locale',
  'hermes-tts-settings-v2',
]

const SAFE_BROWSER_STATE_PREFIXES = [
  'hermes.sessionCapture.',
  'hermes.capture.',
]

const SENSITIVE_BROWSER_KEY_RE = /(api[_-]?key|token|secret|password|passwd|jwt|bearer|authorization|credential|private[_-]?key|ssh|cloudflare|tunnel|cookie|sessionid)/i

export function collectBackupBrowserState(storage: Storage = window.localStorage): BrowserWorkspaceState {
  const localStorage: Record<string, unknown> = {}
  const excludedKeys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key) continue
    const safeKey = SAFE_BROWSER_STATE_KEYS.includes(key) || SAFE_BROWSER_STATE_PREFIXES.some(prefix => key.startsWith(prefix))
    if (!safeKey || SENSITIVE_BROWSER_KEY_RE.test(key)) {
      excludedKeys.push(key)
      continue
    }
    const raw = storage.getItem(key)
    if (raw == null) continue
    try {
      localStorage[key] = JSON.parse(raw)
    } catch {
      localStorage[key] = raw
    }
  }
  return {
    exportedAt: new Date().toISOString(),
    localStorage,
    excludedKeys,
    notes: [
      'Auth tokens, API keys, passwords, provider credentials, cookies, tunnel credentials, and SSH/private-key-like values are excluded.',
      'This file only contains allowlisted Hermes workspace state from this browser.',
    ],
  }
}

function backupHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getApiKey()
  if (token) headers.Authorization = `Bearer ${token}`
  const profileName = getActiveProfileName()
  if (profileName) headers['X-Hermes-Profile'] = profileName
  return headers
}

function downloadBlob(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

function filenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1])
  const plainMatch = disposition.match(/filename="?([^"]+)"?/i)
  return plainMatch?.[1] ? decodeURIComponent(plainMatch[1]) : fallback
}

export async function fetchBackupStatus(): Promise<BackupStatus> {
  return request<BackupStatus>('/api/hermes/backup/status')
}

export async function downloadBackupArchive(type: BackupType, includeBrowserState: boolean): Promise<string> {
  const base = getBaseUrlValue()
  const browserState = includeBrowserState ? collectBackupBrowserState() : null
  const res = await fetch(`${base}/api/hermes/backup/export`, {
    method: 'POST',
    headers: backupHeaders(),
    body: JSON.stringify({ type, browserState }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(body.error || `Backup export failed: ${res.status}`)
  }
  const fileName = filenameFromDisposition(res.headers.get('content-disposition'), `hermes-${type}-backup.zip`)
  downloadBlob(await res.blob(), fileName)
  return fileName
}

export async function createBackupSnapshot(type: BackupType, includeBrowserState: boolean) {
  return request<{ ok: true; snapshot: { file: string; checksumFile: string; size: number; sha256: string } }>('/api/hermes/backup/snapshot', {
    method: 'POST',
    body: JSON.stringify({
      type,
      browserState: includeBrowserState ? collectBackupBrowserState() : null,
    }),
  })
}

export async function saveBackupSchedule(type: BackupType, enabled: boolean) {
  return request<{ ok: true; schedule: BackupStatus['schedule'] }>('/api/hermes/backup/schedule', {
    method: 'POST',
    body: JSON.stringify({ type, enabled }),
  })
}
