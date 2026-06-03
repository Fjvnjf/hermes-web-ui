<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import TrustedSourceAutopilotPanel from '@/components/intelligence/TrustedSourceAutopilotPanel.vue'
import {
  type DataRoomSourceRecord,
  type EvidenceArea,
  type FeasibilityEvidenceItem,
  type InvestorRiskRegisterItem,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import {
  presentationSectionForEvidence,
  type IntelligenceEvidenceStatus,
  type SourceReference,
} from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'
import { mkDir, writeFile } from '@/api/hermes/files'

interface ReadinessSection extends FeasibilityEvidenceItem {
  routeName: string
}

interface DataRoomItem {
  label: string
  area: EvidenceArea
  sourceHint: string
  status: IntelligenceEvidenceStatus
  source: SourceReference | null
  sourceRecord: DataRoomSourceRecord | null
  updatedAt: string
  routeName: string
}

interface AssumptionRegisterItem {
  id: string
  title: string
  origin: string
  area: EvidenceArea
  evidenceStatus: IntelligenceEvidenceStatus
  detail: string
  source: SourceReference | null
  routeName: string
  priority: 1 | 2 | 3
}

const message = useMessage()
const kanbanStore = useKanbanStore()
const intelligence = useFeasibilityIntelligence()
const creatingKey = ref('')
const creatingDataRoomTask = ref('')
const stagingDataRoomSourceId = ref('')
const creatingAssumptionTaskId = ref('')
const creatingRiskTaskId = ref('')
const creatingRiskResearchId = ref('')
const savingDataRoomIndex = ref(false)
const latestDataRoomIndexPath = ref('')
const evidenceForm = ref({
  area: 'companyLegal' as EvidenceArea,
  evidenceStatus: 'User Provided' as IntelligenceEvidenceStatus,
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
})
const dataRoomSourceForm = ref({
  checklistLabel: 'Company registration and business scope',
  evidenceStatus: 'User Provided' as IntelligenceEvidenceStatus,
  sourceTitle: '',
  sourceUrl: '',
  sourceDate: '',
  notes: '',
})

const routeByEvidenceId: Record<EvidenceArea, string> = {
  companyLegal: 'hermes.files',
  product: 'hermes.files',
  factory: 'hermes.kanban',
  regulatory: 'hermes.chat',
  market: 'hermes.marketIntelligence',
  financial: 'hermes.investmentCalculator',
  presentation: 'hermes.investorPresentation',
}

const sections = computed<ReadinessSection[]>(() =>
  intelligence.state.value.evidenceItems.map(item => ({
    ...item,
    routeName: routeByEvidenceId[item.id],
  })),
)

const readinessScore = intelligence.readinessScore
const readinessStage = computed(() => {
  if (readinessScore.value >= 85 && (statusCounts.value.Verified || 0) >= 4) {
    return {
      label: 'Investor approved',
      note: 'High readiness score and multiple verified evidence areas. Still review exact source support before sharing.',
      tone: 'ready',
    }
  }
  if (readinessScore.value >= 70) {
    return {
      label: 'Investor draft ready',
      note: 'Drafting can continue, but unsupported gaps must stay visible in investor material.',
      tone: 'draft',
    }
  }
  if (readinessScore.value >= 35) {
    return {
      label: 'Needs evidence',
      note: 'Several readiness areas still need source-backed proof, user approval, or clearly labeled assumptions.',
      tone: 'needs',
    }
  }
  return {
    label: 'Not ready',
    note: 'Collect company, product, factory, regulatory, market, financial, and presentation evidence before investor use.',
    tone: 'blocked',
  }
})
const statusCounts = computed(() => {
  return sections.value.reduce<Record<string, number>>((acc, item) => {
    acc[item.evidenceStatus] = (acc[item.evidenceStatus] || 0) + 1
    return acc
  }, {})
})

const quickLinks = [
  { label: 'Chat', to: { name: 'hermes.chat', query: { captureContext: 'investment-research' } } },
  { label: 'Documents', to: { name: 'hermes.files' } },
  { label: 'Tasks', to: { name: 'hermes.kanban' } },
  { label: 'Memory', to: { name: 'hermes.memory' } },
  { label: 'Feasibility Studio', to: { name: 'hermes.feasibility' } },
  { label: 'Reports Hub', to: { name: 'hermes.reportsHub' } },
]

const evidenceAreaOptions: Array<{ value: EvidenceArea; label: string }> = [
  { value: 'companyLegal', label: 'Company / Legal' },
  { value: 'product', label: 'Product' },
  { value: 'factory', label: 'Factory / Plant' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'market', label: 'Market' },
  { value: 'financial', label: 'Financial Model' },
  { value: 'presentation', label: 'Presentation' },
]

const readinessStatusOptions: IntelligenceEvidenceStatus[] = [
  'To Verify',
  'Missing',
  'Assumption',
  'User Provided',
  'User Approved',
  'Verified',
]

const dataRoomChecklist: Array<{ label: string; area: EvidenceArea; sourceHint: string }> = [
  { label: 'Company registration and business scope', area: 'companyLegal', sourceHint: 'Business license, scope, bank, import/export evidence' },
  { label: 'Product TDS/SDS and CAS evidence', area: 'product', sourceHint: 'CWAS/CWMS TDS, SDS, formula, CAS list' },
  { label: 'Supplier quotes and raw-material cost sheets', area: 'product', sourceHint: 'Supplier quote or landed-cost source' },
  { label: 'Machine quotes, capacity, and utility assumptions', area: 'factory', sourceHint: 'Machine quote, batch capacity, utilities' },
  { label: 'Factory/rent/permit evidence', area: 'factory', sourceHint: 'Rent offer, site approval, chemical permission' },
  { label: 'Customer, distributor, and competitor price evidence', area: 'market', sourceHint: 'Customer interview, distributor proof, competitor source' },
  { label: 'Financial model with evidence status per input', area: 'financial', sourceHint: 'Saved IRR scenario and evidence status by input' },
  { label: 'Risk register and mitigation tasks', area: 'regulatory', sourceHint: 'Regulatory, safety, factory, and operating risks' },
]

const evidenceByArea = computed(() => new Map(sections.value.map(item => [item.id, item])))
const latestSourceByChecklist = computed(() => {
  const map = new Map<string, DataRoomSourceRecord>()
  for (const record of intelligence.state.value.dataRoomSources) {
    if (!map.has(record.checklistLabel)) map.set(record.checklistLabel, record)
  }
  return map
})
const dataRoomSourceRecords = computed(() => intelligence.state.value.dataRoomSources.slice(0, 8))
const dataRoomSourceCount = computed(() => intelligence.state.value.dataRoomSources.length)
const dataRoomSourceStatusOptions: IntelligenceEvidenceStatus[] = [
  'To Verify',
  'Missing',
  'Assumption',
  'User Provided',
  'User Approved',
  'Verified',
]

const dataRoomItems = computed<DataRoomItem[]>(() =>
  dataRoomChecklist.map(item => {
    const evidence = evidenceByArea.value.get(item.area)
    const sourceRecord = latestSourceByChecklist.value.get(item.label) || null
    return {
      ...item,
      status: sourceRecord?.evidenceStatus || evidence?.evidenceStatus || 'To Verify',
      source: sourceRecord?.source || evidence?.source || null,
      sourceRecord,
      updatedAt: sourceRecord?.updatedAt || evidence?.updatedAt || '',
      routeName: evidence?.routeName || routeByEvidenceId[item.area],
    }
  }),
)

const selectedDataRoomChecklistItem = computed(() =>
  dataRoomChecklist.find(item => item.label === dataRoomSourceForm.value.checklistLabel) || dataRoomChecklist[0],
)

const DATA_ROOM_INDEX_DIR = 'data-room-indexes'

function isAssumptionStatus(status: IntelligenceEvidenceStatus): boolean {
  return status === 'Assumption' ||
    status === 'Approved Assumption' ||
    status === 'Derived from Assumptions'
}

function assumptionPriority(area: EvidenceArea, evidenceStatus: IntelligenceEvidenceStatus): 1 | 2 | 3 {
  if (area === 'financial' || area === 'regulatory' || area === 'factory') return 3
  if (evidenceStatus === 'Derived from Assumptions') return 3
  if (area === 'market' || area === 'product') return 2
  return 1
}

const assumptionRecords = computed<AssumptionRegisterItem[]>(() => {
  const records: AssumptionRegisterItem[] = []

  for (const item of sections.value) {
    if (!isAssumptionStatus(item.evidenceStatus)) continue
    records.push({
      id: `readiness-${item.id}`,
      title: item.label,
      origin: 'Readiness evidence',
      area: item.id,
      evidenceStatus: item.evidenceStatus,
      detail: item.nextAction,
      source: item.source || null,
      routeName: item.routeName,
      priority: assumptionPriority(item.id, item.evidenceStatus),
    })
  }

  for (const record of intelligence.state.value.dataRoomSources) {
    if (!isAssumptionStatus(record.evidenceStatus)) continue
    records.push({
      id: `source-${record.id}`,
      title: record.checklistLabel,
      origin: 'Data-room source',
      area: record.area,
      evidenceStatus: record.evidenceStatus,
      detail: record.notes || 'Review this source before using the assumption in investor material.',
      source: record.source || null,
      routeName: routeByEvidenceId[record.area],
      priority: assumptionPriority(record.area, record.evidenceStatus),
    })
  }

  for (const model of intelligence.state.value.financialModels.slice(0, 3)) {
    if (!isAssumptionStatus(model.evidenceStatus)) continue
    records.push({
      id: `financial-${model.id}`,
      title: `${model.scenarioName} financial model`,
      origin: 'IRR calculator',
      area: 'financial',
      evidenceStatus: model.evidenceStatus,
      detail: model.warnings.length
        ? model.warnings.join(' ')
        : 'Financial outputs are derived from the saved model inputs.',
      source: model.source || null,
      routeName: 'hermes.investmentCalculator',
      priority: assumptionPriority('financial', model.evidenceStatus),
    })
  }

  for (const claim of intelligence.state.value.marketClaims) {
    if (!isAssumptionStatus(claim.evidenceStatus)) continue
    records.push({
      id: `market-${claim.id || claim.label}`,
      title: claim.label,
      origin: 'Market Intelligence',
      area: 'market',
      evidenceStatus: claim.evidenceStatus,
      detail: claim.value || 'Market assumption needs source-backed validation.',
      source: claim.source || null,
      routeName: 'hermes.marketIntelligence',
      priority: assumptionPriority('market', claim.evidenceStatus),
    })
  }

  for (const competitor of intelligence.state.value.competitors) {
    if (!isAssumptionStatus(competitor.evidenceStatus)) continue
    records.push({
      id: `competitor-${competitor.id}`,
      title: competitor.companyName,
      origin: 'Competitor Intelligence',
      area: 'market',
      evidenceStatus: competitor.evidenceStatus,
      detail: competitor.notes || 'Competitor assumption needs source-backed review.',
      source: competitor.source || null,
      routeName: 'hermes.competitorIntelligence',
      priority: assumptionPriority('market', competitor.evidenceStatus),
    })
  }

  for (const material of intelligence.state.value.presentationMaterials) {
    if (!isAssumptionStatus(material.evidenceStatus)) continue
    records.push({
      id: `presentation-${material.id || material.section}`,
      title: material.section,
      origin: 'Investor Presentation',
      area: 'presentation',
      evidenceStatus: material.evidenceStatus,
      detail: material.content,
      source: material.source || null,
      routeName: 'hermes.investorPresentation',
      priority: assumptionPriority('presentation', material.evidenceStatus),
    })
  }

  return records
})

const visibleAssumptionRecords = computed(() => assumptionRecords.value.slice(0, 8))
const riskRegisterItems = intelligence.riskRegisterItems
const visibleRiskRegisterItems = computed(() => riskRegisterItems.value.slice(0, 8))

function formatSource(source?: SourceReference | null): string {
  if (!source?.title) return 'Source missing'
  return [source.title, source.date, source.url].filter(Boolean).join(' / ')
}

function sourceClass(item: { status: IntelligenceEvidenceStatus }): 'ready' | 'weak' | 'missing' {
  if (item.status === 'Verified' || item.status === 'User Approved' || item.status === 'User Provided') return 'ready'
  if (item.status === 'Assumption' || item.status === 'Approved Assumption' || item.status === 'Derived from Assumptions') return 'weak'
  return 'missing'
}

function taskBody(item: ReadinessSection): string {
  return [
    `Investor readiness evidence gap: ${item.label}`,
    `Current evidence status: ${item.evidenceStatus}`,
    `Recommended next action: ${item.nextAction}`,
    `Source page: Investor Readiness Center`,
    'Tags: Investor Readiness, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not mark this investor-ready until source evidence is uploaded or user-approved.',
  ].join('\n')
}

function dataRoomTaskBody(item: DataRoomItem): string {
  return [
    `Investor data-room evidence item: ${item.label}`,
    `Evidence area: ${evidenceAreaOptions.find(area => area.value === item.area)?.label || item.area}`,
    `Current evidence status: ${item.status}`,
    `Current source trace: ${item.source ? formatSource(item.source) : 'Source missing'}`,
    `Evidence needed: ${item.sourceHint}`,
    `Source page: Investor Readiness Center / Data Room Checklist`,
    'Recommended action: upload/source the evidence in Documents, save the reviewed status in Investor Readiness, and keep unsupported claims out of investor material.',
    'Tags: Data Room, Investor Readiness, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not mark this investor-ready until source evidence is attached or the user explicitly approves a labeled assumption.',
  ].join('\n')
}

function dataRoomSourceSummary(record: DataRoomSourceRecord): string {
  return [
    `Data-room checklist item: ${record.checklistLabel}`,
    `Evidence area: ${evidenceAreaOptions.find(area => area.value === record.area)?.label || record.area}`,
    `Evidence status: ${record.evidenceStatus}`,
    `Source trace: ${record.source ? formatSource(record.source) : 'Source missing'}`,
    record.notes ? `Review note: ${record.notes}` : '',
    'Source page: Investor Readiness Center / Source Register',
    'This source record must be reviewed before it changes investor material.',
  ].filter(Boolean).join('\n')
}

function dataRoomInvestorMaterialCandidate(record: DataRoomSourceRecord): string {
  if (!isStageableForInvestorDraft(record.evidenceStatus)) return ''
  return [
    `Data-room source registered for ${record.checklistLabel}: ${record.source ? formatSource(record.source) : 'source missing'}.`,
    record.notes ? `Review note: ${record.notes}` : '',
    `Evidence status: ${record.evidenceStatus}.`,
  ].filter(Boolean).join('\n')
}

function dataRoomIndexTimestamp(date = new Date()): string {
  return date.toISOString().replace('T', '-').replace(/[:.]/g, '-').slice(0, 19)
}

function dataRoomIndexFilePath(): string {
  return `${DATA_ROOM_INDEX_DIR}/chemicon-data-room-index-${dataRoomIndexTimestamp()}.md`
}

function evidenceAreaLabel(area: EvidenceArea): string {
  return evidenceAreaOptions.find(option => option.value === area)?.label || area
}

function buildDataRoomIndexMarkdown(): string {
  const checklistLines = dataRoomItems.value.flatMap(item => [
    `## ${item.label}`,
    '',
    `Area: ${evidenceAreaLabel(item.area)}`,
    `Evidence status: ${item.status}`,
    `Source trace: ${item.source ? formatSource(item.source) : 'Source missing'}`,
    `Evidence needed: ${item.sourceHint}`,
    item.sourceRecord?.notes ? `Review note: ${item.sourceRecord.notes}` : '',
    item.updatedAt ? `Last updated: ${new Date(item.updatedAt).toISOString()}` : '',
    '',
    item.status === 'Verified' || item.status === 'User Approved' || item.status === 'User Provided'
      ? 'Use rule: Review the source against the exact investor claim before using it in a report or deck.'
      : 'Use rule: Keep this item out of investor claims until evidence is attached or the assumption is explicitly approved and labeled.',
    '',
  ].filter(Boolean))

  const sourceRegisterLines = intelligence.state.value.dataRoomSources.length
    ? intelligence.state.value.dataRoomSources.flatMap((record, index) => [
        `### ${index + 1}. ${record.checklistLabel}`,
        '',
        `Area: ${evidenceAreaLabel(record.area)}`,
        `Evidence status: ${record.evidenceStatus}`,
        `Source trace: ${record.source ? formatSource(record.source) : 'Source missing'}`,
        record.notes ? `Notes: ${record.notes}` : '',
        `Updated: ${new Date(record.updatedAt).toISOString()}`,
        '',
      ].filter(Boolean))
    : ['No source register records have been saved yet.', '']

  return [
    '# Chemicon China Investor Data-Room Index',
    '',
    'Generated from the current Hermes investor readiness workspace.',
    'This file is an index only. It does not verify any business claim by itself.',
    'Missing / To Verify items must not be used as investor claims.',
    'Verified claims still require review against the exact source before investor use.',
    `Created: ${new Date().toISOString()}`,
    'Project: Chemicon China Feasibility',
    '',
    '# Readiness Summary',
    '',
    `Investor readiness score: ${readinessScore.value}%`,
    `Verified: ${statusCounts.value.Verified || 0}`,
    `User Approved: ${statusCounts.value['User Approved'] || 0}`,
    `Assumptions: ${statusCounts.value.Assumption || 0}`,
    `To Verify: ${statusCounts.value['To Verify'] || 0}`,
    `Missing: ${statusCounts.value.Missing || 0}`,
    '',
    '# Data-Room Checklist',
    '',
    ...checklistLines,
    '# Source Register',
    '',
    ...sourceRegisterLines,
  ].join('\n')
}

async function saveDataRoomIndexFile() {
  if (savingDataRoomIndex.value) return
  savingDataRoomIndex.value = true
  try {
    await mkDir(DATA_ROOM_INDEX_DIR)
    const path = dataRoomIndexFilePath()
    await writeFile(path, buildDataRoomIndexMarkdown())
    latestDataRoomIndexPath.value = path
    message.success('Data-room index saved to Documents')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown file error'
    message.error(`Could not save data-room index: ${detail}`)
  } finally {
    savingDataRoomIndex.value = false
  }
}

function stageDataRoomSourceForReview(record: DataRoomSourceRecord) {
  stagingDataRoomSourceId.value = record.id
  try {
    const saved = intelligence.addResearchFinding({
      summary: dataRoomSourceSummary(record),
      keyClaim: `Data-room source: ${record.checklistLabel}`,
      area: record.area,
      evidenceStatus: record.evidenceStatus,
      confidence: record.evidenceStatus === 'Verified' ? 'high' : 'medium',
      source: record.source || null,
      suggestedTask: record.evidenceStatus === 'Missing' || record.evidenceStatus === 'To Verify'
        ? `Verify source evidence for ${record.checklistLabel}`
        : '',
      suggestedInvestorMaterial: dataRoomInvestorMaterialCandidate(record),
      riskNote: record.evidenceStatus === 'Verified'
        ? 'Confirm the source supports the exact claim before using it in investor material.'
        : 'Keep this item labeled until source quality and claim scope are reviewed.',
    })
    if (record.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
      message.warning('Source staged as To Verify because verified review items need usable source evidence')
    } else {
      message.success('Data-room source staged for Research Result Review')
    }
  } finally {
    stagingDataRoomSourceId.value = ''
  }
}

async function createEvidenceTask(item: ReadinessSection) {
  creatingKey.value = item.label
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Investor evidence: ${item.label}`,
      body: taskBody(item),
      priority: item.evidenceStatus === 'Missing' ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create task: ${detail}`)
  } finally {
    creatingKey.value = ''
  }
}

