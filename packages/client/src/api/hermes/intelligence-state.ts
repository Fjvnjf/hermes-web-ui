import { request } from '@/api/client'

export interface DashboardIntelligenceStateResponse {
  ok: boolean
  profile: string
  savedAt: string | null
  state: unknown | null
  autopilotImport?: DashboardAutopilotImportStatus
}

export interface DashboardAutopilotImportStatus {
  profile: string
  jobCount: number
  outputCount: number
  importedRunCount: number
  skippedRunCount?: number
  pendingOutputCount: number
  latestOutputRunKey: string
  latestOutputFile: string
  latestOutputAt: string
  latestOutputImported: boolean
  latestOutputSkipped?: boolean
  latestOutputParseStatus: 'none' | 'imported' | 'ready' | 'unparseable' | 'unreadable'
  latestOutputCandidateCount: number
  latestOutputParseError: string
  latestImportedRunKey: string
  registryUpdatedAt: string
  latestDueSlotAt: string
  latestDueSlotSatisfied: boolean
  latestDueSlotAttemptedAt: string
  latestDueSlotRunError: string
}

export interface DashboardIntelligenceStateSaveResponse {
  ok: boolean
  profile: string
  savedAt: string
}

export interface DashboardAutopilotImportStatusResponse {
  ok: boolean
  profile: string
  autopilotImport: DashboardAutopilotImportStatus
}

export interface DashboardAutopilotImportResult {
  profile: string
  jobsChecked: number
  filesChecked: number
  importedRuns: number
  skippedRuns: number
  autoFilledCount: number
  stagedReviewCount: number
  missingCoverageFollowUpStarted: boolean
  errors: string[]
}

export interface DashboardAutopilotImportNowResponse {
  ok: boolean
  profile: string
  importResult: DashboardAutopilotImportResult
  autopilotImport: DashboardAutopilotImportStatus
}

export function fetchDashboardIntelligenceState(): Promise<DashboardIntelligenceStateResponse> {
  return request<DashboardIntelligenceStateResponse>('/api/hermes/intelligence-state')
}

export function fetchDashboardAutopilotImportStatus(): Promise<DashboardAutopilotImportStatusResponse> {
  return request<DashboardAutopilotImportStatusResponse>('/api/hermes/intelligence-state/autopilot-import-status')
}

export function importDashboardAutopilotOutputNow(): Promise<DashboardAutopilotImportNowResponse> {
  return request<DashboardAutopilotImportNowResponse>('/api/hermes/intelligence-state/autopilot-import-now', {
    method: 'POST',
  })
}

export function saveDashboardIntelligenceState(state: unknown): Promise<DashboardIntelligenceStateSaveResponse> {
  return request<DashboardIntelligenceStateSaveResponse>('/api/hermes/intelligence-state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })
}
