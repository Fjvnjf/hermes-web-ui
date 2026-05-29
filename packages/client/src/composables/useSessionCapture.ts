import type { Message } from '@/stores/hermes/chat'

export type CaptureContextId =
  | 'chemicon'
  | 'general-research'
  | 'product-research'
  | 'manufacturing-research'
  | 'market-research'
  | 'investment-research'
  | 'regulatory-research'
  | 'personal-research'
  | 'other-project'

export type CaptureCategory =
  | 'tasks'
  | 'evidenceGaps'
  | 'researchNotes'
  | 'memoryCandidates'
  | 'reportSnippets'

export type CapturePriority = 'high' | 'medium' | 'low'
export type CaptureEvidenceStatus = 'To Verify' | 'Assumption' | 'User Provided' | 'Missing' | 'Research Note' | 'Hypothesis'

export interface CaptureContextOption {
  label: string
  value: CaptureContextId
}

export interface CaptureSuggestion {
  id: string
  category: CaptureCategory
  title: string
  description: string
  priority?: CapturePriority
  evidenceStatus: CaptureEvidenceStatus
  recommendedAction: string
  target: 'kanban' | 'memory' | 'copy'
  defaultSelected: boolean
  confidence?: CapturePriority
  sourceMessageId?: string
}

export interface SessionCaptureDraft {
  sessionSummary: string
  context: 'feasibility' | 'research' | 'general'
  tasks: CaptureSuggestion[]
  evidenceGaps: CaptureSuggestion[]
  researchNotes: CaptureSuggestion[]
  memoryCandidates: CaptureSuggestion[]
  reportSnippets: CaptureSuggestion[]
}

export interface CaptureReviewState {
  reviewed?: boolean
  skipped?: boolean
  lastCaptureAt?: number
}

export interface SessionCaptureSource {
  sessionId: string
  sessionTitle?: string
  contextLabel: string
  capturedAt?: Date
}

export interface SaveCaptureDeps {
  createTask: (data: { title: string; body?: string; priority?: number; tenant?: string }) => Promise<{ id?: string }>
  fetchMemory?: () => Promise<{ memory?: string }>
  saveMemory?: (section: 'memory' | 'user' | 'soul', content: string) => Promise<void>
  copyText?: (text: string) => Promise<boolean>
}

export interface SaveCaptureResult {
  createdTasks: number
  savedMemoryItems: number
  copiedItems: number
  fallbackText: string
  errors: string[]
}

const CAPTURE_STATE_KEY = 'hermes.sessionCapture.state.v1'
const MAX_TEXT_LENGTH = 280

export const captureContextOptions: CaptureContextOption[] = [
  { label: 'Chemicon China Feasibility', value: 'chemicon' },
  { label: 'General Research', value: 'general-research' },
  { label: 'Product Research', value: 'product-research' },
  { label: 'Manufacturing Research', value: 'manufacturing-research' },
  { label: 'Market / Competitor Research', value: 'market-research' },
  { label: 'Investment Research', value: 'investment-research' },
  { label: 'Regulatory Research', value: 'regulatory-research' },
  { label: 'Personal Research', value: 'personal-research' },
  { label: 'Other Project', value: 'other-project' },
]

const contextLabels = new Map(captureContextOptions.map(item => [item.value, item.label]))

const taskTerms = [
  'verify',
  'confirm',
  'collect',
  'upload',
  'request',
  'create',
  'track',
  'check',
  'prepare',
  'follow up',
  'interview',
  'validate',
  'compare',
  'review',
]

const evidenceTerms = [
  'missing',
  'evidence',
  'proof',
  'not verified',
  'needed',
  'need proof',
  'license',
  'sds',
  'tds',
  'cas',
  'quote',
  'regulatory',
  'permission',
  'approval',
]

const researchTerms = [
  '15,000',
  '15000',
  '60,000',
  '60000',
  'assumption',
  'model',
  'strategy',
  'scenario',
  'market',
  'manufacturing',
  'product',
  'feasibility',
  'chemicon',
]

function safeStorageRead(): Record<string, CaptureReviewState> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CAPTURE_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, CaptureReviewState> : {}
  } catch {
    return {}
  }
}

