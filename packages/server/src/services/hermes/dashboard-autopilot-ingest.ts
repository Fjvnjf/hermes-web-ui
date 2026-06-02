import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { logger } from '../logger'
import { getHermesBin } from './hermes-path'
import { getActiveProfileName, getProfileDir } from './hermes-profile'
import {
  readDashboardIntelligenceState,
  writeDashboardIntelligenceState,
} from './intelligence-state'

export const FULL_DASHBOARD_AUTOPILOT_JOB_NAME = 'Full Dashboard Trusted Source Autopilot'
export const FULL_DASHBOARD_AUTOPILOT_SCHEDULE = '0 7,19 * * *'

const execFileAsync = promisify(execFile)
const CREATE_TIMEOUT_MS = 60_000
const RUN_TIMEOUT_MS = 15 * 60_000

const DASHBOARD_UPDATE_GROUPS = [
  'marketClaims',
  'competitorRecords',
  'rawMaterialSignals',
  'supplierScorecards',
  'regulatoryFindings',
  'financialEvidence',
  'evidenceGaps',
  'suggestedTasks',
  'investorMaterialCandidates',
] as const

const AUTO_TRUSTED_STATUSES = new Set([
  'Trusted Source Auto-Updated',
  'Official Data',
  'Source-backed',
  'Supplier Evidence',
])

const VALID_CONFIDENCE = new Set(['low', 'medium', 'high'])
const VALID_EVIDENCE_STATUSES = new Set([
  'Missing',
  'To Verify',
  'Assumption',
  'Powerful Assumption',
  'Source-backed',
  'Official Data',
  'Trusted Source Auto-Updated',
  'Supplier Evidence',
  'Market Reference',
  'Trade Proxy',
  'Candidate Source',
  'Conflict Detected',
  'Derived from Assumptions',
  'Hypothesis',
  'Reference Only',
  'User Provided',
  'User Approved',
  'Investor Approved',
  'Approved Assumption',
  'Verified',
])

const VALID_DATA_TYPES = new Set([
  'trade_data',
  'market_size',
  'price_data',
  'competitor_data',
  'company_data',
  'regulatory_data',
  'financial_data',
  'supplier_quote',
  'document_evidence',
  'internal_activity',
])

const GROUP_DEFAULT_DATA_TYPE: Record<DashboardResearchUpdateGroup, string> = {
  marketClaims: 'market_size',
  competitorRecords: 'competitor_data',
  rawMaterialSignals: 'price_data',
  supplierScorecards: 'supplier_quote',
  regulatoryFindings: 'regulatory_data',
  financialEvidence: 'financial_data',
  evidenceGaps: 'document_evidence',
  suggestedTasks: 'internal_activity',
  investorMaterialCandidates: 'document_evidence',
}

const GROUP_SCREEN: Record<DashboardResearchUpdateGroup, string> = {
  marketClaims: 'market',
  competitorRecords: 'competitor',
  rawMaterialSignals: 'raw-material-sourcing',
  supplierScorecards: 'raw-material-sourcing',
  regulatoryFindings: 'regulatory',
  financialEvidence: 'investment',
  evidenceGaps: 'research-review',
  suggestedTasks: 'kanban',
  investorMaterialCandidates: 'presentation',
}

const CRITICAL_GROUPS = new Set<DashboardResearchUpdateGroup>([
  'rawMaterialSignals',
  'supplierScorecards',
  'regulatoryFindings',
  'financialEvidence',
  'investorMaterialCandidates',
])

const CRITICAL_FIELD_PATTERN = /market size|growth|cagr|consumption|market share|share chart|price|cost|supplier|score|payment|quality|reliability|irr|npv|payback|profitability|roi|investment|revenue target|asp|regulatory|dms|cas|formula|investor/i
const SENSITIVE_DATA_TYPES = new Set(['price_data', 'financial_data', 'supplier_quote', 'regulatory_data'])
const PLACEHOLDER_PATTERN = /to verify|missing|research required|api-ready|reference only|trade proxy/i
const SCREENSHOT_FAKE_VALUES = ['$3.2B', '$120M', '$16M', '$49.8M', '60%', '7.2%', '38%', '$34/kg', '$24/kg', '20-25%']
const MAX_IMPORTED_RUN_KEYS = 500

type DashboardResearchUpdateGroup = typeof DASHBOARD_UPDATE_GROUPS[number]
type SourceTier =
  | 'tier1-official'
  | 'tier2-company-official'
  | 'tier3-supplier-evidence'
  | 'tier4-market-reference'
  | 'tier5-public-listing'
  | 'candidate-source'

type Confidence = 'low' | 'medium' | 'high'
type ResearchReviewStatus = 'Pending Review' | 'Approved' | 'Rejected' | 'To Verify'

interface CronJobRecord {
  id?: unknown
  job_id?: unknown
  name?: unknown
  prompt?: unknown
  prompt_preview?: unknown
}

