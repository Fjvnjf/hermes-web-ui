<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NSelect, NSwitch, useMessage } from 'naive-ui'
import { useTrustedSourceAutopilot } from '@/composables/useTrustedSourceAutopilot'
import type { TrustedSourceDataType, TrustedSourceTier } from '@/utils/trustedSources'

const message = useMessage()
const autopilot = useTrustedSourceAutopilot()

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
const activeSourceCount = computed(() => autopilot.activeSources.value.length)
const needsReviewCount = computed(() => autopilot.needsReviewSnapshots.value.length)

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
    requires_review: form.value.tier === 'candidate-source' || form.value.tier === 'tier4-public-listing',
    notes: form.value.notes || 'Owner-added trusted source registry record.',
  })
  form.value = { name: '', domain: '', tier: 'candidate-source', dataType: 'market_size', notes: '' }
  message.success('Trusted source saved')
}
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
        <h3>{{ String(key).replace(/([0-9])/, ' $1 ').replace('tier', 'Tier ') }}</h3>
        <div v-for="source in sources" :key="source.source_id" class="source-row">
          <div>
            <strong>{{ source.name }}</strong>
            <span>{{ source.domain }} / {{ source.data_type }} / {{ source.confidence_default }}</span>
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

@media (max-width: 760px) {
  .trusted-sources-view {
    padding: 12px;
  }

  .sources-header,
  .source-form {
    grid-template-columns: 1fr;
  }

  .source-form .wide {
    grid-column: auto;
  }
}
</style>
