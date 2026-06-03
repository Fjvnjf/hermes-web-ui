import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { logger } from '../logger'
import { getHermesBin } from './hermes-path'
import { getActiveProfileName, getProfileDir } from './hermes-profile'
import { PROVIDER_ENV_MAP, readConfigYamlForProfile, updateConfigYamlForProfile } from '../config-helpers'
import { PROVIDER_PRESETS } from '../../shared/providers'
import {
  readDashboardIntelligenceState,
  writeDashboardIntelligenceState,
} from './intelligence-state'

export const FULL_DASHBOARD_AUTOPILOT_JOB_NAME = 'Full Dashboard Trusted Source Autopilot'
export const FULL_DASHBOARD_AUTOPILOT_SCHEDULE = '0 7,19 * * *'
export const FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION = 'dashboard-autopilot-schema-v2026-06-03'

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

function countDashboardPayloadItems(payload: DashboardResearchUpdatesPayload | null | undefined): number {
  if (!payload) return 0
  return DASHBOARD_UPDATE_GROUPS.reduce((count, group) => count + (payload[group]?.length || 0), 0)
}

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
  skippedRunKeys: string[]
  updatedAt: string
}

interface DueRunRegistry {
  version: 1
  slots: Record<string, {
    jobId: string
    dueSlotAt: string
    attemptedAt: string
    outputSeen: boolean
    error: string
  }>
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
  repaired: boolean
  recordedResearchJob: boolean
  firstRunStarted: boolean
  firstRunError: string
}

export interface FullDashboardAutopilotDueRunResult {
  profile: string
  jobId: string | null
  dueSlotAt: string
  dueSlotKey: string
  outputAlreadyPresent: boolean
  skippedRecentAttempt: boolean
  runStarted: boolean
  runError: string
  importedRuns: number
  autoFilledCount: number
  stagedReviewCount: number
}

export interface DashboardAutopilotImportStatus {
  profile: string
  jobCount: number
  outputCount: number
  importedRunCount: number
  skippedRunCount: number
  pendingOutputCount: number
  latestOutputRunKey: string
  latestOutputFile: string
  latestOutputAt: string
  latestOutputImported: boolean
  latestOutputSkipped: boolean
  latestOutputParseStatus: 'none' | 'imported' | 'ready' | 'unparseable' | 'unreadable'
  latestOutputCandidateCount: number
  latestOutputParseError: string
  latestImportedRunKey: string
  registryUpdatedAt: string
  latestDueSlotAt: string
  latestDueSlotSatisfied: boolean
  latestDueSlotAttemptedAt: string
  latestDueSlotRunError: string
}

interface ScheduleOptions {
  startFirstRun?: boolean
}

interface AutopilotDefaultModelResult {
  configured: boolean
  model: string
  provider: string
}

interface DueRunOptions {
  now?: Date
  graceMs?: number
  retryAfterMs?: number
  maxFilesPerJob?: number
}

let intervalTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let ingestRunning = false

const DUE_RUN_GRACE_MS = 15 * 60_000
const DUE_RUN_RETRY_AFTER_MS = 60 * 60_000

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function providerKeyForCustom(name: string): string {
  return `custom:${name.trim().toLowerCase().replace(/ /g, '-')}`
}

function envValue(envContent: string, key: string): string {
  if (!key) return ''
  const match = envContent.match(new RegExp(`^${key}\\s*=\\s*(.+)`, 'm'))
  const value = match?.[1]?.trim() || ''
  return value && !value.startsWith('#') ? value : ''
}

async function readProfileText(profile: string, relativePath: string): Promise<string> {
  try {
    return await readFile(join(getProfileDir(profile), relativePath), 'utf-8')
  } catch {
    return ''
  }
}

function authHasProviderToken(authContent: string, providerKey: string): boolean {
  if (!authContent.trim()) return false
  try {
    const auth = JSON.parse(authContent)
    const provider = auth?.providers?.[providerKey]
    const pool = auth?.credential_pool?.[providerKey]
    return Boolean(
      provider?.tokens?.access_token ||
      provider?.access_token ||
      (Array.isArray(pool) && pool.some((entry: any) => entry?.access_token)),
    )
  } catch {
    return false
  }
}

function configuredDefaultModel(config: Record<string, any>): AutopilotDefaultModelResult | null {
  const modelSection = config.model
  if (typeof modelSection === 'object' && modelSection !== null) {
    const model = firstString(modelSection.default)
    if (model) return { configured: false, model, provider: firstString(modelSection.provider) }
  }
  if (typeof modelSection === 'string') {
    const model = modelSection.trim()
    if (model) return { configured: false, model, provider: '' }
  }
  return null
}

async function firstAutopilotModelCandidate(
  profile: string,
  config: Record<string, any>,
): Promise<Omit<AutopilotDefaultModelResult, 'configured'> | null> {
  const customProviders = Array.isArray(config.custom_providers)
    ? config.custom_providers as Array<{ name?: unknown; model?: unknown }>
    : []
  for (const provider of customProviders) {
    const name = firstString(provider.name)
    const model = firstString(provider.model)
    if (name && model) return { model, provider: providerKeyForCustom(name) }
  }

  const [envContent, authContent] = await Promise.all([
    readProfileText(profile, '.env'),
    readProfileText(profile, 'auth.json'),
  ])
  for (const preset of PROVIDER_PRESETS) {
    const envMapping = PROVIDER_ENV_MAP[preset.value]
    if (!envMapping || !preset.models.length) continue
    const hasCredentials = envMapping.api_key_env
      ? Boolean(envValue(envContent, envMapping.api_key_env))
      : authHasProviderToken(authContent, preset.value)
    if (hasCredentials) return { model: preset.models[0], provider: preset.value }
  }

  return null
}

