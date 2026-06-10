<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NDrawer, NDrawerContent, NTag, useMessage } from 'naive-ui'
import { useJobsStore } from '@/stores/hermes/jobs'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import { useTrustedSourceAutopilot } from '@/composables/useTrustedSourceAutopilot'
import {
  canAccessRouteName,
  getFrontendAccessRole,
  restrictedFieldLabel,
  shouldRedactForEmployee,
} from '@/utils/accessControl'
import {
  EXECUTIVE_REFRESH_SCHEDULE,
  nextTwiceDailyRefresh,
} from '@/utils/executiveIntelligence'
import {
  isSensitiveAutopilotDataType,
  type AutopilotScreen,
  type TrustedSourceSnapshotClaim,
} from '@/utils/trustedSources'
import {
  displayAutomaticVerificationText,
  displayEvidenceStatus,
  displayUnresolvedValue,
  type IntelligenceEvidenceStatus,
} from '@/utils/investorIntelligence'

const props = defineProps<{
  screen: AutopilotScreen
  title?: string
  compact?: boolean
}>()

const message = useMessage()
const jobsStore = useJobsStore()
const autopilot = useTrustedSourceAutopilot()
const intelligence = useFeasibilityIntelligence()
const drawerOpen = ref(false)
const saving = ref(false)
const selectedClaim = ref<TrustedSourceSnapshotClaim | null>(null)
const frontendRole = computed(() => getFrontendAccessRole())
const redactsSensitiveClaims = computed(() => shouldRedactForEmployee(frontendRole.value) || frontendRole.value !== 'owner')

const screenSnapshots = computed(() => autopilot.snapshotsForScreen(props.screen))
const latestSnapshot = computed(() => autopilot.lastSnapshotForScreen(props.screen))
const visibleSnapshotClaims = computed(() => (latestSnapshot.value?.claims || []).filter(claim => !claimRestrictedForRole(claim)))
const activeSources = computed(() => autopilot.activeSourcesForScreen(props.screen))
const needsReviewCount = computed(() => screenSnapshots.value.filter(snapshot => snapshot.review_required || snapshot.conflicts.length).length)
const lastSuccessfulRefresh = computed(() => latestSnapshot.value?.generated_at || null)
const lastFailedRefresh = computed(() => activeSources.value.find(source => source.last_failure)?.last_failure || null)
const nextRefresh = computed(() => nextTwiceDailyRefresh())
const sourceStatusLabel = computed(() => activeSources.value.length ? 'On' : 'Off')
const pendingReviewFindings = computed(() =>
  intelligence.state.value.researchFindings.filter(finding =>
    (finding.status === 'Pending Review' || finding.status === 'To Verify') && findingMatchesScreen(finding),
  ),
)
const durableRecordMetrics = computed(() => metricsForScreen())
const durableRecordTotal = computed(() => durableRecordMetrics.value.reduce((total, metric) => total + metric.count, 0))
const durableStatusText = computed(() => {
  if (durableRecordTotal.value > 0) {
    return `${durableRecordTotal.value} imported dashboard record${durableRecordTotal.value === 1 ? '' : 's'} visible on this screen.`
  }
  if (latestSnapshot.value?.claims.length) {
    return 'Source snapshots exist for this screen, but no durable dashboard records have been saved yet.'
  }
  return 'Waiting for the first trusted-source import for this screen.'
})
const screenActionSummary = computed(() => {
  const reviewCount = pendingReviewFindings.value.length || needsReviewCount.value
  if (reviewCount > 0) {
    return {
      tone: 'review',
      icon: '🧾',
      eyebrow: 'Your next action',
      title: 'Review staged evidence',
      detail: `Hermes found ${reviewCount} review-gated item${reviewCount === 1 ? '' : 's'} for this screen. Approve only source-backed items you trust; weak, sensitive, or investor-impacting claims stay out of the dashboard until reviewed.`,
      primary: 'Review staged findings',
      secondary: 'Source controls',
      primaryRoute: { name: 'hermes.researchResultReview' },
      secondaryRoute: { name: 'hermes.trustedSources' },
      sync: false,
    }
  }

  if (durableRecordTotal.value > 0) {
    return {
      tone: 'filled',
      icon: '📊',
      eyebrow: 'Automatic filling',
      title: 'Dashboard data is filling itself',
      detail: `${durableRecordTotal.value} source-backed record${durableRecordTotal.value === 1 ? ' is' : 's are'} already visible here. Keep using the screen; Hermes continues researching in the background and sends risky values to review.`,
      primary: 'View review queue',
      secondary: 'Trusted Sources',
      primaryRoute: { name: 'hermes.researchResultReview' },
      secondaryRoute: { name: 'hermes.trustedSources' },
      sync: false,
    }
  }

  if (activeSources.value.length > 0) {
    return {
      tone: 'waiting',
      icon: '🔎',
      eyebrow: 'No manual web searching',
      title: 'Hermes is watching trusted sources',
      detail: 'Official-first sources are connected. Unsupported values stay out of dashboard truth until Hermes imports source-backed output or stages a review item.',
      primary: 'Run source check',
      secondary: 'Trusted Sources',
      primaryRoute: null,
      secondaryRoute: { name: 'hermes.trustedSources' },
      sync: true,
    }
  }

  return {
    tone: 'setup',
    icon: '🛟',
    eyebrow: 'Setup needed',
    title: 'Connect automatic research',
    detail: 'This screen has no active trusted sources yet. Open Trusted Sources to repair the full-dashboard autopilot and source registry.',
    primary: 'Repair auto research',
    secondary: 'View review queue',
    primaryRoute: { name: 'hermes.trustedSources' },
    secondaryRoute: { name: 'hermes.researchResultReview' },
    sync: false,
  }
})
const simpleAutopilotCards = computed(() => [
  {
    icon: '🌐',
    label: 'Auto research',
    value: sourceStatusLabel.value,
    note: activeSources.value.length
      ? `${activeSources.value.length} trusted sources ready`
      : 'waiting for source setup',
  },
  {
    icon: '📥',
    label: 'Safe records',
    value: String(durableRecordTotal.value),
    note: durableRecordTotal.value
      ? 'visible on this screen'
      : 'filled after source import',
  },
  {
    icon: '🧾',
    label: 'Review gate',
    value: String(pendingReviewFindings.value.length || needsReviewCount.value),
    note: 'risky claims wait here',
  },
])

