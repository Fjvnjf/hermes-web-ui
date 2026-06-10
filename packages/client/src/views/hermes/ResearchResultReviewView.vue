<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import {
  type EvidenceArea,
  type ResearchJobRecord,
  type ResearchReviewFinding,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import { fetchMemory, saveMemory } from '@/api/hermes/skills'
import { listCronRuns, readCronRun } from '@/api/hermes/cron-history'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { useJobsStore } from '@/stores/hermes/jobs'
import { scheduleForResearchSuggestion } from '@/composables/useSessionCapture'
import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

type ResearchReviewDashboardTarget = NonNullable<ResearchReviewFinding['dashboardTarget']>
type ReviewDetailRow = { label: string; value: string; href?: string }

const message = useMessage()
const kanbanStore = useKanbanStore()
const jobsStore = useJobsStore()
const intelligence = useFeasibilityIntelligence()
const creatingTaskId = ref('')
const creatingJobTaskId = ref('')
const schedulingJobId = ref('')
const importingJobOutputId = ref('')
const savingMemoryId = ref('')
const savingMarketClaimId = ref('')
const savingCompetitorId = ref('')
const savingDataRoomId = ref('')
const jobOutputStatus = ref<Record<string, string>>({})

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
const sourceBackedFindings = computed(() => findings.value.filter(item => hasUsableSource(item)).length)
const weakOrMissingFindings = computed(() => findings.value.filter(item => needsEvidenceReview(item)).length)
const appliedDashboardUpdates = computed(() => findings.value.filter(item => item.dashboardAppliedAt).length)
const sourceBackedPendingFindings = computed(() => pendingFindings.value.filter(item => hasUsableSource(item)).length)
const criticalReviewFindings = computed(() => pendingFindings.value.filter(item => isCriticalReviewFinding(item)).length)
const jobImportStatusRows = computed(() =>
  Object.entries(jobOutputStatus.value)
    .filter(([, status]) => status.trim())
    .slice(0, 3),
)
const reviewQueueStatusRows = computed(() => [
  {
    label: 'Source-backed pending',
    value: String(sourceBackedPendingFindings.value),
    detail: 'Pending findings with a source title plus URL or date. Owner approval is still required before dashboard truth changes.',
  },
  {
    label: 'Critical review-gated',
    value: String(criticalReviewFindings.value),
    detail: 'Market size, growth, pricing, supplier, financial, regulatory, and investor-impact claims remain staged.',
  },
  {
    label: 'Job import messages',
    value: String(jobImportStatusRows.value.length),
    detail: jobImportStatusRows.value[0]?.[1] || 'No scheduled job output import warnings in this browser session.',
  },
])

const reviewGateSteps = computed(() => [
  {
    icon: '🔍',
    title: 'Hermes researches automatically',
    detail: `${researchJobs.value.length} source job${plural(researchJobs.value.length)} and ${pendingFindings.value.length} pending finding${plural(pendingFindings.value.length)} feed this queue.`,
  },
  {
    icon: '🧾',
    title: 'Risky claims wait here',
    detail: `${weakOrMissingFindings.value} item${plural(weakOrMissingFindings.value)} need source proof before changing dashboard facts.`,
  },
  {
    icon: '✅',
    title: 'You approve dashboard truth',
    detail: `${sourceBackedFindings.value} finding${plural(sourceBackedFindings.value)} have source evidence. Only approved items update readiness or reports.`,
  },
  {
    icon: '📌',
    title: 'Gaps become tasks',
    detail: 'Missing market, competitor, supplier, finance, or regulatory proof becomes Kanban work instead of fake data.',
  },
])

function plural(count: number): string {
  return count === 1 ? '' : 's'
}

function hasUsableSource(item: ResearchReviewFinding): boolean {
  return Boolean(item.source?.title && (item.source?.url || item.source?.date))
}

function needsEvidenceReview(item: ResearchReviewFinding): boolean {
  return item.evidenceStatus === 'Missing' ||
    item.evidenceStatus === 'To Verify' ||
    !hasUsableSource(item)
}

function isCriticalReviewFinding(item: ResearchReviewFinding): boolean {
  const target = item.dashboardTarget
  if (target?.sensitive || target?.reviewRequired || item.reviewRequired) return true
  const text = [
    item.keyClaim,
    item.summary,
    item.area,
    item.dataType,
    item.riskReason,
    item.riskNote,
    target?.group,
    target?.dataType,
    target?.proposedDashboardField,
    target?.field,
    target?.fieldKey,
    target?.riskReason,
  ].map(value => textValue(value)).join(' ')
  return /market\s*size|cagr|growth|market\s*share|supplier|price|quote|irr|npv|financial|regulatory|permission|permit|investor|presentation|dms/i.test(text)
}

function textValue(value?: string | null): string {
  return value?.trim() || ''
}

function safeHttpUrl(value?: string): string {
  const url = value?.trim() || ''
  return /^https?:\/\//i.test(url) ? url : ''
}

function dashboardStoreLabel(target: ResearchReviewDashboardTarget): string {
  if (target.group === 'marketClaims') return 'Market Intelligence claims'
  if (target.group === 'competitorRecords') return 'Competitor Intelligence records'
  if (target.group === 'investorMaterialCandidates') return 'Investor presentation draft candidates'
  if (target.group === 'supplierScorecards') return 'Supplier scorecard dashboard row plus data-room audit copy'
  if (target.group === 'rawMaterialSignals') return 'Raw-material dashboard signal plus data-room audit copy'
  if (target.group === 'regulatoryFindings') return 'Data-room evidence for regulatory findings'
  if (target.group === 'financialEvidence') return 'Data-room evidence for financial evidence'
  if (target.group === 'suggestedTasks') return 'Suggested research task'
  return 'Evidence gap review'
}

function proposedDashboardField(item: ResearchReviewFinding): string {
  const target = item.dashboardTarget
  if (!target) return ''
  return textValue(target.proposedDashboardField) ||
    textValue(target.field) ||
    textValue(target.fieldKey) ||
    'dashboard evidence'
}

function proposedDashboardValue(target: ResearchReviewDashboardTarget): string {
  return textValue(target.value) ||
    textValue(target.content) ||
    textValue(target.marketShare) ||
    textValue(target.pricingEvidence) ||
    textValue(target.revenue) ||
    textValue(target.yearlyGrowth) ||
    textValue(target.traffic) ||
    textValue(target.rating) ||
    textValue(target.supplier && target.material ? `${target.supplier} / ${target.material}` : '')
}

function reviewPolicyLabel(item: ResearchReviewFinding): string {
  if (item.evidenceStatus === 'Conflict Detected') return 'Conflict detected'
  if (item.dashboardTarget?.sensitive) return 'Review required for sensitive claim'
  if (item.dashboardTarget?.reviewRequired || item.reviewRequired || needsEvidenceReview(item)) return 'Review required'
  if (hasUsableSource(item)) return 'Source-backed'
  return 'Source review needed'
}

function riskReasonLabel(item: ResearchReviewFinding): string {
  return textValue(item.dashboardTarget?.riskReason) ||
    textValue(item.riskReason) ||
    textValue(item.riskNote) ||
    (item.dashboardTarget?.reviewRequired ? 'Review required by trusted-source policy.' : '')
}

function reviewDetailRows(item: ResearchReviewFinding): ReviewDetailRow[] {
  const target = item.dashboardTarget
  const sourceUrl = safeHttpUrl(item.source?.url)
  const rows: ReviewDetailRow[] = []

  if (target) {
    rows.push(
      { label: 'Dashboard store', value: dashboardStoreLabel(target) },
      { label: 'Proposed dashboard field', value: proposedDashboardField(item) },
      { label: 'Field key', value: textValue(target.fieldKey) || 'No stable field key attached' },
    )
    const value = proposedDashboardValue(target)
    if (value) rows.push({ label: 'Proposed value', value })
    const sourceTier = textValue(target.sourceTier) || textValue(target.reportedSourceTier) || textValue(item.sourceTier)
    if (sourceTier) rows.push({ label: 'Source tier', value: sourceTier })
    const dataType = textValue(target.dataType) || textValue(item.dataType)
    if (dataType) rows.push({ label: 'Data type', value: dataType })
  }

  rows.push(
    { label: 'Source title', value: textValue(item.source?.title) || 'Source missing' },
  )
  if (sourceUrl) rows.push({ label: 'Source link', value: sourceUrl, href: sourceUrl })
  if (textValue(item.source?.date)) rows.push({ label: 'Source date', value: textValue(item.source?.date) })

  rows.push(
    { label: 'Confidence', value: item.confidence },
    { label: 'Review policy', value: reviewPolicyLabel(item) },
  )

  const riskReason = riskReasonLabel(item)
  if (riskReason) rows.push({ label: 'Risk reason', value: riskReason })

  return rows
}

function isSupplierScorecardTarget(item: ResearchReviewFinding): boolean {
  return item.dashboardTarget?.group === 'supplierScorecards'
}

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

function inferAreaFromResearchJob(job: ResearchJobRecord): EvidenceArea {
  const text = [
    job.title,
    job.question,
    job.scope,
    job.expectedOutput,
    job.sourceRequirements,
    job.context,
  ].filter(Boolean).join(' ').toLowerCase()
  if (text.includes('company') || text.includes('legal') || text.includes('business license') || text.includes('bank') || text.includes('import/export')) {
    return 'companyLegal'
  }
  if (text.includes('regulatory') || text.includes('dms') || text.includes('permission') || text.includes('permit')) {
    return 'regulatory'
  }
  if (text.includes('product') || text.includes('cwas') || text.includes('cwms') || text.includes('sds') || text.includes('tds') || text.includes('cas')) {
    return 'product'
  }
  if (text.includes('factory') || text.includes('plant') || text.includes('manufacturing') || text.includes('machine') || text.includes('capacity') || text.includes('location')) {
    return 'factory'
  }
  if (text.includes('finance') || text.includes('financial') || text.includes('investment') || text.includes('investor') || text.includes('irr') || text.includes('npv')) {
    return 'financial'
  }
  if (text.includes('presentation') || text.includes('deck') || text.includes('report')) {
    return 'presentation'
  }
  return 'market'
}

function researchJobSummary(job: ResearchJobRecord): string {
  return [
    `Research job request: ${job.question}`,
    job.scope ? `Scope: ${job.scope}` : '',
    job.expectedOutput ? `Expected output: ${job.expectedOutput}` : '',
    job.sourceRequirements ? `Source requirements: ${job.sourceRequirements}` : '',
    job.scheduledJobId ? `Hermes job id: ${job.scheduledJobId}` : '',
    job.schedule ? `Scheduled run: ${job.schedule}` : '',
    job.schedulePreference ? `Run time preference: ${job.schedulePreference}` : '',
  ].filter(Boolean).join('\n')
}

function useJobAsFindingDraft(job: ResearchJobRecord) {
  findingForm.value = {
    summary: researchJobSummary(job),
    keyClaim: job.title,
    area: inferAreaFromResearchJob(job),
    evidenceStatus: 'To Verify',
    confidence: 'medium',
    sourceTitle: '',
    sourceUrl: '',
    sourceDate: '',
    suggestedTask: `Complete research and attach sources: ${job.title}`,
    suggestedInvestorMaterial: '',
    riskNote: 'Do not approve this finding until source-backed research results are reviewed.',
  }
  message.info('Research job copied into the review form as To Verify')
}

function compactJobOutput(content: string): string {
  const trimmed = content.replace(/\r\n/g, '\n').trim()
  if (trimmed.length <= 5000) return trimmed
  return `${trimmed.slice(0, 5000).trim()}\n\n[Output truncated for review form. Open Jobs for the full run output.]`
}

async function importLatestJobOutput(job: ResearchJobRecord) {
  if (!job.scheduledJobId) {
    message.warning('This research job is not linked to a scheduled Hermes Job yet')
    return
  }
  importingJobOutputId.value = job.id
  jobOutputStatus.value = { ...jobOutputStatus.value, [job.id]: '' }
  try {
    const runs = await listCronRuns(job.scheduledJobId)
    const latest = runs.find(run => run.hasOutput !== false && !run.synthetic)
    if (!latest) {
      const recordedRun = runs[0]
      const statusDetail = recordedRun?.status || recordedRun?.error || 'No output artifact found yet'
      jobOutputStatus.value = {
        ...jobOutputStatus.value,
        [job.id]: `No readable research output found for this Hermes job yet. Status: ${statusDetail}`,
      }
      message.warning('No readable Hermes job output found yet')
      return
    }
    const detail = await readCronRun(latest.jobId, latest.fileName)
    findingForm.value = {
      summary: [
        `Scheduled Hermes research output from ${job.title}`,
        '',
        compactJobOutput(detail.content),
      ].join('\n'),
      keyClaim: `Research result: ${job.title}`,
      area: inferAreaFromResearchJob(job),
      evidenceStatus: 'To Verify',
      confidence: 'medium',
      sourceTitle: `Hermes scheduled job output: ${job.title}`,
      sourceUrl: '',
      sourceDate: detail.runTime || latest.runTime,
      suggestedTask: `Review sources and follow-up tasks from scheduled research: ${job.title}`,
      suggestedInvestorMaterial: '',
      riskNote: 'Imported from scheduled Hermes job output. Keep it unapproved and in source review until source evidence is checked and the user approves any dashboard updates.',
    }
    jobOutputStatus.value = {
      ...jobOutputStatus.value,
      [job.id]: 'Latest Hermes job output loaded into the review form as To Verify. It has not updated readiness or investor material.',
    }
    message.success('Latest Hermes job output loaded into review form')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown job output error'
    jobOutputStatus.value = { ...jobOutputStatus.value, [job.id]: `Could not load job output: ${detail}` }
    message.error(`Could not load job output: ${detail}`)
  } finally {
    importingJobOutputId.value = ''
  }
}

function researchJobSchedulePreference(job: ResearchJobRecord): NonNullable<ResearchJobRecord['schedulePreference']> {
  return job.schedulePreference || 'Tonight'
}

function researchJobPrompt(job: ResearchJobRecord): string {
  return [
    `Research task: ${job.title}`,
    '',
    `Research question: ${job.question}`,
    `Scope: ${job.scope || 'Source-backed feasibility or investor readiness research.'}`,
    `Expected output: ${job.expectedOutput || 'Concise research result with sources, evidence status, risks, and follow-up tasks.'}`,
    `Source requirements: ${job.sourceRequirements || 'Include source title plus URL or publication/access date for every claim.'}`,
    `Project/context: ${job.context}`,
    `Priority: ${job.priority || 'medium'}`,
    `Requested from: Research Result Review`,
    '',
    'Output requirements:',
    '- Separate Verified, User Provided, Assumption, To Verify, Hypothesis, and Reference Only material.',
    '- Include source title plus URL or publication/access date for every claim that could affect investor material.',
    '- Do not invent market size, pricing, competitor market share, IRR, regulatory status, or investor claims.',
    '- If source support is weak or missing, label the claim To Verify and recommend a follow-up task.',
    '- Produce a concise research result that the user can review in Research Result Review before anything changes dashboard facts.',
    '',
    'Do not update Memory, investor readiness, market claims, competitor records, or presentation material automatically.',
  ].join('\n')
}

function researchJobPriority(job: ResearchJobRecord): number {
  if (job.priority === 'high') return 3
  if (job.priority === 'medium') return 2
  if (job.priority === 'low') return 1
  const text = `${job.title} ${job.question} ${job.scope || ''}`.toLowerCase()
  if (text.includes('regulatory') || text.includes('dms') || text.includes('investor') || text.includes('risk')) return 3
  if (text.includes('price') || text.includes('competitor') || text.includes('supplier') || text.includes('market')) return 2
  return 1
}

function researchJobTaskBody(job: ResearchJobRecord): string {
  return [
    `Research job: ${job.title}`,
    `Research question: ${job.question}`,
    job.scope ? `Scope: ${job.scope}` : '',
    `Expected output: ${job.expectedOutput || 'Source-backed research finding with clear Verified / To Verify / Assumption labels.'}`,
    `Source requirements: ${job.sourceRequirements || 'Include source title plus URL or date before using claims in investor material.'}`,
    `Project/context: ${job.context}`,
    `Priority: ${job.priority || (researchJobPriority(job) === 3 ? 'high' : researchJobPriority(job) === 2 ? 'medium' : 'low')}`,
    `Run time preference: ${job.schedulePreference || 'Manual'}`,
    job.scheduledJobId ? `Hermes scheduled job id: ${job.scheduledJobId}` : '',
    job.schedule ? `Scheduled run: ${job.schedule}` : '',
    `Current job status: ${job.status}`,
    'Source page: Research Result Review',
    'Tags: Research Job, Evidence Gap, Chemicon China Feasibility',
    '',
    'Note: This is a Kanban research task, not an automatically scheduled job.',
  ].filter(Boolean).join('\n')
}

async function persistResearchJobAsTask(job: ResearchJobRecord, extraLines: string[] = []) {
  await kanbanStore.fetchBoards()
  const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
  kanbanStore.setSelectedBoard(board)
  await kanbanStore.createTask({
    title: `Research: ${job.title}`,
    body: [
      researchJobTaskBody(job),
      ...extraLines,
    ].filter(Boolean).join('\n'),
    priority: researchJobPriority(job),
    tenant: job.context || 'Chemicon China Feasibility',
  })
}

async function createResearchJobTask(job: ResearchJobRecord) {
  creatingJobTaskId.value = job.id
  try {
    await persistResearchJobAsTask(job)
    intelligence.updateResearchJobStatus(job.id, 'Task Created')
    message.success('Research job task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown research job task error'
    message.error(`Could not create research job task: ${detail}`)
  } finally {
    creatingJobTaskId.value = ''
  }
}

async function scheduleResearchJob(job: ResearchJobRecord) {
  schedulingJobId.value = job.id
  jobOutputStatus.value = { ...jobOutputStatus.value, [job.id]: '' }
  const schedule = scheduleForResearchSuggestion(researchJobSchedulePreference(job))
  try {
    const scheduledJob = await jobsStore.createJob({
      name: `Research: ${job.title}`,
      schedule,
      prompt: researchJobPrompt(job),
      deliver: 'local',
      repeat: 1,
    })
    const scheduledJobId = scheduledJob.job_id || scheduledJob.id
    if (!scheduledJobId) throw new Error('Hermes did not return a scheduled job id')
    intelligence.updateResearchJobSchedule(job.id, {
      scheduledJobId,
      schedule,
      status: 'Scheduled Hermes Job',
    })
    jobOutputStatus.value = {
      ...jobOutputStatus.value,
      [job.id]: `Scheduled as a Hermes job for ${schedule}. Import the output here before using it as evidence.`,
    }
    message.success('Hermes research job scheduled')
  } catch (err) {
    const scheduleDetail = err instanceof Error ? err.message : 'Unknown scheduling error'
    try {
      await persistResearchJobAsTask(job, [
        '',
        `Scheduling attempt failed: ${scheduleDetail}`,
        'Saved fallback: Kanban research task, not a scheduled Hermes job.',
      ])
      intelligence.updateResearchJobStatus(job.id, 'Task Created')
      jobOutputStatus.value = {
        ...jobOutputStatus.value,
        [job.id]: `Scheduling failed, so this was saved as a Kanban research task instead: ${scheduleDetail}`,
      }
      message.warning('Scheduling failed; saved as a Kanban research task instead')
    } catch (fallbackErr) {
      const fallbackDetail = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown fallback task error'
      jobOutputStatus.value = {
        ...jobOutputStatus.value,
        [job.id]: `Could not schedule job or create fallback task: ${scheduleDetail}; ${fallbackDetail}`,
      }
      message.error('Could not schedule research job')
    }
  } finally {
    schedulingJobId.value = ''
  }
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

function blockRejectedFinding(item: ResearchReviewFinding, action: string): boolean {
  if (item.status !== 'Rejected') return false
  message.warning(`Rejected findings cannot be ${action}. Stage a new finding if the research should be reconsidered.`)
  return true
}

function approveReadinessUpdate(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'approved')) return
  const approved = intelligence.approveResearchFinding(item.id, {
    updateReadiness: true,
    evidenceStatus: item.evidenceStatus,
    applyDashboardUpdate: true,
  })
  if (!approved) return
  if (approved.status === 'To Verify') {
    message.warning('Finding remains To Verify; readiness was not marked as verified without source evidence')
  } else if (intelligence.state.value.researchFindings.find(finding => finding.id === item.id)?.dashboardAppliedAt) {
    message.success('Approved finding and applied it to the dashboard evidence')
  } else {
    message.success('Approved finding and updated investor readiness')
  }
}

function addToInvestorDraft(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'added to the investor draft')) return
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
  if (blockRejectedFinding(item, 'reopened as To Verify')) return
  intelligence.approveResearchFinding(item.id, { evidenceStatus: 'To Verify' })
  message.info('Finding marked To Verify')
}