async function ensureDefaultModelForAutopilot(profile: string): Promise<AutopilotDefaultModelResult> {
  const config = await readConfigYamlForProfile(profile)
  const existing = configuredDefaultModel(config)
  if (existing) return existing

  const candidate = await firstAutopilotModelCandidate(profile, config)
  if (!candidate) {
    return { configured: false, model: '', provider: '' }
  }

  const result = await updateConfigYamlForProfile<AutopilotDefaultModelResult>(profile, (latestConfig) => {
    const latestExisting = configuredDefaultModel(latestConfig)
    if (latestExisting) return { data: latestConfig, result: latestExisting, write: false }
    latestConfig.model = {
      ...(isPlainRecord(latestConfig.model) ? latestConfig.model : {}),
      default: candidate.model,
      provider: candidate.provider,
    }
    return {
      data: latestConfig,
      result: { configured: true, model: candidate.model, provider: candidate.provider },
    }
  })

  return result || { configured: true, model: candidate.model, provider: candidate.provider }
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
    `Prompt version: ${FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION}`,
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
    '- If the JSON appendix fails, still include source-backed Markdown tables with Field/Value/Source Title/Source URL/Source Tier/Confidence/Evidence Status/Review Required columns.',
    '- If tables are not possible, use source-backed delimited bullets such as: Field: Country-wise consumption growth - China | Value: Trade proxy found | Source: [WITS / World Bank Comtrade](https://wits.worldbank.org/) | Source Tier: Tier 1 - Official / regulator / trade source | Evidence Status: Official Data | Confidence: high | Review Required: yes.',
    '- Do not output unsupported plain numbers without source metadata; unstructured or unsourced output will be ignored by the dashboard importer.',
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

function autopilotScheduleText(job: CronJobRecord): string {
  const schedule = isPlainRecord((job as any).schedule) ? (job as any).schedule : null
  return [
    (schedule as any)?.expr,
    (schedule as any)?.display,
    (job as any).schedule_display,
  ].map(stringValue).join('\n')
}

function autopilotJobNeedsRepair(job: CronJobRecord): boolean {
  const prompt = stringValue(job.prompt)
  if (!prompt.includes(FULL_DASHBOARD_AUTOPILOT_PROMPT_VERSION)) return true
  const schedule = autopilotScheduleText(job)
  return Boolean(schedule && !schedule.includes(FULL_DASHBOARD_AUTOPILOT_SCHEDULE) && !schedule.includes('07:00 / 19:00'))
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
  if (existing && existingJobId) {
    let repaired = false
    let firstRunStarted = false
    let firstRunError = ''
    if (autopilotJobNeedsRepair(existing)) {
      try {
        await runHermesCron(profile, [
          'cron',
          'edit',
          existingJobId,
          '--name',
          FULL_DASHBOARD_AUTOPILOT_JOB_NAME,
          '--schedule',
          FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
          '--deliver',
          'local',
          '--prompt',
          fullDashboardAutopilotPrompt(),
        ], CREATE_TIMEOUT_MS)
        repaired = true
      } catch (err) {
        firstRunError = err instanceof Error ? err.message : 'Hermes cron edit failed'
        logger.warn({ err, profile, jobId: existingJobId }, '[dashboard-autopilot] existing trusted-source job could not be repaired')
      }
    }
    if (options.startFirstRun && repaired && !firstRunError) {
      try {
        const defaultModel = await ensureDefaultModelForAutopilot(profile)
        if (defaultModel.configured) {
          logger.info({
            profile,
            model: defaultModel.model,
            provider: defaultModel.provider || undefined,
          }, '[dashboard-autopilot] configured default model before repaired trusted-source run')
        }
        await runHermesCron(profile, ['cron', 'run', existingJobId], RUN_TIMEOUT_MS)
        firstRunStarted = true
        await ingestFullDashboardAutopilotOutputs(profile, { jobId: existingJobId, maxFilesPerJob: 5 })
      } catch (err) {
        firstRunError = err instanceof Error ? err.message : 'Hermes cron run failed'
        logger.warn({ err, profile, jobId: existingJobId }, '[dashboard-autopilot] repaired trusted-source job could not start')
      }
    }
    const recordedResearchJob = await recordFullDashboardAutopilotResearchJob(profile, existingJobId)
    return {
      profile,
      jobId: existingJobId,
      created: false,
      repaired,
      recordedResearchJob,
      firstRunStarted,
      firstRunError,
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
      const defaultModel = await ensureDefaultModelForAutopilot(profile)
      if (defaultModel.configured) {
        logger.info({
          profile,
          model: defaultModel.model,
          provider: defaultModel.provider || undefined,
        }, '[dashboard-autopilot] configured default model before first trusted-source run')
      }
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
    repaired: false,
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
        skippedRunKeys: Array.isArray(parsed.skippedRunKeys)
          ? parsed.skippedRunKeys.map(stringValue).filter(Boolean)
          : [],
        updatedAt: stringValue(parsed.updatedAt) || new Date().toISOString(),
      }
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') logger.warn(err, '[dashboard-autopilot] failed to read import registry')
  }
  return { version: 1, importedRunKeys: [], skippedRunKeys: [], updatedAt: '' }
}

async function writeImportRegistry(profile: string, registry: ImportRegistry): Promise<void> {
  const filePath = registryPath(profile)
  const next: ImportRegistry = {
    version: 1,
    importedRunKeys: registry.importedRunKeys.slice(-MAX_IMPORTED_RUN_KEYS),
    skippedRunKeys: registry.skippedRunKeys.slice(-MAX_IMPORTED_RUN_KEYS),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf-8')
  await rename(tempPath, filePath)
}

function dueRunRegistryPath(profile: string): string {
  return join(getProfileDir(profile), 'dashboard-intelligence', 'autopilot-due-runs.json')
}

async function readDueRunRegistry(profile: string): Promise<DueRunRegistry> {
  try {
    const raw = await readFile(dueRunRegistryPath(profile), 'utf-8')
    const parsed = JSON.parse(raw)
    if (isPlainRecord(parsed) && isPlainRecord(parsed.slots)) {
      return {
        version: 1,
        slots: Object.fromEntries(Object.entries(parsed.slots).filter(([, value]) => isPlainRecord(value))) as DueRunRegistry['slots'],
        updatedAt: stringValue(parsed.updatedAt) || new Date().toISOString(),
      }
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') logger.warn(err, '[dashboard-autopilot] failed to read due-run registry')
  }
  return { version: 1, slots: {}, updatedAt: '' }
}

async function writeDueRunRegistry(profile: string, registry: DueRunRegistry): Promise<void> {
  const filePath = dueRunRegistryPath(profile)
  const entries = Object.entries(registry.slots)
    .sort(([, a], [, b]) => stringValue(b.attemptedAt).localeCompare(stringValue(a.attemptedAt)))
    .slice(0, MAX_IMPORTED_RUN_KEYS)
  const next: DueRunRegistry = {
    version: 1,
    slots: Object.fromEntries(entries),
    updatedAt: new Date().toISOString(),
  }
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(next, null, 2), 'utf-8')
  await rename(tempPath, filePath)
}

function latestReadyFullDashboardSlot(now: Date, graceMs: number): Date {
  const threshold = new Date(now.getTime() - graceMs)
  const seven = new Date(threshold)
  seven.setHours(7, 0, 0, 0)
  const nineteen = new Date(threshold)
  nineteen.setHours(19, 0, 0, 0)

  if (threshold.getTime() >= nineteen.getTime()) return nineteen
  if (threshold.getTime() >= seven.getTime()) return seven

  const previous = new Date(threshold)
  previous.setDate(previous.getDate() - 1)
  previous.setHours(19, 0, 0, 0)
  return previous
}

function outputSatisfiesDueSlot(output: OutputFile, dueSlotAt: Date): boolean {
  return output.mtimeMs >= dueSlotAt.getTime()
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

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim()
  const withoutOuter = trimmed.startsWith('|') && trimmed.endsWith('|')
    ? trimmed.slice(1, -1)
    : trimmed
  return withoutOuter.split('|').map(cell => cell.trim())
}

function isMarkdownSeparator(line: string): boolean {
  const cells = parseMarkdownTableRow(line)
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
}

function getCell(row: Record<string, string>, ...headers: string[]): string {
  for (const header of headers) {
    const value = row[normalizeHeader(header)]
    if (value) return value
  }
  return ''
}

function parseMarkdownLink(value: string): { title: string, url: string } | null {
  const match = value.match(/\[([^\]]+)\]\(((?:https?|file):\/\/[^)\s]+)\)/i)
  if (!match) return null
  return {
    title: match[1].trim(),
    url: match[2].trim(),
  }
}