const simpleFlowSteps = [
  {
    icon: '🔎',
    title: 'Hermes researches',
    detail: 'Official-first sources run in the background for this dashboard area.',
  },
  {
    icon: '📥',
    title: 'Safe facts fill',
    detail: 'Low-risk source-backed records can appear here with source, date, confidence, and evidence labels.',
  },
  {
    icon: '🧾',
    title: 'You review risky',
    detail: 'Market size, price, share, finance, regulatory, and investor claims stay staged until approved.',
  },
] as const

type DurableMetricTone = 'active' | 'review' | 'empty'

interface DurableMetric {
  label: string
  count: number
  note: string
  tone: DurableMetricTone
}

function findingMatchesScreen(finding: typeof intelligence.state.value.researchFindings[number]): boolean {
  const target = finding.dashboardTarget
  if (target?.screen === props.screen) return true
  const group = target?.group
  if (props.screen === 'market') {
    return finding.area === 'market' || group === 'marketClaims' || group === 'rawMaterialSignals'
  }
  if (props.screen === 'competitor') {
    return group === 'competitorRecords' || /competitor|market share|supplier landscape/i.test(`${finding.keyClaim} ${finding.summary}`)
  }
  if (props.screen === 'investment') {
    return finding.area === 'financial' || group === 'financialEvidence' || /irr|npv|investment|payback|capex|financial/i.test(`${finding.keyClaim} ${finding.summary}`)
  }
  return Boolean(group) ||
    finding.area === 'presentation' ||
    finding.area === 'companyLegal' ||
    finding.area === 'factory' ||
    finding.area === 'regulatory'
}

