<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NSelect, NSwitch, useMessage } from 'naive-ui'
import {
  type FullDashboardServerStatus,
  loadFullDashboardAutopilotStatus,
  persistFullDashboardAutopilotStatus,
  useTrustedSourceAutopilot,
} from '@/composables/useTrustedSourceAutopilot'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import type { TrustedSourceDataType, TrustedSourceTier } from '@/utils/trustedSources'

const message = useMessage()
const autopilot = useTrustedSourceAutopilot()
const intelligence = useFeasibilityIntelligence()
const fullAutopilotSaving = ref(false)
const importingLatestOutput = ref(false)
const refreshingServerStatus = ref(false)
const fullAutopilotStatus = ref(loadFullDashboardAutopilotStatus())
const serverAutopilotStatus = ref<FullDashboardServerStatus | null>(null)

const form = ref({
  name: '',
  domain: '',
  tier: 'candidate-source' as TrustedSourceTier,
  dataType: 'market_size' as TrustedSourceDataType,
  notes: '',
})

const tierOptions = [
  { label: 'Tier 1 - Official / High Trust', value: 'tier1-official' },
  { label: 'Tier 2 - Market Reference', value: 'tier2-market-reference' },
  { label: 'Tier 3 - Supplier Evidence', value: 'tier3-supplier-evidence' },
  { label: 'Tier 4 - Public Listing / Weak Evidence', value: 'tier4-public-listing' },
  { label: 'Candidate Source / To Verify', value: 'candidate-source' },
]

const dataTypeOptions = [
  'trade_data',
  'market_size',
  'price_data',
  'competitor_data',
  'company_data',
  'regulatory_data',
  'financial_data',
  'supplier_quote',
  'document_evidence',
  'internal_activity',
].map(value => ({ label: value.replace(/_/g, ' '), value }))

const groupedSources = computed(() => ({
  tier1: autopilot.state.value.sources.filter(source => source.tier === 'tier1-official'),
  tier2: autopilot.state.value.sources.filter(source => source.tier === 'tier2-market-reference'),
  tier3: autopilot.state.value.sources.filter(source => source.tier === 'tier3-supplier-evidence'),
  tier4: autopilot.state.value.sources.filter(source => source.tier === 'tier4-public-listing'),
  candidates: autopilot.state.value.sources.filter(source => source.tier === 'candidate-source'),
}))
type SourceGroupKey = 'tier1' | 'tier2' | 'tier3' | 'tier4' | 'candidates'

