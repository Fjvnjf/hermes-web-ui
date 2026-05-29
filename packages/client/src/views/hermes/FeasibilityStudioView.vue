<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'

type RouteName =
  | 'hermes.chat'
  | 'hermes.files'
  | 'hermes.kanban'
  | 'hermes.memory'
  | 'hermes.history'
  | 'hermes.reportsHub'

type ChecklistStatus =
  | 'To Verify'
  | 'Missing'
  | 'User Provided'
  | 'Assumption'
  | 'Evidence Needed'

interface WorkspaceLink {
  label: string
  routeName: RouteName
  note: string
}

interface WorkflowStep {
  title: string
  description: string
  routeName: RouteName
  action: string
}

interface ChecklistItem {
  label: string
  status: ChecklistStatus
  nextAction: string
  routeName: RouteName
  routeLabel: string
}

interface ChecklistGroup {
  code: string
  title: string
  items: ChecklistItem[]
}

interface ReportDraft {
  title: string
  description: string
}

const message = useMessage()
const kanbanStore = useKanbanStore()
const creatingTaskKey = ref<string | null>(null)
const taskErrors = ref<Record<string, string>>({})
const createdTasks = ref<Record<string, string>>({})
const manualTaskText = ref('')
const boardLoading = ref(false)

const workspaceLinks: WorkspaceLink[] = [
  {
    label: 'Chat',
    routeName: 'hermes.chat',
    note: 'opens real Hermes chat',
  },
  {
    label: 'Documents',
    routeName: 'hermes.files',
    note: 'opens real Hermes files',
  },
  {
    label: 'Tasks',
    routeName: 'hermes.kanban',
    note: 'opens real Hermes Kanban',
  },
  {
    label: 'Memory',
    routeName: 'hermes.memory',
    note: 'opens real Hermes memory',
  },
  {
    label: 'History',
    routeName: 'hermes.history',
    note: 'opens real Hermes history',
  },
  {
    label: 'Reports Hub',
    routeName: 'hermes.reportsHub',
    note: 'opens report workspace shell',
  },
]

const workflowSteps: WorkflowStep[] = [
  {
    title: 'Ask Hermes in Chat',
    description: 'Use Chat for analysis, supplier questions, feasibility assumptions, and draft review.',
    routeName: 'hermes.chat',
    action: 'Open Chat',
  },
  {
    title: 'Save durable facts',
    description: 'Store confirmed facts in Memory or source files. This page does not save checklist state yet.',
    routeName: 'hermes.memory',
    action: 'Open Memory',
  },
  {
    title: 'Create missing-work tasks',
    description: 'Use Kanban to track quotes, regulatory checks, document requests, and interview follow-ups.',
    routeName: 'hermes.kanban',
    action: 'Open Tasks',
  },
  {
    title: 'Upload evidence',
    description: 'Use Documents for TDS/SDS files, quotes, licenses, calculations, and draft outputs.',
    routeName: 'hermes.files',
    action: 'Open Documents',
  },
  {
    title: 'Prepare report drafts',
    description: 'Use Reports Hub and Files for draft outlines until a real report generator is added.',
    routeName: 'hermes.reportsHub',
    action: 'Open Reports',
  },
]

