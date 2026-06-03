<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import { fetchPerformanceRuntime, type PerformanceRuntimeSnapshot } from '@/api/hermes/performance-monitor'
import { fetchSessions, type SessionSummary } from '@/api/hermes/sessions'
import { listJobs, type Job } from '@/api/hermes/jobs'
import {
  fetchDashboardAutopilotImportStatus,
  type DashboardAutopilotImportStatus,
} from '@/api/hermes/intelligence-state'
import { getActiveProfileName, hasApiKey } from '@/api/client'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { useAppStore } from '@/stores/hermes/app'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import PinnedExecutiveIntelligenceBoard from '@/components/intelligence/PinnedExecutiveIntelligenceBoard.vue'
import {
  listRecentCaptureActivities,
  type SessionCaptureActivity,
} from '@/composables/useSessionCapture'
import {
  buildInvestorNextActions,
  isPresentationMaterialAllowed,
  type InvestorNextAction,
  type PresentationMaterial,
} from '@/utils/investorIntelligence'
import { canAccessRouteName, getFrontendAccessRole, type FrontendAccessRole } from '@/utils/accessControl'
import {
  buildDashboardCoverageRows,
  missingDashboardCoverageTargetCount,
} from '@/utils/dashboardCoverage'

const appStore = useAppStore()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const message = useMessage()

const loading = ref(false)
const loadWarning = ref('')
const sessions = ref<SessionSummary[]>([])
const jobs = ref<Job[]>([])
const runtime = ref<PerformanceRuntimeSnapshot | null>(null)
const autopilotImportStatus = ref<DashboardAutopilotImportStatus | null>(null)
const recentCaptureActivities = ref<SessionCaptureActivity[]>([])
const tokenReady = ref(false)
const activeProfileName = ref('default')
const lastUpdated = ref('')
const creatingActionTaskId = ref('')
const frontendRole = computed(() => getFrontendAccessRole())
const isOwnerHome = computed(() => frontendRole.value === 'owner')
const isDeveloperHome = computed(() => frontendRole.value === 'developer_admin')
const isLimitedBusinessHome = computed(() =>
  ['employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'].includes(frontendRole.value)
)

const enabledJobs = computed(() => jobs.value.filter(job => job.enabled).length)
const activeSessions = computed(() => runtime.value?.sessions.active ?? sessions.value.length)
const runningSessions = computed(() => runtime.value?.sessions.running ?? 0)
const workerCount = computed(() => runtime.value?.bridge.workers.length ?? 0)
const runningWorkers = computed(() => runtime.value?.bridge.workers.filter(worker => worker.running).length ?? 0)
const providerCount = computed(() => appStore.modelGroups.length)
const selectedModelLabel = computed(() => {
  if (!appStore.selectedModel) return 'Not selected'
  return appStore.displayModelName(appStore.selectedModel, appStore.selectedProvider)
})
const bridgeOnline = computed(() => !!runtime.value?.bridge.reachable)
const apiStatusLabel = computed(() => appStore.connected ? 'API Online' : 'API Offline')
const bridgeStatusLabel = computed(() => {
  if (!tokenReady.value) return 'Token Required'
  if (!runtime.value) return 'Checking'
  return bridgeOnline.value ? 'Bridge Ready' : 'Bridge Offline'
})

const statusBadges = computed(() => [
  { label: apiStatusLabel.value, tone: appStore.connected ? 'ok' : 'danger' },
  { label: bridgeStatusLabel.value, tone: bridgeOnline.value ? 'ok' : tokenReady.value ? 'warn' : 'muted' },
  { label: `Profile ${activeProfileName.value}`, tone: 'info' },
  { label: tokenReady.value ? 'Token Active' : 'Token Missing', tone: tokenReady.value ? 'ok' : 'warn' },
])

const kpis = computed(() => [
  {
    label: 'Active Sessions',
    value: String(activeSessions.value),
    note: `${runningSessions.value} running`,
    tone: runningSessions.value > 0 ? 'ok' : 'info',
  },
  {
    label: 'Scheduled Jobs',
    value: String(enabledJobs.value),
    note: `${jobs.value.length} total`,
    tone: enabledJobs.value > 0 ? 'ok' : 'muted',
  },
  {
    label: 'Model Providers',
    value: String(providerCount.value),
    note: selectedModelLabel.value,
    tone: providerCount.value > 0 ? 'info' : 'warn',
  },
  {
    label: 'Workers',
    value: `${runningWorkers.value}/${workerCount.value}`,
    note: bridgeOnline.value ? 'broker reachable' : 'broker pending',
    tone: bridgeOnline.value ? 'ok' : 'warn',
  },
])

type DashboardRouteTarget = { name: string }

function canUseRouteName(routeName: string): boolean {
  return canAccessRouteName(routeName, frontendRole.value)
}

function canUseRouteTarget(to: DashboardRouteTarget): boolean {
  return canUseRouteName(to.name)
}

const investorSnapshot = computed(() => [
  {
    label: 'Investor Readiness',
    value: `${intelligence.readinessScore.value}%`,
    note: 'Evidence-status score',
    tone: intelligence.readinessScore.value >= 70 ? 'ok' : intelligence.readinessScore.value >= 35 ? 'warn' : 'danger',
    to: { name: 'hermes.investorReadiness' },
  },
  {
    label: 'Evidence Gaps',
    value: String(intelligence.evidenceGaps.value.length),
    note: 'Missing / To Verify',
    tone: intelligence.evidenceGaps.value.length > 0 ? 'warn' : 'ok',
    to: { name: 'hermes.investorReadiness' },
  },
  {
    label: 'Investor Risks',
    value: String(intelligence.riskRegisterItems.value.length),
    note: 'Live risk register',
    tone: intelligence.riskRegisterItems.value.length > 0 ? 'danger' : 'ok',
    to: { name: 'hermes.investorReadiness' },
  },
  {
    label: 'Research Jobs',
    value: String(intelligence.state.value.researchJobs.length),
    note: 'Created from intelligence pages',
    tone: intelligence.state.value.researchJobs.length > 0 ? 'info' : 'muted',
    to: { name: 'hermes.researchResultReview' },
  },
  {
    label: 'Captured Sessions',
    value: String(recentCaptureActivities.value.length),
    note: 'Approved capture activity',
    tone: recentCaptureActivities.value.length > 0 ? 'info' : 'muted',
    to: { name: 'hermes.history' },
  },
  {
    label: 'Financial Model',
    value: intelligence.latestFinancialModel.value?.scenarioName || 'None',
    note: intelligence.latestFinancialModel.value?.evidenceStatus || 'No saved snapshot',
    tone: intelligence.latestFinancialModel.value ? 'info' : 'warn',
    to: { name: 'hermes.investmentCalculator' },
  },
  {
    label: 'Deck Materials',
    value: String(intelligence.approvedPresentationCount.value),
    note: 'Approved for draft only',
    tone: intelligence.approvedPresentationCount.value > 0 ? 'info' : 'muted',
    to: { name: 'hermes.investorPresentation' },
  },
].filter(item => canUseRouteTarget(item.to)))

const nextBestActions = computed(() =>
  buildInvestorNextActions(intelligence.state.value)
    .filter(action => canUseRouteName(action.routeName))
)
const todayPriority = computed(() => nextBestActions.value[0] || null)
const topEvidenceGaps = computed(() => intelligence.evidenceGaps.value.slice(0, 4))
const visibleTopEvidenceGaps = computed(() =>
  topEvidenceGaps.value.filter(gap => canUseRouteName(evidenceGapRouteName(gap.id)))
)
const topInvestorRisks = computed(() => intelligence.riskRegisterItems.value.slice(0, 4))
const visibleTopInvestorRisks = computed(() =>
  topInvestorRisks.value.filter(risk => canUseRouteName(risk.routeName))
)
const pendingReviewItems = computed(() =>
  intelligence.state.value.researchFindings
    .filter(item => item.status === 'Pending Review' || item.status === 'To Verify')
    .slice(0, 4),
)
const openResearchJobs = computed(() =>
  intelligence.state.value.researchJobs
    .filter(job => job.status === 'Task Created' || job.status === 'Manual Research Job')
    .slice(0, 4),
)
const latestFinancialSnapshot = intelligence.latestFinancialModel
const deckMaterialsNeedingEvidence = computed(() =>
  intelligence.state.value.presentationMaterials
    .filter(material => !isPresentationMaterialAllowed(material))
    .slice(0, 4),
)