const sourceGroupLabels: Record<SourceGroupKey, string> = {
  tier1: 'Tier 1 - Official / High Trust',
  tier2: 'Tier 2 - Market Reference',
  tier3: 'Tier 3 - Supplier Evidence',
  tier4: 'Tier 4 - Public Listing / Weak Evidence',
  candidates: 'Candidate Sources / To Verify',
}
const activeSourceCount = computed(() => autopilot.activeSources.value.length)
const needsReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)
const fullAutopilotSnapshotCount = computed(() => autopilot.state.value.snapshots.length)
const fullAutopilotReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)
const fullAutopilotStatusTone = computed(() => {
  if (!fullAutopilotStatus.value.enabled) return 'setup'
  if (fullAutopilotStatus.value.lastStatus.toLowerCase().includes('failed')) return 'warning'
  if (fullAutopilotStatus.value.lastStatus.toLowerCase().includes('review')) return 'review'
  return 'active'
})
const fullAutopilotOwnerAction = computed(() => {
  if (!fullAutopilotStatus.value.enabled) return 'Enable once. Hermes will schedule the twice-daily online research job and start importing evidence-backed outputs.'
  if (fullAutopilotReviewCount.value > 0) return 'Open Research Result Review and approve only the source-backed items you trust.'
  if (!fullAutopilotStatus.value.lastRun) return 'Wait for the first scheduled Hermes research output or run a source snapshot now.'
  return 'Autopilot is running. Keep reviewing staged findings; safe source-backed fields will hydrate from durable server state.'
})
const coverageRows = [
  {
    area: 'Market Intelligence',
    fills: 'Trade proxies, country signals, market questions, source-backed segments',
    review: 'Market size, CAGR, consumption, and target claims stay To Verify unless strong evidence exists',
  },
  {
    area: 'Competitor Intelligence',
    fills: 'Company presence, product equivalents, certifications, distribution evidence',
    review: 'Market share, pricing, strengths/weaknesses, and unsupported rankings are staged for review',
  },
  {
    area: 'Raw Materials / Supplier Scorecards',
    fills: 'Supplier evidence candidates, material signals, SDS/TDS/COA/quote references',
    review: 'Supplier prices, payment terms, quality/reliability scores, and cost data remain sensitive',
  },
  {
    area: 'Investment / IRR',
    fills: 'Approved internal scenario snapshots and finance evidence candidates',
    review: 'IRR, NPV, payback, ROI, capex, costing, and investor claims are never silently approved',
  },
  {
    area: 'Regulatory / Data Room',
    fills: 'Regulatory findings, source gaps, document evidence candidates',
    review: 'DMS, CAS, formula, permit, factory approval, and safety claims require owner review',
  },
  {
    area: 'Reports / Presentation',
    fills: 'Investor material candidates only after evidence labels are preserved',
    review: 'Investor-approved material remains approval-gated and excludes unsupported claims',
  },
]
const importedIntelligenceRows = computed(() => [
  {
    label: 'Market and country signals',
    count: intelligence.state.value.marketClaims.length,
    route: { name: 'hermes.marketIntelligence' },
    note: 'Source-backed market claims, trade proxies, country signals, and segmentation evidence.',
  },
  {
    label: 'Competitor records',
    count: intelligence.state.value.competitors.length,
    route: { name: 'hermes.competitorIntelligence' },
    note: 'Company/product records; pricing and market-share claims stay review-gated.',
  },
  {
    label: 'Supplier and data-room sources',
    count: intelligence.state.value.dataRoomSources.length,
    route: { name: 'hermes.rawMaterialSourcing' },
    note: 'Supplier, regulatory, financial, and document evidence candidates with source labels.',
  },
  {
    label: 'Research review findings',
    count: intelligence.pendingResearchFindings.value.length,
    route: { name: 'hermes.researchResultReview' },
    note: 'Weak, sensitive, conflicting, or investor-impact findings waiting for approval.',
  },
  {
    label: 'Scheduled research jobs',
    count: intelligence.state.value.researchJobs.length,
    route: { name: 'hermes.jobs' },
    note: 'Hermes Jobs that keep the dashboard research pipeline running automatically.',
  },
])
const importedIntelligenceTotal = computed(() =>
  importedIntelligenceRows.value.reduce((sum, row) => sum + row.count, 0),
)
const durableStateTimestamp = computed(() =>
  intelligence.serverSyncStatus.value.lastLoadedAt ||
  intelligence.serverSyncStatus.value.lastSavedAt ||
  '',
)
const importedIntelligenceStatus = computed(() => {
  if (intelligence.serverSyncStatus.value.error) {
    return `Server sync warning: ${intelligence.serverSyncStatus.value.error}`
  }
  if (importedIntelligenceTotal.value > 0) {
    return `Durable intelligence is active. ${importedIntelligenceTotal.value} imported records are available to dashboard pages.`
  }
  return 'Waiting for the first structured Hermes research output to import.'
})
const serverAutopilotTone = computed(() => {
  if (!serverAutopilotStatus.value?.scheduled) return 'setup'
  if (serverAutopilotStatus.value.lastError || serverAutopilotStatus.value.errors.length) return 'warning'
  if (!serverAutopilotStatus.value.latestOutputImported && serverAutopilotStatus.value.outputCount > 0) return 'review'
  return 'active'
})

