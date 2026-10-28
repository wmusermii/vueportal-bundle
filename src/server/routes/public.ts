import { Router } from 'express'
import { getBool, getString } from '../services/params'

export const publicRouter = Router()

publicRouter.get('/portal', async (_req, res) => {
  const [name, supportEmail, maintenance] = await Promise.all([
    getString('portal', 'name', 'Portal'),
    getString('portal', 'support_email', ''),
    getBool('portal', 'maintenance_mode', false),
  ])
  res.set('Cache-Control', 'no-store')
  res.json({ name: name || 'Portal', supportEmail, maintenance })
})