async function createDataRoomTask(item: DataRoomItem) {
  creatingDataRoomTask.value = item.label
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Data room evidence: ${item.label}`,
      body: dataRoomTaskBody(item),
      priority: item.status === 'Missing' || item.status === 'To Verify' ? 3 : 2,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Data-room evidence task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create data-room task: ${detail}`)
  } finally {
    creatingDataRoomTask.value = ''
  }
}

function assumptionTaskBody(item: AssumptionRegisterItem): string {
  return [
    `Investor assumption to verify: ${item.title}`,
    `Origin: ${item.origin}`,
    `Evidence area: ${evidenceAreaOptions.find(area => area.value === item.area)?.label || item.area}`,
    `Current evidence status: ${item.evidenceStatus}`,
    `Current source trace: ${item.source ? formatSource(item.source) : 'Source missing'}`,
    `Current detail: ${item.detail}`,
    `Source page: Investor Readiness Center / Assumption Register`,
    'Recommended action: attach source evidence, explicitly approve the assumption, or keep it labeled in every investor-facing output.',
    'Tags: Assumption Register, Investor Readiness, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not convert this into a verified investor claim until source evidence or explicit approval supports it.',
  ].join('\n')
}

async function createAssumptionTask(item: AssumptionRegisterItem) {
  creatingAssumptionTaskId.value = item.id
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Verify assumption: ${item.title}`,
      body: assumptionTaskBody(item),
      priority: item.priority,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Assumption verification task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create assumption task: ${detail}`)
  } finally {
    creatingAssumptionTaskId.value = ''
  }
}