const checklistGroups: ChecklistGroup[] = [
  {
    code: 'A',
    title: 'Company / Legal',
    items: [
      { label: 'China company name', status: 'To Verify', nextAction: 'Confirm exact registered Chinese and English names.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
      { label: 'business license', status: 'Missing', nextAction: 'Upload license copy when available.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'business scope', status: 'Evidence Needed', nextAction: 'Verify permitted chemical trading/manufacturing scope.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
      { label: 'bank confirmation', status: 'Missing', nextAction: 'Track bank-account confirmation request.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'import/export permission', status: 'To Verify', nextAction: 'Confirm required permission and supporting documents.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
    ],
  },
  {
    code: 'B',
    title: 'Product',
    items: [
      { label: 'CWAS 90%+ TDS', status: 'Missing', nextAction: 'Upload source TDS or request supplier document.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'CWAS 90%+ SDS', status: 'Missing', nextAction: 'Upload SDS and check regulatory classification.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'CWMS 70% TDS', status: 'Missing', nextAction: 'Upload source TDS or prepare technical summary.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'CWMS 70% SDS', status: 'Missing', nextAction: 'Upload SDS and compare hazard statements.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'formula/CAS list', status: 'Evidence Needed', nextAction: 'Create a protected working note with formula/CAS references.', routeName: 'hermes.memory', routeLabel: 'Memory' },
      { label: 'raw material cost sheet', status: 'Missing', nextAction: 'Upload spreadsheet or create a task to request quotes.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
    ],
  },
  {
    code: 'C',
    title: 'Raw Materials',
    items: [
      { label: 'stearic acid source', status: 'To Verify', nextAction: 'Collect supplier names, specs, MOQ, and quote terms.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'TEA source', status: 'To Verify', nextAction: 'Collect local/import source options and purity specs.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'DMS meaning confirmation', status: 'To Verify', nextAction: 'Confirm exact chemical meaning before any costing.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
      { label: 'DMS regulatory status', status: 'Evidence Needed', nextAction: 'Track regulatory check and evidence source.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'supplier quotes', status: 'Missing', nextAction: 'Upload quotes and record supplier assumptions.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'import/landed cost', status: 'Assumption', nextAction: 'Build assumptions only after quotes, duty, freight, and VAT are known.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
    ],
  },
  {
    code: 'D',
    title: 'Factory / Plant',
    items: [
      { label: 'location shortlist', status: 'To Verify', nextAction: 'Compare locations only with real rent, utility, and permit evidence.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'factory rent', status: 'Missing', nextAction: 'Collect written rent offers and lease conditions.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'factory approval for chemicals', status: 'Evidence Needed', nextAction: 'Confirm allowed activity with landlord/local authority.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'machine quotes', status: 'Missing', nextAction: 'Upload machine quotes and technical specifications.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'batch capacity', status: 'Assumption', nextAction: 'Calculate capacity from real machine quote and process cycle time.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
      { label: 'utility requirements', status: 'To Verify', nextAction: 'Confirm power, steam, water, ventilation, and waste requirements.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
    ],
  },
  {
    code: 'E',
    title: 'Market',
    items: [
      { label: 'target customer type', status: 'User Provided', nextAction: 'Record confirmed target segment in Memory when finalized.', routeName: 'hermes.memory', routeLabel: 'Memory' },
      { label: 'competitor price proof', status: 'Evidence Needed', nextAction: 'Upload screenshots, quotes, invoices, or distributor proof.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: 'customer interviews', status: 'Missing', nextAction: 'Create tasks for interview targets and questions.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'distributor contacts', status: 'Missing', nextAction: 'Track distributor outreach and responses.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'China price validation', status: 'Evidence Needed', nextAction: 'Ask Hermes to prepare a validation checklist, then verify with real sources.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
    ],
  },
  {
    code: 'F',
    title: 'Finance / Investment',
    items: [
      { label: 'Year 1 15,000 MT model', status: 'Assumption', nextAction: 'Keep as a planning assumption until price, cost, and capacity evidence is uploaded.', routeName: 'hermes.files', routeLabel: 'Documents' },
      { label: '60,000 MT scale-up model', status: 'Assumption', nextAction: 'Do not promote until Year 1 assumptions are validated.', routeName: 'hermes.chat', routeLabel: 'Ask Hermes' },
      { label: 'working capital assumptions', status: 'To Verify', nextAction: 'Track inventory, receivables, payables, and cash-cycle assumptions.', routeName: 'hermes.kanban', routeLabel: 'Create Task' },
      { label: 'investor structure', status: 'To Verify', nextAction: 'Capture options as notes, not claims, until legal review.', routeName: 'hermes.memory', routeLabel: 'Memory' },
      { label: 'use of funds', status: 'Evidence Needed', nextAction: 'Tie every fund-use line to machine, rent, inventory, or operating evidence.', routeName: 'hermes.files', routeLabel: 'Documents' },
    ],
  },
]

const suggestedTasks = [
  'Verify China business scope for chemical trading/manufacturing',
  'Collect CWAS 90%+ TDS and SDS from supplier',
  'Confirm DMS chemical meaning and regulatory status',
  'Request written machine quote with batch capacity',
  'Upload competitor price evidence for China validation',
  'Validate Year 1 15,000 MT assumptions with source documents',
]

const evidenceGuidance = [
  'Upload source evidence in Documents: licenses, TDS/SDS, quotes, rent offers, interview notes, and spreadsheets.',
  'Store durable confirmed facts in Memory so Hermes can reuse them across sessions.',
  'Track missing proof as Tasks in Kanban instead of leaving gaps inside chat.',
  'Use Reports Hub and Files for prepared outputs until automatic report generation is added.',
]

const reportDrafts: ReportDraft[] = [
  {
    title: 'Feasibility Study Draft',
    description: 'Not generated yet - use Reports/Files for drafts.',
  },
  {
    title: 'Investor Brief Draft',
    description: 'Not generated yet - use Reports/Files for drafts.',
  },
  {
    title: 'Product/Raw Material Summary',
    description: 'Not generated yet - use Reports/Files for drafts.',
  },
  {
    title: 'Location Comparison',
    description: 'Not generated yet - use Reports/Files for drafts.',
  },
  {
    title: 'Regulatory Risk Note',
    description: 'Not generated yet - use Reports/Files for drafts.',
  },
]

const statusClass = (status: ChecklistStatus) => `status-${status.toLowerCase().replace(/\s+/g, '-')}`

const selectedKanbanBoardLabel = computed(() => {
  const selected = kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD
  const board = kanbanStore.activeBoards.find(item => item.slug === selected)
  if (!board) return selected
  return board.name && board.name !== board.slug ? `${board.name} (${board.slug})` : board.slug
})

onMounted(async () => {
  boardLoading.value = true
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
  } finally {
    boardLoading.value = false
  }
})

function itemKey(group: ChecklistGroup, item: ChecklistItem): string {
  return `${group.code}:${item.label}`
}

function priorityForItem(group: ChecklistGroup, item: ChecklistItem): number {
  const criticalTerms = ['business scope', 'import/export', 'regulatory', 'factory approval', 'DMS regulatory']
  const isCriticalCategory = ['C', 'D', 'F'].includes(group.code)
  const isCriticalItem = criticalTerms.some(term => item.label.toLowerCase().includes(term.toLowerCase()))
  return isCriticalCategory || isCriticalItem ? 3 : 2
}

function priorityLabel(priority: number): string {
  return priority >= 3 ? 'High' : 'Medium'
}

function taskBody(group: ChecklistGroup, item: ChecklistItem): string {
  const priority = priorityForItem(group, item)
  return [
    `Project: Chemicon China Feasibility`,
    `Planning scope: Year 1 15,000 MT feasibility`,
    `Category: ${group.code}. ${group.title}`,
    `Checklist item: ${item.label}`,
    `Current evidence status: ${item.status}`,
    `Recommended next action: ${item.nextAction}`,
    `Source page: Feasibility Studio`,
    `Suggested initial column: Triage / To Verify`,
    `Priority guidance: ${priorityLabel(priority)}`,
    `Tags: Chemicon China Feasibility, Feasibility, Evidence Gap`,
    '',
    'Note: This task was created from a static checklist item. Checklist status is not persistent yet; the Kanban task is persistent after the API confirms creation.',
  ].join('\n')
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Unknown error'
}

async function createChecklistTask(group: ChecklistGroup, item: ChecklistItem) {
  const key = itemKey(group, item)
  taskErrors.value = { ...taskErrors.value, [key]: '' }
  const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
  if (!board) {
    taskErrors.value = {
      ...taskErrors.value,
      [key]: 'Open Tasks/Kanban and create/select a board first.',
    }
    return
  }

  creatingTaskKey.value = key
  try {
    kanbanStore.setSelectedBoard(board)
    const task = await kanbanStore.createTask({
      title: item.label,
      body: taskBody(group, item),
      priority: priorityForItem(group, item),
      tenant: 'Chemicon China Feasibility',
    })
    createdTasks.value = { ...createdTasks.value, [key]: task.id }
    message.success(`Created Kanban task: ${item.label}`)
  } catch (err) {
    const detail = errorMessage(err)
    taskErrors.value = {
      ...taskErrors.value,
      [key]: `${detail}. Open Tasks/Kanban and create/select a board first if the current board is unavailable.`,
    }
    message.error('Could not create Kanban task')
  } finally {
    creatingTaskKey.value = null
  }
}

async function copyTaskText(group: ChecklistGroup, item: ChecklistItem) {
  const text = [`Title: ${item.label}`, '', taskBody(group, item)].join('\n')
  manualTaskText.value = text
  try {
    await navigator.clipboard.writeText(text)
    message.success('Task text copied')
  } catch {
    message.warning('Copy is blocked in this browser. The task text is shown below.')
  }
}
</script>

<template>
  <div class="workspace-shell">
    <header class="studio-hero">
      <div>
        <p class="eyebrow">Working feasibility workspace</p>
        <h2 class="header-title">Chemicon China Feasibility</h2>
        <p class="page-copy">
          Practical workspace for Year 1 15,000 MT feasibility research, evidence collection, document organization,
          task tracking, and report preparation. Connected actions open real Hermes features; checklist items are
          static templates until project storage is added.
        </p>
      </div>
      <div class="quick-actions" aria-label="Feasibility quick links">
        <RouterLink
          v-for="link in workspaceLinks"
          :key="link.label"
          class="shell-link"
          :to="{ name: link.routeName }"
        >
          <span>{{ link.label }}</span>
          <small>{{ link.note }}</small>
        </RouterLink>
      </div>
    </header>

    <section class="workflow-section" aria-labelledby="workflow-title">
      <div class="section-heading">
        <p class="eyebrow">Connected workflow</p>
        <h3 id="workflow-title">Current Practical Workflow</h3>
        <p>
          This page coordinates real Hermes tools. It does not save checklist state or create tasks automatically yet.
        </p>
      </div>
      <div class="workflow-grid">
        <article v-for="(step, index) in workflowSteps" :key="step.title" class="workflow-card">
          <span class="step-index">{{ index + 1 }}</span>
          <h4>{{ step.title }}</h4>
          <p>{{ step.description }}</p>
          <RouterLink class="inline-link" :to="{ name: step.routeName }">{{ step.action }}</RouterLink>
        </article>
      </div>
    </section>

    <section class="capture-chat-section" aria-labelledby="capture-chat-title">
      <div>
        <p class="eyebrow">Session capture</p>
        <h3 id="capture-chat-title">Capture from Chat</h3>
        <p>
          After discussing feasibility with Hermes, use Review & Capture in Chat to turn useful points into tasks,
          evidence gaps, notes, and report snippets. Hermes suggests; you approve before anything is saved.
        </p>
      </div>
      <div class="capture-chat-actions">
        <RouterLink class="primary-link" :to="{ name: 'hermes.chat', query: { captureContext: 'chemicon' } }">Open Chat</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.memory' }">Open Memory</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.files' }">Open Documents</RouterLink>
      </div>
    </section>

    <section class="guidance-section" aria-labelledby="task-guidance-title">
      <div class="guidance-card">
        <div>
          <p class="eyebrow">Manual task bridge</p>
          <h3 id="task-guidance-title">Quick Create Task Guidance</h3>
          <p>
            Checklist actions now create real Kanban tasks using the existing Hermes Tasks API. Created tasks are
            persistent after the API confirms creation. Checklist status on this page is still not persistent.
          </p>
          <p class="board-note">
            Current Kanban board: <strong>{{ selectedKanbanBoardLabel }}</strong>
            <span v-if="boardLoading">checking...</span>
          </p>
        </div>
        <RouterLink class="primary-link" :to="{ name: 'hermes.kanban' }">Create in Tasks</RouterLink>
      </div>
      <div v-if="manualTaskText" class="fallback-copy-panel" aria-live="polite">
        <div>
          <strong>Fallback task text</strong>
          <p>Copy this into Tasks if the browser blocks clipboard access or task creation is unavailable.</p>
        </div>
        <textarea :value="manualTaskText" readonly rows="7" />
      </div>
      <div class="task-copy-list" aria-label="Suggested task text">
        <article v-for="task in suggestedTasks" :key="task" class="task-copy-card">
          <span>{{ task }}</span>
          <RouterLink :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
        </article>
      </div>
    </section>

    <section class="checklist-section" aria-labelledby="checklist-title">
      <div class="section-heading">
        <p class="eyebrow">Template checklist</p>
        <h3 id="checklist-title">Chemicon Feasibility Checklist</h3>
        <p>
          Static frontend checklist for planning. Status labels are guidance only and are not saved as project data.
        </p>
      </div>

      <div class="checklist-groups">
        <article v-for="group in checklistGroups" :key="group.code" class="checklist-group">
          <header>
            <span>{{ group.code }}</span>
            <h4>{{ group.title }}</h4>
          </header>
          <div class="checklist-items">
            <div v-for="item in group.items" :key="`${group.code}-${item.label}`" class="checklist-item">
              <div class="item-main">
                <strong>{{ item.label }}</strong>
                <p>{{ item.nextAction }}</p>
              </div>
              <div class="item-actions">
                <span class="status-pill" :class="statusClass(item.status)">{{ item.status }}</span>
                <NButton
                  size="tiny"
                  class="create-task-button"
                  :loading="creatingTaskKey === itemKey(group, item)"
                  @click="createChecklistTask(group, item)"
                >
                  Create Task
                </NButton>
                <NButton
                  size="tiny"
                  quaternary
                  class="copy-task-button"
                  @click="copyTaskText(group, item)"
                >
                  Copy Text
                </NButton>
                <RouterLink class="mini-link" :to="{ name: item.routeName }">{{ item.routeLabel }}</RouterLink>
                <RouterLink
                  v-if="createdTasks[itemKey(group, item)]"
                  class="created-link"
                  :to="{ name: 'hermes.kanban' }"
                >
                  Task created
                </RouterLink>
              </div>
              <p v-if="taskErrors[itemKey(group, item)]" class="task-error">
                {{ taskErrors[itemKey(group, item)] }}
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="evidence-section" aria-labelledby="evidence-title">
      <div class="section-heading">
        <p class="eyebrow">Evidence handling</p>
        <h3 id="evidence-title">Evidence Links Guidance</h3>
      </div>
      <div class="evidence-grid">
        <article v-for="guidance in evidenceGuidance" :key="guidance" class="evidence-card">
          {{ guidance }}
        </article>
      </div>
      <div class="evidence-actions">
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.files' }">Documents</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.memory' }">Memory</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.kanban' }">Tasks</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.reportsHub' }">Reports</RouterLink>
      </div>
    </section>

    <section class="report-section" aria-labelledby="report-title">
      <div class="section-heading">
        <p class="eyebrow">File-based drafts</p>
        <h3 id="report-title">Report Preparation</h3>
        <p>
          These are not generated yet. Use Reports Hub for planning and Documents for actual draft files.
        </p>
      </div>
      <div class="report-grid">
        <article v-for="draft in reportDrafts" :key="draft.title" class="report-card">
          <h4>{{ draft.title }}</h4>
          <p>{{ draft.description }}</p>
        </article>
      </div>
      <div class="evidence-actions">
        <RouterLink class="primary-link" :to="{ name: 'hermes.reportsHub' }">Open Reports Hub</RouterLink>
        <RouterLink class="shell-link compact" :to="{ name: 'hermes.files' }">Open Documents</RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.workspace-shell {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.studio-hero,
.workflow-section,
.capture-chat-section,
.guidance-section,
.checklist-section,
.evidence-section,
.report-section {
  margin-bottom: 18px;
}

.studio-hero,
.workflow-section,
.capture-chat-section,
.guidance-card,
.checklist-group,
.evidence-section,
.report-section {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.studio-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 460px);
  gap: 18px;
  align-items: start;
  padding: 18px;
}

.capture-chat-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 16px;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 18px;
  }

  p {
    max-width: 780px;
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.capture-chat-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.page-copy,
.section-heading p,
.workflow-card p,
.guidance-card p,
.checklist-item p,
.report-card p {
  color: $text-secondary;
  line-height: 1.55;
}

.page-copy {
  max-width: 760px;
  margin: 8px 0 0;
}

.quick-actions,
.evidence-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-actions {
  justify-content: flex-end;
}

.shell-link,
.primary-link,
.inline-link,
.mini-link {
  display: inline-flex;
  align-items: center;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  font-weight: 800;
  text-decoration: none;
}

.shell-link {
  min-height: 48px;
  flex: 1 1 135px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 8px 12px;
  color: $accent-info;

  small {
    margin-top: 2px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 700;
  }

  &:hover {
    border-color: $accent-info;
    color: $accent-info-hover;
    background: rgba(var(--accent-info-rgb), 0.08);
  }

  &.compact {
    min-height: 34px;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    padding: 0 12px;
  }
}

.primary-link {
  min-height: 36px;
  padding: 0 14px;
  color: $bg-primary;
  background: $accent-primary;
  border-color: $accent-primary;

  &:hover {
    background: $accent-hover;
    border-color: $accent-hover;
  }
}

.inline-link,
.mini-link {
  min-height: 30px;
  padding: 0 10px;
  color: $accent-info;

  &:hover {
    border-color: $accent-info;
    background: rgba(var(--accent-info-rgb), 0.08);
  }
}

.section-heading {
  padding: 16px 16px 0;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 18px;
  }

  p {
    margin: 8px 0 0;
  }
}

.workflow-grid,
.report-grid,
.evidence-grid,
.task-copy-list {
  display: grid;
  gap: 12px;
}

.workflow-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  padding: 16px;
}

.workflow-card,
.task-copy-card,
.evidence-card,
.report-card {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-panel;
}

.workflow-card {
  position: relative;
  min-height: 180px;
  padding: 16px;

  h4 {
    margin: 0 0 8px;
    color: $text-primary;
    font-size: 15px;
  }

  p {
    min-height: 68px;
    margin: 0 0 14px;
  }
}

.step-index {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  margin-bottom: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.45);
  border-radius: 999px;
  color: $accent-info;
  font-size: 12px;
  font-weight: 900;
}

.guidance-card {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding: 16px;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 18px;
  }

  p {
    margin: 8px 0 0;
  }
}

.board-note {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;

  strong {
    color: $accent-info;
  }
}

.fallback-copy-panel {
  display: grid;
  grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
  gap: 12px;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.35);
  border-radius: $radius-sm;
  background: $bg-panel;

  strong {
    color: $text-primary;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    line-height: 1.5;
  }

  textarea {
    width: 100%;
    resize: vertical;
    padding: 10px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    color: $text-primary;
    background: $bg-input;
    font-family: $font-code;
    font-size: 12px;
    line-height: 1.45;
  }
}

.task-copy-list {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-top: 12px;
}

.task-copy-card {
  display: flex;
  min-height: 74px;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 12px;

  span {
    color: $text-primary;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.4;
  }

  a {
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;
    white-space: nowrap;
  }
}

.checklist-groups {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.checklist-group {
  overflow: hidden;

  > header {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    border-bottom: 1px solid $border-color;

    span {
      display: inline-grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: $radius-sm;
      color: $bg-primary;
      background: $accent-primary;
      font-size: 12px;
      font-weight: 900;
    }

    h4 {
      margin: 0;
      color: $text-primary;
      font-size: 15px;
    }
  }
}

.checklist-items {
  display: grid;
}

.checklist-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, auto);
  gap: 12px;
  align-items: center;
  padding: 12px 14px;

  + .checklist-item {
    border-top: 1px solid $border-color;
  }
}

