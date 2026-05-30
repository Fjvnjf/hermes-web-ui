import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, statSync } from 'fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, join, relative, resolve } from 'path'
import { config } from '../../config'
import { getDb, getStoragePath, jsonGetAll } from '../../db'
import { getActiveProfileName, getProfileDir } from '../hermes/hermes-profile'
import { listBoards, listTasks } from '../hermes/hermes-kanban'
import { createZipArchive, sha256Hex, type ZipEntryInput } from './zip'

const execFileAsync = promisify(execFile)

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

interface ManifestItem {
  path: string
  status: 'included' | 'missing' | 'redacted' | 'placeholder'
  category: string
  detail?: string
  bytes?: number
  sha256?: string
}

interface BackupBuildOptions {
  type: BackupType
  profile?: string
  browserState?: BrowserWorkspaceState | null
}

export interface BackupBuildResult {
  type: BackupType
  filename: string
  buffer: Buffer
  manifest: {
    backupType: BackupType
    generatedAt: string
    profile: string
    redactionPolicy: string
    items: ManifestItem[]
  }
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
  schedule: BackupScheduleState
}

export interface BackupScheduleState {
  enabled: boolean
  schedule: string
  scheduleDisplay: string
  keepLast: number
  type: BackupType
  lastUpdatedAt: string | null
  note: string
}

const BACKUP_TYPES = new Set<BackupType>([
  'full-owner',
  'business',
  'investor-approved',
  'code',
  'memory-chat',
  'documents',
])

const DEFAULT_SCHEDULE: BackupScheduleState = {
  enabled: false,
  schedule: '0 9,21 * * *',
  scheduleDisplay: '09:00 and 21:00 local time',
  keepLast: 7,
  type: 'full-owner',
  lastUpdatedAt: null,
  note: 'Schedule metadata only. Use Create Backup Now or a trusted external scheduler until an owner-approved backup runner is configured.',
}

const SENSITIVE_KEY_RE = /(api[_-]?key|token|secret|password|passwd|jwt|bearer|authorization|credential|private[_-]?key|ssh|cloudflare|tunnel|cookie|session)/i
const DOCUMENT_FILE_LIMIT = 25 * 1024 * 1024
const DOCUMENT_TOTAL_LIMIT = 100 * 1024 * 1024
const CODE_FILE_LIMIT = 3 * 1024 * 1024
const CODE_TOTAL_LIMIT = 60 * 1024 * 1024

export function normalizeBackupType(value: unknown): BackupType {
  const text = String(value || 'full-owner')
  return BACKUP_TYPES.has(text as BackupType) ? text as BackupType : 'full-owner'
}

export function backupDir(): string {
  return join(config.appHome, 'backups')
}

function schedulePath(): string {
  return join(backupDir(), 'backup-schedule.json')
}

function nowIso(): string {
  return new Date().toISOString()
}

function safeNamePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'default'
}

function backupFileName(type: BackupType, profile: string, generatedAt: string): string {
  return `hermes-${type}-${safeNamePart(profile)}-${generatedAt.replace(/[:.]/g, '-')}.zip`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function redactSensitiveData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactSensitiveData(item)) as T
  if (!isPlainObject(value)) return value
  const redacted: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      redacted[key] = '[REDACTED]'
    } else {
      redacted[key] = redactSensitiveData(raw)
    }
  }
  return redacted as T
}

function addJson(entries: ZipEntryInput[], manifestItems: ManifestItem[], path: string, value: unknown, category: string, status: ManifestItem['status'] = 'included', detail?: string) {
  const data = `${JSON.stringify(redactSensitiveData(value), null, 2)}\n`
  entries.push({ path, data })
  manifestItems.push({ path, status, category, detail, bytes: Buffer.byteLength(data), sha256: sha256Hex(data) })
}

function addText(entries: ZipEntryInput[], manifestItems: ManifestItem[], path: string, text: string, category: string, status: ManifestItem['status'] = 'included', detail?: string) {
  const data = text.endsWith('\n') ? text : `${text}\n`
  entries.push({ path, data })
  manifestItems.push({ path, status, category, detail, bytes: Buffer.byteLength(data), sha256: sha256Hex(data) })
}