function riskTaskBody(item: InvestorRiskRegisterItem): string {
  return [
    `Investor risk to mitigate: ${item.title}`,
    `Origin: ${item.origin}`,
    `Evidence area: ${evidenceAreaOptions.find(area => area.value === item.area)?.label || item.area}`,
    `Current status: ${item.evidenceStatus}`,
    `Risk detail: ${item.detail}`,
    `Source page: Investor Readiness Center / Risk Register`,
    'Recommended action: resolve the missing evidence, review the source, or keep this risk visible in investor materials.',
    'Tags: Risk Register, Investor Readiness, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not hide this risk or use the related claim as investor-ready until the evidence status is resolved.',
  ].join('\n')
}

async function createRiskTask(item: InvestorRiskRegisterItem) {
  creatingRiskTaskId.value = item.id
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Mitigate risk: ${item.title}`,
      body: riskTaskBody(item),
      priority: item.priority,
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Risk mitigation task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create risk task: ${detail}`)
  } finally {
    creatingRiskTaskId.value = ''
  }
}

function riskResearchPriority(item: InvestorRiskRegisterItem): 'high' | 'medium' | 'low' {
  if (item.priority >= 3) return 'high'
  if (item.priority === 2) return 'medium'
  return 'low'
}

function createRiskResearchJob(item: InvestorRiskRegisterItem) {
  creatingRiskResearchId.value = item.id
  try {
    intelligence.addResearchJob({
      title: `Risk research: ${item.title}`,
      question: `Research and verify the investor risk around ${item.title}.`,
      scope: [
        `Risk register item: ${item.title}`,
        `Origin: ${item.origin}`,
        `Evidence area: ${evidenceAreaOptions.find(area => area.value === item.area)?.label || item.area}`,
        `Current evidence status: ${item.evidenceStatus}`,
        `Risk detail: ${item.detail}`,
        '',
        'Focus on Chemicon China feasibility. Do not invent market data, pricing, competitor share, IRR, regulatory status, or investor claims.',
      ].join('\n'),
      expectedOutput: 'A review-ready research finding with summary, key claims, source title plus URL/date, confidence, risk note, suggested tasks, and investor-safe wording only when supported.',
      sourceRequirements: 'Every claim needs source evidence or must remain To Verify. Missing evidence should become a task, not an investor claim.',
      priority: riskResearchPriority(item),
      schedulePreference: 'Tonight',
      context: 'Chemicon China Feasibility',
      status: 'Manual Research Job',
    })
    message.success('Risk research job saved for review')
  } finally {
    creatingRiskResearchId.value = ''
  }
}

