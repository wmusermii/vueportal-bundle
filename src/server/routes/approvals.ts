import { Router, type Request, type Response, type RequestHandler } from 'express'
import { requireAuth } from '../middleware/auth'
import '../approval/handlers' // mendaftarkan semua handler
import {
  ApprovalError, createRequest, listRequests, countPending, groupOptions, decide,
} from '../approval/service'

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

// PUBLIK (tanpa login): self registration
export const registerRouter = Router()
registerRouter.post('/', wrap(async (req, res) => {
  await createRequest('USER_REGISTRATION', req.body, null)
  res.status(201).json({ message: 'Pendaftaran terkirim. Tunggu persetujuan dari administrator/manager.' })
}))

// TERPROTEKSI: inbox approval
export const approvalRouter = Router()
approvalRouter.use(requireAuth)

approvalRouter.get('/', wrap(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  res.json(await listRequests(req.user!.id, status))
}))

approvalRouter.get('/pending-count', wrap(async (req, res) => {
  res.json({ count: await countPending(req.user!.id) })
}))

approvalRouter.get('/group-options', wrap(async (req, res) => {
  res.json(await groupOptions(req.user!.id))
}))

approvalRouter.post('/:id/approve', wrap(async (req, res) => {
  await decide(String(req.params.id), req.user!.id, 'approve', {
    decision: typeof req.body?.decision === 'object' && req.body.decision ? req.body.decision : {},
    note: req.body?.note,
  })
  res.json({ message: 'Pengajuan disetujui' })
}))

approvalRouter.post('/:id/reject', wrap(async (req, res) => {
  await decide(String(req.params.id), req.user!.id, 'reject', { note: req.body?.note })
  res.json({ message: 'Pengajuan ditolak' })
}))