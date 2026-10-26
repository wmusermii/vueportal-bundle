import type { NextFunction, Request, Response } from 'express'
import { getPermissions } from '../services/permissions'

type Action = 'create' | 'read' | 'update' | 'delete'

export function requirePermission(menu: string, action: Action) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const perms = await getPermissions(req.user!.id)
      const p = perms.find((x) => x.menu === menu)
      if (!p || !p[action]) {
        res.status(403).json({ message: 'Anda tidak punya izin untuk aksi ini' })
        return
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}