async function copyForPresentation(item: ReadinessSection) {
  const copied = await copyToClipboard([
    `${item.label}`,
    `Status: ${item.evidenceStatus}`,
    item.description,
    `Next action: ${item.nextAction}`,
  ].join('\n'))
  if (copied) message.success('Copied investor readiness note')
  else message.warning('Clipboard blocked')
}

function markAssumption(item: ReadinessSection) {
  intelligence.updateEvidenceStatus(item.id, 'Assumption')
  message.info('Marked as an assumption in this browser workspace')
}

function evidenceSourceFromForm(): SourceReference | null {
  const title = evidenceForm.value.sourceTitle.trim()
  if (!title) return null
  return {
    title,
    url: evidenceForm.value.sourceUrl.trim() || undefined,
    date: evidenceForm.value.sourceDate.trim() || undefined,
  }
}

function resetEvidenceForm() {
  evidenceForm.value = {
    area: evidenceForm.value.area,
    evidenceStatus: 'User Provided',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
  }
}

function resetDataRoomSourceForm() {
  dataRoomSourceForm.value = {
    checklistLabel: dataRoomSourceForm.value.checklistLabel,
    evidenceStatus: 'User Provided',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
    notes: '',
  }
}

function updateEvidenceArea(event: Event) {
  evidenceForm.value.area = (event.target as HTMLSelectElement).value as EvidenceArea
}