function formatTimestamp(value: string): string {
  if (!value) return 'Not loaded yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

async function refreshServerAutopilotStatus() {
  refreshingServerStatus.value = true
  try {
    serverAutopilotStatus.value = await autopilot.refreshFullDashboardServerStatus()
  } finally {
    refreshingServerStatus.value = false
  }
}

function updateFullAutopilotStatus(patch: Partial<typeof fullAutopilotStatus.value>) {
  fullAutopilotStatus.value = persistFullDashboardAutopilotStatus(patch)
}

function sourceGroupLabel(key: string | number): string {
  return sourceGroupLabels[String(key) as SourceGroupKey] || String(key)
}

function addSource() {
  if (!form.value.name.trim() || !form.value.domain.trim()) {
    message.warning('Add source name and domain first')
    return
  }
  const saved = autopilot.registerCandidate({
    name: form.value.name,
    domain: form.value.domain,
    dataType: form.value.dataType,
  })
  autopilot.updateSource(saved.source_id, {
    tier: form.value.tier,
    confidence_default: form.value.tier === 'tier1-official' ? 'high' : form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing' ? 'low' : 'medium',
    auto_update_allowed: form.value.tier === 'tier1-official' || form.value.tier === 'tier2-market-reference' || form.value.tier === 'tier3-supplier-evidence',
    requires_review: form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing',
    notes: form.value.notes || 'Owner-added trusted source registry record.',
  })
  form.value = { name: '', domain: '', tier: 'candidate-source', dataType: 'market_size', notes: '' }
  message.success('Trusted source saved')
}

async function enableFullDashboardAutopilot() {
  fullAutopilotSaving.value = true
  try {
    const result = await autopilot.ensureFullDashboardAutopilotScheduled({ startFirstRun: true })
    await autopilot.runFullDashboardDataEngine(result.scheduledJobId)
    fullAutopilotStatus.value = loadFullDashboardAutopilotStatus()
    void importLatestDashboardResearchOutput(false)
    void refreshServerAutopilotStatus()
    message.success(result.firstRunStarted ? 'Full dashboard autopilot enabled and first run started' : 'Full dashboard autopilot enabled')
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown scheduling error'
    await autopilot.runFullDashboardDataEngine()
    updateFullAutopilotStatus({
      enabled: false,
      lastRun: new Date().toISOString(),
      lastStatus: `Scheduling failed; local source snapshot created instead. ${detail}`,
    })
    message.warning('Scheduling failed; created local source snapshots for review instead')
  } finally {
    fullAutopilotSaving.value = false
  }
}

async function runFullDashboardSnapshotNow() {
  fullAutopilotSaving.value = true
  try {
    const result = await autopilot.runFullDashboardDataEngine(fullAutopilotStatus.value.scheduledJobId || undefined)
    updateFullAutopilotStatus({
      lastRun: new Date().toISOString(),
      lastStatus: `${result.message}. Review items: ${result.reviewItemCount}.`,
    })
    void refreshServerAutopilotStatus()
    message.success('Full dashboard source snapshot created')
  } finally {
    fullAutopilotSaving.value = false
  }
}

async function importLatestDashboardResearchOutput(showMessages = true) {
  if (!fullAutopilotStatus.value.scheduledJobId) {
    if (showMessages) message.warning('Enable Full Dashboard Autopilot first so Hermes has a scheduled job id')
    return
  }
  importingLatestOutput.value = true
  try {
    const result = await autopilot.importLatestFullDashboardRunOutput(fullAutopilotStatus.value.scheduledJobId)
    if (result.runImported || showMessages) {
      updateFullAutopilotStatus({
        lastRun: result.runImported ? new Date().toISOString() : fullAutopilotStatus.value.lastRun,
        lastStatus: `${result.message}. Auto-filled: ${result.autoFilledCount}. Needs review: ${result.reviewItemCount}.`,
      })
    }
    if (!showMessages) return
    if (result.runImported) {
      message.success('Latest Hermes research output imported into the source-gated dashboard pipeline')
    } else {
      message.warning(result.message)
    }
    void refreshServerAutopilotStatus()
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Unknown import error'
    updateFullAutopilotStatus({
      lastStatus: `Could not import latest Hermes research output: ${detail}`,
    })
    if (showMessages) message.error(`Could not import latest Hermes research output: ${detail}`)
  } finally {
    importingLatestOutput.value = false
  }
}

onMounted(() => {
  void intelligence.hydrateFeasibilityIntelligenceFromServer({ seedServerIfEmpty: false }).then(() => {
    void refreshServerAutopilotStatus()
  })
  if (fullAutopilotStatus.value.enabled && fullAutopilotStatus.value.scheduledJobId) {
    void importLatestDashboardResearchOutput(false)
  }
})
</script>

<template>
  <div class="trusted-sources-view">
    <header class="sources-header">
      <div>
        <p class="eyebrow">Trusted Sources</p>
        <h2>Autopilot Source Registry</h2>
        <p>
          Owner-only registry for classifying official, market-reference, supplier, public-listing, and candidate
          sources. These rules decide what can auto-update dashboard fields and what must go to review.
        </p>
      </div>
      <div class="summary-card">
        <strong>{{ activeSourceCount }}</strong>
        <span>active sources</span>
        <small>{{ needsReviewCount }} snapshots need review</small>
      </div>
    </header>

    <section class="source-permission-panel" aria-label="Research permission and evidence rules">
      <div>
        <p class="eyebrow">Research permission</p>
        <h3>Hermes can research trusted sources</h3>
        <p>
          Owner-approved research is active for public, company, regulatory, supplier, and uploaded evidence sources.
          Findings can stage dashboard updates only when source evidence and review rules are preserved.
        </p>
      </div>
      <div class="permission-flow" aria-label="Trusted source research flow">
        <span>Twice-daily trusted research</span>
        <span>Extract important data</span>
        <span>Attach evidence label</span>
        <span>Auto-stage critical items</span>
        <span>Fill only safe source-backed fields</span>
      </div>
      <ul class="permission-rule-list">
        <li>Important numbers require source title, URL or source date, confidence, evidence status, and review trail.</li>
        <li>Weak, conflicting, sensitive, or candidate-source findings go to Research Result Review instead of becoming facts.</li>
        <li>Unsupported market size, CAGR, market share, pricing, cost, IRR, or NPV values remain To Verify or Missing.</li>
      </ul>
      <div class="policy-tier-strip" aria-label="Official-first source ranking policy">
        <span>Tier 1: official / regulator / trade</span>
        <span>Tier 2: official company / product</span>
        <span>Tier 3: uploaded supplier evidence</span>
        <span>Tier 4: paid / reputable market reference</span>
        <span>Tier 5: public listing / weak reference</span>
      </div>
    </section>

    <section class="full-autopilot-panel" aria-label="Full dashboard trusted source autopilot">
      <div class="full-autopilot-copy">
        <p class="eyebrow">Full dashboard autopilot</p>
        <h3>Automatic Source Research For The Whole Dashboard</h3>
        <p>
          Enable once and Hermes will research trusted online sources on schedule, create source-labeled dashboard
          snapshots, and route weak, conflicting, sensitive, or missing values to Research Result Review. This removes
          manual copy-paste while keeping fake numbers out of Market Intelligence, Competitors, supplier scorecards,
          investment analysis, and investor material.
        </p>
      </div>
      <div class="full-autopilot-status">
        <article>
          <span>Status</span>
          <strong>{{ fullAutopilotStatus.enabled ? 'Scheduled' : 'Not Scheduled' }}</strong>
        </article>
        <article>
          <span>Schedule</span>
          <strong>07:00 / 19:00</strong>
        </article>
        <article>
          <span>Snapshots</span>
          <strong>{{ fullAutopilotSnapshotCount }}</strong>
        </article>
        <article>
          <span>Needs Review</span>
          <strong>{{ fullAutopilotReviewCount }}</strong>
        </article>
      </div>
      <div class="full-autopilot-command" :class="fullAutopilotStatusTone">
        <div>
          <span>Current owner action</span>
          <strong>{{ fullAutopilotOwnerAction }}</strong>
        </div>
        <small>
          Durable server intelligence hydrates the source panels after every successful import, so refreshed data survives browser reloads and public tunnel changes.
        </small>
      </div>
      <div class="server-autopilot-status" :class="serverAutopilotTone" aria-label="Server autopilot job status">
        <div class="server-autopilot-header">
          <div>
            <p class="eyebrow">Server job status</p>
            <h4>{{ serverAutopilotStatus?.scheduled ? 'Hermes research job is connected' : 'Hermes research job not confirmed yet' }}</h4>
          </div>
          <NButton tertiary size="small" :loading="refreshingServerStatus" @click="refreshServerAutopilotStatus">
            Refresh Status
          </NButton>
        </div>
        <p class="server-autopilot-message">
          {{ serverAutopilotStatus?.message || 'Reading the Hermes Jobs and Cron History APIs for live autopilot status.' }}
        </p>
        <div class="server-autopilot-grid">
          <article>
            <span>Job</span>
            <strong>{{ serverAutopilotStatus?.jobId || 'Not found' }}</strong>
          </article>
          <article>
            <span>State</span>
            <strong>{{ serverAutopilotStatus?.enabled ? (serverAutopilotStatus.state || 'enabled') : 'disabled / unknown' }}</strong>
          </article>
          <article>
            <span>Latest output</span>
            <strong>{{ serverAutopilotStatus?.latestOutputAt ? formatTimestamp(serverAutopilotStatus.latestOutputAt) : 'No output yet' }}</strong>
          </article>
          <article>
            <span>Readable outputs</span>
            <strong>{{ serverAutopilotStatus?.outputCount ?? 0 }}</strong>
          </article>
          <article>
            <span>Imported runs</span>
            <strong>{{ serverAutopilotStatus?.importedRunCount ?? 0 }}</strong>
          </article>
          <article>
            <span>Latest imported</span>
            <strong>{{ serverAutopilotStatus?.latestOutputImported ? 'Yes' : 'No / pending' }}</strong>
          </article>
          <article>
            <span>Dashboard records</span>
            <strong>{{ serverAutopilotStatus?.dashboardRecordCount ?? importedIntelligenceTotal }}</strong>
          </article>
          <article>
            <span>Needs review</span>
            <strong>{{ serverAutopilotStatus?.pendingReviewCount ?? intelligence.pendingResearchFindings.value.length }}</strong>
          </article>
        </div>
        <small v-if="serverAutopilotStatus?.latestOutputFile">
          Latest file: {{ serverAutopilotStatus.latestOutputFile }}
        </small>
      </div>
      <div class="imported-intelligence-panel" aria-label="Live imported dashboard intelligence">
        <div class="imported-intelligence-header">
          <div>
            <p class="eyebrow">Live imported intelligence</p>
            <h4>Automatic dashboard filling status</h4>
          </div>
          <div class="imported-total">
            <strong>{{ importedIntelligenceTotal }}</strong>
            <span>records</span>
          </div>
        </div>
        <p class="imported-intelligence-note">
          {{ importedIntelligenceStatus }}
          <span>Last durable load/save: {{ formatTimestamp(durableStateTimestamp) }}</span>
        </p>
        <div class="imported-intelligence-grid">
          <RouterLink
            v-for="row in importedIntelligenceRows"
            :key="row.label"
            class="imported-intelligence-row"
            :to="row.route"
          >
            <span>{{ row.label }}</span>
            <strong>{{ row.count }}</strong>
            <small>{{ row.note }}</small>
          </RouterLink>
        </div>
      </div>
      <ul class="autopilot-rule-list">
        <li>Researches official, company, regulatory, trade, supplier, price-reference, and uploaded evidence sources.</li>
        <li>Runs on the existing Hermes Jobs scheduler at 07:00 and 19:00; no separate database or backend migration is required.</li>
        <li>Fills only source-backed/API/internal-safe fields automatically; unsupported values stay Missing / To Verify.</li>
        <li>Supplier prices, quality, reliability, payment terms, IRR, market size, growth, market share, regulatory status, and investor claims are auto-staged for review unless source policy allows safe filling.</li>
      </ul>
      <div class="full-autopilot-actions">
        <NButton type="primary" :loading="fullAutopilotSaving" @click="enableFullDashboardAutopilot">Enable Full Autopilot</NButton>
        <NButton secondary :loading="fullAutopilotSaving" @click="runFullDashboardSnapshotNow">Run Source Snapshot Now</NButton>
        <NButton tertiary :loading="importingLatestOutput" @click="importLatestDashboardResearchOutput(true)">Import Latest Output</NButton>
        <RouterLink class="autopilot-link" :to="{ name: 'hermes.researchResultReview' }">Open Review Queue</RouterLink>
        <RouterLink class="autopilot-link" :to="{ name: 'hermes.rawMaterialSourcing' }">Raw Material Scorecards</RouterLink>
      </div>
      <p class="autopilot-status-note">
        {{ fullAutopilotStatus.lastStatus }}
        <span v-if="fullAutopilotStatus.scheduledJobId"> Job: {{ fullAutopilotStatus.scheduledJobId }}</span>
      </p>
      <div class="coverage-map" aria-label="Full dashboard autopilot coverage map">
        <div class="coverage-map-header">
          <h4>What Hermes can fill automatically</h4>
          <span>official-first / review critical</span>
        </div>
        <div class="coverage-row head">
          <span>Dashboard area</span>
          <span>Auto-filled or hydrated when source-backed</span>
          <span>Review-gated / protected</span>
        </div>
        <div v-for="row in coverageRows" :key="row.area" class="coverage-row">
          <strong>{{ row.area }}</strong>
          <span>{{ row.fills }}</span>
          <span>{{ row.review }}</span>
        </div>
      </div>
    </section>

    <section class="source-form">
      <h3>Add Source</h3>
      <label>Name<input v-model="form.name" type="text" placeholder="Official agency, company, supplier, source portal" /></label>
      <label>Domain<input v-model="form.domain" type="text" placeholder="example.gov.cn or supplier evidence" /></label>
      <label>Tier<NSelect v-model:value="form.tier" :options="tierOptions" /></label>
      <label>Data type<NSelect v-model:value="form.dataType" :options="dataTypeOptions" /></label>
      <label class="wide">Notes<textarea v-model="form.notes" rows="3" placeholder="What fields this source can update and any limitations"></textarea></label>
      <NButton type="primary" @click="addSource">Add Source</NButton>
    </section>

    <section class="source-groups">
      <article v-for="(sources, key) in groupedSources" :key="key" class="source-group">
        <div class="source-group-header">
          <h3>{{ sourceGroupLabel(key) }}</h3>
          <span>{{ sources.length }} sources</span>
        </div>
        <div v-for="source in sources" :key="source.source_id" class="source-row">
          <div>
            <strong>{{ source.name }}</strong>
            <span class="source-domain">{{ source.domain }}</span>
            <div class="source-meta" aria-label="Source connector metadata">
              <span>Connector: {{ source.connector_type }}</span>
              <span>Frequency: {{ source.update_frequency }}</span>
              <span>Confidence: {{ source.confidence_default }}</span>
              <span>Auto Update: {{ source.auto_update_allowed ? 'Allowed' : 'Review only' }}</span>
            </div>
            <span>{{ source.data_types_supported.join(', ') }}</span>
            <small>{{ source.notes }}</small>
            <small>Last checked: {{ source.last_checked || 'Never' }} / Failure: {{ source.last_failure || 'None' }}</small>
          </div>
          <NSwitch
            :value="source.enabled"
            @update:value="value => autopilot.updateSource(source.source_id, { enabled: value })"
          />
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.trusted-sources-view {
  min-height: var(--app-content-height, 100%);
  padding: 18px;
  background: $bg-primary;
  color: $text-primary;
}

.sources-header,
.source-permission-panel,
.full-autopilot-panel,
.source-form,
.source-group {
  border: 1px solid $border-color;
  border-radius: 8px;
  background: $bg-card;
}

.sources-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 190px;
  gap: 16px;
  margin-bottom: 12px;
  padding: 18px;

  h2 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
  }
}

