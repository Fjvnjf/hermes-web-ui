<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NTag, useMessage } from 'naive-ui'
import {
  type DataRoomSourceRecord,
  type ResearchReviewFinding,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creatingTaskFor = ref('')

const regulatoryEvidence = computed(() =>
  intelligence.state.value.dataRoomSources.filter(record =>
    record.dashboardGroup === 'regulatoryFindings' ||
    record.area === 'regulatory' ||
    regulatoryText(record).includes('regulatory') ||
    regulatoryText(record).includes('dms') ||
    regulatoryText(record).includes('dimethyl sulfate') ||
    regulatoryText(record).includes('cas') ||
    regulatoryText(record).includes('permit'),
  ),
)

const autopilotRegulatoryEvidence = computed(() =>
  regulatoryEvidence.value.filter(record => record.dashboardGroup === 'regulatoryFindings'),
)

const regulatoryReviewItems = computed(() =>
  intelligence.state.value.researchFindings.filter(finding =>
    finding.area === 'regulatory' ||
    finding.dashboardTarget?.group === 'regulatoryFindings',
  ),
)

const pendingReviewItems = computed(() =>
  regulatoryReviewItems.value.filter(item => item.status === 'Pending Review' || item.status === 'To Verify'),
)

const sourceBackedCount = computed(() =>
  regulatoryEvidence.value.filter(record =>
    record.evidenceStatus === 'Source-backed' ||
    record.evidenceStatus === 'Official Data' ||
    record.evidenceStatus === 'Supplier Evidence' ||
    record.evidenceStatus === 'User Approved',
  ).length,
)

const dmsRiskItems = computed(() =>
  regulatoryEvidence.value.filter(record => /dms|dimethyl sulfate/i.test(regulatoryText(record))).length +
  regulatoryReviewItems.value.filter(finding => /dms|dimethyl sulfate/i.test(regulatoryFindingText(finding))).length,
)

const summaryCards = computed(() => [
  {
    label: 'Autopilot Regulatory Candidates',
    value: autopilotRegulatoryEvidence.value.length,
    note: 'Filled by Full Dashboard Autopilot',
  },
  {
    label: 'Source-backed Inputs',
    value: sourceBackedCount.value,
    note: 'Still review-gated before investor use',
  },
  {
    label: 'Pending Review',
    value: pendingReviewItems.value.length,
    note: 'Approve or reject in Research Review',
  },
  {
    label: 'DMS / High-risk Signals',
    value: dmsRiskItems.value,
    note: 'Never treated as verified automatically',
  },
])

const checklistRows = computed(() => [
  regulatoryChecklistRow('DMS meaning confirmation', ['dms', 'dimethyl sulfate', 'chemical identity']),
  regulatoryChecklistRow('China regulatory status', ['china regulatory', 'regulatory status', 'restriction', 'inventory']),
  regulatoryChecklistRow('SDS / TDS / CAS evidence', ['sds', 'tds', 'cas']),
  regulatoryChecklistRow('Factory storage and use permission', ['factory', 'storage', 'permit', 'approval']),
  regulatoryChecklistRow('Transport, handling, EHS controls', ['transport', 'handling', 'ehs', 'safety']),
])

const sourceRows = computed(() =>
  regulatoryEvidence.value.map(record => ({
    id: record.id,
    field: record.checklistLabel || 'Regulatory evidence',
    value: record.proposedValue || valueFromNotes(record.notes) || 'To Verify',
    source: record.source?.title || 'Source missing',
    sourceUrl: record.source?.url || '',
    sourceDate: record.source?.date || record.updatedAt?.slice(0, 10) || 'Date missing',
    tier: record.sourceTier || 'candidate-source',
    status: statusForRegulatory(record.evidenceStatus),
    confidence: record.confidence || 'medium',
    reviewNote: record.notes || 'Review source before using this claim.',
    record,
  })),
)

function regulatoryText(record: DataRoomSourceRecord): string {
  return [
    record.checklistLabel,
    record.proposedValue,
    record.material,
    record.supplier,
    record.source?.title,
    record.source?.url,
    record.notes,
  ].filter(Boolean).join(' ').toLowerCase()
}

function regulatoryFindingText(finding: ResearchReviewFinding): string {
  return [
    finding.summary,
    finding.keyClaim,
    finding.suggestedTask,
    finding.riskNote,
    finding.dashboardTarget?.field,
    finding.dashboardTarget?.value,
  ].filter(Boolean).join(' ').toLowerCase()
}

function valueFromNotes(notes: string): string {
  return notes.match(/Proposed value:\s*([^\n]+)/i)?.[1]?.trim() || ''
}

function statusForRegulatory(status: IntelligenceEvidenceStatus): IntelligenceEvidenceStatus {
  if (status === 'Verified' || status === 'Investor Approved') return 'To Verify'
  return status
}

function statusType(status: IntelligenceEvidenceStatus): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'Source-backed' || status === 'Official Data' || status === 'Supplier Evidence' || status === 'User Approved') return 'success'
  if (status === 'Reference Only' || status === 'Trade Proxy' || status === 'Assumption') return 'warning'
  if (status === 'Missing' || status === 'To Verify') return 'error'
  return 'info'
}