function updateEvidenceStatus(event: Event) {
  evidenceForm.value.evidenceStatus = (event.target as HTMLSelectElement).value as IntelligenceEvidenceStatus
}

function updateDataRoomChecklistLabel(event: Event) {
  dataRoomSourceForm.value.checklistLabel = (event.target as HTMLSelectElement).value
}

function updateDataRoomSourceStatus(event: Event) {
  dataRoomSourceForm.value.evidenceStatus = (event.target as HTMLSelectElement).value as IntelligenceEvidenceStatus
}

function saveEvidenceStatus() {
  const source = evidenceSourceFromForm()
  const requestedStatus = evidenceForm.value.evidenceStatus
  intelligence.updateEvidenceStatus(evidenceForm.value.area, requestedStatus, source)
  const saved = intelligence.state.value.evidenceItems.find(item => item.id === evidenceForm.value.area)
  if (requestedStatus === 'Verified' && saved?.evidenceStatus !== 'Verified') {
    message.warning('Evidence kept To Verify because Verified requires source title plus URL or date')
  } else {
    message.success('Readiness evidence status saved')
  }
  resetEvidenceForm()
}

function dataRoomSourceFromForm(): SourceReference | null {
  const title = dataRoomSourceForm.value.sourceTitle.trim()
  if (!title) return null
  return {
    title,
    url: dataRoomSourceForm.value.sourceUrl.trim() || undefined,
    date: dataRoomSourceForm.value.sourceDate.trim() || undefined,
  }
}

function saveDataRoomSource() {
  const checklistItem = selectedDataRoomChecklistItem.value
  if (!checklistItem) {
    message.error('Select a data-room checklist item first')
    return
  }
  const source = dataRoomSourceFromForm()
  const requestedStatus = dataRoomSourceForm.value.evidenceStatus
  const saved = intelligence.addDataRoomSource({
    checklistLabel: checklistItem.label,
    area: checklistItem.area,
    evidenceStatus: requestedStatus,
    source,
    notes: dataRoomSourceForm.value.notes.trim(),
  })
  if (requestedStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Data-room source kept To Verify because Verified requires source title plus URL or date')
  } else {
    message.success('Data-room source saved and readiness status updated')
  }
  resetDataRoomSourceForm()
}

function removeDataRoomSource(record: DataRoomSourceRecord) {
  const ok = window.confirm(`Remove source record "${record.checklistLabel}" from this browser workspace?`)
  if (!ok) return
  if (intelligence.removeDataRoomSource(record.id)) {
    message.success('Data-room source removed')
  } else {
    message.error('Data-room source was not found')
  }
}

function isStageableForInvestorDraft(status: IntelligenceEvidenceStatus): boolean {
  return status === 'Verified' ||
    status === 'User Approved' ||
    status === 'User Provided' ||
    status === 'Assumption' ||
    status === 'Approved Assumption' ||
    status === 'Derived from Assumptions'
}

function investorDraftStatus(status: IntelligenceEvidenceStatus): IntelligenceEvidenceStatus {
  if (status === 'Assumption') return 'Approved Assumption'
  if (status === 'User Provided') return 'User Approved'
  return status
}

function addToInvestorDraft(item: ReadinessSection) {
  if (!isStageableForInvestorDraft(item.evidenceStatus)) {
    message.warning('Add evidence or approve a labeled assumption before staging it for investor draft')
    return
  }
  intelligence.addPresentationMaterial({
    section: presentationSectionForEvidence(item.id, `${item.label} ${item.description} ${item.nextAction}`),
    content: `${item.description}\n\nInvestor readiness note: ${item.nextAction}`,
    evidenceStatus: investorDraftStatus(item.evidenceStatus),
    source: item.source || null,
  })
  intelligence.updateEvidenceStatus('presentation', 'User Approved')
  message.success('Added approved material to the investor draft builder')
}

defineExpose({
  evidenceForm,
  dataRoomSourceForm,
  saveEvidenceStatus,
  saveDataRoomSource,
  saveDataRoomIndexFile,
})
</script>

