<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence, type EvidenceArea } from '@/composables/useFeasibilityIntelligence'
import {
  buildInvestorPresentationDraft,
  buildInvestorSlideOutline,
  formatSourceReference,
  formatSourcedMarketShare,
  formatInvestorPresentationOutline,
  INVESTOR_PRESENTATION_SECTIONS,
  normalizedMarketClaimStatus,
  type IntelligenceEvidenceStatus,
} from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'
import { DEFAULT_KANBAN_BOARD, useKanbanStore } from '@/stores/hermes/kanban'
import { mkDir, writeFile } from '@/api/hermes/files'
import { shouldRedactForEmployee } from '@/utils/accessControl'

interface MissingOutputInput {
  id: string
  title: string
  status: IntelligenceEvidenceStatus | 'Missing / To Verify'
  detail: string
  to: { name: string }
}

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const kanbanStore = useKanbanStore()
const copiedOutline = ref(false)
const creatingMissingTaskId = ref('')
const savingDraftFile = ref(false)
const savingBriefFile = ref(false)
const latestDraftPath = ref('')
const latestBriefPath = ref('')
const redactSensitiveFields = computed(() => shouldRedactForEmployee())

const INVESTOR_DRAFT_DIR = 'investor-drafts'
const FEASIBILITY_BRIEF_DIR = 'feasibility-briefs'

const sections = [
  {
    title: 'Feasibility Reports',
    description: 'Prepare outlines and final report structure from verified assumptions, documents, tasks, and chat outputs.',
  },
  {
    title: 'Research Summaries',
    description: 'Turn saved research into concise summaries once sources and evidence gaps are clear.',
  },
  {
    title: 'Investor Preparation',
    description: 'Collect diligence questions, source lists, assumptions, and presentation talking points.',
  },
  {
    title: 'Presentation Drafts',
    description: 'Use this area to plan slide narratives before creating a real deck or exported document.',
  },
  {
    title: 'Usage Analytics',
    description: 'Open existing Hermes usage pages for token/session analytics. This is not business performance data.',
  },
]

const links = [
  { label: 'Investor Readiness', to: { name: 'hermes.investorReadiness' } },
  { label: 'IRR Calculator', to: { name: 'hermes.investmentCalculator' } },
  { label: 'Presentation Builder', to: { name: 'hermes.investorPresentation' } },
  { label: 'Usage', to: { name: 'hermes.usage' } },
  { label: 'Skills Usage', to: { name: 'hermes.skillsUsage' } },
  { label: 'Documents', to: { name: 'hermes.files' } },
  { label: 'Chat', to: { name: 'hermes.chat' } },
]

const evidenceRouteByArea: Record<EvidenceArea, string> = {
  companyLegal: 'hermes.files',
  product: 'hermes.files',
  factory: 'hermes.kanban',
  regulatory: 'hermes.researchResultReview',
  market: 'hermes.marketIntelligence',
  financial: 'hermes.investmentCalculator',
  presentation: 'hermes.investorPresentation',
}

const slideDrafts = computed(() =>
  buildInvestorSlideOutline(INVESTOR_PRESENTATION_SECTIONS, intelligence.state.value.presentationMaterials),
)
const approvedDraftSections = computed(() =>
  buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials),
)
const readySlideCount = computed(() => slideDrafts.value.filter(slide => slide.status === 'Ready').length)
const missingSlides = computed(() => slideDrafts.value.filter(slide => slide.status !== 'Ready').slice(0, 5))
const latestFinancialModel = intelligence.latestFinancialModel
const evidenceGaps = intelligence.evidenceGaps
const pendingResearchFindings = intelligence.pendingResearchFindings
const riskRegisterItems = intelligence.riskRegisterItems

const statusCounts = computed(() =>
  intelligence.state.value.evidenceItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.evidenceStatus] = (acc[item.evidenceStatus] || 0) + 1
    return acc
  }, {}),
)

