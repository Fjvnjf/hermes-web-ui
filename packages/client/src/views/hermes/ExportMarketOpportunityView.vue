<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  EXPORT_MARKET_STORAGE_KEY,
  createExportMarketResearchTaskBody,
  exportMarketStatusLabel,
  nowIsoDate,
  sourceBackedOrToVerify,
  type ExportMarketRecord,
} from '@/utils/intelligenceWorkflow'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

const message = useMessage()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()
const intelligence = useFeasibilityIntelligence()

const records = ref<ExportMarketRecord[]>(loadRecords())
const savingKey = ref('')
const growthPeriod = ref('3-year')
const productScope = ref('CWAS/CWMS')
const rankingType = ref('best export markets from China')

const growthPeriods = ['1-year', '3-year', '5-year', '10-year']
const productScopes = ['CWAS', 'CWMS', 'textile softeners', 'esterquat / cationic softener category', 'textile auxiliary chemicals']
const rankingTypes = [
  'largest importers',
  'fastest-growing importers',
  'largest textile/manufacturing proxy markets',
  'best export markets from China',
  'highest opportunity score',
]
const evidenceStatuses: IntelligenceEvidenceStatus[] = [
  'To Verify',
  'Source-backed',
  'User Provided',
  'User Approved',
  'Assumption',
  'Powerful Assumption',
  'Reference Only',
  'Verified',
]

const form = ref({
  country: '',
  productScope: 'CWAS/CWMS',
  hsCode: '',
  dataMethod: 'Trade proxy / To Verify',
  valueVolume: '',
  growth: '',
  source: '',
  sourceDate: nowIsoDate(),
  confidence: 'low' as ExportMarketRecord['confidence'],
  evidenceStatus: 'To Verify' as IntelligenceEvidenceStatus,
  opportunityScore: '',
  notes: '',
})

function loadRecords(): ExportMarketRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(EXPORT_MARKET_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(EXPORT_MARKET_STORAGE_KEY, JSON.stringify(records.value))
}

function countryFromClaimLabel(label: string): string {
  const parts = label.split(/\s+-\s+/)
  return parts.length > 1 ? parts.slice(1).join(' - ').trim() : label.replace(/country-wise|consumption|growth|export|opportunity|market/gi, '').trim()
}

function hsCodeFromClaim(label: string, value: string, sourceUrl?: string): string {
  const text = `${label} ${value} ${sourceUrl || ''}`
  return text.match(/(?:hs\s*|product\/)(\d{6})/i)?.[1] || ''
}

function growthFromClaim(value: string): string {
  return value.match(/(?:yoy|growth|change)[^+\-\d]*([+\-]?\d+(?:\.\d+)?%)/i)?.[1] || 'Trade Proxy / To Verify'
}

const autopilotRecords = computed<ExportMarketRecord[]>(() =>
  intelligence.state.value.marketClaims
    .filter(claim => {
      const label = claim.label.toLowerCase()
      return label.includes('country-wise') ||
        label.includes('consumption growth') ||
        label.includes('export opportunity') ||
        label.includes('import proxy') ||
        label.includes('trade proxy')
    })
    .map((claim, index) => {
      const value = claim.value || 'To Verify'
      const source = claim.source?.title || 'Source review needed'
      const hsCode = hsCodeFromClaim(claim.label, value, claim.source?.url)
      return {
        id: `autopilot-${claim.id || index}`,
        country: countryFromClaimLabel(claim.label) || 'Country To Verify',
        productScope: 'Textile auxiliary / softener trade proxy',
        hsCode,
        rankingType: 'autopilot trusted-source country signal',
        dataMethod: hsCode ? `HS ${hsCode} trade proxy / To Verify` : 'Trade proxy / To Verify',
        valueVolume: value,
        growth: growthFromClaim(value),
        source,
        sourceDate: claim.lastChecked || claim.source?.date || nowIsoDate(),
        confidence: claim.confidence || 'medium',
        evidenceStatus: claim.evidenceStatus === 'Verified' || claim.evidenceStatus === 'Investor Approved'
          ? 'Trade Proxy'
          : claim.evidenceStatus,
        opportunityScore: 'To Verify',
        notes: 'Auto-filled by Full Dashboard Autopilot from sourced market intelligence. This is a trade proxy, not proven actual consumption.',
        lastChecked: claim.lastChecked || nowIsoDate(),
      }
    }),
)