<template>
  <div class="investor-workspace">
    <header class="page-header">
      <div>
        <p class="eyebrow">Investor readiness center</p>
        <h2 class="header-title">Investor-Ready Feasibility Intelligence</h2>
        <p class="page-copy">
          Preparation workspace for Chemicon China feasibility. Missing data is shown as Missing / To Verify; no
          market numbers or investor claims are invented here.
        </p>
      </div>
      <div class="score-panel">
        <strong>{{ readinessScore }}%</strong>
        <span>Investor Readiness Score</span>
        <small>Derived from evidence status only</small>
      </div>
    </header>

    <section class="quick-links" aria-label="Investor readiness links">
      <RouterLink v-for="link in quickLinks" :key="link.label" :to="link.to">{{ link.label }}</RouterLink>
    </section>

    <TrustedSourceAutopilotPanel screen="investorReadiness" title="Investor Readiness Auto Source Status" />

    <section class="readiness-stage-card executive-card" :class="readinessStage.tone" aria-label="Readiness status strip">
      <div>
        <p class="eyebrow">Readiness status</p>
        <h3>{{ readinessStage.label }}</h3>
        <p>{{ readinessStage.note }}</p>
      </div>
      <span class="status-badge" :class="readinessStage.tone">{{ readinessStage.label }}</span>
    </section>

    <section class="status-strip" aria-label="Readiness status summary">
      <span>Verified: {{ statusCounts.Verified || 0 }}</span>
      <span>User Approved: {{ statusCounts['User Approved'] || 0 }}</span>
      <span>Assumptions: {{ statusCounts.Assumption || 0 }}</span>
      <span>To Verify: {{ statusCounts['To Verify'] || 0 }}</span>
      <span>Missing: {{ statusCounts.Missing || 0 }}</span>
    </section>

    <section class="evidence-intake" aria-label="Save readiness evidence">
      <div>
        <p class="eyebrow">Evidence intake</p>
        <h3>Save source-backed readiness evidence</h3>
        <p>
          Use this when you have a source document, user-approved assumption, or reviewed evidence. Verified status
          requires a source title plus URL or date; otherwise it stays To Verify.
        </p>
      </div>
      <label>
        Area
        <select :value="evidenceForm.area" @change="updateEvidenceArea">
          <option v-for="area in evidenceAreaOptions" :key="area.value" :value="area.value">{{ area.label }}</option>
        </select>
      </label>
      <label>
        Evidence status
        <select :value="evidenceForm.evidenceStatus" @change="updateEvidenceStatus">
          <option v-for="status in readinessStatusOptions" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label>
        Source title
        <input v-model="evidenceForm.sourceTitle" type="text" placeholder="Document, interview, quote, or review note" />
      </label>
      <label>
        Source URL
        <input v-model="evidenceForm.sourceUrl" type="url" placeholder="https://... or leave blank" />
      </label>
      <label>
        Source date
        <input v-model="evidenceForm.sourceDate" type="text" placeholder="YYYY-MM-DD or source date" />
      </label>
      <NButton secondary type="primary" @click="saveEvidenceStatus">Save evidence status</NButton>
    </section>

    <section class="evidence-intake data-source-intake" aria-label="Save data-room source">
      <div>
        <p class="eyebrow">Data room source register</p>
        <h3>Attach a source to a specific checklist item</h3>
        <p>
          Save documents, quotes, interviews, or reviewed notes against the investor data-room checklist. Verified
          sources require a source title plus URL or date; otherwise they remain To Verify.
        </p>
      </div>
      <label>
        Checklist item
        <select :value="dataRoomSourceForm.checklistLabel" @change="updateDataRoomChecklistLabel">
          <option v-for="item in dataRoomChecklist" :key="item.label" :value="item.label">{{ item.label }}</option>
        </select>
      </label>
      <label>
        Evidence status
        <select :value="dataRoomSourceForm.evidenceStatus" @change="updateDataRoomSourceStatus">
          <option v-for="status in dataRoomSourceStatusOptions" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label>
        Source title
        <input v-model="dataRoomSourceForm.sourceTitle" type="text" placeholder="Document, quote, source, or reviewed note" />
      </label>
      <label>
        Source URL
        <input v-model="dataRoomSourceForm.sourceUrl" type="url" placeholder="https://... or leave blank" />
      </label>
      <label>
        Source date
        <input v-model="dataRoomSourceForm.sourceDate" type="text" placeholder="YYYY-MM-DD or source date" />
      </label>
      <label class="wide">
        Notes
        <input v-model="dataRoomSourceForm.notes" type="text" placeholder="Why this source matters, or what still needs checking" />
      </label>
      <NButton secondary type="primary" @click="saveDataRoomSource">Save data-room source</NButton>
    </section>

    <section class="readiness-grid" aria-label="Investor readiness sections">
      <article
        v-for="item in sections"
        :key="item.label"
        class="readiness-card"
        :class="{ critical: item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify' }"
      >
        <div class="card-head">
          <h3>
            <span v-if="item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify'" class="priority-star" aria-label="Investor-critical evidence gap"></span>
            {{ item.label }}
          </h3>
          <span class="status-pill">{{ item.evidenceStatus }}</span>
        </div>
        <p>{{ item.description }}</p>
        <div class="source-row" :class="sourceClass({ status: item.evidenceStatus })">
          <span>Source</span>
          <strong>{{ formatSource(item.source) }}</strong>
        </div>
        <div v-if="item.updatedAt" class="source-row muted">
          <span>Updated</span>
          <strong>{{ new Date(item.updatedAt).toLocaleString() }}</strong>
        </div>
        <small>{{ item.nextAction }}</small>
        <div class="card-actions">
          <NButton size="tiny" secondary type="primary" :loading="creatingKey === item.label" @click="createEvidenceTask(item)">
            Create task for missing evidence
          </NButton>
          <RouterLink :to="{ name: 'hermes.chat', query: { captureContext: 'investment-research' } }">Send to Review & Capture</RouterLink>
          <button type="button" @click="markAssumption(item)">Mark as assumption</button>
          <button type="button" @click="addToInvestorDraft(item)">Add to investor draft</button>
          <button type="button" @click="copyForPresentation(item)">Copy for presentation</button>
          <RouterLink :to="{ name: item.routeName }">Open source area</RouterLink>
        </div>
      </article>
    </section>

    <section class="support-grid">
      <article>
        <h3>Risk Register</h3>
        <p>{{ riskRegisterItems.length }} live risk{{ riskRegisterItems.length === 1 ? '' : 's' }} tracked from evidence gaps, review items, warnings, and unsupported investor material.</p>
      </article>
      <article>
        <h3>Financial Model Status</h3>
        <p>IRR is not investor-ready until price, cost, capex, working capital, tax, and capacity assumptions have evidence status.</p>
        <RouterLink :to="{ name: 'hermes.investmentCalculator' }">Open IRR calculator</RouterLink>
      </article>
      <article>
        <h3>Presentation Draft Builder</h3>
        <p>Draft material must be Verified, User Approved, or visibly labeled Approved Assumption.</p>
        <RouterLink :to="{ name: 'hermes.investorPresentation' }">Open presentation builder</RouterLink>
      </article>
    </section>

    <section class="data-room risk-register">
      <div class="section-head-with-actions">
        <div>
          <p class="eyebrow">Risk register</p>
          <h3>{{ riskRegisterItems.length }} Investor Risk{{ riskRegisterItems.length === 1 ? '' : 's' }}</h3>
          <small class="section-note">
            Risks are generated from current Hermes workspace state. They are not claims; create mitigation tasks or keep them visible.
          </small>
        </div>
        <RouterLink class="section-action-link" :to="{ name: 'hermes.kanban' }">Open Tasks</RouterLink>
      </div>
      <ul v-if="visibleRiskRegisterItems.length">
        <li v-for="item in visibleRiskRegisterItems" :key="item.id">
          <div>
            <strong>{{ item.title }}</strong>
            <small>{{ item.origin }} / {{ evidenceAreaOptions.find(area => area.value === item.area)?.label || item.area }}</small>
            <small>{{ item.detail }}</small>
          </div>
          <div class="data-room-actions">
            <span :class="sourceClass({ status: item.evidenceStatus === 'Pending Review' || item.evidenceStatus === 'Unsupported' ? 'To Verify' : item.evidenceStatus })">
              {{ item.evidenceStatus }}
            </span>
            <NButton
              size="tiny"
              secondary
              :loading="creatingRiskTaskId === item.id"
              @click="createRiskTask(item)"
            >
              Create mitigation task
            </NButton>
            <NButton
              size="tiny"
              secondary
              :loading="creatingRiskResearchId === item.id"
              @click="createRiskResearchJob(item)"
            >
              Do deeper research
            </NButton>
            <RouterLink :to="{ name: item.routeName }">Open</RouterLink>
          </div>
        </li>
      </ul>
      <p v-else class="empty-state">
        No current investor risks found in the local intelligence state. Continue collecting evidence and reviewing findings.
      </p>
    </section>

    <section class="data-room assumption-register">
      <div class="section-head-with-actions">
        <div>
          <p class="eyebrow">Assumption register</p>
          <h3>{{ assumptionRecords.length }} Tracked Assumption{{ assumptionRecords.length === 1 ? '' : 's' }}</h3>
          <small class="section-note">
            Assumptions are allowed for planning only when labeled. Create verification tasks before using them as investor claims.
          </small>
        </div>
        <RouterLink class="section-action-link" :to="{ name: 'hermes.investmentCalculator' }">Open IRR calculator</RouterLink>
      </div>
      <ul v-if="visibleAssumptionRecords.length">
        <li v-for="item in visibleAssumptionRecords" :key="item.id">
          <div>
            <strong>{{ item.title }}</strong>
            <small>{{ item.origin }} / {{ evidenceAreaOptions.find(area => area.value === item.area)?.label || item.area }}</small>
            <small>{{ item.detail }}</small>
            <small class="source-note">Source: {{ item.source ? formatSource(item.source) : 'Source missing' }}</small>
          </div>
          <div class="data-room-actions">
            <span :class="sourceClass({ status: item.evidenceStatus })">{{ item.evidenceStatus }}</span>
            <NButton
              size="tiny"
              secondary
              :loading="creatingAssumptionTaskId === item.id"
              @click="createAssumptionTask(item)"
            >
              Create verification task
            </NButton>
            <RouterLink :to="{ name: item.routeName }">Open</RouterLink>
          </div>
        </li>
      </ul>
      <p v-else class="empty-state">
        No assumption-labeled items are currently tracked. Financial outputs, data-room sources, market claims,
        competitor records, and investor draft material will appear here when they are marked as assumptions.
      </p>
    </section>

    <section class="data-room">
      <div class="section-head-with-actions">
        <div>
          <p class="eyebrow">Data room checklist</p>
          <h3>Investor Evidence Pack</h3>
          <small class="section-note">Save a file-based index for review; it does not verify claims by itself.</small>
        </div>
        <NButton
          size="small"
          secondary
          type="primary"
          :loading="savingDataRoomIndex"
          @click="saveDataRoomIndexFile"
        >
          Save index file
        </NButton>
      </div>
      <ul>
        <li v-for="item in dataRoomItems" :key="item.label">
          <div>
            <strong>{{ item.label }}</strong>
            <small>{{ item.source ? formatSource(item.source) : item.sourceHint }}</small>
            <small v-if="item.sourceRecord?.notes" class="source-note">{{ item.sourceRecord.notes }}</small>
            <small v-if="item.updatedAt" class="source-note">Updated {{ new Date(item.updatedAt).toLocaleString() }}</small>
          </div>
          <div class="data-room-actions">
            <span :class="sourceClass(item)">{{ item.status }}</span>
            <NButton
              size="tiny"
              secondary
              :loading="creatingDataRoomTask === item.label"
              @click="createDataRoomTask(item)"
            >
              Create task
            </NButton>
            <RouterLink :to="{ name: item.routeName }">Open</RouterLink>
          </div>
        </li>
      </ul>
      <p v-if="latestDataRoomIndexPath" class="saved-file-note">
        Saved to Documents: <code>{{ latestDataRoomIndexPath }}</code>
      </p>
    </section>

    <section class="data-room source-register">
      <div>
        <p class="eyebrow">Source register</p>
        <h3>{{ dataRoomSourceCount }} Saved Data-Room Source{{ dataRoomSourceCount === 1 ? '' : 's' }}</h3>
      </div>
      <ul v-if="dataRoomSourceRecords.length">
        <li v-for="record in dataRoomSourceRecords" :key="record.id">
          <div>
            <strong>{{ record.checklistLabel }}</strong>
            <small>{{ record.source ? formatSource(record.source) : 'Source missing' }}</small>
            <small v-if="record.notes" class="source-note">{{ record.notes }}</small>
          </div>
          <div class="data-room-actions">
            <span :class="sourceClass({ status: record.evidenceStatus })">{{ record.evidenceStatus }}</span>
            <NButton
              size="tiny"
              secondary
              :loading="stagingDataRoomSourceId === record.id"
              @click="stageDataRoomSourceForReview(record)"
            >
              Stage for review
            </NButton>
            <NButton size="tiny" quaternary type="error" @click="removeDataRoomSource(record)">
              Remove
            </NButton>
          </div>
        </li>
      </ul>
      <p v-else class="empty-state">
        No checklist-specific source records yet. Save source-backed evidence above as documents, quotes, interviews,
        or reviewed notes become available.
      </p>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.investor-workspace {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header,
.evidence-intake,
.readiness-card,
.support-grid article,
.data-room,
.score-panel {
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.page-header,
.evidence-intake,
.readiness-card,
.support-grid article,
.data-room,
.score-panel {
  position: relative;
  overflow: hidden;
}

.evidence-intake::before,
.readiness-card::before,
.support-grid article::before,
.data-room::before,
.score-panel::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: $executive-strip;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 16px;
  align-items: stretch;
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
.readiness-card p,
.support-grid p,
.data-room li {
  color: $text-secondary;
  line-height: 1.55;
}

.score-panel {
  display: grid;
  place-items: center;
  gap: 4px;
  padding: 16px;
  text-align: center;

  strong {
    color: $accent-primary;
    font-size: 42px;
  }

  span {
    color: $text-primary;
    font-weight: 900;
  }

  small {
    color: $text-muted;
  }
}

.quick-links,
.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0;

  a,
  span {
    min-height: 34px;
    padding: 8px 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    color: $accent-info;
    text-decoration: none;
    font-weight: 800;
  }
}

.readiness-stage-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  margin: 14px 0;
  padding: 16px 18px 16px 22px;

  h3 {
    margin: 0;
    color: $accent-primary;
    font-size: 18px;
  }

  p:not(.eyebrow) {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.5;
  }

  &.ready {
    border-color: rgba(var(--success-rgb), 0.38);
  }

  &.draft,
  &.needs {
    border-color: rgba(var(--accent-primary-rgb), 0.38);
  }

  &.blocked {
    border-color: rgba(var(--error-rgb), 0.32);
  }
}

