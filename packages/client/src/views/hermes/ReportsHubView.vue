<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useFeasibilityIntelligence, type EvidenceArea } from '@/composables/useFeasibilityIntelligence'
import {
  buildInvestorPresentationDraft,
  buildInvestorSlideOutline,
  formatInvestorPresentationOutline,
  INVESTOR_PRESENTATION_SECTIONS,
  type IntelligenceEvidenceStatus,
} from '@/utils/investorIntelligence'
import { copyToClipboard } from '@/utils/clipboard'

const message = useMessage()
const intelligence = useFeasibilityIntelligence()
const copiedOutline = ref(false)

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

const missingOutputInputs = computed(() => [
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

async function copyApprovedOutline() {
  const text = formatInvestorPresentationOutline(slideDrafts.value)
  copiedOutline.value = await copyToClipboard(text)
  if (copiedOutline.value) message.success('Approved investor outline copied')
  else message.warning('Clipboard blocked. Use Presentation Builder for manual copy.')
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
          <NButton size="small" secondary type="primary" @click="copyApprovedOutline">
            {{ copiedOutline ? 'Copied' : 'Copy approved outline' }}
          </NButton>
        </div>
        <div v-if="approvedDraftSections.length" class="record-list">
          <article v-for="item in approvedDraftSections.slice(0, 5)" :key="`${item.section}-${item.content}`" class="record-row">
            <div>
              <strong>{{ item.section }}</strong>
              <p>{{ item.content }}</p>
              <small>{{ item.sourceDetail }}</small>
            </div>
            <span :class="statusClass(item.evidenceStatus)">{{ item.evidenceStatus }}</span>
          </article>
        </div>
        <p v-else class="empty-state">
          No investor-safe draft material yet. Stage material in Investor Readiness, Research Review, IRR Calculator,
          or Presentation Builder after approval.
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
          <RouterLink v-for="item in missingOutputInputs" :key="item.id" class="record-row" :to="item.to">
            <div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detail }}</p>
            </div>
            <span :class="statusClass(item.status)">{{ item.status }}</span>
          </RouterLink>
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
          <strong>{{ formatCurrency(latestFinancialModel.npv, latestFinancialModel.currency) }}</strong>
          <small>Derived model output</small>
        </article>
        <article>
          <span>IRR</span>
          <strong>{{ formatPercent(latestFinancialModel.irr) }}</strong>
          <small>Derived model output</small>
        </article>
        <article>
          <span>Payback</span>
          <strong>{{ latestFinancialModel.paybackYear ? `Year ${latestFinancialModel.paybackYear}` : 'Not reached' }}</strong>
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

  > span {
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
}

.empty-state {
  color: $text-secondary;
  line-height: 1.55;
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
