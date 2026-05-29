<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import {
  buildInvestorPresentationDraft,
  buildInvestorSlideOutline,
  formatInvestorPresentationOutline,
  type InvestorSlideDraft,
  type IntelligenceEvidenceStatus,
  type PresentationMaterial,
} from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'

const slideSections = [
  'Cover',
  'Executive Summary',
  'Problem / Opportunity',
  'Chemicon Background',
  'Product Plan',
  'China Feasibility',
  'Market Evidence',
  'Competitor Landscape',
  'Manufacturing Plan',
  'Regulatory Plan',
  'Financial Model',
  'IRR / Investor Return',
  'Use of Funds',
  'Risk & Mitigation',
  'Evidence / Data Room',
  'Next Steps',
]

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const copiedDraft = ref(false)
const creatingTaskSection = ref('')

const materialForm = ref({
  section: 'Executive Summary',
  content: '',
  evidenceStatus: 'User Approved' as IntelligenceEvidenceStatus,
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
})

const approvedMaterials = computed(() => intelligence.state.value.presentationMaterials)
const draftSections = computed(() => buildInvestorPresentationDraft(approvedMaterials.value))
const slideDrafts = computed(() => buildInvestorSlideOutline(slideSections, approvedMaterials.value))
const readySlideCount = computed(() => slideDrafts.value.filter(slide => slide.status === 'Ready').length)
const missingSlideCount = computed(() => slideDrafts.value.length - readySlideCount.value)
const readinessScore = intelligence.readinessScore
const investorReady = computed(() => readinessScore.value >= 70 && missingSlideCount.value <= 2)

function saveMaterial() {
  const content = materialForm.value.content.trim()
  if (!content) {
    message.warning('Add draft text before staging material')
    return
  }
  const source = materialForm.value.sourceTitle.trim()
    ? {
        title: materialForm.value.sourceTitle.trim(),
        url: materialForm.value.sourceUrl.trim() || undefined,
        date: materialForm.value.sourceDate.trim() || undefined,
      }
    : null
  const saved: PresentationMaterial = intelligence.addPresentationMaterial({
    section: materialForm.value.section,
    content,
    evidenceStatus: materialForm.value.evidenceStatus,
    source,
  })
  if (materialForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Material saved as To Verify because verified claims need usable source evidence')
  } else {
    intelligence.updateEvidenceStatus('presentation', 'User Approved')
    message.success('Approved material staged for investor draft')
  }
  materialForm.value = {
    section: 'Executive Summary',
    content: '',
    evidenceStatus: 'User Approved',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
  }
}

async function copyApprovedDraft() {
  const text = formatInvestorPresentationOutline(slideDrafts.value)
  copiedDraft.value = await copyToClipboard(text)
  if (copiedDraft.value) message.success('Approved investor draft copied')
  else message.warning('Clipboard blocked. Use the visible slide outline for manual copy.')
}

