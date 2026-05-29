<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  NAlert,
  NButton,
  NCheckbox,
  NDrawer,
  NDrawerContent,
  NSelect,
  NTag,
  useMessage,
  type SelectOption,
} from 'naive-ui'
import { fetchMemory, saveMemory } from '@/api/hermes/skills'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  captureContextOptions,
  categoryLabel,
  contextLabel,
  flattenCaptureDraft,
  formatCaptureSuggestionText,
  formatResearchSuggestionTask,
  generateDeepResearchSuggestions,
  generateSessionCaptureDraft,
  markCaptureReviewed,
  markCaptureSkipped,
  saveSessionCaptureSelection,
  type CaptureCategory,
  type CaptureContextId,
  type CaptureSuggestion,
  type DeepResearchSuggestion,
  type SessionCaptureDraft,
} from '@/composables/useSessionCapture'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import type { Message } from '@/stores/hermes/chat'
import { copyToClipboard } from '@/utils/clipboard'

const props = withDefaults(defineProps<{
  show: boolean
  sessionId: string | null
  sessionTitle?: string
  messages: Message[]
  initialContext?: CaptureContextId
}>(), {
  sessionTitle: '',
  initialContext: 'general-research',
})

const emit = defineEmits<{
  'update:show': [value: boolean]
  saved: []
  skipped: []
}>()

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const selectedContext = ref<CaptureContextId>(props.initialContext)
const draft = ref<SessionCaptureDraft | null>(null)
const selectedIds = ref<Set<string>>(new Set())
const saving = ref(false)
const fallbackText = ref('')
const saveErrors = ref<string[]>([])
const saveSessionSummary = ref(false)
const saveFullTranscript = ref(false)
const hiddenResearchSuggestions = ref<Set<string>>(new Set())
const creatingResearchTaskId = ref<string | null>(null)
const researchTaskStatus = ref<Record<string, string>>({})

const captureGroups = computed(() => {
  if (!draft.value) return []
  return [
    {
      key: 'tasks' as const,
      title: 'A. Tasks',
      description: 'Actionable things to do. Selected items become real Kanban tasks after approval.',
      items: draft.value.tasks,
    },
    {
      key: 'evidenceGaps' as const,
      title: 'B. Evidence Gaps',
      description: 'Missing proof or source documents. Saved as Kanban tasks tagged in the description as evidence gaps.',
      items: draft.value.evidenceGaps,
    },
    {
      key: 'researchNotes' as const,
      title: 'C. Research Notes',
      description: 'Useful session notes. Selected items append to Memory if the Memory API confirms save.',
      items: draft.value.researchNotes,
    },
    {
      key: 'memoryCandidates' as const,
      title: 'D. Memory Candidates',
      description: 'Durable facts worth saving. These are not preselected unless confidence is high.',
      items: draft.value.memoryCandidates,
    },
    {
      key: 'reportSnippets' as const,
      title: 'E. Report Snippets',
      description: 'Prepared text for future drafts. Selected snippets stage as To Verify material in Presentation Builder.',
      items: draft.value.reportSnippets,
    },
  ]
})

const allSuggestions = computed(() => draft.value ? flattenCaptureDraft(draft.value) : [])
const captureContextSelectOptions = computed<SelectOption[]>(() =>
  captureContextOptions.map(option => ({
    label: option.label,
    value: option.value,
  })),
)
const sourceSessionLabel = computed(() => props.sessionId ? props.sessionId.slice(0, 10) : 'current session')
const hasSuggestions = computed(() => allSuggestions.value.length > 0)
const deepResearchSuggestions = computed(() =>
  generateDeepResearchSuggestions(props.messages, selectedContext.value)
    .filter(item => !hiddenResearchSuggestions.value.has(item.id)),
)

watch(
  () => props.show,
  (visible) => {
    if (visible) resetDraft()
  },
  { immediate: true },
)

