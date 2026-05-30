<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import {
  buildInvestorPresentationDraft,
  buildInvestorSlideOutline,
  formatSourceReference,
  formatInvestorPresentationOutline,
  INVESTOR_PRESENTATION_SECTIONS,
  isPresentationMaterialAllowed,
  type InvestorSlideDraft,
  type IntelligenceEvidenceStatus,
  type PresentationMaterial,
} from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'

const slideSections = INVESTOR_PRESENTATION_SECTIONS

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const copiedDraft = ref(false)
const creatingTaskSection = ref('')
const creatingMaterialTaskId = ref('')
const creatingResearchSection = ref('')
const creatingMaterialResearchId = ref('')

interface MaterialFormState {
  section: string
  content: string
  evidenceStatus: IntelligenceEvidenceStatus
  sourceTitle: string
  sourceUrl: string
  sourceDate: string
}

const materialForm = ref<MaterialFormState>({
  section: 'Executive Summary',
  content: '',
  evidenceStatus: 'User Approved',
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
})
const editingMaterialId = ref('')
const editMaterialForm = ref<MaterialFormState>({
  section: 'Executive Summary',
  content: '',
  evidenceStatus: 'User Approved',
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
})

const approvedMaterials = computed(() => intelligence.state.value.presentationMaterials)
const draftSections = computed(() => buildInvestorPresentationDraft(approvedMaterials.value))
const slideDrafts = computed(() => buildInvestorSlideOutline(slideSections, approvedMaterials.value))
const excludedMaterials = computed(() => approvedMaterials.value.filter(material => !isPresentationMaterialAllowed(material)))
const readySlideCount = computed(() => slideDrafts.value.filter(slide => slide.status === 'Ready').length)
const missingSlideCount = computed(() => slideDrafts.value.length - readySlideCount.value)
const readinessScore = intelligence.readinessScore
const investorReady = computed(() => readinessScore.value >= 70 && missingSlideCount.value <= 2)

function materialSourceTrace(material: PresentationMaterial): string {
  if (material.source) return formatSourceReference(material.source)
  if (material.evidenceStatus === 'Investor Approved') return 'Investor approved material'
  if (material.evidenceStatus === 'Source-backed') return 'Source-backed material requires source title plus URL or date'
  if (material.evidenceStatus === 'Powerful Assumption') return 'Powerful assumption - not a fact; label must stay visible'
  if (material.evidenceStatus === 'Approved Assumption') return 'Approved assumption - source not required, but label must stay visible'
  if (material.evidenceStatus === 'Derived from Assumptions') return 'Derived from assumption-labeled financial model'
  if (material.evidenceStatus === 'User Approved') return 'User approved - source optional'
  return 'Source missing'
}

function materialExclusionReason(material: PresentationMaterial): string {
  if (!material.content.trim()) return 'Empty draft text is ignored.'
  if (material.evidenceStatus === 'Verified') return 'Verified claims need a source title plus a source URL or source date.'
  return `Marked ${material.evidenceStatus}; keep it out of investor slides until it is user-approved, source-backed, or clearly assumption-labeled.`
}

function materialTaskKey(material: PresentationMaterial): string {
  return material.id || `${material.section}-${material.content}`.slice(0, 120)
}

function researchPriorityForText(text: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase()
  if (lower.includes('regulatory') || lower.includes('risk') || lower.includes('irr') || lower.includes('financial') || lower.includes('market')) return 'high'
  if (lower.includes('competitor') || lower.includes('factory') || lower.includes('manufacturing') || lower.includes('product')) return 'medium'
  return 'low'
}

function materialResearchKey(material: PresentationMaterial): string {
  return material.id || `${material.section}-${material.evidenceStatus}-${material.content}`.slice(0, 140)
}

function materialExcerpt(material: PresentationMaterial): string {
  const trimmed = material.content.trim()
  if (!trimmed) return 'No draft text provided.'
  return trimmed.length > 700 ? `${trimmed.slice(0, 700).trim()}...` : trimmed
}

function formSource(form: MaterialFormState): PresentationMaterial['source'] {
  return form.sourceTitle.trim()
    ? {
        title: form.sourceTitle.trim(),
        url: form.sourceUrl.trim() || undefined,
        date: form.sourceDate.trim() || undefined,
      }
    : null
}