function addBuffer(entries: ZipEntryInput[], manifestItems: ManifestItem[], path: string, data: Buffer, category: string, detail?: string, mtime?: Date) {
  entries.push({ path, data, mtime })
  manifestItems.push({ path, status: 'included', category, detail, bytes: data.length, sha256: sha256Hex(data) })
}

function addPlaceholder(entries: ZipEntryInput[], manifestItems: ManifestItem[], path: string, detail: string, category: string) {
  addText(entries, manifestItems, path, `not available / not connected\n\n${detail}`, category, 'placeholder', detail)
}

function includeCategory(type: BackupType, category: string): boolean {
  if (type === 'full-owner') return true
  if (type === 'business') return !['01_dashboard_code', '02_database', '12_audit_logs'].includes(category)
  if (type === 'investor-approved') return ['00_manifest', '08_reports_presentations', '13_config_redacted'].includes(category)
  if (type === 'code') return ['00_manifest', '01_dashboard_code', '13_config_redacted'].includes(category)
  if (type === 'memory-chat') return ['00_manifest', '03_memory', '04_chat_sessions', '13_config_redacted'].includes(category)
  if (type === 'documents') return ['00_manifest', '07_documents', '13_config_redacted'].includes(category)
  return false
}

async function commandOrPlaceholder(command: string, args: string[], fallback: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, { cwd: process.cwd(), timeout: 10_000, maxBuffer: 2 * 1024 * 1024 })
    return stdout.trim() || fallback
  } catch {
    return fallback
  }
}

async function addCodeSnapshot(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '01_dashboard_code')) return
  const commit = await commandOrPlaceholder('git', ['rev-parse', 'HEAD'], 'not available')
  const branch = await commandOrPlaceholder('git', ['branch', '--show-current'], 'not available')
  const changedFiles = await commandOrPlaceholder('git', ['status', '--short'], 'not available')
  addText(entries, manifestItems, '01_dashboard_code/git-commit.txt', commit, '01_dashboard_code')
  addText(entries, manifestItems, '01_dashboard_code/branch.txt', branch, '01_dashboard_code')
  addText(entries, manifestItems, '01_dashboard_code/changed-files.txt', changedFiles || 'Working tree clean', '01_dashboard_code')
  addText(entries, manifestItems, '01_dashboard_code/deployment-notes.md', [
    '# Deployment Notes',
    '',
    'This backup includes source-control metadata and redacted runtime configuration only.',
    'Secrets, tokens, provider keys, SSH keys, and Cloudflare tunnel credentials are not included.',
    'Restore code from the Git remote/commit first, then restore data/documents from this archive.',
  ].join('\n'), '01_dashboard_code')

  for (const file of ['package.json', 'package-lock.json', 'SPEC.md']) {
    const path = resolve(process.cwd(), file)
    if (existsSync(path)) {
      addBuffer(entries, manifestItems, `01_dashboard_code/${file}`, await readFile(path), '01_dashboard_code')
    } else {
      addPlaceholder(entries, manifestItems, `01_dashboard_code/${file}.missing.txt`, `${file} was not present in the working tree.`, '01_dashboard_code')
    }
  }

  if (type !== 'code') return
  const files = await commandOrPlaceholder('git', ['ls-files', '-z'], '')
  if (!files) {
    addPlaceholder(entries, manifestItems, '01_dashboard_code/repository/not-available.txt', 'git ls-files did not return repository files.', '01_dashboard_code')
    return
  }
  let totalBytes = 0
  let skipped = 0
  for (const rel of files.split('\0').filter(Boolean)) {
    const abs = resolve(process.cwd(), rel)
    if (!existsSync(abs)) continue
    const fileStat = statSync(abs)
    if (!fileStat.isFile()) continue
    if (fileStat.size > CODE_FILE_LIMIT || totalBytes + fileStat.size > CODE_TOTAL_LIMIT) {
      skipped += 1
      continue
    }
    totalBytes += fileStat.size
    addBuffer(entries, manifestItems, `01_dashboard_code/repository/${rel}`, await readFile(abs), '01_dashboard_code', undefined, fileStat.mtime)
  }
  if (skipped) {
    addText(entries, manifestItems, '01_dashboard_code/repository/skipped-large-files.txt', `${skipped} tracked file(s) were skipped because the code snapshot size limit was reached. Use git remote/commit for full source restore.`, '01_dashboard_code', 'placeholder')
  }
}