const outputStats = computed(() => [
  {
    label: 'Investor readiness',
    value: `${intelligence.readinessScore.value}%`,
    detail: 'Evidence-status based',
    to: { name: 'hermes.investorReadiness' },
  },
  {
    label: 'Deck sections ready',
    value: `${readySlideCount.value}/${INVESTOR_PRESENTATION_SECTIONS.length}`,
    detail: 'Approved material only',
    to: { name: 'hermes.investorPresentation' },
  },
  {
    label: 'Financial snapshot',
    value: latestFinancialModel.value?.scenarioName || 'None',
    detail: latestFinancialModel.value?.evidenceStatus || 'Save a scenario first',
    to: { name: 'hermes.investmentCalculator' },
  },
  {
    label: 'Research review',
    value: String(pendingResearchFindings.value.length),
    detail: pendingResearchFindings.value.length ? 'Needs approval' : 'No pending findings',
    to: { name: 'hermes.researchResultReview' },
  },
])

const missingOutputInputs = computed<MissingOutputInput[]>(() => [
  ...pendingResearchFindings.value.slice(0, 3).map(item => ({
    id: `finding-${item.id}`,
    title: item.keyClaim,
    status: item.evidenceStatus,
    detail: item.summary || 'Review this research finding before using it in reports or investor material.',
    to: { name: 'hermes.researchResultReview' },
  })),
  ...evidenceGaps.value.slice(0, 4).map(item => ({
    id: `evidence-${item.id}`,
    title: item.label,
    status: item.evidenceStatus,
    detail: item.nextAction,
    to: { name: evidenceRouteByArea[item.id] },
  })),
  ...missingSlides.value.slice(0, 4).map(slide => ({
    id: `slide-${slide.section}`,
    title: `${slide.section} slide`,
    status: 'Missing / To Verify' as const,
    detail: slide.missingAction,
    to: { name: 'hermes.investorPresentation' },
  })),
].slice(0, 7))

function statusClass(status: IntelligenceEvidenceStatus | 'Missing / To Verify'): string {
  if (status === 'Verified' || status === 'User Approved' || status === 'User Provided') return 'ready'
  if (status === 'Approved Assumption' || status === 'Derived from Assumptions' || status === 'Assumption') return 'assumption'
  return 'missing'
}

function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Not calculable'
  return `${(value * 100).toFixed(1)}%`
}

function financialDisplay(value: string): string {
  return redactSensitiveFields.value ? 'Restricted' : value
}

async function copyApprovedOutline() {
  const text = formatInvestorPresentationOutline(slideDrafts.value)
  copiedOutline.value = await copyToClipboard(text)
  if (copiedOutline.value) message.success('Approved investor outline copied')
  else message.warning('Clipboard blocked. Use Presentation Builder for manual copy.')
}

function draftTimestamp(date = new Date()): string {
  return date.toISOString().replace('T', '-').replace(/[:.]/g, '-').slice(0, 19)
}

function approvedDraftFilePath(): string {
  return `${INVESTOR_DRAFT_DIR}/chemicon-investor-draft-${draftTimestamp()}.md`
}

function feasibilityBriefFilePath(): string {
  return `${FEASIBILITY_BRIEF_DIR}/chemicon-feasibility-evidence-brief-${draftTimestamp()}.md`
}

function formatSource(source?: { title: string, url?: string, date?: string } | null): string {
  return source ? formatSourceReference(source) : 'Source missing'
}

function linesOrEmpty(lines: string[], fallback: string): string[] {
  return lines.length ? lines : [fallback]
}

function buildApprovedDraftMarkdown(): string {
  return [
    '# Chemicon Investor Presentation Draft',
    '',
    'Generated from approved material only. This is draft text, not final truth.',
    'Evidence rule: only verified, user-approved, approved-assumption, or derived-from-assumptions material is included.',
    `Created: ${new Date().toISOString()}`,
    'Source: Hermes Reports Hub',
    '',
    formatInvestorPresentationOutline(slideDrafts.value),
  ].join('\n')
}