watch(
  () => props.initialContext,
  (value) => {
    selectedContext.value = value
    if (props.show) resetDraft()
  },
)

watch(selectedContext, () => {
  if (props.show) resetDraft(false)
})

function resetDraft(resetContext = true) {
  if (resetContext) selectedContext.value = props.initialContext
  fallbackText.value = ''
  saveErrors.value = []
  saveSessionSummary.value = false
  saveFullTranscript.value = false
  hiddenResearchSuggestions.value = new Set()
  researchTaskStatus.value = {}
  draft.value = generateSessionCaptureDraft(props.messages, {
    context: selectedContext.value,
    sessionTitle: props.sessionTitle,
  })
  selectedIds.value = new Set(
    flattenCaptureDraft(draft.value)
      .filter(item => item.defaultSelected)
      .map(item => item.id),
  )
}

function closeDrawer() {
  emit('update:show', false)
}

function setChecked(item: CaptureSuggestion, checked: boolean) {
  const next = new Set(selectedIds.value)
  if (checked) next.add(item.id)
  else next.delete(item.id)
  selectedIds.value = next
}

function targetLabel(item: CaptureSuggestion): string {
  if (item.target === 'kanban') return 'Tasks/Kanban'
  if (item.target === 'memory') return 'Memory'
  if (item.category === 'reportSnippets') return 'Presentation Builder (To Verify)'
  return 'Copy / Reports draft'
}

function priorityType(priority?: string): 'error' | 'warning' | 'info' | 'default' {
  if (priority === 'high') return 'error'
  if (priority === 'medium') return 'warning'
  if (priority === 'low') return 'info'
  return 'default'
}

function categorySelectedCount(category: CaptureCategory): number {
  return allSuggestions.value.filter(item => item.category === category && selectedIds.value.has(item.id)).length
}

function formatAllSuggestions(items = allSuggestions.value): string {
  const source = {
    sessionId: props.sessionId || 'current',
    sessionTitle: props.sessionTitle,
    contextLabel: contextLabel(selectedContext.value),
    capturedAt: new Date(),
  }
  return items.map(item => formatCaptureSuggestionText(item, source)).join('\n\n---\n\n')
}

async function copyAll() {
  const text = formatAllSuggestions()
  fallbackText.value = text
  const ok = await copyToClipboard(text)
  if (ok) message.success('Session capture text copied')
  else message.warning('Clipboard copy was blocked. The text is shown for manual copy.')
}

function handleSkip() {
  if (props.sessionId) markCaptureSkipped(props.sessionId)
  emit('skipped')
  closeDrawer()
}

async function addSelected() {
  if (!draft.value || (selectedIds.value.size === 0 && !saveSessionSummary.value && !saveFullTranscript.value)) {
    message.warning('Select at least one item, summary, or transcript option to save or copy.')
    return
  }
  saving.value = true
  saveErrors.value = []
  fallbackText.value = ''
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    const result = await saveSessionCaptureSelection(
      draft.value,
      selectedIds.value,
      {
        sessionId: props.sessionId || 'current',
        sessionTitle: props.sessionTitle,
        contextLabel: contextLabel(selectedContext.value),
        capturedAt: new Date(),
      },
      {
        createTask: data => kanbanStore.createTask(data),
        fetchMemory,
        saveMemory,
        copyText: copyToClipboard,
        stagePresentationMaterial: material => intelligence.addPresentationMaterial(material),
      },
      {
        saveSessionSummary: saveSessionSummary.value,
        saveFullTranscript: saveFullTranscript.value,
        transcriptMessages: props.messages,
        memoryTags: ['Session Capture', contextLabel(selectedContext.value), draft.value.context],
        summaryEvidenceStatus: draft.value.context === 'feasibility' ? 'Research Note' : 'To Verify',
      },
    )
    fallbackText.value = result.fallbackText.trim()
    saveErrors.value = result.errors
    const savedCount = result.createdTasks + result.savedMemoryItems + result.stagedPresentationItems + result.copiedItems + (result.savedSessionSummary ? 1 : 0) + (result.savedFullTranscript ? 1 : 0)
    if (savedCount > 0 || result.errors.length === 0) {
      if (props.sessionId) markCaptureReviewed(props.sessionId)
      emit('saved')
    }
    if (result.errors.length > 0) {
      message.warning('Some capture items need manual copy fallback.')
    } else {
      message.success('Selected session items captured')
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown capture error'
    saveErrors.value = [detail]
    message.error('Could not capture selected items')
  } finally {
    saving.value = false
  }
}