function regulatoryChecklistRow(label: string, keywords: string[]) {
  const evidence = regulatoryEvidence.value.find(record => {
    const text = regulatoryText(record)
    return keywords.some(keyword => text.includes(keyword))
  })
  const review = regulatoryReviewItems.value.find(finding => {
    const text = regulatoryFindingText(finding)
    return keywords.some(keyword => text.includes(keyword))
  })
  return {
    label,
    status: evidence ? statusForRegulatory(evidence.evidenceStatus) : review?.evidenceStatus || 'To Verify' as IntelligenceEvidenceStatus,
    value: evidence?.proposedValue || valueFromNotes(evidence?.notes || '') || review?.keyClaim || 'To Verify',
    source: evidence?.source?.title || review?.source?.title || 'Source missing',
    nextAction: evidence
      ? 'Review the source, confirm scope, and approve only if it directly supports the regulatory claim.'
      : 'Ask Hermes to research this item with official/regulatory sources, then review before use.',
  }
}

async function createRegulatoryTask(record?: DataRoomSourceRecord) {
  const key = record?.id || 'general-regulatory'
  creatingTaskFor.value = key
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: record ? `Regulatory review: ${record.checklistLabel}` : 'Regulatory research: DMS and China compliance',
      body: [
        'Source page: Regulatory Intelligence',
        `Regulatory item: ${record?.checklistLabel || 'DMS status, SDS/TDS/CAS, China factory/storage/use permission, and EHS requirements'}`,
        `Evidence status: ${record?.evidenceStatus || 'To Verify'}`,
        `Source: ${record?.source?.title || 'Missing'}`,
        record?.source?.url ? `URL: ${record.source.url}` : '',
        record?.proposedValue ? `Proposed value: ${record.proposedValue}` : '',
        '',
        'Do not mark regulatory status, DMS handling, CAS/formula details, import/storage/use permission, or investor claims as verified until the source directly supports the exact claim.',
        'Tags: Regulatory Intelligence, Evidence Gap, Chemicon China Feasibility',
      ].filter(Boolean).join('\n'),
      priority: 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Regulatory review task created')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown Kanban error'
    message.error(`Could not create regulatory task: ${detail}`)
  } finally {
    creatingTaskFor.value = ''
  }
}
</script>

<template>
  <main class="regulatory-view">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">Chemicon China Feasibility</p>
        <h1>Regulatory Intelligence</h1>
        <p>
          Hermes surfaces regulatory findings from trusted-source autopilot runs here, but DMS, CAS,
          factory permissions, SDS/TDS, and China compliance claims remain review-gated until approved.
        </p>
      </div>
      <div class="hero-actions">
        <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review Queue</RouterLink>
        <RouterLink :to="{ name: 'hermes.files' }">Documents</RouterLink>
        <RouterLink :to="{ name: 'hermes.chat' }">Ask Hermes</RouterLink>
      </div>
    </section>

    <TrustedSourceAutopilotPanel screen="regulatory" title="Regulatory Auto Source Status" />

    <section class="summary-grid">
      <article v-for="card in summaryCards" :key="card.label" class="summary-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.note }}</small>
      </article>
    </section>

    <section class="content-grid">
      <article class="panel">
        <header>
          <div>
            <p class="eyebrow">Autopilot checklist</p>
            <h2>DMS / SDS / factory permission status</h2>
          </div>
          <NButton secondary size="small" :loading="creatingTaskFor === 'general-regulatory'" @click="createRegulatoryTask()">
            Create Review Task
          </NButton>
        </header>
        <div class="checklist-table">
          <div class="table-head">
            <span>Requirement</span>
            <span>Status</span>
            <span>Current signal</span>
            <span>Next action</span>
          </div>
          <div v-for="row in checklistRows" :key="row.label" class="table-row">
            <strong>{{ row.label }}</strong>
            <NTag :type="statusType(row.status)" size="small">{{ row.status }}</NTag>
            <span>{{ row.value }}</span>
            <span>{{ row.nextAction }}</span>
          </div>
        </div>
      </article>

      <article class="panel source-panel">
        <header>
          <div>
            <p class="eyebrow">Full dashboard autopilot</p>
            <h2>Regulatory source candidates</h2>
          </div>
          <RouterLink :to="{ name: 'hermes.trustedSources' }">Trusted Sources</RouterLink>
        </header>
        <p v-if="autopilotRegulatoryEvidence.length" class="autopilot-note">
          Hermes Autopilot has filled {{ autopilotRegulatoryEvidence.length }} regulatory candidate records.
          They are visible for review, not treated as verified legal advice or investor-approved facts.
        </p>
        <p v-else class="empty-note">
          No regulatory findings have been imported yet. The twice-daily Full Dashboard Autopilot prompt already asks Hermes to research regulatory sources and stage outputs.
        </p>

        <div v-for="row in sourceRows" :key="row.id" class="source-card">
          <div class="source-title-row">
            <div>
              <p class="eyebrow">{{ row.tier }} / {{ row.confidence }}</p>
              <h3>{{ row.field }}</h3>
            </div>
            <NTag :type="statusType(row.status)" size="small">{{ row.status }}</NTag>
          </div>
          <p class="source-value">{{ row.value }}</p>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>
                <a v-if="row.sourceUrl" :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">{{ row.source }}</a>
                <span v-else>{{ row.source }}</span>
              </dd>
            </div>
            <div>
              <dt>Checked</dt>
              <dd>{{ row.sourceDate }}</dd>
            </div>
          </dl>
          <p class="review-note">{{ row.reviewNote }}</p>
          <div class="source-actions">
            <NButton secondary size="small" :loading="creatingTaskFor === row.id" @click="createRegulatoryTask(row.record)">
              Create Task
            </NButton>
            <RouterLink :to="{ name: 'hermes.researchResultReview' }">Review</RouterLink>
          </div>
        </div>
      </article>
    </section>

    <section class="panel review-panel">
      <header>
        <div>
          <p class="eyebrow">Owner approval required</p>
          <h2>Regulatory review queue</h2>
        </div>
        <RouterLink :to="{ name: 'hermes.researchResultReview' }">Open Research Review</RouterLink>
      </header>
      <div v-if="regulatoryReviewItems.length" class="review-list">
        <article v-for="finding in regulatoryReviewItems.slice(0, 6)" :key="finding.id" class="review-item">
          <div>
            <strong>{{ finding.keyClaim }}</strong>
            <p>{{ finding.summary }}</p>
          </div>
          <NTag :type="statusType(finding.evidenceStatus)" size="small">{{ finding.status }}</NTag>
        </article>
      </div>
      <p v-else class="empty-note">
        No regulatory review items yet. Missing or high-risk regulatory outputs from Hermes will appear here first, not directly as verified dashboard truth.
      </p>
    </section>
  </main>