function safeStorageWrite(value: Record<string, CaptureReviewState>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CAPTURE_STATE_KEY, JSON.stringify(value))
  } catch {
    // Capture review prompts are convenience state; ignore storage failures.
  }
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripMarkdown(value: string): string {
  return compactWhitespace(
    value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_>~-]+/g, ' '),
  )
}

function textFromMessage(message: Message): string {
  if (!message.content || message.role === 'tool' || message.role === 'system' || message.role === 'command') return ''
  return stripMarkdown(message.content)
}

function truncate(value: string, max = MAX_TEXT_LENGTH): string {
  const trimmed = compactWhitespace(value)
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1).trim()}...`
}

function sentenceCandidates(messages: Message[]): Array<{ text: string; message: Message }> {
  const candidates: Array<{ text: string; message: Message }> = []
  for (const message of messages.slice(-24)) {
    const text = textFromMessage(message)
    if (!text) continue
    const lines = text
      .split(/(?:\n|[.!?]\s+)/)
      .map(line => truncate(line.replace(/^[-*\d.)\s]+/, ''), 220))
      .filter(line => line.length >= 18)
    for (const line of lines.slice(0, 10)) {
      candidates.push({ text: line, message })
    }
  }
  return candidates
}

function includesAny(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase()
  return terms.some(term => lower.includes(term))
}

function titleFromSentence(value: string): string {
  const cleaned = truncate(value, 96)
    .replace(/^(we|you|i|hermes)\s+(should|need to|must|can)\s+/i, '')
    .replace(/^(need to|should|must)\s+/i, '')
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function priorityFor(text: string, category: CaptureCategory): CapturePriority {
  const lower = text.toLowerCase()
  if (
    category === 'evidenceGaps' ||
    lower.includes('regulatory') ||
    lower.includes('permission') ||
    lower.includes('factory') ||
    lower.includes('finance') ||
    lower.includes('investment') ||
    lower.includes('license') ||
    lower.includes('sds')
  ) {
    return 'high'
  }
  if (lower.includes('research') || lower.includes('compare') || lower.includes('collect')) return 'medium'
  return 'low'
}

function evidenceStatusFor(text: string, category: CaptureCategory): CaptureEvidenceStatus {
  const lower = text.toLowerCase()
  if (category === 'researchNotes') return lower.includes('assumption') ? 'Assumption' : 'Research Note'
  if (category === 'memoryCandidates') return lower.includes('confirmed') ? 'User Provided' : 'To Verify'
  if (lower.includes('missing')) return 'Missing'
  if (lower.includes('assumption')) return 'Assumption'
  return 'To Verify'
}

function makeSuggestion(
  category: CaptureCategory,
  text: string,
  message: Message,
  index: number,
): CaptureSuggestion {
  const priority = priorityFor(text, category)
  const title = category === 'memoryCandidates'
    ? titleFromSentence(text).replace(/^Remember\s+/i, '')
    : titleFromSentence(text)
  const target = category === 'tasks' || category === 'evidenceGaps'
    ? 'kanban'
    : category === 'reportSnippets'
      ? 'copy'
      : 'memory'
  return {
    id: `${category}-${message.id || index}-${index}`,
    category,
    title,
    description: truncate(text),
    priority: category === 'tasks' || category === 'evidenceGaps' ? priority : undefined,
    evidenceStatus: evidenceStatusFor(text, category),
    recommendedAction: category === 'evidenceGaps'
      ? 'Track the missing proof as a Kanban task and attach evidence in Documents when available.'
      : category === 'tasks'
        ? 'Create a Kanban task and verify the outcome before treating it as fact.'
        : category === 'reportSnippets'
          ? 'Copy into a draft file or Reports Hub outline after review.'
          : 'Save only if this is durable and useful across future sessions.',
    target,
    defaultSelected: category === 'tasks' || category === 'evidenceGaps',
    confidence: priority,
    sourceMessageId: String(message.id || ''),
  }
}

function uniqueByTitle(items: CaptureSuggestion[]): CaptureSuggestion[] {
  const seen = new Set<string>()
  const result: CaptureSuggestion[] = []
  for (const item of items) {
    const key = item.title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function inferDraftContext(messages: Message[], fallback?: CaptureContextId): SessionCaptureDraft['context'] {
  if (fallback === 'chemicon') return 'feasibility'
  if (fallback && fallback !== 'other-project') return 'research'
  const text = messages.map(textFromMessage).join(' ').toLowerCase()
  if (text.includes('chemicon') || text.includes('feasibility') || text.includes('15,000') || text.includes('15000')) {
    return 'feasibility'
  }
  if (text.includes('research') || text.includes('market') || text.includes('product') || text.includes('regulatory')) {
    return 'research'
  }
  return 'general'
}

export function contextLabel(context: CaptureContextId): string {
  return contextLabels.get(context) || 'General Research'
}

export function inferCaptureContext(messages: Message[], sessionTitle = '', routeContext?: string | null): CaptureContextId {
  if (routeContext && captureContextOptions.some(option => option.value === routeContext)) {
    return routeContext as CaptureContextId
  }
  const text = `${sessionTitle} ${messages.map(textFromMessage).join(' ')}`.toLowerCase()
  if (text.includes('chemicon') || text.includes('feasibility') || text.includes('15,000') || text.includes('15000')) return 'chemicon'
  if (text.includes('product')) return 'product-research'
  if (text.includes('manufacturing') || text.includes('factory') || text.includes('plant')) return 'manufacturing-research'
  if (text.includes('market') || text.includes('competitor') || text.includes('customer')) return 'market-research'
  if (text.includes('investment') || text.includes('investor') || text.includes('finance')) return 'investment-research'
  if (text.includes('regulatory') || text.includes('license') || text.includes('permission')) return 'regulatory-research'
  if (text.includes('personal')) return 'personal-research'
  return 'general-research'
}

export function isMeaningfulCaptureSession(messages: Message[]): boolean {
  const visible = messages.filter(message => message.role === 'user' || message.role === 'assistant')
  const textLength = visible.reduce((sum, message) => sum + textFromMessage(message).length, 0)
  return visible.length >= 3 || textLength >= 600
}

export function generateSessionCaptureDraft(
  messages: Message[],
  options: { context?: CaptureContextId; sessionTitle?: string } = {},
): SessionCaptureDraft {
  const candidates = sentenceCandidates(messages)
  const tasks = uniqueByTitle(
    candidates
      .filter(item => includesAny(item.text, taskTerms))
      .map((item, index) => makeSuggestion('tasks', item.text, item.message, index)),
  ).slice(0, 6)
  const evidenceGaps = uniqueByTitle(
    candidates
      .filter(item => includesAny(item.text, evidenceTerms))
      .map((item, index) => makeSuggestion('evidenceGaps', item.text, item.message, index)),
  ).slice(0, 6)
  const researchNotes = uniqueByTitle(
    candidates
      .filter(item => includesAny(item.text, researchTerms))
      .map((item, index) => makeSuggestion('researchNotes', item.text, item.message, index)),
  ).slice(0, 5)
  const memoryCandidates = uniqueByTitle(
    candidates
      .filter(item => {
        const lower = item.text.toLowerCase()
        return lower.includes('confirmed') || lower.includes('prefers') || lower.includes('preference') || lower.includes('current launch')
      })
      .map((item, index) => {
        const suggestion = makeSuggestion('memoryCandidates', item.text, item.message, index)
        suggestion.defaultSelected = suggestion.confidence === 'high' && item.text.toLowerCase().includes('confirmed')
        return suggestion
      }),
  ).slice(0, 4)
  const reportSnippets = uniqueByTitle(
    candidates
      .filter(item => {
        const lower = item.text.toLowerCase()
        return lower.includes('report') || lower.includes('draft') || lower.includes('summary') || lower.includes('section')
      })
      .map((item, index) => makeSuggestion('reportSnippets', item.text, item.message, index)),
  ).slice(0, 4)

  const firstUseful = candidates.find(item => item.message.role === 'assistant') || candidates[0]
  const summary = firstUseful
    ? truncate(firstUseful.text, 180)
    : options.sessionTitle || 'No useful capture text found in the current session yet.'

  return {
    sessionSummary: summary,
    context: inferDraftContext(messages, options.context),
    tasks,
    evidenceGaps,
    researchNotes,
    memoryCandidates,
    reportSnippets,
  }
}

export function flattenCaptureDraft(draft: SessionCaptureDraft): CaptureSuggestion[] {
  return [
    ...draft.tasks,
    ...draft.evidenceGaps,
    ...draft.researchNotes,
    ...draft.memoryCandidates,
    ...draft.reportSnippets,
  ]
}

export function getCaptureReviewState(sessionId?: string | null): CaptureReviewState {
  if (!sessionId) return {}
  return safeStorageRead()[sessionId] || {}
}

export function markCaptureReviewed(sessionId: string, patch: CaptureReviewState = {}) {
  const state = safeStorageRead()
  state[sessionId] = {
    ...state[sessionId],
    ...patch,
    reviewed: patch.reviewed ?? true,
    lastCaptureAt: Date.now(),
  }
  safeStorageWrite(state)
}

export function markCaptureSkipped(sessionId: string) {
  markCaptureReviewed(sessionId, { skipped: true, reviewed: true })
}

export function shouldPromptForCapture(sessionId: string | null | undefined, messages: Message[]): boolean {
  if (!sessionId || !isMeaningfulCaptureSession(messages)) return false
  const state = getCaptureReviewState(sessionId)
  return !state.reviewed && !state.skipped
}

function priorityNumber(priority?: CapturePriority): number {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function sourceLabel(source: SessionCaptureSource): string {
  const timestamp = source.capturedAt || new Date()
  return [
    `Source: Chat session${source.sessionId ? ` ${source.sessionId}` : ''}`,
    `Captured at: ${timestamp.toLocaleString()}`,
    `Context/project: ${source.contextLabel}`,
    'Captured by Session Capture Assistant',
  ].join('\n')
}

export function formatCaptureSuggestionText(item: CaptureSuggestion, source: SessionCaptureSource): string {
  const base = [
    `Title: ${item.title}`,
    `Category: ${categoryLabel(item.category)}`,
    `Target: ${item.target}`,
    `Evidence status: ${item.evidenceStatus}`,
    item.priority ? `Priority: ${item.priority}` : '',
    `Recommended action: ${item.recommendedAction}`,
    '',
    item.description,
    '',
    sourceLabel(source),
  ].filter(Boolean)
  return base.join('\n')
}

export function categoryLabel(category: CaptureCategory): string {
  switch (category) {
    case 'tasks':
      return 'Tasks'
    case 'evidenceGaps':
      return 'Evidence Gaps'
    case 'researchNotes':
      return 'Research Notes'
    case 'memoryCandidates':
      return 'Memory Candidates'
    case 'reportSnippets':
      return 'Report Snippets'
  }
}

export async function saveSessionCaptureSelection(
  draft: SessionCaptureDraft,
  selectedIds: Set<string>,
  source: SessionCaptureSource,
  deps: SaveCaptureDeps,
): Promise<SaveCaptureResult> {
  const selected = flattenCaptureDraft(draft).filter(item => selectedIds.has(item.id))
  const result: SaveCaptureResult = {
    createdTasks: 0,
    savedMemoryItems: 0,
    copiedItems: 0,
    fallbackText: '',
    errors: [],
  }
  const memoryItems: CaptureSuggestion[] = []
  const copyItems: CaptureSuggestion[] = []

  for (const item of selected) {
    if (item.target === 'kanban') {
      try {
        await deps.createTask({
          title: item.title,
          body: formatCaptureSuggestionText(item, source),
          priority: priorityNumber(item.priority),
          tenant: source.contextLabel,
        })
        result.createdTasks += 1
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown task creation error'
        result.errors.push(`${item.title}: ${detail}`)
        result.fallbackText += `${formatCaptureSuggestionText(item, source)}\n\n`
      }
    } else if (item.target === 'memory') {
      memoryItems.push(item)
    } else {
      copyItems.push(item)
    }
  }

  if (memoryItems.length > 0) {
    if (!deps.fetchMemory || !deps.saveMemory) {
      result.errors.push('Memory save is unavailable in this runtime. Use Copy all instead.')
      result.fallbackText += memoryItems.map(item => formatCaptureSuggestionText(item, source)).join('\n\n')
    } else {
      try {
        const current = await deps.fetchMemory()
        const existing = current.memory?.trim() || ''
        const addition = [
          `## Session Capture - ${source.contextLabel}`,
          '',
          sourceLabel(source),
          '',
          ...memoryItems.map(item => [
            `### ${item.title}`,
            `Evidence status: ${item.evidenceStatus}`,
            item.description,
            `Recommended action: ${item.recommendedAction}`,
          ].join('\n')),
        ].join('\n\n')
        await deps.saveMemory('memory', existing ? `${existing}\n\n${addition}` : addition)
        result.savedMemoryItems = memoryItems.length
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown memory save error'
        result.errors.push(`Memory save failed: ${detail}`)
        result.fallbackText += memoryItems.map(item => formatCaptureSuggestionText(item, source)).join('\n\n')
      }
    }
  }

  if (copyItems.length > 0) {
    const text = copyItems.map(item => formatCaptureSuggestionText(item, source)).join('\n\n')
    result.fallbackText += `${text}\n\n`
    if (deps.copyText) {
      try {
        const copied = await deps.copyText(text)
        if (copied) result.copiedItems = copyItems.length
      } catch {
        // The fallback text is still returned for manual copy.
      }
    }
  }

  return result
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeSuggestionFromJson(category: CaptureCategory, value: unknown, index: number): CaptureSuggestion | null {
  if (!isStringRecord(value)) return null
  const title = typeof value.title === 'string'
    ? value.title
    : typeof value.fact === 'string'
      ? value.fact
      : typeof value.section === 'string'
        ? value.section
        : ''
  const description = typeof value.description === 'string'
    ? value.description
    : typeof value.content === 'string'
      ? value.content
      : typeof value.reason === 'string'
        ? value.reason
        : ''
  if (!title.trim() && !description.trim()) return null
  const priority = value.priority === 'high' || value.priority === 'medium' || value.priority === 'low'
    ? value.priority
    : priorityFor(`${title} ${description}`, category)
  const evidenceStatus = typeof value.evidenceStatus === 'string'
    ? value.evidenceStatus as CaptureEvidenceStatus
    : evidenceStatusFor(`${title} ${description}`, category)
  return {
    id: `json-${category}-${index}`,
    category,
    title: truncate(title || description, 96),
    description: truncate(description || title),
    priority: category === 'tasks' || category === 'evidenceGaps' ? priority : undefined,
    evidenceStatus,
    recommendedAction: typeof value.recommendedAction === 'string' ? value.recommendedAction : 'Review before saving.',
    target: category === 'tasks' || category === 'evidenceGaps' ? 'kanban' : category === 'reportSnippets' ? 'copy' : 'memory',
    defaultSelected: category === 'tasks' || category === 'evidenceGaps',
    confidence: value.confidence === 'high' || value.confidence === 'medium' || value.confidence === 'low' ? value.confidence : priority,
  }
}

export function parseSessionCaptureJson(raw: string): SessionCaptureDraft | null {
  try {
    const parsed = JSON.parse(raw)
    if (!isStringRecord(parsed)) return null
    const readList = (key: CaptureCategory) => Array.isArray(parsed[key])
      ? (parsed[key] as unknown[]).map((item, index) => safeSuggestionFromJson(key, item, index)).filter((item): item is CaptureSuggestion => Boolean(item))
      : []
    return {
      sessionSummary: typeof parsed.sessionSummary === 'string' ? truncate(parsed.sessionSummary, 180) : 'Structured capture suggestions',
      context: parsed.context === 'feasibility' || parsed.context === 'research' || parsed.context === 'general' ? parsed.context : 'general',
      tasks: readList('tasks'),
      evidenceGaps: readList('evidenceGaps'),
      researchNotes: readList('researchNotes'),
      memoryCandidates: readList('memoryCandidates'),
      reportSnippets: readList('reportSnippets'),
    }
  } catch {
    return null
  }
}