function dataRoomMatchesScreen(record: typeof intelligence.state.value.dataRoomSources[number]): boolean {
  if (props.screen === 'investment') return record.dashboardGroup === 'financialEvidence' || record.area === 'financial'
  if (props.screen === 'competitor') return record.dashboardGroup === 'competitorRecords'
  if (props.screen === 'market') return record.dashboardGroup === 'rawMaterialSignals' || record.area === 'market'
  if (props.screen === 'rawMaterials') return record.dashboardGroup === 'rawMaterialSignals' || record.dashboardGroup === 'supplierScorecards' || record.area === 'factory'
  return true
}

function metric(label: string, count: number, note: string, tone: DurableMetricTone = count ? 'active' : 'empty'): DurableMetric {
  return { label, count, note, tone }
}

function metricsForScreen(): DurableMetric[] {
  if (props.screen === 'market') {
    return [
      metric('Market claims', intelligence.state.value.marketClaims.length, 'Country, demand, growth, customer, and source-backed market signals.'),
      metric('Trade / raw material signals', intelligence.state.value.dataRoomSources.filter(dataRoomMatchesScreen).length, 'Source records that can support market and supply context.'),
      metric('Needs review', pendingReviewFindings.value.length, 'Weak, conflicting, critical, or sensitive market findings waiting for approval.', pendingReviewFindings.value.length ? 'review' : 'empty'),
    ]
  }

  if (props.screen === 'rawMaterials') {
    return [
      metric('Raw material signals', intelligence.state.value.rawMaterialSignals.length, 'Official identity, regulatory, and material-context imports.'),
      metric('Supplier scorecards', intelligence.state.value.supplierScorecards.length, 'Supplier/material context imported with commercial fields gated.'),
      metric('Evidence sources', intelligence.state.value.dataRoomSources.filter(dataRoomMatchesScreen).length, 'Supplier quote, price, SDS, TDS, COA, and audit evidence staged for review.'),
      metric('Needs review', pendingReviewFindings.value.length, 'Supplier, price, payment, score, DMS, and raw-material findings waiting for approval.', pendingReviewFindings.value.length ? 'review' : 'empty'),
    ]
  }

  if (props.screen === 'competitor') {
    return [
      metric('Competitor records', intelligence.state.value.competitors.length, 'Company, product-equivalent, source, and Hermes twice-daily market-share verification records.'),
      metric('Needs review', pendingReviewFindings.value.length, 'Competitor price/share/product claims waiting for approval.', pendingReviewFindings.value.length ? 'review' : 'empty'),
    ]
  }

  if (props.screen === 'investment') {
    return [
      metric('Financial models', intelligence.state.value.financialModels.length, 'Saved IRR/NPV/payback scenarios derived from assumptions.'),
      metric('Financial evidence', intelligence.state.value.dataRoomSources.filter(dataRoomMatchesScreen).length, 'Source records that support capex, cost, or investment assumptions.'),
      metric('Needs review', pendingReviewFindings.value.length, 'Financial claims staged before they can affect investor material.', pendingReviewFindings.value.length ? 'review' : 'empty'),
    ]
  }

  return [
    metric('Market records', intelligence.state.value.marketClaims.length, 'Source-backed market signals available to executive screens.'),
    metric('Competitor records', intelligence.state.value.competitors.length, 'Competitor intelligence records available to executive screens.'),
    metric('Evidence sources', intelligence.state.value.dataRoomSources.length, 'Data-room, raw-material, regulatory, supplier, and source records.'),
    metric('Needs review', pendingReviewFindings.value.length, 'Review-gated findings that block investor-ready truth.', pendingReviewFindings.value.length ? 'review' : 'empty'),
  ]
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not scheduled'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function tagType(status: IntelligenceEvidenceStatus): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'Verified' || status === 'Trusted Source Auto-Updated' || status === 'Source-backed') return 'success'
  if (status === 'Conflict Detected' || status === 'Missing') return 'error'
  if (status === 'To Verify' || status === 'Candidate Source' || status === 'Reference Only') return 'warning'
  return 'info'
}

function displayAutopilotValue(value?: string | number | null): string {
  return displayUnresolvedValue(value)
}

function displayAutopilotStatus(status?: string | null): string {
  return displayEvidenceStatus(status)
}

