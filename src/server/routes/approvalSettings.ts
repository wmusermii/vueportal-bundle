import { Router, type Request, type Response, type RequestHandler } from 'express'
import { requireAuth } from '../middleware/auth'
import { requirePermission } from '../middleware/permission' // sesuaikan: samakan dengan import di routes/users.ts
import { ApprovalError } from '../approval/service'
import { listTypes, listOptions, addAssignment, removeAssignment } from '../approval/settings'

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (e) {
      if (e instanceof ApprovalError) {
        res.status(e.status).json({ message: e.message })
        return
      }
      next(e)
    }
  }

export const approvalSettingsRouter = Router()
approvalSettingsRouter.use(requireAuth)
approvalSettingsRouter.get('/', requirePermission('approval_settings', 'read'), wrap(async (_req, res) => {
  res.json(await listTypes())
}))

approvalSettingsRouter.get('/options', requirePermission('approval_settings', 'read'), wrap(async (_req, res) => {
  res.json(await listOptions())
}))

approvalSettingsRouter.post('/assignments', requirePermission('approval_settings', 'create'), wrap(async (req, res) => {
  await addAssignment(req.body, req.user!.id)
  res.status(201).json({ message: 'Penugasan ditambahkan' })
}))

approvalSettingsRouter.delete('/assignments/:id', requirePermission('approval_settings', 'delete'), wrap(async (req, res) => {
  await removeAssignment(String(req.params.id))
  res.json({ message: 'Penugasan dihapus' })
}))