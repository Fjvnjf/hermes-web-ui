import type { Message } from '@/stores/hermes/chat'
import type { EvidenceArea, ResearchReviewStatus } from '@/composables/useFeasibilityIntelligence'
import type { IntelligenceEvidenceStatus, SourceReference } from '@/utils/investorIntelligence'

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
  stageResearchFinding?: (finding: CaptureResearchFindingPayload) => unknown
  stagePresentationMaterial?: (material: {
    section: string
    content: string
    evidenceStatus: 'To Verify'
    source?: { title: string; date?: string } | null
  }) => unknown
}

export interface SaveCaptureResult {
  createdTasks: number
  createdResearchTasks: number
  savedMemoryItems: number
  savedSessionSummary: boolean
  savedFullTranscript: boolean
  stagedResearchFindings: number
  stagedPresentationItems: number
  copiedItems: number
  fallbackText: string
  errors: string[]
}

export interface SaveSessionCaptureOptions {
  saveSessionSummary?: boolean
  saveFullTranscript?: boolean
  stageResearchReview?: boolean
  transcriptMessages?: Message[]
  memoryTags?: string[]
  summaryEvidenceStatus?: CaptureEvidenceStatus
}

export interface CaptureResearchFindingPayload {
  summary: string
  keyClaim: string
  area: EvidenceArea
  evidenceStatus: IntelligenceEvidenceStatus
  confidence: 'low' | 'medium' | 'high'
  source?: SourceReference | null
  suggestedTask?: string
  suggestedInvestorMaterial?: string
  riskNote?: string
  status?: ResearchReviewStatus
}