interface DashboardResearchUpdateItem {
  [key: string]: unknown
  fieldKey?: unknown
  screen?: unknown
  field?: unknown
  label?: unknown
  title?: unknown
  value?: unknown
  companyName?: unknown
  countryRegion?: unknown
  productEquivalent?: unknown
  activeContent?: unknown
  pricingEvidence?: unknown
  certifications?: unknown
  distributionPresence?: unknown
  marketShare?: unknown
  section?: unknown
  content?: unknown
  sourceTitle?: unknown
  sourceName?: unknown
  sourceUrl?: unknown
  sourceDate?: unknown
  sourceTier?: unknown
  lastChecked?: unknown
  confidence?: unknown
  evidenceStatus?: unknown
  reviewRequired?: unknown
  riskReason?: unknown
  dataType?: unknown
  sensitive?: unknown
  notes?: unknown
  recommendedAction?: unknown
  proposedDashboardField?: unknown
}

type DashboardResearchUpdatesPayload = Partial<Record<DashboardResearchUpdateGroup, DashboardResearchUpdateItem[]>>

interface DashboardIntelligenceState {
  evidenceItems: Record<string, unknown>[]
  marketClaims: Record<string, unknown>[]
  competitors: Record<string, unknown>[]
  presentationMaterials: Record<string, unknown>[]
  researchJobs: Record<string, unknown>[]
  researchFindings: Record<string, unknown>[]
  financialModels: Record<string, unknown>[]
  dataRoomSources: Record<string, unknown>[]
}

interface ImportRegistry {
  version: 1
  importedRunKeys: string[]
  updatedAt: string
}

interface OutputFile {
  jobId: string
  fileName: string
  path: string
  mtimeMs: number
}

export interface DashboardAutopilotIngestResult {
  profile: string
  jobsChecked: number
  filesChecked: number
  importedRuns: number
  skippedRuns: number
  autoFilledCount: number
  stagedReviewCount: number
  errors: string[]
}

interface IngestOptions {
  jobId?: string
  maxFilesPerJob?: number
}

export interface FullDashboardAutopilotScheduleResult {
  profile: string
  jobId: string | null
  created: boolean
  recordedResearchJob: boolean
  firstRunStarted: boolean
  firstRunError: string
}

interface ScheduleOptions {
  startFirstRun?: boolean
}

let intervalTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let ingestRunning = false

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return ''
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return ''
}

function getJobId(job: CronJobRecord): string {
  return firstString(job.job_id, job.id)
}