function rejectFinding(item: ResearchReviewFinding) {
  intelligence.rejectResearchFinding(item.id)
  message.info('Research finding rejected')
}

function saveAsMarketClaim(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'saved as a market claim')) return
  savingMarketClaimId.value = item.id
  try {
    const saved = intelligence.addMarketClaim({
      label: item.keyClaim,
      value: item.summary,
      evidenceStatus: item.evidenceStatus,
      confidence: item.confidence,
      source: item.source || null,
      lastChecked: new Date().toISOString().slice(0, 10),
    })
    if (item.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
      message.warning('Market claim saved as To Verify because verified claims need a usable source and value')
    } else {
      message.success('Research finding saved as Market Intelligence evidence')
    }
  } finally {
    savingMarketClaimId.value = ''
  }
}

function reviewLine(item: ResearchReviewFinding, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = item.summary.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))
  return match?.[1]?.trim() || ''
}

function competitorNameFromFinding(item: ResearchReviewFinding): string {
  const structured = reviewLine(item, 'Competitor')
  if (structured && structured !== 'To Verify') return structured
  const keyMatch = item.keyClaim.match(/^Competitor(?: evidence| research)?:\s*(.+)$/i)
  return keyMatch?.[1]?.trim() || item.keyClaim.replace(/^Competitor\s*/i, '').trim() || 'Competitor to verify'
}