function listTables(): Array<{ name: string; sql?: string }> {
  const db = getDb()
  if (!db) return []
  try {
    return db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; sql?: string }>
  } catch {
    return []
  }
}

function tableRows(table: string, limit = 500): unknown[] {
  const db = getDb()
  if (!db) return []
  try {
    const quoted = `"${table.replace(/"/g, '""')}"`
    return db.prepare(`SELECT * FROM ${quoted} LIMIT ?`).all(limit) as unknown[]
  } catch {
    return []
  }
}

function addDatabaseExport(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '02_database')) return
  const storagePath = getStoragePath()
  const tables = listTables()
  if (!tables.length) {
    addPlaceholder(entries, manifestItems, '02_database/database-not-available.txt', 'SQLite database was unavailable or empty during backup generation.', '02_database')
    return
  }
  addText(entries, manifestItems, '02_database/database-schema.sql', tables.map(table => table.sql || `-- ${table.name}: schema unavailable`).join(';\n\n'), '02_database')
  addJson(entries, manifestItems, '02_database/database-export-redacted.json', {
    storagePath: basename(storagePath),
    note: 'Raw database copy is intentionally excluded from default backups because it can contain password hashes, tokens, and unfiltered sensitive state.',
    tables: Object.fromEntries(tables.map(table => [table.name, tableRows(table.name)])),
  }, '02_database', 'redacted')
  addPlaceholder(entries, manifestItems, '02_database/raw-database-copy-excluded.txt', 'Raw hermes-web-ui.db copy is not included by default. Use a future encrypted full recovery backup if raw DB restore is required.', '02_database')
}

async function safeReadText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

async function addMemory(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType, profile: string) {
  if (!includeCategory(type, '03_memory')) return
  const profileDir = getProfileDir(profile)
  const files = [
    ['memory.md', join(profileDir, 'memories', 'MEMORY.md')],
    ['user.md', join(profileDir, 'memories', 'USER.md')],
    ['soul.md', join(profileDir, 'SOUL.md')],
  ] as const
  const memoryJson: Record<string, string> = {}
  let found = false
  for (const [name, path] of files) {
    const content = await safeReadText(path)
    if (content == null) {
      addPlaceholder(entries, manifestItems, `03_memory/${name}.missing.txt`, `${name} was not present for profile ${profile}.`, '03_memory')
      continue
    }
    found = true
    memoryJson[name] = content
    addText(entries, manifestItems, `03_memory/${name}`, content, '03_memory')
  }
  if (!found) addPlaceholder(entries, manifestItems, '03_memory/memory-not-available.txt', 'No memory files were found for the active profile.', '03_memory')
  addJson(entries, manifestItems, '03_memory/memory.json', memoryJson, '03_memory')
  addJson(entries, manifestItems, '03_memory/approved-memory.json', [], '03_memory', 'placeholder', 'Approved memory categories are not separated yet.')
  addJson(entries, manifestItems, '03_memory/project-memory.json', [], '03_memory', 'placeholder', 'Project-specific memory storage is not connected yet.')
}

