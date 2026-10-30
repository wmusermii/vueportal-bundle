import { Router, type Request, type Response, type RequestHandler } from 'express'
import { requireAuth } from '../middleware/auth'
import { sendError } from '../lib/helpers'
import '../approval/handlers' // mendaftarkan semua handler
import { createRequest, listRequests, countPending, groupOptions, decide } from '../approval/service'


const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  async (req, res) => {
    try {
      await fn(req, res)
    } catch (e) {
      sendError(res, e) // HttpError & turunannya, kode error database dipetakan; sisanya jadi 500
    }
  }

const isObject = (x: unknown): x is Record<string, any> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

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
  const r = await decide(String(req.params.id), req.user!.id, 'approve', {
    data: isObject(req.body?.data) ? req.body.data : {},
    note: req.body?.note,
  })
  res.json({
    status: r.status,
    level: r.level,
    message: r.status === 'approved' ? 'Pengajuan disetujui' : `Disetujui. Diteruskan ke tahap ${r.level}`,
  })
}))

approvalRouter.post('/:id/reject', wrap(async (req, res) => {
  await decide(String(req.params.id), req.user!.id, 'reject', { note: req.body?.note })
  res.json({ status: 'rejected', message: 'Pengajuan ditolak' })
}))