// Servidor HTTP sem dependências externas (Node puro).
// - Em DEV: a UI é servida pelo Vite (porta 5173) que repassa /api para cá (porta 3001).
// - Em PROD: serve também o build estático da pasta dist/.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  listTrips, getTrip, createTrip, updateTrip, deleteTrip,
  addExpense, updateExpense, deleteExpense, stats,
  listQuotes, addQuote, updateQuote, deleteQuote, convertQuoteToExpense,
  listDocs, getDoc, addDoc, updateDoc, deleteDoc
} from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = process.env.PORT || 3001

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readBody(req, limit = 8e6) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > limit) { reject(new Error('payload muito grande')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
  try {
    // GET /api/health
    if (parts[1] === 'health') return sendJson(res, 200, { ok: true })

    // GET /api/stats
    if (parts[1] === 'stats' && req.method === 'GET') return sendJson(res, 200, stats())

    // /api/trips e /api/trips/:id
    if (parts[1] === 'trips') {
      const id = parts[2] ? Number(parts[2]) : null

      // /api/trips/:id/expenses e /api/trips/:id/expenses/:eid
      if (parts[3] === 'expenses') {
        const eid = parts[4] ? Number(parts[4]) : null
        if (!id) return sendJson(res, 400, { error: 'viagem não informada' })
        if (req.method === 'POST' && !eid) {
          const data = await readBody(req)
          if (!data.description || !data.description.trim()) {
            return sendJson(res, 400, { error: 'descrição é obrigatória' })
          }
          const exp = addExpense(id, data)
          return sendJson(res, 201, exp)
        }
        if (req.method === 'PUT' && eid) {
          const data = await readBody(req)
          const exp = updateExpense(eid, data)
          return exp ? sendJson(res, 200, exp) : sendJson(res, 404, { error: 'gasto não encontrado' })
        }
        if (req.method === 'DELETE' && eid) {
          return deleteExpense(eid) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'gasto não encontrado' })
        }
        return sendJson(res, 405, { error: 'método não permitido' })
      }

      // /api/trips/:id/quotes , /api/trips/:id/quotes/:qid , /api/trips/:id/quotes/:qid/convert
      if (parts[3] === 'quotes') {
        if (!id) return sendJson(res, 400, { error: 'viagem não informada' })
        const qid = parts[4] ? Number(parts[4]) : null
        if (req.method === 'GET' && !qid) return sendJson(res, 200, listQuotes(id))
        if (req.method === 'POST' && !qid) {
          const data = await readBody(req)
          return sendJson(res, 201, addQuote(id, data))
        }
        if (req.method === 'PUT' && qid) {
          const data = await readBody(req)
          const q = updateQuote(qid, data)
          return q ? sendJson(res, 200, q) : sendJson(res, 404, { error: 'cotação não encontrada' })
        }
        if (req.method === 'POST' && qid && parts[5] === 'convert') {
          return sendJson(res, 201, convertQuoteToExpense(qid))
        }
        if (req.method === 'DELETE' && qid) {
          return deleteQuote(qid) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'cotação não encontrada' })
        }
        return sendJson(res, 405, { error: 'método não permitido' })
      }

      // /api/trips/:id/docs , /api/trips/:id/docs/:did , /api/trips/:id/docs/:did/file
      if (parts[3] === 'docs') {
        if (!id) return sendJson(res, 400, { error: 'viagem não informada' })
        const did = parts[4] ? Number(parts[4]) : null
        if (req.method === 'GET' && !did) return sendJson(res, 200, listDocs(id))
        if (req.method === 'GET' && did && parts[5] === 'file') {
          const doc = getDoc(did)
          if (!doc || doc.tripId !== id) return sendJson(res, 404, { error: 'documento não encontrado' })
          const base64 = doc.data.split(',')[1]
          res.writeHead(200, {
            'Content-Type': doc.mimeType,
            'Content-Disposition': `inline; filename="${encodeURIComponent(doc.name)}"`
          })
          return res.end(Buffer.from(base64, 'base64'))
        }
        if (req.method === 'GET' && did) {
          const meta = getDocMeta(did)
          return meta && meta.tripId === id ? sendJson(res, 200, meta) : sendJson(res, 404, { error: 'documento não encontrado' })
        }
        if (req.method === 'POST' && !did) {
          const data = await readBody(req)
          return sendJson(res, 201, addDoc(id, data))
        }
        if (req.method === 'PUT' && did) {
          const data = await readBody(req)
          const doc = updateDoc(did, data)
          return doc ? sendJson(res, 200, doc) : sendJson(res, 404, { error: 'documento não encontrado' })
        }
        if (req.method === 'DELETE' && did) {
          return deleteDoc(did) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'documento não encontrado' })
        }
        return sendJson(res, 405, { error: 'método não permitido' })
      }

      if (!id) {
        if (req.method === 'GET') return sendJson(res, 200, listTrips())
        if (req.method === 'POST') {
          const data = await readBody(req)
          if (!data.title || !data.title.trim()) {
            return sendJson(res, 400, { error: 'título é obrigatório' })
          }
          return sendJson(res, 201, createTrip(data))
        }
        return sendJson(res, 405, { error: 'método não permitido' })
      }

      if (req.method === 'GET') {
        const trip = getTrip(id)
        if (!trip) return sendJson(res, 404, { error: 'viagem não encontrada' })
        trip.quotes = listQuotes(id)
        trip.docs = listDocs(id)
        return sendJson(res, 200, trip)
      }
      if (req.method === 'PUT') {
        const data = await readBody(req)
        const trip = updateTrip(id, data)
        return trip ? sendJson(res, 200, trip) : sendJson(res, 404, { error: 'viagem não encontrada' })
      }
      if (req.method === 'DELETE') {
        return deleteTrip(id) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'viagem não encontrada' })
      }
      return sendJson(res, 405, { error: 'método não permitido' })
    }

    return sendJson(res, 404, { error: 'rota não encontrada' })
  } catch (e) {
    return sendJson(res, 400, { error: e.message })
  }
}

function serveStatic(res, pathname) {
  let filePath = path.join(DIST, pathname === '/' ? 'index.html' : pathname)
  // proteção contra path traversal
  if (!filePath.startsWith(DIST)) { res.writeHead(403); return res.end('Proibido') }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html') // SPA fallback
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  // CORS simples (útil se o front for aberto direto do arquivo/dupla porta)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  if (url.pathname.startsWith('/api')) return handleApi(req, res, url)

  if (process.env.NODE_ENV === 'production' && fs.existsSync(DIST)) {
    return serveStatic(res, url.pathname)
  }
  sendJson(res, 404, { error: 'API em execução. Use o Vite (npm run dev) para acessar a interface.' })
})

server.listen(PORT, () => {
  console.log(`✅ API do Viaja+ rodando em http://localhost:${PORT}`)
})
