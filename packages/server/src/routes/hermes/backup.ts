import Router from '@koa/router'
import { auditAccessEvent, requirePermission } from '../../middleware/access-control'
import {
  buildBackupArchive,
  createBackupSnapshot,
  getBackupStatus,
  normalizeBackupType,
  saveBackupSchedule,
  type BrowserWorkspaceState,
} from '../../services/backup/local-backup-vault'

export const backupRoutes = new Router()

function requestProfile(ctx: any): string | undefined {
  return ctx.state?.profile?.name
}

function browserStateFromBody(ctx: any): BrowserWorkspaceState | null {
  const body = ctx.request?.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const browserState = (body as Record<string, unknown>).browserState
  if (!browserState || typeof browserState !== 'object' || Array.isArray(browserState)) return null
  return browserState as BrowserWorkspaceState
}

async function sendBackupArchive(ctx: any, typeInput: unknown, browserState: BrowserWorkspaceState | null = null) {
  const type = normalizeBackupType(typeInput)
  const result = await buildBackupArchive({ type, profile: requestProfile(ctx), browserState })
  auditAccessEvent({
    ctx,
    action: `${ctx.method} ${ctx.path}`,
    resource: `backup:${type}`,
    permission: 'export:backup',
    result: 'allowed',
  })
  ctx.set('Content-Type', 'application/zip')
  ctx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
  ctx.set('Cache-Control', 'no-store')
  ctx.set('Content-Length', String(result.buffer.length))
  ctx.body = result.buffer
}

backupRoutes.get('/api/hermes/backup/status', requirePermission('export:backup'), async (ctx) => {
  ctx.body = await getBackupStatus()
})

backupRoutes.get('/api/hermes/backup/export', requirePermission('export:backup'), async (ctx) => {
  await sendBackupArchive(ctx, ctx.query.type)
})

backupRoutes.post('/api/hermes/backup/export', requirePermission('export:backup'), async (ctx) => {
  const body = (ctx.request.body && typeof ctx.request.body === 'object') ? ctx.request.body as Record<string, unknown> : {}
  await sendBackupArchive(ctx, body.type || ctx.query.type, browserStateFromBody(ctx))
})

backupRoutes.post('/api/hermes/backup/snapshot', requirePermission('export:backup'), async (ctx) => {
  const body = (ctx.request.body && typeof ctx.request.body === 'object') ? ctx.request.body as Record<string, unknown> : {}
  const type = normalizeBackupType(body.type || ctx.query.type)
  const snapshot = await createBackupSnapshot({ type, profile: requestProfile(ctx), browserState: browserStateFromBody(ctx) })
  auditAccessEvent({
    ctx,
    action: `${ctx.method} ${ctx.path}`,
    resource: `backup-snapshot:${type}`,
    permission: 'export:backup',
    result: 'allowed',
  })
  ctx.body = { ok: true, snapshot }
})

backupRoutes.post('/api/hermes/backup/schedule', requirePermission('export:backup'), async (ctx) => {
  const body = (ctx.request.body && typeof ctx.request.body === 'object') ? ctx.request.body as Record<string, unknown> : {}
  const schedule = await saveBackupSchedule({
    enabled: body.enabled === true,
    type: normalizeBackupType(body.type),
  })
  auditAccessEvent({
    ctx,
    action: `${ctx.method} ${ctx.path}`,
    resource: 'backup-schedule',
    permission: 'export:backup',
    result: 'allowed',
  })
  ctx.body = { ok: true, schedule }
})
