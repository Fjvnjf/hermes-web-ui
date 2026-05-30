<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import { fetchSessions, type SessionSummary } from '@/api/hermes/sessions'
import { listFiles, type FileEntry } from '@/api/hermes/files'
import { listJobs, type Job } from '@/api/hermes/jobs'
import { fetchMemory, saveMemory } from '@/api/hermes/skills'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { listRecentCaptureActivities, type SessionCaptureActivity } from '@/composables/useSessionCapture'
import { copyToClipboard } from '@/utils/clipboard'
import { canAccessRouteName, getFrontendAccessRole } from '@/utils/accessControl'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const frontendRole = computed(() => getFrontendAccessRole())
const canUseRawMemory = computed(() => canAccessRouteName('hermes.memory', frontendRole.value))

const loading = ref(false)
const saving = ref(false)
const warning = ref('')
const lastUpdated = ref('')
const sessions = ref<SessionSummary[]>([])
const jobs = ref<Job[]>([])
const files = ref<FileEntry[]>([])
const memoryAvailable = ref(false)
const captureActivities = ref<SessionCaptureActivity[]>([])

const DAY_MS = 24 * 60 * 60 * 1000

function toMs(value: number | string | null | undefined): number {
  if (typeof value === 'number') return value > 1_000_000_000_000 ? value : value * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const cutoffMs = computed(() => Date.now() - DAY_MS)
const recentSessions = computed(() => sessions.value.filter(item => toMs(item.last_active || item.ended_at || item.started_at) >= cutoffMs.value))
const recentTasks = computed(() => kanbanStore.tasks.filter(item => toMs(item.created_at) >= cutoffMs.value))
const recentJobs = computed(() => jobs.value.filter(item => toMs(item.created_at || item.last_run_at) >= cutoffMs.value))
const completedJobs = computed(() => jobs.value.filter(item => toMs(item.last_run_at) >= cutoffMs.value && item.last_status && item.last_status !== 'running'))
const failedJobs = computed(() => jobs.value.filter(item => toMs(item.last_run_at) >= cutoffMs.value && item.last_error))
const recentFiles = computed(() => files.value.filter(item => toMs(item.modTime) >= cutoffMs.value))
const recentCaptures = computed(() => captureActivities.value.filter(item => toMs(item.capturedAt || item.lastCaptureAt) >= cutoffMs.value))
const recentResearchJobs = computed(() => intelligence.state.value.researchJobs.filter(item => toMs(item.createdAt) >= cutoffMs.value))
const recentResearchFindings = computed(() => intelligence.state.value.researchFindings.filter(item => toMs(item.createdAt) >= cutoffMs.value))
const recentFinancialModels = computed(() => intelligence.state.value.financialModels.filter(item => toMs(item.createdAt) >= cutoffMs.value))
const recentMarketClaims = computed(() => intelligence.state.value.marketClaims.filter(item => toMs(item.lastChecked) >= cutoffMs.value))
const recentCompetitors = computed(() => intelligence.state.value.competitors.filter(item => toMs(item.updatedAt) >= cutoffMs.value))

const limitedDataNotes = computed(() => [
  memoryAvailable.value ? 'Memory API is reachable, but memory sections do not expose per-item timestamps.' : 'Memory could not be checked during this refresh.',
  'Investor readiness changes are inferred from local evidence/research records when timestamps exist.',
  'Files are counted from the top-level Documents listing only.',
])

const activityCards = computed(() => [
  { label: 'Chats / Sessions', value: recentSessions.value.length, note: 'Real History API' },
  { label: 'Session Captures', value: recentCaptures.value.length, note: 'Local capture review log' },
  { label: 'Tasks Created', value: recentTasks.value.length, note: 'Real Kanban board' },
  { label: 'Files / Reports', value: recentFiles.value.length, note: 'Top-level Documents listing' },
  { label: 'Research Jobs', value: recentResearchJobs.value.length + recentJobs.value.length, note: 'Workspace + real Jobs API' },
  { label: 'Completed Jobs', value: completedJobs.value.length, note: 'Real Jobs API last run' },
  { label: 'Market Updates', value: recentMarketClaims.value.length + recentCompetitors.value.length, note: 'Local intelligence records' },
  { label: 'Errors / Failures', value: failedJobs.value.length, note: 'Real Jobs API last_error' },
])

const nextActions = computed(() => {
  const actions = []
  if (intelligence.evidenceGaps.value.length) actions.push(`Close evidence gaps: ${intelligence.evidenceGaps.value.slice(0, 2).map(item => item.label).join(', ')}`)
  if (recentResearchFindings.value.length) actions.push('Review new research findings before they update investor material.')
  if (!recentFinancialModels.value.length) actions.push('Save or update an IRR scenario if investment assumptions changed.')
  if (failedJobs.value.length) actions.push('Open Jobs and inspect failed research runs.')
  if (!actions.length) actions.push('No urgent automated action detected; continue from Chat or Feasibility Studio.')
  return actions
})

const briefText = computed(() => [
  'Hermes Daily Activity Brief',
  `Updated: ${lastUpdated.value || 'Not refreshed yet'}`,
  '',
  ...activityCards.value.map(card => `- ${card.label}: ${card.value} (${card.note})`),
  '',
  'Recommended next actions:',
  ...nextActions.value.map(action => `- ${action}`),
  '',
  'Data limitations:',
  ...limitedDataNotes.value.map(note => `- ${note}`),
].join('\n'))

async function refresh() {
  loading.value = true
  warning.value = ''
  try {
    const results = await Promise.allSettled([
      fetchSessions(undefined, 50),
      listJobs(),
      listFiles(''),
      kanbanStore.fetchBoards(),
      kanbanStore.fetchTasks(true),
      fetchMemory(),
    ])
    if (results[0].status === 'fulfilled') sessions.value = results[0].value
    if (results[1].status === 'fulfilled') jobs.value = results[1].value
    if (results[2].status === 'fulfilled') files.value = results[2].value.entries
    memoryAvailable.value = results[5].status === 'fulfilled'
    captureActivities.value = listRecentCaptureActivities(20)
    const failures = results.filter(item => item.status === 'rejected').length
    if (failures) warning.value = `${failures} activity source${failures === 1 ? '' : 's'} returned limited data.`
    lastUpdated.value = new Date().toLocaleString()
  } finally {
    loading.value = false
  }
}

async function copyBrief() {
  const ok = await copyToClipboard(briefText.value)
  if (ok) message.success('Daily brief copied')
  else message.warning('Copy failed; select the brief text manually')
}

async function createFollowUpTask() {
  saving.value = true
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: 'Review Hermes Daily Activity Brief',
      body: [
        briefText.value,
        '',
        'Source page: Last 24 Hours',
        'Tags: Daily Brief, Follow-up, Hermes Activity',
      ].join('\n'),
      priority: failedJobs.value.length || intelligence.evidenceGaps.value.length ? 2 : 1,
      tenant: 'Hermes Research Workspace',
    })
    message.success('Follow-up task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create follow-up task: ${detail}`)
  } finally {
    saving.value = false
  }
}