function normalizeCitationKey(value: string): string {
  return value.trim().replace(/^[\[(\s]+|[\])\s.:-]+$/g, '')
}

function citationKeysFromValue(value: string): string[] {
  const keys = new Set<string>()
  const bracketed = value.matchAll(/\[(\d{1,3})\]/g)
  for (const match of bracketed) keys.add(match[1])
  const bare = normalizeCitationKey(value)
  if (/^\d{1,3}$/.test(bare)) keys.add(bare)
  return [...keys]
}

function stripCitationMarkers(value: string): string {
  return value.replace(/\s*\[\d{1,3}\]/g, '').trim()
}

function parseCitationReferences(content: string): Map<string, { title: string, url: string, date?: string }> {
  const references = new Map<string, { title: string, url: string, date?: string }>()
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = trimmed.match(/^(?:[-*]\s*)?(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+(.+?)$/)
    if (!match) continue
    const key = match[1] || match[2]
    const body = match[3].trim()
    const markdownLink = parseMarkdownLink(body)
    const urlMatch = body.match(/(?:https?|file):\/\/[^\s)\]]+/i)
    const url = markdownLink?.url || urlMatch?.[0]?.trim() || ''
    if (!url) continue
    const withoutUrl = body
      .replace(/\[([^\]]+)\]\(((?:https?|file):\/\/[^)\s]+)\)/i, '$1')
      .replace(url, '')
      .replace(/\s*[—–-]\s*$/, '')
      .trim()
    const title = markdownLink?.title || withoutUrl || `Source ${key}`
    const dateMatch = body.match(/\b(20\d{2}(?:-\d{2})?(?:-\d{2})?|accessed\s+[^|,;]+)/i)
    references.set(key, { title, url, ...(dateMatch ? { date: dateMatch[1].trim() } : {}) })
  }
  return references
}