const canUseInvestorReadiness = computed(() => canUseRouteName('hermes.investorReadiness'))
const canUseResearchReview = computed(() => canUseRouteName('hermes.researchResultReview'))
const canUseInvestorPresentation = computed(() => canUseRouteName('hermes.investorPresentation'))
const canUseInvestmentCalculator = computed(() => canUseRouteName('hermes.investmentCalculator'))
const showFinancialDeckPanel = computed(() => canUseInvestorPresentation.value || canUseInvestmentCalculator.value)
const importedDashboardRecordCount = computed(() =>
  intelligence.state.value.marketClaims.length +
  intelligence.state.value.competitors.length +
  intelligence.state.value.dataRoomSources.length
)
const autopilotReviewQueueCount = computed(() =>
  autopilotImportStatus.value?.pendingOutputCount || intelligence.pendingResearchFindings.value.length
)
const dashboardCoverageRows = computed(() => buildDashboardCoverageRows(intelligence.state.value))
const missingDashboardCoverageRows = computed(() =>
  dashboardCoverageRows.value
    .filter(row => row.missingTargets.length > 0)
    .sort((a, b) => b.missingTargets.length - a.missingTargets.length)
)
const missingDashboardCoverageCount = computed(() => missingDashboardCoverageTargetCount(missingDashboardCoverageRows.value))
const topMissingDashboardCoverageRows = computed(() => missingDashboardCoverageRows.value.slice(0, 3))
const automaticResearchState = computed(() => {
  const status = autopilotImportStatus.value
  const reviewCount = autopilotReviewQueueCount.value
  if (!status) {
    return {
      tone: 'info',
      label: 'Checking',
      title: 'Automatic research status is loading',
      body: 'Hermes is checking the trusted-source schedule and imported dashboard intelligence.',
      action: 'Refresh Home if this remains unavailable.',
    }
  }
  if (status.jobCount === 0) {
    return {
      tone: 'warn',
      label: 'Auto-starting',
      title: 'Hermes is setting up automatic research',
      body: 'Owner sessions automatically check and create the twice-daily trusted-source research job. No manual searching is needed.',
      action: 'No manual searching needed. Hermes will keep trying to connect the source job; use Autopilot Status only for troubleshooting.',
    }
  }
  if (status.latestDueSlotRunError || ['unparseable', 'unreadable'].includes(status.latestOutputParseStatus)) {
    return {
      tone: 'danger',
      label: 'Needs attention',
      title: 'Automatic research needs a quick check',
      body: status.latestDueSlotRunError || status.latestOutputParseError || 'The latest Hermes output could not be imported safely.',
      action: 'Open Jobs or Trusted Sources to inspect the latest run.',
    }
  }
  if (reviewCount > 0) {
    return {
      tone: 'warn',
      label: `${reviewCount} to review`,
      title: 'Hermes found source-backed items for review',
      body: 'Safe fields can hydrate automatically. Critical market, supplier, finance, regulatory, and investor claims wait for owner approval.',
      action: 'No manual searching needed. Review what Hermes staged and approve only the evidence-backed items you trust.',
    }
  }
  if (status.importedRunCount > 0 || status.latestOutputImported) {
    return {
      tone: 'ok',
      label: 'Running',
      title: 'Automatic dashboard filling is active',
      body: 'Hermes is importing trusted-source records into the dashboard while keeping risky claims review-gated.',
      action: 'Use the dashboard normally. Hermes keeps researching missing coverage and you only approve staged claims.',
    }
  }
  return {
    tone: 'info',
    label: 'Waiting',
    title: 'Automatic research is scheduled',
    body: 'The Hermes research job exists. The dashboard is waiting for the first readable trusted-source output.',
    action: 'No manual copy-paste needed. Hermes will import readable source-backed output when the scheduled run finishes.',
  }
})
const automaticResearchCards = computed(() => [
  {
    label: 'Research job',
    value: autopilotImportStatus.value?.jobCount ? 'Scheduled' : 'Not confirmed',
    note: autopilotImportStatus.value?.latestDueSlotAt
      ? `Latest due slot ${formatAutopilotTimestamp(autopilotImportStatus.value.latestDueSlotAt)}`
      : 'Server checks every few minutes',
  },
  {
    label: 'Dashboard records',
    value: String(importedDashboardRecordCount.value),
    note: 'Imported from durable trusted-source intelligence state',
  },
  {
    label: 'Review queue',
    value: String(autopilotReviewQueueCount.value),
    note: 'Risky or weak claims wait here instead of becoming facts',
  },
  {
    label: 'Latest import',
    value: autopilotImportStatus.value?.latestOutputImported ? 'Imported' : autopilotImportStatus.value?.latestOutputParseStatus || 'None yet',
    note: autopilotImportStatus.value?.latestOutputAt
      ? formatAutopilotTimestamp(autopilotImportStatus.value.latestOutputAt)
      : 'No readable output imported yet',
  },
])

const automaticResearchPromiseCards = [
  {
    icon: '🌐',
    title: 'No manual web searching',
    detail: 'Hermes researches trusted online, official, company, supplier, and regulatory sources on the twice-daily schedule.',
  },
  {
    icon: '📥',
    title: 'Safe facts fill themselves',
    detail: 'Low-risk source-backed records hydrate the dashboard with source, date, confidence, and evidence labels.',
  },
  {
    icon: '🧾',
    title: 'Important claims wait for review',
    detail: 'Market size, prices, competitor share, IRR, regulatory status, and investor material stay staged until approved.',
  },
]

type AutopilotFlowState = 'done' | 'active' | 'waiting'

const automaticResearchFlow = computed(() => {
  const status = autopilotImportStatus.value
  const hasJob = !!status?.jobCount
  const hasImportedOutput = !!status?.importedRunCount || !!status?.latestOutputImported
  const hasDashboardRecords = importedDashboardRecordCount.value > 0
  const hasReviewItems = autopilotReviewQueueCount.value > 0
  const hasError = !!status?.latestDueSlotRunError || ['unparseable', 'unreadable'].includes(status?.latestOutputParseStatus || '')

  const state = (done: boolean, active: boolean): AutopilotFlowState => {
    if (done) return 'done'
    if (active) return 'active'
    return 'waiting'
  }

  return [
    {
      icon: '🔎',
      title: 'Research online',
      detail: hasJob
        ? 'Hermes is scheduled to search official, company, trade, and uploaded evidence sources twice daily.'
        : 'Hermes is checking and creating the twice-daily source search automatically for owner sessions.',
      state: state(hasJob && !hasError, !hasJob || hasError),
    },
    {
      icon: '🛡️',
      title: 'Review risky claims',
      detail: hasReviewItems
        ? `${autopilotReviewQueueCount.value} item${autopilotReviewQueueCount.value === 1 ? '' : 's'} need approval before they become business truth.`
        : 'Critical market, supplier, finance, regulatory, and investor claims stay review-gated.',
      state: state(hasImportedOutput && !hasReviewItems, hasReviewItems),
    },
    {
      icon: '✅',
      title: 'Fill safe fields',
      detail: hasDashboardRecords
        ? `${importedDashboardRecordCount.value} source-backed dashboard record${importedDashboardRecordCount.value === 1 ? '' : 's'} are available now.`
        : 'Low-risk official facts can auto-fill; unknowns remain Missing or To Verify.',
      state: state(hasDashboardRecords, hasImportedOutput && !hasDashboardRecords),
    },
    {
      icon: '📊',
      title: 'Use the dashboard',
      detail: 'Market, competitor, investment, sourcing, and review screens show source labels, confidence, and evidence status.',
      state: state(hasDashboardRecords || hasReviewItems, hasJob && !hasDashboardRecords && !hasReviewItems),
    },
  ]
})

function formatAutopilotTimestamp(value: string): string {
  if (!value) return 'not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function evidenceGapRouteName(gapId: string): string {
  if (gapId === 'market') return 'hermes.marketIntelligence'
  if (gapId === 'financial') return 'hermes.investmentCalculator'
  return 'hermes.investorReadiness'
}

function materialStatusLabel(material: PresentationMaterial): string {
  if (material.evidenceStatus === 'Verified') return 'Source required'
  return material.evidenceStatus
}

