import { pool } from '../connector/db'
import { getPermissions } from './permissions'

export interface MenuNode {
  id: string
  code: string
  title: string
  type: 'folder' | 'page'
  path: string | null
  icon: string | null
  children: MenuNode[]
}

export async function getMenuTree(userId: string): Promise<MenuNode[]> {
  const [{ rows }, perms] = await Promise.all([
    pool.query(
      `SELECT id, parent_id, code, title, type, path, icon
         FROM menus
        WHERE status = 'active'
        ORDER BY level, sort_order, id`,
    ),
    getPermissions(userId),
  ])
  const readable = new Set(perms.filter((p) => p.read).map((p) => p.menu))

  // 1) buat semua node
  const nodes = new Map<string, MenuNode>()
  for (const r of rows) {
    nodes.set(String(r.id), {
      id: String(r.id),
      code: r.code,
      title: r.title,
      type: r.type,
      path: r.path,
      icon: r.icon,
      children: [],
    })
  }

  // 2) susun jadi pohon (anak dari parent nonaktif tidak akan terjangkau)
  const roots: MenuNode[] = []
  for (const r of rows) {
    const node = nodes.get(String(r.id))!
    if (r.parent_id === null) roots.push(node)
    else nodes.get(String(r.parent_id))?.children.push(node)
  }

  // 3) saring: page tampil jika boleh read, folder tampil jika masih punya anak
  const prune = (n: MenuNode): MenuNode | null => {
    if (n.type === 'page') return readable.has(n.code) ? n : null
    n.children = n.children.map(prune).filter((c): c is MenuNode => c !== null)
    return n.children.length > 0 ? n : null
  }

  return roots.map(prune).filter((n): n is MenuNode => n !== null)
}