async function createMissingProofTask(slide: InvestorSlideDraft) {
  creatingTaskSection.value = slide.section
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Investor deck evidence: ${slide.section}`,
      body: [
        `Missing investor presentation material: ${slide.section}`,
        `Current status: ${slide.status}`,
        `Recommended action: ${slide.missingAction}`,
        'Source page: Investor Presentation Builder',
        'Tags: Investor Presentation, Evidence Gap, Chemicon China Feasibility',
        '',
        'Do not add unsupported claims. Use only verified, user-approved, or clearly assumption-labeled material.',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Missing-proof task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creatingTaskSection.value = ''
  }
}
</script>

<template>
  <div class="presentation-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Investor presentation builder</p>
        <h2 class="header-title">Draft From Approved Material Only</h2>
        <p class="page-copy">
          This builder prepares investor draft text, not final truth. It excludes unsupported claims and labels
          assumptions visibly. PDF/export can come later only if the existing report system supports it safely.
        </p>
      </div>
      <div class="readiness-warning">
        <strong>{{ investorReady ? 'Draft pack improving' : 'Not investor-ready yet' }}</strong>
        <span>{{ readinessScore }}% readiness / {{ readySlideCount }} of {{ slideSections.length }} slides have approved material.</span>
      </div>
    </header>

    <section class="draft-status">
      <div class="draft-status-head">
        <div>
          <h3>Approved material currently available</h3>
          <p>{{ missingSlideCount }} slides still need source-backed or user-approved material.</p>
        </div>
        <NButton secondary type="primary" @click="copyApprovedDraft">{{ copiedDraft ? 'Copied' : 'Copy approved draft' }}</NButton>
      </div>
      <p v-if="draftSections.length === 0">
        No verified, user-approved, or approved-assumption material has been staged for deck generation yet.
      </p>
      <article v-for="section in draftSections" :key="section.section">
        <strong>{{ section.section }}</strong>
        <p>{{ section.content }}</p>
        <small>{{ section.evidenceStatus }} / {{ section.sourceLabel }}</small>
      </article>
    </section>

    <section class="material-form" aria-label="Stage investor presentation material">
      <div>
        <h3>Stage approved material</h3>
        <p>Add only verified, user-approved, or approved-assumption text. Unsupported claims are excluded from the draft.</p>
      </div>
      <label>
        Slide section
        <select v-model="materialForm.section">
          <option v-for="section in slideSections" :key="section">{{ section }}</option>
        </select>
      </label>
      <label>
        Evidence status
        <select v-model="materialForm.evidenceStatus">
          <option>User Approved</option>
          <option>Approved Assumption</option>
          <option>Verified</option>
          <option>To Verify</option>
        </select>
      </label>
      <label>
        Source title
        <input v-model="materialForm.sourceTitle" type="text" placeholder="Required for Verified" />
      </label>
      <label>
        Source URL
        <input v-model="materialForm.sourceUrl" type="url" placeholder="https://..." />
      </label>
      <label>
        Source date
        <input v-model="materialForm.sourceDate" type="text" placeholder="YYYY-MM-DD or source date" />
      </label>
      <label class="wide">
        Draft text
        <textarea v-model="materialForm.content" rows="4" placeholder="Approved text for the investor draft"></textarea>
      </label>
      <button type="button" @click="saveMaterial">Stage material</button>
    </section>

    <section class="slide-grid">
      <article v-for="slide in slideDrafts" :key="slide.section" class="slide-card" :class="{ ready: slide.status === 'Ready' }">
        <div class="slide-head">
          <h3>{{ slide.section }}</h3>
          <span>{{ slide.status }}</span>
        </div>
        <p v-if="slide.status !== 'Ready'">{{ slide.missingAction }}</p>
        <div v-else class="slide-materials">
          <div v-for="item in slide.materials" :key="`${item.section}-${item.content}`" class="slide-material">
            <p>{{ item.content }}</p>
            <small>{{ item.evidenceStatus }} / {{ item.sourceLabel }}</small>
          </div>
        </div>
        <div class="action-list">
          <RouterLink :to="{ name: 'hermes.chat', query: { captureContext: 'investment-research' } }">Improve this slide</RouterLink>
          <RouterLink :to="{ name: 'hermes.files' }">Add evidence</RouterLink>
          <button
            type="button"
            :disabled="slide.status === 'Ready' || creatingTaskSection === slide.section"
            @click="createMissingProofTask(slide)"
          >
            {{ creatingTaskSection === slide.section ? 'Creating task' : 'Create task for missing proof' }}
          </button>
          <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review research</RouterLink>
          <RouterLink :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.presentation-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.readiness-warning,
.draft-status,
.material-form,
.slide-card {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
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
.draft-status p,
.slide-card p,
.readiness-warning span {
  color: $text-secondary;
  line-height: 1.55;
}

.readiness-warning {
  display: grid;
  gap: 8px;
  align-content: center;
  padding: 16px;

  strong {
    color: $warning;
    font-size: 18px;
  }
}

.draft-status {
  margin: 14px 0;
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }
}

.draft-status-head {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
  margin-bottom: 10px;
}

.material-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin: 14px 0;
  padding: 16px;

  > div,
  .wide {
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

  button {
    align-self: end;
    border: 1px solid $accent-primary;
    border-radius: $radius-sm;
    background: rgba(var(--accent-primary-rgb), 0.12);
    color: $accent-primary;
    padding: 9px 12px;
    font-weight: 900;
    cursor: pointer;
  }
}

.slide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 12px;
}

.slide-card {
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  &.ready {
    border-color: rgba(var(--success-rgb), 0.35);
  }
}

.slide-head {
  display: flex;
  gap: 8px;
  align-items: start;
  justify-content: space-between;

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

.slide-materials {
  display: grid;
  gap: 8px;
}

.slide-material {
  border-top: 1px solid $border-color;
  padding-top: 8px;

  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
  }
}

.action-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  a,
  button {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: transparent;
    padding: 5px 8px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}

@media (max-width: 760px) {
  .page-header {
    grid-template-columns: 1fr;
  }
}
</style>