function addSessions(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '04_chat_sessions')) return
  const sessions = tableRows('sessions', 200)
  const summaries = tableRows('chat_compression_snapshots', 200)
  if (!sessions.length) {
    addPlaceholder(entries, manifestItems, '04_chat_sessions/session-index.json', 'No chat sessions were available from the dashboard database.', '04_chat_sessions')
  } else {
    addJson(entries, manifestItems, '04_chat_sessions/session-index.json', sessions, '04_chat_sessions')
  }
  addJson(entries, manifestItems, '04_chat_sessions/session-summaries/summaries.json', summaries, '04_chat_sessions', summaries.length ? 'included' : 'placeholder', summaries.length ? undefined : 'No generated chat compression/session summaries were found.')
  addJson(entries, manifestItems, '04_chat_sessions/captured-items.json', tableRows('session_capture_items', 500), '04_chat_sessions', 'placeholder', 'Captured items may also live in browser state; include browser workspace state to preserve local-only capture flags.')
  addPlaceholder(entries, manifestItems, '04_chat_sessions/important-sessions/README.md', 'Important session tagging is not connected yet. Raw transcripts are excluded from default backup unless an explicit encrypted/full transcript workflow is added later.', '04_chat_sessions')
}

function addProjects(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '05_projects')) return
  addJson(entries, manifestItems, '05_projects/projects.json', [
    { id: 'chemicon-china-feasibility', name: 'Chemicon China Feasibility', status: 'workspace shell / owner-managed' },
    { id: 'product-research', name: 'Product Research', status: 'workspace shell / owner-managed' },
    { id: 'manufacturing-research', name: 'Manufacturing Research', status: 'workspace shell / owner-managed' },
    { id: 'market-research', name: 'Market Research', status: 'workspace shell / owner-managed' },
    { id: 'investment-research', name: 'Investment Research', status: 'workspace shell / owner-managed' },
    { id: 'personal-research', name: 'Personal Research', status: 'workspace shell / owner-managed' },
  ], '05_projects')
  for (const folder of ['chemicon-china-feasibility', 'product-research', 'manufacturing-research', 'market-research', 'investment-research', 'personal-research']) {
    addPlaceholder(entries, manifestItems, `05_projects/${folder}/README.md`, 'Project-specific persistent folders are not connected yet; use Documents, Memory, Kanban, and browser workspace state sections.', '05_projects')
  }
}

async function addKanban(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '06_tasks_kanban')) return
  try {
    const boards = await listBoards({ includeArchived: true })
    addJson(entries, manifestItems, '06_tasks_kanban/boards.json', boards, '06_tasks_kanban')
    const allTasks = []
    for (const board of boards) {
      try {
        const tasks = await listTasks({ board: board.slug, includeArchived: true })
        allTasks.push(...tasks.map(task => ({ ...task, board: board.slug })))
      } catch {
        allTasks.push({ board: board.slug, error: 'not available / not connected' })
      }
    }
    addJson(entries, manifestItems, '06_tasks_kanban/tasks.json', allTasks, '06_tasks_kanban')
    addJson(entries, manifestItems, '06_tasks_kanban/evidence-gap-tasks.json', allTasks.filter((task: any) => `${task.title || ''} ${task.body || ''}`.toLowerCase().includes('evidence')), '06_tasks_kanban')
    addJson(entries, manifestItems, '06_tasks_kanban/research-job-tasks.json', allTasks.filter((task: any) => `${task.title || ''} ${task.body || ''}`.toLowerCase().includes('research')), '06_tasks_kanban')
  } catch (error: any) {
    addPlaceholder(entries, manifestItems, '06_tasks_kanban/kanban-not-available.txt', error?.message || 'Kanban CLI data was unavailable.', '06_tasks_kanban')
  }
}

async function walkFiles(root: string, onFile: (abs: string, rel: string, size: number, mtime: Date) => Promise<boolean>) {
  if (!existsSync(root)) return
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(root, entry.name)
    const rel = relative(root, abs).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      await walkFiles(abs, async (nestedAbs, nestedRel, size, mtime) => onFile(nestedAbs, `${entry.name}/${nestedRel}`.replace(/\\/g, '/'), size, mtime))
    } else if (entry.isFile()) {
      const fileStat = await stat(abs)
      await onFile(abs, rel, fileStat.size, fileStat.mtime)
    }
  }
}

