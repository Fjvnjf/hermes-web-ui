<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import {
  RAW_MATERIALS_STORAGE_KEY,
  calculatePriceAlert,
  createDefaultRawMaterials,
  isDmsMaterial,
  latestPriceEntry,
  materialPriceAlert,
  nowIsoDate,
  sourceTypeStatus,
  type RawMaterialPriceEntry,
  type RawMaterialRecord,
  type RawMaterialSourceType,
} from '@/utils/intelligenceWorkflow'
import { accessControlWarning, shouldRedactForEmployee } from '@/utils/accessControl'

const message = useMessage()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()
const intelligence = useFeasibilityIntelligence()

const materials = ref<RawMaterialRecord[]>(loadMaterials())
const selectedMaterialId = ref(materials.value[0]?.id || '')
const savingKey = ref('')
const employeeRedaction = computed(() => shouldRedactForEmployee())

const sourceTypes: RawMaterialSourceType[] = [
  'SunSirs',
  'ECHEMI',
  'Supplier quote',
  'Alibaba/Made-in-China reference',
  'Manual entry',
  'Paid source',
]

const priceForm = ref({
  rmbPrice: null as number | null,
  usdPrice: null as number | null,
  unit: 'MT',
  source: '',
  sourceType: 'Supplier quote' as RawMaterialSourceType,
  sourceDate: nowIsoDate(),
  confidence: 'medium' as RawMaterialPriceEntry['confidence'],
  notes: '',
})

function loadMaterials(): RawMaterialRecord[] {
  if (typeof window === 'undefined') return createDefaultRawMaterials()
  try {
    const raw = window.localStorage.getItem(RAW_MATERIALS_STORAGE_KEY)
    if (!raw) return createDefaultRawMaterials()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return createDefaultRawMaterials()
    const byId = new Map(createDefaultRawMaterials().map(item => [item.id, item]))
    for (const item of parsed) {
      if (!item?.id || !byId.has(item.id)) continue
      byId.set(item.id, {
        ...byId.get(item.id)!,
        ...item,
        highRisk: isDmsMaterial(item.name || byId.get(item.id)!.name),
        priceHistory: Array.isArray(item.priceHistory) ? item.priceHistory : [],
      })
    }
    return Array.from(byId.values())
  } catch {
    return createDefaultRawMaterials()
  }
}

function persist() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RAW_MATERIALS_STORAGE_KEY, JSON.stringify(materials.value))
}

const selectedMaterial = computed(() =>
  materials.value.find(item => item.id === selectedMaterialId.value) || materials.value[0],
)

const selectedLatest = computed(() => selectedMaterial.value ? latestPriceEntry(selectedMaterial.value) : null)
const selectedAlert = computed(() => selectedMaterial.value ? materialPriceAlert(selectedMaterial.value) : calculatePriceAlert(null, null))

const summaryCards = computed(() => {
  const sourced = materials.value.filter(item => item.evidenceStatus === 'Source-backed' || item.evidenceStatus === 'Verified').length
  const toVerify = materials.value.filter(item => item.evidenceStatus === 'To Verify' || item.evidenceStatus === 'Reference Only').length
  const alerts = materials.value.filter(item => materialPriceAlert(item).triggered).length
  return [
    { label: 'Tracked materials', value: materials.value.length, note: 'No live prices are hardcoded' },
    { label: 'Source-backed', value: sourced, note: 'Requires source/date and value' },
    { label: 'To Verify', value: toVerify, note: 'Missing or weak evidence' },
    { label: '5% alerts', value: alerts, note: 'Based on saved price history' },
  ]
})