function isCompetitorFinding(item: ResearchReviewFinding): boolean {
  const text = `${item.keyClaim} ${item.summary}`.toLowerCase()
  return item.area === 'market' && (text.includes('competitor') || text.includes('market share'))
}

function normalizedMarketShareValue(value: string): string {
  const trimmed = value.trim()
  return trimmed && !['to verify', 'unknown', 'missing'].includes(trimmed.toLowerCase()) ? trimmed : ''
}

function saveAsCompetitorRecord(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'saved as a competitor record')) return
  savingCompetitorId.value = item.id
  try {
    const saved = intelligence.addCompetitor({
      companyName: competitorNameFromFinding(item),
      countryRegion: reviewLine(item, 'Region') || 'To Verify',
      productEquivalent: reviewLine(item, 'Product equivalent') || 'To Verify',
      activeContent: reviewLine(item, 'Active content') || 'To Verify',
      pricingEvidence: reviewLine(item, 'Pricing evidence') || 'Missing',
      certifications: reviewLine(item, 'Certifications') || 'To Verify',
      distributionPresence: reviewLine(item, 'Distribution presence') || 'To Verify',
      marketShare: normalizedMarketShareValue(reviewLine(item, 'Market share')),
      revenue: reviewLine(item, 'Revenue') || reviewLine(item, 'Annual revenue') || '',
      yearlyGrowth: reviewLine(item, 'Yearly growth') || reviewLine(item, 'Growth') || '',
      traffic: item.dashboardTarget?.traffic || reviewLine(item, 'Traffic') || reviewLine(item, 'Website traffic') || '',
      rating: item.dashboardTarget?.rating || reviewLine(item, 'Rating') || reviewLine(item, 'Review rating') || '',
      lastUpdated: item.dashboardTarget?.lastUpdated || reviewLine(item, 'Last checked') || reviewLine(item, 'Source date') || '',
      evidenceStatus: item.evidenceStatus,
      source: item.source || null,
      notes: [
        reviewLine(item, 'Notes') || item.summary,
        `Source finding: ${item.keyClaim}`,
        'Saved from Research Result Review. Do not use in investor material until evidence status and source quality are approved.',
      ].join('\n'),
    })
    if (item.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
      message.warning('Competitor record saved as To Verify because verified records need usable source evidence')
    } else {
      message.success('Research finding saved as Competitor Intelligence evidence')
    }
  } finally {
    savingCompetitorId.value = ''
  }
}