function displayAutopilotText(text?: string | null): string {
  return displayAutomaticVerificationText(text)
}

function claimRestrictedForRole(claim: TrustedSourceSnapshotClaim): boolean {
  if (!redactsSensitiveClaims.value) return false
  const text = [
    claim.label,
    claim.value,
    claim.fieldKey,
    claim.dataType,
    claim.sourceTier,
    claim.riskReason,
    claim.notes,
  ].filter(Boolean).join(' ').toLowerCase()
  return claim.sensitive ||
    isSensitiveAutopilotDataType(claim.dataType) ||
    /price|cost|costing|margin|supplier quote|formula|raw material ratio|product-development|product development|irr|npv|payback|investor term|api key|secret/.test(text)
}

function openDrawer(claim?: TrustedSourceSnapshotClaim) {
  selectedClaim.value = claim && !claimRestrictedForRole(claim)
    ? claim
    : visibleSnapshotClaims.value[0] || null
  drawerOpen.value = true
}

function canShowRouteLink(route: { name?: string } | null | undefined): boolean {
  return Boolean(route?.name && canAccessRouteName(route.name, frontendRole.value))
}

function disableSelectedSource() {
  if (!selectedClaim.value) {
    message.info('Select a sourced field first')
    return
  }
  const source = activeSources.value.find(item =>
    item.name.toLowerCase() === selectedClaim.value?.source.title.toLowerCase() ||
    (selectedClaim.value?.source.url && selectedClaim.value.source.url.includes(item.domain)),
  )
  if (!source) {
    message.warning('No active source record found for this field')
    return
  }
  autopilot.updateSource(source.source_id, {
    enabled: false,
    notes: `${source.notes} Disabled from source drawer for field: ${selectedClaim.value.label}.`,
  })
  message.success('Auto update disabled for this source')
}

async function createResearchJob() {
  saving.value = true
  try {
    const job = await jobsStore.createJob({
      name: `${props.title || props.screen} Trusted Source Refresh`,
      schedule: EXECUTIVE_REFRESH_SCHEDULE,
      deliver: 'local',
      prompt: autopilot.screenRefreshPrompt(props.screen),
    })
    await autopilot.runTrustedSourceDataEngine(props.screen, job.job_id || job.id)
    message.success('Trusted source refresh job created')
  } catch (err) {
    await autopilot.runTrustedSourceDataEngine(props.screen)
    const detail = err instanceof Error ? err.message : 'job API unavailable'
    message.warning(`Job scheduling fallback recorded: ${detail}`)
  } finally {
    saving.value = false
  }
}

