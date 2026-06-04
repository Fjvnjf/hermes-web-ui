<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import { EXECUTIVE_REFRESH_SCHEDULE } from '@/utils/executiveIntelligence'
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
import {
  displayAutomaticVerificationText,
  displayEvidenceStatus,
  displayUnresolvedValue,
  type IntelligenceEvidenceStatus,
} from '@/utils/investorIntelligence'
import { accessControlWarning, shouldRedactForEmployee } from '@/utils/accessControl'

interface SupplierScorecardRow {
  supplier: string
  region: string
  material: string
  pricePerTon: string
  quality: string
  reliability: string
  payment: string
  score: string
  evidenceStatus: IntelligenceEvidenceStatus
  sourceTitle: string
  sourceUrl?: string
  nextAction: string
  highRisk?: boolean
}

const SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME = 'Supplier Scorecard Autopilot - Key Raw Materials'

const message = useMessage()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()
const intelligence = useFeasibilityIntelligence()

const materials = ref<RawMaterialRecord[]>(loadMaterials())
const selectedMaterialId = ref(materials.value[0]?.id || '')
const savingKey = ref('')
const supplierAutopilotStatus = ref('Hermes is checking the supplier scorecard schedule automatically')
const supplierAutopilotJobId = ref('')
const employeeRedaction = computed(() => shouldRedactForEmployee())

function displaySupplierValue(value?: string | number | null): string {
  return displayUnresolvedValue(value)
}

function displaySupplierStatus(status?: string | null): string {
  return displayEvidenceStatus(status)
}

function displaySupplierText(text?: string | null): string {
  return displayAutomaticVerificationText(text)
}

const sourceTypes: RawMaterialSourceType[] = [
  'SunSirs',
  'ECHEMI',
  'Supplier quote',
  'Alibaba/Made-in-China reference',
  'Manual entry',
  'Paid source',
]

const supplierScorecardRows: SupplierScorecardRow[] = [
  {
    supplier: 'Wilmar Oleochemicals',
    region: 'Malaysia / Singapore',
    material: 'Stearic Acid TP / Stearic acid 1842',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'Wilmar Oleochemicals official source',
    sourceUrl: 'https://www.wilmar-international.com/oleochemicals',
    nextAction: 'Request quote, TDS, SDS, COA, MOQ, lead time, and payment terms for stearic acid.',
  },
  {
    supplier: 'KLK OLEO',
    region: 'Malaysia / Global',
    material: 'Stearic Acid TP / PALMERA stearic acid',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'KLK OLEO product source',
    sourceUrl: 'https://www.klkoleo.com/products/',
    nextAction: 'Confirm stearic acid grade match, China delivery route, quote validity, and payment terms.',
  },
  {
    supplier: 'BASF',
    region: 'Germany / Asia supply network',
    material: 'Triethanolamine / TEA',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'BASF amines / triethanolamine source',
    sourceUrl: 'https://products.basf.com/global/en/ci/triethanolamine',
    nextAction: 'Verify TEA grade, SDS, China availability, distributor channel, quote, and lead time.',
  },
  {
    supplier: 'Dow',
    region: 'United States / Global',
    material: 'PDMS Silicone Oil / 1000 cSt target',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'Dow silicone product search',
    sourceUrl: 'https://www.dow.com/en-us/pdp.dowsil-sh-200-fluid-1000-cst.850505z.html',
    nextAction: 'Confirm PDMS viscosity, textile softener suitability, distributor quote, and technical documents.',
  },
  {
    supplier: 'WACKER',
    region: 'Germany / China',
    material: 'PDMS Silicone Oil / Silicone fluid target',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending quote',
    evidenceStatus: 'Candidate Source',
    sourceTitle: 'WACKER silicone fluids source',
    sourceUrl: 'https://www.wacker.com/h/en-gb/silicone-fluids-emulsions/linear-silicone-fluids/wacker-eco-ak-1000/p/000100490',
    nextAction: 'Confirm matching silicone fluid grade, China supply, quote, SDS, TDS, and application notes.',
  },
  {
    supplier: 'Nantong DMS supplier candidate',
    region: 'China',
    material: 'Dimethyl Sulfate / DMS',
    pricePerTon: 'To Verify',
    quality: 'SDS/regulatory proof needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending regulatory review',
    evidenceStatus: 'To Verify',
    sourceTitle: 'PubChem identity and hazard reference',
    sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/Dimethyl-sulfate',
    nextAction: 'Verify supplier identity, exact CAS, legal status, transport/storage rules, SDS, and permit requirements before any quote is used.',
    highRisk: true,
  },
  {
    supplier: 'Bangladesh local acetic acid supplier shortlist',
    region: 'Bangladesh',
    material: 'Acetic Acid',
    pricePerTon: 'To Verify',
    quality: 'TDS/SDS needed',
    reliability: 'To Verify',
    payment: 'To Verify',
    score: 'Pending supplier shortlist',
    evidenceStatus: 'To Verify',
    sourceTitle: 'Local quote and document evidence needed',
    nextAction: 'Identify local suppliers, request quote, SDS, TDS, COA, delivery terms, and tax/VAT details.',
  },
]