function resetMaterialForm() {
  materialForm.value = {
    section: 'Executive Summary',
    content: '',
    evidenceStatus: 'User Approved',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
  }
}

function startEditMaterial(material: PresentationMaterial) {
  if (!material.id) return
  editingMaterialId.value = material.id
  editMaterialForm.value = {
    section: material.section,
    content: material.content,
    evidenceStatus: material.evidenceStatus,
    sourceTitle: material.source?.title || '',
    sourceUrl: material.source?.url || '',
    sourceDate: material.source?.date || '',
  }
}

function cancelEditMaterial() {
  editingMaterialId.value = ''
}

function saveMaterial() {
  const content = materialForm.value.content.trim()
  if (!content) {
    message.warning('Add draft text before staging material')
    return
  }
  const saved: PresentationMaterial = intelligence.addPresentationMaterial({
    section: materialForm.value.section,
    content,
    evidenceStatus: materialForm.value.evidenceStatus,
    source: formSource(materialForm.value),
  })
  if (materialForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Material saved as To Verify because verified claims need usable source evidence')
  } else {
    intelligence.updateEvidenceStatus('presentation', 'User Approved')
    message.success('Approved material staged for investor draft')
  }
  resetMaterialForm()
}

function saveEditedMaterial() {
  const content = editMaterialForm.value.content.trim()
  if (!editingMaterialId.value || !content) {
    message.warning('Add draft text before saving material')
    return
  }
  const requestedStatus = editMaterialForm.value.evidenceStatus
  const saved = intelligence.updatePresentationMaterial(editingMaterialId.value, {
    section: editMaterialForm.value.section,
    content,
    evidenceStatus: requestedStatus,
    source: formSource(editMaterialForm.value),
  })
  if (!saved) {
    message.error('Could not find staged material to update')
    return
  }
  if (requestedStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Material kept as To Verify because verified claims need usable source evidence')
  } else {
    message.success('Investor material updated')
  }
  editingMaterialId.value = ''
}