async function saveBriefToMemory() {
  saving.value = true
  try {
    const current = await fetchMemory()
    const next = [
      current.memory || '',
      '',
      '## Hermes Daily Activity Brief',
      briefText.value,
    ].join('\n').trim()
    await saveMemory('memory', next)
    message.success('Daily brief saved to Memory')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown memory error'
    message.error(`Could not save daily brief to Memory: ${detail}`)
  } finally {
    saving.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="last24-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Last 24 hours</p>
        <h2 class="header-title">Hermes Daily Activity Brief</h2>
        <p class="page-copy">
          A real activity view using existing History, Kanban, Files, Jobs, Memory reachability, and local intelligence
          capture logs. Missing timestamps are reported as limited data instead of guessed.
        </p>
      </div>
      <div class="header-actions">
        <NButton :loading="loading" @click="refresh">Refresh</NButton>
        <RouterLink class="shell-link" :to="{ name: 'hermes.dashboard' }">Home</RouterLink>
      </div>
    </header>

    <p v-if="warning" class="warning">{{ warning }}</p>

    <section class="summary-grid" aria-label="Daily activity counts">
      <article v-for="card in activityCards" :key="card.label" class="summary-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.note }}</small>
      </article>
    </section>

    <section class="brief-panel">
      <div>
        <h3>Copy-safe summary</h3>
        <p>This text can be copied, saved to Memory after approval, or turned into a follow-up Kanban task.</p>
      </div>
      <pre>{{ briefText }}</pre>
      <div class="action-row">
        <NButton secondary @click="copyBrief">Copy summary</NButton>
        <NButton secondary :loading="saving" @click="createFollowUpTask">Create follow-up task</NButton>
        <NButton v-if="canUseRawMemory" secondary :loading="saving" @click="saveBriefToMemory">Save summary to Memory</NButton>
      </div>
    </section>

    <section class="detail-grid">
      <article>
        <h3>Recent chats and captures</h3>
        <ul>
          <li v-for="session in recentSessions.slice(0, 6)" :key="session.id">
            <RouterLink :to="{ name: 'hermes.historySession', params: { sessionId: session.id } }">
              {{ session.title || session.preview || session.id }}
            </RouterLink>
            <small>{{ session.message_count }} messages</small>
          </li>
          <li v-if="!recentSessions.length">No recent sessions found in the History API.</li>
        </ul>
      </article>
      <article>
        <h3>Top recommended next actions</h3>
        <ul>
          <li v-for="action in nextActions" :key="action">{{ action }}</li>
        </ul>
      </article>
      <article>
        <h3>Limited data notes</h3>
        <ul>
          <li v-for="note in limitedDataNotes" :key="note">{{ note }}</li>
        </ul>
      </article>
    </section>
  </div>
</template>

<style scoped>
.last24-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header,
.brief-panel,
.detail-grid > article,
.summary-card {
  border: 1px solid rgba(128, 162, 190, 0.26);
  background: rgba(5, 14, 24, 0.82);
  border-radius: 8px;
  padding: 18px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow,
.summary-card span {
  color: #38d5ff;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0;
}

.header-title {
  margin: 4px 0;
  color: #f2c86b;
}

.page-copy,
small,
.brief-panel p,
li {
  color: #a8b6c7;
}

.header-actions,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.summary-grid,
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 14px;
}

.summary-card strong {
  display: block;
  margin: 8px 0;
  font-size: 28px;
  color: #f6fbff;
}

.brief-panel pre {
  max-height: 360px;
  overflow: auto;
  white-space: pre-wrap;
  border: 1px solid rgba(128, 162, 190, 0.22);
  border-radius: 8px;
  padding: 14px;
  color: #dce8f3;
  background: rgba(0, 0, 0, 0.24);
}

.shell-link {
  color: #38d5ff;
  text-decoration: none;
}

.warning {
  color: #f5bf5a;
}

ul {
  margin: 10px 0 0;
  padding-left: 18px;
}

li + li {
  margin-top: 8px;
}

@media (max-width: 720px) {
  .page-header {
    flex-direction: column;
  }
}
</style>
