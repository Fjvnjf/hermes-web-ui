// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildInvestorPresentationDraft,
} from '@/utils/investorIntelligence'
import {
  generateSessionCaptureDraft,
  generateDeepResearchSuggestions,
  formatResearchSuggestionJobPrompt,
  markCaptureSkipped,
  parseSessionCaptureJson,
  saveSessionCaptureSelection,
  scheduleForResearchSuggestion,
  shouldPromptForCapture,
} from '@/composables/useSessionCapture'
import { useFeasibilityIntelligence } from '@/composables/useFeasibilityIntelligence'
import type { Message } from '@/stores/hermes/chat'

const createTaskMock = vi.hoisted(() => vi.fn())
const createJobMock = vi.hoisted(() => vi.fn())
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

vi.mock('@/stores/hermes/jobs', () => ({
  useJobsStore: () => ({
    createJob: createJobMock,
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
    info: vi.fn(),
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
    useFeasibilityIntelligence().resetFeasibilityIntelligenceForTests()
    createTaskMock.mockReset().mockResolvedValue({ id: 'task-1' })
    createJobMock.mockReset().mockResolvedValue({ id: 'job-1', job_id: 'job-1' })
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

  it('saves approved session summary to Memory without saving the full transcript by default', async () => {
    const draft = generateSessionCaptureDraft(testMessages(), { context: 'chemicon' })

    const result = await saveSessionCaptureSelection(
      draft,
      new Set(),
      { sessionId: 's1', contextLabel: 'Chemicon China Feasibility', capturedAt: new Date('2026-05-29T00:00:00Z') },
      { createTask: createTaskMock, fetchMemory: fetchMemoryMock, saveMemory: saveMemoryMock },
      { saveSessionSummary: true, transcriptMessages: testMessages(), memoryTags: ['Session Capture', 'Feasibility'] },
    )

    expect(result.savedSessionSummary).toBe(true)
    expect(result.savedFullTranscript).toBe(false)
    expect(saveMemoryMock).toHaveBeenCalledWith(
      'memory',
      expect.stringContaining('## Session Summary - Chemicon China Feasibility'),
    )
    expect(saveMemoryMock.mock.calls[0][1]).not.toContain('Full Session Transcript')
  })

  it('stages approved research notes into Research Result Review without updating readiness automatically', async () => {
    const intelligence = useFeasibilityIntelligence()
    const draft = generateSessionCaptureDraft(testMessages(), { context: 'chemicon' })
    const note = draft.researchNotes.find(item => item.description.includes('15,000'))
    expect(note).toBeTruthy()
    const source = {
      sessionId: 's1',
      sessionTitle: 'Chemicon feasibility',
      contextLabel: 'Chemicon China Feasibility',
      capturedAt: new Date('2026-05-29T00:00:00Z'),
    }

    const withoutOptIn = await saveSessionCaptureSelection(
      draft,
      new Set([note!.id]),
      source,
      {
        createTask: createTaskMock,
        fetchMemory: fetchMemoryMock,
        saveMemory: saveMemoryMock,
        stageResearchFinding: finding => intelligence.addResearchFinding(finding),
      },
    )

    expect(withoutOptIn.stagedResearchFindings).toBe(0)
    expect(intelligence.state.value.researchFindings).toHaveLength(0)

    const result = await saveSessionCaptureSelection(
      draft,
      new Set([note!.id]),
      source,
      {
        createTask: createTaskMock,
        fetchMemory: fetchMemoryMock,
        saveMemory: saveMemoryMock,
        stageResearchFinding: finding => intelligence.addResearchFinding(finding),
      },
      { stageResearchReview: true },
    )

    expect(result.stagedResearchFindings).toBe(1)
    expect(intelligence.state.value.researchFindings).toHaveLength(1)
    expect(intelligence.state.value.researchFindings[0].keyClaim).toBe(note!.title)
    expect(intelligence.state.value.researchFindings[0].status).toBe('Pending Review')
    expect(intelligence.state.value.researchFindings[0].evidenceStatus).toBe('Reference Only')
    expect(intelligence.state.value.evidenceItems.some(item => item.source?.title?.includes('Chat session'))).toBe(false)
  })

  it('stages approved report snippets as To Verify presentation material', async () => {
    const intelligence = useFeasibilityIntelligence()
    const messages: Message[] = [
      {
        id: 'u-report',
        role: 'user',
        content: 'Prepare a report section for the Chemicon investor presentation about CWAS/CWMS product plan.',
        timestamp: Date.now(),
      },
      {
        id: 'a-report',
        role: 'assistant',
        content: 'Report section: Product Plan should explain CWAS/CWMS launch products, but SDS/TDS evidence is still To Verify before investor use.',
        timestamp: Date.now(),
      },
    ]
    const draft = generateSessionCaptureDraft(messages, { context: 'chemicon' })
    const snippet = draft.reportSnippets[0]

    const result = await saveSessionCaptureSelection(
      draft,
      new Set([snippet.id]),
      { sessionId: 'report-session', sessionTitle: 'Product plan report', contextLabel: 'Chemicon China Feasibility', capturedAt: new Date('2026-05-29T00:00:00Z') },
      {
        createTask: createTaskMock,
        stagePresentationMaterial: material => intelligence.addPresentationMaterial(material),
        copyText: copyToClipboardMock,
      },
    )

    expect(result.stagedPresentationItems).toBe(1)
    expect(result.copiedItems).toBe(0)
    expect(intelligence.state.value.presentationMaterials[0].section).toBe('Product Plan')
    expect(intelligence.state.value.presentationMaterials[0].evidenceStatus).toBe('To Verify')
    expect(intelligence.state.value.presentationMaterials[0].content).toContain('Review required before investor use')
    expect(buildInvestorPresentationDraft(intelligence.state.value.presentationMaterials)).toHaveLength(0)
  })

  it('generates deeper research suggestions that can be scheduled or saved as manual research tasks', () => {
    const suggestions = generateDeepResearchSuggestions(testMessages(), 'chemicon')

    expect(suggestions.some(item => item.title.includes('DMS regulation'))).toBe(true)
    expect(suggestions[0].expectedOutput).toContain('Source-backed')
  })

  it('builds one-shot schedule and safe prompt text for scheduled research jobs', () => {
    const suggestion = generateDeepResearchSuggestions(testMessages(), 'chemicon')[0]
    const schedule = scheduleForResearchSuggestion('Tonight', new Date('2026-05-30T12:30:00'))
    const prompt = formatResearchSuggestionJobPrompt(suggestion, {
      sessionId: 'session-1',
      sessionTitle: 'Chemicon feasibility',
      contextLabel: 'Chemicon China Feasibility',
      capturedAt: new Date('2026-05-30T12:30:00'),
    })

    expect(schedule).toBe('2026-05-30T22:00:00')
    expect(prompt).toContain('Separate Verified, User Provided, Assumption, To Verify, Hypothesis, and Reference Only material')
    expect(prompt).toContain('Do not update Memory, investor readiness, market claims, competitor records, or presentation material automatically.')
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
    expect(wrapper.text()).toContain('Research Result Review')

    const addButton = wrapper.findAll('button').find(button => button.text().includes('Add selected'))
    expect(addButton).toBeTruthy()
    await addButton!.trigger('click')
    await flushPromises()

    expect(fetchBoardsMock).toHaveBeenCalled()
    expect(createTaskMock).toHaveBeenCalled()
  })

  it('schedules approved deep research suggestions as Hermes Jobs and records the source job id', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(SessionCaptureDrawer, {
      props: {
        show: true,
        sessionId: 'session-1',
        sessionTitle: 'Chemicon feasibility',
        messages: testMessages(),
        initialContext: 'chemicon',
      },
    })

    const researchButton = wrapper.findAll('button').find(button => button.text().includes('Yes, schedule Hermes job'))
    expect(researchButton).toBeTruthy()
    await researchButton!.trigger('click')
    await flushPromises()

    expect(createJobMock).toHaveBeenCalledWith(expect.objectContaining({
      deliver: 'local',
      repeat: 1,
      name: expect.stringContaining('Research: DMS regulation'),
      prompt: expect.stringContaining('Do not invent market size'),
    }))
    expect(createTaskMock).not.toHaveBeenCalled()
    const job = intelligence.state.value.researchJobs.find(item => item.title.includes('DMS regulation'))
    expect(job).toBeTruthy()
    expect(job?.scope).toContain('Regulatory classification')
    expect(job?.expectedOutput).toContain('Source-backed')
    expect(job?.sourceRequirements).toContain('Separate verified facts')
    expect(job?.priority).toBe('high')
    expect(job?.schedulePreference).toBe('Tonight')
    expect(job?.scheduledJobId).toBe('job-1')
    expect(job?.status).toBe('Scheduled Hermes Job')
  })

  it('falls back to a Kanban research task when scheduling a Hermes Job fails', async () => {
    const intelligence = useFeasibilityIntelligence()
    createJobMock.mockRejectedValueOnce(new Error('cron unavailable'))
    const wrapper = mount(SessionCaptureDrawer, {
      props: {
        show: true,
        sessionId: 'session-1',
        sessionTitle: 'Chemicon feasibility',
        messages: testMessages(),
        initialContext: 'chemicon',
      },
    })

    const researchButton = wrapper.findAll('button').find(button => button.text().includes('Yes, schedule Hermes job'))
    expect(researchButton).toBeTruthy()
    await researchButton!.trigger('click')
    await flushPromises()

    expect(createJobMock).toHaveBeenCalled()
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('Research: DMS regulation'),
      body: expect.stringContaining('Scheduling attempt failed: cron unavailable'),
    }))
    const job = intelligence.state.value.researchJobs.find(item => item.title.includes('DMS regulation'))
    expect(job?.status).toBe('Task Created')
    expect(job?.scheduledJobId).toBeUndefined()
  })

  it('records manually created deep research tasks in the shared feasibility intelligence queue', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(SessionCaptureDrawer, {
      props: {
        show: true,
        sessionId: 'session-1',
        sessionTitle: 'Chemicon feasibility',
        messages: testMessages(),
        initialContext: 'chemicon',
      },
    })

    const taskButton = wrapper.findAll('button').find(button => button.text().includes('Create task instead'))
    expect(taskButton).toBeTruthy()
    await taskButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).toHaveBeenCalled()
    expect(createJobMock).not.toHaveBeenCalled()
    const job = intelligence.state.value.researchJobs.find(item => item.title.includes('DMS regulation'))
    expect(job?.status).toBe('Task Created')
    expect(job?.scope).toContain('Regulatory classification')
  })

  it('saves deferred deep research suggestions as Later jobs without creating a task', async () => {
    const intelligence = useFeasibilityIntelligence()
    const wrapper = mount(SessionCaptureDrawer, {
      props: {
        show: true,
        sessionId: 'session-1',
        sessionTitle: 'Chemicon feasibility',
        messages: testMessages(),
        initialContext: 'chemicon',
      },
    })

    const laterButton = wrapper.findAll('button').find(button => button.text() === 'Later')
    expect(laterButton).toBeTruthy()
    await laterButton!.trigger('click')
    await flushPromises()

    expect(createTaskMock).not.toHaveBeenCalled()
    const job = intelligence.state.value.researchJobs.find(item => item.status === 'Later' && item.title.includes('DMS regulation'))
    expect(job).toBeTruthy()
    expect(job?.scope).toContain('Regulatory classification')
    expect(job?.sourceRequirements).toContain('Separate verified facts')
  })
})
