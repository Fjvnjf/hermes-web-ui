// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FileEvidenceIntakePanel from '@/components/hermes/files/FileEvidenceIntakePanel.vue'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import type { FileEntry } from '@/api/hermes/files'

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  NButton: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    RouterLink: {
      props: ['to'],
      template: '<a class="router-link"><slot /></a>',
    },
  }
})

const sourceEntries: FileEntry[] = [
  {
    name: 'product-sds.pdf',
    path: 'evidence/product-sds.pdf',
    isDir: false,
    size: 1024,
    modTime: '2026-05-30T08:00:00.000Z',
  },
  {
    name: 'archive',
    path: 'evidence/archive',
    isDir: true,
    size: 0,
    modTime: '2026-05-29T08:00:00.000Z',
  },
]

describe('FileEvidenceIntakePanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
  })

  it('registers a selected document as source-backed data-room evidence', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(FileEvidenceIntakePanel, {
      props: {
        entries: sourceEntries,
        currentPath: 'evidence',
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    await wrapper.find('select').setValue('evidence/product-sds.pdf')
    await wrapper.findAll('select')[1].setValue('product')
    await wrapper.findAll('select')[2].setValue('Verified')
    await wrapper.find('input').setValue('CWAS SDS evidence')
    await wrapper.find('textarea').setValue('SDS uploaded for product evidence review.')
    await wrapper.find('button').trigger('click')

    expect(intelligence.state.value.dataRoomSources).toHaveLength(1)
    expect(intelligence.state.value.dataRoomSources[0]).toMatchObject({
      checklistLabel: 'CWAS SDS evidence',
      area: 'product',
      evidenceStatus: 'Verified',
      source: {
        title: 'Document: product-sds.pdf',
        date: '2026-05-30',
      },
    })
    expect(intelligence.state.value.dataRoomSources[0].notes).toContain('Relative file path: evidence/product-sds.pdf')
    expect(intelligence.state.value.evidenceItems.find(item => item.id === 'product')?.evidenceStatus).toBe('Verified')
  })

  it('does not offer folders as evidence files and shows empty guidance without files', () => {
    const wrapper = mount(FileEvidenceIntakePanel, {
      props: {
        entries: [sourceEntries[1]],
        currentPath: 'evidence',
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    expect(wrapper.text()).toContain('No files in this folder yet')
    expect(wrapper.text()).not.toContain('archive')
  })
})