const displayRecords = computed(() => {
  const used = new Set(autopilotRecords.value.map(record => record.country.toLowerCase()))
  return [
    ...autopilotRecords.value,
    ...records.value.filter(record => !used.has(record.country.toLowerCase())),
  ]
})

const sourceBackedCount = computed(() => displayRecords.value.filter(item => item.evidenceStatus === 'Source-backed' || item.evidenceStatus === 'Verified' || item.evidenceStatus === 'Official Data').length)
const toVerifyCount = computed(() => displayRecords.value.filter(item => item.evidenceStatus === 'To Verify' || item.evidenceStatus === 'Reference Only' || item.evidenceStatus === 'Trade Proxy').length)
const tradeProxyCount = computed(() => displayRecords.value.filter(item => !item.hsCode.trim() || item.dataMethod.toLowerCase().includes('proxy')).length)

const summaryCards = computed(() => [
  { label: 'Country records', value: displayRecords.value.length, note: autopilotRecords.value.length ? `${autopilotRecords.value.length} auto-filled by Hermes` : 'User/source-entered only' },
  { label: 'Source-backed', value: sourceBackedCount.value, note: 'Source/date required' },
  { label: 'Trade proxy', value: tradeProxyCount.value, note: 'Not actual consumption' },
  { label: 'To Verify', value: toVerifyCount.value, note: 'Incomplete evidence' },
])

