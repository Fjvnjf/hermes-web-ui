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
  pendingOutputCount: number
  latestOutputRunKey: string
  latestOutputFile: string
  latestOutputAt: string
  latestOutputImported: boolean
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

export function fetchDashboardIntelligenceState(): Promise<DashboardIntelligenceStateResponse> {
  return request<DashboardIntelligenceStateResponse>('/api/hermes/intelligence-state')
}

export function fetchDashboardAutopilotImportStatus(): Promise<DashboardAutopilotImportStatusResponse> {
  return request<DashboardAutopilotImportStatusResponse>('/api/hermes/intelligence-state/autopilot-import-status')
}

export function saveDashboardIntelligenceState(state: unknown): Promise<DashboardIntelligenceStateSaveResponse> {
  return request<DashboardIntelligenceStateSaveResponse>('/api/hermes/intelligence-state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })
}
