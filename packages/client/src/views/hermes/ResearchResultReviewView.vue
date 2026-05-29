<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import {
  type EvidenceArea,
  type ResearchReviewFinding,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creatingTaskId = ref('')

const areaOptions: Array<{ value: EvidenceArea; label: string }> = [
  { value: 'companyLegal', label: 'Company / Legal' },
  { value: 'product', label: 'Product' },
  { value: 'factory', label: 'Factory / Plant' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'market', label: 'Market' },
  { value: 'financial', label: 'Financial Model' },
  { value: 'presentation', label: 'Presentation' },
]

const findingForm = ref({
  summary: '',
  keyClaim: '',
  area: 'market' as EvidenceArea,
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
  confidence: 'medium' as ResearchReviewFinding['confidence'],
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
  suggestedTask: '',
  suggestedInvestorMaterial: '',
  riskNote: '',
})

const researchJobs = computed(() => intelligence.state.value.researchJobs)
const findings = computed(() => intelligence.state.value.researchFindings)
const pendingFindings = intelligence.pendingResearchFindings
const approvedFindings = computed(() => findings.value.filter(item => item.status === 'Approved').length)

function sourceFromForm(): SourceReference | null {
  const title = findingForm.value.sourceTitle.trim()
  if (!title) return null
  return {
    title,
    url: findingForm.value.sourceUrl.trim() || undefined,
    date: findingForm.value.sourceDate.trim() || undefined,
  }
}

function resetForm() {
  findingForm.value = {
    summary: '',
    keyClaim: '',
    area: 'market',
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
    suggestedTask: '',
    suggestedInvestorMaterial: '',
    riskNote: '',
  }
}

function areaLabel(area: EvidenceArea): string {
  return areaOptions.find(item => item.value === area)?.label || area
}

function stageFinding() {
  const summary = findingForm.value.summary.trim()
  const keyClaim = findingForm.value.keyClaim.trim()
  if (!summary || !keyClaim) {
    message.warning('Add a summary and key claim before staging a research result')
    return
  }
  const saved = intelligence.addResearchFinding({
    summary,
    keyClaim,
    area: findingForm.value.area,
    evidenceStatus: findingForm.value.evidenceStatus,
    confidence: findingForm.value.confidence,
    source: sourceFromForm(),
    suggestedTask: findingForm.value.suggestedTask.trim(),
    suggestedInvestorMaterial: findingForm.value.suggestedInvestorMaterial.trim(),
    riskNote: findingForm.value.riskNote.trim(),
  })
  if (findingForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Finding staged as To Verify because verified findings need source title plus URL or date')
  } else {
    message.success('Research finding staged for review')
  }
  resetForm()
}

function approveReadinessUpdate(item: ResearchReviewFinding) {
  const approved = intelligence.approveResearchFinding(item.id, {
    updateReadiness: true,
    evidenceStatus: item.evidenceStatus,
  })
  if (!approved) return
  if (approved.status === 'To Verify') {
    message.warning('Finding remains To Verify; readiness was not marked as verified without source evidence')
  } else {
    message.success('Approved finding and updated investor readiness')
  }
}

function addToInvestorDraft(item: ResearchReviewFinding) {
  if (!item.suggestedInvestorMaterial?.trim()) {
    message.warning('Add suggested investor material before staging this for the presentation builder')
    return
  }
  const approved = intelligence.approveResearchFinding(item.id, {
    addToPresentation: true,
    evidenceStatus: item.evidenceStatus,
  })
  if (!approved || approved.status === 'To Verify') {
    message.warning('Investor draft material was not added because this finding is still To Verify')
  } else {
    message.success('Research finding added to investor presentation draft material')
  }
}

function markToVerify(item: ResearchReviewFinding) {
  intelligence.approveResearchFinding(item.id, { evidenceStatus: 'To Verify' })
  message.info('Finding marked To Verify')
}

function rejectFinding(item: ResearchReviewFinding) {
  intelligence.rejectResearchFinding(item.id)
  message.info('Research finding rejected')
}

async function createTask(item: ResearchReviewFinding) {
  creatingTaskId.value = item.id
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: item.suggestedTask || `Review research finding: ${item.keyClaim}`,
      body: [
        `Research finding: ${item.keyClaim}`,
        `Summary: ${item.summary}`,
        `Area: ${areaLabel(item.area)}`,
        `Evidence status: ${item.evidenceStatus}`,
        `Confidence: ${item.confidence}`,
        item.source?.title ? `Source: ${item.source.title}${item.source.url ? ` (${item.source.url})` : ''}${item.source.date ? ` / ${item.source.date}` : ''}` : 'Source: Missing',
        item.riskNote ? `Risk note: ${item.riskNote}` : '',
        '',
        'Tags: Research Review, Evidence Gap, Investor Readiness',
      ].filter(Boolean).join('\n'),
      priority: item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify' ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Review task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creatingTaskId.value = ''
  }
}
</script>

