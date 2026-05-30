import type { UserRole } from '../../db/hermes/users-store'
import { isOwnerRole, type ConfidentialityLabel } from '../../middleware/access-control'

export type DataSensitivityLabel =
  | 'public-shareable'
  | 'employee-safe'
  | 'internal'
  | 'confidential'
  | 'price-cost-sensitive'
  | 'formula-secret'
  | 'product-development-secret'
  | 'investor-sensitive'
  | 'system-admin-only'

const EMPLOYEE_SAFE_PATH_SEGMENTS = new Set([
  'public',
  'shareable',
  'employee-safe',
  'employee_safe',
  'employee',
  'internal',
  'research',
  'market',
  'competitor',
  'reports',
  'approved',
])

const BLOCKED_FILE_SEGMENTS = [
  '.env',
  'auth.json',
  'token',
  'secret',
  'password',
  'credential',
  'private-key',
  'private_key',
  'ssh',
  'cloudflare',
  'cost',
  'price',
  'quote',
  'supplier',
  'formula',
  'cas',
  'dms',
  'raw-material',
  'raw_material',
  'product-development',
  'product_development',
  'investor-terms',
  'investor_terms',
  'negotiation',
]

const RESTRICTED_VALUE_RE = /\b(price|pricing|cost|costing|supplier\s+quote|supplier\s+price|landed\s+cost|raw\s+material\s+price|formula\s+cost|gross\s+margin|margin|irr|npv|payback|working\s+capital|investor\s+terms?|negotiation|formula|cas\s+list|raw\s+material\s+ratio|product\s+development|dms|dimethyl\s+sulfate|reactor|process\s+design|supplier\s+cost|cost\s+sheet|api\s*key|secret|token|password|provider\s+config)\b/i

const FORMULA_RE = /\b(formula|cas\s+list|raw\s+material\s+ratio|active\s+content|composition|recipe|process\s+design|reactor|dms|dimethyl\s+sulfate)\b/i
const PRICE_COST_RE = /\b(price|pricing|cost|costing|supplier\s+quote|supplier\s+price|landed\s+cost|raw\s+material\s+price|formula\s+cost|gross\s+margin|margin|irr|npv|payback|working\s+capital)\b/i
const PRODUCT_DEV_RE = /\b(product\s+development|formula|cas\s+list|raw\s+material\s+ratio|reactor|process\s+design|dms|dimethyl\s+sulfate)\b/i
const INVESTOR_RE = /\b(investor\s+terms?|equity\s+percentage|ownership|valuation|negotiation|term\s+sheet)\b/i
const SYSTEM_RE = /\b(api\s*key|secret|token|password|private\s+key|ssh|cloudflare|provider\s+config|terminal|settings|models?)\b/i

const SENSITIVE_FIELD_RE = /(price|pricing|cost|costing|margin|formula|cas|ratio|supplier|quote|landed|irr|npv|payback|valuation|equity|ownership|secret|token|password|api[_-]?key|credential|private[_-]?key|provider|config)/i

export function isEmployeeLikeRole(role: UserRole | string | null | undefined): boolean {
  return role === 'employee' || role === 'research_assistant' || role === 'regulatory_consultant'
}

export function isFinancialAnalystRole(role: UserRole | string | null | undefined): boolean {
  return role === 'financial_analyst'
}

export function canSeeRestrictedBusinessData(role: UserRole | string | null | undefined): boolean {
  return isOwnerRole(role)
}

export function canSeePriceCostData(role: UserRole | string | null | undefined): boolean {
  return isOwnerRole(role) || role === 'financial_analyst'
}