function formatCaptureActivityMeta(activity: SessionCaptureActivity): string {
  const parts = [
    activity.contextLabel || 'Session Capture',
    activity.createdTasks ? `${activity.createdTasks} task${activity.createdTasks === 1 ? '' : 's'}` : '',
    activity.savedMemoryItems || activity.savedSessionSummary ? 'memory saved' : '',
    activity.stagedResearchFindings ? `${activity.stagedResearchFindings} review item${activity.stagedResearchFindings === 1 ? '' : 's'}` : '',
    activity.stagedPresentationItems ? `${activity.stagedPresentationItems} draft item${activity.stagedPresentationItems === 1 ? '' : 's'}` : '',
    activity.fallbackItems ? 'copy fallback available' : '',
    activity.errorCount ? `${activity.errorCount} warning${activity.errorCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.join(' / ') || 'Captured with no saved item counts'
}

function nextActionTaskPriority(action: InvestorNextAction): number {
  if (action.priority === 'high') return 3
  if (action.priority === 'medium') return 2
  return 1
}

function nextActionTaskBody(action: InvestorNextAction): string {
  return [
    `Next best action: ${action.title}`,
    `Reason: ${action.reason}`,
    `Evidence status: ${action.evidenceStatus}`,
    `Recommended workspace: ${action.routeLabel}`,
    'Source page: Home / Next Best Actions',
    'Tags: Next Best Action, Investor Readiness, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not mark this investor-ready until the evidence, assumption label, or source review is completed in the linked workspace.',
  ].join('\n')
}

async function createNextActionTask(action: InvestorNextAction) {
  creatingActionTaskId.value = action.id
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: action.title,
      body: nextActionTaskBody(action),
      priority: nextActionTaskPriority(action),
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Next-action task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create next-action task: ${detail}`)
  } finally {
    creatingActionTaskId.value = ''
  }
}

const workspaceActions = [
  {
    label: 'Executive Overview',
    icon: '🏠',
    detail: 'Open the executive intelligence, market, finance, daily brief, and action board.',
    to: { name: 'hermes.executiveOverview' },
  },
  {
    label: 'Last 24 Hours',
    icon: '🕘',
    detail: 'Review chats, captures, tasks, jobs, files, and failures from available data.',
    to: { name: 'hermes.last24Hours' },
  },
  {
    label: 'Continue Chat',
    icon: '💬',
    detail: 'Resume Hermes conversation work.',
    to: { name: 'hermes.chat' },
  },
  {
    label: 'Open Feasibility Studio',
    icon: '🧪',
    detail: 'Work on feasibility drafts, questions, gaps, and outputs.',
    to: { name: 'hermes.feasibility' },
  },
  {
    label: 'Open Investor Readiness',
    icon: '📈',
    detail: 'Check evidence gaps, risks, and investor-safe preparation status.',
    to: { name: 'hermes.investorReadiness' },
  },
  {
    label: 'Open IRR Calculator',
    icon: '💎',
    detail: 'Model assumptions, NPV, IRR, MIRR, payback, and sensitivity.',
    to: { name: 'hermes.investmentCalculator' },
  },
  {
    label: 'Investment Analysis',
    icon: '📊',
    detail: 'Review investor economics with To Verify and Derived from Assumptions labels.',
    to: { name: 'hermes.investmentAnalysis' },
  },
  {
    label: 'Market Intelligence',
    icon: '🌍',
    detail: 'Track source-backed market claims and competitor proof without fake market data.',
    to: { name: 'hermes.marketIntelligence' },
  },
  {
    label: 'Open Projects',
    icon: '🗂️',
    detail: 'Choose the research or feasibility workspace to continue.',
    to: { name: 'hermes.projects' },
  },
  {
    label: 'Raw Material Sourcing',
    icon: '⚗️',
    detail: 'Track sourced price entries, supplier evidence, and alerts.',
    to: { name: 'hermes.rawMaterialSourcing' },
  },
  {
    label: 'Export Markets',
    icon: '🚢',
    detail: 'Research country opportunity with HS-code and trade-proxy warnings.',
    to: { name: 'hermes.exportMarketOpportunity' },
  },
  {
    label: 'Open Research Library',
    icon: '📚',
    detail: 'Use history, memory, and saved evidence paths.',
    to: { name: 'hermes.research' },
  },
  {
    label: 'Open Documents',
    icon: '📄',
    detail: 'Access Hermes files and uploaded evidence.',
    to: { name: 'hermes.files' },
  },
  {
    label: 'Open Tasks',
    icon: '✅',
    detail: 'Track work in the existing Kanban board.',
    to: { name: 'hermes.kanban' },
  },
  {
    label: 'Open Reports',
    icon: '📝',
    detail: 'Prepare outputs and check existing usage analytics.',
    to: { name: 'hermes.reportsHub' },
  },
  {
    label: 'Open Memory',
    icon: '🧠',
    detail: 'Review retained Hermes memory.',
    to: { name: 'hermes.memory' },
  },
  {
    label: 'Backup Vault',
    icon: '🛟',
    detail: 'Owner-only disaster recovery exports with secrets redacted by default.',
    to: { name: 'hermes.localBackupVault' },
  },
]

const visibleWorkspaceActions = computed(() => workspaceActions.filter(action => canUseRouteTarget(action.to)))
const primaryWorkspaceRouteNames = new Set([
  'hermes.chat',
  'hermes.feasibility',
  'hermes.researchResultReview',
  'hermes.marketIntelligence',
  'hermes.rawMaterialSourcing',
  'hermes.investmentAnalysis',
])
const primaryWorkspaceActions = computed(() =>
  visibleWorkspaceActions.value.filter(action => primaryWorkspaceRouteNames.has(action.to.name))
)
const secondaryWorkspaceActions = computed(() =>
  visibleWorkspaceActions.value.filter(action => !primaryWorkspaceRouteNames.has(action.to.name))
)

const workstreams = [
  {
    group: 'Feasibility',
    title: 'Chemicon Feasibility Workspace',
    detail: 'Focus area for feasibility drafts, questions, evidence gaps, documents, tasks, and reports.',
    to: { name: 'hermes.feasibility' },
    links: [
      { label: 'Studio', to: { name: 'hermes.feasibility' } },
      { label: 'Executive Overview', to: { name: 'hermes.executiveOverview' } },
      { label: 'Investor Readiness', to: { name: 'hermes.investorReadiness' } },
      { label: 'IRR', to: { name: 'hermes.investmentCalculator' } },
      { label: 'Investment Analysis', to: { name: 'hermes.investmentAnalysis' } },
      { label: 'Chat', to: { name: 'hermes.chat' } },
      { label: 'Tasks', to: { name: 'hermes.kanban' } },
    ],
  },
  {
    group: 'Research',
    title: 'Research Library',
    detail: 'Use existing Hermes history, memory, and files as the research backbone.',
    to: { name: 'hermes.research' },
    links: [
      { label: 'Library', to: { name: 'hermes.research' } },
      { label: 'Market', to: { name: 'hermes.marketIntelligence' } },
      { label: 'Raw Materials', to: { name: 'hermes.rawMaterialSourcing' } },
      { label: 'Export Markets', to: { name: 'hermes.exportMarketOpportunity' } },
      { label: 'Competitors', to: { name: 'hermes.competitorIntelligence' } },
      { label: 'History', to: { name: 'hermes.history' } },
      { label: 'Memory', to: { name: 'hermes.memory' } },
    ],
  },
  {
    group: 'Documents',
    title: 'Evidence and Documents',
    detail: 'Open the original Files area for documents, uploads, and working evidence.',
    to: { name: 'hermes.files' },
    links: [
      { label: 'Documents', to: { name: 'hermes.files' } },
      { label: 'Projects', to: { name: 'hermes.projects' } },
      { label: 'Reports', to: { name: 'hermes.reportsHub' } },
    ],
  },
  {
    group: 'Hermes',
    title: 'System Control Links',
    detail: 'Keep the original Hermes system controls reachable without crowding daily work.',
    to: { name: 'hermes.settings' },
    links: [
      { label: 'Settings', to: { name: 'hermes.settings' } },
      { label: 'Models', to: { name: 'hermes.models' } },
      { label: 'Terminal', to: { name: 'hermes.terminal' } },
    ],
  },
]

const visibleWorkstreams = computed(() =>
  workstreams
    .map(stream => ({
      ...stream,
      links: stream.links.filter(link => canUseRouteTarget(link.to)),
    }))
    .filter(stream => canUseRouteTarget(stream.to) || stream.links.length > 0)
)

