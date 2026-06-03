import Router from '@koa/router'
import { auditAccessEvent, requirePermission } from '../../middleware/access-control'
import {
  readDashboardIntelligenceState,
  writeDashboardIntelligenceState,
} from '../../services/hermes/intelligence-state'
import { readFullDashboardAutopilotImportStatus } from '../../services/hermes/dashboard-autopilot-ingest'

export const intelligenceStateRoutes = new Router()

function requestedProfile(ctx: any): string | undefined {
  return ctx.state?.profile?.name
}

function handleStateError(ctx: any, err: any) {
  const code = err?.code || 'state_error'
  const statusMap: Record<string, number> = {
    invalid_state: 400,
    state_too_large: 413,
  }
  ctx.status = statusMap[code] || 500
  ctx.body = { error: err?.message || 'Dashboard intelligence state error', code }
}

intelligenceStateRoutes.get('/api/hermes/intelligence-state', requirePermission('view:product-development'), async (ctx) => {
  try {
    const profile = requestedProfile(ctx)
    const [envelope, autopilotImport] = await Promise.all([
      readDashboardIntelligenceState(profile),
      readFullDashboardAutopilotImportStatus(profile),
    ])
    auditAccessEvent({
      ctx,
      action: `${ctx.method} ${ctx.path}`,
      resource: 'dashboard-intelligence-state',
      permission: 'view:product-development',
      result: 'allowed',
    })
    ctx.body = {
      ok: true,
      profile: profile || envelope?.profile || 'default',
      savedAt: envelope?.savedAt || null,
      state: envelope?.state || null,
      autopilotImport,
    }
  } catch (err) {
    handleStateError(ctx, err)
  }
})

intelligenceStateRoutes.get('/api/hermes/intelligence-state/autopilot-import-status', requirePermission('view:jobs'), async (ctx) => {
  try {
    const autopilotImport = await readFullDashboardAutopilotImportStatus(requestedProfile(ctx))
    auditAccessEvent({
      ctx,
      action: `${ctx.method} ${ctx.path}`,
      resource: 'dashboard-autopilot-import-status',
      permission: 'view:jobs',
      result: 'allowed',
    })
    ctx.body = {
      ok: true,
      profile: autopilotImport.profile,
      autopilotImport,
    }
  } catch (err) {
    handleStateError(ctx, err)
  }
})

intelligenceStateRoutes.put('/api/hermes/intelligence-state', requirePermission('view:product-development'), async (ctx) => {
  try {
    const body = (ctx.request.body && typeof ctx.request.body === 'object') ? ctx.request.body as Record<string, unknown> : {}
    const envelope = await writeDashboardIntelligenceState({
      profile: requestedProfile(ctx),
      state: body.state,
      savedBy: {
        id: ctx.state.user?.id,
        username: ctx.state.user?.username,
        role: ctx.state.user?.role,
      },
    })
    auditAccessEvent({
      ctx,
      action: `${ctx.method} ${ctx.path}`,
      resource: 'dashboard-intelligence-state',
      permission: 'view:product-development',
      result: 'allowed',
    })
    ctx.body = {
      ok: true,
      profile: envelope.profile,
      savedAt: envelope.savedAt,
    }
  } catch (err) {
    handleStateError(ctx, err)
  }
})
