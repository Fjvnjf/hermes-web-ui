// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateSessionCaptureDraft,
  markCaptureSkipped,
  parseSessionCaptureJson,
  saveSessionCaptureSelection,
  shouldPromptForCapture,
} from '@/composables/useSessionCapture'
import type { Message } from '@/stores/hermes/chat'

const createTaskMock = vi.hoisted(() => vi.fn())
const fetchBoardsMock = vi.hoisted(() => vi.fn())
const setSelectedBoardMock = vi.hoisted(() => vi.fn())
const fetchMemoryMock = vi.hoisted(() => vi.fn())
const saveMemoryMock = vi.hoisted(() => vi.fn())
const copyToClipboardMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/hermes/kanban', () => ({
  DEFAULT_KANBAN_BOARD: 'default',
  useKanbanStore: () => ({
    selectedBoard: 'default',
    fetchBoards: fetchBoardsMock,
    resolveAvailableBoard: () => 'default',
    setSelectedBoard: setSelectedBoardMock,
    createTask: createTaskMock,
  }),
}))

vi.mock('@/api/hermes/skills', () => ({
  fetchMemory: fetchMemoryMock,
  saveMemory: saveMemoryMock,
}))

vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: copyToClipboardMock,
}))

vi.mock('naive-ui', () => ({
  useMessage: () => ({
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
  NAlert: { template: '<div class="n-alert"><slot /></div>' },
  NButton: { template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
  NCheckbox: {
    props: ['checked'],
    template: '<input class="n-checkbox" type="checkbox" :checked="checked" @change="$emit(\'update:checked\', $event.target.checked)" />',
  },
  NDrawer: { props: ['show'], template: '<div v-if="show" class="n-drawer"><slot /></div>' },
  NDrawerContent: { template: '<div class="n-drawer-content"><slot name="header" /><slot /><slot name="footer" /></div>' },
  NSelect: { props: ['value', 'options'], template: '<select class="n-select"></select>' },
  NTag: { template: '<span class="n-tag"><slot /></span>' },
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

import SessionCaptureDrawer from '@/components/session-capture/SessionCaptureDrawer.vue'

function testMessages(): Message[] {
  return [
    {
      id: 'u1',
      role: 'user',
      content: 'For Chemicon feasibility, we need to verify DMS regulatory status in China and collect CWAS SDS.',
      timestamp: Date.now(),
    },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Tasks: Verify DMS regulatory status in China. Evidence missing: CAS list and factory chemical permission. Research note: Year 1 model should use 15,000 MT/year.',
      timestamp: Date.now(),
    },
    {
      id: 'u2',
      role: 'user',
      content: 'Confirmed current launch products are CWAS 90%+ and CWMS 70%.',
      timestamp: Date.now(),
    },
  ]
}

describe('Session Capture Assistant', () => {
  beforeEach(() => {
    window.localStorage.clear()
    createTaskMock.mockReset().mockResolvedValue({ id: 'task-1' })
    fetchBoardsMock.mockReset().mockResolvedValue(undefined)
    setSelectedBoardMock.mockReset()
    fetchMemoryMock.mockReset().mockResolvedValue({ memory: 'Existing memory' })
    saveMemoryMock.mockReset().mockResolvedValue(undefined)
    copyToClipboardMock.mockReset().mockResolvedValue(true)
  })

  it('generates grouped capture suggestions from the active session', () => {
    const draft = generateSessionCaptureDraft(testMessages(), { context: 'chemicon' })

    expect(draft.context).toBe('feasibility')
    expect(draft.tasks.some(item => item.title.includes('Verify DMS'))).toBe(true)
    expect(draft.evidenceGaps.length).toBeGreaterThan(0)
    expect(draft.researchNotes.some(item => item.description.includes('15,000'))).toBe(true)
  })

  it('rejects malformed capture JSON before rendering or saving it', () => {
    expect(parseSessionCaptureJson('{not-json')).toBeNull()
    const parsed = parseSessionCaptureJson(JSON.stringify({
      sessionSummary: 'Valid structured capture',
      tasks: [{ title: 'Verify supplier quote', description: 'Confirm quote terms.', priority: 'high' }],
    }))

    expect(parsed?.tasks[0].title).toBe('Verify supplier quote')
    expect(parsed?.tasks[0].target).toBe('kanban')
  })

  it('does not repeatedly prompt after a session is skipped', () => {
    const messages = testMessages()
    expect(shouldPromptForCapture('s1', messages)).toBe(true)

    markCaptureSkipped('s1')

    expect(shouldPromptForCapture('s1', messages)).toBe(false)
  })

  it('returns copy fallback text when Kanban task creation fails', async () => {
    const draft = generateSessionCaptureDraft(testMessages(), { context: 'chemicon' })
    const task = draft.tasks[0]
    createTaskMock.mockRejectedValueOnce(new Error('board unavailable'))

    const result = await saveSessionCaptureSelection(
      draft,
      new Set([task.id]),
      { sessionId: 's1', contextLabel: 'Chemicon China Feasibility', capturedAt: new Date('2026-05-29T00:00:00Z') },
      { createTask: createTaskMock },
    )

    expect(result.createdTasks).toBe(0)
    expect(result.errors[0]).toContain('board unavailable')
    expect(result.fallbackText).toContain(task.title)
  })

  it('renders the capture drawer and saves selected Kanban tasks through the existing store', async () => {
    const wrapper = mount(SessionCaptureDrawer, {
      props: {
        show: true,
        sessionId: 'session-1',
        sessionTitle: 'Chemicon feasibility',
        messages: testMessages(),
        initialContext: 'chemicon',
      },
    })

    expect(wrapper.text()).toContain('Save useful items from this session?')
    expect(wrapper.text()).toContain('A. Tasks')

    const addButton = wrapper.findAll('button').find(button => button.text().includes('Add selected'))
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')
    await flushPromises()

    expect(fetchBoardsMock).toHaveBeenCalled()
    expect(createTaskMock).toHaveBeenCalled()
  })
})