async function syncNow() {
  saving.value = true
  try {
    const result = await autopilot.runFullDashboardImportNow()
    if (!result.imported && !result.staged) {
      await autopilot.runTrustedSourceDataEngine(props.screen)
    }
    if (result.errors.length) {
      message.warning(`${result.message} Some sources need attention: ${result.errors.slice(0, 2).join('; ')}`)
    } else {
      message.success(result.message)
    }
  } catch {
    saving.value = false
    await createResearchJob()
    return
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="trusted-autopilot" :class="{ compact }" aria-label="Trusted source autopilot">
    <div class="autopilot-header">
      <div>
        <p class="eyebrow">Trusted Source Autopilot</p>
        <h3>{{ title || 'Auto Source Status' }}</h3>
        <p>
          Hermes researches this screen automatically from trusted sources, fills safe source-backed fields,
          and stages risky business claims for review. No manual web searching is needed.
        </p>
      </div>
      <div class="autopilot-status">
        <span>Online auto-update: {{ sourceStatusLabel }}</span>
        <strong>{{ activeSources.length }}</strong>
        <small>trusted sources active</small>
      </div>
    </div>

    <div class="screen-action-summary" :class="screenActionSummary.tone" aria-label="Your next trusted-source action">
      <span class="screen-action-icon" aria-hidden="true">{{ screenActionSummary.icon }}</span>
      <div class="screen-action-copy">
        <small>{{ screenActionSummary.eyebrow }}</small>
        <strong>{{ screenActionSummary.title }}</strong>
        <p>{{ displayAutopilotText(screenActionSummary.detail) }}</p>
      </div>
      <div class="screen-action-buttons">
        <NButton
          v-if="screenActionSummary.sync"
          size="small"
          type="primary"
          :loading="saving"
          @click="syncNow"
        >
          {{ screenActionSummary.primary }}
        </NButton>
        <RouterLink
          v-else-if="screenActionSummary.primaryRoute && canShowRouteLink(screenActionSummary.primaryRoute)"
          class="autopilot-link primary"
          :to="screenActionSummary.primaryRoute"
        >
          {{ screenActionSummary.primary }}
        </RouterLink>
        <RouterLink
          v-if="screenActionSummary.secondaryRoute && canShowRouteLink(screenActionSummary.secondaryRoute)"
          class="autopilot-link"
          :to="screenActionSummary.secondaryRoute"
        >
          {{ screenActionSummary.secondary }}
        </RouterLink>
      </div>
    </div>

    <div class="simple-autopilot-grid" aria-label="Simple trusted source status">
      <article v-for="card in simpleAutopilotCards" :key="card.label">
        <span aria-hidden="true">{{ card.icon }}</span>
        <div>
          <small>{{ card.label }}</small>
          <strong>{{ card.value }}</strong>
          <em>{{ displayAutopilotText(card.note) }}</em>
        </div>
      </article>
    </div>

    <div class="autopilot-flow-strip" aria-label="Automatic source workflow">
      <article v-for="step in simpleFlowSteps" :key="step.title">
        <span aria-hidden="true">{{ step.icon }}</span>
        <div>
          <strong>{{ step.title }}</strong>
          <small>{{ step.detail }}</small>
        </div>
      </article>
    </div>

    <details class="autopilot-disclosure research-permission-card">
      <summary>
        <strong>Evidence rules</strong>
        <span>How Hermes decides what can fill automatically</span>
      </summary>
      <div class="disclosure-body">
        <span>Hermes may use trusted public, company, regulatory, and uploaded evidence sources for this screen.</span>
        <ul>
          <li>Important values need source title, URL/date, confidence, and evidence status.</li>
          <li>Unknown, conflicting, weak-source, sensitive, or investor-impacting data goes to review instead of becoming fact.</li>
          <li>Outputs should use source matrices, tables, charts, and evidence-gap checklists when useful.</li>
        </ul>
      </div>
    </details>

    <details class="autopilot-disclosure troubleshooting-controls">
      <summary>
        <strong>Troubleshooting</strong>
        <span>Optional status check, sources, jobs, and diagnostics</span>
      </summary>
      <div class="disclosure-body">
        <div class="autopilot-metrics">
          <button type="button" @click="openDrawer()">
            <span>Last successful refresh</span>
            <strong>{{ formatDateTime(lastSuccessfulRefresh) }}</strong>
          </button>
          <button type="button" @click="openDrawer()">
            <span>Next refresh</span>
            <strong>{{ formatDateTime(nextRefresh) }}</strong>
          </button>
          <button type="button" @click="openDrawer()">
            <span>Needs review</span>
            <strong>{{ needsReviewCount }}</strong>
          </button>
          <button type="button" @click="openDrawer()">
            <span>Last failed refresh</span>
            <strong>{{ lastFailedRefresh || 'None' }}</strong>
          </button>
        </div>
        <div class="autopilot-actions">
          <NButton size="small" type="primary" :loading="saving" @click="syncNow">Run Source Check Now</NButton>
          <NButton size="small" secondary @click="openDrawer()">View Sources</NButton>
          <RouterLink
            v-if="canAccessRouteName('hermes.researchResultReview', frontendRole)"
            class="autopilot-link"
            :to="{ name: 'hermes.researchResultReview' }"
          >
            View Review Queue
          </RouterLink>
          <NButton size="small" secondary :loading="saving" @click="createResearchJob">Create Research Job</NButton>
          <RouterLink class="autopilot-link" :to="{ name: 'hermes.trustedSources' }">Trusted Sources</RouterLink>
        </div>
      </div>
    </details>

    <div class="durable-intelligence-status" aria-label="Imported dashboard records">
      <div class="durable-status-copy">
        <p class="eyebrow">Imported dashboard records</p>
        <strong>{{ durableStatusText }}</strong>
        <span>
          Durable intelligence survives browser reloads. Sensitive, investor-impacting, or weak-source values stay in review until approved.
        </span>
      </div>
      <div class="durable-status-grid">
        <div
          v-for="metric in durableRecordMetrics"
          :key="metric.label"
          class="durable-status-card"
          :class="metric.tone"
        >
          <span>{{ metric.label }}</span>
          <strong>{{ metric.count }}</strong>
          <small>{{ displayAutopilotText(metric.note) }}</small>
        </div>
      </div>
    </div>

    <div v-if="visibleSnapshotClaims.length" class="claim-strip">
      <p class="claim-strip-title">Tracked fields</p>
      <button v-for="claim in visibleSnapshotClaims" :key="claim.id" type="button" @click="openDrawer(claim)">
        <span>{{ claim.label }}</span>
        <strong>{{ displayAutopilotValue(claim.value) }}</strong>
        <NTag size="small" :type="tagType(claim.evidenceStatus)">{{ displayAutopilotStatus(claim.evidenceStatus) }}</NTag>
      </button>
    </div>
    <p
      v-else-if="latestSnapshot?.claims.length && redactsSensitiveClaims"
      class="sensitive-note"
    >
      {{ restrictedFieldLabel(frontendRole) }}. Sensitive source-backed fields are hidden in this role view.
    </p>

    <NDrawer v-model:show="drawerOpen" :width="520" placement="right">
      <NDrawerContent title="Trusted Source Details">
        <div v-if="selectedClaim" class="source-detail">
          <h4>{{ selectedClaim.label }}</h4>
          <strong>{{ displayAutopilotValue(selectedClaim.value) }}</strong>
          <NTag :type="tagType(selectedClaim.evidenceStatus)">{{ displayAutopilotStatus(selectedClaim.evidenceStatus) }}</NTag>
          <dl>
            <dt>Source</dt><dd>{{ selectedClaim.source.title }}</dd>
            <dt>URL / file</dt><dd>{{ selectedClaim.source.url || 'Not provided' }}</dd>
            <dt>Source tier</dt><dd>{{ displayAutopilotValue(selectedClaim.sourceTierLabel || selectedClaim.sourceTier) }}</dd>
            <dt>Dashboard field</dt><dd>{{ selectedClaim.fieldKey || selectedClaim.label }}</dd>
            <dt>Source date</dt><dd>{{ displayAutopilotValue(selectedClaim.source.date) }}</dd>
            <dt>Last checked</dt><dd>{{ formatDateTime(selectedClaim.lastChecked || latestSnapshot?.generated_at) }}</dd>
            <dt>Extraction time</dt><dd>{{ formatDateTime(latestSnapshot?.generated_at) }}</dd>
            <dt>Confidence</dt><dd>{{ selectedClaim.confidence }}</dd>
            <dt>Previous value</dt><dd>{{ selectedClaim.previousValue || 'None' }}</dd>
            <dt>Change %</dt><dd>{{ selectedClaim.changePercent === null || selectedClaim.changePercent === undefined ? 'n/a' : `${selectedClaim.changePercent.toFixed(1)}%` }}</dd>
            <dt>Review status</dt><dd>{{ selectedClaim.reviewRequired ? 'Needs Review' : 'Auto-updated' }}</dd>
            <dt>Risk reason</dt><dd>{{ selectedClaim.riskReason || 'low-risk source-backed field' }}</dd>
          </dl>
          <p v-if="selectedClaim.sensitive" class="sensitive-note">Sensitive value. Employee/investor views must redact this field.</p>
          <NButton secondary type="warning" @click="disableSelectedSource">Disable Auto Update for this field</NButton>
        </div>
        <div v-else class="source-detail">
          <h4>No source-backed field selected yet</h4>
          <p>Hermes refreshes this screen automatically. Use Run Source Check Now only when troubleshooting a stale source run.</p>
        </div>
        <div class="source-list">
          <h4>Active sources for this screen</h4>
          <div v-for="source in activeSources" :key="source.source_id" class="source-row">
            <strong>{{ source.name }}</strong>
            <span>{{ source.domain }} / {{ source.tier }} / {{ source.confidence_default }}</span>
            <small>{{ source.notes }}</small>
          </div>
        </div>
      </NDrawerContent>
    </NDrawer>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.trusted-autopilot {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
  padding: 16px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.08), rgba(var(--accent-info-rgb), 0.04)),
    $bg-card;
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.18);
  color: $text-primary;
}

