<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  buildInvestorPresentationDraft,
  type IntelligenceEvidenceStatus,
  type PresentationMaterial,
} from '@/utils/investorIntelligence'

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

const actions = [
  'Improve this slide',
  'Add evidence',
  'Create task for missing proof',
  'Do deeper research',
  'Rewrite for investor',
  'Mark risky claim',
  'Remove unsupported claim',
]

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
        <strong>Not investor-ready yet</strong>
        <span>Missing evidence should appear as risk or appendix items.</span>
      </div>
    </header>

    <section class="draft-status">
      <h3>Approved material currently available</h3>
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
      <article v-for="section in slideSections" :key="section" class="slide-card">
        <h3>{{ section }}</h3>
        <p>Missing / To Verify until approved source-backed material is added.</p>
        <div class="action-list">
          <RouterLink v-for="action in actions" :key="action" :to="{ name: action.includes('task') ? 'hermes.kanban' : 'hermes.chat', query: { captureContext: 'investment-research' } }">
            {{ action }}
          </RouterLink>
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
}

.action-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  a {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 5px 8px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 800;
    text-decoration: none;
  }
}

@media (max-width: 760px) {
  .page-header {
    grid-template-columns: 1fr;
  }
}
</style>