function inferGroupFromMarkdownTable(headers: string[], context: string): DashboardResearchUpdateGroup {
  const text = `${headers.join(' ')} ${context}`.toLowerCase()
  if (/supplier|scorecard|raw material|material|quote|payment|quality|reliability/.test(text)) return 'supplierScorecards'
  if (/competitor|manufacturer|company|market share|strength|weakness|product equivalent/.test(text)) return 'competitorRecords'
  if (/investment|financial|irr|npv|payback|roi|capex|working capital|profitability/.test(text)) return 'financialEvidence'
  if (/regulatory|dms|cas|permit|sds|tds|iecs|echa|pubchem/.test(text)) return 'regulatoryFindings'
  if (/investor|presentation|slide|deck|brief/.test(text)) return 'investorMaterialCandidates'
  if (/evidence gap|missing proof|gap/.test(text)) return 'evidenceGaps'
  if (/task|action|next step/.test(text)) return 'suggestedTasks'
  return 'marketClaims'
}

function sectionContextForLine(lines: string[], index: number): string {
  for (let i = index - 1; i >= Math.max(0, index - 12); i -= 1) {
    const line = lines[i]
    if (/^\s{0,3}#{1,6}\s+/.test(line)) return line
  }
  return lines.slice(Math.max(0, index - 4), index).join('\n')
}

function markdownSourceFields(
  row: Record<string, string>,
  references: Map<string, { title: string, url: string, date?: string }> = new Map(),
): Pick<DashboardResearchUpdateItem, 'sourceTitle' | 'sourceUrl' | 'sourceDate'> {
  const explicitTitle = getCell(row, 'source title', 'source name', 'source')
  const explicitUrl = getCell(row, 'source url', 'url', 'link')
  const sourceDate = getCell(row, 'source date', 'date', 'last checked', 'checked')
  const markdownLink = parseMarkdownLink(explicitTitle)
  const reference = citationKeysFromValue(`${explicitTitle} ${explicitUrl}`)
    .map(key => references.get(key))
    .find(Boolean)
  const explicitSourceUrl = citationKeysFromValue(explicitUrl).length > 0 ? '' : explicitUrl
  const sourceTitle = markdownLink?.title || reference?.title || (explicitTitle && /^https?:\/\//i.test(explicitTitle) ? 'Source link' : explicitTitle)
  const sourceUrl = explicitSourceUrl || markdownLink?.url || (/^(?:https?|file):\/\//i.test(explicitTitle) ? explicitTitle : '')
  return {
    sourceTitle: stripCitationMarkers(sourceTitle || ''),
    sourceUrl: sourceUrl || reference?.url || '',
    sourceDate: sourceDate || reference?.date || '',
  }
}

function markdownRowToDashboardItem(
  row: Record<string, string>,
  group: DashboardResearchUpdateGroup,
  references: Map<string, { title: string, url: string, date?: string }> = new Map(),
): DashboardResearchUpdateItem | null {
  const source = markdownSourceFields(row, references)
  if (!source.sourceTitle && !source.sourceUrl && !source.sourceDate) return null

  const field = getCell(row, 'field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item')
  const title = getCell(row, 'title', 'question', 'finding')
  const label = getCell(row, 'label')
  const value = getCell(row, 'value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score')
  const notes = getCell(row, 'notes', 'note', 'strength', 'weakness', 'summary')
  const marketShare = getCell(row, 'market share', 'share')
  const pricingEvidence = getCell(row, 'pricing evidence', 'price', 'price/kg', 'price/t', 'cost')
  const fallbackValue = value || marketShare || pricingEvidence || notes
  const rowTitle = title || label || field || getCell(row, 'company', 'competitor', 'manufacturer', 'supplier', 'material')
  if (!rowTitle && !fallbackValue) return null

  const item: DashboardResearchUpdateItem = {
    field: field || rowTitle,
    label: label || rowTitle,
    title: title || rowTitle,
    value: fallbackValue,
    companyName: getCell(row, 'company', 'competitor', 'manufacturer'),
    countryRegion: getCell(row, 'country', 'region', 'hq', 'country/region'),
    productEquivalent: getCell(row, 'product equivalent', 'product', 'equivalent'),
    activeContent: getCell(row, 'active content', 'active', 'content'),
    pricingEvidence,
    certifications: getCell(row, 'certifications', 'certification'),
    distributionPresence: getCell(row, 'distribution', 'distribution presence', 'presence'),
    marketShare,
    supplier: getCell(row, 'supplier'),
    material: getCell(row, 'material', 'raw material'),
    section: getCell(row, 'section'),
    content: getCell(row, 'content', 'snippet', 'report snippet'),
    sourceTitle: source.sourceTitle,
    sourceUrl: source.sourceUrl,
    sourceDate: source.sourceDate,
    sourceTier: getCell(row, 'source tier', 'tier'),
    lastChecked: getCell(row, 'last checked', 'checked'),
    confidence: getCell(row, 'confidence'),
    evidenceStatus: getCell(row, 'evidence status', 'status'),
    reviewRequired: /^(yes|true|required|review)$/i.test(getCell(row, 'review required', 'review')),
    riskReason: getCell(row, 'risk reason', 'risk'),
    dataType: getCell(row, 'data type', 'datatype'),
    sensitive: /^(yes|true|sensitive)$/i.test(getCell(row, 'sensitive')),
    notes,
    recommendedAction: getCell(row, 'recommended action', 'next action', 'action'),
    proposedDashboardField: getCell(row, 'proposed dashboard field', 'dashboard field', 'target field'),
  }

  if (group === 'competitorRecords' && !item.companyName) item.companyName = rowTitle
  if (group === 'supplierScorecards' && !item.value) item.value = pricingEvidence || notes || 'To Verify'
  return item
}

function extractMarkdownDashboardTables(content: string): DashboardResearchUpdatesPayload | null {
  const lines = content.split(/\r?\n/)
  const references = parseCitationReferences(content)
  const payload: DashboardResearchUpdatesPayload = {}

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes('|') || !isMarkdownSeparator(lines[i + 1])) continue
    const headers = parseMarkdownTableRow(lines[i])
    const normalizedHeaders = headers.map(normalizeHeader)
    const hasFieldishColumn = normalizedHeaders.some(header =>
      ['field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item', 'company', 'competitor', 'manufacturer', 'supplier', 'material'].includes(header),
    )
    const hasValueishColumn = normalizedHeaders.some(header =>
      ['value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score', 'marketshare', 'share', 'pricingevidence', 'price', 'cost', 'notes', 'summary'].includes(header),
    )
    const hasSourceColumn = normalizedHeaders.some(header =>
      ['sourcetitle', 'sourcename', 'source', 'sourceurl', 'url', 'link', 'sourcedate', 'date', 'lastchecked', 'checked'].includes(header),
    )
    if (!hasFieldishColumn || !hasValueishColumn || !hasSourceColumn) continue

    const context = sectionContextForLine(lines, i)
    const group = inferGroupFromMarkdownTable(headers, context)
    const items: DashboardResearchUpdateItem[] = []
    let rowIndex = i + 2
    for (; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex]
      if (!line.includes('|') || isMarkdownSeparator(line)) break
      const cells = parseMarkdownTableRow(line)
      if (cells.length < 2) break
      const row: Record<string, string> = {}
      headers.forEach((header, index) => {
        row[normalizeHeader(header)] = cells[index] || ''
      })
      const item = markdownRowToDashboardItem(row, group, references)
      if (item) items.push(item)
    }
    if (items.length) payload[group] = [...(payload[group] || []), ...items]
    i = Math.max(i, rowIndex - 1)
  }

  return DASHBOARD_UPDATE_GROUPS.some(group => (payload[group]?.length || 0) > 0) ? payload : null
}

