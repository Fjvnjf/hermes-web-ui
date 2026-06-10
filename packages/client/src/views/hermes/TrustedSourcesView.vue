<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NSelect, NSwitch, useMessage } from 'naive-ui'
import {
  FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
  type FullDashboardServerStatus,
  loadFullDashboardAutopilotStatus,
  persistFullDashboardAutopilotStatus,
  useTrustedSourceAutopilot,
} from '@/composables/useTrustedSourceAutopilot'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { createJob, runJob } from '@/api/hermes/jobs'
import type { TrustedSourceDataType, TrustedSourceTier } from '@/utils/trustedSources'
import {
  TRUSTED_SOURCE_DISCOVERY_ROOTS,
  TRUSTED_SOURCE_DISCOVERY_ROOT_COUNT,
  trustedSourceDiscoveryRootExamples,
} from '@/utils/trustedSourceDiscoveryRoots'
import {
  TRUSTED_SOURCE_BATCH_2_CANDIDATE_COUNT,
  TRUSTED_SOURCE_BATCH_2_COUNTRY_COUNT,
  TRUSTED_SOURCE_BATCH_2_HS_CODE_COUNT,
  TRUSTED_SOURCE_BATCH_2_INDICATOR_COUNT,
  TRUSTED_SOURCE_BATCH_2_PROVIDER_SUMMARIES,
  trustedSourceBatch2Examples,
} from '@/utils/trustedSourceUrlCandidates'
import {
  buildDashboardCoverageRows,
  missingDashboardCoverageTargetCount,
} from '@/utils/dashboardCoverage'

const message = useMessage()
const autopilot = useTrustedSourceAutopilot()
const intelligence = useFeasibilityIntelligence()
const AUTO_MISSING_COVERAGE_KEY = 'hermes.trustedSources.autoMissingCoverage.v1'
const fullAutopilotSaving = ref(false)
const importingLatestOutput = ref(false)
const refreshingServerStatus = ref(false)
const runningMissingCoverageResearch = ref(false)
const automaticMissingCoverageStatus = ref('Hermes watches missing dashboard coverage after imported source-backed records arrive.')
const fullAutopilotStatus = ref(loadFullDashboardAutopilotStatus())
const serverAutopilotStatus = ref<FullDashboardServerStatus | null>(null)

const form = ref({
  name: '',
  domain: '',
  tier: 'candidate-source' as TrustedSourceTier,
  dataType: 'market_size' as TrustedSourceDataType,
  notes: '',
})

const tierOptions = [
  { label: 'Tier 1 - Official / High Trust', value: 'tier1-official' },
  { label: 'Tier 2 - Market Reference', value: 'tier2-market-reference' },
  { label: 'Tier 3 - Supplier Evidence', value: 'tier3-supplier-evidence' },
  { label: 'Tier 4 - Public Listing / Weak Evidence', value: 'tier4-public-listing' },
  { label: 'Candidate Source / To Verify', value: 'candidate-source' },
]

const dataTypeOptions = [
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
].map(value => ({ label: value.replace(/_/g, ' '), value }))

const sourceDiscoveryRoots = computed(() => TRUSTED_SOURCE_DISCOVERY_ROOTS)
const sourceDiscoveryRootCount = TRUSTED_SOURCE_DISCOVERY_ROOT_COUNT
const sourceDiscoveryGroupCount = computed(() => sourceDiscoveryRoots.value.length)
const sourceDiscoveryExamples = (root: typeof TRUSTED_SOURCE_DISCOVERY_ROOTS[number]) => trustedSourceDiscoveryRootExamples(root, 10)
const sourceUrlCandidateCount = TRUSTED_SOURCE_BATCH_2_CANDIDATE_COUNT
const sourceUrlCandidateProviders = computed(() => TRUSTED_SOURCE_BATCH_2_PROVIDER_SUMMARIES)
const sourceUrlCandidateCountryCount = TRUSTED_SOURCE_BATCH_2_COUNTRY_COUNT
const sourceUrlCandidateIndicatorCount = TRUSTED_SOURCE_BATCH_2_INDICATOR_COUNT
const sourceUrlCandidateHsCodeCount = TRUSTED_SOURCE_BATCH_2_HS_CODE_COUNT
const sourceUrlCandidateExamples = (provider: string) => trustedSourceBatch2Examples(provider, 8)

const groupedSources = computed(() => ({
  tier1: autopilot.state.value.sources.filter(source => source.tier === 'tier1-official'),
  tier2: autopilot.state.value.sources.filter(source => source.tier === 'tier2-market-reference'),
  tier3: autopilot.state.value.sources.filter(source => source.tier === 'tier3-supplier-evidence'),
  tier4: autopilot.state.value.sources.filter(source => source.tier === 'tier4-public-listing'),
  candidates: autopilot.state.value.sources.filter(source => source.tier === 'candidate-source'),
}))
type SourceGroupKey = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'candidates'

const sourceGroupLabels: Record<SourceGroupKey, string> = {
  tier1: 'Tier 1 - Official / High Trust',
  tier2: 'Tier 2 - Market Reference',
  tier3: 'Tier 3 - Supplier Evidence',
  tier4: 'Tier 4 - Public Listing / Weak Evidence',
  candidates: 'Candidate Sources / To Verify',
}
const activeSourceCount = computed(() => autopilot.activeSources.value.length)
const needsReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)
const fullAutopilotSnapshotCount = computed(() => autopilot.state.value.snapshots.length)
const fullAutopilotReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)
const fullAutopilotStatusTone = computed(() => {
  if (!fullAutopilotStatus.value.enabled) return 'setup'
  if (fullAutopilotStatus.value.lastStatus.toLowerCase().includes('failed')) return 'warning'
  if (fullAutopilotStatus.value.lastStatus.toLowerCase().includes('review')) return 'review'
  return 'active'
})
const fullAutopilotOwnerAction = computed(() => {
  if (!fullAutopilotStatus.value.enabled) return 'Hermes starts the twice-daily online research job automatically for owner sessions. Use the repair action only if scheduling stays unavailable.'
  if (fullAutopilotReviewCount.value > 0) return 'Open Research Result Review and approve only the source-backed items you trust.'
  if (!fullAutopilotStatus.value.lastRun) return 'Wait for the first scheduled Hermes research output or run a source snapshot now.'
  return 'Autopilot is running. Keep reviewing staged findings; safe source-backed fields will hydrate from durable server state.'
})

type AutopilotIssueRow = { label: string; detail: string }

function autopilotIssueLabel(text: string): string {
  if (/429|rate limit/i.test(text)) return 'Rate limit'
  if (/PubChem|chemical identity|compound|substance synonym/i.test(text)) return 'Chemical source'
  if (/Comtrade|trade/i.test(text)) return 'Trade source'
  if (/SEC|companyfacts|financial|annual report/i.test(text)) return 'Financial source'
  if (/parse|unparseable|unreadable|dashboard_updates/i.test(text)) return 'Output parse'
  if (/due slot|run/i.test(text)) return 'Scheduled run'
  return 'Import warning'
}

function compactAutopilotIssue(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized
}