const commandLinks = [
  { label: 'Settings', to: { name: 'hermes.settings' } },
  { label: 'Models', to: { name: 'hermes.models' } },
  { label: 'Profiles', to: { name: 'hermes.profiles' } },
  { label: 'Jobs', to: { name: 'hermes.jobs' } },
  { label: 'Channels', to: { name: 'hermes.channels' } },
  { label: 'Skills', to: { name: 'hermes.skills' } },
  { label: 'Plugins', to: { name: 'hermes.plugins' } },
  { label: 'Logs', to: { name: 'hermes.logs' } },
  { label: 'Performance', to: { name: 'hermes.performance' } },
  { label: 'Usage', to: { name: 'hermes.usage' } },
  { label: 'Skills Usage', to: { name: 'hermes.skillsUsage' } },
  { label: 'Version Preview', to: { name: 'hermes.versionPreview' } },
  { label: 'Group Chat', to: { name: 'hermes.groupChat' } },
]

const visibleCommandLinks = computed(() => commandLinks.filter(link => canUseRouteTarget(link.to)))

function roleLabel(role: FrontendAccessRole): string {
  if (role === 'developer_admin') return 'Developer Admin'
  if (role === 'research_assistant') return 'Research Assistant'
  if (role === 'financial_analyst') return 'Financial Analyst'
  if (role === 'regulatory_consultant') return 'Regulatory Consultant'
  if (role === 'employee') return 'Employee'
  return 'Owner'
}

const limitedHomeActions = computed(() => {
  const base = [
    { label: 'Chat', detail: 'Discuss assigned work with Hermes. Product-development secret sessions stay blocked.', to: { name: 'hermes.chat' }, roles: ['employee', 'research_assistant', 'regulatory_consultant'] },
    { label: 'My Tasks', detail: 'Open the filtered Kanban task board for allowed work.', to: { name: 'hermes.kanban' }, roles: ['employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'] },
    { label: 'Research Jobs', detail: 'Review allowed research jobs without system/admin controls.', to: { name: 'hermes.jobs' }, roles: ['employee', 'research_assistant'] },
    { label: 'Research Library', detail: 'Use safe research workspaces. Raw Memory remains owner-only.', to: { name: 'hermes.research' }, roles: ['employee', 'research_assistant'] },
    { label: 'Employee Documents', detail: 'Open employee-safe document categories only.', to: { name: 'hermes.files' }, roles: ['employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'] },
    { label: 'Market', detail: 'Review non-sensitive market research with prices and secret fields redacted.', to: { name: 'hermes.marketIntelligence' }, roles: ['research_assistant', 'employee'] },
    { label: 'Competitors', detail: 'Review competitor notes without supplier-cost or formula-sensitive fields.', to: { name: 'hermes.competitorIntelligence' }, roles: ['research_assistant', 'employee'] },
    { label: 'IRR Calculator', detail: 'Work on financial assumptions within your permitted finance scope.', to: { name: 'hermes.investmentCalculator' }, roles: ['financial_analyst'] },
    { label: 'Regulatory Review', detail: 'Review assigned regulatory research and evidence status.', to: { name: 'hermes.researchResultReview' }, roles: ['regulatory_consultant', 'research_assistant'] },
    { label: 'Reports / Outputs', detail: 'Use approved report/output workspaces; unsupported claims stay labeled.', to: { name: 'hermes.reportsHub' }, roles: ['employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'] },
  ]
  return base.filter(action =>
    action.roles.includes(frontendRole.value) &&
    canUseRouteTarget(action.to)
  )
})

const developerHomeActions = computed(() => [
  { label: 'Terminal', detail: 'Owner-approved system shell access.', to: { name: 'hermes.terminal' } },
  { label: 'Logs', detail: 'Inspect runtime logs without raw business memory shortcuts.', to: { name: 'hermes.logs' } },
  { label: 'Jobs', detail: 'Review system and research job execution.', to: { name: 'hermes.jobs' } },
  { label: 'Settings', detail: 'Admin system settings and provider configuration.', to: { name: 'hermes.settings' } },
  { label: 'Models', detail: 'Provider/model configuration.', to: { name: 'hermes.models' } },
  { label: 'Profiles', detail: 'Profile management tools.', to: { name: 'hermes.profiles' } },
  { label: 'System Health', detail: 'Runtime performance and bridge state.', to: { name: 'hermes.performance' } },
].filter(action => canUseRouteTarget(action.to)))

function formatSessionTitle(session: SessionSummary): string {
  return session.title || session.preview || session.id
}

function formatSessionMeta(session: SessionSummary): string {
  const messages = `${session.message_count || 0} msgs`
  const tools = `${session.tool_call_count || 0} tools`
  return `${session.profile || activeProfileName.value} / ${messages} / ${tools}`
}

function formatJobState(job: Job): string {
  if (!job.enabled) return 'Paused'
  return job.state || job.last_status || 'Scheduled'
}

