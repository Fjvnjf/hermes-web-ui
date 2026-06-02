import { request } from '@/api/client'

export interface DashboardIntelligenceStateResponse {
  ok: boolean
  profile: string
  savedAt: string | null
  state: unknown | null
}

export interface DashboardIntelligenceStateSaveResponse {
  ok: boolean
  profile: string
  savedAt: string
}

export function fetchDashboardIntelligenceState(): Promise<DashboardIntelligenceStateResponse> {
  return request<DashboardIntelligenceStateResponse>('/api/hermes/intelligence-state')
}

export function saveDashboardIntelligenceState(state: unknown): Promise<DashboardIntelligenceStateSaveResponse> {
  return request<DashboardIntelligenceStateSaveResponse>('/api/hermes/intelligence-state', {
    method: 'PUT',
    body: JSON.stringify({ state }),
  })
}

