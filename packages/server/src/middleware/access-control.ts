import type { Context, Next } from 'koa'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from '../config'
import type { UserRole } from '../db/hermes/users-store'

export type Permission =
  | 'view:account'
  | 'view:chat'
  | 'view:history'
  | 'view:memory'
  | 'write:memory'
  | 'view:files'
  | 'upload:files'
  | 'download:files'
  | 'view:kanban'
  | 'create:task'
  | 'view:jobs'
  | 'create:job'
  | 'view:terminal'
  | 'view:settings'
  | 'view:models'
  | 'view:logs'
  | 'view:raw-material-prices'
  | 'view:costing'
  | 'view:formula'
  | 'view:product-development'
  | 'view:investor-approved'
  | 'edit:investor-presentation'
  | 'approve:investor-material'
  | 'view:admin'
  | 'use:proxy'
  | 'export:backup'

export type ConfidentialityLabel =
  | 'public-shareable'
  | 'employee-safe'
  | 'investor-approved'
  | 'internal'
  | 'confidential'
  | 'price-cost-sensitive'
  | 'formula-secret'
  | 'product-development-secret'
  | 'investor-sensitive'
  | 'system-admin-only'

const OWNER_ROLES = new Set<string>(['super_admin', 'owner', 'admin'])

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  employee: [
    'view:account',
    'view:chat',
    'view:history',
    'view:files',
    'upload:files',
    'download:files',
    'view:kanban',
    'create:task',
    'view:jobs',
    'create:job',
  ],
  research_assistant: [
    'view:account',
    'view:chat',
    'view:history',
    'view:files',
    'upload:files',
    'download:files',
    'view:kanban',
    'create:task',
    'view:jobs',
    'create:job',
  ],
  financial_analyst: [
    'view:account',
    'view:chat',
    'view:history',
    'view:files',
    'upload:files',
    'download:files',
    'view:kanban',
    'create:task',
    'view:jobs',
    'create:job',
    'view:raw-material-prices',
    'view:costing',
  ],
  regulatory_consultant: [
    'view:account',
    'view:chat',
    'view:history',
    'view:files',
    'upload:files',
    'download:files',
    'view:kanban',
    'create:task',
    'view:jobs',
    'create:job',
  ],
  investor_viewer: [
    'view:account',
    'view:investor-approved',
  ],
  developer_admin: [
    'view:account',
    'view:terminal',
    'view:settings',
    'view:models',
    'view:logs',
    'view:jobs',
    'create:job',
    'view:admin',
    'use:proxy',
  ],
}

export function isOwnerRole(role: UserRole | string | null | undefined): boolean {
  return !!role && OWNER_ROLES.has(role)
}

export function roleHasPermission(role: UserRole | string | null | undefined, permission: Permission): boolean {
  if (isOwnerRole(role)) return true
  return ROLE_PERMISSIONS[String(role || '')]?.includes(permission) || false
}