<template>
  <div class="review-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Research result review</p>
        <h2 class="header-title">Approve Research Before It Changes Anything</h2>
        <p class="page-copy">
          Research outputs do not directly update dashboard facts, investor material, or verified claims. Stage a
          finding, check its source, then approve only the updates you want to keep.
        </p>
      </div>
      <RouterLink class="header-link" :to="{ name: 'hermes.research' }">Research Library</RouterLink>
    </header>

    <section class="summary-strip" aria-label="Research review summary">
      <span>{{ researchJobs.length }} research jobs</span>
      <span>{{ pendingFindings.length }} pending findings</span>
      <span>{{ approvedFindings }} approved findings</span>
    </section>

    <section class="job-panel">
      <div class="panel-head">
        <div>
          <h3>Research jobs from Session Capture and intelligence pages</h3>
          <p>These are task/job requests, not verified research results. Add results below after reviewing sources.</p>
        </div>
        <RouterLink :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
      </div>
      <p v-if="researchJobs.length === 0" class="empty-state">
        No research jobs saved yet. Use Review & Capture in Chat or the intelligence pages to create research tasks.
      </p>
      <div v-for="job in researchJobs.slice(0, 6)" :key="job.id" class="job-row">
        <strong>{{ job.title }}</strong>
        <span>{{ job.status }} / {{ job.context }}</span>
        <small>{{ job.question }}</small>
      </div>
    </section>

    <section class="finding-form" aria-label="Stage research finding">
      <div>
        <h3>Stage a reviewed research finding</h3>
        <p>Nothing becomes investor-ready until you approve it. Verified findings require a source title plus URL or date.</p>
      </div>
      <label>
        Summary
        <textarea v-model="findingForm.summary" rows="3" placeholder="Short source-backed summary"></textarea>
      </label>
      <label>
        Key claim
        <input v-model="findingForm.keyClaim" type="text" placeholder="Claim or evidence item being reviewed" />
      </label>
      <label>
        Area
        <select v-model="findingForm.area">
          <option v-for="area in areaOptions" :key="area.value" :value="area.value">{{ area.label }}</option>
        </select>
      </label>
      <label>
        Evidence status
        <select v-model="findingForm.evidenceStatus">
          <option>To Verify</option>
          <option>Missing</option>
          <option>Assumption</option>
          <option>User Approved</option>
          <option>Verified</option>
        </select>
      </label>
      <label>
        Confidence
        <select v-model="findingForm.confidence">
          <option>low</option>
          <option>medium</option>
          <option>high</option>
        </select>
      </label>
      <label>
        Source title
        <input v-model="findingForm.sourceTitle" type="text" placeholder="Required for Verified" />
      </label>
      <label>
        Source URL
        <input v-model="findingForm.sourceUrl" type="url" placeholder="https://..." />
      </label>
      <label>
        Source date
        <input v-model="findingForm.sourceDate" type="text" placeholder="YYYY-MM-DD or source date" />
      </label>
      <label>
        Suggested task
        <input v-model="findingForm.suggestedTask" type="text" placeholder="Optional Kanban task title" />
      </label>
      <label>
        Investor material
        <textarea v-model="findingForm.suggestedInvestorMaterial" rows="3" placeholder="Optional approved draft text"></textarea>
      </label>
      <label>
        Risk note
        <textarea v-model="findingForm.riskNote" rows="3" placeholder="Optional risk or uncertainty note"></textarea>
      </label>
      <NButton secondary type="primary" @click="stageFinding">Stage for review</NButton>
    </section>

    <section class="review-queue">
      <div class="panel-head">
        <div>
          <h3>Review queue</h3>
          <p>Approve selected updates, create tasks, or reject. Unsourced verified claims remain To Verify.</p>
        </div>
        <RouterLink :to="{ name: 'hermes.investorReadiness' }">Investor Readiness</RouterLink>
      </div>

      <p v-if="findings.length === 0" class="empty-state">
        No research findings staged yet.
      </p>

      <article v-for="item in findings" :key="item.id" class="finding-card">
        <div class="finding-main">
          <div class="finding-title">
            <h3>{{ item.keyClaim }}</h3>
            <span>{{ item.status }}</span>
          </div>
          <p>{{ item.summary }}</p>
          <div class="finding-meta">
            <span>{{ areaLabel(item.area) }}</span>
            <span>{{ item.evidenceStatus }}</span>
            <span>Confidence: {{ item.confidence }}</span>
            <span>{{ item.source?.title || 'Source missing' }}</span>
          </div>
          <small v-if="item.riskNote">Risk: {{ item.riskNote }}</small>
        </div>
        <div class="finding-actions">
          <NButton size="tiny" secondary type="primary" @click="approveReadinessUpdate(item)">
            Approve selected updates
          </NButton>
          <NButton size="tiny" secondary @click="addToInvestorDraft(item)">
            Add to investor draft
          </NButton>
          <NButton size="tiny" secondary :loading="creatingTaskId === item.id" @click="createTask(item)">
            Create task
          </NButton>
          <NButton size="tiny" quaternary @click="markToVerify(item)">Mark To Verify</NButton>
          <NButton size="tiny" quaternary @click="rejectFinding(item)">Reject</NButton>
        </div>
      </article>
    </section>

    <section class="action-strip">
      <RouterLink :to="{ name: 'hermes.chat', query: { captureContext: 'market-research' } }">Review & Capture</RouterLink>
      <RouterLink :to="{ name: 'hermes.memory' }">Save as research note</RouterLink>
      <RouterLink :to="{ name: 'hermes.kanban' }">Tasks</RouterLink>
      <RouterLink :to="{ name: 'hermes.files' }">Documents</RouterLink>
      <RouterLink :to="{ name: 'hermes.investorPresentation' }">Presentation Builder</RouterLink>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.review-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.summary-strip,