async function addDocuments(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '07_documents')) return
  if (type === 'investor-approved') {
    addPlaceholder(entries, manifestItems, '07_documents/investor-approved-only.txt', 'Investor-approved document filtering is not connected yet. Raw documents are excluded from investor-approved backup.', '07_documents')
    return
  }
  let total = 0
  let count = 0
  let skipped = 0
  await walkFiles(config.uploadDir, async (abs, rel, size, mtime) => {
    if (SENSITIVE_KEY_RE.test(rel) || size > DOCUMENT_FILE_LIMIT || total + size > DOCUMENT_TOTAL_LIMIT) {
      skipped += 1
      return true
    }
    total += size
    count += 1
    addBuffer(entries, manifestItems, `07_documents/uploaded-files/${rel}`, await readFile(abs), '07_documents', undefined, mtime)
    return true
  })
  if (!count) addPlaceholder(entries, manifestItems, '07_documents/uploaded-files/not-available.txt', 'No uploaded documents were found in the dashboard upload directory.', '07_documents')
  if (skipped) addText(entries, manifestItems, '07_documents/skipped-files.txt', `${skipped} document file(s) were skipped because of secret-like names or size limits.`, '07_documents', 'placeholder')
  for (const folder of ['tds-sds-coa', 'business-license', 'machine-quotes', 'supplier-quotes', 'investor-docs']) {
    addPlaceholder(entries, manifestItems, `07_documents/${folder}/README.md`, 'Document category folders are placeholders until document classification is connected.', '07_documents')
  }
}

function addReports(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '08_reports_presentations')) return
  const dataRoom = tableRows('data_room_sources', 500)
  addJson(entries, manifestItems, '08_reports_presentations/investor-readiness/data-room-sources.json', dataRoom, '08_reports_presentations', dataRoom.length ? 'included' : 'placeholder', dataRoom.length ? undefined : 'Data-room sources are browser/local intelligence state unless saved elsewhere.')
  addPlaceholder(entries, manifestItems, '08_reports_presentations/feasibility-reports/README.md', 'Generated feasibility reports are not stored in a dedicated backend table yet. Include browser state and Documents to preserve local drafts.', '08_reports_presentations')
  addPlaceholder(entries, manifestItems, '08_reports_presentations/investor-presentation-drafts/README.md', 'Investor presentation builder drafts are browser/local intelligence state unless saved to Documents.', '08_reports_presentations')
  addPlaceholder(entries, manifestItems, '08_reports_presentations/market-reports/README.md', 'Market reports are not stored as backend reports yet.', '08_reports_presentations')
  addPlaceholder(entries, manifestItems, '08_reports_presentations/competitor-reports/README.md', 'Competitor reports are not stored as backend reports yet.', '08_reports_presentations')
  addPlaceholder(entries, manifestItems, '08_reports_presentations/irr-scenarios/README.md', 'IRR scenarios are browser/local state unless exported to Documents.', '08_reports_presentations')
}

function addLocalIntelligencePlaceholders(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType, browserState?: BrowserWorkspaceState | null) {
  if (includeCategory(type, '09_market_competitor_intelligence')) {
    const note = browserState ? 'See 00_manifest/browser-state.json for local Market/Competitor/Research Review state.' : 'Include Browser Workspace State to preserve local Market/Competitor/Research Review state.'
    for (const file of ['market-claims.json', 'competitor-records.json', 'export-market-opportunity.json', 'research-result-review.json']) {
      addPlaceholder(entries, manifestItems, `09_market_competitor_intelligence/${file}`, note, '09_market_competitor_intelligence')
    }
  }
  if (includeCategory(type, '10_raw_material_sourcing')) {
    const note = browserState ? 'See 00_manifest/browser-state.json for local raw material sourcing state.' : 'Include Browser Workspace State to preserve local raw material sourcing state.'
    for (const file of ['raw-material-price-history.json', 'supplier-quotes.json', 'landed-cost-records.json', 'sourcing-notes.md']) {
      addPlaceholder(entries, manifestItems, `10_raw_material_sourcing/${file}`, note, '10_raw_material_sourcing')
    }
  }
}

