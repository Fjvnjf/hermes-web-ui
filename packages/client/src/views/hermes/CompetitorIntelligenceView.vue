<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import {
  type CompetitorIntelligenceRecord,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { formatSourcedMarketShare, sourceIsUsable, type IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'
import { redactForEmployee, shouldRedactForEmployee } from '@/utils/accessControl'
import { defaultExecutiveRefreshState, nextTwiceDailyRefresh, type ExecutiveRefreshState } from '@/utils/executiveIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creating = ref('')
const editingCompetitorId = ref<string | null>(null)
const redactSensitiveFields = computed(() => shouldRedactForEmployee())
const refreshState = ref<ExecutiveRefreshState>(defaultExecutiveRefreshState())

const competitorForm = ref({
  companyName: '',
  countryRegion: '',
  productEquivalent: '',
  activeContent: '',
  pricingEvidence: '',
  certifications: '',
  distributionPresence: '',
  marketShare: '',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
  notes: '',
})

const competitors = computed(() => intelligence.state.value.competitors)
const competitorSubmitLabel = computed(() => editingCompetitorId.value ? 'Update competitor' : 'Save competitor')
const productContextRows = [
  'Cationic Softeners / CHEMISOFT',
  'Silicone Softeners / CHEMISIL',
  'CWAS',
  'CWMS',
  'CSLC',
  'CHEMISIL HS 200',
  'CHEMISIL 1800 CON',
].map(product => ({
  product,
  formType: 'To Verify',
  dosing: 'To Verify',
  ph: 'To Verify',
  application: 'To Verify',
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
}))
const marketShareChartRows = computed(() =>
  competitors.value
    .map(competitor => ({
      competitor,
      label: competitor.companyName,
      shareLabel: competitorMarketShareLabel(competitor),
      numericShare: Number.parseFloat((competitor.marketShare || '').replace(/[^\d.]/g, '')),
      isAssumption: competitor.evidenceStatus === 'Assumption' || competitor.evidenceStatus === 'Powerful Assumption',
      isSourceBacked: sourceIsUsable(competitor.source) && competitor.evidenceStatus !== 'To Verify' && competitor.evidenceStatus !== 'Missing',
    }))
    .filter(row => Number.isFinite(row.numericShare) && row.numericShare > 0 && (row.isAssumption || row.isSourceBacked)),
)

function competitorMarketShareLabel(competitor: CompetitorIntelligenceRecord): string {
  return formatSourcedMarketShare(competitor.marketShare, competitor.source, competitor.evidenceStatus)
}

function visibleSensitiveValue(value: string): string {
  return String(redactForEmployee(value || 'Missing'))
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function syncCompetitorsNow() {
  const saved = intelligence.addResearchFinding({
    summary: [
      'Competitor Intelligence refresh draft',
      `Competitor records: ${competitors.value.length}`,
      'Unknown market share stays To Verify.',
      'Pricing and formula-sensitive fields remain restricted where required.',
    ].join('\n'),
    keyClaim: 'Competitor intelligence requires source review',
    area: 'market',
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    source: null,
    suggestedTask: 'Review competitor evidence, product equivalents, pricing proof, source links, and market-share labels.',
    riskNote: 'No competitor market share or price should be used as fact until source-backed or visibly assumption-labeled.',
  })
  refreshState.value = {
    ...refreshState.value,
    lastRun: new Date().toISOString(),
    nextRun: nextTwiceDailyRefresh(),
    lastStatus: `Research review draft staged: ${saved.keyClaim}`,
    resultNeedsReviewCount: refreshState.value.resultNeedsReviewCount + 1,
  }
  message.success('Competitor refresh staged for research review')
}

function resetCompetitorForm() {
  competitorForm.value = {
    companyName: '',
    countryRegion: '',
    productEquivalent: '',
    activeContent: '',
    pricingEvidence: '',
    certifications: '',
    distributionPresence: '',
    marketShare: '',
    evidenceStatus: 'To Verify',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
    notes: '',
  }
  editingCompetitorId.value = null
}

async function createResearchTask(competitor: CompetitorIntelligenceRecord) {
  creating.value = competitor.companyName
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Competitor research: ${competitor.companyName}`,
      body: [
        `Competitor: ${competitor.companyName}`,
        'Collect company name, country/region, product equivalent, active content, pricing evidence, certifications, distribution presence, source links, and notes.',
        'Market share must stay To Verify unless backed by a credible source.',
        'Tags: Competitor Intelligence, Research Job, To Verify',
      ].join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    intelligence.addResearchJob({
      title: `Competitor research: ${competitor.companyName}`,
      question: `Verify ${competitor.companyName} product equivalent, pricing evidence, distribution, certifications, and market-share source if available.`,
      scope: 'Competitor identity, region, product equivalent, active content, pricing proof, certifications, distribution presence, and source-backed market-share status.',
      expectedOutput: 'Structured competitor evidence record with sources, confidence, and To Verify labels for unsupported claims.',
      sourceRequirements: 'Market share must stay To Verify unless supported by a credible source title plus URL or date.',
      priority: 'medium',
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Task Created',
    })
    message.success('Competitor research task created')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creating.value = ''
  }
}

async function createGenericCompetitorTask(title: string, notes: string) {
  await createResearchTask({
    id: title.toLowerCase().replace(/\s+/g, '-'),
    companyName: title,
    countryRegion: 'To Verify',
    productEquivalent: 'To Verify',
    activeContent: 'To Verify',
    pricingEvidence: 'To Verify',
    certifications: 'To Verify',
    distributionPresence: 'To Verify',
    marketShare: '',
    evidenceStatus: 'To Verify',
    source: null,
    notes,
    updatedAt: new Date().toISOString(),
  })
}

function stageCompetitorForReview(competitor: CompetitorIntelligenceRecord) {
  const usableSource = sourceIsUsable(competitor.source)
  const saved = intelligence.addResearchFinding({
    summary: [
      `Competitor: ${competitor.companyName}`,
      `Region: ${competitor.countryRegion}`,
      `Product equivalent: ${competitor.productEquivalent}`,
      `Active content: ${competitor.activeContent}`,
      `Pricing evidence: ${redactSensitiveFields.value ? 'Restricted' : competitor.pricingEvidence}`,
      `Certifications: ${competitor.certifications}`,
      `Distribution presence: ${competitor.distributionPresence}`,
      `Market share: ${competitorMarketShareLabel(competitor)}`,
      `Notes: ${competitor.notes}`,
    ].join('\n'),
    keyClaim: `Competitor evidence: ${competitor.companyName}`,
    area: 'market',
    evidenceStatus: competitor.evidenceStatus,
    confidence: usableSource && (competitor.evidenceStatus === 'Verified' || competitor.evidenceStatus === 'User Approved')
      ? 'medium'
      : 'low',
    source: competitor.source || null,
    suggestedTask: usableSource
      ? `Review competitor evidence for ${competitor.companyName} before using it in investor material.`
      : `Collect usable source evidence for ${competitor.companyName}.`,
    suggestedInvestorMaterial: usableSource
      ? `Competitor evidence for ${competitor.companyName}: ${competitor.productEquivalent}. Pricing evidence: ${redactSensitiveFields.value ? 'Restricted' : competitor.pricingEvidence}. Market share: ${competitorMarketShareLabel(competitor)}.`
      : '',
    riskNote: usableSource
      ? 'Review source quality before approving this competitor evidence for investor use.'
      : 'Competitor evidence remains To Verify until a source title plus URL or date is attached.',
  })

  if (competitor.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Staged as To Verify because verified findings need usable source evidence')
  } else {
    message.success('Competitor evidence staged for research review')
  }
}

function removeCompetitor(competitor: CompetitorIntelligenceRecord) {
  if (!window.confirm(`Remove competitor record "${competitor.companyName}" from this browser workspace?`)) return
  const removed = intelligence.removeCompetitor(competitor.id)
  if (removed) message.success('Competitor record removed from this browser workspace')
  else message.error('Competitor record was not found')
}

function startEditCompetitor(competitor: CompetitorIntelligenceRecord) {
  editingCompetitorId.value = competitor.id
  competitorForm.value = {
    companyName: competitor.companyName,
    countryRegion: competitor.countryRegion,
    productEquivalent: competitor.productEquivalent,
    activeContent: competitor.activeContent,
    pricingEvidence: competitor.pricingEvidence,
    certifications: competitor.certifications,
    distributionPresence: competitor.distributionPresence,
    marketShare: competitor.marketShare || '',
    evidenceStatus: competitor.evidenceStatus,
    sourceTitle: competitor.source?.title || '',
    sourceUrl: competitor.source?.url || '',
    sourceDate: competitor.source?.date || '',
    notes: competitor.notes,
  }
}

function addCompetitor() {
  const companyName = competitorForm.value.companyName.trim()
  if (!companyName) {
    message.warning('Add a company name or competitor placeholder first')
    return
  }
  const source = competitorForm.value.sourceTitle.trim()
    ? {
        title: competitorForm.value.sourceTitle.trim(),
        url: competitorForm.value.sourceUrl.trim() || undefined,
        date: competitorForm.value.sourceDate.trim() || undefined,
      }
    : null
  const payload = {
    companyName,
    countryRegion: competitorForm.value.countryRegion.trim() || 'To Verify',
    productEquivalent: competitorForm.value.productEquivalent.trim() || 'To Verify',
    activeContent: competitorForm.value.activeContent.trim() || 'To Verify',
    pricingEvidence: competitorForm.value.pricingEvidence.trim() || 'Missing',
    certifications: competitorForm.value.certifications.trim() || 'To Verify',
    distributionPresence: competitorForm.value.distributionPresence.trim() || 'To Verify',
    marketShare: competitorForm.value.marketShare.trim(),
    evidenceStatus: competitorForm.value.evidenceStatus,
    source,
    notes: competitorForm.value.notes.trim() || 'No competitor claim should be treated as real until source evidence is attached.',
  }
  const saved = editingCompetitorId.value
    ? intelligence.updateCompetitor(editingCompetitorId.value, payload)
    : intelligence.addCompetitor(payload)
  if (!saved) {
    message.error('Competitor record was not found')
    return
  }
  if (competitorForm.value.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Competitor saved as To Verify because verified records need usable source evidence')
  } else {
    message.success(editingCompetitorId.value ? 'Competitor record updated' : 'Competitor record saved in this browser workspace')
  }
  resetCompetitorForm()
}
</script>

<template>
  <div class="competitor-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Competitor intelligence</p>
        <h2 class="header-title">Evidence-Backed Competitor Tracking</h2>
        <p class="page-copy">
          Track product equivalents, certifications, distribution presence, and source links. Pricing/cost fields are
          restricted for employee-style roles. Unknown market share is always displayed as To Verify.
        </p>
        <p class="section-help-text">Market share must be source-backed or labeled as an assumption. Unknown values stay To Verify and should become research tasks.</p>
      </div>
      <div class="refresh-card">
        <span>Last updated: {{ formatDateTime(refreshState.lastRun) }}</span>
        <span>Next update: {{ formatDateTime(refreshState.nextRun) }}</span>
        <span>Status: {{ refreshState.lastStatus }}</span>
        <span>Needs review: {{ refreshState.resultNeedsReviewCount }}</span>
        <NButton size="tiny" type="primary" @click="syncCompetitorsNow">Sync Now</NButton>
        <RouterLink class="header-link" :to="{ name: 'hermes.marketIntelligence' }">Market Intelligence</RouterLink>
      </div>
    </header>

    <section class="product-context-panel" aria-label="Product context panel">
      <div>
        <h3>Product Context Panel</h3>
        <p>Brochure-backed product context only. Missing form, dosing, pH, and application data stays To Verify.</p>
      </div>
      <div class="product-context-row head">
        <span>Product</span><span>Form / Type</span><span>Dosing</span><span>pH</span><span>Application</span><span>Evidence Status</span>
      </div>
      <div v-for="row in productContextRows" :key="row.product" class="product-context-row">
        <span>{{ row.product }}</span>
        <span>{{ row.formType }}</span>
        <span>{{ row.dosing }}</span>
        <span>{{ row.ph }}</span>
        <span>{{ row.application }}</span>
        <span class="status-badge to-verify">{{ row.evidenceStatus }}</span>
      </div>
    </section>

    <section class="competitor-form" aria-label="Add competitor record">
      <div>
        <h3>Add competitor evidence</h3>
        <p>Saved locally in this browser workspace. Unknown market share is always displayed as To Verify.</p>
      </div>
      <label>Company<input v-model="competitorForm.companyName" type="text" placeholder="Company name" /></label>
      <label>Region<input v-model="competitorForm.countryRegion" type="text" placeholder="Country / region" /></label>
      <label>Product equivalent<input v-model="competitorForm.productEquivalent" type="text" placeholder="Equivalent product" /></label>
      <label>Active content<input v-model="competitorForm.activeContent" type="text" placeholder="Active content" /></label>
      <label v-if="!redactSensitiveFields">Pricing evidence<input v-model="competitorForm.pricingEvidence" type="text" placeholder="Quote, source, or Missing" /></label>
      <label v-else>Pricing evidence<input type="text" value="Restricted" disabled /></label>
      <label>Certifications<input v-model="competitorForm.certifications" type="text" placeholder="To Verify" /></label>
      <label>Distribution<input v-model="competitorForm.distributionPresence" type="text" placeholder="To Verify" /></label>
      <label>Market share<input v-model="competitorForm.marketShare" type="text" placeholder="Leave blank unless sourced" /></label>
      <label>
        Evidence status
        <select v-model="competitorForm.evidenceStatus">
          <option>To Verify</option>
          <option>Missing</option>
          <option>Assumption</option>
          <option>Powerful Assumption</option>
          <option>Source-backed</option>
          <option>User Approved</option>
          <option>Verified</option>
        </select>
      </label>
      <label>Source title<input v-model="competitorForm.sourceTitle" type="text" placeholder="Source title" /></label>
      <label>Source URL<input v-model="competitorForm.sourceUrl" type="url" placeholder="https://..." /></label>
      <label>Source date<input v-model="competitorForm.sourceDate" type="date" /></label>
      <label class="wide">Notes<input v-model="competitorForm.notes" type="text" placeholder="Evidence notes" /></label>
      <NButton secondary type="primary" @click="addCompetitor">{{ competitorSubmitLabel }}</NButton>
      <NButton v-if="editingCompetitorId" secondary @click="resetCompetitorForm">Cancel edit</NButton>
    </section>

    <section class="competitor-table" aria-label="Competitor list">
      <h3>Competitor Landscape Table</h3>
      <div class="competitor-row head">
        <span>Competitor</span><span>HQ / Country</span><span>Market Share</span><span>Price/kg</span><span>Strength</span><span>Weakness</span><span>Source</span><span>Evidence Status</span><span>Action</span>
      </div>
      <p v-if="competitors.length === 0" class="empty-state">
        No competitor records saved yet. Add sourced records above, or create research tasks for unknown competitors.
      </p>
      <div
        v-for="competitor in competitors"
        :key="competitor.id"
        class="competitor-row"
        :class="{ sourced: sourceIsUsable(competitor.source), verify: competitorMarketShareLabel(competitor).includes('To Verify') }"
      >
        <span>{{ competitor.companyName }}</span>
        <span>{{ competitor.countryRegion }}</span>
        <span class="market-share-label">{{ competitorMarketShareLabel(competitor) }}</span>
        <span>{{ visibleSensitiveValue(competitor.pricingEvidence) }}</span>
        <span>{{ competitor.productEquivalent || 'To Verify' }}</span>
        <span class="weakness-label">{{ competitor.notes || 'To Verify' }}</span>
        <span>{{ competitor.source?.title || 'Source missing' }}</span>
        <span class="status-badge" :class="competitor.evidenceStatus.toLowerCase().replace(/\s+/g, '-')">{{ competitor.evidenceStatus }}</span>
        <span class="row-actions">
          <NButton size="tiny" secondary @click="startEditCompetitor(competitor)">
            Edit
          </NButton>
          <NButton size="tiny" secondary @click="stageCompetitorForReview(competitor)">
            Stage for review
          </NButton>
          <NButton size="tiny" secondary type="primary" :loading="creating === competitor.companyName" @click="createResearchTask(competitor)">
            Research competitor
          </NButton>
          <NButton size="tiny" quaternary type="error" @click="removeCompetitor(competitor)">
            Remove
          </NButton>
        </span>
      </div>
    </section>

    <section class="market-share-panel" aria-label="Competitor market share chart">
      <div>
        <h3>Competitor Market Share Chart</h3>
        <p>Source-backed bars are green; assumption bars are amber. Unknown shares do not become fake bars.</p>
      </div>
      <p v-if="marketShareChartRows.length === 0" class="empty-state">
        No source-backed competitor share data yet.
      </p>
      <div v-for="row in marketShareChartRows" :key="row.competitor.id" class="share-row" :class="{ assumption: row.isAssumption }">
        <span>{{ row.label }}</span>
        <div class="share-track">
          <i :style="{ width: `${Math.min(row.numericShare, 100)}%` }"></i>
        </div>
        <strong>{{ row.shareLabel }}</strong>
      </div>
    </section>

    <section class="competitor-actions" aria-label="Competitor actions">
      <NButton size="small" secondary @click="createGenericCompetitorTask('Competitor to verify', 'Research competitor action')">
        Research Competitor
      </NButton>
      <NButton size="small" secondary @click="message.info('Add Source by editing or adding a competitor evidence record above')">Add Source</NButton>
      <NButton size="small" secondary @click="createGenericCompetitorTask('Competitor verification task', 'Create verification task action')">
        Create Verification Task
      </NButton>
      <RouterLink class="header-link" :to="{ name: 'hermes.researchResultReview' }">Add to Investor Review</RouterLink>
      <RouterLink class="header-link" :to="{ name: 'hermes.feasibility' }">Compare with CWAS/CWMS</RouterLink>
      <NButton size="small" secondary @click="syncCompetitorsNow">Schedule Deeper Research</NButton>
    </section>

    <section class="detail-grid">
      <article>
        <h3>Product equivalents</h3>
        <p>To Verify until product active content and source documents are attached.</p>
      </article>
      <article>
        <h3>Pricing evidence</h3>
        <p>Use quotes, invoices, screenshots, distributor proof, or cited public sources. No fake percentages.</p>
      </article>
      <article>
        <h3>Strengths / weaknesses</h3>
        <p>Write notes only after sources are reviewed. Unsourced claims should remain To Verify.</p>
      </article>
      <article>
        <h3>Research jobs</h3>
        <p>Use Kanban tasks for competitor research until scheduled research jobs are safely integrated.</p>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.competitor-view {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.product-context-panel,
.competitor-form,
.competitor-table,
.market-share-panel,
.competitor-actions,
.detail-grid article {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header,
.product-context-panel,
.competitor-form,
.competitor-table,
.market-share-panel,
.competitor-actions,
.detail-grid article {
  position: relative;
  overflow: hidden;
}

.product-context-panel::before,
.competitor-form::before,
.competitor-table::before,
.market-share-panel::before,
.competitor-actions::before,
.detail-grid article::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: $executive-strip;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
  padding: 18px;
}

.competitor-form {
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
  select {
    min-width: 0;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-input;
    color: $text-primary;
    padding: 8px 10px;
    text-transform: none;
  }
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.page-copy,
.detail-grid p {
  color: $text-secondary;
  line-height: 1.55;
}

.header-link,
.detail-grid a {
  color: $accent-info;
  font-weight: 800;
}

.refresh-card {
  display: grid;
  gap: 6px;
  min-width: 240px;
  padding: 10px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: $radius-sm;
  background: rgba(var(--accent-primary-rgb), 0.08);

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }
}

.product-context-panel,
.market-share-panel,
.competitor-actions {
  margin: 14px 0;
  padding: 16px;
}

.product-context-panel h3,
.market-share-panel h3,
.competitor-table h3 {
  margin: 0 0 8px;
  color: $text-primary;
}

.product-context-panel p,
.market-share-panel p {
  color: $text-secondary;
}

.product-context-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) repeat(4, minmax(90px, 0.8fr)) minmax(110px, auto);
  gap: 10px;
  align-items: center;
  padding: 9px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  &.head {
    color: $accent-primary;
    font-weight: 900;
    text-transform: uppercase;
  }

  > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.competitor-table {
  margin: 14px 0;
  padding: 16px;
}

.competitor-row {
  display: grid;
  grid-template-columns: 1fr 0.75fr 0.85fr 0.85fr 1fr 1fr 0.9fr 0.8fr 170px;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.head {
    border-top: 0;
    color: $accent-primary;
    font-size: 12px;
    font-weight: 900;
  }

  &.sourced {
    border-color: rgba(var(--success-rgb), 0.28);
  }

  &.verify {
    background: rgba(var(--accent-primary-rgb), 0.04);
  }
}

.weakness-label {
  color: $error;
  font-weight: 700;
}

.market-share-label {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  padding: 3px 8px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.36);
  border-radius: 999px;
  color: $accent-primary;
  font-size: 11px;
  font-weight: 900;
}

.competitor-row .status-badge {
  width: fit-content;
  padding: 3px 8px;
  font-size: 10px;
}

.row-actions {
  display: grid;
  gap: 8px;
}

.empty-state {
  border-top: 1px solid $border-color;
  margin: 0;
  padding: 12px 0 0;
  color: $text-secondary;
}

.share-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(180px, 2fr) minmax(120px, auto);
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid $border-color;
  color: $text-secondary;

  &.assumption .share-track i {
    background: $warning;
  }

  strong {
    color: $accent-primary;
  }
}

.share-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(var(--text-muted-rgb), 0.25);
  overflow: hidden;

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: $success;
  }
}

.competitor-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;

  article {
    padding: 16px;
  }

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }
}

@media (max-width: 940px) {
  .page-header,
  .product-context-row,
  .competitor-row {
    grid-template-columns: 1fr;
  }

  .share-row {
    grid-template-columns: 1fr;
  }
}
</style>