function buildFeasibilityBriefMarkdown(): string {
  const readinessLines = intelligence.state.value.evidenceItems.flatMap(item => [
    `### ${item.label}`,
    `Evidence status: ${item.evidenceStatus}`,
    `Source trace: ${formatSource(item.source)}`,
    `Description: ${item.description}`,
    `Next action: ${item.nextAction}`,
    '',
  ])

  const approvedMaterialLines = approvedDraftSections.value.flatMap(item => [
    `### ${item.section}`,
    `Evidence status: ${item.evidenceStatus}`,
    `Source: ${item.sourceDetail || item.sourceLabel}`,
    item.content,
    '',
  ])

  const marketClaimLines = intelligence.state.value.marketClaims.flatMap(claim => [
    `### ${claim.label}`,
    `Evidence status: ${normalizedMarketClaimStatus(claim)}`,
    `Value / claim text: ${claim.value || 'To Verify'}`,
    `Source: ${formatSource(claim.source)}`,
    `Confidence: ${claim.confidence || 'medium'}`,
    `Last checked: ${claim.lastChecked || 'Not recorded'}`,
    '',
  ])

  const competitorLines = intelligence.state.value.competitors.flatMap(competitor => [
    `### ${competitor.companyName}`,
    `Evidence status: ${competitor.evidenceStatus}`,
    `Country / region: ${competitor.countryRegion || 'To Verify'}`,
    `Product equivalent: ${competitor.productEquivalent || 'To Verify'}`,
    `Active content: ${competitor.activeContent || 'To Verify'}`,
    `Pricing evidence: ${redactSensitiveFields.value ? 'Restricted' : competitor.pricingEvidence || 'To Verify'}`,
    `Market share: ${formatSourcedMarketShare(competitor.marketShare, competitor.source, competitor.evidenceStatus)}`,
    `Source: ${formatSource(competitor.source)}`,
    `Notes: ${competitor.notes || 'No notes saved.'}`,
    '',
  ])

  const dataRoomLines = intelligence.state.value.dataRoomSources.flatMap(record => [
    `### ${record.checklistLabel}`,
    `Area: ${record.area}`,
    `Evidence status: ${record.evidenceStatus}`,
    `Source: ${formatSource(record.source)}`,
    `Notes: ${record.notes || 'No review note saved.'}`,
    `Updated: ${record.updatedAt}`,
    '',
  ])

  const riskLines = riskRegisterItems.value.flatMap(item => [
    `### ${item.title}`,
    `Origin: ${item.origin}`,
    `Area: ${item.area}`,
    `Evidence status: ${item.evidenceStatus}`,
    `Priority: ${item.priority}`,
    `Risk detail: ${item.detail}`,
    '',
  ])

  const researchLines = pendingResearchFindings.value.flatMap(item => [
    `### ${item.keyClaim}`,
    `Status: ${item.status}`,
    `Evidence status: ${item.evidenceStatus}`,
    `Confidence: ${item.confidence}`,
    `Source: ${formatSource(item.source)}`,
    `Summary: ${item.summary}`,
    item.riskNote ? `Risk note: ${item.riskNote}` : '',
    '',
  ].filter(Boolean))

  const financialLines = latestFinancialModel.value
    ? [
        `Scenario: ${latestFinancialModel.value.scenarioName}`,
        `Evidence status: ${latestFinancialModel.value.evidenceStatus}`,
        `NPV: ${financialDisplay(formatCurrency(latestFinancialModel.value.npv, latestFinancialModel.value.currency))}`,
        `IRR: ${financialDisplay(formatPercent(latestFinancialModel.value.irr))}`,
        `Payback: ${financialDisplay(latestFinancialModel.value.paybackYear ? `Year ${latestFinancialModel.value.paybackYear}` : 'Not reached')}`,
        `Capex total: ${financialDisplay(formatCurrency(latestFinancialModel.value.capexTotal, latestFinancialModel.value.currency))}`,
        `Year 1 revenue: ${financialDisplay(formatCurrency(latestFinancialModel.value.yearOneRevenue, latestFinancialModel.value.currency))}`,
        `Source: ${formatSource(latestFinancialModel.value.source)}`,
        latestFinancialModel.value.warnings.length
          ? `Warnings: ${latestFinancialModel.value.warnings.join('; ')}`
          : 'Warnings: none recorded',
      ]
    : ['No financial model snapshot has been saved yet.']

  return [
    '# Chemicon China Feasibility Evidence Brief',
    '',
    'Generated from the current Hermes feasibility intelligence workspace.',
    'This is a working evidence brief, not final truth and not an investor claim pack.',
    'Every item keeps its evidence status. Missing, To Verify, Hypothesis, and Reference Only items must remain out of investor claims.',
    'Financial outputs are derived from assumptions unless their inputs are source-backed or explicitly approved.',
    `Created: ${new Date().toISOString()}`,
    'Project: Chemicon China Feasibility',
    'Planning scope: Year 1 15,000 MT feasibility; 60,000 MT scale-up remains a scenario until validated.',
    '',
    '## Readiness Summary',
    '',
    `Investor readiness score: ${intelligence.readinessScore.value}%`,
    `Verified: ${statusCounts.value.Verified || 0}`,
    `User Approved: ${statusCounts.value['User Approved'] || 0}`,
    `User Provided: ${statusCounts.value['User Provided'] || 0}`,
    `Approved Assumption: ${statusCounts.value['Approved Assumption'] || 0}`,
    `Assumption: ${statusCounts.value.Assumption || 0}`,
    `Derived from Assumptions: ${statusCounts.value['Derived from Assumptions'] || 0}`,
    `To Verify: ${statusCounts.value['To Verify'] || 0}`,
    `Missing: ${statusCounts.value.Missing || 0}`,
    '',
    '## Readiness Evidence Matrix',
    '',
    ...readinessLines,
    '## Latest Financial Snapshot',
    '',
    ...financialLines,
    '',
    '## Approved Investor Draft Material',
    '',
    ...linesOrEmpty(approvedMaterialLines, 'No approved investor draft material is ready yet.'),
    '',
    '## Market Claims',
    '',
    ...linesOrEmpty(marketClaimLines, 'No market intelligence claims have been saved yet.'),
    '',
    '## Competitor Intelligence',
    '',
    ...linesOrEmpty(competitorLines, 'No competitor intelligence records have been saved yet.'),
    '',
    '## Data-Room Sources',
    '',
    ...linesOrEmpty(dataRoomLines, 'No data-room source records have been saved yet.'),
    '',
    '## Investor Risk Register',
    '',
    ...linesOrEmpty(riskLines, 'No current investor risks are recorded in the local intelligence state.'),
    '',
    '## Research Review Queue',
    '',
    ...linesOrEmpty(researchLines, 'No pending research findings are waiting for review.'),
    '',
    '## Use Rules',
    '',
    '- Do not convert this brief into final investor material without reviewing each source.',
    '- Do not use Missing, To Verify, Hypothesis, or Reference Only items as investor claims.',
    '- Keep assumptions visibly labeled unless source evidence upgrades them.',
    '- Unknown competitor market share must remain To Verify.',
    '- Generated IRR, NPV, payback, revenue, and return outputs are derived model outputs.',
  ].join('\n')
}