function fullDashboardAutopilotPrompt(): string {
  return [
    'Full Dashboard Trusted Source Autopilot',
    '',
    'Mission: automatically research and refresh the Hermes feasibility intelligence dashboard using trusted online sources and existing Hermes workspace evidence.',
    'Do the online research yourself using available web/search/source tools. Do not ask the user to manually search, copy, or paste source data.',
    'If browsing/search is unavailable, state that limitation and return evidence gaps/tasks instead of fabricating data.',
    '',
    'Dashboard areas to cover:',
    '- Executive Overview: revenue target, EQ capacity MT/YR, projected IRR, payback period, blended ASP/MT, NPV @ 12%, daily brief, priorities, top risk.',
    '- Market Intelligence: market size/scope, growth rate, import dependence, target countries/provinces, country-wise consumption/growth, segmentation, opportunity score.',
    '- Competitor Intelligence: cationic softeners/CHEMISOFT, silicone softeners/CHEMISIL, competitor landscape, product equivalents, pricing evidence, certifications, distribution, market share only when source-backed.',
    '- Investment Analysis: total investment, IRR, NPV, payback, profitability index, 5-year ROI, investment breakdown, working capital, scenarios.',
    '- Raw Material Sourcing and Supplier Scorecards: TEA, DMS/dimethyl sulfate, stearic acid, PDMS silicone oil, acetic acid, ethoxylates, packaging, supplier quotes/evidence.',
    '- Export Market Opportunity: country-wise textile/chemical trade proxies, HS-code candidates, growth indicators, import/export signals.',
    '- Regulatory: SDS/TDS/CAS, DMS safety/regulatory status, China import/storage/use requirements, factory chemical approvals.',
    '- Investor Readiness and Presentation Builder: evidence gaps, risk register, data-room checklist, presentation-ready material only when source-backed or user approved.',
    '',
    'Trusted source priority:',
    '1. Tier 1: official government/regulator/statistical/trade sources such as UN Comtrade, ITC, World Bank, WTO, OECD, China Customs/NBS/MOFCOM/MEE/MEM/MIIT, ECHA, PubChem, EPA CompTox, NITE.',
    '2. Tier 2: official company/product pages and catalogs such as BASF, Dow, WACKER, Wilmar, KLK OLEO, Evonik, Stepan, Kao, CHT, Archroma, Transfar, Zschimmer & Schwarz, Pulcra.',
    '3. Tier 3: uploaded supplier evidence such as quotes, PI, invoice, TDS, SDS, COA, email quote, distributor letter.',
    '4. Tier 4: paid/reputable market references such as ICIS, Argus, S&P Global, SunSirs, ECHEMI, ChemAnalyst, Trade Map. Treat as market reference, not final procurement truth.',
    '5. Tier 5: public listings/marketplaces such as Alibaba/Made-in-China are weak references only and must stay Reference Only / To Verify.',
    '',
    'Output requirements:',
    '- Produce a concise summary plus structured sections for each dashboard area.',
    '- Use Markdown tables, evidence-gap tables, source matrices, and Mermaid charts where useful.',
    '- Every claim must include value, source title, URL or publication/access date, source tier, confidence, evidence status, and last checked date.',
    '- Mark missing values as Missing / To Verify.',
    '- Mark trade proxies as Trade Proxy / To Verify until HS-code methodology is reviewed.',
    '- Mark financial outputs as Derived from Assumptions unless tied to an approved internal IRR scenario.',
    '- Mark supplier prices, payment terms, quality scores, and reliability scores as To Verify unless quote/TDS/SDS/COA evidence is attached.',
    '- Mark competitor market share as To Verify unless the source explicitly supports it.',
    '',
    'Machine-readable dashboard_updates schema:',
    '- Put the appendix in one fenced ```json block.',
    '- The top-level object must be: { "dashboard_updates": { ... } }.',
    '- Use these arrays only: marketClaims, competitorRecords, rawMaterialSignals, supplierScorecards, regulatoryFindings, financialEvidence, evidenceGaps, suggestedTasks, investorMaterialCandidates.',
    '- Each item should include fieldKey when known, field/title/label, value, sourceTitle, sourceUrl or sourceDate, sourceTier, lastChecked, confidence, evidenceStatus, reviewRequired, riskReason, dataType, and sensitive when applicable.',
    '- For country-wise growth/consumption, use marketClaims with field or label like "Country-wise consumption growth - <country/region>" and keep proxy values To Verify.',
    '- For supplier scorecards, use supplierScorecards with supplier, material, value, sourceTitle, sourceUrl/sourceDate, confidence, evidenceStatus, and reviewRequired.',
    '- For competitor analysis, use competitorRecords with companyName, countryRegion, productEquivalent, activeContent, pricingEvidence, certifications, distributionPresence, marketShare, sourceTitle, sourceUrl/sourceDate, confidence, evidenceStatus, and reviewRequired.',
    '',
    'Safety rules:',
    '- Do not invent market size, growth rate, consumption, pricing, supplier score, market share, IRR, NPV, payback, formula, CAS list, or regulatory status.',
    '- Do not treat paid reports, public listings, or unsourced snippets as verified facts.',
    '- Do not expose formulas, raw material ratios, supplier confidential pricing, investor terms, product-development secrets, API keys, or system secrets.',
    '- Do not silently approve investor material.',
    '- Unsupported, weak-source, conflicting, sensitive, financial, supplier-price, regulatory, market-share, and investor-impact findings must be review-ready, not automatically approved.',
  ].join('\n')
}

export function isFullDashboardAutopilotJobRecord(job: CronJobRecord | null | undefined): boolean {
  if (!job) return false
  const text = [
    job.name,
    job.prompt,
    job.prompt_preview,
  ].map(stringValue).join('\n').toLowerCase()
  return text.includes(FULL_DASHBOARD_AUTOPILOT_JOB_NAME.toLowerCase()) ||
    (text.includes('dashboard_updates') && text.includes('trusted-source') && text.includes('full dashboard'))
}

function normalizeJobsPayload(payload: unknown): CronJobRecord[] {
  if (Array.isArray(payload)) return payload.filter(isPlainRecord)
  if (isPlainRecord(payload) && Array.isArray(payload.jobs)) return payload.jobs.filter(isPlainRecord)
  return []
}

async function readCronJobs(profile: string): Promise<CronJobRecord[]> {
  const jobsFile = join(getProfileDir(profile), 'cron', 'jobs.json')
  if (!existsSync(jobsFile)) return []
  try {
    const raw = await readFile(jobsFile, 'utf-8')
    return normalizeJobsPayload(JSON.parse(raw))
  } catch (err) {
    logger.warn(err, '[dashboard-autopilot] failed to read cron jobs')
    return []
  }
}

function findCreatedJob(beforeJobs: CronJobRecord[], afterJobs: CronJobRecord[]): CronJobRecord | null {
  const beforeIds = new Set(beforeJobs.map(getJobId).filter(Boolean))
  return afterJobs.find(job => isFullDashboardAutopilotJobRecord(job) && !beforeIds.has(getJobId(job))) ||
    afterJobs.find(isFullDashboardAutopilotJobRecord) ||
    null
}

