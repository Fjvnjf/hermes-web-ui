import Router from '@koa/router'
import { requirePermission } from '../../middleware/access-control'

export const investorRoutes = new Router()

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
