import { getStoredUserRole } from '@/api/client'

export type FrontendAccessRole =
  | 'owner'
  | 'employee'
  | 'investor_viewer'
  | 'developer_admin'

export type RouteSensitivity =
  | 'owner-only'
  | 'employee-safe'
  | 'investor-approved'
  | 'confidential'
  | 'product-development-secret'
  | 'system-admin-only'

export interface RouteAccessPolicy {
  routeName: string
  sensitivity: RouteSensitivity
  allowedRoles: FrontendAccessRole[]
  note: string
}

export const FRONTEND_ROLE_STORAGE_KEY = 'hermes.frontendAccessRole'

export const ROUTE_ACCESS_POLICIES: RouteAccessPolicy[] = [
  { routeName: 'hermes.dashboard', sensitivity: 'confidential', allowedRoles: ['owner', 'developer_admin'], note: 'Home can include internal activity and evidence gaps.' },
  { routeName: 'hermes.last24Hours', sensitivity: 'owner-only', allowedRoles: ['owner'], note: 'Daily brief can reveal chats, jobs, memory, files, and failures.' },
  { routeName: 'hermes.chat', sensitivity: 'product-development-secret', allowedRoles: ['owner'], note: 'Raw chats may contain formulas, costs, and strategy.' },
  { routeName: 'hermes.session', sensitivity: 'product-development-secret', allowedRoles: ['owner'], note: 'Raw chat session.' },
  { routeName: 'hermes.history', sensitivity: 'product-development-secret', allowedRoles: ['owner'], note: 'Raw chat history.' },
  { routeName: 'hermes.historySession', sensitivity: 'product-development-secret', allowedRoles: ['owner'], note: 'Raw historical session.' },
  { routeName: 'hermes.feasibility', sensitivity: 'confidential', allowedRoles: ['owner'], note: 'Feasibility contains unapproved assumptions and gaps.' },
  { routeName: 'hermes.projects', sensitivity: 'confidential', allowedRoles: ['owner', 'employee'], note: 'Project shell; backend project permissions are still required.' },
  { routeName: 'hermes.research', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee'], note: 'Research workspace without raw sensitive memory by default.' },
  { routeName: 'hermes.files', sensitivity: 'confidential', allowedRoles: ['owner', 'employee'], note: 'Raw files need server-side document categories before employee sharing.' },
  { routeName: 'hermes.kanban', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee'], note: 'Tasks can be employee-safe if project scoped.' },
  { routeName: 'hermes.memory', sensitivity: 'product-development-secret', allowedRoles: ['owner'], note: 'Memory can contain durable confidential facts.' },
  { routeName: 'hermes.reportsHub', sensitivity: 'confidential', allowedRoles: ['owner', 'employee', 'investor_viewer'], note: 'Investor viewers need approved-report filtering before use.' },
  { routeName: 'hermes.investorReadiness', sensitivity: 'investor-approved', allowedRoles: ['owner', 'investor_viewer'], note: 'Should show approved/readiness evidence only for investors.' },
  { routeName: 'hermes.investmentCalculator', sensitivity: 'confidential', allowedRoles: ['owner'], note: 'Finance assumptions and IRR scenarios are confidential until approved.' },
  { routeName: 'hermes.marketIntelligence', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'investor_viewer'], note: 'Employee/investor views must hide price/cost/formula-sensitive content.' },
  { routeName: 'hermes.competitorIntelligence', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'investor_viewer'], note: 'Unknown market share must remain To Verify.' },
  { routeName: 'hermes.rawMaterialSourcing', sensitivity: 'confidential', allowedRoles: ['owner'], note: 'Prices, costs, sources, and formula impact are sensitive.' },
  { routeName: 'hermes.exportMarketOpportunity', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'investor_viewer'], note: 'Trade proxy research can be shared only with source labels.' },
  { routeName: 'hermes.researchResultReview', sensitivity: 'confidential', allowedRoles: ['owner', 'employee'], note: 'Review queue contains unapproved findings.' },
  { routeName: 'hermes.investorPresentation', sensitivity: 'investor-approved', allowedRoles: ['owner', 'investor_viewer'], note: 'Only approved/source-backed material should render.' },
  { routeName: 'hermes.jobs', sensitivity: 'confidential', allowedRoles: ['owner', 'developer_admin'], note: 'Jobs can run research/automation.' },
  { routeName: 'hermes.channels', sensitivity: 'confidential', allowedRoles: ['owner', 'developer_admin'], note: 'Messaging/channel integrations are internal.' },
  { routeName: 'hermes.groupChat', sensitivity: 'confidential', allowedRoles: ['owner'], note: 'Group chats can expose raw strategy discussions.' },
  { routeName: 'hermes.groupChatRoom', sensitivity: 'confidential', allowedRoles: ['owner'], note: 'Group chat room content can be sensitive.' },
  { routeName: 'hermes.usage', sensitivity: 'confidential', allowedRoles: ['owner', 'developer_admin'], note: 'Usage and cost analytics are internal.' },
  { routeName: 'hermes.skillsUsage', sensitivity: 'confidential', allowedRoles: ['owner', 'developer_admin'], note: 'Skills usage can reveal workflow patterns.' },
  { routeName: 'hermes.settings', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Settings can expose models/provider/system config.' },
  { routeName: 'hermes.models', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Models/provider settings are admin only.' },
  { routeName: 'hermes.profiles', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Profile management is admin only.' },
  { routeName: 'hermes.logs', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Logs can expose system details.' },
  { routeName: 'hermes.performance', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Runtime performance data is system-only.' },
  { routeName: 'hermes.versionPreview', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Version preview/update tooling is system-only.' },
  { routeName: 'hermes.terminal', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Terminal is never employee/investor safe.' },
  { routeName: 'hermes.skills', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Skill files and memory wiring are admin only.' },
  { routeName: 'hermes.plugins', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Plugin tools are admin only.' },
]

const routePolicyMap = new Map(ROUTE_ACCESS_POLICIES.map(policy => [policy.routeName, policy]))

export function backendRoleToFrontendRole(role: string | null | undefined): FrontendAccessRole {
  if (role === 'super_admin' || role === 'admin') return 'owner'
  if (role === 'developer_admin') return 'developer_admin'
  if (role === 'investor_viewer') return 'investor_viewer'
  if (role === 'employee') return 'employee'
  return 'owner'
}

export function getFrontendAccessRole(): FrontendAccessRole {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(FRONTEND_ROLE_STORAGE_KEY)
    if (stored === 'employee' || stored === 'investor_viewer' || stored === 'developer_admin' || stored === 'owner') return stored
  }
  return backendRoleToFrontendRole(getStoredUserRole())
}

export function routePolicyFor(routeName: string): RouteAccessPolicy | null {
  return routePolicyMap.get(routeName) || null
}

export function canAccessRouteName(routeName: string, role: FrontendAccessRole = getFrontendAccessRole()): boolean {
  const policy = routePolicyFor(routeName)
  if (!policy) return role === 'owner' || role === 'developer_admin'
  return policy.allowedRoles.includes(role)
}

export function isEmployeeRestrictedRoute(routeName: string): boolean {
  return !canAccessRouteName(routeName, 'employee')
}

export function shouldRedactForEmployee(role: FrontendAccessRole = getFrontendAccessRole()): boolean {
  return role === 'employee' || role === 'investor_viewer'
}

export function accessControlWarning(): string {
  return 'Frontend redaction is a UI guardrail only. Backend API role enforcement is required before inviting employees or investors.'
}