function isWrite(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

export function permissionForRequest(ctx: Pick<Context, 'path' | 'method'>): Permission | null {
  const path = ctx.path.toLowerCase()
  const method = ctx.method.toUpperCase()
  const writing = isWrite(method)

  if (path === '/api/auth/me' ||
    path === '/api/auth/change-password' ||
    path === '/api/auth/change-username' ||
    path === '/api/auth/password') return 'view:account'
  if (path.startsWith('/api/auth/users') || path.startsWith('/api/auth/locked-ips')) return 'view:admin'

  if (path.startsWith('/api/hermes/access-denied')) return 'view:account'
  if (path.startsWith('/api/hermes/investor/portal')) return 'view:investor-approved'
  if (path.startsWith('/api/hermes/backup')) return 'export:backup'
  if (path.startsWith('/api/hermes/intelligence-state')) return 'view:product-development'
  if (path.startsWith('/api/hermes/memory')) return writing ? 'write:memory' : 'view:memory'
  if (path.startsWith('/api/hermes/usage')) return 'view:logs'
  if (path.startsWith('/api/hermes/sessions') ||
    path.startsWith('/api/hermes/session') ||
    path.startsWith('/api/hermes/search/sessions') ||
    path.startsWith('/api/hermes/context-length') ||
    path.startsWith('/api/hermes/workspace/folders')) return 'view:history'

  if (path === '/upload') return 'upload:files'
  if (path.startsWith('/api/hermes/download')) return 'download:files'
  if (path.startsWith('/api/hermes/files')) return writing ? 'upload:files' : 'view:files'

  if (path.startsWith('/api/hermes/kanban/events') || path.startsWith('/api/hermes/kanban')) {
    return writing ? 'create:task' : 'view:kanban'
  }

  if (path.startsWith('/api/hermes/jobs') || path.startsWith('/api/cron-history')) {
    return writing ? 'create:job' : 'view:jobs'
  }

  if (path.startsWith('/api/hermes/logs') ||
    path.startsWith('/api/hermes/performance') ||
    path.startsWith('/api/hermes/update')) return 'view:logs'

  if (path.startsWith('/api/hermes/config') ||
    path.startsWith('/api/hermes/providers') ||
    path.startsWith('/api/hermes/auth/') ||
    path.startsWith('/api/hermes/codex-auth') ||
    path.startsWith('/api/hermes/nous-auth') ||
    path.startsWith('/api/hermes/copilot-auth') ||
    path.startsWith('/api/hermes/xai-auth') ||
    path.startsWith('/api/hermes/weixin')) return 'view:settings'

  if (path.startsWith('/api/hermes/available-models') ||
    path.startsWith('/api/hermes/provider-models') ||
    path.startsWith('/api/hermes/config/model') ||
    path.startsWith('/api/hermes/config/models') ||
    path.startsWith('/api/hermes/model-') ||
    path.startsWith('/api/hermes/custom-model') ||
    path.startsWith('/api/hermes/model-context')) return 'view:models'

  if (path.startsWith('/api/hermes/profiles') ||
    path.startsWith('/api/hermes/skills') ||
    path.startsWith('/api/hermes/plugins')) return 'view:admin'

  if (path.startsWith('/api/hermes/group-chat')) return 'view:chat'
  if (path.startsWith('/api/hermes/media')) return 'view:settings'

  if (path.startsWith('/v1') || path.startsWith('/api/hermes/v1')) return 'use:proxy'
  if (path.startsWith('/api')) return 'view:admin'

  return null
}

export function auditAccessEvent(input: {
  ctx?: Context
  user?: { id?: number; username?: string; role?: string } | null
  action: string
  resource: string
  permission?: string
  result: 'allowed' | 'denied'
  reason?: string
}) {
  try {
    const logsDir = join(config.appHome, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const ctx = input.ctx
    const user = input.user || ctx?.state.user || null
    const event = {
      timestamp: new Date().toISOString(),
      userId: user?.id ?? null,
      username: user?.username ?? null,
      role: user?.role ?? null,
      action: input.action,
      resource: input.resource,
      permission: input.permission || null,
      result: input.result,
      reason: input.reason || null,
      ip: ctx?.ip || null,
      userAgent: ctx?.get?.('user-agent') || null,
    }
    appendFileSync(join(logsDir, 'access-audit.jsonl'), `${JSON.stringify(event)}\n`)
  } catch {
    // Audit logging must never break the protected action itself.
  }
}

export function requirePermission(permission: Permission) {
  return async (ctx: Context, next: Next): Promise<void> => {
    const role = ctx.state.user?.role
    if (!roleHasPermission(role, permission)) {
      auditAccessEvent({
        ctx,
        action: `${ctx.method} ${ctx.path}`,
        resource: ctx.path,
        permission,
        result: 'denied',
        reason: 'missing-permission',
      })
      ctx.status = 403
      ctx.body = { error: 'Access denied', requiredPermission: permission }
      return
    }
    await next()
  }
}

export async function requireRequestPermission(ctx: Context, next: Next): Promise<void> {
  const permission = permissionForRequest(ctx)
  if (!permission) {
    await next()
    return
  }

  const role = ctx.state.user?.role
  if (!roleHasPermission(role, permission)) {
    auditAccessEvent({
      ctx,
      action: `${ctx.method} ${ctx.path}`,
      resource: ctx.path,
      permission,
      result: 'denied',
      reason: 'missing-permission',
    })
    ctx.status = 403
    ctx.body = { error: 'Access denied', requiredPermission: permission }
    return
  }

  const sensitive = ['view:terminal', 'view:settings', 'view:models', 'view:logs', 'download:files', 'view:memory', 'write:memory', 'view:investor-approved', 'export:backup', 'view:product-development']
  if (sensitive.includes(permission)) {
    auditAccessEvent({
      ctx,
      action: `${ctx.method} ${ctx.path}`,
      resource: ctx.path,
      permission,
      result: 'allowed',
    })
  }

  await next()
}