.eyebrow,
.summary-card span,
.summary-card small {
  color: $text-muted;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.summary-card {
  display: grid;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.35);
  border-radius: 8px;
  background: rgba(var(--accent-primary-rgb), 0.08);

  strong {
    color: $accent-primary;
    font-size: 26px;
  }
}

.source-permission-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.75fr);
  gap: 16px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-info-rgb), 0.32);
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.1), transparent 46%),
    $bg-card;

  h3 {
    margin: 0;
    color: $accent-info;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.permission-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-content: start;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 3px 8px;
    border: 1px solid rgba(var(--warning-rgb), 0.36);
    border-radius: 999px;
    background: rgba(var(--warning-rgb), 0.08);
    color: $warning;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.permission-rule-list {
  grid-column: 1 / -1;
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: 9px 10px;
    border: 1px solid $border-color;
    border-radius: 7px;
    background: $bg-secondary;
    color: $text-secondary;
    line-height: 1.45;
  }
}

.policy-tier-strip {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 7px;

  span {
    padding: 8px 9px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.26);
    border-radius: 6px;
    background: rgba(var(--accent-primary-rgb), 0.055);
    color: $warning;
    font-size: 11px;
    font-weight: 850;
  }
}

.full-autopilot-panel {
  display: grid;
  gap: 14px;
  margin-bottom: 12px;
  padding: 16px;
  border-color: rgba(var(--accent-primary-rgb), 0.42);
  background:
    linear-gradient(135deg, rgba(var(--accent-primary-rgb), 0.14), rgba(var(--accent-info-rgb), 0.05) 46%, transparent),
    $bg-card;

  h3 {
    margin: 0;
    color: $warning;
  }

  p {
    margin: 8px 0 0;
    color: $text-secondary;
    line-height: 1.55;
  }
}