function priceDisplay(value: number | null | undefined, currency: string): string {
  if (employeeRedaction.value) return 'Restricted in Employee View'
  if (!value) return 'Missing / To Verify'
  return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function trendLabel(material: RawMaterialRecord, days: number): string {
  const latest = latestPriceEntry(material)
  if (!latest) return 'Limited data available'
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const baseline = material.priceHistory.find(entry => Date.parse(entry.createdAt) <= cutoff) || material.priceHistory[material.priceHistory.length - 1]
  const alert = calculatePriceAlert(baseline?.rmbPrice ?? baseline?.usdPrice, latest.rmbPrice ?? latest.usdPrice, 0)
  if (!baseline || !alert.percentChange) return 'Limited data available'
  return `${alert.percentChange > 0 ? '+' : ''}${alert.percentChange.toFixed(1)}%`
}

function graphWidth(entry: RawMaterialPriceEntry, history: RawMaterialPriceEntry[]): string {
  const values = history.map(item => item.rmbPrice || item.usdPrice || 0).filter(Boolean)
  const max = Math.max(...values, 1)
  const value = entry.rmbPrice || entry.usdPrice || 0
  return `${Math.max(6, Math.round((value / max) * 100))}%`
}

function addPriceEntry() {
  const material = selectedMaterial.value
  if (!material) return
  const hasPrice = Boolean(priceForm.value.rmbPrice || priceForm.value.usdPrice)
  const evidenceStatus = sourceTypeStatus(
    priceForm.value.sourceType,
    priceForm.value.source,
    priceForm.value.sourceDate,
    hasPrice,
  )
  const entry: RawMaterialPriceEntry = {
    id: `${material.id}-${Date.now().toString(36)}`,
    materialName: material.name,
    unit: priceForm.value.unit.trim() || material.unit,
    rmbPrice: priceForm.value.rmbPrice,
    usdPrice: priceForm.value.usdPrice,
    source: priceForm.value.source.trim(),
    sourceType: priceForm.value.sourceType,
    sourceDate: priceForm.value.sourceDate.trim(),
    confidence: priceForm.value.confidence,
    evidenceStatus,
    notes: priceForm.value.notes.trim(),
    createdAt: new Date().toISOString(),
  }
  material.priceHistory = [entry, ...material.priceHistory].slice(0, 60)
  material.unit = entry.unit
  material.source = entry.source
  material.sourceType = entry.sourceType
  material.sourceDate = entry.sourceDate
  material.confidence = entry.confidence
  material.evidenceStatus = evidenceStatus
  material.notes = [
    entry.sourceType === 'Alibaba/Made-in-China reference' ? 'Supplier listing only - confirmation required.' : '',
    material.highRisk ? 'DMS/dimethyl sulfate is high regulatory/safety risk.' : '',
    entry.notes,
  ].filter(Boolean).join(' ')
  persist()
  if (evidenceStatus === 'To Verify' || evidenceStatus === 'Reference Only') {
    message.warning('Price saved, but it remains To Verify / Reference Only until stronger evidence is attached')
  } else {
    message.success('Raw material price entry saved in this browser workspace')
  }
}

function taskBody(material: RawMaterialRecord, reason: string): string {
  const latest = latestPriceEntry(material)
  return [
    reason,
    `Material: ${material.name}`,
    `CAS: ${material.cas || 'To Verify'}`,
    `Unit: ${material.unit}`,
    `Latest RMB price: ${latest?.rmbPrice ?? 'Missing / To Verify'}`,
    `Latest USD price: ${latest?.usdPrice ?? 'Missing / To Verify'}`,
    `Source type: ${material.sourceType}`,
    `Source: ${material.source || 'Missing'}`,
    `Source date: ${material.sourceDate || 'Missing'}`,
    `Evidence status: ${material.evidenceStatus}`,
    `Confidence: ${material.confidence}`,
    material.highRisk ? 'Risk flag: DMS/dimethyl sulfate is high regulatory/safety risk.' : '',
    'Impact on CWAS/CWMS cost: To Verify. Do not calculate product cost without approved formula and sourced inputs.',
    'Tags: Raw Material Sourcing, Price Intelligence, Chemicon China Feasibility',
  ].filter(Boolean).join('\n')
}

async function createTask(material: RawMaterialRecord, reason: string) {
  savingKey.value = `${material.id}-task`
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Raw material evidence: ${material.name}`,
      body: taskBody(material, reason),
      priority: material.highRisk || materialPriceAlert(material).triggered ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Raw material task created in Kanban')
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

async function scheduleResearch(material: RawMaterialRecord) {
  savingKey.value = `${material.id}-research`
  const prompt = [
    `Research raw material sourcing and daily price intelligence for ${material.name}.`,
    'Expected output: source-backed price references, source date, country, confidence, supplier confirmation needs, 7/30 day movement if available, and CWAS/CWMS cost impact caveat.',
    'Source rules: Alibaba/Made-in-China is supplier reference only; supplier quotes are stronger; DMS/dimethyl sulfate requires regulatory/safety notes.',
    'Do not invent prices, price movements, formula ratios, cost impact, or supplier claims.',
  ].join('\n')
  try {
    const job = await jobsStore.createJob({
      name: `Raw material research: ${material.name}`,
      schedule: tonightSchedule(),
      prompt,
      deliver: 'local',
      repeat: 1,
    })
    intelligence.addResearchJob({
      title: `Raw material research: ${material.name}`,
      question: `What source-backed price and supplier evidence exists for ${material.name}?`,
      scope: 'Price references, source dates, supplier confirmation, risk notes, and evidence gaps.',
      expectedOutput: 'Research result for review before dashboard updates.',
      sourceRequirements: 'Every price or claim needs source title plus URL/date. Unknown values stay To Verify.',
      priority: material.highRisk ? 'high' : 'medium',
      schedulePreference: 'Tonight',
      scheduledJobId: job.job_id || job.id,
      schedule: tonightSchedule(),
      context: 'Chemicon China Feasibility',
      status: 'Scheduled Hermes Job',
    })
    message.success('Hermes research job scheduled')
  } catch {
    await createTask(material, 'Schedule failed or Jobs unavailable. Create a manual research task instead.')
  } finally {
    savingKey.value = ''
  }
}
</script>

<template>
  <div class="sourcing-view">
    <header class="page-header">
      <div>
        <p class="eyebrow">Raw material sourcing</p>
        <h2 class="header-title">Daily Price Intelligence</h2>
        <p class="page-copy">
          Track TEA, DMS, ethoxylates, acids, silicone inputs, stearic acid, and packaging without inventing prices.
          Every saved value stays labeled by evidence status and source type.
        </p>
      </div>
      <div class="header-actions">
        <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Documents</RouterLink>
        <RouterLink class="shell-link" :to="{ name: 'hermes.kanban' }">Tasks</RouterLink>
      </div>
    </header>

    <p class="warning">{{ accessControlWarning() }}</p>

    <section class="summary-grid">
      <article v-for="card in summaryCards" :key="card.label" class="summary-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.note }}</small>
      </article>
    </section>

    <section class="workspace-grid">
      <aside class="material-list">
        <button
          v-for="material in materials"
          :key="material.id"
          class="material-row"
          :class="{ active: selectedMaterial?.id === material.id }"
          @click="selectedMaterialId = material.id"
        >
          <strong>{{ material.name }}</strong>
          <span>{{ material.evidenceStatus }}</span>
          <small v-if="material.highRisk">High regulatory/safety risk</small>
          <small v-else>{{ material.sourceType }}</small>
        </button>
      </aside>

      <main v-if="selectedMaterial" class="detail-panel">
        <header class="detail-header">
          <div>
            <p class="eyebrow">Selected material</p>
            <h3>{{ selectedMaterial.name }}</h3>
            <p>{{ selectedMaterial.highRisk ? 'High regulatory/safety risk. Verify DMS handling and legal status before use.' : 'No price is treated as fact until sourced.' }}</p>
          </div>
          <span class="status-pill">{{ selectedMaterial.evidenceStatus }}</span>
        </header>

        <section class="price-grid">
          <article>
            <span>Latest RMB</span>
            <strong>{{ priceDisplay(selectedLatest?.rmbPrice, 'RMB') }}</strong>
          </article>
          <article>
            <span>Latest USD</span>
            <strong>{{ priceDisplay(selectedLatest?.usdPrice, 'USD') }}</strong>
          </article>
          <article>
            <span>7-day trend</span>
            <strong>{{ trendLabel(selectedMaterial, 7) }}</strong>
          </article>
          <article>
            <span>30-day trend</span>
            <strong>{{ trendLabel(selectedMaterial, 30) }}</strong>
          </article>
        </section>

        <p v-if="selectedAlert.triggered" class="alert">
          {{ selectedAlert.direction === 'increase' ? 'Increase' : 'Decrease' }} alert:
          {{ selectedAlert.percentChange.toFixed(1) }}% from previous saved price.
        </p>

        <section class="form-panel">
          <h3>Add manual price/source entry</h3>
          <div class="form-grid">
            <label>RMB price <input v-model.number="priceForm.rmbPrice" type="number" min="0" placeholder="Missing / To Verify" /></label>
            <label>USD price <input v-model.number="priceForm.usdPrice" type="number" min="0" placeholder="Missing / To Verify" /></label>
            <label>Unit <input v-model="priceForm.unit" /></label>
            <label>
              Source type
              <select v-model="priceForm.sourceType">
                <option v-for="type in sourceTypes" :key="type" :value="type">{{ type }}</option>
              </select>
            </label>
            <label>Source / supplier <input v-model="priceForm.source" placeholder="Source title, supplier, URL, or document ref" /></label>
            <label>Source date <input v-model="priceForm.sourceDate" type="date" /></label>
            <label>
              Confidence
              <select v-model="priceForm.confidence">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <label>Notes <input v-model="priceForm.notes" placeholder="Confirmation need, country, supplier note" /></label>
          </div>
          <NButton type="primary" @click="addPriceEntry">Save price entry</NButton>
        </section>

        <section class="history-panel">
          <h3>Price history graph</h3>
          <p v-if="!selectedMaterial.priceHistory.length">No sourced price history yet. Values remain Missing / To Verify.</p>
          <div v-for="entry in selectedMaterial.priceHistory.slice(0, 10)" :key="entry.id" class="history-row">
            <span>{{ entry.sourceDate || entry.createdAt.slice(0, 10) }}</span>
            <div class="bar-track"><div class="bar" :style="{ width: graphWidth(entry, selectedMaterial.priceHistory) }" /></div>
            <strong>{{ priceDisplay(entry.rmbPrice || entry.usdPrice, entry.rmbPrice ? 'RMB' : 'USD') }}</strong>
            <small>{{ entry.evidenceStatus }} / {{ entry.sourceType }}</small>
          </div>
        </section>

        <section class="action-panel">
          <div>
            <h3>Hermes actions</h3>
            <p>
              Alibaba/Made-in-China references stay Reference Only / To Confirm. Supplier quote tasks and research jobs
              do not update dashboard facts until you review the source.
            </p>
          </div>
          <div class="action-row">
            <NButton :loading="savingKey === `${selectedMaterial.id}-task`" @click="createTask(selectedMaterial, 'Verify supplier quote, source date, and price evidence.')">Add supplier confirmation task</NButton>
            <NButton :loading="savingKey === `${selectedMaterial.id}-research`" @click="scheduleResearch(selectedMaterial)">Schedule deeper research</NButton>
            <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Upload quote in Documents</RouterLink>
          </div>
        </section>
      </main>
    </section>
  </div>
</template>

<style scoped>
.sourcing-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.page-header,
.summary-card,
.material-list,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  border: 1px solid rgba(128, 162, 190, 0.26);
  background: rgba(5, 14, 24, 0.84);
  border-radius: 8px;
}

.page-header,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  padding: 18px;
}

.page-header,
.detail-header,
.action-panel {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.header-actions,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.eyebrow,
.summary-card span {
  color: #38d5ff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0;
}

.header-title,
h3 {
  color: #f2c86b;
}

.page-copy,
p,
small,
label,
.material-row span {
  color: #a8b6c7;
}

.warning,
.alert {
  color: #f5bf5a;
}

.summary-grid,
.price-grid,
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card,
.price-grid article {
  padding: 14px;
}

.summary-card strong,
.price-grid strong {
  display: block;
  margin-top: 6px;
  color: #f6fbff;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: 14px;
}

.material-list {
  padding: 8px;
  max-height: 78vh;
  overflow: auto;
}

.material-row {
  display: grid;
  width: 100%;
  gap: 4px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #f6fbff;
  text-align: left;
}

.material-row.active,
.material-row:hover {
  border-color: rgba(56, 213, 255, 0.45);
  background: rgba(56, 213, 255, 0.08);
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-pill {
  align-self: start;
  border: 1px solid rgba(56, 213, 255, 0.45);
  border-radius: 999px;
  padding: 4px 10px;
  color: #38d5ff;
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

.history-row {
  display: grid;
  grid-template-columns: 90px minmax(80px, 1fr) minmax(110px, max-content) minmax(140px, max-content);
  gap: 10px;
  align-items: center;
  padding: 8px 0;
}

.bar-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(128, 162, 190, 0.18);
}

.bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38d5ff, #f2c86b);
}

.shell-link {
  color: #38d5ff;
  text-decoration: none;
}

@media (max-width: 900px) {
  .workspace-grid,
  .page-header,
  .detail-header,
  .action-panel {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .history-row {
    grid-template-columns: 1fr;
  }
}
</style>