.readiness-grid,
.support-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.evidence-intake {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;
  padding: 16px;

  > div {
    grid-column: 1 / -1;
  }

  .wide {
    grid-column: 1 / -1;
  }

  h3 {
    margin: 0;
    color: $text-primary;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    line-height: 1.5;
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

.readiness-card,
.support-grid article,
.data-room {
  padding: 16px;
}

.card-head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;

  h3 {
    display: flex;
    gap: 7px;
    align-items: center;
    margin: 0;
    color: $text-primary;
    font-size: 16px;
  }
}

.readiness-card.critical {
  border-color: rgba(var(--accent-primary-rgb), 0.34);
  background: linear-gradient(145deg, rgba(var(--accent-primary-rgb), 0.07), rgba(19, 26, 40, 0.96));
}

.status-pill {
  flex: 0 0 auto;
  padding: 4px 8px;
  border: 1px solid rgba(var(--warning-rgb), 0.45);
  border-radius: 999px;
  color: $warning;
  font-size: 11px;
  font-weight: 900;
}

.readiness-card small {
  display: block;
  color: $text-muted;
}

.source-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: rgba(255, 255, 255, 0.02);

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: $text-secondary;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &.ready {
    border-color: rgba(var(--success-rgb), 0.4);
  }

  &.weak {
    border-color: rgba(var(--warning-rgb), 0.4);
  }

  &.missing {
    border-color: rgba(var(--error-rgb), 0.3);
  }

  &.muted {
    opacity: 0.82;
  }
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;

  a,
  button {
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    padding: 6px 9px;
    background: transparent;
    color: $accent-info;
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
  }
}