.full-autopilot-copy {
  max-width: 980px;
}

.full-autopilot-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;

  article {
    display: grid;
    gap: 6px;
    padding: 12px;
    border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
    border-radius: 8px;
    background: rgba(var(--accent-primary-rgb), 0.07);
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-primary;
    font-size: 18px;
  }
}

.full-autopilot-command {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.065);

  &.active {
    border-color: rgba(var(--success-rgb), 0.3);
    background: rgba(var(--success-rgb), 0.07);
  }

  &.review {
    border-color: rgba(var(--warning-rgb), 0.38);
    background: rgba(var(--warning-rgb), 0.08);
  }

  &.warning {
    border-color: rgba(var(--danger-rgb), 0.34);
    background: rgba(var(--danger-rgb), 0.06);
  }

  div {
    display: grid;
    gap: 5px;
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
    font-size: 14px;
    line-height: 1.45;
  }
}

.server-autopilot-status {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background: rgba(var(--accent-info-rgb), 0.055);

  &.active {
    border-color: rgba(var(--success-rgb), 0.28);
    background: rgba(var(--success-rgb), 0.055);
  }

  &.review {
    border-color: rgba(var(--warning-rgb), 0.38);
    background: rgba(var(--warning-rgb), 0.075);
  }

  &.warning {
    border-color: rgba(var(--danger-rgb), 0.34);
    background: rgba(var(--danger-rgb), 0.06);
  }

  small {
    color: $text-muted;
    font-size: 11px;
    font-weight: 850;
  }
}

