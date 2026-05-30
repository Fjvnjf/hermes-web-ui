import Router from '@koa/router'
import { auditAccessEvent, requirePermission } from '../../middleware/access-control'

export const investorRoutes = new Router()

investorRoutes.post('/api/hermes/access-denied', requirePermission('view:account'), (ctx) => {
  const body = ctx.request.body as { route?: unknown; reason?: unknown } | undefined
  const route = String(body?.route || '').slice(0, 160)
  auditAccessEvent({
    ctx,
    action: 'route-denied',
    resource: route || 'unknown-route',
    result: 'denied',
    reason: String(body?.reason || 'frontend-route-guard').slice(0, 120),
  })
  ctx.body = { success: true }
})

investorRoutes.get('/api/hermes/investor/portal', requirePermission('view:investor-approved'), (ctx) => {
  ctx.body = {
    status: 'approved-view',
    sections: [
      'approved investor presentation',
      'approved feasibility summary',
      'approved IRR scenario',
      'approved risk register',
      'approved evidence status',
      'approved data-room documents',
    ],
    note: 'Raw chats, memory, files, formulas, costs, supplier quotes, and system tools are excluded from this endpoint.',
  }
})