.autopilot-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px;
  gap: 14px;
  align-items: start;

  h3 {
    margin: 0;
    color: $warning;
    font-size: 18px;
    line-height: 1.2;
  }

  p {
    max-width: 820px;
    margin: 6px 0 0;
    color: $text-secondary;
    font-size: 13px;
    line-height: 1.55;
  }
}

.eyebrow,
.autopilot-status span,
.autopilot-status small,
.autopilot-metrics span {
  color: $text-muted;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.autopilot-status,
.autopilot-metrics button,
.claim-strip button {
  display: grid;
  gap: 4px;
  min-width: 0;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-card;
  color: $text-primary;
}

.autopilot-status {
  padding: 10px;
  align-self: stretch;
  border-color: rgba(var(--accent-primary-rgb), 0.32);
  background: rgba(var(--accent-primary-rgb), 0.08);

  strong {
    color: $accent-primary;
    font-size: 24px;
  }
}

.simple-autopilot-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 9px;
    min-width: 0;
    padding: 11px 12px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.24);
    border-radius: 8px;
    background: rgba(var(--accent-info-rgb), 0.055);
  }

  span {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.28);
    border-radius: 999px;
    background: rgba(var(--accent-primary-rgb), 0.08);
    font-size: 16px;
  }

  div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  small {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    overflow-wrap: anywhere;
    color: $accent-primary;
    font-size: 17px;
    line-height: 1.1;
  }

  em {
    color: $text-secondary;
    font-size: 11px;
    font-style: normal;
    line-height: 1.35;
  }
}