async function addJobsAndActivity(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType, profile: string) {
  if (!includeCategory(type, '11_jobs_and_activity')) return
  const jobsPath = join(getProfileDir(profile), 'cron', 'jobs.json')
  const jobsContent = await safeReadText(jobsPath)
  if (jobsContent) {
    addJson(entries, manifestItems, '11_jobs_and_activity/hermes-jobs.json', JSON.parse(jobsContent), '11_jobs_and_activity')
  } else {
    addPlaceholder(entries, manifestItems, '11_jobs_and_activity/hermes-jobs.json', 'Hermes jobs file was not present for this profile.', '11_jobs_and_activity')
  }
  addPlaceholder(entries, manifestItems, '11_jobs_and_activity/last-24-hours.json', 'Last 24 Hours is generated live from sessions/jobs/files/memory and is not stored as a standalone backend record.', '11_jobs_and_activity')
  addPlaceholder(entries, manifestItems, '11_jobs_and_activity/research-jobs.json', 'Research jobs may live in browser workspace state or Hermes Jobs. Include browser state and jobs backup.', '11_jobs_and_activity')
  addJson(entries, manifestItems, '11_jobs_and_activity/activity-log.json', tableRows('session_usage', 500), '11_jobs_and_activity')
}

async function tailFile(path: string, maxLines = 1000): Promise<string | null> {
  const content = await safeReadText(path)
  if (content == null) return null
  const lines = content.trim().split('\n')
  return `${lines.slice(-maxLines).join('\n')}\n`
}

async function addAuditLogs(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '12_audit_logs')) return
  const auditPath = join(config.appHome, 'logs', 'access-audit.jsonl')
  const audit = await tailFile(auditPath)
  if (!audit) {
    addPlaceholder(entries, manifestItems, '12_audit_logs/access-audit.jsonl', 'Access audit log file was not found.', '12_audit_logs')
    addPlaceholder(entries, manifestItems, '12_audit_logs/denied-access-events.jsonl', 'Access audit log file was not found.', '12_audit_logs')
    addPlaceholder(entries, manifestItems, '12_audit_logs/user-role-changes.jsonl', 'Access audit log file was not found.', '12_audit_logs')
    return
  }
  const lines = audit.trim().split('\n').filter(Boolean)
  addText(entries, manifestItems, '12_audit_logs/access-audit.jsonl', audit, '12_audit_logs')
  addText(entries, manifestItems, '12_audit_logs/denied-access-events.jsonl', lines.filter(line => line.includes('"result":"denied"')).join('\n'), '12_audit_logs')
  addText(entries, manifestItems, '12_audit_logs/user-role-changes.jsonl', lines.filter(line => line.includes('role')).join('\n'), '12_audit_logs')
}

function addRedactedConfig(entries: ZipEntryInput[], manifestItems: ManifestItem[], type: BackupType) {
  if (!includeCategory(type, '13_config_redacted')) return
  addJson(entries, manifestItems, '13_config_redacted/config-redacted.json', {
    appHome: config.appHome,
    uploadDir: config.uploadDir,
    port: config.port,
    host: config.host,
    corsOrigins: config.corsOrigins ? '[REDACTED]' : '',
    note: 'Runtime secrets and provider keys are excluded.',
  }, '13_config_redacted', 'redacted')
  addText(entries, manifestItems, '13_config_redacted/env-redacted.txt', [
    'Environment values are intentionally excluded.',
    'Secret-like keys are redacted by name and never exported in plaintext.',
    'Excluded categories: API keys, JWT secrets, provider keys, SSH keys, passwords, tokens, Cloudflare tunnel credentials, cookies, sessions.',
  ].join('\n'), '13_config_redacted', 'redacted')
  addJson(entries, manifestItems, '13_config_redacted/models-redacted.json', {
    note: 'Model/provider names may be visible in application settings. Provider keys and credentials are excluded.',
  }, '13_config_redacted', 'redacted')
}