function formatUpdatedAt(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function loadDashboard() {
  loading.value = true
  loadWarning.value = ''
  recentCaptureActivities.value = listRecentCaptureActivities(4)
  tokenReady.value = hasApiKey()
  activeProfileName.value = getActiveProfileName() || 'default'

  let partialFailure = false
  await appStore.checkConnection()

  if (!tokenReady.value) {
    sessions.value = []
    jobs.value = []
    runtime.value = null
    autopilotImportStatus.value = null
    lastUpdated.value = formatUpdatedAt()
    loading.value = false
    return
  }

  const [modelsResult, sessionsResult, jobsResult, runtimeResult, autopilotResult] = await Promise.allSettled([
    canUseRouteName('hermes.models') ? appStore.loadModels(true) : Promise.resolve(null),
    isDeveloperHome.value ? Promise.resolve([]) : fetchSessions(undefined, 6),
    listJobs(),
    canUseRouteName('hermes.performance') ? fetchPerformanceRuntime() : Promise.resolve(null),
    isOwnerHome.value ? fetchDashboardAutopilotImportStatus() : Promise.resolve(null),
  ])

  if (modelsResult.status === 'rejected') partialFailure = true
  if (sessionsResult.status === 'fulfilled') sessions.value = sessionsResult.value
  else partialFailure = true
  if (jobsResult.status === 'fulfilled') jobs.value = jobsResult.value
  else partialFailure = true
  if (runtimeResult.status === 'fulfilled') runtime.value = runtimeResult.value
  else partialFailure = true
  if (autopilotResult.status === 'fulfilled') {
    autopilotImportStatus.value = autopilotResult.value?.autopilotImport ?? null
  } else if (isOwnerHome.value) {
    autopilotImportStatus.value = null
    partialFailure = true
  }

  if (partialFailure) loadWarning.value = 'Runtime data partially unavailable'
  lastUpdated.value = formatUpdatedAt()
  loading.value = false
}

onMounted(() => {
  void loadDashboard()
})
</script>

<template>
  <div class="dashboard-view">
    <header class="page-header dashboard-header">
      <div>
        <h2 class="header-title">Hermes Command Center</h2>
        <div class="header-subtitle">Research workspace overview</div>
      </div>
      <div class="dashboard-actions">
        <RouterLink v-if="canUseRouteName('hermes.chat')" class="command-btn primary" :to="{ name: 'hermes.chat' }">Continue Chat</RouterLink>
        <RouterLink v-if="canUseRouteName('hermes.feasibility')" class="command-btn" :to="{ name: 'hermes.feasibility' }">Feasibility</RouterLink>
        <button class="command-btn" type="button" :disabled="loading" @click="loadDashboard">
          {{ loading ? 'Refreshing' : 'Refresh' }}
        </button>
      </div>
    </header>

    <main class="dashboard-content">
      <section class="status-strip" aria-label="Command center status">
        <span v-for="badge in statusBadges" :key="badge.label" class="status-chip" :class="badge.tone">
          {{ badge.label }}
        </span>
        <span v-if="lastUpdated" class="status-chip muted">Updated {{ lastUpdated }}</span>
        <span v-if="loadWarning" class="status-chip warn">{{ loadWarning }}</span>
      </section>

      <section v-if="isLimitedBusinessHome" class="role-home-panel" aria-label="Role workspace home">
        <div class="role-home-hero">
          <span class="role-badge">{{ roleLabel(frontendRole) }}</span>
          <h3>Your Hermes workspace</h3>
          <p>
            This view only links to areas available for your role. Price, costing, formulas, product-development
            memory/history, terminal, provider settings, logs, and owner-only investor/admin tools stay restricted.
          </p>
        </div>
        <div class="role-action-grid">
          <RouterLink v-for="action in limitedHomeActions" :key="action.label" class="role-action-card" :to="action.to">
            <strong>{{ action.label }}</strong>
            <small>{{ action.detail }}</small>
          </RouterLink>
        </div>
        <div class="role-guidance">
          <strong>Access reminder</strong>
          <span>Use Access Help when you need a document, task, or workspace the owner has not approved for your role yet.</span>
          <RouterLink :to="{ name: 'hermes.accessDenied' }">Access Help</RouterLink>
        </div>
      </section>

      <section v-else-if="isDeveloperHome" class="role-home-panel developer" aria-label="Developer admin home">
        <div class="role-home-hero">
          <span class="role-badge">Developer Admin</span>
          <h3>System workspace</h3>
          <p>
            Developer access is focused on runtime, models, logs, jobs, and terminal support. Raw business memory,
            history, files, Kanban, and investor materials remain blocked unless the owner grants separate access.
          </p>
        </div>
        <div class="role-action-grid">
          <RouterLink v-for="action in developerHomeActions" :key="action.label" class="role-action-card" :to="action.to">
            <strong>{{ action.label }}</strong>
            <small>{{ action.detail }}</small>
          </RouterLink>
        </div>
      </section>

      <template v-if="isOwnerHome">
      <section class="executive-brief-card executive-card gold" aria-label="Executive command brief">
        <div>
          <p class="executive-eyebrow">Executive Command Brief</p>
          <h3>Continue from the most important verified workflow</h3>
          <p>
            This Home view summarizes real Hermes workspace state only: live routes, capture activity, readiness
            status, tasks, files, jobs, and model state. No fake business metrics are added here.
          </p>
        </div>
        <RouterLink class="brief-primary-link" :to="{ name: 'hermes.feasibility' }">Open Feasibility Studio</RouterLink>
      </section>

      <section class="automatic-research-card" :class="automaticResearchState.tone" aria-label="Automatic trusted-source research status">
        <div class="automatic-research-main">
          <p class="executive-eyebrow">Automatic Research</p>
          <div class="automatic-research-title">
            <h3>{{ automaticResearchState.title }}</h3>
            <span>{{ automaticResearchState.label }}</span>
          </div>
          <p>{{ automaticResearchState.body }}</p>
          <strong>{{ automaticResearchState.action }}</strong>
          <div class="automatic-research-actions">
            <RouterLink v-if="canUseRouteName('hermes.trustedSources')" class="brief-primary-link" :to="{ name: 'hermes.trustedSources' }">Autopilot Status</RouterLink>
            <RouterLink v-if="canUseResearchReview" class="brief-primary-link" :to="{ name: 'hermes.researchResultReview' }">Review Queue</RouterLink>
            <RouterLink v-if="canUseRouteName('hermes.jobs')" class="brief-primary-link" :to="{ name: 'hermes.jobs' }">Research Job Log</RouterLink>
          </div>
          <div class="autopilot-promise-strip" aria-label="What Hermes does automatically">
            <article v-for="card in automaticResearchPromiseCards" :key="card.title">
              <span aria-hidden="true">{{ card.icon }}</span>
              <div>
                <strong>{{ card.title }}</strong>
                <small>{{ card.detail }}</small>
              </div>
            </article>
          </div>
          <div class="automatic-research-flow" aria-label="Automatic research flow">
            <article v-for="step in automaticResearchFlow" :key="step.title" :class="step.state">
              <span class="flow-icon" aria-hidden="true">{{ step.icon }}</span>
              <span class="flow-copy">
                <strong>{{ step.title }}</strong>
                <small>{{ step.detail }}</small>
              </span>
              <span class="flow-state">{{ step.state }}</span>
            </article>
          </div>
        </div>
        <div class="automatic-research-metrics">
          <article v-for="card in automaticResearchCards" :key="card.label">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
            <small>{{ card.note }}</small>
          </article>
        </div>
        <div class="automatic-coverage-focus" aria-label="Missing trusted-source dashboard coverage">
          <div class="coverage-focus-header">
            <div>
              <p class="executive-eyebrow">🎯 Missing research focus</p>
              <h4>
                {{ missingDashboardCoverageCount ? `${missingDashboardCoverageCount} trusted-source targets still need coverage` : 'Trusted-source coverage looks complete' }}
              </h4>
              <p>
                Hermes uses this map to keep researching the dashboard automatically. Missing values stay Missing or To Verify until source-backed evidence is imported.
              </p>
            </div>
            <RouterLink v-if="canUseRouteName('hermes.trustedSources')" class="brief-primary-link" :to="{ name: 'hermes.trustedSources' }">Coverage Status</RouterLink>
          </div>
          <div v-if="topMissingDashboardCoverageRows.length" class="coverage-focus-grid">
            <article v-for="row in topMissingDashboardCoverageRows" :key="row.area" :class="row.status">
              <span class="coverage-focus-icon" aria-hidden="true">{{ row.status === 'missing' ? '🧭' : '🔍' }}</span>
              <div>
                <strong>{{ row.area }}</strong>
                <small>{{ row.coveredCount }}/{{ row.totalTargets }} covered</small>
                <p>{{ row.missingTargets.slice(0, 4).map(item => item.label).join(', ') }}<template v-if="row.missingTargets.length > 4">...</template></p>
              </div>
            </article>
          </div>
          <div v-else class="coverage-focus-complete">
            <span aria-hidden="true">✅</span>
            <strong>Every required dashboard area has imported evidence or review items.</strong>
            <small>Keep the twice-daily autopilot active so freshness and source checks continue.</small>
          </div>
        </div>
      </section>

      <section class="today-priority-strip next-action-card" aria-label="Today's priority">
        <span class="priority-star" aria-hidden="true"></span>
        <div v-if="todayPriority">
          <strong>Today's priority: {{ todayPriority.title }}</strong>
          <small><span class="priority-separator"> - </span>{{ todayPriority.reason }} / {{ todayPriority.evidenceStatus }} / {{ todayPriority.routeLabel }}</small>
        </div>
        <div v-else>
          <strong>Today's priority: Continue from Chat or Feasibility Studio</strong>
          <small><span class="priority-separator"> - </span>No urgent evidence-driven action is available in the current workspace state.</small>
        </div>
        <RouterLink v-if="todayPriority" :to="{ name: todayPriority.routeName }">Open</RouterLink>
      </section>

      <PinnedExecutiveIntelligenceBoard />

      <section class="home-focus-panel" aria-label="Start here shortcuts">
        <div class="panel-title">
          <div>
            <h3>Start Here</h3>
            <p>Daily owner actions only. The full workspace list and system details are folded below.</p>
          </div>
          <RouterLink v-if="canUseRouteName('hermes.trustedSources')" :to="{ name: 'hermes.trustedSources' }">Autopilot</RouterLink>
        </div>
        <div class="workspace-action-grid focused">
          <RouterLink v-for="action in primaryWorkspaceActions" :key="action.label" class="workspace-action" :to="action.to">
            <span class="action-icon">{{ action.icon }}</span>
            <span class="action-label">{{ action.label }}</span>
            <small>{{ action.detail }}</small>
          </RouterLink>
        </div>
      </section>

      <section class="next-actions-panel" aria-label="Next best actions">
        <div class="panel-title">
          <div>
            <h3>Next Best Actions</h3>
            <p>Generated from evidence status, research review, financial snapshots, and approved deck material.</p>
          </div>
          <RouterLink v-if="canUseInvestorReadiness" :to="{ name: 'hermes.investorReadiness' }">Readiness</RouterLink>
        </div>
        <div class="next-actions-list">
          <article
            v-for="action in nextBestActions"
            :key="action.id"
            class="next-action-row"
            :class="action.priority"
          >
            <RouterLink class="next-action-main" :to="{ name: action.routeName }">
              <span class="action-priority">{{ action.priority }}</span>
              <span class="action-body">
                <strong>{{ action.title }}</strong>
                <small>{{ action.reason }}</small>
              </span>
              <span class="action-status">{{ action.evidenceStatus }}</span>
              <span class="action-route">{{ action.routeLabel }}</span>
            </RouterLink>
            <NButton
              size="tiny"
              secondary
              :loading="creatingActionTaskId === action.id"
              @click="createNextActionTask(action)"
            >
              Create task
            </NButton>
          </article>
        </div>
      </section>

      <section class="triage-grid" aria-label="Feasibility intelligence triage">
        <article class="triage-panel">
          <div class="panel-title">
            <div>
              <h3>Evidence Gaps</h3>
              <p>Top missing or unverified investor-readiness areas.</p>
            </div>
            <RouterLink v-if="canUseInvestorReadiness" :to="{ name: 'hermes.investorReadiness' }">Review</RouterLink>
          </div>
          <div v-if="visibleTopEvidenceGaps.length" class="triage-list">
            <RouterLink
              v-for="gap in visibleTopEvidenceGaps"
              :key="gap.id"
              class="triage-row"
              :to="{ name: evidenceGapRouteName(gap.id) }"
            >
              <span>{{ gap.label }}</span>
              <small>{{ gap.evidenceStatus }} / {{ gap.nextAction }}</small>
            </RouterLink>
          </div>
          <div v-else class="triage-empty">No missing readiness areas in the current local intelligence state.</div>
        </article>

        <article class="triage-panel">
          <div class="panel-title">
            <div>
              <h3>Investor Risk Register</h3>
              <p>Highest-priority risks from evidence gaps, research review, warnings, and unsupported deck material.</p>
            </div>
            <RouterLink v-if="canUseInvestorReadiness" :to="{ name: 'hermes.investorReadiness' }">Risk register</RouterLink>
          </div>
          <div v-if="visibleTopInvestorRisks.length" class="triage-list">
            <RouterLink
              v-for="risk in visibleTopInvestorRisks"
              :key="risk.id"
              class="triage-row"
              :to="{ name: risk.routeName }"
            >
              <span>{{ risk.title }}</span>
              <small>{{ risk.origin }} / {{ risk.evidenceStatus }} / {{ risk.detail }}</small>
            </RouterLink>
          </div>
          <div v-else class="triage-empty">No current investor risks in the local intelligence state.</div>
        </article>

        <article v-if="canUseResearchReview" class="triage-panel">
          <div class="panel-title">
            <div>
              <h3>Research Review Queue</h3>
              <p>Items waiting for approval before they affect readiness or investor material.</p>
            </div>
            <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review</RouterLink>
          </div>
          <div v-if="pendingReviewItems.length || openResearchJobs.length" class="triage-list">
            <RouterLink
              v-for="finding in pendingReviewItems"
              :key="finding.id"
              class="triage-row"
              :to="{ name: 'hermes.researchResultReview' }"
            >
              <span>{{ finding.keyClaim || finding.summary }}</span>
              <small>{{ finding.status }} / {{ finding.evidenceStatus }}</small>
            </RouterLink>
            <RouterLink
              v-for="job in openResearchJobs"
              :key="job.id"
              class="triage-row"
              :to="{ name: 'hermes.researchResultReview' }"
            >
              <span>{{ job.title }}</span>
              <small>{{ job.status }} / {{ job.context }}<template v-if="job.schedulePreference"> / {{ job.schedulePreference }}</template></small>
            </RouterLink>
          </div>
          <div v-else class="triage-empty">No pending research findings or manual research jobs.</div>
        </article>

        <article v-if="showFinancialDeckPanel" class="triage-panel">
          <div class="panel-title">
            <div>
              <h3>Recent Session Captures</h3>
              <p>Approved capture activity from Chat. Raw conversations stay in History.</p>
            </div>
            <RouterLink :to="{ name: 'hermes.chat' }">Review & Capture</RouterLink>
          </div>
          <div v-if="recentCaptureActivities.length" class="triage-list">
            <RouterLink
              v-for="activity in recentCaptureActivities"
              :key="activity.sessionId"
              class="triage-row"
              :to="{ name: 'hermes.session', params: { sessionId: activity.sessionId } }"
            >
              <span>{{ activity.sessionTitle || activity.sessionId }}</span>
              <small>{{ formatCaptureActivityMeta(activity) }}</small>
            </RouterLink>
          </div>
          <div v-else class="triage-empty">
            No captured sessions yet. Use Review & Capture in Chat after a useful Hermes conversation.
          </div>
        </article>

        <article class="triage-panel">
          <div class="panel-title">
            <div>
              <h3>Financial & Deck Status</h3>
              <p>Latest model snapshot and investor material that still needs evidence.</p>
            </div>
            <RouterLink v-if="canUseInvestorPresentation" :to="{ name: 'hermes.investorPresentation' }">Deck</RouterLink>
          </div>
          <div class="triage-list">
            <RouterLink v-if="canUseInvestmentCalculator" class="triage-row" :to="{ name: 'hermes.investmentCalculator' }">
              <span>{{ latestFinancialSnapshot?.scenarioName || 'No saved financial snapshot' }}</span>
              <small>
                {{ latestFinancialSnapshot ? `${latestFinancialSnapshot.evidenceStatus} / ${latestFinancialSnapshot.warnings.length} warning${latestFinancialSnapshot.warnings.length === 1 ? '' : 's'}` : 'Save a scenario before discussing investor returns.' }}
              </small>
            </RouterLink>
            <template v-if="canUseInvestorPresentation">
              <RouterLink
                v-for="material in deckMaterialsNeedingEvidence"
                :key="material.id || `${material.section}-${material.content}`"
                class="triage-row"
                :to="{ name: 'hermes.investorPresentation' }"
              >
                <span>{{ material.section }}</span>
                <small>{{ materialStatusLabel(material) }} / {{ material.content }}</small>
              </RouterLink>
            </template>
          </div>
        </article>
      </section>

      <details class="home-advanced-section">
        <summary>
          <span>All workspaces, readiness snapshot, and system details</span>
          <small>Open this when you need secondary dashboards, runtime metrics, sessions, jobs, or system links.</small>
        </summary>

        <section v-if="secondaryWorkspaceActions.length" class="workspace-action-grid secondary" aria-label="Secondary research workspace shortcuts">
          <RouterLink v-for="action in secondaryWorkspaceActions" :key="action.label" class="workspace-action" :to="action.to">
            <span class="action-icon">{{ action.icon }}</span>
            <span class="action-label">{{ action.label }}</span>
            <small>{{ action.detail }}</small>
          </RouterLink>
        </section>

        <section class="investor-snapshot-grid" aria-label="Investor readiness snapshot">
          <RouterLink v-for="item in investorSnapshot" :key="item.label" class="kpi-card investor" :class="item.tone" :to="item.to">
            <div class="kpi-value">{{ item.value }}</div>
            <div class="kpi-label">{{ item.label }}</div>
            <div class="kpi-note">{{ item.note }}</div>
          </RouterLink>
        </section>

        <section class="kpi-grid" aria-label="Runtime metrics">
          <div v-for="kpi in kpis" :key="kpi.label" class="kpi-card" :class="kpi.tone">
            <div class="kpi-value">{{ kpi.value }}</div>
            <div class="kpi-label">{{ kpi.label }}</div>
            <div class="kpi-note">{{ kpi.note }}</div>
          </div>
        </section>

        <section class="workstream-grid" aria-label="Hermes workstreams">
          <article v-for="stream in visibleWorkstreams" :key="stream.group" class="workstream-card">
            <div class="workstream-head">
              <span>{{ stream.group }}</span>
              <RouterLink v-if="canUseRouteTarget(stream.to)" :to="stream.to">Open</RouterLink>
            </div>
            <h3>{{ stream.title }}</h3>
            <p>{{ stream.detail }}</p>
            <div class="workstream-links">
              <RouterLink v-for="link in stream.links" :key="link.label" :to="link.to">
                {{ link.label }}
              </RouterLink>
            </div>
          </article>
        </section>

        <section class="ops-grid" aria-label="Operational lists">
          <article class="ops-panel">
            <div class="panel-title">
              <h3>Recent Sessions</h3>
              <RouterLink :to="{ name: 'hermes.history' }">History</RouterLink>
            </div>
            <div v-if="sessions.length" class="ops-list">
              <RouterLink
                v-for="session in sessions"
                :key="session.id"
                class="ops-row"
                :to="{ name: 'hermes.session', params: { sessionId: session.id } }"
              >
                <span>{{ formatSessionTitle(session) }}</span>
                <small>{{ formatSessionMeta(session) }}</small>
              </RouterLink>
            </div>
            <div v-else class="ops-empty">No recent sessions</div>
          </article>

          <article class="ops-panel">
            <div class="panel-title">
              <h3>Automation Queue</h3>
              <RouterLink :to="{ name: 'hermes.jobs' }">Jobs</RouterLink>
            </div>
            <div v-if="jobs.length" class="ops-list">
              <RouterLink v-for="job in jobs.slice(0, 6)" :key="job.id" class="ops-row" :to="{ name: 'hermes.jobs' }">
                <span>{{ job.name }}</span>
                <small>{{ formatJobState(job) }} / {{ job.schedule_display || 'Manual' }}</small>
              </RouterLink>
            </div>
            <div v-else class="ops-empty">No scheduled jobs</div>
          </article>

          <article v-if="visibleCommandLinks.length" class="ops-panel">
            <div class="panel-title">
              <h3>Hermes System</h3>
              <RouterLink v-if="canUseRouteName('hermes.settings')" :to="{ name: 'hermes.settings' }">Settings</RouterLink>
            </div>
            <div class="command-link-grid">
              <RouterLink v-for="link in visibleCommandLinks" :key="link.label" :to="link.to">
                {{ link.label }}
              </RouterLink>
            </div>
          </article>
        </section>
      </details>
      </template>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.dashboard-view {
  height: var(--app-content-height, 100%);
  display: flex;
  flex-direction: column;
  background: $bg-primary;
  color: $text-primary;
}

.dashboard-header {
  align-items: center;
}

.dashboard-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.command-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 7px 12px;
  border: 1px solid $border-color;
  border-radius: 999px;
  background: $bg-card;
  color: $text-primary;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;

  &:hover {
    border-color: $accent-primary;
    color: $accent-primary;
    background: $bg-card-hover;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  &.primary {
    border-color: rgba(var(--accent-info-rgb), 0.6);
    background: rgba(var(--accent-info-rgb), 0.1);
    color: $accent-info;
  }
}

.dashboard-content {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.status-strip {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: #09130f;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 4px 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-muted;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  &.ok {
    border-color: rgba(var(--success-rgb), 0.55);
    background: rgba(var(--success-rgb), 0.12);
    color: $success;
  }

  &.info {
    border-color: rgba(var(--accent-info-rgb), 0.55);
    background: rgba(var(--accent-info-rgb), 0.1);
    color: $accent-info;
  }

  &.warn {
    border-color: rgba(var(--warning-rgb), 0.55);
    background: rgba(var(--warning-rgb), 0.1);
    color: $warning;
  }

  &.danger {
    border-color: rgba(var(--error-rgb), 0.55);
    background: rgba(var(--error-rgb), 0.1);
    color: $error;
  }
}

.role-home-panel {
  display: grid;
  gap: 14px;
  max-width: 1180px;
}

.role-home-hero,
.role-guidance {
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
}

.role-home-hero {
  padding: 18px;

  h3 {
    margin: 8px 0;
    color: $accent-primary;
    font-size: 20px;
  }

  p {
    max-width: 760px;
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.role-badge {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.48);
  border-radius: 999px;
  background: rgba(var(--accent-info-rgb), 0.1);
  color: $accent-info;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.role-action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
}

.role-action-card {
  display: grid;
  gap: 8px;
  min-height: 104px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
  color: $text-primary;
  text-decoration: none;

  &:hover {
    border-color: $accent-info;
    background: $bg-card-hover;
  }

  strong {
    color: $accent-primary;
    font-size: 14px;
  }

  small {
    color: $text-muted;
    font-size: 12px;
    line-height: 1.45;
  }
}

.role-guidance {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px 14px;
  color: $text-secondary;
  font-size: 12px;

  strong {
    color: $accent-primary;
  }

  a {
    color: $accent-info;
    font-weight: 800;
    text-decoration: none;
  }
}

.executive-brief-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  margin-bottom: 12px;
  padding: 16px 18px 16px 22px;

  h3 {
    margin: 0;
    color: $accent-primary;
    font-size: 18px;
  }

  p {
    max-width: 850px;
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.5;
  }
}

.executive-eyebrow {
  color: $accent-info !important;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.automatic-research-card {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(360px, 1.05fr);
  gap: 14px;
  align-items: stretch;
  margin-bottom: 12px;
  padding: 16px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.32);
  border-radius: $radius-md;
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.12), rgba(var(--accent-primary-rgb), 0.08) 54%, transparent),
    $bg-card;

  &.ok {
    border-color: rgba(var(--success-rgb), 0.34);
    background:
      linear-gradient(135deg, rgba(var(--success-rgb), 0.1), rgba(var(--accent-info-rgb), 0.06) 54%, transparent),
      $bg-card;
  }

  &.warn {
    border-color: rgba(var(--warning-rgb), 0.44);
    background:
      linear-gradient(135deg, rgba(var(--warning-rgb), 0.11), rgba(var(--accent-primary-rgb), 0.065) 54%, transparent),
      $bg-card;
  }

  &.danger {
    border-color: rgba(var(--error-rgb), 0.4);
    background:
      linear-gradient(135deg, rgba(var(--error-rgb), 0.1), rgba(var(--accent-info-rgb), 0.05) 54%, transparent),
      $bg-card;
  }
}