.item-main {
  strong {
    color: $text-primary;
    font-size: 14px;
  }

  p {
    margin: 4px 0 0;
    font-size: 12px;
  }
}

.item-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.status-pill {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  padding: 0 9px;
  border: 1px solid $border-color;
  border-radius: 999px;
  color: $text-secondary;
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;

  &.status-to-verify {
    color: $accent-info;
    border-color: rgba(var(--accent-info-rgb), 0.42);
  }

  &.status-missing {
    color: $error;
    border-color: rgba(var(--error-rgb), 0.45);
  }

  &.status-user-provided {
    color: $success;
    border-color: rgba(var(--success-rgb), 0.45);
  }

  &.status-assumption {
    color: $warning;
    border-color: rgba(var(--warning-rgb), 0.45);
  }

  &.status-evidence-needed {
    color: $accent-primary;
    border-color: rgba(var(--accent-primary-rgb), 0.45);
  }
}

.create-task-button,
.copy-task-button {
  font-weight: 800;
}

.created-link {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 9px;
  border: 1px solid rgba(var(--success-rgb), 0.45);
  border-radius: 999px;
  color: $success;
  font-size: 11px;
  font-weight: 900;
  text-decoration: none;
}

.task-error {
  grid-column: 1 / -1;
  margin: 0;
  color: $error;
  font-size: 12px;
  line-height: 1.45;
}