function saveAsDataRoomEvidence(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'saved as data-room evidence')) return
  savingDataRoomId.value = item.id
  try {
    const saved = intelligence.addDataRoomSource({
      checklistLabel: item.keyClaim,
      area: item.area,
      evidenceStatus: item.evidenceStatus,
      source: item.source || null,
      notes: [
        item.summary,
        item.riskNote ? `Risk note: ${item.riskNote}` : '',
        `Review status: ${item.status}`,
        `Confidence: ${item.confidence}`,
        'Saved from Research Result Review. Treat as dashboard evidence only with the displayed evidence status.',
      ].filter(Boolean).join('\n'),
    })
    if (item.evidenceStatus === 'Verified' && saved.evidenceStatus !== 'Verified') {
      message.warning('Data-room evidence saved as To Verify because Verified requires usable source evidence')
    } else {
      message.success('Research finding saved as data-room evidence')
    }
  } finally {
    savingDataRoomId.value = ''
  }
}

function formatResearchNoteMemory(item: ResearchReviewFinding): string {
  return [
    `## Research Review Note - ${item.keyClaim}`,
    '',
    'Source: Research Result Review',
    `Captured at: ${new Date().toLocaleString()}`,
    `Area: ${areaLabel(item.area)}`,
    `Evidence status: ${item.evidenceStatus}`,
    `Review status: ${item.status}`,
    `Confidence: ${item.confidence}`,
    `Source evidence: ${item.source?.title || 'Source missing'}${item.source?.url ? ` (${item.source.url})` : ''}${item.source?.date ? ` / ${item.source.date}` : ''}`,
    'Tags: Research Review, Feasibility Intelligence, Chemicon China Feasibility',
    '',
    'Note: This memory entry is a labeled research note. Do not treat it as verified fact unless the evidence status and source support it.',
    '',
    item.summary,
    item.suggestedTask ? `\nSuggested task: ${item.suggestedTask}` : '',
    item.suggestedInvestorMaterial ? `\nInvestor material candidate: ${item.suggestedInvestorMaterial}` : '',
    item.riskNote ? `\nRisk note: ${item.riskNote}` : '',
  ].filter(Boolean).join('\n')
}