.job-panel,
.finding-form,
.review-queue,
.finding-card {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 18px;
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.page-copy,
.job-panel p,
.finding-form p,
.review-queue p,
.finding-card p,
.finding-card small,
.empty-state {
  color: $text-secondary;
  line-height: 1.55;
}

.header-link,
.panel-head a,
.action-strip a {
  color: $accent-info;
  font-weight: 800;
}

.summary-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;
  padding: 12px;

  span {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    padding: 0 10px;
    border: 1px solid $border-color;
    border-radius: 999px;
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
  }
}

.job-panel,
.finding-form,
.review-queue {
  margin-bottom: 14px;
  padding: 16px;
}

.panel-head {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
  margin-bottom: 12px;

  h3 {
    margin: 0 0 6px;
    color: $text-primary;
  }
}

.job-row {
  display: grid;
  gap: 5px;
  padding: 10px 0;
  border-top: 1px solid $border-color;

  strong {
    color: $text-primary;
  }

  span {
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  small {
    color: $text-secondary;
  }
}

.finding-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
  align-items: end;

  > div,
  label:first-of-type {
    grid-column: 1 / -1;
  }

  label {
    display: grid;
    gap: 6px;
    color: $text-secondary;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  input,
  select,
  textarea {
    min-width: 0;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-input;
    color: $text-primary;
    padding: 8px 10px;
    text-transform: none;
  }
}

.finding-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  padding: 14px;

  + .finding-card {
    margin-top: 10px;
  }
}

.finding-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;

  h3 {
    margin: 0;
    color: $text-primary;
  }

  span {
    border: 1px solid $border-color;
    border-radius: 999px;
    padding: 3px 8px;
    color: $accent-primary;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.finding-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0;

  span {
    border: 1px solid $border-color;
    border-radius: 999px;
    padding: 4px 8px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
  }
}

.finding-actions {
  display: flex;
  max-width: 270px;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.action-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  a {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 8px 10px;
    text-decoration: none;
  }
}

@media (max-width: 860px) {
  .page-header,
  .finding-card {
    grid-template-columns: 1fr;
  }

  .finding-actions {
    max-width: none;
    justify-content: flex-start;
  }
}
</style>
