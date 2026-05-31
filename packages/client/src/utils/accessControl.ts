import { getStoredUserRole } from '@/api/client'

export type FrontendAccessRole =
  | 'owner'
  | 'employee'
  | 'research_assistant'
  | 'financial_analyst'
  | 'regulatory_consultant'
  | 'investor_viewer'
  | 'developer_admin'

export type RouteSensitivity =
  | 'public-shareable'
  | 'owner-only'
  | 'employee-safe'
  | 'investor-approved'
  | 'confidential'
  | 'price-cost-sensitive'
  | 'formula-secret'
  | 'product-development-secret'
  | 'investor-sensitive'
  | 'system-admin-only'

export interface RouteAccessPolicy {
  routeName: string
  sensitivity: RouteSensitivity
  allowedRoles: FrontendAccessRole[]
  note: string
}

export const FRONTEND_ROLE_STORAGE_KEY = 'hermes.frontendAccessRole'

export const ROUTE_ACCESS_POLICIES: RouteAccessPolicy[] = [
  { routeName: 'hermes.dashboard', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant', 'developer_admin'], note: 'Home is role-specific; developer admin sees system shortcuts without raw business data.' },
  { routeName: 'hermes.accessDenied', sensitivity: 'public-shareable', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant', 'investor_viewer', 'developer_admin'], note: 'Safe access denial page.' },
  { routeName: 'hermes.investorPortal', sensitivity: 'investor-approved', allowedRoles: ['owner', 'investor_viewer'], note: 'Investor-only approved material portal.' },
  { routeName: 'hermes.last24Hours', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Daily brief is visible with restricted sources redacted or unavailable by API role.' },
  { routeName: 'hermes.executiveOverview', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Executive overview uses redacted economics for non-owner business roles and keeps investor viewers in approved-only access.' },
  { routeName: 'hermes.chat', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Chat is available to business roles; backend blocks restricted prompts and secret session replay.' },
  { routeName: 'hermes.session', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Session route is available only for backend-filtered non-sensitive sessions.' },
  { routeName: 'hermes.history', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'History is backend-filtered for product-development and sensitive economics.' },
  { routeName: 'hermes.historySession', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Historical session detail is backend-filtered and blocked if sensitive.' },
  { routeName: 'hermes.feasibility', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Feasibility workspace is visible with sensitive fields redacted or linked to protected routes.' },
  { routeName: 'hermes.projects', sensitivity: 'confidential', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Project shell; backend project permissions are still required.' },
  { routeName: 'hermes.research', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Research workspace is employee-visible; raw Memory remains blocked by route/API.' },
  { routeName: 'hermes.files', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Documents are backend-limited to explicit employee-safe categories for business roles.' },
  { routeName: 'hermes.kanban', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Tasks are allowed, with backend profile scope still applied.' },
  { routeName: 'hermes.memory', sensitivity: 'product-development-secret', allowedRoles: ['owner'], note: 'Memory can contain durable confidential facts.' },
  { routeName: 'hermes.reportsHub', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Reports Hub is visible; sensitive economics are redacted for employee-style roles.' },
  { routeName: 'hermes.investorReadiness', sensitivity: 'investor-approved', allowedRoles: ['owner'], note: 'Readiness can read local intelligence state; investor sees only the Investor Portal until approval filtering exists.' },
  { routeName: 'hermes.investmentCalculator', sensitivity: 'confidential', allowedRoles: ['owner', 'financial_analyst'], note: 'Finance assumptions and IRR scenarios are confidential until approved.' },
  { routeName: 'hermes.investmentAnalysis', sensitivity: 'price-cost-sensitive', allowedRoles: ['owner', 'financial_analyst'], note: 'Investment analysis exposes financial outputs only to owner and financial analyst roles.' },
  { routeName: 'hermes.marketIntelligence', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Market intelligence is visible; pricing/cost claims must stay redacted or To Verify.' },
  { routeName: 'hermes.competitorIntelligence', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Competitor intelligence is visible with pricing/cost fields redacted for employees.' },
  { routeName: 'hermes.rawMaterialSourcing', sensitivity: 'confidential', allowedRoles: ['owner'], note: 'Prices, costs, sources, and formula impact are sensitive.' },
  { routeName: 'hermes.exportMarketOpportunity', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant'], note: 'Trade proxy research is employee-visible when it avoids sensitive pricing/formula detail.' },
  { routeName: 'hermes.researchResultReview', sensitivity: 'confidential', allowedRoles: ['owner', 'research_assistant', 'regulatory_consultant'], note: 'Review queue contains unapproved findings.' },
  { routeName: 'hermes.investorPresentation', sensitivity: 'investor-approved', allowedRoles: ['owner'], note: 'Presentation builder can read local intelligence state; investor sees only the Investor Portal until approval filtering exists.' },
  { routeName: 'hermes.jobs', sensitivity: 'employee-safe', allowedRoles: ['owner', 'employee', 'research_assistant', 'financial_analyst', 'regulatory_consultant', 'developer_admin'], note: 'Research jobs are visible to business roles through backend filtering; developer admin can manage system jobs.' },
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
  { routeName: 'hermes.localBackupVault', sensitivity: 'system-admin-only', allowedRoles: ['owner'], note: 'Disaster recovery exports can contain broad confidential workspace data and are owner-only.' },
  { routeName: 'hermes.terminal', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Terminal is never employee/investor safe.' },
  { routeName: 'hermes.skills', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Skill files and memory wiring are admin only.' },
  { routeName: 'hermes.plugins', sensitivity: 'system-admin-only', allowedRoles: ['owner', 'developer_admin'], note: 'Plugin tools are admin only.' },
]

const routePolicyMap = new Map(ROUTE_ACCESS_POLICIES.map(policy => [policy.routeName, policy]))

export function backendRoleToFrontendRole(role: string | null | undefined): FrontendAccessRole {
  if (role === 'super_admin' || role === 'owner' || role === 'admin') return 'owner'
  if (role === 'developer_admin') return 'developer_admin'
  if (role === 'investor_viewer') return 'investor_viewer'
  if (role === 'research_assistant') return 'research_assistant'
  if (role === 'financial_analyst') return 'financial_analyst'
  if (role === 'regulatory_consultant') return 'regulatory_consultant'
  if (role === 'employee') return 'employee'
  return 'owner'
}

export function getFrontendAccessRole(): FrontendAccessRole {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(FRONTEND_ROLE_STORAGE_KEY)
    if (stored === 'employee' ||
      stored === 'research_assistant' ||
      stored === 'financial_analyst' ||
      stored === 'regulatory_consultant' ||
      stored === 'investor_viewer' ||
      stored === 'developer_admin' ||
      stored === 'owner') return stored
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

export function isEmployeeStyleRole(role: FrontendAccessRole = getFrontendAccessRole()): boolean {
  return role === 'employee' || role === 'research_assistant' || role === 'regulatory_consultant'
}

export function isBusinessLimitedRole(role: FrontendAccessRole = getFrontendAccessRole()): boolean {
  return isEmployeeStyleRole(role) || role === 'investor_viewer' || role === 'developer_admin'
}

export function shouldRedactForEmployee(role: FrontendAccessRole = getFrontendAccessRole()): boolean {
  return isBusinessLimitedRole(role)
}

export function restrictedFieldLabel(role: FrontendAccessRole = getFrontendAccessRole()): string {
  if (role === 'developer_admin') return 'Business Restricted'
  if (role === 'investor_viewer') return 'Investor Portal Only'
  return 'Restricted'
}

export function redactForEmployee<T>(value: T, role: FrontendAccessRole = getFrontendAccessRole()): T | string {
  return shouldRedactForEmployee(role) ? restrictedFieldLabel(role) : value
}

export function accessControlWarning(): string {
  return 'Frontend redaction is a UI guardrail only. Backend API role enforcement is required before inviting employees or investors.'
}