async function saveFindingToMemory(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'saved to Memory')) return
  savingMemoryId.value = item.id
  try {
    const current = await fetchMemory()
    const existing = current.memory?.trim() || ''
    const addition = formatResearchNoteMemory(item)
    await saveMemory('memory', existing ? `${existing}\n\n${addition}` : addition)
    message.success('Research note saved to Memory')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown memory save error'
    message.error(`Could not save research note: ${detail}`)
  } finally {
    savingMemoryId.value = ''
  }
}

async function createTask(item: ResearchReviewFinding) {
  if (blockRejectedFinding(item, 'turned into a task')) return
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
        <p class="section-help-text">Approve, reject, create tasks, or save notes from reviewed research only. Missing sources stay in source review until evidence arrives.</p>
      </div>
      <RouterLink class="header-link" :to="{ name: 'hermes.research' }">Research Library</RouterLink>
    </header>

    <section class="summary-strip" aria-label="Research review summary">
      <span>{{ researchJobs.length }} research jobs</span>
      <span>{{ pendingFindings.length }} pending findings</span>
      <span>{{ approvedFindings }} approved findings</span>
      <span>{{ sourceBackedFindings }} source-backed</span>
      <span>{{ appliedDashboardUpdates }} dashboard updates</span>
    </section>

    <section class="review-gate-strip" aria-label="Automatic research review gate">
      <article v-for="step in reviewGateSteps" :key="step.title" class="review-gate-card">
        <span class="review-gate-icon" aria-hidden="true">{{ step.icon }}</span>
        <div>
          <h3>{{ step.title }}</h3>
          <p>{{ step.detail }}</p>
        </div>
      </article>
    </section>

    <section class="review-queue-status-strip" aria-label="Review queue source and gate status">
      <article v-for="row in reviewQueueStatusRows" :key="row.label">
        <span>{{ row.label }}</span>
        <strong>{{ row.value }}</strong>
        <small>{{ row.detail }}</small>
      </article>
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
      <div v-for="job in researchJobs.slice(0, 6)" :key="job.id" class="job-row" :class="{ priority: researchJobPriority(job) >= 3 }">
        <div>
          <strong>{{ job.title }}</strong>
          <span>{{ job.status }} / {{ job.context }}<template v-if="job.schedulePreference"> / {{ job.schedulePreference }}</template></span>
          <small>{{ job.question }}</small>
          <small v-if="job.scope">Scope: {{ job.scope }}</small>
          <small v-if="job.expectedOutput">Expected output: {{ job.expectedOutput }}</small>
          <small v-if="job.sourceRequirements">Source requirements: {{ job.sourceRequirements }}</small>
          <small v-if="job.scheduledJobId">Hermes job: {{ job.scheduledJobId }}<template v-if="job.schedule"> / {{ job.schedule }}</template></small>
          <small v-if="jobOutputStatus[job.id]" class="job-output-status">{{ jobOutputStatus[job.id] }}</small>
        </div>
        <div class="job-actions">
          <NButton
            v-if="job.status === 'Later' || job.status === 'Manual Research Job'"
            size="tiny"
            secondary
            type="primary"
            :loading="schedulingJobId === job.id"
            @click="scheduleResearchJob(job)"
          >
            Schedule Hermes job
          </NButton>
          <NButton
            size="tiny"
            secondary
            :disabled="job.status === 'Task Created' || job.status === 'Scheduled Hermes Job'"
            :loading="creatingJobTaskId === job.id"
            @click="createResearchJobTask(job)"
          >
            {{ job.status === 'Scheduled Hermes Job' ? 'Hermes job scheduled' : job.status === 'Task Created' ? 'Task created' : 'Create research task' }}
          </NButton>
          <NButton size="tiny" secondary @click="useJobAsFindingDraft(job)">
            Use as finding draft
          </NButton>
          <NButton
            v-if="job.scheduledJobId"
            size="tiny"
            secondary
            type="primary"
            :loading="importingJobOutputId === job.id"
            @click="importLatestJobOutput(job)"
          >
            Import latest output
          </NButton>
        </div>
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
          <p>Approve selected updates, create tasks, or reject. Unsourced verified claims stay unapproved and in source review.</p>
        </div>
        <RouterLink :to="{ name: 'hermes.investorReadiness' }">Investor Readiness</RouterLink>
      </div>

      <p v-if="findings.length === 0" class="empty-state">
        No research findings staged yet.
      </p>

      <article
        v-for="item in findings"
        :key="item.id"
        class="finding-card"
        :class="{ critical: needsEvidenceReview(item) || isCriticalReviewFinding(item) }"
      >
        <div class="finding-main">
          <div class="finding-title">
            <h3>
              <span v-if="item.evidenceStatus === 'Missing' || item.evidenceStatus === 'To Verify' || !item.source?.title" class="priority-star" aria-label="Needs review"></span>
              {{ item.keyClaim }}
            </h3>
            <span class="status-badge" :class="item.status.toLowerCase().replace(/\s+/g, '-')">{{ item.status }}</span>
          </div>
          <p>{{ item.summary }}</p>
          <div class="finding-meta">
            <span>{{ areaLabel(item.area) }}</span>
            <span>{{ item.evidenceStatus }}</span>
            <span>Confidence: {{ item.confidence }}</span>
            <span>{{ item.source?.title || 'Source missing' }}</span>
            <span v-if="item.dashboardTarget">Target: {{ item.dashboardTarget.screen || item.dashboardTarget.group }} / {{ item.dashboardTarget.proposedDashboardField || item.dashboardTarget.field || 'dashboard evidence' }}</span>
            <span v-if="item.dashboardAppliedAt">Applied: {{ item.dashboardAppliedAt.slice(0, 10) }}</span>
          </div>
          <div
            v-if="item.dashboardTarget || item.source || item.riskReason || item.riskNote"
            class="target-review-panel"
            aria-label="Finding source and dashboard target details"
          >
            <div class="target-review-grid">
              <div v-for="row in reviewDetailRows(item)" :key="`${item.id}-${row.label}`" class="target-review-row">
                <span>{{ row.label }}</span>
                <a v-if="row.href" class="source-link" :href="row.href" target="_blank" rel="noreferrer noopener">{{ row.value }}</a>
                <strong v-else>{{ row.value }}</strong>
              </div>
            </div>
            <p v-if="isSupplierScorecardTarget(item)" class="target-warning">
              Supplier scorecard approval creates a durable supplierScorecards row plus a source-linked data-room audit copy. Commercial quote, payment, and score text remains review-gated unless explicitly approved for dashboard use.
            </p>
          </div>
          <small v-if="item.riskNote">Risk: {{ item.riskNote }}</small>
        </div>
        <div class="finding-actions">
          <NButton size="tiny" secondary type="primary" :disabled="item.status === 'Rejected'" @click="approveReadinessUpdate(item)">
            Approve selected updates
          </NButton>
          <NButton size="tiny" secondary :disabled="item.status === 'Rejected'" @click="addToInvestorDraft(item)">
            Add to investor draft
          </NButton>
          <NButton size="tiny" secondary :disabled="item.status === 'Rejected'" :loading="creatingTaskId === item.id" @click="createTask(item)">
            Create task
          </NButton>
          <NButton size="tiny" secondary :disabled="item.status === 'Rejected'" :loading="savingMemoryId === item.id" @click="saveFindingToMemory(item)">
            Save research note
          </NButton>
          <NButton
            v-if="item.area === 'market'"
            size="tiny"
            secondary
            :disabled="item.status === 'Rejected'"
            :loading="savingMarketClaimId === item.id"
            @click="saveAsMarketClaim(item)"
          >
            Save as market claim
          </NButton>
          <NButton
            v-if="isCompetitorFinding(item)"
            size="tiny"
            secondary
            :disabled="item.status === 'Rejected'"
            :loading="savingCompetitorId === item.id"
            @click="saveAsCompetitorRecord(item)"
          >
            Save as competitor record
          </NButton>
          <NButton
            size="tiny"
            secondary
            :disabled="item.status === 'Rejected'"
            :loading="savingDataRoomId === item.id"
            @click="saveAsDataRoomEvidence(item)"
          >
            Save as data-room evidence
          </NButton>
          <NButton size="tiny" quaternary :disabled="item.status === 'Rejected'" @click="markToVerify(item)">Mark To Verify</NButton>
          <NButton size="tiny" quaternary :disabled="item.status === 'Rejected'" @click="rejectFinding(item)">Reject</NButton>
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

.page-header,
.summary-strip,
.job-panel,
.finding-form,
.review-queue,
.finding-card {
  position: relative;
  overflow: hidden;
}

.summary-strip::before,
.job-panel::before,
.finding-form::before,
.review-queue::before,
.finding-card::before {
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

.review-gate-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.review-gate-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  min-height: 116px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.08), rgba(var(--accent-info-rgb), 0.04)),
    $bg-card;

  h3 {
    margin: 0 0 6px;
    color: $text-primary;
    font-size: 14px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.5;
  }
}