async function saveApprovedDraftFile() {
  if (savingDraftFile.value) return

  if (!approvedDraftSections.value.length) {
    message.warning('No approved investor material is ready to save yet.')
    return
  }

  savingDraftFile.value = true
  try {
    await mkDir(INVESTOR_DRAFT_DIR)
    const path = approvedDraftFilePath()
    await writeFile(path, buildApprovedDraftMarkdown())
    latestDraftPath.value = path
    intelligence.addDataRoomSource({
      checklistLabel: 'Investor presentation draft file',
      area: 'presentation',
      evidenceStatus: 'User Approved',
      source: {
        title: path,
        date: new Date().toISOString().slice(0, 10),
      },
      notes: [
        'Saved from Reports Hub after user action.',
        'This is a generated Markdown draft file, not final truth.',
        'Only approved, verified, or assumption-labeled draft sections are included.',
        'Each section in the file keeps its own evidence status and source trace.',
      ].join('\n'),
    })
    message.success('Approved investor draft saved to Documents')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown file error'
    message.error(`Could not save investor draft file: ${detail}`)
  } finally {
    savingDraftFile.value = false
  }
}

async function saveFeasibilityBriefFile() {
  if (savingBriefFile.value) return

  savingBriefFile.value = true
  try {
    await mkDir(FEASIBILITY_BRIEF_DIR)
    const path = feasibilityBriefFilePath()
    await writeFile(path, buildFeasibilityBriefMarkdown())
    latestBriefPath.value = path
    message.success('Feasibility evidence brief saved to Documents')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown file error'
    message.error(`Could not save feasibility brief: ${detail}`)
  } finally {
    savingBriefFile.value = false
  }
}