function parseDelimitedBulletRow(
  line: string,
  references: Map<string, { title: string, url: string, date?: string }> = new Map(),
): Record<string, string> | null {
  const cleaned = line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
  if (!cleaned.includes('|') || !/source/i.test(cleaned)) return null

  const row: Record<string, string> = {}
  for (const segment of cleaned.split('|')) {
    const match = segment.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/)
    if (!match) continue
    const key = normalizeHeader(match[1])
    const value = match[2].trim()
    if (key && value) row[key] = value
  }

  const hasFieldish = Boolean(getCell(row, 'field', 'metric', 'kpi', 'claim', 'indicator', 'segment', 'category', 'section', 'item', 'company', 'competitor', 'manufacturer', 'supplier', 'material'))
  const hasValueish = Boolean(getCell(row, 'value', 'amount', 'size', 'growth', 'rate', 'status', 'target', 'scope', 'score', 'market share', 'share', 'pricing evidence', 'price', 'cost', 'notes', 'summary'))
  const sourceFields = markdownSourceFields(row, references)
  const hasSource = Boolean(sourceFields.sourceTitle || sourceFields.sourceUrl || sourceFields.sourceDate)

  return hasFieldish && hasValueish && hasSource ? row : null
}

function extractDelimitedDashboardBullets(content: string): DashboardResearchUpdatesPayload | null {
  const lines = content.split(/\r?\n/)
  const references = parseCitationReferences(content)
  const payload: DashboardResearchUpdatesPayload = {}

  lines.forEach((line, index) => {
    if (!/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) return
    const row = parseDelimitedBulletRow(line, references)
    if (!row) return
    const context = sectionContextForLine(lines, index)
    const group = inferGroupFromMarkdownTable(Object.keys(row), context)
    const item = markdownRowToDashboardItem(row, group, references)
    if (!item) return
    payload[group] = [...(payload[group] || []), item]
  })

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

  return extractMarkdownDashboardTables(trimmed) || extractDelimitedDashboardBullets(trimmed)
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

function normalizeSourceTierForItem(item: DashboardResearchUpdateItem): SourceTier {
  const explicit = normalizeSourceTier(item.sourceTier)
  if (explicit !== 'candidate-source') return explicit

  const text = [
    item.sourceTitle,
    item.sourceName,
    item.sourceUrl,
  ].map(stringValue).join(' ').toLowerCase()

  if (
    text.includes('wits.worldbank.org') ||
    text.includes('world bank') ||
    text.includes('un comtrade') ||
    text.includes('comtrade') ||
    text.includes('stats.gov.cn') ||
    text.includes('.gov') ||
    text.includes('echa.europa.eu') ||
    text.includes('pubchem.ncbi.nlm.nih.gov') ||
    text.includes('oecd.org') ||
    text.includes('wto.org') ||
    text.includes('trademap.org')
  ) {
    return 'tier1-official'
  }

  if (
    text.includes('basf') ||
    text.includes('dow.com') ||
    text.includes('wacker.com') ||
    text.includes('stepan.com') ||
    text.includes('kao') ||
    text.includes('evonik') ||
    text.includes('cht.com') ||
    text.includes('archroma') ||
    text.includes('transfar') ||
    text.includes('zschimmer') ||
    text.includes('pulcra') ||
    text.includes('wilmar') ||
    text.includes('klkoleo') ||
    text.includes('klk oleo')
  ) {
    return 'tier2-company-official'
  }

  if (
    text.includes('.xlsx') ||
    text.includes('.pdf') ||
    text.includes('workbook') ||
    text.includes('supplier quote') ||
    text.includes('sds') ||
    text.includes('tds') ||
    text.includes('coa') ||
    text.includes('invoice')
  ) {
    return 'tier3-supplier-evidence'
  }

  return explicit
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

function safeCandidateStatus(status: string): string {
  if (status === 'Verified' || status === 'Investor Approved') return 'To Verify'
  return coerceEvidenceStatus(status, 'To Verify')
}

function shouldShowMarketCandidate(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
  dataType: string
  item: DashboardResearchUpdateItem
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (!input.value || PLACEHOLDER_PATTERN.test(input.value)) return false
  if (input.item.sensitive === true || SENSITIVE_DATA_TYPES.has(input.dataType)) return false
  if (input.tier === 'tier5-public-listing' || input.tier === 'candidate-source') return false
  return true
}

function shouldShowCompetitorCandidate(input: {
  item: DashboardResearchUpdateItem
  source: Record<string, unknown> | null
  tier: SourceTier
  dataType: string
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (input.item.sensitive === true || SENSITIVE_DATA_TYPES.has(input.dataType)) return false
  if (input.tier === 'tier5-public-listing' || input.tier === 'candidate-source') return false
  const companyName = firstString(input.item.companyName, input.item.title, input.item.label)
  const productEquivalent = firstString(input.item.productEquivalent)
  return Boolean(companyName && productEquivalent && !PLACEHOLDER_PATTERN.test(productEquivalent))
}

function shouldShowDataRoomCandidate(input: {
  value: string
  source: Record<string, unknown> | null
  tier: SourceTier
}): boolean {
  if (!sourceIsUsable(input.source)) return false
  if (!input.value || PLACEHOLDER_PATTERN.test(input.value)) return false
  if (hasKnownFakeScreenshotValue(input.value)) return false
  return input.tier === 'tier1-official' || input.tier === 'tier2-company-official' || input.tier === 'tier3-supplier-evidence'
}

function appendDataRoomCandidate(
  state: DashboardIntelligenceState,
  input: {
    item: DashboardResearchUpdateItem
    group: DashboardResearchUpdateGroup
    field: string
    value: string
    source: Record<string, unknown> | null
    evidenceStatus: string
    lastChecked: string
    runKey: string
    tier: SourceTier
    dataType: string
    reasons: string[]
  },
): boolean {
  const checklistLabel = firstString(input.item.proposedDashboardField, input.item.fieldKey, input.field)
  if (!checklistLabel) return false
  if (includesExisting(state.dataRoomSources, record =>
    stringValue(record.checklistLabel).toLowerCase() === checklistLabel.toLowerCase() &&
    stringValue((record.source as Record<string, unknown> | undefined)?.title) === stringValue(input.source?.title),
  )) return false

  state.dataRoomSources.push({
    id: stableId('autopilot-source', input.runKey, checklistLabel),
    checklistLabel,
    area: areaForGroup(input.group),
    dashboardGroup: input.group,
    supplier: firstString(input.item.supplier),
    material: firstString(input.item.material),
    proposedValue: input.value,
    sourceTier: input.tier,
    dataType: input.dataType,
    confidence: input.item.confidence,
    evidenceStatus: safeCandidateStatus(input.evidenceStatus),
    source: input.source,
    notes: [
      `Autopilot candidate from ${input.group}.`,
      `Proposed value: ${input.value}`,
      `Source tier: ${input.tier}`,
      `Data type: ${input.dataType}`,
      input.reasons.length ? `Review reason: ${input.reasons.join('; ')}` : '',
      'This record was auto-staged to make the dashboard useful without manual copy-paste. It is not investor-approved.',
    ].filter(Boolean).join('\n'),
    updatedAt: input.lastChecked,
  })
  return true
}

function appendVisibleDashboardCandidate(
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
    tier: SourceTier
    dataType: string
    reasons: string[]
  },
): boolean {
  if (input.group === 'marketClaims' && shouldShowMarketCandidate(input)) {
    return appendMarketClaim(state, {
      item: input.item,
      group: input.group,
      field: input.field,
      value: input.value,
      source: input.source,
      confidence: input.confidence,
      evidenceStatus: safeCandidateStatus(input.evidenceStatus),
      lastChecked: input.lastChecked,
      runKey: input.runKey,
    })
  }

  if (input.group === 'competitorRecords' && shouldShowCompetitorCandidate(input)) {
    return appendCompetitorRecord(state, {
      item: input.item,
      value: input.value,
      source: input.source,
      evidenceStatus: safeCandidateStatus(input.evidenceStatus),
      lastChecked: input.lastChecked,
      runKey: input.runKey,
    })
  }

  if (
    (input.group === 'rawMaterialSignals' ||
      input.group === 'supplierScorecards' ||
      input.group === 'regulatoryFindings' ||
      input.group === 'financialEvidence') &&
    shouldShowDataRoomCandidate(input)
  ) {
    return appendDataRoomCandidate(state, input)
  }

  return false
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
    dashboardTarget: {
      group: input.group,
      screen: GROUP_SCREEN[input.group],
      field: title,
      value,
      proposedDashboardField: firstString(input.item.proposedDashboardField, input.item.fieldKey, input.item.field, input.item.label, title),
      companyName: firstString(input.item.companyName, input.item.title, input.item.label),
      countryRegion: firstString(input.item.countryRegion),
      productEquivalent: firstString(input.item.productEquivalent),
      activeContent: firstString(input.item.activeContent),
      pricingEvidence: firstString(input.item.pricingEvidence),
      certifications: firstString(input.item.certifications),
      distributionPresence: firstString(input.item.distributionPresence),
      marketShare: firstString(input.item.marketShare),
      supplier: firstString(input.item.supplier),
      material: firstString(input.item.material),
      section: firstString(input.item.section),
      content: firstString(input.item.content, input.item.value),
      sourceTier: normalizeSourceTierForItem(input.item),
      dataType: coerceDataType(input.item.dataType, GROUP_DEFAULT_DATA_TYPE[input.group]),
      sensitive: input.item.sensitive === true,
      runKey: input.runKey,
    },
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
      const tier = normalizeSourceTierForItem(item)
      const confidence = coerceConfidence(item.confidence)
      const evidenceStatus = coerceEvidenceStatus(item.evidenceStatus, 'To Verify')
      const dataType = coerceDataType(item.dataType, GROUP_DEFAULT_DATA_TYPE[group])
      const lastChecked = firstString(item.lastChecked, item.sourceDate) || fallbackCheckedAt
      const reasons = riskReasons({ item, group, field, value, source, tier, evidenceStatus, dataType, confidence })
      const reviewRequired = reasons.length > 0

      if (reviewRequired) {
        appendVisibleDashboardCandidate(state, {
          item,
          group,
          field,
          value,
          source,
          evidenceStatus,
          confidence,
          lastChecked,
          runKey,
          tier,
          dataType,
          reasons,
        })
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
  const skippedRunKeys = new Set(registry.skippedRunKeys)
  const envelope = await readDashboardIntelligenceState(profile)
  const state = normalizeState(envelope?.state)

  for (const job of jobs) {
    const jobId = getJobId(job)
    if (!jobId) continue
    const outputs = await listOutputFiles(profile, jobId, maxFilesPerJob)
    for (const output of outputs) {
      const runKey = `${output.jobId}/${output.fileName}`
      if (importedRunKeys.has(runKey) || skippedRunKeys.has(runKey)) continue
      result.filesChecked += 1
      try {
        const content = await readFile(output.path, 'utf-8')
        const payload = extractDashboardResearchUpdates(content)
        if (!payload) {
          skippedRunKeys.add(runKey)
          result.skippedRuns += 1
          continue
        }
        importedRunKeys.add(runKey)
        skippedRunKeys.delete(runKey)
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
    skippedRunKeys: [...skippedRunKeys],
    updatedAt: new Date().toISOString(),
  })

  return result
}

export async function readFullDashboardAutopilotImportStatus(profileInput?: string): Promise<DashboardAutopilotImportStatus> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const jobs = (await readCronJobs(profile)).filter(isFullDashboardAutopilotJobRecord)
  const registry = await readImportRegistry(profile)
  const dueRegistry = await readDueRunRegistry(profile)
  const importedRunKeys = new Set(registry.importedRunKeys)
  const skippedRunKeys = new Set(registry.skippedRunKeys)
  const outputFiles: OutputFile[] = []

  for (const job of jobs) {
    const jobId = getJobId(job)
    if (!jobId) continue
    outputFiles.push(...await listOutputFiles(profile, jobId, 50))
  }

  outputFiles.sort((a, b) => b.fileName.localeCompare(a.fileName) || b.mtimeMs - a.mtimeMs)
  const latestOutput = outputFiles[0] || null
  const latestOutputRunKey = latestOutput ? `${latestOutput.jobId}/${latestOutput.fileName}` : ''
  const latestOutputImported = latestOutputRunKey ? importedRunKeys.has(latestOutputRunKey) : false
  const latestOutputSkipped = latestOutputRunKey ? skippedRunKeys.has(latestOutputRunKey) : false
  let latestOutputParseStatus: DashboardAutopilotImportStatus['latestOutputParseStatus'] = latestOutput ? 'unparseable' : 'none'
  let latestOutputCandidateCount = 0
  let latestOutputParseError = ''
  if (latestOutputImported) {
    latestOutputParseStatus = 'imported'
  } else if (latestOutputSkipped) {
    latestOutputParseStatus = 'unparseable'
  } else if (latestOutput) {
    try {
      const latestContent = await readFile(latestOutput.path, 'utf-8')
      latestOutputCandidateCount = countDashboardPayloadItems(extractDashboardResearchUpdates(latestContent))
      latestOutputParseStatus = latestOutputCandidateCount > 0 ? 'ready' : 'unparseable'
    } catch (err) {
      latestOutputParseStatus = 'unreadable'
      latestOutputParseError = err instanceof Error ? err.message : 'Could not read latest output'
    }
  }
  const pendingOutputCount = outputFiles.filter(output => {
    const runKey = `${output.jobId}/${output.fileName}`
    return !importedRunKeys.has(runKey) && !skippedRunKeys.has(runKey)
  }).length
  const primaryJobId = jobs[0] ? getJobId(jobs[0]) : ''
  const dueSlot = primaryJobId ? latestReadyFullDashboardSlot(new Date(), DUE_RUN_GRACE_MS) : null
  const dueSlotAt = dueSlot ? dueSlot.toISOString() : ''
  const dueSlotKey = primaryJobId && dueSlotAt ? `${primaryJobId}/${dueSlotAt}` : ''
  const dueAttempt = dueSlotKey ? dueRegistry.slots[dueSlotKey] : null
  const latestDueSlotSatisfied = Boolean(dueSlot && primaryJobId && outputFiles.some(output =>
    output.jobId === primaryJobId && outputSatisfiesDueSlot(output, dueSlot),
  ))

  return {
    profile,
    jobCount: jobs.length,
    outputCount: outputFiles.length,
    importedRunCount: registry.importedRunKeys.length,
    skippedRunCount: registry.skippedRunKeys.length,
    pendingOutputCount,
    latestOutputRunKey,
    latestOutputFile: latestOutput?.fileName || '',
    latestOutputAt: latestOutput ? new Date(latestOutput.mtimeMs || Date.now()).toISOString() : '',
    latestOutputImported,
    latestOutputSkipped,
    latestOutputParseStatus,
    latestOutputCandidateCount,
    latestOutputParseError,
    latestImportedRunKey: registry.importedRunKeys[registry.importedRunKeys.length - 1] || '',
    registryUpdatedAt: registry.updatedAt || '',
    latestDueSlotAt: dueSlotAt,
    latestDueSlotSatisfied,
    latestDueSlotAttemptedAt: stringValue(dueAttempt?.attemptedAt),
    latestDueSlotRunError: stringValue(dueAttempt?.error),
  }
}

export async function runDueFullDashboardAutopilot(
  profileInput?: string,
  options: DueRunOptions = {},
): Promise<FullDashboardAutopilotDueRunResult> {
  const profile = profileInput || getActiveProfileName() || 'default'
  const now = options.now || new Date()
  const graceMs = options.graceMs ?? DUE_RUN_GRACE_MS
  const retryAfterMs = options.retryAfterMs ?? DUE_RUN_RETRY_AFTER_MS
  const dueSlot = latestReadyFullDashboardSlot(now, graceMs)
  const dueSlotAt = dueSlot.toISOString()
  const jobs = (await readCronJobs(profile)).filter(isFullDashboardAutopilotJobRecord)
  const job = jobs[0] || null
  const jobId = job ? getJobId(job) : ''
  const dueSlotKey = jobId ? `${jobId}/${dueSlotAt}` : ''

  const result: FullDashboardAutopilotDueRunResult = {
    profile,
    jobId: jobId || null,
    dueSlotAt,
    dueSlotKey,
    outputAlreadyPresent: false,
    skippedRecentAttempt: false,
    runStarted: false,
    runError: '',
    importedRuns: 0,
    autoFilledCount: 0,
    stagedReviewCount: 0,
  }
  if (!jobId) return result

  const importRegistry = await readImportRegistry(profile)
  const skippedRunKeys = new Set(importRegistry.skippedRunKeys)
  const outputs = await listOutputFiles(profile, jobId, 50)
  if (outputs.some(output =>
    outputSatisfiesDueSlot(output, dueSlot) &&
    !skippedRunKeys.has(`${output.jobId}/${output.fileName}`),
  )) {
    result.outputAlreadyPresent = true
    return result
  }

  const dueRegistry = await readDueRunRegistry(profile)
  const previousAttempt = dueRegistry.slots[dueSlotKey]
  const previousAttemptAt = previousAttempt ? Date.parse(stringValue(previousAttempt.attemptedAt)) : 0
  if (previousAttemptAt && Number.isFinite(previousAttemptAt) && now.getTime() - previousAttemptAt < retryAfterMs) {
    result.skippedRecentAttempt = true
    result.runError = stringValue(previousAttempt.error)
    return result
  }

  try {
    const defaultModel = await ensureDefaultModelForAutopilot(profile)
    if (defaultModel.configured) {
      logger.info({
        profile,
        model: defaultModel.model,
        provider: defaultModel.provider || undefined,
      }, '[dashboard-autopilot] configured default model before due trusted-source run')
    }
    await runHermesCron(profile, ['cron', 'run', jobId], RUN_TIMEOUT_MS)
    result.runStarted = true
    const ingest = await ingestFullDashboardAutopilotOutputs(profile, {
      jobId,
      maxFilesPerJob: options.maxFilesPerJob ?? 5,
    })
    result.importedRuns = ingest.importedRuns
    result.autoFilledCount = ingest.autoFilledCount
    result.stagedReviewCount = ingest.stagedReviewCount
    if (ingest.errors.length > 0) result.runError = ingest.errors.join('; ')
  } catch (err) {
    result.runError = err instanceof Error ? err.message : 'Hermes cron run failed'
  }

  const refreshedOutputs = await listOutputFiles(profile, jobId, 50)
  const refreshedImportRegistry = await readImportRegistry(profile)
  const refreshedSkippedRunKeys = new Set(refreshedImportRegistry.skippedRunKeys)
  dueRegistry.slots[dueSlotKey] = {
    jobId,
    dueSlotAt,
    attemptedAt: now.toISOString(),
    outputSeen: refreshedOutputs.some(output =>
      outputSatisfiesDueSlot(output, dueSlot) &&
      !refreshedSkippedRunKeys.has(`${output.jobId}/${output.fileName}`),
    ),
    error: result.runError,
  }
  await writeDueRunRegistry(profile, dueRegistry)

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
    const dueRun = await runDueFullDashboardAutopilot(profile)
    if (dueRun.runStarted || dueRun.outputAlreadyPresent || dueRun.skippedRecentAttempt || dueRun.runError) {
      logger.info({
        profile: dueRun.profile,
        jobId: dueRun.jobId,
        dueSlotAt: dueRun.dueSlotAt,
        outputAlreadyPresent: dueRun.outputAlreadyPresent,
        skippedRecentAttempt: dueRun.skippedRecentAttempt,
        runStarted: dueRun.runStarted,
        runError: dueRun.runError || undefined,
        importedRuns: dueRun.importedRuns,
        autoFilledCount: dueRun.autoFilledCount,
        stagedReviewCount: dueRun.stagedReviewCount,
      }, '[dashboard-autopilot] due trusted-source run checked')
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