.automatic-research-main {
  display: grid;
  gap: 10px;
  align-content: start;
  min-width: 0;

  h3,
  p,
  strong {
    margin: 0;
  }

  h3 {
    color: $accent-primary;
    font-size: 18px;
  }

  p {
    color: $text-secondary;
    line-height: 1.5;
  }

  strong {
    color: $text-primary;
    line-height: 1.45;
  }
}

.automatic-research-title {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 25px;
    padding: 3px 9px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.38);
    border-radius: 999px;
    background: rgba(var(--accent-primary-rgb), 0.09);
    color: $accent-primary;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    white-space: nowrap;
  }
}

.automatic-research-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.autopilot-promise-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 8px;
    min-width: 0;
    padding: 10px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.24);
    border-radius: $radius-sm;
    background: rgba(var(--accent-info-rgb), 0.055);
  }

  span {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.24);
    border-radius: 999px;
    background: rgba(var(--accent-primary-rgb), 0.08);
    font-size: 15px;
  }

  div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  strong {
    color: $accent-primary;
    font-size: 11px;
    line-height: 1.3;
  }

  small {
    color: $text-secondary;
    font-size: 10.5px;
    line-height: 1.35;
  }
}

.automatic-research-flow {
  display: grid;
  gap: 8px;
  margin-top: 2px;

  article {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 9px;
    align-items: center;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: rgba(0, 0, 0, 0.12);

    &.done {
      border-color: rgba(var(--success-rgb), 0.34);
      background: rgba(var(--success-rgb), 0.08);

      .flow-state {
        color: $success;
      }
    }

    &.active {
      border-color: rgba(var(--warning-rgb), 0.38);
      background: rgba(var(--warning-rgb), 0.08);

      .flow-state {
        color: $warning;
      }
    }

    &.waiting {
      .flow-state {
        color: $text-muted;
      }
    }
  }
}