function missingInputTaskBody(item: MissingOutputInput): string {
  return [
    `Report / investor output missing input: ${item.title}`,
    `Current evidence status: ${item.status}`,
    `Recommended action: ${item.detail}`,
    `Source page: Reports Hub / Before Investor Use`,
    'Tags: Reports Hub, Investor Output, Evidence Gap, Chemicon China Feasibility',
    '',
    'Do not use this in investor material until the source evidence is attached, the finding is reviewed, or the assumption is explicitly approved and labeled.',
  ].join('\n')
}

function priorityForMissingInput(item: MissingOutputInput): number {
  if (item.status === 'Missing' || item.status === 'To Verify' || item.status === 'Missing / To Verify' || item.status === 'Hypothesis') return 3
  return 2
}

async function createMissingInputTask(item: MissingOutputInput) {
  creatingMissingTaskId.value = item.id
  try {
    await kanbanStore.fetchBoards()
    const board = kanbanStore.resolveAvailableBoard(kanbanStore.selectedBoard || DEFAULT_KANBAN_BOARD)
    kanbanStore.setSelectedBoard(board)
    await kanbanStore.createTask({
      title: `Report input evidence: ${item.title}`,
      body: missingInputTaskBody(item),
      priority: priorityForMissingInput(item),
      tenant: 'Chemicon China Feasibility',
    })
    message.success('Report input task created in Kanban')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown task error'
    message.error(`Could not create report input task: ${detail}`)
  } finally {
    creatingMissingTaskId.value = ''
  }
}
</script>