.server-autopilot-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 2px 0 0;
    color: $accent-info;
    font-size: 15px;
  }
}

.server-autopilot-message {
  margin: 0;
  color: $text-secondary;
  line-height: 1.45;
}

.server-autopilot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;

  article {
    display: grid;
    gap: 5px;
    min-height: 72px;
    padding: 9px;
    border: 1px solid $border-color;
    border-radius: 7px;
    background: $bg-secondary;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    overflow-wrap: anywhere;
    color: $text-primary;
    font-size: 13px;
    line-height: 1.35;
  }
}

.imported-intelligence-panel {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-info-rgb), 0.28);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(var(--accent-info-rgb), 0.08), transparent 55%),
    rgba(0, 0, 0, 0.08);
}

.imported-intelligence-header {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 2px 0 0;
    color: $accent-info;
    font-size: 15px;
  }
}

.imported-total {
  display: grid;
  min-width: 86px;
  padding: 8px 10px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.34);
  border-radius: 7px;
  background: rgba(var(--accent-primary-rgb), 0.08);
  text-align: right;

  strong {
    color: $accent-primary;
    font-size: 24px;
    line-height: 1;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.imported-intelligence-note {
  display: grid;
  gap: 4px;
  margin: 0;
  color: $text-secondary;
  line-height: 1.45;

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 850;
  }
}

