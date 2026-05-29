<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import {
  type EvidenceArea,
  useFeasibilityIntelligence,
} from '@/composables/useFeasibilityIntelligence'
import type { FileEntry } from '@/api/hermes/files'
import type { IntelligenceEvidenceStatus } from '@/utils/investorIntelligence'

const props = defineProps<{
  entries: FileEntry[]
  currentPath: string
}>()

const message = useMessage()
const intelligence = useFeasibilityIntelligence()

const selectedPath = ref('')
const evidenceArea = ref<EvidenceArea>('product')
const evidenceStatus = ref<IntelligenceEvidenceStatus>('To Verify')
const checklistLabel = ref('')
const notes = ref('')

const areaOptions: Array<{ value: EvidenceArea; label: string; defaultLabel: string }> = [
  { value: 'companyLegal', label: 'Company / Legal', defaultLabel: 'Company registration and business scope evidence' },
  { value: 'product', label: 'Product', defaultLabel: 'Product TDS/SDS and CAS evidence' },
  { value: 'factory', label: 'Factory / Plant', defaultLabel: 'Factory/rent/permit evidence' },
  { value: 'regulatory', label: 'Regulatory', defaultLabel: 'Regulatory and chemical permission evidence' },
  { value: 'market', label: 'Market', defaultLabel: 'Market/customer/price evidence' },
  { value: 'financial', label: 'Financial Model', defaultLabel: 'Financial model assumption evidence' },
  { value: 'presentation', label: 'Presentation', defaultLabel: 'Investor presentation source evidence' },
]

const evidenceStatusOptions: IntelligenceEvidenceStatus[] = [
  'To Verify',
  'Missing',
  'Assumption',
  'User Provided',
  'User Approved',
  'Verified',
]

const fileOptions = computed(() =>
  props.entries
    .filter(entry => !entry.isDir)
    .map(entry => ({
      value: entry.path,
      label: entry.name,
    })),
)

const selectedFile = computed(() =>
  props.entries.find(entry => !entry.isDir && entry.path === selectedPath.value) || null,
)

const activeArea = computed(() =>
  areaOptions.find(item => item.value === evidenceArea.value) || areaOptions[1],
)

const sourceDate = computed(() => {
  const raw = selectedFile.value?.modTime
  if (!raw) return new Date().toISOString().slice(0, 10)
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10)
  return parsed.toISOString().slice(0, 10)
})

const suggestedChecklistLabel = computed(() =>
  checklistLabel.value.trim() || activeArea.value.defaultLabel,
)

watch(fileOptions, (options) => {
  if (selectedPath.value && options.some(option => option.value === selectedPath.value)) return
  selectedPath.value = options[0]?.value || ''
}, { immediate: true })

watch(evidenceArea, () => {
  if (!checklistLabel.value.trim()) checklistLabel.value = activeArea.value.defaultLabel
})

function resetForm() {
  checklistLabel.value = activeArea.value.defaultLabel
  notes.value = ''
  evidenceStatus.value = 'To Verify'
}

function registerEvidenceSource() {
  const file = selectedFile.value
  if (!file) {
    message.warning('Select a document from the current folder first')
    return
  }
  const saved = intelligence.addDataRoomSource({
    checklistLabel: suggestedChecklistLabel.value,
    area: evidenceArea.value,
    evidenceStatus: evidenceStatus.value,
    source: {
      title: `Document: ${file.name}`,
      date: sourceDate.value,
    },
    notes: [
      notes.value.trim() || 'Document registered from Files / Documents for investor data-room review.',
      `Relative file path: ${file.path}`,
      props.currentPath ? `Current folder: ${props.currentPath}` : 'Current folder: root',
      'Review source quality before using this as investor-ready evidence.',
    ].join('\n'),
  })

  if (evidenceStatus.value === 'Verified' && saved.evidenceStatus !== 'Verified') {
    message.warning('Document saved as To Verify because verified evidence needs usable source metadata')
  } else {
    message.success('Document registered as data-room evidence')
  }
  resetForm()
}
</script>

<template>
  <section class="evidence-intake" aria-label="Document evidence intake">
    <div class="evidence-intake-copy">
      <p class="eyebrow">Evidence intake</p>
      <h3>Register a Document as Investor Evidence</h3>
      <p>
        Upload or select a file here, then register it as data-room evidence. This does not mark a business claim true
        by itself; it only adds a source record for Investor Readiness review.
      </p>
    </div>

    <div v-if="fileOptions.length" class="evidence-form">
      <label>
        Document
        <select v-model="selectedPath">
          <option v-for="option in fileOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label>
        Evidence area
        <select v-model="evidenceArea">
          <option v-for="area in areaOptions" :key="area.value" :value="area.value">
            {{ area.label }}
          </option>
        </select>
      </label>
      <label>
        Evidence status
        <select v-model="evidenceStatus">
          <option v-for="status in evidenceStatusOptions" :key="status">
            {{ status }}
          </option>
        </select>
      </label>
      <label>
        Checklist label
        <input v-model="checklistLabel" type="text" :placeholder="activeArea.defaultLabel" />
      </label>
      <label class="wide">
        Notes
        <textarea
          v-model="notes"
          rows="2"
          placeholder="What does this document prove, and what still needs review?"
        />
      </label>
      <NButton secondary type="primary" @click="registerEvidenceSource">
        Register evidence source
      </NButton>
      <RouterLink class="review-link" :to="{ name: 'hermes.investorReadiness' }">
        Investor Readiness
      </RouterLink>
    </div>

    <p v-else class="empty-evidence">
      No files in this folder yet. Upload documents first, then register the useful ones as evidence.
    </p>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.evidence-intake {
  display: grid;
  grid-template-columns: minmax(220px, 0.7fr) minmax(0, 1.6fr);
  gap: 12px;
  margin: 12px 16px;
  padding: 14px;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  background: $bg-card;
}

.eyebrow {
  margin: 0 0 6px;
  color: $accent-primary;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.evidence-intake-copy {
  h3 {
    margin: 0 0 8px;
    color: $text-primary;
    font-size: 15px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    font-size: 13px;
    line-height: 1.5;
  }
}

.evidence-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
  align-items: end;

  label {
    display: grid;
    gap: 5px;
    color: $text-secondary;
    font-size: 11px;
    font-weight: 900;
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
    padding: 8px 9px;
    font-size: 12px;
    text-transform: none;
  }

  textarea {
    resize: vertical;
  }

  .wide {
    grid-column: 1 / -1;
  }
}

.review-link {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid $border-color;
  border-radius: $radius-sm;
  color: $accent-info;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;

  &:hover {
    border-color: $accent-info;
    background: rgba(var(--accent-info-rgb), 0.08);
  }
}

.empty-evidence {
  align-self: center;
  margin: 0;
  color: $text-muted;
  font-size: 13px;
}

@media (max-width: 900px) {
  .evidence-intake {
    grid-template-columns: 1fr;
  }
}

@media (max-width: $breakpoint-mobile) {
  .evidence-intake {
    margin: 10px;
  }
}
</style>