function restoreInstructions(type: BackupType): string {
  return [
    '# Hermes Backup Restore Instructions',
    '',
    `Backup type: ${type}`,
    '',
    'This archive is a disaster-recovery export. It is not an automatic destructive restore package.',
    '',
    '## What is included',
    '- Manifest, summary, checksums, and redaction notes.',
    '- Available Memory, session summaries/indexes, Kanban tasks, documents, reports/intelligence placeholders, jobs/activity, audit logs, and redacted configuration depending on backup type.',
    '- Browser workspace state only when the owner selected Include Browser Workspace State before download.',
    '',
    '## What is redacted or excluded',
    '- API keys, JWT secrets, provider keys, SSH keys, passwords, tokens, cookies, Cloudflare tunnel credentials, and raw `.env` secret values.',
    '- Raw database copies are excluded from default backups because they can contain password hashes and unfiltered sensitive state.',
    '- Raw full chat transcripts are excluded by default. Use session History as the source of raw conversations until an encrypted transcript backup is added.',
    '',
    '## Restore outline',
    '1. Restore the codebase from Git using `01_dashboard_code/git-commit.txt` and `branch.txt`.',
    '2. Reinstall dependencies and rebuild the dashboard from the restored code.',
    '3. Restore uploaded documents from `07_documents/uploaded-files/` into the dashboard upload directory.',
    '4. Restore Memory manually from `03_memory/*.md` after checking content sensitivity.',
    '5. Recreate or import tasks from `06_tasks_kanban/tasks.json` using Kanban.',
    '6. Recreate report drafts from `08_reports_presentations/` and browser state where available.',
    '7. Re-enter secrets manually into secure runtime config. Do not expect this backup to contain keys/passwords.',
    '',
    '## Cannot be restored automatically yet',
    '- Project-level permissions and document categories.',
    '- Raw secrets and provider credentials.',
    '- Live Cloudflare quick tunnel URL.',
    '- Browser local state unless included in this backup.',
  ].join('\n')
}

function backupSummary(type: BackupType, profile: string): string {
  return [
    '# Hermes Local Backup Vault Summary',
    '',
    `Type: ${type}`,
    `Profile: ${profile}`,
    `Generated: ${nowIso()}`,
    '',
    'This backup is owner-only and may contain sensitive business/product-development material.',
    'Default exports intentionally exclude plaintext secrets and raw credential files.',
  ].join('\n')
}

export async function buildBackupArchive(options: BackupBuildOptions): Promise<BackupBuildResult> {
  const type = normalizeBackupType(options.type)
  const profile = options.profile || getActiveProfileName() || 'default'
  const generatedAt = nowIso()
  const entries: ZipEntryInput[] = []
  const manifestItems: ManifestItem[] = []

  await addCodeSnapshot(entries, manifestItems, type)
  addDatabaseExport(entries, manifestItems, type)
  await addMemory(entries, manifestItems, type, profile)
  addSessions(entries, manifestItems, type)
  addProjects(entries, manifestItems, type)
  await addKanban(entries, manifestItems, type)
  await addDocuments(entries, manifestItems, type)
  addReports(entries, manifestItems, type)
  addLocalIntelligencePlaceholders(entries, manifestItems, type, options.browserState)
  await addJobsAndActivity(entries, manifestItems, type, profile)
  await addAuditLogs(entries, manifestItems, type)
  addRedactedConfig(entries, manifestItems, type)

  if (includeCategory(type, '00_manifest')) {
    if (options.browserState) {
      addJson(entries, manifestItems, '00_manifest/browser-state.json', options.browserState, '00_manifest')
    } else {
      addPlaceholder(entries, manifestItems, '00_manifest/browser-state-not-included.txt', 'Browser workspace state was not included. Local-only intelligence, IRR scenarios, capture flags, and dashboard preferences may not be fully backed up.', '00_manifest')
    }
    addText(entries, manifestItems, '00_manifest/backup-summary.md', backupSummary(type, profile), '00_manifest')
    addText(entries, manifestItems, '00_manifest/restore-instructions.md', restoreInstructions(type), '00_manifest')
  }

  const manifest = {
    backupType: type,
    generatedAt,
    profile,
    redactionPolicy: 'Plaintext secrets, tokens, passwords, provider keys, SSH keys, and Cloudflare credentials are excluded or redacted by default.',
    items: manifestItems,
  }
  addJson(entries, manifestItems, '00_manifest/backup-manifest.json', manifest, '00_manifest')

  const checksumLines = entries
    .filter(entry => entry.path !== '00_manifest/checksums.sha256')
    .map(entry => {
      const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf-8')
      return `${createHash('sha256').update(data).digest('hex')}  ${entry.path}`
    })
    .join('\n')
  addText(entries, manifestItems, '00_manifest/checksums.sha256', checksumLines, '00_manifest')

  const filename = backupFileName(type, profile, generatedAt)
  const buffer = createZipArchive(entries)
  return { type, filename, buffer, manifest }
}