async function recordFullDashboardAutopilotResearchJob(profile: string, jobId: string): Promise<boolean> {
  if (!jobId) return false
  const envelope = await readDashboardIntelligenceState(profile)
  const state = normalizeState(envelope?.state)
  const existingIndex = state.researchJobs.findIndex(job =>
    firstString(job.scheduledJobId) === jobId ||
    firstString(job.title) === FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
  )
  const now = new Date().toISOString()
  const record = {
    id: existingIndex >= 0
      ? firstString(state.researchJobs[existingIndex].id) || stableId('research', FULL_DASHBOARD_AUTOPILOT_JOB_NAME, jobId)
      : stableId('research', FULL_DASHBOARD_AUTOPILOT_JOB_NAME, jobId),
    title: FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
    question: 'Automatically research trusted online sources and existing Hermes evidence to refresh the full feasibility dashboard.',
    scope: 'Executive Overview, Market Intelligence, Competitor Intelligence, Investment Analysis, Raw Material Sourcing, Supplier Scorecards, Export Market Opportunity, Regulatory, Investor Readiness, and Presentation Builder.',
    expectedOutput: 'Source-backed dashboard update candidates, evidence gaps, suggested tasks, and review-ready investor material candidates.',
    sourceRequirements: 'Official-first trusted sources with source title plus URL/date, confidence, evidence status, and review gating for critical claims.',
    priority: 'high',
    schedulePreference: 'Custom',
    scheduledJobId: jobId,
    schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    context: 'Chemicon China Feasibility',
    status: 'Scheduled Hermes Job',
    createdAt: existingIndex >= 0 ? firstString(state.researchJobs[existingIndex].createdAt) || now : now,
  }

  if (existingIndex >= 0) {
    const current = state.researchJobs[existingIndex]
    const changed = firstString(current.scheduledJobId) !== jobId ||
      firstString(current.schedule) !== FULL_DASHBOARD_AUTOPILOT_SCHEDULE ||
      firstString(current.status) !== 'Scheduled Hermes Job'
    state.researchJobs = [
      ...state.researchJobs.slice(0, existingIndex),
      { ...current, ...record },
      ...state.researchJobs.slice(existingIndex + 1),
    ]
    if (!changed) return false
  } else {
    state.researchJobs = [record, ...state.researchJobs]
  }

  await writeDashboardIntelligenceState({
    profile,
    state,
    savedBy: {
      username: 'Full Dashboard Autopilot',
      role: 'system',
    },
  })
  return true
}

async function runHermesCron(profile: string, args: string[], timeoutMs: number): Promise<void> {
  const profileDir = getProfileDir(profile || 'default')
  try {
    await execFileAsync(getHermesBin(), args, {
      cwd: process.cwd(),
      env: { ...process.env, HERMES_HOME: profileDir },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
  } catch (error: any) {
    const stderr = String(error?.stderr || '').trim()
    const stdout = String(error?.stdout || '').trim()
    throw new Error(stderr || stdout || error?.message || 'Hermes cron command failed')
  }
}

export async function ensureFullDashboardAutopilotScheduled(
  profileInput?: string,
  options: ScheduleOptions = {},
): Promise<FullDashboardAutopilotScheduleResult> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const beforeJobs = await readCronJobs(profile)
  const existing = beforeJobs.find(isFullDashboardAutopilotJobRecord)
  const existingJobId = existing ? getJobId(existing) : ''
  if (existingJobId) {
    const recordedResearchJob = await recordFullDashboardAutopilotResearchJob(profile, existingJobId)
    return {
      profile,
      jobId: existingJobId,
      created: false,
      recordedResearchJob,
      firstRunStarted: false,
      firstRunError: '',
    }
  }

  await runHermesCron(profile, [
    'cron',
    'create',
    '--name',
    FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
    '--deliver',
    'local',
    FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
    fullDashboardAutopilotPrompt(),
  ], CREATE_TIMEOUT_MS)

  const createdJob = findCreatedJob(beforeJobs, await readCronJobs(profile))
  const jobId = createdJob ? getJobId(createdJob) : ''
  const recordedResearchJob = jobId ? await recordFullDashboardAutopilotResearchJob(profile, jobId) : false
  let firstRunStarted = false
  let firstRunError = ''

  if (options.startFirstRun && jobId) {
    try {
      await runHermesCron(profile, ['cron', 'run', jobId], RUN_TIMEOUT_MS)
      firstRunStarted = true
      await ingestFullDashboardAutopilotOutputs(profile, { jobId, maxFilesPerJob: 5 })
    } catch (err) {
      firstRunError = err instanceof Error ? err.message : 'Hermes cron run failed'
      logger.warn({ err, profile, jobId }, '[dashboard-autopilot] first trusted-source run could not start')
    }
  }

  return {
    profile,
    jobId: jobId || null,
    created: true,
    recordedResearchJob,
    firstRunStarted,
    firstRunError,
  }
}

async function listOutputFiles(profile: string, jobId: string, maxFiles: number): Promise<OutputFile[]> {
  const outputDir = join(getProfileDir(profile), 'cron', 'output', jobId)
  if (!existsSync(outputDir)) return []
  const files: OutputFile[] = []
  try {
    for (const fileName of await readdir(outputDir)) {
      if (!fileName.endsWith('.md') || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) continue
      const filePath = join(outputDir, fileName)
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) continue
      files.push({
        jobId,
        fileName,
        path: filePath,
        mtimeMs: fileStat.mtimeMs,
      })
    }
  } catch (err) {
    logger.warn({ err, jobId }, '[dashboard-autopilot] failed to list output files')
  }
  return files.sort((a, b) => b.fileName.localeCompare(a.fileName) || b.mtimeMs - a.mtimeMs).slice(0, maxFiles)
}

