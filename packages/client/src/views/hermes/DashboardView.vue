<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { fetchPerformanceRuntime, type PerformanceRuntimeSnapshot } from '@/api/hermes/performance-monitor'
import { fetchSessions, type SessionSummary } from '@/api/hermes/sessions'
import { listJobs, type Job } from '@/api/hermes/jobs'
import { getActiveProfileName, hasApiKey } from '@/api/client'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { useAppStore } from '@/stores/hermes/app'

const appStore = useAppStore()
const intelligence = useFeasibilityIntelligence()

const loading = ref(false)
const loadWarning = ref('')
const sessions = ref<SessionSummary[]>([])
const jobs = ref<Job[]>([])
const runtime = ref<PerformanceRuntimeSnapshot | null>(null)
const tokenReady = ref(false)
const activeProfileName = ref('default')
const lastUpdated = ref('')

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
    label: 'Research Jobs',
    value: String(intelligence.state.value.researchJobs.length),
    note: 'Created from intelligence pages',
    tone: intelligence.state.value.researchJobs.length > 0 ? 'info' : 'muted',
    to: { name: 'hermes.researchResultReview' },
  },
  {
    label: 'Deck Materials',
    value: String(intelligence.approvedPresentationCount.value),
    note: 'Approved for draft only',
    tone: intelligence.approvedPresentationCount.value > 0 ? 'info' : 'muted',
    to: { name: 'hermes.investorPresentation' },
  },
])

const workspaceActions = [
  {
    label: 'Continue Chat',
    detail: 'Resume Hermes conversation work.',
    to: { name: 'hermes.chat' },
  },
  {
    label: 'Open Feasibility Studio',
    detail: 'Work on feasibility drafts, questions, gaps, and outputs.',
    to: { name: 'hermes.feasibility' },
  },
  {
    label: 'Open Investor Readiness',
    detail: 'Check evidence gaps, risks, and investor-safe preparation status.',
    to: { name: 'hermes.investorReadiness' },
  },
  {
    label: 'Open IRR Calculator',
    detail: 'Model assumptions, NPV, IRR, MIRR, payback, and sensitivity.',
    to: { name: 'hermes.investmentCalculator' },
  },
  {
    label: 'Open Projects',
    detail: 'Choose the research or feasibility workspace to continue.',
    to: { name: 'hermes.projects' },
  },
  {
    label: 'Open Research Library',
    detail: 'Use history, memory, and saved evidence paths.',
    to: { name: 'hermes.research' },
  },
  {
    label: 'Open Documents',
    detail: 'Access Hermes files and uploaded evidence.',
    to: { name: 'hermes.files' },
  },
  {
    label: 'Open Tasks',
    detail: 'Track work in the existing Kanban board.',
    to: { name: 'hermes.kanban' },
  },
  {
    label: 'Open Reports',
    detail: 'Prepare outputs and check existing usage analytics.',
    to: { name: 'hermes.reportsHub' },
  },
  {
    label: 'Open Memory',
    detail: 'Review retained Hermes memory.',
    to: { name: 'hermes.memory' },
  },
]

const workstreams = [
  {
    group: 'Feasibility',
    title: 'Chemicon Feasibility Workspace',
    detail: 'Focus area for feasibility drafts, questions, evidence gaps, documents, tasks, and reports.',
    to: { name: 'hermes.feasibility' },
    links: [
      { label: 'Studio', to: { name: 'hermes.feasibility' } },
      { label: 'Investor Readiness', to: { name: 'hermes.investorReadiness' } },
      { label: 'IRR', to: { name: 'hermes.investmentCalculator' } },
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
  tokenReady.value = hasApiKey()
  activeProfileName.value = getActiveProfileName() || 'default'

  let partialFailure = false
  await appStore.checkConnection()

  if (!tokenReady.value) {
    sessions.value = []
    jobs.value = []
    runtime.value = null
    lastUpdated.value = formatUpdatedAt()
    loading.value = false
    return
  }

  const [modelsResult, sessionsResult, jobsResult, runtimeResult] = await Promise.allSettled([
    appStore.loadModels(true),
    fetchSessions(undefined, 6),
    listJobs(),
    fetchPerformanceRuntime(),
  ])

  if (modelsResult.status === 'rejected') partialFailure = true
  if (sessionsResult.status === 'fulfilled') sessions.value = sessionsResult.value
  else partialFailure = true
  if (jobsResult.status === 'fulfilled') jobs.value = jobsResult.value
  else partialFailure = true
  if (runtimeResult.status === 'fulfilled') runtime.value = runtimeResult.value
  else partialFailure = true

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
        <RouterLink class="command-btn primary" :to="{ name: 'hermes.chat' }">Continue Chat</RouterLink>
        <RouterLink class="command-btn" :to="{ name: 'hermes.feasibility' }">Feasibility</RouterLink>
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

      <section class="workspace-action-grid" aria-label="Research workspace shortcuts">
        <RouterLink v-for="action in workspaceActions" :key="action.label" class="workspace-action" :to="action.to">
          <span>{{ action.label }}</span>
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
        <article v-for="stream in workstreams" :key="stream.group" class="workstream-card">
          <div class="workstream-head">
            <span>{{ stream.group }}</span>
            <RouterLink :to="stream.to">Open</RouterLink>
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

        <article class="ops-panel">
          <div class="panel-title">
            <h3>Hermes System</h3>
            <RouterLink :to="{ name: 'hermes.settings' }">Settings</RouterLink>
          </div>
          <div class="command-link-grid">
            <RouterLink v-for="link in commandLinks" :key="link.label" :to="link.to">
              {{ link.label }}
            </RouterLink>
          </div>
        </article>
      </section>
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

.workspace-action-grid,
.investor-snapshot-grid,
.kpi-grid,
.workstream-grid,
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
}

.workspace-action {
  display: grid;
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

  span {
    color: $accent-primary;
    font-size: 14px;
    font-weight: 800;
  }

  small {
    color: $text-muted;
    font-size: 12px;
    line-height: 1.45;
  }
}

.kpi-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 12px;
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

  .status-strip {
    position: static;
  }
}
</style>
