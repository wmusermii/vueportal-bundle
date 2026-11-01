// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'portal',
      script: 'dist/server/index.js',   // SESUAIKAN: file entry backend hasil build
      cwd: __dirname,                    // agar .env dan path relatif terbaca dari folder ini
      instances: 1,                      // 1 proses (Socket.IO butuh sticky session kalau cluster)
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      time: true,                        // tambahkan timestamp di log
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};