const serverAutopilotIssueRows = computed<AutopilotIssueRow[]>(() => {
  const status = serverAutopilotStatus.value
  if (!status) return []
  const values = [
    status.lastError,
    status.latestDueSlotRunError,
    status.latestOutputParseError,
    ...status.errors,
  ].map(value => value?.trim()).filter(Boolean) as string[]
  const seen = new Set<string>()
  return values
    .map(value => ({
      label: autopilotIssueLabel(value),
      detail: compactAutopilotIssue(value),
    }))
    .filter(row => {
      const key = `${row.label}:${row.detail}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 5)
})

const easyAutopilotState = computed(() => {
  const serverStatus = serverAutopilotStatus.value
  const pendingReview = serverStatus?.pendingReviewCount ?? fullAutopilotReviewCount.value
  const hasServerWarning = serverAutopilotIssueRows.value.length > 0
  const hasImportedData = importedIntelligenceTotal.value > 0 || Boolean(serverStatus?.latestOutputImported)

  if (!fullAutopilotStatus.value.enabled && !serverStatus?.scheduled) {
    return {
      tone: 'setup',
      label: 'Auto-starting',
      title: 'Hermes is checking automatic research',
      body: 'Owner sessions automatically create or repair the twice-daily trusted-source research job. No manual searching is needed.',
      action: 'No action needed. Use Check Autopilot Health only if the schedule still does not appear.',
    }
  }
  if (hasServerWarning) {
    const firstIssue = serverAutopilotIssueRows.value[0]
    return {
      tone: 'warning',
      label: 'Needs attention',
      title: 'Autopilot needs a quick check',
      body: firstIssue
        ? `${firstIssue.label}: ${firstIssue.detail}`
        : serverStatus?.message || 'Hermes reported a job or import warning. Existing dashboard data is preserved.',
      action: 'Refresh status, then inspect Jobs or the Review Queue.',
    }
  }
  if (pendingReview > 0) {
    return {
      tone: 'review',
      label: `${pendingReview} to review`,
      title: 'Hermes found items that need approval',
      body: 'Market size, prices, competitor share, financial outputs, regulatory status, and investor claims stay staged until you approve them.',
      action: 'Open the Review Queue and approve only source-backed items.',
    }
  }
  if (hasImportedData) {
    return {
      tone: 'active',
      label: 'Running',
      title: 'Dashboard filling is active',
      body: 'Hermes is importing safe source-backed records into the dashboard and keeping risky claims review-gated.',
      action: 'Use the dashboard normally. Your only routine action is reviewing staged findings before they become business truth.',
    }
  }
  return {
    tone: 'active',
    label: 'Waiting for output',
    title: 'Autopilot is scheduled',
    body: 'The twice-daily research job is connected. The first readable Hermes output has not been imported yet.',
    action: 'No manual searching needed. Hermes will import readable source-backed output when the scheduled run finishes.',
  }
})
const easyWorkflowCards = computed(() => [
  {
    label: '🔎 1. Research',
    value: 'Hermes searches trusted sources',
    detail: 'Official, company, supplier, regulatory, trade, and uploaded evidence sources are prioritized.',
  },
  {
    label: '📊 2. Fill',
    value: `${importedIntelligenceTotal.value} records available`,
    detail: 'Safe source-backed records hydrate dashboard pages without manual copy-paste.',
  },
  {
    label: '✅ 3. Review',
    value: `${serverAutopilotStatus.value?.pendingReviewCount ?? intelligence.pendingResearchFindings.value.length} items waiting`,
    detail: 'Sensitive, weak, conflicting, or investor-impact claims wait for owner approval.',
  },
  {
    label: '🔁 4. Fill gaps',
    value: automaticMissingCoverageSummary.value,
    detail: automaticMissingCoverageStatus.value,
  },
])
const autopilotCommandCards = computed(() => [
  {
    icon: '🛰️',
    title: 'Auto research is working for you',
    value: serverAutopilotStatus.value?.scheduled || fullAutopilotStatus.value.enabled ? 'On' : 'Checking',
    detail: 'Hermes keeps the twice-daily trusted-source job connected and imports readable source-backed output.',
    tone: serverAutopilotStatus.value?.scheduled || fullAutopilotStatus.value.enabled ? 'active' : 'setup',
  },
  {
    icon: '📥',
    title: 'Dashboard records ready',
    value: String(importedIntelligenceTotal.value),
    detail: 'These are source-labeled market, competitor, supplier, finance, and evidence records already available to dashboard pages.',
    tone: importedIntelligenceTotal.value > 0 ? 'active' : 'setup',
  },
  {
    icon: '✅',
    title: 'Your review queue',
    value: String(serverAutopilotStatus.value?.pendingReviewCount ?? intelligence.pendingResearchFindings.value.length),
    detail: 'Review only staged risky items. Hermes will not silently approve market size, prices, IRR, regulatory, or investor claims.',
    tone: (serverAutopilotStatus.value?.pendingReviewCount ?? intelligence.pendingResearchFindings.value.length) > 0 ? 'review' : 'active',
  },
  {
    icon: '🧭',
    title: 'Missing coverage',
    value: missingCoverageTargetCount.value ? String(missingCoverageTargetCount.value) : 'Covered',
    detail: missingCoverageTargetCount.value
      ? 'Hermes watches missing targets and can create a source-backed follow-up job automatically.'
      : 'Required dashboard target groups currently have imported evidence or review items.',
    tone: missingCoverageTargetCount.value ? 'review' : 'active',
  },
])
const coverageRows = computed(() => buildDashboardCoverageRows(intelligence.state.value))
const missingCoverageRows = computed(() => coverageRows.value.filter(row => row.missingTargets.length > 0))
const missingCoverageTargetCount = computed(() => missingDashboardCoverageTargetCount(missingCoverageRows.value))
const missingCoverageFingerprint = computed(() =>
  missingCoverageRows.value
    .map(row => `${row.area}:${row.missingTargets.map(item => item.label).sort().join('|')}`)
    .sort()
    .join('||'),
)
const importedIntelligenceRows = computed(() => [
  {
    label: 'Market and country signals',
    count: intelligence.state.value.marketClaims.length,
    route: { name: 'hermes.marketIntelligence' },
    note: 'Source-backed market claims, trade proxies, country signals, and segmentation evidence.',
  },
  {
    label: 'Competitor records',
    count: intelligence.state.value.competitors.length,
    route: { name: 'hermes.competitorIntelligence' },
    note: 'Company/product records; pricing and market-share claims stay review-gated.',
  },
  {
    label: 'Supplier and data-room sources',
    count: intelligence.state.value.dataRoomSources.length +
      intelligence.state.value.rawMaterialSignals.length +
      intelligence.state.value.supplierScorecards.length,
    route: { name: 'hermes.rawMaterialSourcing' },
    note: 'Review-gated supplier, raw-material identity, regulatory, financial, and document evidence candidates with source labels.',
  },
  {
    label: 'Research review findings',
    count: intelligence.pendingResearchFindings.value.length,
    route: { name: 'hermes.researchResultReview' },
    note: 'Weak, sensitive, conflicting, or investor-impact findings waiting for approval.',
  },
  {
    label: 'Scheduled research jobs',
    count: intelligence.state.value.researchJobs.length,
    route: { name: 'hermes.jobs' },
    note: 'Hermes Jobs that keep the dashboard research pipeline running automatically.',
  },
])
const importedIntelligenceTotal = computed(() =>
  importedIntelligenceRows.value.reduce((sum, row) => sum + row.count, 0),
)
const automaticMissingCoverageSummary = computed(() => {
  if (!missingCoverageTargetCount.value) return 'All required targets are covered'
  if (runningMissingCoverageResearch.value) return 'Starting follow-up research'
  if (canAutoRunMissingCoverageResearch()) return 'Auto follow-up ready'
  return `${missingCoverageTargetCount.value} missing targets watched`
})
const durableStateTimestamp = computed(() =>
  intelligence.serverSyncStatus.value.lastLoadedAt ||
  intelligence.serverSyncStatus.value.lastSavedAt ||
  '',
)
const importedIntelligenceStatus = computed(() => {
  if (intelligence.serverSyncStatus.value.error) {
    return `Server sync warning: ${intelligence.serverSyncStatus.value.error}`
  }
  if (importedIntelligenceTotal.value > 0) {
    return `Durable intelligence is active. ${importedIntelligenceTotal.value} imported records are available to dashboard pages.`
  }
  return 'Waiting for the first structured Hermes research output to import.'
})
const serverAutopilotTone = computed(() => {
  if (!serverAutopilotStatus.value?.scheduled) return 'setup'
  if (serverAutopilotStatus.value.lastError || serverAutopilotStatus.value.errors.length) return 'warning'
  if (['unparseable', 'unreadable'].includes(serverAutopilotStatus.value.latestOutputParseStatus)) return 'warning'
  if (!serverAutopilotStatus.value.latestOutputImported && serverAutopilotStatus.value.outputCount > 0) return 'review'
  return 'active'
})

function formatTimestamp(value: string): string {
  if (!value) return 'Not loaded yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function missingCoveragePrompt(): string {
  const missingTargets = missingCoverageRows.value
    .map(row => `- ${row.area}: ${row.missingTargets.map(item => item.label).join(', ')}`)
    .join('\n')

  return [
    'You are Hermes Full Dashboard Missing Coverage Research.',
    'Do the online research yourself using trusted and verified sources. Do not ask the user to manually search or paste data.',
    '',
    'Objective:',
    'Fill the missing dashboard coverage targets below with source-backed evidence candidates for the Hermes dashboard.',
    '',
    'Missing targets:',
    missingTargets || '- None',
    '',
    'Dashboard areas to update when evidence exists:',
    '- Executive Overview',
    '- Market Intelligence',
    '- Competitor Intelligence',
    '- Investment Analysis / IRR',
    '- Raw Material Sourcing / Supplier Scorecards',
    '- Export Market Opportunity',
    '- Regulatory / Data Room',
    '- Investor Readiness',
    '- Presentation Builder',
    '',
    'Source priority:',
    '1. Government, regulator, customs, statistical, trade, and official standards sources.',
    '2. Official company, product, catalog, SDS, TDS, annual report, or investor-relations sources.',
    '3. Uploaded supplier evidence such as quote, SDS, TDS, COA, invoice, or internal file reference.',
    '4. Paid or reputable market references, labeled as market reference and usually review-gated.',
    '5. Public listings or marketplaces only as weak references, never as verified facts.',
    '',
    'Safety rules:',
    '- No fake values and no unsupported claims.',
    '- Unsupported values stay out of dashboard truth until source-backed or staged for review.',
    '- Market size, CAGR, consumption growth, competitor share, supplier prices, financial outputs, regulatory status, and investor claims must be staged for owner review unless evidence is strong and official.',
    '- Formula, cost-sensitive, product-development, supplier-price, and investor-sensitive details must remain protected.',
    '- Financial outputs remain Derived from Assumptions unless tied to approved inputs.',
    '',
    'Return only structured dashboard_updates JSON compatible with the Full Dashboard Autopilot importer.',
    'Each candidate must include fieldKey, value, sourceTitle, sourceUrl, sourceTier, lastChecked, confidence, evidenceStatus, reviewRequired, and riskReason.',
  ].join('\n')
}

function missingCoverageScope(): string {
  return missingCoverageRows.value
    .map(row => `${row.area}: ${row.missingTargets.map(item => item.label).join(', ')}`)
    .join('\n')
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function loadAutomaticMissingCoverageRecord(): { fingerprint?: string; date?: string; status?: string } {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(AUTO_MISSING_COVERAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveAutomaticMissingCoverageRecord(status: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(AUTO_MISSING_COVERAGE_KEY, JSON.stringify({
    fingerprint: missingCoverageFingerprint.value,
    date: todayKey(),
    status,
    targetCount: missingCoverageTargetCount.value,
    savedAt: new Date().toISOString(),
  }))
}

function hasRecentAutomaticMissingCoverageRun(): boolean {
  const record = loadAutomaticMissingCoverageRecord()
  return Boolean(
    record.fingerprint &&
    record.fingerprint === missingCoverageFingerprint.value &&
    record.date === todayKey(),
  )
}

function hasExistingMissingCoverageFollowUp(): boolean {
  const scope = missingCoverageScope()
  return intelligence.state.value.researchJobs.some(job =>
    job.title === 'Full Dashboard Missing Coverage Follow-up' &&
    job.context === 'Full Dashboard Trusted Source Autopilot' &&
    job.scope === scope &&
    ['Scheduled Hermes Job', 'Manual Research Job', 'Task Created'].includes(job.status),
  )
}

function canAutoRunMissingCoverageResearch(): boolean {
  const serverStatus = serverAutopilotStatus.value
  const scheduled = fullAutopilotStatus.value.enabled || Boolean(serverStatus?.scheduled)
  const hasImportedOrDurableData = importedIntelligenceTotal.value > 0 ||
    Boolean(serverStatus?.latestOutputImported) ||
    (serverStatus?.dashboardRecordCount ?? 0) > 0

  return scheduled &&
    hasImportedOrDurableData &&
    missingCoverageTargetCount.value > 0 &&
    !runningMissingCoverageResearch.value
}

async function maybeRunAutomaticMissingCoverageResearch() {
  if (!canAutoRunMissingCoverageResearch()) {
    if (!missingCoverageTargetCount.value) {
      automaticMissingCoverageStatus.value = 'All required dashboard targets currently have imported evidence or review items.'
    }
    return
  }
  if (hasExistingMissingCoverageFollowUp()) {
    automaticMissingCoverageStatus.value = 'A source-backed follow-up job already exists for the current missing coverage map.'
    return
  }
  if (hasRecentAutomaticMissingCoverageRun()) {
    automaticMissingCoverageStatus.value = 'Hermes already started a missing-coverage follow-up for these targets today.'
    return
  }
  automaticMissingCoverageStatus.value = 'Hermes is starting a missing-coverage research follow-up automatically.'
  await runMissingCoverageResearch({ automatic: true })
}

async function refreshServerAutopilotStatus() {
  refreshingServerStatus.value = true
  try {
    serverAutopilotStatus.value = await autopilot.refreshFullDashboardServerStatus()
  } finally {
    refreshingServerStatus.value = false
  }
}

function updateFullAutopilotStatus(patch: Partial<typeof fullAutopilotStatus.value>) {
  fullAutopilotStatus.value = persistFullDashboardAutopilotStatus(patch)
}

function sourceGroupLabel(key: string | number): string {
  return sourceGroupLabels[String(key) as SourceGroupKey] || String(key)
}

function addSource() {
  if (!form.value.name.trim() || !form.value.domain.trim()) {
    message.warning('Add source name and domain first')
    return
  }
  const saved = autopilot.registerCandidate({
    name: form.value.name,
    domain: form.value.domain,
    dataType: form.value.dataType,
  })
  autopilot.updateSource(saved.source_id, {
    tier: form.value.tier,
    confidence_default: form.value.tier === 'tier1-official' ? 'high' : form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing' ? 'low' : 'medium',
    auto_update_allowed: form.value.tier === 'tier1-official' || form.value.tier === 'tier2-market-reference' || form.value.tier === 'tier3-supplier-evidence',
    requires_review: form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing',
    notes: form.value.notes || 'Owner-added trusted source registry record.',
  })
  form.value = { name: '', domain: '', tier: 'candidate-source', dataType: 'market_size', notes: '' }
  message.success('Trusted source saved')
}

async function enableFullDashboardAutopilot() {
  fullAutopilotSaving.value = true
  try {
    const result = await autopilot.ensureFullDashboardAutopilotScheduled({ startFirstRun: true })
    await autopilot.runFullDashboardDataEngine(result.scheduledJobId)
    fullAutopilotStatus.value = loadFullDashboardAutopilotStatus()
    void importLatestDashboardResearchOutput(false)
    void refreshServerAutopilotStatus()
    message.success(result.firstRunStarted ? 'Full dashboard autopilot enabled and first run started' : 'Full dashboard autopilot enabled')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown scheduling error'
    await autopilot.runFullDashboardDataEngine()
    updateFullAutopilotStatus({
      enabled: false,
      lastRun: new Date().toISOString(),
      lastStatus: `Scheduling failed; local source snapshot created instead. ${detail}`,
    })
    message.warning('Scheduling failed; created local source snapshots for review instead')
  } finally {
    fullAutopilotSaving.value = false
  }
}

async function runFullDashboardSnapshotNow() {
  fullAutopilotSaving.value = true
  try {
    const result = await autopilot.runFullDashboardDataEngine(fullAutopilotStatus.value.scheduledJobId || undefined)
    updateFullAutopilotStatus({
      lastRun: new Date().toISOString(),
      lastStatus: `${result.message}. Review items: ${result.reviewItemCount}.`,
    })
    void refreshServerAutopilotStatus()
    message.success('Full dashboard source snapshot created')
  } finally {
    fullAutopilotSaving.value = false
  }
}

async function importLatestDashboardResearchOutput(showMessages = true) {
  importingLatestOutput.value = true
  try {
    const result = await autopilot.runFullDashboardImportNow()
    updateFullAutopilotStatus({
      lastRun: new Date().toISOString(),
      lastStatus: `${result.message}. Auto-filled: ${result.imported}. Needs review: ${result.staged}.`,
    })
    if (!showMessages) return
    if (result.imported || result.staged) {
      message.success('Latest Hermes research output imported into the source-gated dashboard pipeline')
    } else if (result.errors.length) {
      message.warning(`${result.message} Some sources need attention: ${result.errors.slice(0, 2).join('; ')}`)
    } else {
      message.warning(result.message)
    }
    void refreshServerAutopilotStatus()
  } catch (err) {
    const serverImportDetail = err instanceof Error ? err.message : 'Unknown server import error'
    if (!fullAutopilotStatus.value.scheduledJobId) {
      updateFullAutopilotStatus({
        lastStatus: `Could not import latest Hermes research output: ${serverImportDetail}`,
      })
      if (showMessages) message.error(`Could not import latest Hermes research output: ${serverImportDetail}`)
      return
    }
    try {
      const result = await autopilot.importLatestFullDashboardRunOutput(fullAutopilotStatus.value.scheduledJobId)
      if (result.runImported || showMessages) {
        updateFullAutopilotStatus({
          lastRun: result.runImported ? new Date().toISOString() : fullAutopilotStatus.value.lastRun,
          lastStatus: `${result.message}. Auto-filled: ${result.autoFilledCount}. Needs review: ${result.reviewItemCount}.`,
        })
      }
      if (!showMessages) return
      if (result.runImported) {
        message.success('Latest Hermes research output imported into the source-gated dashboard pipeline')
      } else {
        message.warning(result.message)
      }
      void refreshServerAutopilotStatus()
    } catch (fallbackErr) {
      const fallbackDetail = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown fallback import error'
      updateFullAutopilotStatus({
        lastStatus: `Could not import latest Hermes research output: ${serverImportDetail}; fallback failed: ${fallbackDetail}`,
      })
      if (showMessages) message.error(`Could not import latest Hermes research output: ${fallbackDetail}`)
    }
  } finally {
    importingLatestOutput.value = false
  }
}

async function runMissingCoverageResearch(options: { automatic?: boolean } = {}) {
  const automatic = Boolean(options.automatic)
  if (!missingCoverageTargetCount.value) {
    if (automatic) {
      automaticMissingCoverageStatus.value = 'No missing dashboard coverage targets are visible right now.'
    } else {
      message.info('No missing dashboard coverage targets are visible right now')
    }
    return
  }

  runningMissingCoverageResearch.value = true
  const createdAt = new Date().toISOString()
  const title = 'Full Dashboard Missing Coverage Follow-up'
  const prompt = missingCoveragePrompt()
  try {
    const job = await createJob({
      name: title,
      schedule: FULL_DASHBOARD_AUTOPILOT_SCHEDULE,
      prompt,
      deliver: 'local',
      repeat: 1,
    })
    const jobId = job.job_id || job.id
    if (!jobId) throw new Error('Hermes did not return a job id')

    await runJob(jobId)
    intelligence.addResearchJob({
      title,
      question: 'Automatically research the missing trusted-source dashboard coverage targets.',
      scope: missingCoverageScope(),
      expectedOutput: 'dashboard_updates JSON with source metadata for the Full Dashboard Autopilot importer.',
      sourceRequirements: 'Official-first trusted sources; weak, sensitive, conflicting, financial, market-share, supplier-price, regulatory, and investor-impact findings stay review-gated.',
      priority: 'high',
      scheduledJobId: jobId,
      schedule: 'Immediate one-time follow-up from Trusted Sources coverage audit',
      context: 'Full Dashboard Trusted Source Autopilot',
      status: 'Scheduled Hermes Job',
    })
    saveAutomaticMissingCoverageRecord('scheduled')
    automaticMissingCoverageStatus.value = 'Hermes started a source-backed missing-coverage research job. Results will still go through review.'
    void refreshServerAutopilotStatus()
    if (!automatic) message.success('Hermes missing-coverage research job started')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown job error'
    intelligence.addResearchJob({
      title,
      question: 'Automatically research the missing trusted-source dashboard coverage targets.',
      scope: missingCoverageScope(),
      expectedOutput: 'dashboard_updates JSON with source metadata for the Full Dashboard Autopilot importer.',
      sourceRequirements: 'Official-first trusted sources; weak, sensitive, conflicting, financial, market-share, supplier-price, regulatory, and investor-impact findings stay review-gated.',
      priority: 'high',
      schedule: `Job API fallback recorded at ${createdAt}`,
      context: 'Full Dashboard Trusted Source Autopilot',
      status: 'Manual Research Job',
    })
    saveAutomaticMissingCoverageRecord('fallback')
    automaticMissingCoverageStatus.value = `Hermes saved a missing-coverage research fallback because scheduling was unavailable: ${detail}`
    if (!automatic) message.warning(`Could not start the Hermes job yet; saved a research follow-up fallback. ${detail}`)
  } finally {
    runningMissingCoverageResearch.value = false
  }
}

onMounted(() => {
  void bootstrapTrustedSourcesView()
})

async function bootstrapTrustedSourcesView() {
  await refreshServerAutopilotStatus()
  await intelligence.hydrateFeasibilityIntelligenceFromServer({ seedServerIfEmpty: false })
  if (fullAutopilotStatus.value.enabled && fullAutopilotStatus.value.scheduledJobId) {
    await importLatestDashboardResearchOutput(false)
  }
  await refreshServerAutopilotStatus()
  await maybeRunAutomaticMissingCoverageResearch()
}
</script>

<template>
  <div class="trusted-sources-view">
    <header class="sources-header">
      <div>
        <p class="eyebrow">Trusted Sources</p>
        <h2>Automatic Research Status</h2>
        <p>
          Hermes researches trusted online sources automatically, fills safe source-backed dashboard fields, and
          sends risky or investor-impacting claims to review before they become truth. No manual web searching is needed.
        </p>
      </div>
      <div class="summary-card">
        <strong>{{ activeSourceCount }}</strong>
        <span>active sources</span>
        <small>{{ needsReviewCount }} snapshots need review / review only what Hermes stages</small>
      </div>
    </header>

    <section class="easy-autopilot-panel" :class="easyAutopilotState.tone" aria-label="Easy autopilot status">
      <div class="easy-autopilot-main">
        <p class="eyebrow">Easy autopilot</p>
        <div class="easy-status-line">
          <h3>{{ easyAutopilotState.title }}</h3>
          <span>{{ easyAutopilotState.label }}</span>
        </div>
        <p>{{ easyAutopilotState.body }}</p>
        <strong>{{ easyAutopilotState.action }}</strong>
        <div class="easy-autopilot-actions">
          <NButton type="primary" :loading="fullAutopilotSaving" @click="enableFullDashboardAutopilot">Check Autopilot Health</NButton>
          <RouterLink class="autopilot-link" :to="{ name: 'hermes.researchResultReview' }">Review Findings</RouterLink>
          <RouterLink class="autopilot-link" :to="{ name: 'hermes.marketIntelligence' }">Open Filled Market Data</RouterLink>
        </div>
      </div>
      <div class="easy-workflow-grid">
        <article v-for="card in easyWorkflowCards" :key="card.label">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.detail }}</small>
        </article>
      </div>
    </section>

    <section class="autopilot-command-strip" aria-label="Simple automatic research control center">
      <div class="command-strip-header">
        <div>
          <p class="eyebrow">Start here</p>
          <h3>Automatic Dashboard Research</h3>
          <p>
            Hermes searches trusted sources, fills safe source-backed records, and keeps risky claims waiting for approval.
            You should not need to search the web or copy data manually.
          </p>
        </div>
        <div class="command-strip-actions">
          <RouterLink class="autopilot-link primary" :to="{ name: 'hermes.researchResultReview' }">✅ Review staged findings</RouterLink>
          <RouterLink class="autopilot-link" :to="{ name: 'hermes.dashboard' }">📊 Open filled dashboard</RouterLink>
          <NButton tertiary :loading="fullAutopilotSaving" @click="enableFullDashboardAutopilot">🛟 Repair auto research</NButton>
        </div>
      </div>
      <div class="command-strip-grid">
        <article v-for="card in autopilotCommandCards" :key="card.title" :class="card.tone">
          <span class="command-card-icon" aria-hidden="true">{{ card.icon }}</span>
          <div>
            <small>{{ card.title }}</small>
            <strong>{{ card.value }}</strong>
            <em>{{ card.detail }}</em>
          </div>
        </article>
      </div>
    </section>

    <details class="advanced-disclosure">
      <summary>
        <span>Evidence rules and source-ranking policy</span>
        <small>Open when you want to inspect why a value is filled, staged, or blocked.</small>
      </summary>
      <section class="source-permission-panel" aria-label="Research permission and evidence rules">
        <div>
          <p class="eyebrow">Research permission</p>
          <h3>Hermes can research trusted sources</h3>
          <p>
            Owner-approved research is active for public, company, regulatory, supplier, and uploaded evidence sources.
            Findings can stage dashboard updates only when source evidence and review rules are preserved.
          </p>
        </div>
        <div class="permission-flow" aria-label="Trusted source research flow">
          <span>Twice-daily trusted research</span>
          <span>Extract important data</span>
          <span>Attach evidence label</span>
          <span>Auto-stage critical items</span>
          <span>Fill only safe source-backed fields</span>
        </div>
        <ul class="permission-rule-list">
          <li>Important numbers require source title, URL or source date, confidence, evidence status, and review trail.</li>
          <li>Weak, conflicting, sensitive, or candidate-source findings go to Research Result Review instead of becoming facts.</li>
          <li>Unsupported market size, CAGR, market share, pricing, cost, IRR, or NPV values stay in source review until approved evidence arrives.</li>
        </ul>
        <div class="policy-tier-strip" aria-label="Official-first source ranking policy">
          <span>Tier 1: official / regulator / trade</span>
          <span>Tier 2: official company / product</span>
          <span>Tier 3: uploaded supplier evidence</span>
          <span>Tier 4: paid / reputable market reference</span>
          <span>Tier 5: public listing / weak reference</span>
        </div>
      </section>
    </details>

    <section class="full-autopilot-panel" aria-label="Full dashboard trusted source autopilot">
      <div class="full-autopilot-copy">
        <p class="eyebrow">Full dashboard autopilot</p>
        <h3>Automatic Source Research For The Whole Dashboard</h3>
        <p>
          Hermes automatically checks and runs trusted online source research on schedule, creates source-labeled dashboard
          snapshots, and routes weak, conflicting, sensitive, or missing values to Research Result Review. This removes
          manual copy-paste while keeping fake numbers out of Market Intelligence, Competitors, supplier scorecards,
          investment analysis, and investor material.
        </p>
      </div>
      <div class="full-autopilot-status">
        <article>
          <span>Status</span>
          <strong>{{ fullAutopilotStatus.enabled ? 'Scheduled' : 'Not Scheduled' }}</strong>
        </article>
        <article>
          <span>Schedule</span>
          <strong>07:00 / 19:00</strong>
        </article>
        <article>
          <span>Snapshots</span>
          <strong>{{ fullAutopilotSnapshotCount }}</strong>
        </article>
        <article>
          <span>Needs Review</span>
          <strong>{{ fullAutopilotReviewCount }}</strong>
        </article>
      </div>
      <div class="full-autopilot-command" :class="fullAutopilotStatusTone">
        <div>
          <span>Current owner action</span>
          <strong>{{ fullAutopilotOwnerAction }}</strong>
        </div>
        <small>
          Durable server intelligence hydrates the source panels after every successful import, so refreshed data survives browser reloads and public tunnel changes.
        </small>
      </div>
      <div class="autopilot-daily-strip" aria-label="Automatic research daily workflow">
        <article>
          <span>🛰️ Automatic mode</span>
          <strong>No manual web searching</strong>
          <small>Hermes runs trusted-source research twice daily and imports readable source-backed output.</small>
        </article>
        <article>
          <span>🧾 Your review gate</span>
          <strong>{{ serverAutopilotStatus?.pendingReviewCount ?? intelligence.pendingResearchFindings.value.length }} items waiting</strong>
          <small>Risky, weak, sensitive, financial, supplier-price, regulatory, and investor claims wait for approval.</small>
        </article>
        <article>
          <span>📊 Dashboard filling</span>
          <strong>{{ importedIntelligenceTotal }} records ready</strong>
          <small>Safe records hydrate Market, Competitors, Raw Materials, Finance, Reports, and Investor pages.</small>
        </article>
      </div>
      <div class="autopilot-primary-links">
        <RouterLink class="autopilot-link primary" :to="{ name: 'hermes.researchResultReview' }">Open Review Queue</RouterLink>
        <RouterLink class="autopilot-link" :to="{ name: 'hermes.rawMaterialSourcing' }">Raw Material Scorecards</RouterLink>
        <RouterLink class="autopilot-link" :to="{ name: 'hermes.marketIntelligence' }">Market Dashboard</RouterLink>
      </div>
      <details class="advanced-disclosure autopilot-details">
        <summary>
          <span>Diagnostics, imported records, and coverage audit</span>
          <small>Health repair, one-off snapshots, and import controls stay here for troubleshooting only.</small>
        </summary>
        <div class="server-autopilot-status" :class="serverAutopilotTone" aria-label="Server autopilot job status">
          <div class="server-autopilot-header">
            <div>
              <p class="eyebrow">Server job status</p>
              <h4>{{ serverAutopilotStatus?.scheduled ? 'Hermes research job is connected' : 'Hermes research job not confirmed yet' }}</h4>
            </div>
            <NButton tertiary size="small" :loading="refreshingServerStatus" @click="refreshServerAutopilotStatus">
              Refresh Status
            </NButton>
          </div>
          <p class="server-autopilot-message">
            {{ serverAutopilotStatus?.message || 'Reading the Hermes Jobs and Cron History APIs for live autopilot status.' }}
          </p>
          <ul v-if="serverAutopilotIssueRows.length" class="server-autopilot-issues" aria-label="Autopilot import issues">
            <li v-for="issue in serverAutopilotIssueRows" :key="`${issue.label}-${issue.detail}`">
              <span>{{ issue.label }}</span>
              <strong>{{ issue.detail }}</strong>
            </li>
          </ul>
          <div class="server-autopilot-grid">
            <article>
              <span>Job</span>
              <strong>{{ serverAutopilotStatus?.jobId || 'Not found' }}</strong>
            </article>
            <article>
              <span>State</span>
              <strong>{{ serverAutopilotStatus?.enabled ? (serverAutopilotStatus.state || 'enabled') : 'disabled / unknown' }}</strong>
            </article>
            <article>
              <span>Latest output</span>
              <strong>{{ serverAutopilotStatus?.latestOutputAt ? formatTimestamp(serverAutopilotStatus.latestOutputAt) : 'No output yet' }}</strong>
            </article>
            <article>
              <span>Readable outputs</span>
              <strong>{{ serverAutopilotStatus?.outputCount ?? 0 }}</strong>
            </article>
            <article>
              <span>Imported runs</span>
              <strong>{{ serverAutopilotStatus?.importedRunCount ?? 0 }}</strong>
            </article>
            <article>
              <span>Skipped outputs</span>
              <strong>{{ serverAutopilotStatus?.skippedRunCount ?? 0 }}</strong>
            </article>
            <article>
              <span>Latest imported</span>
              <strong>{{ serverAutopilotStatus?.latestOutputImported ? 'Yes' : 'No / pending' }}</strong>
            </article>
            <article>
              <span>Latest skipped</span>
              <strong>{{ serverAutopilotStatus?.latestOutputSkipped ? 'Yes' : 'No' }}</strong>
            </article>
            <article>
              <span>Parse status</span>
              <strong>{{ serverAutopilotStatus?.latestOutputParseStatus || 'none' }}</strong>
            </article>
            <article>
              <span>Candidate items</span>
              <strong>{{ serverAutopilotStatus?.latestOutputCandidateCount ?? 0 }}</strong>
            </article>
            <article>
              <span>Due slot</span>
              <strong>{{ serverAutopilotStatus?.latestDueSlotAt ? formatTimestamp(serverAutopilotStatus.latestDueSlotAt) : 'Waiting' }}</strong>
            </article>
            <article>
              <span>Due satisfied</span>
              <strong>{{ serverAutopilotStatus?.latestDueSlotSatisfied ? 'Yes' : 'Auto-kick pending' }}</strong>
            </article>
            <article>
              <span>Last server kick</span>
              <strong>{{ serverAutopilotStatus?.latestDueSlotAttemptedAt ? formatTimestamp(serverAutopilotStatus.latestDueSlotAttemptedAt) : 'Not needed yet' }}</strong>
            </article>
            <article>
              <span>Dashboard records</span>
              <strong>{{ serverAutopilotStatus?.dashboardRecordCount ?? importedIntelligenceTotal }}</strong>
            </article>
            <article>
              <span>Needs review</span>
              <strong>{{ serverAutopilotStatus?.pendingReviewCount ?? intelligence.pendingResearchFindings.value.length }}</strong>
            </article>
          </div>
          <small v-if="serverAutopilotStatus?.latestOutputFile">
            Latest file: {{ serverAutopilotStatus.latestOutputFile }}
          </small>
        </div>
        <div class="imported-intelligence-panel" aria-label="Live imported dashboard intelligence">
          <div class="imported-intelligence-header">
            <div>
              <p class="eyebrow">Live imported intelligence</p>
              <h4>Automatic dashboard filling status</h4>
            </div>
            <div class="imported-total">
              <strong>{{ importedIntelligenceTotal }}</strong>
              <span>records</span>
            </div>
          </div>
          <p class="imported-intelligence-note">
            {{ importedIntelligenceStatus }}
            <span>Last durable load/save: {{ formatTimestamp(durableStateTimestamp) }}</span>
          </p>
          <div class="imported-intelligence-grid">
            <RouterLink
              v-for="row in importedIntelligenceRows"
              :key="row.label"
              class="imported-intelligence-row"
              :to="row.route"
            >
              <span>{{ row.label }}</span>
              <strong>{{ row.count }}</strong>
              <small>{{ row.note }}</small>
            </RouterLink>
          </div>
        </div>
        <ul class="autopilot-rule-list">
          <li>Researches official, company, regulatory, trade, supplier, price-reference, and uploaded evidence sources.</li>
          <li>Runs on the existing Hermes Jobs scheduler at 07:00 and 19:00; no separate database or backend migration is required.</li>
          <li>Fills only source-backed/API/internal-safe fields automatically; unsupported values stay in source review.</li>
          <li>Supplier prices, quality, reliability, payment terms, IRR, market size, growth, market share, regulatory status, and investor claims are auto-staged for review unless source policy allows safe filling.</li>
        </ul>
        <div class="coverage-map" aria-label="Full dashboard autopilot coverage map">
          <div class="coverage-map-header">
            <h4>What Hermes can fill automatically</h4>
            <span>official-first / review critical</span>
          </div>
          <div class="coverage-row head">
            <span>Dashboard area</span>
            <span>Auto-filled or hydrated when source-backed</span>
            <span>Review-gated / protected</span>
            <span>Coverage audit</span>
          </div>
          <div v-for="row in coverageRows" :key="row.area" class="coverage-row" :class="row.status">
            <strong>{{ row.area }}</strong>
            <span>{{ row.fills }}</span>
            <span>{{ row.review }}</span>
            <span class="coverage-audit-cell">
              <b>{{ row.coveredCount }}/{{ row.totalTargets }} targets covered</b>
              <small v-if="row.missingTargets.length">
                Missing targets: {{ row.missingTargets.map(item => item.label).join(', ') }}
              </small>
              <small v-else>All required targets have imported evidence or review items.</small>
            </span>
          </div>
        </div>
        <div class="full-autopilot-actions">
          <NButton type="primary" :loading="fullAutopilotSaving" @click="enableFullDashboardAutopilot">Repair Autopilot Schedule</NButton>
          <NButton secondary :loading="fullAutopilotSaving" @click="runFullDashboardSnapshotNow">Create Source Snapshot</NButton>
          <NButton tertiary :loading="importingLatestOutput" @click="importLatestDashboardResearchOutput(true)">Import Latest Output</NButton>
          <NButton
            secondary
            :loading="runningMissingCoverageResearch"
            :disabled="missingCoverageTargetCount === 0"
            @click="() => runMissingCoverageResearch()"
          >
            Research Missing Coverage
          </NButton>
        </div>
      </details>
      <p class="autopilot-status-note">
        {{ fullAutopilotStatus.lastStatus }}
        <span v-if="fullAutopilotStatus.scheduledJobId"> Job: {{ fullAutopilotStatus.scheduledJobId }}</span>
        <span v-if="missingCoverageTargetCount"> Missing coverage targets: {{ missingCoverageTargetCount }}</span>
      </p>
    </section>

    <details class="advanced-disclosure discovery-root-disclosure" open>
      <summary>
        <span>Trusted source discovery roots</span>
        <small>{{ sourceDiscoveryRootCount }} roots across {{ sourceDiscoveryGroupCount }} groups + {{ sourceUrlCandidateCount }} URL-backed candidates; not automatic facts.</small>
      </summary>
      <section class="discovery-root-panel" aria-label="Trusted source discovery root registry">
        <div class="discovery-root-intro">
          <div>
            <p class="eyebrow">Source registry seed</p>
            <h3>Hermes starts research from these trusted roots</h3>
            <p>
              These are root sources for automatic discovery. Hermes must still extract a concrete source title,
              URL/date, confidence score, evidence status, and review decision before any dashboard field is filled.
              Sources discovered outside this list enter as Candidate Source / To Verify.
            </p>
          </div>
          <div class="discovery-root-count">
            <strong>{{ sourceDiscoveryRootCount }}</strong>
            <span>source roots</span>
          </div>
        </div>
        <section class="source-url-candidate-panel" aria-label="Batch 2 URL-backed trusted source candidates">
          <div class="source-url-candidate-header">
            <div>
              <p class="eyebrow">Batch 2 source catalog</p>
              <h3>URL-backed official source candidates</h3>
              <p>
                The new batch adds concrete official API and source URLs for country indicators and HS-code trade checks.
                These rows help Hermes research faster, but they do not become verified dashboard facts until fetched,
                parsed, source-scored, and accepted by the field-level review policy.
              </p>
            </div>
            <div class="source-url-candidate-stats" aria-label="Batch 2 source candidate stats">
              <span><strong>{{ sourceUrlCandidateCount }}</strong> candidates</span>
              <span><strong>{{ sourceUrlCandidateCountryCount }}</strong> countries</span>
              <span><strong>{{ sourceUrlCandidateIndicatorCount }}</strong> indicators</span>
              <span><strong>{{ sourceUrlCandidateHsCodeCount }}</strong> HS families</span>
            </div>
          </div>
          <div class="source-url-provider-grid">
            <article v-for="provider in sourceUrlCandidateProviders" :key="provider.provider" class="source-url-provider-card">
              <div class="discovery-root-card-header">
                <h4>{{ provider.provider }}</h4>
                <span>{{ provider.source_count }} candidates</span>
              </div>
              <div class="discovery-root-meta">
                <span>{{ provider.trust_tier }}</span>
                <span>{{ provider.connector_type }}</span>
                <span>{{ provider.confidence_default }} confidence</span>
                <span>{{ provider.requires_review ? 'review-gated' : 'auto-fetch candidate' }}</span>
              </div>
              <p>{{ provider.notes }}</p>
              <div class="source-url-example-list">
                <a
                  v-for="candidate in sourceUrlCandidateExamples(provider.provider)"
                  :key="candidate.source_id"
                  :href="candidate.url"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ candidate.source_id }} · {{ candidate.title }}
                </a>
                <em v-if="provider.source_count > sourceUrlCandidateExamples(provider.provider).length">+{{ provider.source_count - sourceUrlCandidateExamples(provider.provider).length }} more URL-backed candidates</em>
              </div>
            </article>
          </div>
        </section>
        <div class="discovery-root-grid">
          <article v-for="root in sourceDiscoveryRoots" :key="root.root_id" class="discovery-root-card">
            <div class="discovery-root-card-header">
              <h4>{{ root.title }}</h4>
              <span>{{ root.source_count }} roots</span>
            </div>
            <div class="discovery-root-meta">
              <span>{{ root.trust_tier }}</span>
              <span>{{ root.connector_type }}</span>
              <span>{{ root.confidence_default }} confidence</span>
              <span>{{ root.requires_review ? 'review-gated' : 'official-first' }}</span>
            </div>
            <p>{{ root.notes }}</p>
            <div class="discovery-root-examples">
              <span v-for="sourceName in sourceDiscoveryExamples(root)" :key="sourceName">{{ sourceName }}</span>
              <em v-if="root.source_count > sourceDiscoveryExamples(root).length">+{{ root.source_count - sourceDiscoveryExamples(root).length }} more</em>
            </div>
          </article>
        </div>
      </section>
    </details>

    <details class="advanced-disclosure source-registry-disclosure">
      <summary>
        <span>Advanced source registry</span>
        <small>Add, classify, or disable individual sources when the automatic policy needs tuning.</small>
      </summary>
      <section class="source-form">
        <h3>Add Source</h3>
        <label>Name<input v-model="form.name" type="text" placeholder="Official agency, company, supplier, source portal" /></label>
        <label>Domain<input v-model="form.domain" type="text" placeholder="example.gov.cn or supplier evidence" /></label>
        <label>Tier<NSelect v-model:value="form.tier" :options="tierOptions" /></label>
        <label>Data type<NSelect v-model:value="form.dataType" :options="dataTypeOptions" /></label>
        <label class="wide">Notes<textarea v-model="form.notes" rows="3" placeholder="What fields this source can update and any limitations"></textarea></label>
        <NButton type="primary" @click="addSource">Add Source</NButton>
      </section>

      <section class="source-groups">
        <article v-for="(sources, key) in groupedSources" :key="key" class="source-group">
          <div class="source-group-header">
            <h3>{{ sourceGroupLabel(key) }}</h3>
            <span>{{ sources.length }} sources</span>
          </div>
          <div v-for="source in sources" :key="source.source_id" class="source-row">
            <div>
              <strong>{{ source.name }}</strong>
              <span class="source-domain">{{ source.domain }}</span>
              <div class="source-meta" aria-label="Source connector metadata">
                <span>Connector: {{ source.connector_type }}</span>
                <span>Frequency: {{ source.update_frequency }}</span>
                <span>Confidence: {{ source.confidence_default }}</span>
                <span>Auto Update: {{ source.auto_update_allowed ? 'Allowed' : 'Review only' }}</span>
              </div>
              <span>{{ source.data_types_supported.join(', ') }}</span>
              <small>{{ source.notes }}</small>
              <small>Last checked: {{ source.last_checked || 'Never' }} / Failure: {{ source.last_failure || 'None' }}</small>
            </div>
            <NSwitch
              :value="source.enabled"
              @update:value="value => autopilot.updateSource(source.source_id, { enabled: value })"
            />
          </div>
        </article>
      </section>
    </details>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.trusted-sources-view {
  min-height: var(--app-content-height, 100%);
  padding: 18px;
  background: $bg-primary;
  color: $text-primary;
}

.sources-header,
.source-permission-panel,
.full-autopilot-panel,
.source-form,
.source-group,
.easy-autopilot-panel,
.autopilot-command-strip,
.advanced-disclosure {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
}

.sources-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: 16px;
  margin-bottom: 12px;
  padding: 18px;

  h2 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
  }
}

.eyebrow,
.summary-card span,
.summary-card small {
  color: $text-muted;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.summary-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.08);

  strong {
    color: $accent-primary;
    font-size: 26px;
  }
}

.easy-autopilot-panel {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(320px, 1.1fr);
  gap: 14px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-info-rgb), 0.34);
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.12), rgba(var(--accent-primary-rgb), 0.08) 52%, transparent),
    $bg-card;

  &.active {
    border-color: rgba(var(--success-rgb), 0.32);
    background:
      linear-gradient(135deg, rgba(var(--success-rgb), 0.1), rgba(var(--accent-info-rgb), 0.06) 52%, transparent),
      $bg-card;
  }

  &.review {
    border-color: rgba(var(--warning-rgb), 0.42);
    background:
      linear-gradient(135deg, rgba(var(--warning-rgb), 0.12), rgba(var(--accent-primary-rgb), 0.07) 52%, transparent),
      $bg-card;
  }

  &.warning {
    border-color: rgba(var(--danger-rgb), 0.38);
    background:
      linear-gradient(135deg, rgba(var(--danger-rgb), 0.1), rgba(var(--accent-info-rgb), 0.05) 52%, transparent),
      $bg-card;
  }
}

.easy-autopilot-main {
  display: grid;
  gap: 10px;
  align-content: start;

  h3,
  p,
  strong {
    margin: 0;
  }

  h3 {
    color: $warning;
    font-size: 21px;
  }

  p {
    color: $text-secondary;
    line-height: 1.55;
  }

  strong {
    color: $text-primary;
    line-height: 1.45;
  }
}

.easy-status-line {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 3px 9px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
    border-radius: 999px;
    background: rgba(var(--accent-primary-rgb), 0.08);
    color: $accent-primary;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    white-space: nowrap;
  }
}

.easy-autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-top: 2px;
}

.easy-workflow-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 7px;
    min-height: 132px;
    padding: 12px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.22);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.12);
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-info;
    font-size: 16px;
    line-height: 1.25;
  }

  small {
    color: $text-secondary;
    line-height: 1.45;
  }
}

.autopilot-command-strip {
  display: grid;
  gap: 14px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-primary-rgb), 0.42);
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.13), rgba(var(--accent-info-rgb), 0.07) 42%, transparent),
    $bg-card;
}

.command-strip-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: start;

  h3,
  p {
    margin: 0;
  }

  h3 {
    color: $warning;
    font-size: 20px;
  }

  p {
    margin-top: 7px;
    color: $text-secondary;
    line-height: 1.5;
  }
}

.command-strip-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.command-strip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;

  article {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    min-height: 126px;
    padding: 12px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.2);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.14);

    &.active {
      border-color: rgba(var(--success-rgb), 0.34);
    }

    &.review {
      border-color: rgba(var(--warning-rgb), 0.42);
      background: rgba(var(--warning-rgb), 0.06);
    }

    &.setup {
      border-color: rgba(var(--accent-info-rgb), 0.3);
    }
  }

  small {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    display: block;
    margin-top: 4px;
    color: $accent-info;
    font-size: 22px;
    line-height: 1.2;
  }

  em {
    display: block;
    margin-top: 6px;
    color: $text-secondary;
    font-style: normal;
    line-height: 1.42;
  }
}

.command-card-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  font-size: 18px;
}

.advanced-disclosure {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
  padding: 0;

  &[open] {
    padding-bottom: 12px;
  }

  > summary {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    padding: 12px 14px;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &::after {
      content: '+';
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border: 1px solid rgba(var(--accent-info-rgb), 0.34);
      border-radius: 999px;
      color: $accent-info;
      font-weight: 900;
      flex: 0 0 auto;
    }

    span {
      color: $warning;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    small {
      color: $text-muted;
      line-height: 1.35;
      text-align: right;
    }
  }

  &[open] > summary::after {
    content: '-';
  }
}

.discovery-root-panel {
  display: grid;
  gap: 12px;
  margin: 0 12px 12px;
}

.discovery-root-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.06);

  h3,
  p {
    margin: 0;
  }

  h3 {
    color: $warning;
  }

  p {
    color: $text-secondary;
    line-height: 1.55;
  }
}

.discovery-root-count {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.08);

  strong {
    color: $accent-info;
    font-size: 30px;
    line-height: 1;
  }

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.source-url-candidate-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(var(--accent-success-rgb), 0.26);
  border-radius: 8px;
  background: rgba(var(--accent-success-rgb), 0.045);
}

.source-url-candidate-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 320px);
  gap: 14px;
  align-items: start;

  h3,
  p {
    margin: 0;
  }

  h3 {
    color: $warning;
  }

  p {
    color: $text-secondary;
    line-height: 1.55;
  }
}

.source-url-candidate-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  span {
    display: grid;
    gap: 3px;
    min-height: 64px;
    align-content: center;
    padding: 10px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.2);
    border-radius: 8px;
    background: rgba(var(--accent-info-rgb), 0.055);
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-info;
    font-size: 22px;
    line-height: 1;
  }
}

.source-url-provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.source-url-provider-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-secondary;

  h4,
  p {
    margin: 0;
  }

  h4 {
    color: $warning;
    font-size: 14px;
  }

  p {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.source-url-example-list {
  display: grid;
  gap: 6px;

  a,
  em {
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.18);
    border-radius: 6px;
    background: rgba(var(--accent-info-rgb), 0.045);
    color: $text-secondary;
    font-size: 11px;
    font-style: normal;
    line-height: 1.35;
    overflow-wrap: anywhere;
    text-decoration: none;
  }

  a:hover {
    color: $accent-info;
  }

  em {
    color: $accent-info;
    font-weight: 900;
  }
}

.discovery-root-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.discovery-root-card {
  display: grid;
  gap: 10px;
  align-content: start;
  min-width: 0;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-secondary;

  h4,
  p {
    margin: 0;
  }

  h4 {
    color: $warning;
    font-size: 14px;
  }

  p {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.discovery-root-card-header {
  display: flex;
  gap: 10px;
  align-items: start;
  justify-content: space-between;

  span {
    flex: 0 0 auto;
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
  }
}

.discovery-root-meta,
.discovery-root-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.discovery-root-meta span,
.discovery-root-examples span,
.discovery-root-examples em {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.22);
  border-radius: 999px;
  background: rgba(var(--accent-info-rgb), 0.06);
  color: $text-secondary;
  font-size: 11px;
  font-style: normal;
  overflow-wrap: anywhere;
}

.discovery-root-examples em {
  color: $accent-info;
  font-weight: 900;
}

.autopilot-details {
  margin: 0;
  background: rgba(0, 0, 0, 0.08);
}

.source-registry-disclosure {
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.055), transparent 54%),
    $bg-card;
}

.source-permission-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.75fr);
  gap: 16px;
  margin: 0 12px;
  padding: 16px;
  border-color: rgba(var(--accent-info-rgb), 0.32);
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.1), transparent 46%),
    $bg-card;

  h3 {
    margin: 0;
    color: $accent-info;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.permission-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-content: start;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 3px 8px;
    border: 1px solid rgba(var(--warning-rgb), 0.36);
    border-radius: 999px;
    background: rgba(var(--warning-rgb), 0.08);
    color: $warning;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.permission-rule-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: 9px 10px;
    border: 1px solid $border-color;
    border-radius: 7px;
    background: $bg-secondary;
    color: $text-secondary;
    line-height: 1.45;
  }
}

.policy-tier-strip {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 7px;

  span {
    padding: 8px 9px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.26);
    border-radius: 6px;
    background: rgba(var(--accent-primary-rgb), 0.055);
    color: $warning;
    font-size: 11px;
    font-weight: 850;
  }
}

.full-autopilot-panel {
  display: grid;
  gap: 14px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-primary-rgb), 0.42);
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.14), rgba(var(--accent-info-rgb), 0.05) 46%, transparent),
    $bg-card;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.full-autopilot-copy {
  max-width: 980px;
}

.full-autopilot-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
    border-radius: 8px;
    background: rgba(var(--accent-primary-rgb), 0.07);
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }
}

.full-autopilot-command {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.065);

  &.active {
    border-color: rgba(var(--success-rgb), 0.3);
    background: rgba(var(--success-rgb), 0.07);
  }

  &.review {
    border-color: rgba(var(--warning-rgb), 0.38);
    background: rgba(var(--warning-rgb), 0.08);
  }

  &.warning {
    border-color: rgba(var(--danger-rgb), 0.34);
    background: rgba(var(--danger-rgb), 0.06);
  }

  div {
    display: grid;
    gap: 5px;
  }

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $text-primary;
    font-size: 14px;
    line-height: 1.45;
  }
}

.autopilot-daily-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 7px;
    min-height: 118px;
    padding: 12px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.24);
    border-radius: 8px;
    background:
      linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.08), transparent 65%),
      $bg-secondary;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 17px;
    line-height: 1.2;
  }

  small {
    color: $text-secondary;
    line-height: 1.4;
  }
}

.autopilot-primary-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.server-autopilot-status {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.055);

  &.active {
    border-color: rgba(var(--success-rgb), 0.28);
    background: rgba(var(--success-rgb), 0.055);
  }

  &.review {
    border-color: rgba(var(--warning-rgb), 0.38);
    background: rgba(var(--warning-rgb), 0.075);
  }

  &.warning {
    border-color: rgba(var(--danger-rgb), 0.34);
    background: rgba(var(--danger-rgb), 0.06);
  }

  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 850;
  }
}

.server-autopilot-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 2px 0 0;
    color: $accent-info;
    font-size: 15px;
  }
}

.server-autopilot-message {
  margin: 0;
  color: $text-secondary;
  line-height: 1.45;
}

.server-autopilot-issues {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: grid;
    grid-template-columns: minmax(96px, 0.24fr) minmax(0, 1fr);
    gap: 9px;
    align-items: start;
    padding: 8px;
    border: 1px solid rgba(var(--danger-rgb), 0.22);
    border-radius: 7px;
    background: rgba(var(--danger-rgb), 0.055);
  }

  span {
    color: $warning;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    overflow-wrap: anywhere;
    color: $text-primary;
    font-size: 12px;
    line-height: 1.38;
  }
}

.server-autopilot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    gap: 5px;
    min-height: 72px;
    padding: 9px;
    border: 1px solid $border-color;
    border-radius: 7px;
    background: $bg-secondary;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    overflow-wrap: anywhere;
    color: $text-primary;
    font-size: 13px;
    line-height: 1.35;
  }
}

.imported-intelligence-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.08), transparent 55%),
    rgba(0, 0, 0, 0.08);
}

.imported-intelligence-header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 2px 0 0;
    color: $accent-info;
    font-size: 15px;
  }
}

.imported-total {
  display: grid;
  min-width: 86px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
  border-radius: 7px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  text-align: right;

  strong {
    color: $accent-primary;
    font-size: 24px;
    line-height: 1;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.imported-intelligence-note {
  display: grid;
  gap: 4px;
  margin: 0;
  color: $text-secondary;
  line-height: 1.45;

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 850;
  }
}

.imported-intelligence-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.imported-intelligence-row {
  display: grid;
  gap: 6px;
  min-height: 112px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;
  color: inherit;
  text-decoration: none;
  transition: border-color 0.18s ease, transform 0.18s ease;

  &:hover {
    border-color: rgba(var(--accent-info-rgb), 0.5);
    transform: translateY(-1px);
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $warning;
    font-size: 24px;
    line-height: 1;
  }

  small {
    color: $text-secondary;
    line-height: 1.35;
  }
}

.autopilot-rule-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: 9px 10px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.22);
    border-radius: 7px;
    background: rgba(var(--accent-info-rgb), 0.06);
    color: $text-secondary;
    line-height: 1.45;
  }
}

.full-autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.autopilot-link {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.3);
  border-radius: 7px;
  background: rgba(var(--accent-info-rgb), 0.06);
  color: $accent-info;
  font-weight: 800;
  text-decoration: none;

  &.primary {
    border-color: rgba(var(--accent-primary-rgb), 0.45);
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: $warning;
  }
}

.autopilot-status-note {
  margin: 0 !important;
  color: $warning !important;
}

.coverage-map {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.26);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.08);
  overflow-x: auto;
}

.coverage-map-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 0;
    color: $warning;
    font-size: 14px;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.coverage-row {
  display: grid;
  grid-template-columns: minmax(160px, 0.75fr) minmax(240px, 1fr) minmax(260px, 1.05fr) minmax(280px, 1.1fr);
  gap: 10px;
  min-width: 1100px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  &.covered {
    border-color: rgba($success, 0.35);
  }

  &.partial {
    border-color: rgba($warning, 0.35);
  }

  &.missing {
    border-color: rgba($error, 0.34);
  }

  &.head {
    border-color: rgba(var(--accent-primary-rgb), 0.34);
    background: rgba(var(--accent-primary-rgb), 0.07);
    color: $warning;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-info;
  }

  span {
    color: $text-secondary;
    line-height: 1.45;
  }
}

.coverage-audit-cell {
  display: grid;
  gap: 5px;

  b {
    color: $accent-info;
    font-size: 12px;
  }

  small {
    color: $text-muted;
    line-height: 1.45;
  }
}

.source-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
  margin: 0 12px 12px;
  padding: 14px;

  h3 {
    grid-column: 1 / -1;
    margin: 0;
    color: $warning;
  }

  label {
    display: grid;
    gap: 5px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .wide {
    grid-column: span 2;
  }

  input,
  textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-secondary;
    color: $text-primary;
    padding: 8px;
  }
}

.source-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  margin: 0 12px;
}

.source-group {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 14px;

  h3 {
    margin: 0;
    color: $warning;
  }
}

.source-group-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.source-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  span,
  small {
    color: $text-secondary;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
}

.source-domain {
  color: $accent-info !important;
  font-weight: 800;
}

.source-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid $border-color;
    border-radius: 999px;
    background: rgba(var(--accent-info-rgb), 0.07);
    color: $text-secondary;
    font-size: 11px;
    font-weight: 800;
  }
}

@media (max-width: 760px) {
  .trusted-sources-view {
    padding: 12px;
  }

  .sources-header,
  .easy-autopilot-panel,
  .command-strip-header,
  .discovery-root-intro,
  .source-url-candidate-header,
  .source-permission-panel,
  .source-form {
    grid-template-columns: 1fr;
  }

  .easy-status-line,
  .advanced-disclosure > summary {
    display: grid;
    justify-items: start;
  }

  .advanced-disclosure > summary small {
    text-align: left;
  }

  .command-strip-actions {
    justify-content: flex-start;
  }

  .command-strip-grid {
    grid-template-columns: 1fr;

    article {
      min-height: 0;
    }
  }

  .easy-workflow-grid {
    grid-template-columns: 1fr;

    article {
      min-height: 0;
    }
  }

  .autopilot-daily-strip {
    grid-template-columns: 1fr;

    article {
      min-height: 0;
    }
  }

  .source-permission-panel,
  .discovery-root-panel,
  .source-form,
  .source-groups {
    margin-right: 10px;
    margin-left: 10px;
  }

  .source-form .wide {
    grid-column: auto;
  }

  .coverage-map {
    overflow-x: visible;
  }

  .coverage-map-header {
    display: grid;
    justify-items: start;
  }

  .coverage-row {
    grid-template-columns: 1fr;
    min-width: 0;
  }

  .imported-intelligence-header {
    display: grid;
    justify-items: start;
  }

  .imported-total {
    min-width: 0;
    text-align: left;
  }

  .imported-intelligence-grid {
    grid-template-columns: 1fr;
  }

  .imported-intelligence-row {
    min-height: 0;
  }

  .server-autopilot-header {
    display: grid;
    justify-items: start;
  }

  .server-autopilot-grid {
    grid-template-columns: 1fr;

    article {
      min-height: 0;
    }
  }

  .server-autopilot-issues li {
    grid-template-columns: 1fr;
  }
}
</style>