function saveRecord() {
  const country = form.value.country.trim()
  if (!country) {
    message.warning('Add a country before saving')
    return
  }
  const status = sourceBackedOrToVerify(
    [form.value.valueVolume, form.value.growth, form.value.opportunityScore].filter(Boolean).join(' '),
    form.value.source,
    form.value.sourceDate,
    form.value.evidenceStatus,
  )
  const record: ExportMarketRecord = {
    id: `${country.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
    country,
    productScope: form.value.productScope,
    hsCode: form.value.hsCode.trim(),
    rankingType: rankingType.value,
    dataMethod: form.value.dataMethod.trim() || exportMarketStatusLabel(form.value.hsCode),
    valueVolume: form.value.valueVolume.trim() || 'To Verify',
    growth: form.value.growth.trim() || 'To Verify',
    source: form.value.source.trim(),
    sourceDate: form.value.sourceDate.trim(),
    confidence: form.value.confidence,
    evidenceStatus: status,
    opportunityScore: form.value.opportunityScore.trim() || 'To Verify',
    notes: form.value.notes.trim() || exportMarketStatusLabel(form.value.hsCode),
    lastChecked: nowIsoDate(),
  }
  records.value = [record, ...records.value]
  persist()
  if (status === 'To Verify') message.warning('Country record saved as To Verify because source/value evidence is incomplete')
  else message.success('Country opportunity record saved in this browser workspace')
}

function taskBodyFor(record?: ExportMarketRecord): string {
  if (!record) return createExportMarketResearchTaskBody(productScope.value, rankingType.value, growthPeriod.value)
  return [
    `Research country opportunity: ${record.country}`,
    `Product scope: ${record.productScope}`,
    `HS code: ${record.hsCode || 'To Verify'}`,
    `Data method: ${record.dataMethod}`,
    `Value/volume: ${record.valueVolume}`,
    `Growth: ${record.growth}`,
    `Opportunity score: ${record.opportunityScore}`,
    `Source: ${record.source || 'Missing'}`,
    `Source date: ${record.sourceDate || 'Missing'}`,
    `Evidence status: ${record.evidenceStatus}`,
    `Confidence: ${record.confidence}`,
    `Notes: ${record.notes}`,
    '',
    'Do not call proxy import/export data actual consumption unless source proves consumption.',
    'Tags: Export Market Opportunity, Country Demand, Trade Proxy, To Verify',
  ].join('\n')
}

async function createTask(record?: ExportMarketRecord) {
  const key = record?.id || 'general'
  savingKey.value = `${key}-task`
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: record ? `Verify export opportunity: ${record.country}` : `Research export markets: ${productScope.value}`,
      body: taskBodyFor(record),
      priority: record?.evidenceStatus === 'Source-backed' ? 2 : 3,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Export market task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    savingKey.value = ''
  }
}

function tonightSchedule(): string {
  const date = new Date()
  date.setHours(22, 0, 0, 0)
  if (date <= new Date()) date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 19)
}

async function scheduleResearch(record?: ExportMarketRecord) {
  const key = record?.id || 'general'
  savingKey.value = `${key}-research`
  const title = record ? `Country opportunity: ${record.country}` : `Export opportunity: ${productScope.value}`
  const prompt = record
    ? taskBodyFor(record)
    : createExportMarketResearchTaskBody(productScope.value, rankingType.value, growthPeriod.value)
  try {
    const job = await jobsStore.createJob({
      name: `Research: ${title}`,
      schedule: tonightSchedule(),
      prompt,
      deliver: 'local',
      repeat: 1,
    })
    intelligence.addResearchJob({
      title,
      question: record ? `Is ${record.country} a source-backed opportunity for ${record.productScope}?` : `Which countries are source-backed export opportunities for ${productScope.value}?`,
      scope: 'HS code verification, import/export proxy, textile manufacturing proxy, source-backed confidence, and evidence gaps.',
      expectedOutput: 'Structured country opportunity result for Research Result Review before dashboard updates.',
      sourceRequirements: 'Use UN Comtrade, ITC Trade Map, WITS/World Bank, uploaded reports, or cited source links/dates. Label proxy data clearly.',
      priority: 'medium',
      schedulePreference: 'Tonight',
      scheduledJobId: job.job_id || job.id,
      schedule: tonightSchedule(),
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    message.success('Hermes research job scheduled')
  } catch {
    await createTask(record)
  } finally {
    savingKey.value = ''
  }
}

function addToInvestorReview(record: ExportMarketRecord) {
  const saved = intelligence.addResearchFinding({
    summary: taskBodyFor(record),
    keyClaim: `Country opportunity: ${record.country}`,
    area: 'market',
    evidenceStatus: record.evidenceStatus === 'Verified' && !(record.source && record.sourceDate) ? 'To Verify' : record.evidenceStatus,
    confidence: record.confidence,
    source: record.source ? { title: record.source, date: record.sourceDate || undefined } : null,
    suggestedTask: `Verify country opportunity source and HS-code confidence for ${record.country}.`,
    suggestedInvestorMaterial: record.evidenceStatus === 'Source-backed' || record.evidenceStatus === 'Verified' || record.evidenceStatus === 'User Approved'
      ? `${record.country} may be considered for ${record.productScope} export review based on ${record.dataMethod}. Value/volume: ${record.valueVolume}. Growth: ${record.growth}.`
      : '',
    riskNote: record.evidenceStatus === 'To Verify' ? 'Country opportunity is not investor-ready until HS code/data source is verified.' : 'Review source quality before investor use.',
  })
  if (saved.evidenceStatus === 'To Verify') message.info('Country record staged for review as To Verify')
  else message.success('Country record staged for investor review')
}
</script>

<template>
  <div class="export-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Export market opportunity</p>
        <h2 class="header-title">Country-wise Demand / Trade Proxy Workspace</h2>
        <p class="page-copy">
          Research biggest consuming or opportunity countries for CWAS/CWMS and related textile softener categories.
          HS codes must be verified first; proxy data is never treated as actual consumption.
        </p>
      </div>
      <div class="header-actions">
        <RouterLink class="shell-link" :to="{ name: 'hermes.marketIntelligence' }">Market Intelligence</RouterLink>
        <RouterLink class="shell-link" :to="{ name: 'hermes.researchResultReview' }">Research Review</RouterLink>
      </div>
    </header>

    <section class="summary-grid">
      <article v-for="card in summaryCards" :key="card.label" class="summary-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.note }}</small>
      </article>
    </section>

    <section class="control-panel">
      <label>
        Product scope
        <select v-model="productScope">
          <option v-for="scope in productScopes" :key="scope" :value="scope">{{ scope }}</option>
        </select>
      </label>
      <label>
        Growth period
        <select v-model="growthPeriod">
          <option v-for="period in growthPeriods" :key="period" :value="period">{{ period }}</option>
        </select>
      </label>
      <label>
        Ranking type
        <select v-model="rankingType">
          <option v-for="type in rankingTypes" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <NButton :loading="savingKey === 'general-task'" @click="createTask()">Research this market</NButton>
      <NButton :loading="savingKey === 'general-research'" @click="scheduleResearch()">Schedule deeper research</NButton>
    </section>

    <section class="form-panel">
      <h3>Add country/source record</h3>
      <div class="form-grid">
        <label>Country <input v-model="form.country" placeholder="Country name" /></label>
        <label>
          Product scope
          <select v-model="form.productScope">
            <option v-for="scope in productScopes" :key="scope" :value="scope">{{ scope }}</option>
          </select>
        </label>
        <label>HS code <input v-model="form.hsCode" placeholder="To Verify" /></label>
        <label>Data method <input v-model="form.dataMethod" placeholder="Trade proxy / To Verify" /></label>
        <label>Import value/volume <input v-model="form.valueVolume" placeholder="To Verify" /></label>
        <label>Growth/CAGR <input v-model="form.growth" placeholder="To Verify" /></label>
        <label>Opportunity score <input v-model="form.opportunityScore" placeholder="To Verify" /></label>
        <label>Source <input v-model="form.source" placeholder="UN Comtrade / ITC / uploaded report / link" /></label>
        <label>Source date <input v-model="form.sourceDate" type="date" /></label>
        <label>
          Evidence status
          <select v-model="form.evidenceStatus">
            <option v-for="status in evidenceStatuses" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <label>
          Confidence
          <select v-model="form.confidence">
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>Notes <input v-model="form.notes" placeholder="Proxy caveat, source limitation, follow-up" /></label>
      </div>
      <NButton type="primary" @click="saveRecord">Save country record</NButton>
    </section>

    <section class="records-panel">
      <header>
        <h3>Country records</h3>
        <p v-if="autopilotRecords.length" class="autopilot-note">
          Hermes Autopilot has filled {{ autopilotRecords.length }} country-wise trade-proxy records from sourced market claims.
          They remain To Verify / Trade Proxy until HS-code methodology and product-specific demand are reviewed.
        </p>
        <p v-if="!displayRecords.length">No country rankings yet. Add source-backed records or create a research task.</p>
      </header>

      <article v-for="record in displayRecords" :key="record.id" class="country-card">
        <div>
          <p class="eyebrow">{{ record.productScope }}</p>
          <h3>{{ record.country }}</h3>
          <p>{{ record.notes || exportMarketStatusLabel(record.hsCode) }}</p>
        </div>
        <dl>
          <div><dt>HS code</dt><dd>{{ record.hsCode || 'To Verify' }}</dd></div>
          <div><dt>Method</dt><dd>{{ record.dataMethod }}</dd></div>
          <div><dt>Value/volume</dt><dd>{{ record.valueVolume }}</dd></div>
          <div><dt>Growth</dt><dd>{{ record.growth }}</dd></div>
          <div><dt>Opportunity</dt><dd>{{ record.opportunityScore }}</dd></div>
          <div><dt>Source</dt><dd>{{ record.source || 'Missing' }} {{ record.sourceDate ? `/ ${record.sourceDate}` : '' }}</dd></div>
          <div><dt>Status</dt><dd>{{ record.evidenceStatus }}</dd></div>
        </dl>
        <div class="action-row">
          <NButton size="small" :loading="savingKey === `${record.id}-task`" @click="createTask(record)">Create task</NButton>
          <NButton size="small" :loading="savingKey === `${record.id}-research`" @click="scheduleResearch(record)">Schedule research</NButton>
          <NButton size="small" secondary @click="addToInvestorReview(record)">Add to investor review</NButton>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.export-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header,
.summary-card,
.control-panel,
.form-panel,
.records-panel,
.country-card {
  border: 1px solid rgba(128, 162, 190, 0.26);
  background: rgba(5, 14, 24, 0.84);
  border-radius: 8px;
  padding: 18px;
}

.page-header,
.control-panel,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.eyebrow,
.summary-card span,
dt {
  color: #38d5ff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0;
}

.header-title,
h3,
.summary-card strong {
  color: #f2c86b;
}

.page-copy,
p,
label,
dd,
small {
  color: #a8b6c7;
}

.summary-grid,
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}

input,
select {
  width: 100%;
  margin-top: 6px;
  border: 1px solid rgba(128, 162, 190, 0.28);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.24);
  color: #f6fbff;
  padding: 8px;
}

.country-card {
  display: grid;
  gap: 14px;
  margin-top: 12px;
}

.autopilot-note {
  margin: 10px 0 0;
  border: 1px solid rgba(56, 213, 255, 0.22);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(56, 213, 255, 0.06);
  color: #c8d4e3;
}

dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

dt,
dd {
  margin: 0;
}

.shell-link {
  color: #38d5ff;
  text-decoration: none;
}
</style>