.imported-intelligence-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.imported-intelligence-row {
  display: grid;
  gap: 6px;
  min-height: 112px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;
  color: inherit;
  text-decoration: none;
  transition: border-color 0.18s ease, transform 0.18s ease;

  &:hover {
    border-color: rgba(var(--accent-info-rgb), 0.5);
    transform: translateY(-1px);
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
    line-height: 1;
  }

  small {
    color: $text-secondary;
    line-height: 1.35;
  }
}

.autopilot-rule-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    padding: 9px 10px;
    border: 1px solid rgba(var(--accent-info-rgb), 0.22);
    border-radius: 7px;
    background: rgba(var(--accent-info-rgb), 0.06);
    color: $text-secondary;
    line-height: 1.45;
  }
}

.full-autopilot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.autopilot-link {
  color: $accent-info;
  font-weight: 800;
  text-decoration: none;
}

.autopilot-status-note {
  margin: 0 !important;
  color: $warning !important;
}

.coverage-map {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(var(--accent-primary-rgb), 0.26);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.08);
  overflow-x: auto;
}

.coverage-map-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  h4 {
    margin: 0;
    color: $warning;
    font-size: 14px;
  }

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.coverage-row {
  display: grid;
  grid-template-columns: minmax(160px, 0.8fr) minmax(260px, 1.1fr) minmax(280px, 1.25fr);
  gap: 10px;
  min-width: 820px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  &.head {
    border-color: rgba(var(--accent-primary-rgb), 0.34);
    background: rgba(var(--accent-primary-rgb), 0.07);
    color: $warning;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    color: $accent-info;
  }

  span {
    color: $text-secondary;
    line-height: 1.45;
  }
}

