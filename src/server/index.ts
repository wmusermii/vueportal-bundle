import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { pool } from './connector/db'
// import { Server } from 'socket.io'
import { setupSocket } from './socket'
import cookieParser from 'cookie-parser'
import { authRouter } from './routes/auth'

import { requireAuth } from './middleware/auth'
import { usersRouter } from './routes/users'

import { menusRouter } from './routes/menus'
import { groupsRouter } from './routes/groups'
import { profileRouter } from './routes/profile'
import { parametersRouter } from './routes/parameters'
import { startLoginAttemptCleanup } from './services/loginSecurity'

import { publicRouter } from './routes/public'

const app = express()
// di belakang reverse proxy (nginx), isi TRUST_PROXY=1 di .env agar IP klien terbaca benar
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 0))
const server = http.createServer(app)
// const io = new Server(server)
setupSocket(server)
app.use(express.json())
app.use(cookieParser())

app.use('/api/auth', authRouter)
app.use('/api/users', requireAuth, usersRouter)
app.use('/api/groups', requireAuth, groupsRouter)
app.use('/api/profile', requireAuth, profileRouter)
app.use('/api/menus', requireAuth, menusRouter)
app.use('/api/parameters', requireAuth, parametersRouter)

app.use('/api/public', publicRouter)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})


// io.on('connection', (socket) => {
//   console.log('socket terhubung:', socket.id)
//   socket.on('disconnect', () => console.log('socket putus:', socket.id))
// })

// Production: layani hasil build Vue dari dist/client
const clientDir = path.resolve(__dirname, '../client')
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use(express.static(clientDir))
  // fallback agar refresh di route Vue (mis. /master/akses/users) tidak 404
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next()
    }
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ message: 'Terjadi kesalahan pada server' })
})
const PORT = Number(process.env.PORT ?? 3000)
startLoginAttemptCleanup()
server.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`))