async function pruneOldBackups(type: BackupType, keepLast = 7) {
  const dir = backupDir()
  const files = (await readdir(dir).catch(() => []))
    .filter(file => file.startsWith(`hermes-${type}-`) && file.endsWith('.zip'))
    .map(file => ({ file, path: join(dir, file), mtime: statSync(join(dir, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const stale of files.slice(keepLast)) {
    await rm(stale.path, { force: true }).catch(() => {})
    await rm(`${stale.path}.sha256`, { force: true }).catch(() => {})
  }
}

export async function createBackupSnapshot(options: BackupBuildOptions): Promise<{ file: string; checksumFile: string; size: number; sha256: string }> {
  const built = await buildBackupArchive(options)
  const dir = backupDir()
  await mkdir(dir, { recursive: true })
  const filePath = join(dir, built.filename)
  const checksum = sha256Hex(built.buffer)
  await writeFile(filePath, built.buffer)
  await writeFile(`${filePath}.sha256`, `${checksum}  ${built.filename}\n`, 'utf-8')
  await pruneOldBackups(built.type, 7)
  return { file: filePath, checksumFile: `${filePath}.sha256`, size: built.buffer.length, sha256: checksum }
}

export async function getBackupStatus(): Promise<BackupStatus> {
  const dir = backupDir()
  await mkdir(dir, { recursive: true })
  const files = await readdir(dir).catch(() => [])
  const backups = files
    .filter(file => file.endsWith('.zip'))
    .map(file => {
      const filePath = join(dir, file)
      const fileStat = statSync(filePath)
      const match = file.match(/^hermes-([a-z-]+)-/)
      const type: BackupType | 'unknown' = match && BACKUP_TYPES.has(match[1] as BackupType) ? match[1] as BackupType : 'unknown'
      return {
        file,
        type,
        createdAt: fileStat.mtime.toISOString(),
        size: fileStat.size,
        checksumFile: existsSync(`${filePath}.sha256`) ? `${file}.sha256` : null,
      }
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return {
    backupDir: dir,
    lastBackup: backups[0] || null,
    backups,
    schedule: await readBackupSchedule(),
  }
}

export async function readBackupSchedule(): Promise<BackupScheduleState> {
  const raw = await safeReadText(schedulePath())
  if (!raw) return { ...DEFAULT_SCHEDULE }
  try {
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SCHEDULE }
  }
}

export async function saveBackupSchedule(input: Partial<BackupScheduleState>): Promise<BackupScheduleState> {
  const next: BackupScheduleState = {
    ...DEFAULT_SCHEDULE,
    ...(await readBackupSchedule()),
    ...input,
    type: normalizeBackupType(input.type || DEFAULT_SCHEDULE.type),
    lastUpdatedAt: nowIso(),
    note: DEFAULT_SCHEDULE.note,
  }
  await mkdir(backupDir(), { recursive: true })
  await writeFile(schedulePath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function fallbackJsonStore(): Record<string, unknown> {
  return redactSensitiveData(jsonGetAll('backup') || {})
}