function registryPath(profile: string): string {
  return join(getProfileDir(profile), 'dashboard-intelligence', 'imported-runs.json')
}

async function readImportRegistry(profile: string): Promise<ImportRegistry> {
  try {
    const raw = await readFile(registryPath(profile), 'utf-8')
    const parsed = JSON.parse(raw)
    if (isPlainRecord(parsed) && Array.isArray(parsed.importedRunKeys)) {
      return {
        version: 1,
        importedRunKeys: parsed.importedRunKeys.map(stringValue).filter(Boolean),
        updatedAt: stringValue(parsed.updatedAt) || new Date().toISOString(),
      }
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') logger.warn(err, '[dashboard-autopilot] failed to read import registry')
  }
  return { version: 1, importedRunKeys: [], updatedAt: '' }
}

async function writeImportRegistry(profile: string, registry: ImportRegistry): Promise<void> {
  const filePath = registryPath(profile)
  const next: ImportRegistry = {
    version: 1,
    importedRunKeys: registry.importedRunKeys.slice(-MAX_IMPORTED_RUN_KEYS),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf-8')
  await rename(tempPath, filePath)
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function extractBalancedObjectAfter(text: string, index: number): string | null {
  const start = text.indexOf('{', index)
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return text.slice(start, i + 1)
  }
  return null
}

function normalizeDashboardPayload(raw: Record<string, unknown>): DashboardResearchUpdatesPayload | null {
  const container = isPlainRecord(raw.dashboard_updates) ? raw.dashboard_updates : raw
  const payload: DashboardResearchUpdatesPayload = {}

  for (const group of DASHBOARD_UPDATE_GROUPS) {
    const value = container[group]
    if (!Array.isArray(value)) continue
    payload[group] = value.filter(isPlainRecord).map(item => ({ ...item }))
  }

  return DASHBOARD_UPDATE_GROUPS.some(group => (payload[group]?.length || 0) > 0) ? payload : null
}

export function extractDashboardResearchUpdates(content: string): DashboardResearchUpdatesPayload | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const direct = tryParseJsonObject(trimmed)
  const directPayload = direct ? normalizeDashboardPayload(direct) : null
  if (directPayload) return directPayload

  const fencedBlocks = [...trimmed.matchAll(/```(?:json|dashboard_updates)?\s*([\s\S]*?)```/gi)]
  for (const block of fencedBlocks.reverse()) {
    const candidate = block[1].trim()
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue
    const parsed = tryParseJsonObject(candidate)
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  const markers = [...trimmed.matchAll(/["']?dashboard_updates["']?\s*[:=]/gi)]
  for (const marker of markers.reverse()) {
    const json = extractBalancedObjectAfter(trimmed, marker.index || 0)
    const parsed = json ? tryParseJsonObject(json) : null
    const payload = parsed ? normalizeDashboardPayload(parsed) : null
    if (payload) return payload
  }

  return null
}

function normalizeSourceTier(value: unknown): SourceTier {
  const text = stringValue(value).toLowerCase()
  if (text.includes('tier1') || text.includes('tier 1') || text.includes('government') || text.includes('regulator') || text.includes('statistical') || text.includes('trade source')) return 'tier1-official'
  if (text.includes('tier2') || text.includes('tier 2') || text.includes('company') || text.includes('catalog') || text.includes('product source')) return 'tier2-company-official'
  if (text.includes('tier3') || text.includes('tier 3') || text.includes('supplier evidence') || text.includes('quote') || text.includes('sds') || text.includes('tds') || text.includes('coa') || text.includes('invoice')) return 'tier3-supplier-evidence'
  if (text.includes('tier4') || text.includes('tier 4') || text.includes('market reference') || text.includes('paid')) return 'tier4-market-reference'
  if (text.includes('tier5') || text.includes('tier 5') || text.includes('marketplace') || text.includes('public listing')) return 'tier5-public-listing'
  return 'candidate-source'
}

export function dashboardSourceTierRank(tier: SourceTier): number {
  if (tier === 'tier1-official') return 1
  if (tier === 'tier2-company-official') return 2
  if (tier === 'tier3-supplier-evidence') return 3
  if (tier === 'tier4-market-reference') return 4
  if (tier === 'tier5-public-listing') return 5
  return 6
}

function coerceConfidence(value: unknown): Confidence {
  return VALID_CONFIDENCE.has(stringValue(value)) ? stringValue(value) as Confidence : 'medium'
}

function coerceEvidenceStatus(value: unknown, fallback = 'To Verify'): string {
  const text = stringValue(value)
  return VALID_EVIDENCE_STATUSES.has(text) ? text : fallback
}

function coerceDataType(value: unknown, fallback: string): string {
  const text = stringValue(value)
  return VALID_DATA_TYPES.has(text) ? text : fallback
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function sourceFromItem(item: DashboardResearchUpdateItem): Record<string, unknown> | null {
  const title = firstString(item.sourceTitle, item.sourceName)
  const url = firstString(item.sourceUrl)
  const date = firstString(item.sourceDate, item.lastChecked)
  if (!title && !url && !date) return null
  const source: Record<string, unknown> = { title: title || 'Source missing' }
  if (url) source.url = url
  if (date) source.date = date
  return source
}

function sourceIsUsable(source: Record<string, unknown> | null): boolean {
  return Boolean(stringValue(source?.title) && (stringValue(source?.url) || stringValue(source?.date)))
}

function hasKnownFakeScreenshotValue(value: string): boolean {
  return SCREENSHOT_FAKE_VALUES.some(fakeValue => value.includes(fakeValue))
}

function fieldLabel(item: DashboardResearchUpdateItem, group: DashboardResearchUpdateGroup): string {
  return firstString(
    item.field,
    item.label,
    item.title,
    item.companyName,
    item.supplier,
    item.material,
    group,
  )
}

function itemValueText(item: DashboardResearchUpdateItem): string {
  return firstString(
    item.value,
    item.content,
    item.marketShare,
    item.pricingEvidence,
    item.notes,
    item.recommendedAction,
  )
}

function riskReasons(input: {
  item: DashboardResearchUpdateItem
  group: DashboardResearchUpdateGroup
  field: string
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  evidenceStatus: string
  dataType: string
  confidence: Confidence
}): string[] {
  const reasons: string[] = []
  const fieldAndValue = `${input.field} ${input.value}`
  if (!sourceIsUsable(input.source)) reasons.push('source title plus URL/date is missing')
  if (input.item.reviewRequired === true) reasons.push('Hermes marked this finding review-required')
  if (CRITICAL_GROUPS.has(input.group)) reasons.push('dashboard area is critical or sensitive')
  if (input.item.sensitive === true || SENSITIVE_DATA_TYPES.has(input.dataType)) reasons.push('sensitive price/cost/financial/regulatory data')
  if (CRITICAL_FIELD_PATTERN.test(fieldAndValue)) reasons.push('critical dashboard claim')
  if (PLACEHOLDER_PATTERN.test(input.value)) reasons.push('value is still Missing / To Verify / proxy')
  if (hasKnownFakeScreenshotValue(input.value)) reasons.push('matches old screenshot/template number and must be source-checked')
  if (!AUTO_TRUSTED_STATUSES.has(input.evidenceStatus)) reasons.push('evidence status is not trusted enough for auto-fill')
  if (input.confidence !== 'high') reasons.push('confidence is not high')
  if (input.tier === 'tier4-market-reference') reasons.push('market-reference sources need context review')
  if (input.tier === 'tier5-public-listing') reasons.push('public listings are weak references only')
  if (input.tier === 'candidate-source') reasons.push('candidate source is not trusted yet')
  return reasons
}

function areaForGroup(group: DashboardResearchUpdateGroup): string {
  if (group === 'financialEvidence') return 'financial'
  if (group === 'regulatoryFindings') return 'regulatory'
  if (group === 'competitorRecords' || group === 'marketClaims') return 'market'
  if (group === 'rawMaterialSignals' || group === 'supplierScorecards') return 'factory'
  if (group === 'investorMaterialCandidates') return 'presentation'
  return 'market'
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isPlainRecord) : []
}

function normalizeState(raw: Record<string, unknown> | null | undefined): DashboardIntelligenceState {
  return {
    evidenceItems: asArray(raw?.evidenceItems),
    marketClaims: asArray(raw?.marketClaims),
    competitors: asArray(raw?.competitors),
    presentationMaterials: asArray(raw?.presentationMaterials),
    researchJobs: asArray(raw?.researchJobs),
    researchFindings: asArray(raw?.researchFindings),
    financialModels: asArray(raw?.financialModels),
    dataRoomSources: asArray(raw?.dataRoomSources),
  }
}

function stableId(prefix: string, ...values: string[]): string {
  const text = values.filter(Boolean).join('-') || `${Date.now()}`
  return `${prefix}-${slug(text).slice(0, 80)}`
}

function includesExisting(list: Record<string, unknown>[], predicate: (item: Record<string, unknown>) => boolean): boolean {
  return list.some(predicate)
}

function appendMarketClaim(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    confidence: Confidence
    evidenceStatus: string
    lastChecked: string
    runKey: string
  },
): boolean {
  const label = firstString(input.item.label, input.item.field, input.item.title, input.field)
  if (!label || !input.value) return false
  if (includesExisting(state.marketClaims, claim =>
    stringValue(claim.label).toLowerCase() === label.toLowerCase() &&
    stringValue(claim.value) === input.value &&
    stringValue((claim.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.marketClaims.push({
    id: stableId('autopilot-market', input.runKey, label, input.value),
    label,
    value: input.value,
    source: input.source,
    confidence: input.confidence,
    evidenceStatus: input.evidenceStatus,
    lastChecked: input.lastChecked,
  })
  return true
}

function appendCompetitorRecord(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    lastChecked: string
    runKey: string
  },
): boolean {
  const companyName = firstString(input.item.companyName, input.item.title, input.item.label)
  if (!companyName) return false
  if (includesExisting(state.competitors, competitor =>
    stringValue(competitor.companyName).toLowerCase() === companyName.toLowerCase() &&
    stringValue((competitor.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.competitors.push({
    id: stableId('autopilot-competitor', input.runKey, companyName),
    companyName,
    countryRegion: firstString(input.item.countryRegion) || 'To Verify',
    productEquivalent: firstString(input.item.productEquivalent) || 'To Verify',
    activeContent: firstString(input.item.activeContent) || 'To Verify',
    pricingEvidence: firstString(input.item.pricingEvidence) || 'To Verify',
    certifications: firstString(input.item.certifications) || 'To Verify',
    distributionPresence: firstString(input.item.distributionPresence) || 'To Verify',
    marketShare: '',
    evidenceStatus: input.evidenceStatus,
    source: input.source,
    notes: firstString(input.item.notes, input.value) || 'Imported by Full Dashboard Autopilot from a source-backed non-sensitive company record.',
    updatedAt: input.lastChecked,
  })
  return true
}

function appendReviewFinding(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    confidence: Confidence
    lastChecked: string
    runKey: string
    reasons: string[]
  },
): boolean {
  const title = firstString(input.item.title, input.item.label, input.item.field, input.field)
  const value = input.value || firstString(input.item.notes, input.item.recommendedAction, 'Review source-backed dashboard finding')
  const keyClaim = `${title}: ${value}`
  if (includesExisting(state.researchFindings, finding =>
    stringValue(finding.keyClaim) === keyClaim &&
    stringValue((finding.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.researchFindings.push({
    id: stableId('autopilot-review', input.runKey, input.group, title, value),
    summary: `Hermes found a ${input.group} update for ${GROUP_SCREEN[input.group]}. It is staged for owner review before any critical dashboard or investor material changes.`,
    keyClaim,
    area: areaForGroup(input.group),
    evidenceStatus: input.evidenceStatus,
    confidence: input.confidence,
    source: input.source,
    suggestedTask: firstString(input.item.recommendedAction) || `Review source and decide whether to approve ${title}.`,
    suggestedInvestorMaterial: input.group === 'investorMaterialCandidates'
      ? firstString(input.item.content, input.item.value)
      : undefined,
    riskNote: firstString(input.item.riskReason) || input.reasons.join('; ') || 'Review required by dashboard autopilot policy',
    status: 'Pending Review' satisfies ResearchReviewStatus,
    createdAt: input.lastChecked,
  })
  return true
}

function applyDashboardUpdates(
  state: DashboardIntelligenceState,
  payload: DashboardResearchUpdatesPayload,
  runKey: string,
  fallbackCheckedAt: string,
): { autoFilledCount: number, stagedReviewCount: number } {
  let autoFilledCount = 0
  let stagedReviewCount = 0

  for (const group of DASHBOARD_UPDATE_GROUPS) {
    for (const item of payload[group] || []) {
      const field = fieldLabel(item, group)
      const value = itemValueText(item)
      const source = sourceFromItem(item)
      const tier = normalizeSourceTier(item.sourceTier)
      const confidence = coerceConfidence(item.confidence)
      const evidenceStatus = coerceEvidenceStatus(item.evidenceStatus, 'To Verify')
      const dataType = coerceDataType(item.dataType, GROUP_DEFAULT_DATA_TYPE[group])
      const lastChecked = firstString(item.lastChecked, item.sourceDate) || fallbackCheckedAt
      const reasons = riskReasons({ item, group, field, value, source, tier, evidenceStatus, dataType, confidence })
      const reviewRequired = reasons.length > 0

      if (reviewRequired) {
        if (appendReviewFinding(state, {
          item,
          group,
          field,
          value,
          source,
          evidenceStatus,
          confidence,
          lastChecked,
          runKey,
          reasons,
        })) stagedReviewCount += 1
        continue
      }

      const added = group === 'competitorRecords'
        ? appendCompetitorRecord(state, { item, value, source, evidenceStatus, lastChecked, runKey })
        : appendMarketClaim(state, { item, group, field, value, source, confidence, evidenceStatus, lastChecked, runKey })
      if (added) autoFilledCount += 1
    }
  }

  return { autoFilledCount, stagedReviewCount }
}

export async function ingestFullDashboardAutopilotOutputs(
  profileInput?: string,
  options: IngestOptions = {},
): Promise<DashboardAutopilotIngestResult> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const result: DashboardAutopilotIngestResult = {
    profile,
    jobsChecked: 0,
    filesChecked: 0,
    importedRuns: 0,
    skippedRuns: 0,
    autoFilledCount: 0,
    stagedReviewCount: 0,
    errors: [],
  }
  const maxFilesPerJob = options.maxFilesPerJob ?? 10
  const jobs = (await readCronJobs(profile)).filter(job => {
    const id = getJobId(job)
    if (options.jobId && id !== options.jobId) return false
    return isFullDashboardAutopilotJobRecord(job)
  })
  result.jobsChecked = jobs.length
  if (jobs.length === 0) return result

  const registry = await readImportRegistry(profile)
  const importedRunKeys = new Set(registry.importedRunKeys)
  const envelope = await readDashboardIntelligenceState(profile)
  const state = normalizeState(envelope?.state)

  for (const job of jobs) {
    const jobId = getJobId(job)
    if (!jobId) continue
    const outputs = await listOutputFiles(profile, jobId, maxFilesPerJob)
    for (const output of outputs) {
      const runKey = `${output.jobId}/${output.fileName}`
      if (importedRunKeys.has(runKey)) continue
      result.filesChecked += 1
      try {
        const content = await readFile(output.path, 'utf-8')
        const payload = extractDashboardResearchUpdates(content)
        if (!payload) {
          result.skippedRuns += 1
          continue
        }
        importedRunKeys.add(runKey)
        const applied = applyDashboardUpdates(state, payload, runKey, new Date(output.mtimeMs || Date.now()).toISOString())
        result.autoFilledCount += applied.autoFilledCount
        result.stagedReviewCount += applied.stagedReviewCount
        result.importedRuns += 1
      } catch (err: any) {
        result.errors.push(`${runKey}: ${err?.message || 'failed to import output'}`)
      }
    }
  }

  if (result.importedRuns > 0 || result.autoFilledCount > 0 || result.stagedReviewCount > 0) {
    await writeDashboardIntelligenceState({
      profile,
      state,
      savedBy: {
        username: 'Full Dashboard Autopilot',
        role: 'system',
      },
    })
  }

  await writeImportRegistry(profile, {
    version: 1,
    importedRunKeys: [...importedRunKeys],
    updatedAt: new Date().toISOString(),
  })

  return result
}

async function safeIngestActiveProfile(): Promise<void> {
  if (ingestRunning) return
  ingestRunning = true
  try {
    const profile = getActiveProfileName()
    const schedule = await ensureFullDashboardAutopilotScheduled(profile, { startFirstRun: true })
    if (schedule.created) {
      logger.info({
        profile: schedule.profile,
        jobId: schedule.jobId,
        firstRunStarted: schedule.firstRunStarted,
        firstRunError: schedule.firstRunError || undefined,
      }, '[dashboard-autopilot] ensured trusted-source schedule')
    }
    const result = await ingestFullDashboardAutopilotOutputs(profile, { maxFilesPerJob: 10 })
    if (result.importedRuns > 0 || result.autoFilledCount > 0 || result.stagedReviewCount > 0) {
      logger.info({
        profile: result.profile,
        importedRuns: result.importedRuns,
        autoFilledCount: result.autoFilledCount,
        stagedReviewCount: result.stagedReviewCount,
      }, '[dashboard-autopilot] imported trusted-source output')
    }
    if (result.errors.length > 0) {
      logger.warn({ errors: result.errors }, '[dashboard-autopilot] import completed with errors')
    }
  } catch (err) {
    logger.warn(err, '[dashboard-autopilot] background import failed')
  } finally {
    ingestRunning = false
  }
}

export function startDashboardAutopilotIngestor(options: { initialDelayMs?: number, intervalMs?: number } = {}): void {
  if (intervalTimer || initialTimer) return
  const initialDelayMs = options.initialDelayMs ?? 30_000
  const intervalMs = options.intervalMs ?? 10 * 60_000
  initialTimer = setTimeout(() => {
    initialTimer = null
    void safeIngestActiveProfile()
    intervalTimer = setInterval(() => {
      void safeIngestActiveProfile()
    }, intervalMs)
    intervalTimer.unref?.()
  }, initialDelayMs)
  initialTimer.unref?.()
}

export function stopDashboardAutopilotIngestor(): void {
  if (initialTimer) clearTimeout(initialTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  initialTimer = null
  intervalTimer = null
  ingestRunning = false
}