.support-grid {
  margin-top: 12px;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
  }

  a {
    color: $accent-info;
    font-weight: 800;
  }
}

.data-room {
  margin-top: 12px;

  h3 {
    margin: 0;
    color: $text-primary;
  }

  ul {
    display: grid;
    gap: 8px;
    padding: 0;
    margin: 14px 0 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 0;
    border-top: 1px solid $border-color;

    strong,
    small {
      display: block;
    }

    strong {
      color: $text-primary;
    }

    small {
      margin-top: 4px;
      color: $text-muted;
      font-size: 12px;
    }

    .source-note {
      color: $text-secondary;
    }
  }

  span {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 4px 8px;
    border: 1px solid $border-color;
    border-radius: 999px;
    font-weight: 900;

    &.ready {
      border-color: rgba(var(--success-rgb), 0.45);
      color: $success;
    }

    &.weak {
      border-color: rgba(var(--warning-rgb), 0.45);
      color: $warning;
    }

    &.missing {
      border-color: rgba(var(--error-rgb), 0.35);
      color: $error;
    }
  }
}

.section-head-with-actions {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.section-note {
  display: block;
  margin-top: 6px;
  color: $text-muted;
  line-height: 1.45;
}

.source-register {
  border-color: rgba(var(--accent-info-rgb), 0.28);
}

.assumption-register {
  border-color: rgba(var(--warning-rgb), 0.28);
}

.risk-register {
  border-color: rgba(var(--error-rgb), 0.26);
}

.section-action-link {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  color: $accent-info;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;

  &:hover {
    border-color: $accent-info;
    background: rgba(var(--accent-info-rgb), 0.06);
  }
}

.empty-state {
  margin: 14px 0 0;
  color: $text-secondary;
  line-height: 1.55;
}

.saved-file-note {
  margin: 12px 0 0;
  padding: 10px;
  border: 1px solid rgba(var(--success-rgb), 0.32);
  border-radius: $radius-sm;
  background: rgba(var(--success-rgb), 0.06);
  color: $text-secondary;
  line-height: 1.5;

  code {
    color: $success;
    overflow-wrap: anywhere;
  }
}

.data-room-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;

  a {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 4px 8px;
    border: 1px solid $border-color;
    border-radius: 999px;
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-decoration: none;
  }
}

@media (max-width: 760px) {
  .page-header {
    grid-template-columns: 1fr;
  }

  .readiness-stage-card {
    grid-template-columns: 1fr;
  }

  .section-head-with-actions {
    display: grid;
  }

  .data-room li {
    grid-template-columns: 1fr;
  }

  .data-room-actions {
    justify-content: flex-start;
  }
}
</style>