.screen-action-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.055);

  &.review {
    border-color: rgba(var(--warning-rgb), 0.5);
    background: rgba(var(--warning-rgb), 0.08);

    .screen-action-icon {
      border-color: rgba(var(--warning-rgb), 0.45);
      background: rgba(var(--warning-rgb), 0.12);
    }
  }

  &.filled {
    border-color: rgba(var(--success-rgb), 0.36);
    background: rgba(var(--success-rgb), 0.07);

    .screen-action-icon {
      border-color: rgba(var(--success-rgb), 0.36);
      background: rgba(var(--success-rgb), 0.11);
    }
  }
}

.screen-action-icon {
  display: inline-grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.32);
  border-radius: 999px;
  background: rgba(var(--accent-primary-rgb), 0.09);
  font-size: 20px;
}

.screen-action-copy {
  display: grid;
  gap: 4px;
  min-width: 0;

  small {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $warning;
    font-size: 15px;
    line-height: 1.2;
  }

  p {
    margin: 0;
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }
}

.screen-action-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.autopilot-flow-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 9px;
    align-items: start;
    min-width: 0;
    padding: 10px 11px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.22);
    border-radius: 8px;
    background: rgba(var(--bg-secondary-rgb), 0.38);
  }

  span {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: rgba(var(--accent-primary-rgb), 0.1);
    font-size: 15px;
  }

  div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  strong {
    color: $text-primary;
    font-size: 12px;
    line-height: 1.25;
  }

  small {
    color: $text-secondary;
    font-size: 11px;
    line-height: 1.35;
  }
}

.autopilot-disclosure {
  display: grid;
  border: 1px solid $border-color;
  border-radius: 8px;
  background: rgba(var(--bg-secondary-rgb), 0.42);

  &[open] {
    padding-bottom: 10px;
  }

  summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 40px;
    padding: 10px 12px;
    cursor: pointer;
    list-style: none;

    &::-webkit-details-marker {
      display: none;
    }

    &::after {
      content: '+';
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border: 1px solid rgba(var(--accent-info-rgb), 0.32);
      border-radius: 999px;
      color: $accent-info;
      font-weight: 900;
    }
  }

  &[open] summary::after {
    content: '-';
  }

  strong {
    color: $accent-info;
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
  }

  summary span,
  span,
  li {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.45;
  }

  summary span {
    text-align: left;
  }

  ul {
    display: grid;
    gap: 4px;
    margin: 0;
    padding-left: 18px;
  }
}