function noteLine(notes: string, label: string): string {
  const match = notes.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'))
  return match?.[1]?.trim() || ''
}

function isAutopilotSupplierRecord(record: typeof intelligence.state.value.dataRoomSources[number]): boolean {
  const group = record.dashboardGroup || ''
  const text = `${record.checklistLabel} ${record.notes} ${record.supplier || ''} ${record.material || ''}`.toLowerCase()
  return group === 'supplierScorecards' ||
    group === 'rawMaterialSignals' ||
    text.includes('supplier scorecard') ||
    text.includes('raw material') ||
    text.includes('autopilot candidate from supplierscorecards') ||
    text.includes('autopilot candidate from rawmaterialsignals')
}

function supplierRecordKey(row: Pick<SupplierScorecardRow, 'supplier' | 'material'>): string {
  return `${row.supplier}::${row.material}`.toLowerCase().replace(/\s+/g, ' ').trim()
}

const autopilotSupplierScorecardRows = computed<SupplierScorecardRow[]>(() =>
  intelligence.state.value.dataRoomSources
    .filter(isAutopilotSupplierRecord)
    .map(record => {
      const supplier = record.supplier || noteLine(record.notes, 'Supplier') || record.checklistLabel
      const material = record.material || noteLine(record.notes, 'Material') || 'Material To Verify'
      const value = record.proposedValue || noteLine(record.notes, 'Proposed value') || 'To Verify'
      const sourceTitle = record.source?.title || 'Source review needed'
      const sourceUrl = record.source?.url
      const status = record.evidenceStatus === 'Verified' || record.evidenceStatus === 'Investor Approved'
        ? 'To Verify'
        : record.evidenceStatus
      return {
        supplier,
        region: 'Autopilot source candidate',
        material,
        pricePerTon: value,
        quality: 'Review source evidence',
        reliability: 'To Verify',
        payment: 'To Verify',
        score: 'Review needed',
        evidenceStatus: status,
        sourceTitle,
        sourceUrl,
        nextAction: `Review the source evidence for ${supplier} / ${material}; keep price, quality, reliability, payment, and score in Hermes verification until quote/TDS/SDS/COA evidence is approved.`,
        highRisk: isDmsMaterial(`${supplier} ${material}`),
      }
    }),
)

const displayedSupplierScorecardRows = computed(() => {
  const autopilotRows = autopilotSupplierScorecardRows.value
  const used = new Set(autopilotRows.map(supplierRecordKey))
  return [
    ...autopilotRows,
    ...supplierScorecardRows.filter(row => !used.has(supplierRecordKey(row))),
  ]
})

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
    { label: 'Hermes verifying', value: toVerify, note: 'Missing or weak evidence checked twice daily' },
    { label: '5% alerts', value: alerts, note: 'Based on saved price history' },
  ]
})