function researchPriorityNumber(priority: string): number {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

async function createResearchTask(item: DeepResearchSuggestion) {
  creatingResearchTaskId.value = item.id
  researchTaskStatus.value = { ...researchTaskStatus.value, [item.id]: '' }
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Research: ${item.title}`,
      body: formatResearchSuggestionTask(item, {
        sessionId: props.sessionId || 'current',
        sessionTitle: props.sessionTitle,
        contextLabel: contextLabel(selectedContext.value),
        capturedAt: new Date(),
      }),
      priority: researchPriorityNumber(item.priority),
      tenant: contextLabel(selectedContext.value),
    })
    intelligence.addResearchJob({
      title: item.title,
      question: item.researchQuestion,
      context: contextLabel(selectedContext.value),
      status: 'Task Created',
    })
    researchTaskStatus.value = { ...researchTaskStatus.value, [item.id]: 'Created as a Kanban research task.' }
    message.success('Research task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown research task error'
    researchTaskStatus.value = { ...researchTaskStatus.value, [item.id]: `Could not create task: ${detail}` }
    fallbackText.value = formatResearchSuggestionTask(item, {
      sessionId: props.sessionId || 'current',
      sessionTitle: props.sessionTitle,
      contextLabel: contextLabel(selectedContext.value),
      capturedAt: new Date(),
    })
    message.warning('Research task needs manual copy fallback.')
  } finally {
    creatingResearchTaskId.value = null
  }
}

function deferResearchSuggestion(item: DeepResearchSuggestion) {
  intelligence.addResearchJob({
    title: item.title,
    question: item.researchQuestion,
    context: contextLabel(selectedContext.value),
    status: 'Later',
  })
  researchTaskStatus.value = { ...researchTaskStatus.value, [item.id]: 'Saved for later review.' }
  hideResearchSuggestion(item)
  message.info('Research suggestion saved for later')
}

function hideResearchSuggestion(item: DeepResearchSuggestion) {
  const next = new Set(hiddenResearchSuggestions.value)
  next.add(item.id)
  hiddenResearchSuggestions.value = next
}
</script>

<template>
  <NDrawer
    :show="show"
    :width="680"
    placement="right"
    :trap-focus="false"
    @update:show="emit('update:show', $event)"
  >
    <NDrawerContent closable>
      <template #header>
        <div class="capture-title">
          <span>Save useful items from this session?</span>
          <small>Source: {{ sourceSessionLabel }}</small>
        </div>
      </template>

      <div class="capture-drawer">
        <p class="capture-subtitle">
          Hermes found possible tasks, notes, evidence gaps, and report snippets. Select what you want to save.
        </p>

        <div class="capture-context-row">
          <label>
            <span>Session context</span>
            <NSelect
              v-model:value="selectedContext"
              :options="captureContextSelectOptions"
              size="small"
            />
          </label>
          <div class="capture-summary">
            <strong>Session summary</strong>
            <p>{{ draft?.sessionSummary }}</p>
          </div>
        </div>

        <NAlert type="info" :bordered="false" class="capture-honesty">
          Suggestions are generated from the current active session only. Nothing is saved until you select items and approve them.
          Tasks and evidence gaps save to real Kanban tasks; research notes and memory candidates append to Memory; report snippets stage as To Verify investor material until reviewed.
        </NAlert>

        <section class="memory-pipeline" aria-labelledby="memory-pipeline-title">
          <div>
            <h3 id="memory-pipeline-title">Conversation Memory Pipeline</h3>
            <p>
              History keeps the raw conversation. Memory should keep only curated summaries and approved durable facts.
            </p>
          </div>
          <div class="memory-options">
            <label>
              <NCheckbox v-model:checked="saveSessionSummary" />
              <span>Save concise session summary to Memory</span>
            </label>
            <label>
              <NCheckbox v-model:checked="saveFullTranscript" />
              <span>Save full transcript, not recommended</span>
            </label>
          </div>
        </section>

        <div v-if="!hasSuggestions" class="empty-capture">
          <strong>No strong capture suggestions yet.</strong>
          <p>Use Copy all if you still want a manual transcript-based note, or keep chatting and review later.</p>
        </div>

        <section
          v-for="group in captureGroups"
          :key="group.key"
          class="capture-group"
        >
          <header>
            <div>
              <h3>{{ group.title }}</h3>
              <p>{{ group.description }}</p>
            </div>
            <NTag size="small" round>{{ categorySelectedCount(group.key) }} selected</NTag>
          </header>

          <div v-if="group.items.length === 0" class="capture-empty-row">
            No clear {{ categoryLabel(group.key).toLowerCase() }} found in this session.
          </div>

          <article
            v-for="item in group.items"
            :key="item.id"
            class="capture-item"
          >
            <NCheckbox
              :checked="selectedIds.has(item.id)"
              @update:checked="setChecked(item, Boolean($event))"
            />
            <div class="capture-item-body">
              <div class="capture-item-title">
                <strong>{{ item.title }}</strong>
                <NTag v-if="item.priority" :type="priorityType(item.priority)" size="small" round>
                  {{ item.priority }}
                </NTag>
              </div>
              <p>{{ item.description }}</p>
              <div class="capture-meta">
                <span>Target: {{ targetLabel(item) }}</span>
                <span>Evidence: {{ item.evidenceStatus }}</span>
                <span>Source: {{ sourceSessionLabel }}</span>
              </div>
              <small>{{ item.recommendedAction }}</small>
            </div>
          </article>
        </section>

        <section v-if="deepResearchSuggestions.length" class="deep-research">
          <header>
            <div>
              <h3>Do deeper research?</h3>
              <p>These suggestions become manual Kanban research tasks unless a real scheduled Jobs integration is added later.</p>
            </div>
            <NTag size="small" round>{{ deepResearchSuggestions.length }} suggested</NTag>
          </header>

          <article v-for="item in deepResearchSuggestions" :key="item.id" class="research-item">
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.researchQuestion }}</p>
              <small>{{ item.scope }}</small>
              <div v-if="researchTaskStatus[item.id]" class="research-status">
                {{ researchTaskStatus[item.id] }}
              </div>
            </div>
            <div class="research-actions">
              <NButton size="tiny" secondary type="primary" :loading="creatingResearchTaskId === item.id" @click="createResearchTask(item)">
                Yes, create research task
              </NButton>
              <NButton size="tiny" secondary @click="createResearchTask(item)">Create task instead</NButton>
              <NButton size="tiny" quaternary @click="deferResearchSuggestion(item)">Later</NButton>
              <NButton size="tiny" quaternary @click="hideResearchSuggestion(item)">No</NButton>
            </div>
          </article>
        </section>

        <NAlert v-if="saveErrors.length" type="warning" class="capture-errors">
          <strong>Some items were not saved.</strong>
          <ul>
            <li v-for="error in saveErrors" :key="error">{{ error }}</li>
          </ul>
        </NAlert>

        <div v-if="fallbackText" class="capture-fallback">
          <div>
            <strong>Copy fallback</strong>
            <p>Use this text if a save or clipboard action was blocked.</p>
          </div>
          <textarea :value="fallbackText" readonly rows="8" />
        </div>

        <div class="capture-links">
          <RouterLink :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
          <RouterLink :to="{ name: 'hermes.memory' }">Open Memory</RouterLink>
          <RouterLink :to="{ name: 'hermes.files' }">Open Documents</RouterLink>
          <RouterLink :to="{ name: 'hermes.reportsHub' }">Open Reports</RouterLink>
        </div>
      </div>

      <template #footer>
        <div class="capture-actions">
          <NButton secondary type="primary" :loading="saving" @click="addSelected">
            Add selected
          </NButton>
          <NButton secondary @click="handleSkip">Skip</NButton>
          <NButton secondary @click="copyAll">Copy all</NButton>
          <NButton quaternary @click="closeDrawer">Cancel</NButton>
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.capture-title {
  display: flex;
  flex-direction: column;
  gap: 4px;

  span {
    color: $text-primary;
    font-size: 16px;
    font-weight: 900;
  }

  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
}

.capture-drawer {
  display: grid;
  gap: 14px;
}

.capture-subtitle,
.capture-summary p,
.capture-group p,
.capture-item p,
.capture-item small,
.empty-capture p,
.capture-fallback p {
  color: $text-secondary;
  line-height: 1.5;
}

.capture-subtitle {
  margin: 0;
}

.capture-context-row {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 12px;

  label {
    display: grid;
    gap: 6px;

    span {
      color: $text-muted;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
  }
}

.capture-summary,
.empty-capture,
.capture-fallback {
  padding: 12px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-panel;

  strong {
    color: $text-primary;
  }

  p {
    margin: 6px 0 0;
    font-size: 13px;
  }
}

.capture-honesty {
  font-size: 13px;
}

.capture-group {
  overflow: hidden;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;

  > header {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    padding: 12px;
    border-bottom: 1px solid $border-color;

    h3 {
      margin: 0;
      color: $text-primary;
      font-size: 14px;
    }

    p {
      margin: 5px 0 0;
      font-size: 12px;
    }
  }
}

.memory-pipeline,
.deep-research {
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: rgba(var(--accent-info-rgb), 0.05);

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 15px;
  }

  p {
    margin: 6px 0 0;
  }
}

.memory-options {
  display: grid;
  gap: 8px;
  margin-top: 12px;

  label {
    display: flex;
    gap: 8px;
    align-items: center;
    color: $text-secondary;
    font-weight: 800;
  }
}

.deep-research {
  header,
  .research-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
  }

  header {
    margin-bottom: 10px;
  }
}

.research-item {
  padding: 12px 0;
  border-top: 1px solid $border-color;

  strong {
    color: $text-primary;
  }

  p {
    margin: 6px 0;
  }

  small {
    color: $text-muted;
  }
}

.research-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.research-status {
  margin-top: 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 800;
}

.capture-empty-row {
  padding: 12px;
  color: $text-muted;
  font-size: 13px;
}

.capture-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  padding: 12px;

  + .capture-item {
    border-top: 1px solid $border-color;
  }
}

.capture-item-body {
  min-width: 0;
}

.capture-item-title {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;

  strong {
    min-width: 0;
    color: $text-primary;
    font-size: 13px;
  }
}

.capture-item p {
  margin: 6px 0;
  font-size: 13px;
}

.capture-item small {
  display: block;
  margin-top: 6px;
  font-size: 12px;
}

.capture-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    display: inline-flex;
    min-height: 24px;
    align-items: center;
    padding: 0 8px;
    border: 1px solid $border-color;
    border-radius: 999px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
  }
}

.capture-errors ul {
  margin: 8px 0 0;
  padding-left: 18px;
}

.capture-fallback {
  display: grid;
  gap: 10px;

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

.capture-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  a {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    padding: 0 10px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;

    &:hover {
      border-color: $accent-info;
      background: rgba(var(--accent-info-rgb), 0.08);
    }
  }
}

.capture-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 720px) {
  .capture-context-row {
    grid-template-columns: 1fr;
  }
}
</style>