.review-gate-icon {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
  border-radius: 999px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  font-size: 17px;
}

.review-queue-status-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;

  article {
    display: grid;
    gap: 7px;
    min-height: 118px;
    padding: 13px;
    border: 1px solid rgba(var(--warning-rgb), 0.28);
    border-radius: $radius-sm;
    background:
      linear-gradient(135deg, rgba(var(--warning-rgb), 0.08), rgba(var(--accent-info-rgb), 0.035)),
      $bg-card;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $warning;
    font-size: 24px;
    line-height: 1.1;
  }

  small {
    overflow-wrap: anywhere;
    color: $text-secondary;
    line-height: 1.45;
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
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid $border-color;

  > div {
    display: grid;
    gap: 5px;
    min-width: 0;
  }

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

  .job-output-status {
    color: $accent-info;
    font-weight: 800;
  }

  &.priority {
    background: rgba(var(--accent-primary-rgb), 0.05);
  }
}

.job-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
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

  &.critical {
    border-color: rgba(var(--accent-primary-rgb), 0.34);
  }
}

.finding-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;

  h3 {
    display: flex;
    gap: 7px;
    align-items: center;
    margin: 0;
    color: $text-primary;
  }

  > .status-badge {
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

.target-review-panel {
  display: grid;
  gap: 8px;
  margin: 10px 0;
  padding: 10px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: $radius-sm;
  background: rgba(var(--accent-info-rgb), 0.06);
}

.target-review-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}

.target-review-row {
  display: grid;
  gap: 3px;
  min-width: 0;

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  strong,
  a {
    min-width: 0;
    color: $text-primary;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  a {
    color: $accent-info;
  }
}

.target-warning {
  margin: 0;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 800;
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

  .review-gate-strip,
  .review-queue-status-strip {
    grid-template-columns: 1fr;
  }

  .finding-actions {
    max-width: none;
    justify-content: flex-start;
  }

  .job-actions {
    justify-content: flex-start;
  }

  .job-row {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }
}
</style>