<template>
  <div class="workspace-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">Reports Hub</p>
        <h2 class="header-title">Reports and Presentation Preparation</h2>
        <p class="page-copy">
          Live output hub for feasibility reports and investor presentation preparation. It only surfaces approved,
          verified, or clearly assumption-labeled material from the shared feasibility intelligence workspace.
        </p>
      </div>
      <div class="quick-actions">
        <RouterLink v-for="link in links" :key="link.label" class="shell-link" :to="link.to">{{ link.label }}</RouterLink>
      </div>
    </header>

    <section class="output-state-grid" aria-label="Live report readiness">
      <RouterLink v-for="item in outputStats" :key="item.label" class="output-stat-card" :to="item.to">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <small>{{ item.detail }}</small>
      </RouterLink>
    </section>

    <section class="report-workbench" aria-label="Report preparation workbench">
      <article class="report-panel approved-material">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Approved draft material</p>
            <h3>Investor Output Draft</h3>
          </div>
          <div class="panel-actions">
            <NButton size="small" secondary type="primary" @click="copyApprovedOutline">
              {{ copiedOutline ? 'Copied' : 'Copy approved outline' }}
            </NButton>
            <NButton
              size="small"
              secondary
              type="primary"
              :disabled="!approvedDraftSections.length"
              :loading="savingDraftFile"
              @click="saveApprovedDraftFile"
            >
              Save draft file
            </NButton>
            <NButton
              size="small"
              secondary
              :loading="savingBriefFile"
              @click="saveFeasibilityBriefFile"
            >
              Save feasibility brief
            </NButton>
          </div>
        </div>
        <div v-if="approvedDraftSections.length" class="record-list">
          <article v-for="item in approvedDraftSections.slice(0, 5)" :key="`${item.section}-${item.content}`" class="record-row">
            <div>
              <strong>{{ item.section }}</strong>
              <p>{{ item.content }}</p>
              <small>{{ item.sourceDetail }}</small>
            </div>
            <span class="record-status" :class="statusClass(item.evidenceStatus)">{{ item.evidenceStatus }}</span>
          </article>
        </div>
        <p v-else class="empty-state">
          No investor-safe draft material yet. Stage material in Investor Readiness, Research Review, IRR Calculator,
          or Presentation Builder after approval.
        </p>
        <p v-if="latestDraftPath" class="draft-file-note">
          Saved to Documents: <code>{{ latestDraftPath }}</code>
        </p>
        <p v-if="latestBriefPath" class="draft-file-note">
          Feasibility brief saved to Documents: <code>{{ latestBriefPath }}</code>
        </p>
        <RouterLink class="shell-link" :to="{ name: 'hermes.investorPresentation' }">Open Presentation Builder</RouterLink>
      </article>

      <article class="report-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Missing inputs</p>
            <h3>Before Investor Use</h3>
          </div>
          <RouterLink class="shell-link" :to="{ name: 'hermes.investorReadiness' }">Readiness</RouterLink>
        </div>
        <div v-if="missingOutputInputs.length" class="record-list">
          <article v-for="item in missingOutputInputs" :key="item.id" class="record-row action-row">
            <RouterLink class="record-main" :to="item.to">
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </RouterLink>
            <div class="record-actions">
              <span class="record-status" :class="statusClass(item.status)">{{ item.status }}</span>
              <NButton
                size="tiny"
                secondary
                :loading="creatingMissingTaskId === item.id"
                @click="createMissingInputTask(item)"
              >
                Create task
              </NButton>
            </div>
          </article>
        </div>
        <p v-else class="empty-state">No missing report inputs found in the current local intelligence state.</p>
      </article>
    </section>

    <section class="financial-output-panel" aria-label="Financial model output status">
      <div>
        <p class="eyebrow">Financial output</p>
        <h3>Latest IRR / NPV Snapshot</h3>
        <p>
          Financial outputs remain derived from assumptions unless every input is source-backed or explicitly approved.
        </p>
      </div>
      <div v-if="latestFinancialModel" class="financial-metrics">
        <article>
          <span>Scenario</span>
          <strong>{{ latestFinancialModel.scenarioName }}</strong>
          <small>{{ latestFinancialModel.evidenceStatus }}</small>
        </article>
        <article>
          <span>NPV</span>
          <strong>{{ financialDisplay(formatCurrency(latestFinancialModel.npv, latestFinancialModel.currency)) }}</strong>
          <small>Derived model output</small>
        </article>
        <article>
          <span>IRR</span>
          <strong>{{ financialDisplay(formatPercent(latestFinancialModel.irr)) }}</strong>
          <small>Derived model output</small>
        </article>
        <article>
          <span>Payback</span>
          <strong>{{ financialDisplay(latestFinancialModel.paybackYear ? `Year ${latestFinancialModel.paybackYear}` : 'Not reached') }}</strong>
          <small>{{ latestFinancialModel.warnings.length }} warning{{ latestFinancialModel.warnings.length === 1 ? '' : 's' }}</small>
        </article>
      </div>
      <p v-else class="empty-state">
        No saved financial snapshot yet. Use the IRR Calculator to save a scenario before discussing investor return.
      </p>
      <div v-if="latestFinancialModel?.warnings.length" class="warning-list">
        <strong>Warnings</strong>
        <ul>
          <li v-for="warning in latestFinancialModel.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </div>
      <RouterLink class="shell-link" :to="{ name: 'hermes.investmentCalculator' }">Open IRR Calculator</RouterLink>
    </section>

    <section class="section-grid" aria-label="Report sections">
      <article v-for="section in sections" :key="section.title" class="workspace-card">
        <h3>{{ section.title }}</h3>
        <p>{{ section.description }}</p>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.workspace-shell {
  min-height: var(--app-content-height, calc(100 * var(--vh)));
  padding: 18px;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: start;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0 0 8px;
  color: $accent-primary;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.page-copy {
  max-width: 760px;
  margin: 8px 0 0;
  color: $text-secondary;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.output-state-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.output-stat-card {
  display: grid;
  gap: 6px;
  min-height: 112px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
  color: inherit;
  text-decoration: none;

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    overflow-wrap: anywhere;
    color: $accent-primary;
    font-size: 24px;
    line-height: 1.08;
  }

  &:hover {
    border-color: $accent-info;
    background: rgba(var(--accent-info-rgb), 0.06);
  }
}

.report-workbench {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.report-panel,
.financial-output-panel {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;

  h3 {
    margin: 0;
    color: $text-primary;
    font-size: 18px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.panel-head {
  display: flex;
  gap: 12px;
  align-items: start;
  justify-content: space-between;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.record-list {
  display: grid;
  gap: 8px;
}

.record-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-panel;
  color: inherit;
  text-decoration: none;

  strong {
    color: $text-primary;
  }

  p {
    margin: 5px 0;
  }

  small {
    color: $text-muted;
  }
}

.record-main {
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.record-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.record-status {
    border: 1px solid $border-color;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 900;
    white-space: nowrap;
    text-transform: uppercase;

    &.ready {
      color: $success;
      border-color: rgba(var(--success-rgb), 0.35);
    }

    &.assumption {
      color: $warning;
      border-color: rgba(var(--warning-rgb), 0.35);
    }

    &.missing {
      color: $error;
      border-color: rgba(var(--error-rgb), 0.35);
    }
}

.empty-state {
  color: $text-secondary;
  line-height: 1.55;
}

.draft-file-note {
  padding: 10px;
  border: 1px solid rgba(var(--success-rgb), 0.3);
  border-radius: $radius-sm;
  background: rgba(var(--success-rgb), 0.06);
  color: $text-secondary;

  code {
    color: $success;
    overflow-wrap: anywhere;
  }
}

.financial-output-panel {
  margin-bottom: 18px;
}

.financial-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid $border-color;
    border-radius: $radius-sm;
    background: $bg-panel;
  }

  span,
  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $text-primary;
    font-size: 17px;
    overflow-wrap: anywhere;
  }
}

.warning-list {
  padding: 12px;
  border: 1px solid rgba(var(--warning-rgb), 0.35);
  border-radius: $radius-sm;
  background: rgba(var(--warning-rgb), 0.06);

  strong {
    color: $warning;
  }

  ul {
    margin: 8px 0 0;
    padding-left: 18px;
    color: $text-secondary;
  }
}

.shell-link {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  padding: 0 12px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  color: $accent-info;
  font-weight: 800;
  text-decoration: none;

  &:hover {
    border-color: $accent-info;
    color: $accent-info-hover;
    background: rgba(var(--accent-info-rgb), 0.08);
  }
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}

.workspace-card {
  min-height: 145px;
  padding: 16px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;

  h3 {
    margin: 0 0 8px;
    color: $text-primary;
    font-size: 16px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

@media (max-width: 720px) {
  .page-header {
    grid-template-columns: 1fr;
  }

  .output-state-grid,
  .report-workbench,
  .financial-metrics {
    grid-template-columns: 1fr;
  }

  .panel-head {
    flex-direction: column;
  }

  .quick-actions {
    justify-content: flex-start;
  }
}
</style>