const supplierAutopilotCards = computed(() => [
  {
    icon: '🔎',
    label: 'Search',
    value: supplierAutopilotJobId.value ? 'Scheduled' : 'Auto-checking',
    note: 'Hermes researches supplier candidates and source gaps automatically.',
  },
  {
    icon: '📥',
    label: 'Stage',
    value: `${autopilotSupplierScorecardRows.value.length} candidates`,
    note: 'Imported supplier/source records appear here as automatic verification candidates.',
  },
  {
    icon: '✅',
    label: 'Verify',
    value: 'Owner approval',
    note: 'Prices, scores, payment terms, and DMS details need evidence before use.',
  },
])

function priceDisplay(value: number | null | undefined, currency: string): string {
  if (employeeRedaction.value) return 'Restricted in Employee View'
  if (!value) return displaySupplierStatus('To Verify')
  return `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function sensitiveSupplierDisplay(value: string): string {
  if (employeeRedaction.value) return 'Restricted in Employee View'
  return value
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
    message.warning('Price saved, but Hermes will keep verifying it twice daily until stronger evidence is attached')
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

function supplierScorecardTaskBody(row: SupplierScorecardRow): string {
  return [
    `Verify supplier scorecard evidence for ${row.supplier}.`,
    `Supplier: ${row.supplier}`,
    `Region: ${row.region}`,
    `Material: ${row.material}`,
    `Current price/T: ${row.pricePerTon}`,
    `Quality evidence: ${row.quality}`,
    `Reliability evidence: ${row.reliability}`,
    `Payment terms: ${row.payment}`,
    `Score: ${row.score}`,
    `Evidence status: ${row.evidenceStatus}`,
    `Source: ${row.sourceTitle}`,
    `Source URL: ${row.sourceUrl || 'Missing / upload supplier document'}`,
    row.highRisk ? 'Risk flag: DMS/dimethyl sulfate requires regulatory, safety, transport, and permit verification before use.' : '',
    `Recommended next action: ${row.nextAction}`,
    'Do not use screenshot prices, payment terms, quality scores, reliability scores, or supplier rankings until quote/TDS/SDS/COA evidence is attached.',
    'Tags: Supplier Scorecard, Raw Material Sourcing, Chemicon China Feasibility',
  ].filter(Boolean).join('\n')
}

function supplierScorecardAutopilotPrompt(): string {
  const rows = supplierScorecardRows.map(row => [
    `Supplier: ${row.supplier}`,
    `Region: ${row.region}`,
    `Material: ${row.material}`,
    `Current dashboard price/T: ${row.pricePerTon}`,
    `Current dashboard score: ${row.score}`,
    `Evidence status: ${row.evidenceStatus}`,
    `Starting source: ${row.sourceTitle} ${row.sourceUrl || ''}`.trim(),
    `Required action: ${row.nextAction}`,
  ].join('\n')).join('\n\n')

  return [
    'Supplier Scorecards - Key Raw Materials Autopilot',
    '',
    'Research all supplier scorecard rows for Chemicon China feasibility using trusted online sources and supplier evidence.',
    '',
    rows,
    '',
    'Trusted source rules:',
    '- Official supplier/company product pages and catalogs can identify supplier/product candidates.',
    '- Quote, PI, invoice, email quote, TDS, SDS, COA, distributor letter, or paid/source-backed price reference is required before filling price/T, payment terms, quality score, reliability score, or total score.',
    '- Public listings such as Alibaba/Made-in-China are Reference Only and must not become procurement truth.',
    '- DMS / dimethyl sulfate requires chemical identity, CAS, SDS, regulatory/safety, transport/storage, and permit checks before any quote is used.',
    '',
    'Output requirements:',
    '- Return a supplier scorecard table with supplier, material, price/T, quality evidence, reliability evidence, payment terms, score, source title, URL/date, confidence, and evidence status.',
    '- Use Missing / To Verify where evidence is absent.',
    '- Recommend Kanban tasks for missing quote/TDS/SDS/COA/regulatory evidence.',
    '- Do not invent supplier prices, scores, payment terms, delivery terms, quality ratings, or reliability ratings.',
    '- Do not expose formula ratios, formula costs, or supplier confidential data in employee-safe output.',
  ].join('\n')
}

async function createSupplierScorecardTask(row: SupplierScorecardRow) {
  savingKey.value = `${row.supplier}-${row.material}-scorecard`
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Supplier scorecard: ${row.supplier} / ${row.material}`,
      body: supplierScorecardTaskBody(row),
      priority: row.highRisk ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Supplier scorecard task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create supplier task: ${detail}`)
  } finally {
    savingKey.value = ''
  }
}

function recordSupplierAutopilotResearchJob(jobId: string, schedule: string) {
  const existing = intelligence.state.value.researchJobs.find(job => job.title === SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME)
  if (existing) {
    intelligence.updateResearchJobSchedule(existing.id, {
      scheduledJobId: jobId,
      schedule,
      status: 'Scheduled Hermes Job',
    })
    return
  }

  intelligence.addResearchJob({
    title: SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME,
    question: 'Automatically research source-backed supplier scorecards for Chemicon key raw materials.',
    scope: 'Stearic acid, TEA, PDMS silicone oil, DMS, acetic acid, supplier price/quality/reliability/payment evidence, source gaps, and regulatory risk.',
    expectedOutput: 'Supplier scorecard table with source title, URL/date, confidence, evidence status, and tasks for missing supplier evidence.',
    sourceRequirements: 'Quote/TDS/SDS/COA/distributor evidence required for supplier score, price, payment, quality, and reliability. Public listings are Reference Only.',
    priority: 'high',
    schedulePreference: 'Custom',
    scheduledJobId: jobId,
    schedule,
    context: 'Chemicon China Feasibility',
    status: 'Scheduled Hermes Job',
  })
}

async function ensureSupplierScorecardAutopilot(options: { silent?: boolean } = {}) {
  if (!options.silent) savingKey.value = 'supplier-scorecard-autopilot'
  supplierAutopilotStatus.value = 'Hermes is checking the supplier scorecard schedule automatically'
  try {
    await jobsStore.fetchJobs()
    const existingJob = jobsStore.jobs.find(job => job.name === SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME)
    const existingJobId = existingJob?.job_id || existingJob?.id || ''

    if (existingJobId) {
      supplierAutopilotJobId.value = existingJobId
      supplierAutopilotStatus.value = 'Supplier scorecard research is scheduled automatically'
      recordSupplierAutopilotResearchJob(existingJobId, EXECUTIVE_REFRESH_SCHEDULE)
      if (!options.silent) message.success('Supplier scorecard research is already scheduled')
      return
    }

    const job = await jobsStore.createJob({
      name: SUPPLIER_SCORECARD_AUTOPILOT_JOB_NAME,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      prompt: supplierScorecardAutopilotPrompt(),
      deliver: 'local',
    })
    const jobId = job.job_id || job.id || ''
    supplierAutopilotJobId.value = jobId
    supplierAutopilotStatus.value = 'Supplier scorecard research scheduled automatically'
    recordSupplierAutopilotResearchJob(jobId, EXECUTIVE_REFRESH_SCHEDULE)
    if (!options.silent) message.success('Supplier scorecard research scheduled')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown scheduling error'
    supplierAutopilotStatus.value = `Supplier scorecard research needs attention: ${detail}`
    if (!options.silent) message.error(`Could not schedule supplier autopilot: ${detail}`)
  } finally {
    if (!options.silent) savingKey.value = ''
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
      sourceRequirements: 'Every price or claim needs source title plus URL/date. Unknown values stay in Hermes twice-daily verification until source evidence is approved.',
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

onMounted(() => {
  void ensureSupplierScorecardAutopilot({ silent: true })
})
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
        <p class="section-help-text">Track source-backed prices. Unsourced values stay in Hermes twice-daily verification and high-risk inputs should become tasks before they influence feasibility outputs.</p>
      </div>
      <div class="header-actions">
        <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Documents</RouterLink>
        <RouterLink class="shell-link" :to="{ name: 'hermes.kanban' }">Tasks</RouterLink>
      </div>
    </header>

    <p class="warning">{{ accessControlWarning() }}</p>

    <TrustedSourceAutopilotPanel screen="rawMaterials" title="Raw Material Auto Source Status" />

    <section class="summary-grid">
      <article v-for="card in summaryCards" :key="card.label" class="summary-card">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
        <small>{{ card.note }}</small>
      </article>
    </section>

    <section class="supplier-scorecard-panel" aria-label="Supplier scorecards - key raw materials">
      <header class="scorecard-header">
        <div>
          <p class="eyebrow">Supplier scorecards</p>
          <h3>Supplier Scorecards - Key Raw Materials</h3>
          <p>
            Screenshot-style supplier board for stearic acid, TEA, PDMS silicone oil, DMS, and acetic acid.
            Supplier names and product targets are source/candidate-backed; prices, quality scores, reliability,
            payment terms, and total scores remain in automatic verification until quote/TDS/SDS/COA evidence is attached.
          </p>
          <p v-if="autopilotSupplierScorecardRows.length" class="autopilot-note">
            Hermes Autopilot has staged {{ autopilotSupplierScorecardRows.length }} supplier/raw-material candidates from trusted-source research.
            They are visible here as automatic-verification candidates and still require source review before costing or investor use.
          </p>
          <p class="autopilot-note">
            {{ supplierAutopilotStatus }}<span v-if="supplierAutopilotJobId"> · Job {{ supplierAutopilotJobId }}</span>
          </p>
          <div class="supplier-autopilot-strip" aria-label="Automatic supplier research workflow">
            <article v-for="card in supplierAutopilotCards" :key="card.label">
              <span aria-hidden="true">{{ card.icon }}</span>
              <div>
                <small>{{ card.label }}</small>
                <strong>{{ displaySupplierValue(card.value) }}</strong>
                <em>{{ displaySupplierText(card.note) }}</em>
              </div>
            </article>
          </div>
        </div>
        <div class="scorecard-actions">
          <NButton
            size="small"
            type="primary"
            :loading="savingKey === 'supplier-scorecard-autopilot'"
            @click="ensureSupplierScorecardAutopilot({ silent: false })"
          >
            Check Supplier Autopilot
          </NButton>
          <RouterLink class="shell-link" :to="{ name: 'hermes.files' }">Upload supplier evidence</RouterLink>
          <RouterLink class="shell-link" :to="{ name: 'hermes.kanban' }">Open supplier tasks</RouterLink>
          <RouterLink class="shell-link" :to="{ name: 'hermes.trustedSources' }">Full dashboard autopilot</RouterLink>
        </div>
      </header>

      <div class="supplier-scorecard-table-wrap">
        <div class="supplier-scorecard-table">
          <div class="supplier-scorecard-row head">
            <span>Supplier</span>
            <span>Material</span>
            <span>Price/T</span>
            <span>Quality</span>
            <span>Reliability</span>
            <span>Payment</span>
            <span>Score</span>
            <span>Source / Evidence</span>
            <span>Action</span>
          </div>
          <div
            v-for="row in displayedSupplierScorecardRows"
            :key="`${row.supplier}-${row.material}`"
            class="supplier-scorecard-row"
            :class="{ risk: row.highRisk }"
          >
            <div>
              <strong>{{ row.supplier }}</strong>
              <small>{{ row.region }}</small>
            </div>
            <span>{{ row.material }}</span>
            <span class="verify-value">{{ sensitiveSupplierDisplay(displaySupplierValue(row.pricePerTon)) }}</span>
            <span>{{ displaySupplierValue(row.quality) }}</span>
            <span>{{ displaySupplierValue(row.reliability) }}</span>
            <span>{{ sensitiveSupplierDisplay(displaySupplierValue(row.payment)) }}</span>
            <span class="score-pill">{{ displaySupplierValue(row.score) }}</span>
            <div>
              <a v-if="row.sourceUrl" class="supplier-source-link" :href="row.sourceUrl" target="_blank" rel="noopener noreferrer">
                {{ displaySupplierStatus(row.evidenceStatus) }}
              </a>
              <span v-else class="verify-value">{{ displaySupplierStatus(row.evidenceStatus) }}</span>
              <small>{{ row.sourceTitle }}</small>
            </div>
            <NButton
              size="tiny"
              secondary
              :loading="savingKey === `${row.supplier}-${row.material}-scorecard`"
              @click="createSupplierScorecardTask(row)"
            >
              Verify Supplier
            </NButton>
          </div>
        </div>
      </div>

      <p class="scorecard-footnote">
        Do not use screenshot prices or supplier scores as verified facts. Supplier scorecards become actionable
        through Kanban tasks and uploaded evidence, not through unsourced dashboard numbers.
      </p>
    </section>

    <section class="workspace-grid">
      <aside class="material-list">
        <button
          v-for="material in materials"
          :key="material.id"
          class="material-row"
          :class="{ active: selectedMaterial?.id === material.id, risk: material.highRisk, alerting: materialPriceAlert(material).triggered }"
          @click="selectedMaterialId = material.id"
        >
          <strong>{{ material.name }}</strong>
          <span class="status-badge" :class="material.evidenceStatus.toLowerCase().replace(/\s+/g, '-')">{{ displaySupplierStatus(material.evidenceStatus) }}</span>
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
          <span class="status-pill">{{ displaySupplierStatus(selectedMaterial.evidenceStatus) }}</span>
        </header>

        <section v-if="selectedMaterial.highRisk" class="risk-banner">
          <strong>DMS / dimethyl sulfate high-risk checkpoint</strong>
          <span>Verify exact chemical identity, regulatory status, handling rules, and source evidence before using this material in costing, process, or investor material.</span>
        </section>

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
            <label>RMB price <input v-model.number="priceForm.rmbPrice" type="number" min="0" placeholder="Hermes verifies if blank" /></label>
            <label>USD price <input v-model.number="priceForm.usdPrice" type="number" min="0" placeholder="Hermes verifies if blank" /></label>
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
          <p v-if="!selectedMaterial.priceHistory.length" class="empty-state-panel">No sourced price history yet. Upload a quote in Documents, create a supplier task, or schedule deeper research before using this value.</p>
          <div v-for="entry in selectedMaterial.priceHistory.slice(0, 10)" :key="entry.id" class="history-row">
            <span>{{ entry.sourceDate || entry.createdAt.slice(0, 10) }}</span>
            <div class="bar-track"><div class="bar" :style="{ width: graphWidth(entry, selectedMaterial.priceHistory) }" /></div>
            <strong>{{ priceDisplay(entry.rmbPrice || entry.usdPrice, entry.rmbPrice ? 'RMB' : 'USD') }}</strong>
            <small>{{ displaySupplierStatus(entry.evidenceStatus) }} / {{ entry.sourceType }}</small>
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
.supplier-scorecard-panel,
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
.summary-card,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  position: relative;
  overflow: hidden;
}

.summary-card::before,
.supplier-scorecard-panel::before,
.detail-panel::before,
.form-panel::before,
.history-panel::before,
.action-panel::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, #f2c86b, rgba(242, 200, 107, 0.18));
}

.page-header,
.supplier-scorecard-panel,
.detail-panel,
.form-panel,
.history-panel,
.action-panel {
  padding: 18px;
}

.page-header,
.detail-header,
.action-panel,
.scorecard-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.header-actions,
.action-row,
.scorecard-actions {
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

.supplier-scorecard-panel {
  border-color: rgba(242, 200, 107, 0.55);
  background:
    linear-gradient(135deg, rgba(242, 200, 107, 0.06), transparent 42%),
    rgba(5, 14, 24, 0.9);
}

.autopilot-note {
  margin: 10px 0 0;
  border: 1px solid rgba(56, 213, 255, 0.22);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(56, 213, 255, 0.06);
  color: #c8d4e3;
}

.supplier-autopilot-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.supplier-autopilot-strip article {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-height: 104px;
  border: 1px solid rgba(56, 213, 255, 0.2);
  border-radius: 8px;
  padding: 11px;
  background:
    linear-gradient(135deg, rgba(56, 213, 255, 0.08), transparent 70%),
    rgba(0, 0, 0, 0.14);
}

.supplier-autopilot-strip article > span {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid rgba(242, 200, 107, 0.34);
  border-radius: 999px;
  background: rgba(242, 200, 107, 0.08);
}

.supplier-autopilot-strip small {
  color: #7f91ad;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.supplier-autopilot-strip strong {
  display: block;
  margin-top: 3px;
  color: #38d5ff;
  font-size: 15px;
}

.supplier-autopilot-strip em {
  display: block;
  margin-top: 5px;
  color: #a8b6c7;
  font-size: 12px;
  font-style: normal;
  line-height: 1.4;
}

.supplier-scorecard-table-wrap {
  margin-top: 16px;
  overflow-x: auto;
}

.supplier-scorecard-table {
  min-width: 1180px;
}

.supplier-scorecard-row {
  display: grid;
  grid-template-columns: 1.45fr 1.55fr 0.85fr 0.95fr 0.95fr 0.85fr 1fr 1.35fr 128px;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid rgba(128, 162, 190, 0.18);
  padding: 12px 14px;
  color: #c8d4e3;
}

.supplier-scorecard-row.head {
  border-bottom: 2px solid rgba(242, 200, 107, 0.78);
  color: #f2c86b;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.supplier-scorecard-row.risk {
  background: rgba(255, 94, 94, 0.06);
}

.supplier-scorecard-row strong {
  color: #f6fbff;
}

.supplier-scorecard-row small {
  display: block;
  margin-top: 3px;
}

.verify-value {
  color: #f5bf5a;
  font-weight: 700;
}

.score-pill {
  width: fit-content;
  border: 1px solid rgba(245, 191, 90, 0.36);
  border-radius: 999px;
  padding: 4px 9px;
  color: #f5bf5a;
  font-size: 12px;
}

.supplier-source-link {
  color: #38d5ff;
  font-weight: 700;
  text-decoration: none;
}

.scorecard-footnote {
  margin: 14px 0 0;
  border-top: 1px solid rgba(242, 200, 107, 0.25);
  padding-top: 12px;
  color: #f5bf5a;
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

.material-row.risk {
  border-color: rgba(245, 191, 90, 0.36);
}

.material-row.alerting {
  background: rgba(245, 191, 90, 0.08);
}

.material-row.active,
.material-row:hover {
  border-color: rgba(56, 213, 255, 0.45);
  background: rgba(56, 213, 255, 0.08);
}

.material-row .status-badge {
  width: fit-content;
  padding: 2px 7px;
  font-size: 10px;
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
  .scorecard-header,
  .detail-header,
  .action-panel {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .supplier-autopilot-strip {
    grid-template-columns: 1fr;
  }

  .history-row {
    grid-template-columns: 1fr;
  }
}
</style>