export function classifySensitivityFromText(...parts: Array<unknown>): DataSensitivityLabel {
  const text = parts
    .filter(value => value !== undefined && value !== null)
    .map(value => typeof value === 'string' ? value : JSON.stringify(value))
    .join('\n')

  if (SYSTEM_RE.test(text)) return 'system-admin-only'
  if (/\bproduct\s+development\b/i.test(text)) return 'product-development-secret'
  if (FORMULA_RE.test(text)) return 'formula-secret'
  if (PRODUCT_DEV_RE.test(text)) return 'product-development-secret'
  if (PRICE_COST_RE.test(text)) return 'price-cost-sensitive'
  if (INVESTOR_RE.test(text)) return 'investor-sensitive'
  if (RESTRICTED_VALUE_RE.test(text)) return 'confidential'
  return 'internal'
}

export function employeeCanAccessLabel(label: DataSensitivityLabel | ConfidentialityLabel | string): boolean {
  return label === 'public-shareable' || label === 'employee-safe' || label === 'internal'
}

export function containsEmployeeRestrictedContent(...parts: Array<unknown>): boolean {
  return !employeeCanAccessLabel(classifySensitivityFromText(...parts))
}

export function roleCanAccessText(role: UserRole | string | null | undefined, ...parts: Array<unknown>): boolean {
  if (isOwnerRole(role)) return true
  const label = classifySensitivityFromText(...parts)
  if (isFinancialAnalystRole(role)) {
    return label !== 'formula-secret' &&
      label !== 'product-development-secret' &&
      label !== 'investor-sensitive' &&
      label !== 'system-admin-only'
  }
  if (isEmployeeLikeRole(role)) return employeeCanAccessLabel(label)
  return false
}

export function redactRestrictedTextForRole(value: string, role: UserRole | string | null | undefined): string {
  if (!value || isOwnerRole(role)) return value
  if (isFinancialAnalystRole(role)) {
    return value
      .split(/\r?\n/)
      .map(line => (FORMULA_RE.test(line) || PRODUCT_DEV_RE.test(line) || INVESTOR_RE.test(line) || SYSTEM_RE.test(line)) ? '[Restricted]' : line)
      .join('\n')
  }
  if (!isEmployeeLikeRole(role) && role !== 'investor_viewer' && role !== 'developer_admin') return value
  return value
    .split(/\r?\n/)
    .map(line => RESTRICTED_VALUE_RE.test(line) ? '[Restricted]' : line)
    .join('\n')
}

export function redactRestrictedObjectForRole<T>(value: T, role: UserRole | string | null | undefined): T {
  if (isOwnerRole(role)) return value
  if (Array.isArray(value)) {
    return value.map(item => redactRestrictedObjectForRole(item, role)) as T
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_RE.test(key)) {
        output[key] = '[Restricted]'
        continue
      }
      output[key] = redactRestrictedObjectForRole(raw, role)
    }
    return output as T
  }
  if (typeof value === 'string') return redactRestrictedTextForRole(value, role) as T
  return value
}

export function isTaskVisibleToRole(task: {
  title?: string | null
  body?: string | null
  tenant?: string | null
  result?: string | null
}, role: UserRole | string | null | undefined): boolean {
  if (isOwnerRole(role)) return true
  if (isFinancialAnalystRole(role)) {
    return roleCanAccessText(role, task.title, task.body, task.tenant, task.result)
  }
  if (isEmployeeLikeRole(role)) {
    return !containsEmployeeRestrictedContent(task.title, task.body, task.tenant, task.result)
  }
  return false
}

export function isEmployeeFilePathAllowed(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  if (!normalized || normalized === '.' || normalized === '/') return true
  const parts = normalized.split('/').filter(Boolean)
  if (parts.some(part => BLOCKED_FILE_SEGMENTS.some(blocked => part.includes(blocked)))) return false
  return parts.some(part => EMPLOYEE_SAFE_PATH_SEGMENTS.has(part))
}

export function filterEmployeeVisibleFileEntries<T extends { name: string; path: string; isDir?: boolean }>(entries: T[]): T[] {
  return entries.filter(entry => {
    const path = entry.path || entry.name
    if (entry.isDir && !path.includes('/')) {
      return EMPLOYEE_SAFE_PATH_SEGMENTS.has(entry.name.toLowerCase())
    }
    return isEmployeeFilePathAllowed(path)
  })
}