export interface DeepResearchSuggestion {
  id: string
  title: string
  researchQuestion: string
  scope: string
  expectedOutput: string
  sourceRequirements: string
  priority: CapturePriority
  contextLabel: string
  schedulePreference: 'Tonight' | 'Tomorrow morning' | 'Custom'
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

export function generateConciseSessionSummary(messages: Message[], sessionTitle = ''): string {
  const candidates = sentenceCandidates(messages)
  const userGoal = candidates.find(item => item.message.role === 'user')?.text
  const assistantOutcome = candidates.find(item => item.message.role === 'assistant')?.text
  const taskLine = candidates.find(item => includesAny(item.text, taskTerms))?.text
  const evidenceLine = candidates.find(item => includesAny(item.text, evidenceTerms))?.text
  const parts = [
    sessionTitle ? `Session: ${truncate(sessionTitle, 80)}` : '',
    userGoal ? `User focus: ${truncate(userGoal, 160)}` : '',
    assistantOutcome ? `Useful outcome: ${truncate(assistantOutcome, 180)}` : '',
    taskLine ? `Potential next action: ${truncate(taskLine, 140)}` : '',
    evidenceLine && evidenceLine !== taskLine ? `Evidence note: ${truncate(evidenceLine, 140)}` : '',
  ].filter(Boolean)
  if (parts.length > 0) return parts.join('\n')
  return 'No concise summary could be generated from the current active session yet.'
}

export function formatFullTranscript(messages: Message[]): string {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => {
      const role = message.role === 'assistant' ? 'Hermes' : 'User'
      return `### ${role}\n${textFromMessage(message)}`
    })
    .filter(block => block.trim().length > 10)
    .join('\n\n')
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

export function formatSessionSummaryMemory(
  summary: string,
  source: SessionCaptureSource,
  options: Pick<SaveSessionCaptureOptions, 'memoryTags' | 'summaryEvidenceStatus'> = {},
): string {
  return [
    `## Session Summary - ${source.contextLabel}`,
    '',
    sourceLabel(source),
    `Evidence status: ${options.summaryEvidenceStatus || 'Research Note'}`,
    `Tags: ${(options.memoryTags?.length ? options.memoryTags : ['Session Capture', source.contextLabel]).join(', ')}`,
    '',
    summary,
  ].join('\n')
}

export function formatFullTranscriptMemory(messages: Message[], source: SessionCaptureSource): string {
  return [
    `## Full Session Transcript - ${source.contextLabel}`,
    '',
    sourceLabel(source),
    'Evidence status: Research Note',
    'Tags: Session Capture, Full Transcript, Not Recommended',
    '',
    'Note: Full transcript was saved only because the user explicitly selected this option.',
    '',
    formatFullTranscript(messages),
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

export function sectionForReportSnippet(item: CaptureSuggestion): string {
  const text = `${item.title} ${item.description}`.toLowerCase()
  if (text.includes('competitor')) return 'Competitor Landscape'
  if (text.includes('market') || text.includes('customer') || text.includes('demand') || text.includes('price')) return 'Market Evidence'
  if (text.includes('regulatory') || text.includes('dms') || text.includes('permission') || text.includes('license')) return 'Regulatory Plan'
  if (text.includes('factory') || text.includes('manufacturing') || text.includes('plant') || text.includes('machine')) return 'Manufacturing Plan'
  if (text.includes('product') || text.includes('cwas') || text.includes('cwms') || text.includes('sds') || text.includes('tds')) return 'Product Plan'
  if (text.includes('irr') || text.includes('npv') || text.includes('return') || text.includes('financial')) return 'IRR / Investor Return'
  if (text.includes('risk')) return 'Risk & Mitigation'
  if (text.includes('fund')) return 'Use of Funds'
  return 'Executive Summary'
}

export function formatReportSnippetMaterial(item: CaptureSuggestion, source: SessionCaptureSource): {
  section: string
  content: string
  evidenceStatus: 'To Verify'
  source: { title: string; date?: string }
} {
  const capturedAt = source.capturedAt || new Date()
  return {
    section: sectionForReportSnippet(item),
    content: [
      item.description,
      '',
      `Source session: ${source.sessionId || 'current'}`,
      `Context/project: ${source.contextLabel}`,
      'Captured by Session Capture Assistant',
      'Evidence status: To Verify',
      'Review required before investor use.',
    ].join('\n'),
    evidenceStatus: 'To Verify',
    source: {
      title: `Session Capture${source.sessionTitle ? ` - ${source.sessionTitle}` : ''}`,
      date: capturedAt.toISOString().slice(0, 10),
    },
  }
}

function captureStatusToIntelligenceStatus(status: CaptureEvidenceStatus): IntelligenceEvidenceStatus {
  if (status === 'Research Note') return 'Reference Only'
  return status
}

function areaForCaptureSuggestion(item: CaptureSuggestion): EvidenceArea {
  const text = `${item.title} ${item.description} ${item.recommendedAction}`.toLowerCase()
  if (text.includes('company') || text.includes('legal') || text.includes('business license') || text.includes('bank') || text.includes('import/export')) {
    return 'companyLegal'
  }
  if (text.includes('product') || text.includes('cwas') || text.includes('cwms') || text.includes('sds') || text.includes('tds') || text.includes('cas')) {
    return 'product'
  }
  if (text.includes('factory') || text.includes('plant') || text.includes('manufacturing') || text.includes('machine') || text.includes('capacity') || text.includes('utility')) {
    return 'factory'
  }
  if (text.includes('regulatory') || text.includes('dms') || text.includes('permission') || text.includes('permit') || text.includes('approval')) {
    return 'regulatory'
  }
  if (text.includes('finance') || text.includes('financial') || text.includes('investment') || text.includes('investor') || text.includes('irr') || text.includes('npv') || text.includes('model')) {
    return 'financial'
  }
  if (text.includes('presentation') || text.includes('deck') || text.includes('report')) {
    return 'presentation'
  }
  return 'market'
}

function canStageForResearchReview(item: CaptureSuggestion): boolean {
  return item.category === 'evidenceGaps' || item.category === 'researchNotes' || item.category === 'memoryCandidates'
}

export function formatCaptureResearchFinding(
  item: CaptureSuggestion,
  source: SessionCaptureSource,
): CaptureResearchFindingPayload {
  const capturedAt = source.capturedAt || new Date()
  const evidenceStatus = captureStatusToIntelligenceStatus(item.evidenceStatus)
  return {
    summary: [
      item.description,
      '',
      `Recommended action: ${item.recommendedAction}`,
      `Category: ${categoryLabel(item.category)}`,
      `Context/project: ${source.contextLabel}`,
      `Source session: ${source.sessionId || 'current'}`,
      'Captured by Session Capture Assistant',
      'Review required before this changes readiness, market evidence, or investor material.',
    ].join('\n'),
    keyClaim: item.title,
    area: areaForCaptureSuggestion(item),
    evidenceStatus,
    confidence: item.confidence || item.priority || 'medium',
    source: {
      title: `Chat session${source.sessionTitle ? ` - ${source.sessionTitle}` : ''}`,
      date: capturedAt.toISOString().slice(0, 10),
    },
    suggestedTask: item.category === 'evidenceGaps' ? item.recommendedAction : '',
    suggestedInvestorMaterial: '',
    riskNote: 'Captured from a conversation. Keep as Pending Review / To Verify until source documents or user approval support it.',
    status: evidenceStatus === 'Missing' || evidenceStatus === 'To Verify' ? 'To Verify' : 'Pending Review',
  }
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
  options: SaveSessionCaptureOptions = {},
): Promise<SaveCaptureResult> {
  const selected = flattenCaptureDraft(draft).filter(item => selectedIds.has(item.id))
  const result: SaveCaptureResult = {
    createdTasks: 0,
    createdResearchTasks: 0,
    savedMemoryItems: 0,
    savedSessionSummary: false,
    savedFullTranscript: false,
    stagedResearchFindings: 0,
    stagedPresentationItems: 0,
    copiedItems: 0,
    fallbackText: '',
    errors: [],
  }
  const memoryItems: CaptureSuggestion[] = []
  const copyItems: CaptureSuggestion[] = []
  const researchReviewItems: CaptureSuggestion[] = []

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
      if (item.category === 'reportSnippets' && deps.stagePresentationMaterial) {
        try {
          deps.stagePresentationMaterial(formatReportSnippetMaterial(item, source))
          result.stagedPresentationItems += 1
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'Unknown presentation staging error'
          result.errors.push(`${item.title}: ${detail}`)
          result.fallbackText += `${formatCaptureSuggestionText(item, source)}\n\n`
        }
      } else {
        copyItems.push(item)
      }
    }
    if (options.stageResearchReview && canStageForResearchReview(item)) {
      researchReviewItems.push(item)
    }
  }

  if (researchReviewItems.length > 0) {
    if (!deps.stageResearchFinding) {
      result.errors.push('Research Result Review staging is unavailable in this runtime. Use Copy all instead.')
      result.fallbackText += researchReviewItems.map(item => formatCaptureSuggestionText(item, source)).join('\n\n')
    } else {
      for (const item of researchReviewItems) {
        try {
          deps.stageResearchFinding(formatCaptureResearchFinding(item, source))
          result.stagedResearchFindings += 1
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'Unknown research review staging error'
          result.errors.push(`${item.title}: ${detail}`)
          result.fallbackText += `${formatCaptureSuggestionText(item, source)}\n\n`
        }
      }
    }
  }

  const needsMemorySave = memoryItems.length > 0 || options.saveSessionSummary || options.saveFullTranscript
  if (needsMemorySave) {
    if (!deps.fetchMemory || !deps.saveMemory) {
      result.errors.push('Memory save is unavailable in this runtime. Use Copy all instead.')
      result.fallbackText += memoryItems.map(item => formatCaptureSuggestionText(item, source)).join('\n\n')
      if (options.saveSessionSummary) result.fallbackText += `${formatSessionSummaryMemory(draft.sessionSummary, source, options)}\n\n`
      if (options.saveFullTranscript && options.transcriptMessages) {
        result.fallbackText += `${formatFullTranscriptMemory(options.transcriptMessages, source)}\n\n`
      }
    } else {
      try {
        const current = await deps.fetchMemory()
        const existing = current.memory?.trim() || ''
        const memoryBlocks: string[] = []
        if (options.saveSessionSummary) {
          memoryBlocks.push(formatSessionSummaryMemory(draft.sessionSummary, source, options))
          result.savedSessionSummary = true
        }
        if (memoryItems.length > 0) {
          memoryBlocks.push([
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
          ].join('\n\n'))
        }
        if (options.saveFullTranscript && options.transcriptMessages) {
          memoryBlocks.push(formatFullTranscriptMemory(options.transcriptMessages, source))
          result.savedFullTranscript = true
        }
        const addition = memoryBlocks.join('\n\n')
        await deps.saveMemory('memory', existing ? `${existing}\n\n${addition}` : addition)
        result.savedMemoryItems = memoryItems.length
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown memory save error'
        result.errors.push(`Memory save failed: ${detail}`)
        result.fallbackText += memoryItems.map(item => formatCaptureSuggestionText(item, source)).join('\n\n')
        if (options.saveSessionSummary) result.fallbackText += `${formatSessionSummaryMemory(draft.sessionSummary, source, options)}\n\n`
        if (options.saveFullTranscript && options.transcriptMessages) {
          result.fallbackText += `${formatFullTranscriptMemory(options.transcriptMessages, source)}\n\n`
        }
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

function suggestionFromTopic(
  id: string,
  title: string,
  researchQuestion: string,
  scope: string,
  contextLabelValue: string,
  priority: CapturePriority = 'medium',
): DeepResearchSuggestion {
  return {
    id,
    title,
    researchQuestion,
    scope,
    expectedOutput: 'Source-backed research note with key findings, citations/source links, open questions, and recommended follow-up tasks.',
    sourceRequirements: 'Use current, citable sources. Separate verified facts, assumptions, and items still to verify.',
    priority,
    contextLabel: contextLabelValue,
    schedulePreference: 'Tonight',
  }
}

export function generateDeepResearchSuggestions(
  messages: Message[],
  context: CaptureContextId,
): DeepResearchSuggestion[] {
  const text = messages.map(textFromMessage).join(' ').toLowerCase()
  const label = contextLabel(context)
  const suggestions: DeepResearchSuggestion[] = []
  const add = (item: DeepResearchSuggestion) => {
    if (!suggestions.some(existing => existing.id === item.id)) suggestions.push(item)
  }

  if (text.includes('dms') || text.includes('regulatory') || text.includes('permission')) {
    add(suggestionFromTopic(
      'dms-regulation',
      'DMS regulation in China',
      'What is the current regulatory status, handling requirement, import/manufacturing restriction, and source evidence for DMS in China?',
      'Regulatory classification, permits, SDS requirements, transport/storage, and evidence gaps.',
      label,
      'high',
    ))
  }
  if (text.includes('cwas') || text.includes('cwms') || text.includes('esterquat') || text.includes('textile')) {
    add(suggestionFromTopic(
      'cwas-cwms-market',
      'CWAS/CWMS market and product evidence',
      'What source-backed evidence exists for demand, product equivalents, customer segments, and pricing validation for CWAS/CWMS?',
      'Product demand, comparable products, textile softener use cases, and source-backed pricing evidence only.',
      label,
      'medium',
    ))
  }
  if (text.includes('competitor') || text.includes('price') || text.includes('supplier')) {
    add(suggestionFromTopic(
      'competitor-pricing',
      'Competitor and supplier price evidence',
      'Which competitors or suppliers can be verified with source-backed product, certification, distribution, and pricing evidence?',
      'Competitor names, product equivalents, active content, quote/screenshots/source evidence, and unknown market share labels.',
      label,
      'medium',
    ))
  }
  if (text.includes('investor') || text.includes('investment') || text.includes('finance') || text.includes('irr')) {
    add(suggestionFromTopic(
      'investor-risk',
      'Investor risk and return evidence',
      'Which assumptions are still weak for investor review, and what evidence is required before preparing an investor-ready return story?',
      'Evidence gaps, financial model completeness, use of funds, risk register, and source-backed assumptions.',
      label,
      'high',
    ))
  }

  if (suggestions.length === 0 && isMeaningfulCaptureSession(messages)) {
    add(suggestionFromTopic(
      'general-research-followup',
      'Follow-up research from this session',
      'What deeper research would turn this conversation into source-backed tasks, notes, and investor-safe evidence?',
      'Session-specific open questions, missing sources, and next useful research tasks.',
      label,
      'low',
    ))
  }

  return suggestions.slice(0, 5)
}

export function formatResearchSuggestionTask(item: DeepResearchSuggestion, source: SessionCaptureSource): string {
  return [
    `Research question: ${item.researchQuestion}`,
    `Scope: ${item.scope}`,
    `Expected output: ${item.expectedOutput}`,
    `Source requirements: ${item.sourceRequirements}`,
    `Project/context: ${item.contextLabel}`,
    `Priority: ${item.priority}`,
    `Schedule preference: ${item.schedulePreference}`,
    'Saved as: Manual research job task',
    'Tags: Research Job, Session Capture, Evidence Gap',
    '',
    sourceLabel(source),
    '',
    'Note: This is a Kanban research task, not an automatically scheduled job.',
  ].join('\n')
}

function toLocalIsoMinute(value: Date): string {
  const pad = (input: number) => String(input).padStart(2, '0')
  return [
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    `${pad(value.getHours())}:${pad(value.getMinutes())}:00`,
  ].join('T')
}

export function scheduleForResearchSuggestion(
  preference: DeepResearchSuggestion['schedulePreference'],
  now = new Date(),
): string {
  const scheduled = new Date(now)
  if (preference === 'Tomorrow morning') {
    scheduled.setDate(scheduled.getDate() + 1)
    scheduled.setHours(8, 0, 0, 0)
    return toLocalIsoMinute(scheduled)
  }
  if (preference === 'Custom') {
    scheduled.setHours(scheduled.getHours() + 2, 0, 0, 0)
    return toLocalIsoMinute(scheduled)
  }
  scheduled.setHours(22, 0, 0, 0)
  if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1)
  return toLocalIsoMinute(scheduled)
}

export function formatResearchSuggestionJobPrompt(item: DeepResearchSuggestion, source: SessionCaptureSource): string {
  return [
    `Research task: ${item.title}`,
    '',
    `Research question: ${item.researchQuestion}`,
    `Scope: ${item.scope}`,
    `Expected output: ${item.expectedOutput}`,
    `Source requirements: ${item.sourceRequirements}`,
    `Project/context: ${item.contextLabel}`,
    `Priority: ${item.priority}`,
    '',
    sourceLabel(source),
    '',
    'Output requirements:',
    '- Separate Verified, User Provided, Assumption, To Verify, Hypothesis, and Reference Only material.',
    '- Include source title plus URL or publication/access date for every claim that could affect investor material.',
    '- Do not invent market size, pricing, competitor market share, IRR, regulatory status, or investor claims.',
    '- If source support is weak or missing, label the claim To Verify and recommend a follow-up task.',
    '- Produce a concise research result that the user can review in Research Result Review before anything changes dashboard facts.',
    '',
    'Do not update Memory, investor readiness, market claims, competitor records, or presentation material automatically.',
  ].join('\n')
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