</template>

<style scoped lang="scss">
.regulatory-view {
  min-height: 100%;
  padding: 24px;
  background: #090f18;
  color: #d7dfec;
}

.hero-panel,
.panel,
.summary-card {
  border: 1px solid rgba(80, 104, 142, 0.42);
  border-radius: 8px;
  background: #111927;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
}

.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 24px;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  color: #d9bd5f;
  font-size: 30px;
  line-height: 1.15;
}

h2 {
  color: #d9bd5f;
  font-size: 18px;
}

h3 {
  color: #e5edf7;
  font-size: 15px;
}

.hero-panel p {
  max-width: 760px;
  margin-top: 10px;
  color: #9aa9bf;
}

.eyebrow {
  color: #7f8da5;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.hero-actions,
.source-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

a {
  color: #69d2ff;
  text-decoration: none;
}

.hero-actions a,
.source-actions a,
.review-panel header a,
.source-panel header a {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid rgba(105, 210, 255, 0.28);
  border-radius: 6px;
  padding: 0 12px;
  background: rgba(105, 210, 255, 0.08);
  color: #b9eaff;
  font-weight: 700;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.summary-card {
  padding: 18px;
}

.summary-card span,
.summary-card small {
  display: block;
  color: #7f8da5;
}

.summary-card strong {
  display: block;
  margin: 10px 0 6px;
  color: #d9bd5f;
  font-size: 30px;
  line-height: 1;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 18px;
  margin-top: 18px;
}

.panel {
  padding: 20px;
}

.panel header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 16px;
}

.checklist-table {
  display: grid;
  gap: 1px;
  overflow-x: auto;
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: 1fr 120px 1.25fr 1.4fr;
  gap: 14px;
  min-width: 820px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(80, 104, 142, 0.32);
}

.table-head {
  color: #d9bd5f;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.table-row {
  color: #b8c3d4;
}

.table-row strong {
  color: #e5edf7;
}

.autopilot-note,
.empty-note {
  margin: 0 0 14px;
  border: 1px solid rgba(105, 210, 255, 0.22);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(105, 210, 255, 0.06);
  color: #c8d4e3;
}

.empty-note {
  border-color: rgba(217, 189, 95, 0.22);
  background: rgba(217, 189, 95, 0.06);
}

.source-card,
.review-item {
  border: 1px solid rgba(80, 104, 142, 0.32);
  border-radius: 8px;
  padding: 14px;
  background: rgba(6, 10, 16, 0.28);
}

.source-card + .source-card,
.review-item + .review-item {
  margin-top: 12px;
}

.source-title-row,
.review-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.source-value,
.review-note,
.review-item p {
  margin-top: 10px;
  color: #a8b5c8;
}

dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 14px 0;
}

dt {
  color: #7f8da5;
  font-size: 11px;
  text-transform: uppercase;
}

dd {
  margin: 4px 0 0;
  color: #d7dfec;
}

.review-list {
  display: grid;
  gap: 12px;
}

@media (max-width: 900px) {
  .regulatory-view {
    padding: 16px;
  }

  .hero-panel,
  .content-grid {
    grid-template-columns: 1fr;
  }

  .hero-panel {
    flex-direction: column;
  }

  h1 {
    font-size: 26px;
  }
}

@media (max-width: 520px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .panel header,
  .source-title-row,
  .review-item {
    flex-direction: column;
  }
}
</style>
