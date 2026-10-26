import { Router } from 'express'
import { getMenuTree } from '../services/menus'

export const menusRouter = Router()

menusRouter.get('/mine', async (req, res) => {
  res.json(await getMenuTree(req.user!.id))
})