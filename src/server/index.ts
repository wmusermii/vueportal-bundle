import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { Server } from 'socket.io'

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

io.on('connection', (socket) => {
  console.log('socket terhubung:', socket.id)
  socket.on('disconnect', () => console.log('socket putus:', socket.id))
})

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

const PORT = Number(process.env.PORT ?? 3000)
server.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`))