.evidence-section,
.report-section {
  padding-bottom: 16px;
}

.evidence-grid {
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  padding: 16px;
}

.evidence-card {
  padding: 14px;
  color: $text-secondary;
  line-height: 1.5;
}

.evidence-actions {
  padding: 0 16px;
}

.report-grid {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  padding: 16px;
}

.report-card {
  min-height: 112px;
  padding: 14px;

  h4 {
    margin: 0 0 8px;
    color: $text-primary;
    font-size: 15px;
  }

  p {
    margin: 0;
    font-size: 13px;
  }
}

@media (max-width: 860px) {
  .studio-hero {
    grid-template-columns: 1fr;
  }

  .capture-chat-section {
    grid-template-columns: 1fr;
  }

  .capture-chat-actions {
    justify-content: flex-start;
  }

  .quick-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .workspace-shell {
    padding: 12px;
  }

  .studio-hero,
  .workflow-section,
  .capture-chat-section,
  .guidance-card,
  .checklist-section,
  .evidence-section,
  .report-section {
    margin-bottom: 12px;
  }

  .guidance-card,
  .checklist-item,
  .task-copy-card {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }

  .guidance-card,
  .task-copy-card {
    flex-direction: column;
  }

  .guidance-card {
    align-items: stretch;
  }

  .fallback-copy-panel {
    grid-template-columns: 1fr;
  }

  .item-actions {
    justify-content: flex-start;
  }

  .primary-link,
  .inline-link,
  .mini-link,
  .shell-link.compact {
    justify-content: center;
  }
}
</style>