.source-form {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
  margin-bottom: 12px;
  padding: 14px;

  h3 {
    grid-column: 1 / -1;
    margin: 0;
    color: $warning;
  }

  label {
    display: grid;
    gap: 5px;
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .wide {
    grid-column: span 2;
  }

  input,
  textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid $border-color;
    border-radius: 6px;
    background: $bg-secondary;
    color: $text-primary;
    padding: 8px;
  }
}

.source-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.source-group {
  display: grid;
  gap: 8px;
  align-content: start;
  padding: 14px;

  h3 {
    margin: 0;
    color: $warning;
  }
}

.source-group-header {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;

  span {
    color: $text-muted;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }
}

.source-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px;
  border: 1px solid $border-color;
  border-radius: 7px;
  background: $bg-secondary;

  div {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  span,
  small {
    color: $text-secondary;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
}

.source-domain {
  color: $accent-info !important;
  font-weight: 800;
}

.source-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    display: inline-flex;
    align-items: center;
    min-height: 22px;
    padding: 2px 7px;
    border: 1px solid $border-color;
    border-radius: 999px;
    background: rgba(var(--accent-info-rgb), 0.07);
    color: $text-secondary;
    font-size: 11px;
    font-weight: 800;
  }
}

@media (max-width: 760px) {
  .trusted-sources-view {
    padding: 12px;
  }

  .sources-header,
  .source-permission-panel,
  .source-form {
    grid-template-columns: 1fr;
  }

  .source-form .wide {
    grid-column: auto;
  }

  .coverage-map {
    overflow-x: visible;
  }

  .coverage-map-header {
    display: grid;
    justify-items: start;
  }

  .coverage-row {
    grid-template-columns: 1fr;
    min-width: 0;
  }

  .imported-intelligence-header {
    display: grid;
    justify-items: start;
  }

  .imported-total {
    min-width: 0;
    text-align: left;
  }

  .imported-intelligence-grid {
    grid-template-columns: 1fr;
  }

  .imported-intelligence-row {
    min-height: 0;
  }

  .server-autopilot-header {
    display: grid;
    justify-items: start;
  }

  .server-autopilot-grid {
    grid-template-columns: 1fr;

    article {
      min-height: 0;
    }
  }
}
</style>