.research-permission-card {
  border-color: rgba(var(--accent-info-rgb), 0.24);
  background: rgba(var(--accent-info-rgb), 0.045);
}

.troubleshooting-controls {
  border-color: rgba(var(--accent-primary-rgb), 0.22);
  background: rgba(var(--accent-primary-rgb), 0.035);
}

.disclosure-body {
  display: grid;
  gap: 10px;
  padding: 0 12px;
}

.autopilot-metrics,
.claim-strip {
  display: grid;
  gap: 8px;
}

.autopilot-metrics {
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}

.claim-strip {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  max-height: 260px;
  overflow: auto;
  padding-top: 4px;
}

.claim-strip-title {
  grid-column: 1 / -1;
  margin: 0 0 2px;
  color: $text-muted;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
}

.autopilot-metrics button,
.claim-strip button {
  padding: 9px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s ease, background-color 0.16s ease, transform 0.16s ease;

  &:hover {
    border-color: rgba(var(--accent-primary-rgb), 0.45);
    background: rgba(var(--accent-primary-rgb), 0.08);
    transform: translateY(-1px);
  }

  strong {
    overflow-wrap: anywhere;
    color: $accent-primary;
    font-size: 13px;
  }
}

.autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.durable-intelligence-status {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.2fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.24);
  border-radius: 8px;
  background: rgba(var(--bg-secondary-rgb), 0.52);
}

.durable-status-copy {
  display: grid;
  gap: 6px;
  align-content: start;

  strong {
    color: $text-primary;
    font-size: 14px;
    line-height: 1.35;
  }

  span {
    color: $text-secondary;
    font-size: 12px;
    line-height: 1.5;
  }
}

.durable-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.durable-status-card {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 8px;
  background: rgba(var(--bg-tertiary-rgb), 0.52);

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $warning;
    font-size: 22px;
    line-height: 1;
  }

  small {
    color: $text-secondary;
    font-size: 11px;
    line-height: 1.35;
  }

  &.review {
    border-color: rgba(var(--warning-rgb), 0.45);
    background: rgba(var(--warning-rgb), 0.08);
  }

  &.empty strong {
    color: $text-muted;
  }
}

.autopilot-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: $bg-card;
  color: $accent-info;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;

  &.primary {
    border-color: rgba(var(--accent-primary-rgb), 0.48);
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: $accent-primary;
  }
}

.source-detail {
  display: grid;
  gap: 10px;

  h4 {
    margin: 0;
    color: $warning;
  }

  dl {
    display: grid;
    grid-template-columns: 130px minmax(0, 1fr);
    gap: 8px;
  }

  dt {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
    color: $text-secondary;
  }
}

.sensitive-note {
  padding: 8px;
  border: 1px solid rgba(var(--error-rgb), 0.4);
  border-radius: 6px;
  color: $error;
}

.source-list {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.source-row {
  display: grid;
  gap: 3px;
  padding: 9px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  span,
  small {
    color: $text-secondary;
    font-size: 12px;
  }
}

@media (max-width: 720px) {
  .autopilot-header,
  .autopilot-metrics,
  .simple-autopilot-grid,
  .autopilot-flow-strip,
  .screen-action-summary,
  .claim-strip,
  .durable-intelligence-status {
    grid-template-columns: 1fr;
  }

  .screen-action-buttons {
    justify-content: stretch;

    .autopilot-link,
    :deep(.n-button) {
      width: 100%;
    }
  }

  .autopilot-disclosure summary {
    grid-template-columns: 1fr;

    span {
      text-align: left;
    }

    &::after {
      justify-self: start;
    }
  }

  .trusted-autopilot {
    padding: 12px;
  }
}
</style>