.flow-icon {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.26);
  border-radius: 999px;
  background: rgba(var(--accent-info-rgb), 0.08);
  font-size: 16px;
}

.flow-copy {
  display: grid;
  gap: 3px;
  min-width: 0;

  strong {
    color: $text-primary;
    font-size: 12px;
    line-height: 1.25;
  }

  small {
    color: $text-secondary;
    font-size: 11px;
    line-height: 1.35;
  }
}

.flow-state {
  align-self: start;
  color: $text-muted;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.automatic-research-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    gap: 6px;
    min-height: 104px;
    padding: 11px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
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
    font-size: 18px;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }

  small {
    color: $text-secondary;
    line-height: 1.35;
  }
}

.automatic-coverage-focus {
  display: grid;
  grid-column: 1 / -1;
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.24);
  border-radius: $radius-sm;
  background: rgba(0, 0, 0, 0.12);
}

.coverage-focus-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;

  h4,
  p {
    margin: 0;
  }

  h4 {
    color: $accent-primary;
    font-size: 15px;
    line-height: 1.3;
  }

  p {
    max-width: 780px;
    margin-top: 5px;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.coverage-focus-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 9px;
    min-width: 0;
    padding: 10px;
    border: 1px solid rgba(var(--warning-rgb), 0.28);
    border-radius: $radius-sm;
    background: rgba(var(--warning-rgb), 0.06);

    &.missing {
      border-color: rgba(var(--error-rgb), 0.28);
      background: rgba(var(--error-rgb), 0.055);
    }
  }

  strong,
  small,
  p {
    display: block;
  }

  strong {
    color: $text-primary;
    font-size: 12px;
    line-height: 1.3;
  }

  small {
    margin-top: 3px;
    color: $accent-info;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    font-size: 11px;
    line-height: 1.35;
  }
}

