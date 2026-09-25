// Entry point do servidor Express (arquitetura MVC + SQLite).
import fs from 'node:fs'
import path from 'node:path'
import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import { apiRouter } from './routes'

const app = express()
const PORT = Number(process.env.PORT || 3001)
const DIST = path.join(__dirname, '..', '..', 'dist')

app.use(cors())
app.use(express.json({ limit: '8mb' }))

// logs curtos de acesso
app.use('/api', (req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`)
  next()
})

app.use('/api', apiRouter)

// handler central de erros: modelos lançam Error com mensagens amigáveis
app.use('/api', (err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as unknown as { status?: number }).status || (/inválid|obrigat|deve ser|não encontrad|limite|muito grande|suportado/i.test(err.message) ? 400 : 500)
  if (status >= 500) console.error('💥', err)
  res.status(status).json({ error: err.message })
})

// em produção serve o build estático do Vite (SPA fallback incluso)
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(DIST, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`✅ API Viaja+ (Express + SQLite/MVC) rodando em http://localhost:${PORT}`)
})