function removeMaterial(material: PresentationMaterial) {
  if (!material.id) return
  const ok = window.confirm('Remove this staged investor material? This does not delete chat history, files, or research notes.')
  if (!ok) return
  if (intelligence.removePresentationMaterial(material.id)) {
    if (editingMaterialId.value === material.id) editingMaterialId.value = ''
    message.success('Staged investor material removed')
  } else {
    message.error('Could not remove staged material')
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

function createSlideResearchJob(slide: InvestorSlideDraft) {
  creatingResearchSection.value = slide.section
  try {
    const priority = researchPriorityForText(`${slide.section} ${slide.missingAction}`)
    intelligence.addResearchJob({
      title: `Investor slide research: ${slide.section}`,
      question: slide.status === 'Ready'
        ? `Find stronger source-backed support, risks, or missing proof for the ${slide.section} investor slide.`
        : `Find source-backed, investor-safe material needed for the ${slide.section} slide.`,
      scope: [
        `Investor presentation section: ${slide.section}`,
        `Current slide status: ${slide.status}`,
        `Current gap: ${slide.missingAction}`,
        'Focus on Chemicon China feasibility only. Do not invent market data, competitor share, pricing, or investor claims.',
      ].join('\n'),
      expectedOutput: 'A reviewed research finding with key claims, source title plus URL/date, evidence status, risks, and suggested slide text only if source-backed or explicitly labeled as an assumption.',
      sourceRequirements: 'Every claim needs a source title plus URL/date, or it must remain To Verify. Investor text must be clearly labeled Verified, User Approved, or Approved Assumption.',
      priority,
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Manual Research Job',
    })
    message.success('Research job saved for this investor slide')
  } finally {
    creatingResearchSection.value = ''
  }
}

function createMaterialResearchJob(material: PresentationMaterial) {
  const key = materialResearchKey(material)
  creatingMaterialResearchId.value = key
  try {
    const priority = researchPriorityForText(`${material.section} ${material.content} ${material.evidenceStatus}`)
    intelligence.addResearchJob({
      title: `Investor material source review: ${material.section}`,
      question: `Verify, source, improve, or reject this investor material for ${material.section}.`,
      scope: [
        `Slide section: ${material.section}`,
        `Current evidence status: ${material.evidenceStatus}`,
        `Current source trace: ${materialSourceTrace(material)}`,
        `Why it is not investor-ready: ${materialExclusionReason(material)}`,
        '',
        'Material needing review:',
        materialExcerpt(material),
      ].join('\n'),
      expectedOutput: 'A review-ready finding that either supplies source-backed slide text, labels the material as an approved assumption, creates follow-up tasks, or recommends removal.',
      sourceRequirements: 'Do not promote unsupported claims. Verified material requires source title plus URL/date. Unknown market share, market size, pricing, and investor return claims must stay To Verify unless sourced.',
      priority,
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Manual Research Job',
    })
    message.success('Research job saved for weak investor material')
  } finally {
    creatingMaterialResearchId.value = ''
  }
}

async function createMaterialEvidenceTask(material: PresentationMaterial) {
  const key = materialTaskKey(material)
  creatingMaterialTaskId.value = key
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Verify investor material: ${material.section}`,
      body: [
        `Investor material needing evidence: ${material.section}`,
        `Current evidence status: ${material.evidenceStatus}`,
        `Current source trace: ${materialSourceTrace(material)}`,
        `Why excluded: ${materialExclusionReason(material)}`,
        '',
        'Draft text needing review:',
        material.content || 'No draft text provided.',
        '',
        'Recommended action: attach source evidence, approve a labeled assumption, or remove the unsupported claim before using it in investor material.',
        'Source page: Investor Presentation Builder',
        'Tags: Investor Presentation, Evidence Gap, Chemicon China Feasibility',
        '',
        'Do not mark this investor-ready until the source/evidence status is corrected in the Presentation Builder.',
      ].join('\n'),
      priority: material.evidenceStatus === 'Missing' || material.evidenceStatus === 'To Verify' ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create evidence task: ${detail}`)
  } finally {
    creatingMaterialTaskId.value = ''
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
        <small>{{ section.evidenceStatus }} / {{ section.sourceDetail }}</small>
      </article>
    </section>

    <section v-if="excludedMaterials.length" class="excluded-materials" aria-label="Materials needing evidence before investor use">
      <div class="excluded-head">
        <div>
          <h3>Needs Evidence Before Investor Use</h3>
          <p>
            These saved items are visible for follow-up, but they are excluded from investor slides until their evidence
            status is approved, source-backed, or assumption-labeled.
          </p>
        </div>
        <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review sources</RouterLink>
      </div>
      <article v-for="(material, index) in excludedMaterials" :key="`${material.section}-${index}`">
        <div class="material-meta">
          <strong>{{ material.section }}</strong>
          <span>{{ material.evidenceStatus }}</span>
        </div>
        <p>{{ material.content || 'No draft text provided.' }}</p>
        <small>{{ materialSourceTrace(material) }}</small>
        <em>{{ materialExclusionReason(material) }}</em>
        <div class="excluded-actions">
          <NButton
            size="tiny"
            secondary
            type="primary"
            :loading="creatingMaterialTaskId === materialTaskKey(material)"
            @click="createMaterialEvidenceTask(material)"
          >
            Create evidence task
          </NButton>
          <NButton
            size="tiny"
            secondary
            :loading="creatingMaterialResearchId === materialResearchKey(material)"
            @click="createMaterialResearchJob(material)"
          >
            Do deeper research
          </NButton>
          <RouterLink :to="{ name: 'hermes.files' }">Add source document</RouterLink>
          <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review source</RouterLink>
        </div>
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
          <option>Investor Approved</option>
          <option>Source-backed</option>
          <option>Approved Assumption</option>
          <option>Powerful Assumption</option>
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

    <section v-if="approvedMaterials.length" class="material-manager" aria-label="Manage staged investor material">
      <div class="manager-head">
        <div>
          <h3>Manage staged investor material</h3>
          <p>
            Correct source details, change evidence labels, or remove weak material before it reaches the investor draft.
          </p>
        </div>
      </div>
      <article v-for="material in approvedMaterials" :key="material.id || `${material.section}-${material.content}`" class="managed-material">
        <div v-if="editingMaterialId !== material.id" class="managed-read">
          <div class="material-meta">
            <strong>{{ material.section }}</strong>
            <span>{{ material.evidenceStatus }}</span>
          </div>
          <p>{{ material.content }}</p>
          <small>{{ materialSourceTrace(material) }}</small>
          <em v-if="!isPresentationMaterialAllowed(material)">{{ materialExclusionReason(material) }}</em>
          <div class="manager-actions">
            <button type="button" @click="startEditMaterial(material)">Edit evidence</button>
            <button
              v-if="!isPresentationMaterialAllowed(material)"
              type="button"
              :disabled="creatingMaterialTaskId === materialTaskKey(material)"
              @click="createMaterialEvidenceTask(material)"
            >
              {{ creatingMaterialTaskId === materialTaskKey(material) ? 'Creating task' : 'Create evidence task' }}
            </button>
            <button type="button" class="danger" @click="removeMaterial(material)">Remove</button>
          </div>
        </div>

        <div v-else class="managed-edit">
          <label>
            Slide section
            <select v-model="editMaterialForm.section">
              <option v-for="section in slideSections" :key="section">{{ section }}</option>
            </select>
          </label>
          <label>
            Evidence status
            <select v-model="editMaterialForm.evidenceStatus">
              <option>User Approved</option>
              <option>Investor Approved</option>
              <option>Source-backed</option>
              <option>Approved Assumption</option>
              <option>Powerful Assumption</option>
              <option>Verified</option>
              <option>To Verify</option>
            </select>
          </label>
          <label>
            Source title
            <input v-model="editMaterialForm.sourceTitle" type="text" placeholder="Required for Verified" />
          </label>
          <label>
            Source URL
            <input v-model="editMaterialForm.sourceUrl" type="url" placeholder="https://..." />
          </label>
          <label>
            Source date
            <input v-model="editMaterialForm.sourceDate" type="text" placeholder="YYYY-MM-DD or source date" />
          </label>
          <label class="wide">
            Draft text
            <textarea v-model="editMaterialForm.content" rows="4" placeholder="Approved text for the investor draft"></textarea>
          </label>
          <div class="manager-actions wide">
            <button type="button" @click="saveEditedMaterial">Save material</button>
            <button type="button" @click="cancelEditMaterial">Cancel</button>
          </div>
        </div>
      </article>
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
            <small>Evidence: {{ item.evidenceStatus }} / {{ item.sourceDetail }}</small>
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
          <button
            type="button"
            :disabled="creatingResearchSection === slide.section"
            @click="createSlideResearchJob(slide)"
          >
            {{ creatingResearchSection === slide.section ? 'Saving research' : 'Do deeper research' }}
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
.material-manager,
.managed-material,
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

.excluded-materials {
  display: grid;
  gap: 10px;
  margin: 14px 0;
  border: 1px solid rgba(var(--warning-rgb), 0.35);
  border-radius: $radius-sm;
  background: rgba(var(--warning-rgb), 0.06);
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }

  article {
    display: grid;
    gap: 7px;
    border-top: 1px solid $border-color;
    padding-top: 10px;
  }

  small,
  em {
    color: $text-muted;
    font-size: 12px;
    line-height: 1.45;
  }
}

.excluded-head,
.material-meta {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
}

.excluded-head a {
  flex: 0 0 auto;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  padding: 6px 9px;
  color: $accent-info;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
}

.excluded-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  a {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 5px 8px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;
  }
}

.material-meta {
  strong {
    color: $text-primary;
  }

  span {
    border: 1px solid rgba(var(--warning-rgb), 0.35);
    border-radius: 999px;
    padding: 3px 8px;
    color: $warning;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
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

.material-manager {
  display: grid;
  gap: 10px;
  margin: 14px 0;
  padding: 16px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.managed-material {
  padding: 12px;
}

.managed-read {
  display: grid;
  gap: 7px;

  small,
  em {
    color: $text-muted;
    font-size: 12px;
    line-height: 1.45;
  }
}

.managed-edit {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;

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
}

.manager-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  button {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: transparent;
    padding: 6px 9px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
  }

  .danger {
    border-color: rgba(var(--error-rgb), 0.35);
    color: $error;
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

  .excluded-head,
  .material-meta {
    display: grid;
  }
}
</style>