.coverage-focus-icon {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.26);
  border-radius: 999px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  font-size: 15px;
}

.coverage-focus-complete {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(var(--success-rgb), 0.28);
  border-radius: $radius-sm;
  background: rgba(var(--success-rgb), 0.07);

  span {
    grid-row: 1 / span 2;
    font-size: 18px;
  }

  strong {
    color: $success;
    font-size: 12px;
  }

  small {
    color: $text-secondary;
    font-size: 11px;
  }
}

.brief-primary-link,
.today-priority-strip a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.45);
  border-radius: 999px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.1);
  }
}

.today-priority-strip {
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  margin-bottom: 12px;

  > div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  strong,
  small {
    display: block;
  }
}

.workspace-action-grid,
.investor-snapshot-grid,
.kpi-grid,
.workstream-grid,
.triage-grid,
.ops-grid {
  display: grid;
  gap: 12px;
}

.investor-snapshot-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 12px;
}

.workspace-action-grid {
  grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
  margin-bottom: 12px;

  &.focused {
    margin-bottom: 0;
  }

  &.secondary {
    margin-bottom: 14px;
  }
}

.home-focus-panel {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.07), transparent 48%),
    $bg-card;
}

.home-advanced-section {
  display: grid;
  gap: 14px;
  margin-bottom: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.24);
  border-radius: $radius-md;
  background: $bg-card;

  &[open] {
    padding: 0 14px 14px;
  }

  > summary {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 13px 14px;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &::after {
      content: '+';
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border: 1px solid rgba(var(--accent-info-rgb), 0.38);
      border-radius: 999px;
      color: $accent-info;
      font-weight: 900;
      flex: 0 0 auto;
    }

    span {
      color: $accent-primary;
      font-weight: 900;
      text-transform: uppercase;
    }

    small {
      max-width: 520px;
      color: $text-muted;
      line-height: 1.35;
      text-align: right;
    }
  }

  &[open] > summary {
    padding-right: 0;
    padding-left: 0;
  }

  &[open] > summary::after {
    content: '-';
  }
}

.workspace-action {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  min-height: 90px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
  color: $text-primary;

  &:hover {
    border-color: $accent-info;
    background: $bg-card-hover;
  }

  .action-icon {
    display: inline-grid;
    width: 36px;
    height: 36px;
    grid-row: span 2;
    place-items: center;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
    border-radius: $radius-sm;
    background: rgba(var(--accent-primary-rgb), 0.08);
    color: $accent-primary;
    font-size: 11px;
    font-weight: 900;
  }

  .action-label {
    color: $accent-primary;
    font-size: 14px;
    font-weight: 800;
  }

  small {
    grid-column: 2;
    color: $text-muted;
    font-size: 12px;
    line-height: 1.45;
  }
}

.kpi-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 12px;
}

.next-actions-panel {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
}

.triage-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 12px;
}

.triage-panel {
  display: grid;
  align-content: start;
  min-height: 236px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
}

.triage-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.triage-row {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-primary;
  color: $text-primary;
  text-decoration: none;

  &:hover {
    border-color: $accent-info;
    color: $accent-info;
  }

  span {
    overflow: hidden;
    color: $text-primary;
    font-size: 13px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    display: -webkit-box;
    overflow: hidden;
    color: $text-muted;
    font-size: 12px;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
}

.triage-empty {
  margin-top: 14px;
  padding: 28px 0;
  color: $text-muted;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.next-actions-list {
  display: grid;
  gap: 8px;
}

.next-action-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 62px;
  padding: 10px 12px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: rgba(255, 255, 255, 0.02);
  color: $text-primary;

  &:hover {
    border-color: $accent-info;
    background: $bg-card-hover;
  }

  &.high {
    border-color: rgba(var(--error-rgb), 0.35);
  }

  &.medium {
    border-color: rgba(var(--warning-rgb), 0.35);
  }

  &.low {
    border-color: rgba(var(--accent-info-rgb), 0.28);
  }
}

.next-action-main {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) max-content max-content;
  gap: 10px;
  align-items: center;
  min-width: 0;
  color: $text-primary;
  text-decoration: none;
}

.action-priority,
.action-status,
.action-route {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 4px 8px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-muted;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.action-body {
  display: grid;
  min-width: 0;
  gap: 4px;

  strong {
    color: $accent-primary;
    font-size: 13px;
  }

  small {
    color: $text-muted;
    font-size: 12px;
    line-height: 1.35;
  }
}

.action-route {
  color: $accent-info;
}

.kpi-card {
  min-height: 116px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;

  &.ok {
    border-color: rgba(var(--success-rgb), 0.35);
  }

  &.info {
    border-color: rgba(var(--accent-info-rgb), 0.35);
  }

  &.warn {
    border-color: rgba(var(--warning-rgb), 0.35);
  }

  &.danger {
    border-color: rgba(var(--error-rgb), 0.35);
  }

  &.muted {
    opacity: 0.85;
  }

  &.investor {
    color: inherit;
    text-decoration: none;
  }
}

.kpi-value {
  color: $accent-primary;
  font-size: 28px;
  font-weight: 900;
  line-height: 1;
}

.kpi-label {
  margin-top: 8px;
  color: $text-muted;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.kpi-note {
  margin-top: 8px;
  color: $text-secondary;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workstream-grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  margin-bottom: 12px;
}

.workstream-card,
.ops-panel {
  border: 1px solid $border-color;
  border-radius: $radius-md;
  background: $bg-card;
}

.workstream-card {
  min-height: 178px;
  padding: 14px;
}

.workstream-head,
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.workstream-head span,
.panel-title a {
  color: $accent-info;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.workstream-head a {
  color: $text-muted;
  font-size: 11px;
  font-weight: 700;
}

.workstream-card h3,
.ops-panel h3 {
  margin: 12px 0 8px;
  color: $accent-primary;
  font-size: 15px;
}

.workstream-card p {
  min-height: 42px;
  margin: 0;
  color: $text-muted;
  font-size: 12px;
  line-height: 1.5;
}

.workstream-links,
.command-link-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.workstream-links {
  margin-top: 14px;
}

.workstream-links a,
.command-link-grid a {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  background: $bg-primary;
  color: $text-secondary;
  font-size: 11px;
  font-weight: 700;
}

.workstream-links a:hover,
.command-link-grid a:hover,
.ops-row:hover {
  border-color: $accent-info;
  color: $accent-info;
}

.ops-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ops-panel {
  min-height: 226px;
  padding: 14px;
}

.panel-title h3 {
  margin: 0;
}

.panel-title p {
  margin: 5px 0 0;
  color: $text-muted;
  font-size: 12px;
  line-height: 1.4;
}

.ops-list {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.ops-row {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-primary;
  color: $text-primary;
}

.ops-row span,
.ops-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ops-row span {
  font-size: 13px;
  font-weight: 700;
}

.ops-row small,
.ops-empty {
  color: $text-muted;
  font-size: 12px;
}

.ops-empty {
  padding: 34px 0;
  text-align: center;
}

.command-link-grid {
  margin-top: 14px;
}

@media (max-width: 1100px) {
  .triage-grid,
  .ops-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: $breakpoint-mobile) {
  .dashboard-header {
    align-items: flex-start;
    flex-direction: column;
    padding-left: 56px !important;
  }

  .dashboard-actions {
    width: 100%;
  }

  .command-btn {
    flex: 1;
  }

  .dashboard-content {
    padding: 12px;
  }

  .executive-brief-card,
  .automatic-research-card,
  .today-priority-strip {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .automatic-research-title {
    display: grid;
    justify-items: start;
  }

  .autopilot-promise-strip {
    grid-template-columns: 1fr;
  }

  .automatic-research-flow article {
    grid-template-columns: auto minmax(0, 1fr);

    .flow-state {
      grid-column: 2;
      justify-self: start;
    }
  }

  .automatic-research-metrics {
    grid-template-columns: 1fr;

    article {
      min-height: 0;
    }
  }

  .coverage-focus-header {
    display: grid;
  }

  .coverage-focus-grid {
    grid-template-columns: 1fr;
  }

  .home-advanced-section {
    &[open] {
      padding: 0 10px 10px;
    }

    > summary {
      display: grid;
      justify-items: start;

      small {
        text-align: left;
      }
    }
  }

  .status-strip {
    position: static;
  }

  .next-action-row {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }

  .next-action-main {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .action-priority,
  .action-status,
  .action-route {
    justify-content: flex-start;
    width: fit-content;
  }
}
</style>
