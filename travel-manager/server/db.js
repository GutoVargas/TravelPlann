// Camada de dados: persistência em arquivo JSON (travel-manager/server/data.json).
// Simples, sem dependências, fácil de trocar por SQLite/Postgres no futuro.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json')

function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return {
      trips: data.trips || [],
      expenses: data.expenses || [],
      transportQuotes: data.transportQuotes || [],
      documents: data.documents || [],
      seq: { trip: 1, expense: 1, transportQuote: 1, document: 1, ...data.seq }
    }
  } catch {
    return { trips: [], expenses: [], transportQuotes: [], documents: [], seq: { trip: 1, expense: 1, transportQuote: 1, document: 1 } }
  }
}

let db = load()

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

const FIELDS_TRIP = ['title', 'destination', 'startDate', 'endDate', 'budget', 'status', 'notes']
const FIELDS_EXPENSE = ['description', 'category', 'amount', 'date', 'documentIds']

export const TRANSPORT_MODES = ['aviao', 'onibus', 'carro', 'trem', 'barco', 'voo_interno', 'outro']
export const DOC_TYPES = ['passagem', 'ingresso', 'comprovante', 'reserva', 'outro']

function sanitizeQuote(data) {
  const out = {}
  if (data.mode !== undefined) {
    if (!TRANSPORT_MODES.includes(data.mode)) throw new Error('tipo de transporte inválido')
    out.mode = data.mode
  }
  for (const f of ['from', 'to', 'company', 'date', 'notes', 'busType']) {
    if (data[f] !== undefined) out[f] = String(data[f]).slice(0, 200)
  }
  if (data.price !== undefined) {
    const p = Number(data.price)
    if (!Number.isFinite(p) || p < 0) throw new Error('preço deve ser um número ≥ 0')
    out.price = Math.round(p * 100) / 100
  }
  if (data.purchased !== undefined) out.purchased = !!data.purchased
  // campos opcionais de resultados de busca real (ex.: HaFFas / BuscaPassagem)
  for (const f of ['source', 'url']) {
    if (data[f] !== undefined) out[f] = String(data[f]).slice(0, 500)
  }
  if (data.durationMin !== undefined) {
    const d = Number(data.durationMin)
    out.durationMin = Number.isFinite(d) && d >= 0 ? Math.round(d) : null
  }
  if (data.departureTime !== undefined) out.departureTime = String(data.departureTime).slice(0, 16)
  if (data.arrivalTime !== undefined) out.arrivalTime = String(data.arrivalTime).slice(0, 16)
  return out
}

function sanitizeDoc(data) {
  const out = {}
  for (const f of ['name', 'mimeType']) {
    if (data[f] !== undefined) out[f] = String(data[f]).slice(0, 300)
  }
  if (data.type !== undefined) {
    if (!DOC_TYPES.includes(data.type)) throw new Error('tipo de documento inválido')
    out.type = data.type
  }
  if (data.data !== undefined) {
    const raw = String(data.data)
    const m = raw.match(/^data:([\w/+.-]+);base64,(.*)$/)
    if (!m) throw new Error('arquivo enviado em formato inválido')
    const mime = m[1]
    const b64 = m[2]
    if (b64.length > 5e6) throw new Error('arquivo muito grande (limite ~3,5 MB)')
    const allowed = /^image\/(png|jpe?g|webp|gif|heic|heif)$|^application\/pdf$/
    if (!allowed.test(mime)) throw new Error('formato não suportado. Envie imagem (PNG/JPG/WebP/GIF) ou PDF.')
    out.mimeType = mime
    out.data = `data:${mime};base64,${b64}`
  }
  return out
}

function sanitizeTrip(data) {
  const out = {}
  for (const f of FIELDS_TRIP) if (data[f] !== undefined) out[f] = data[f]
  if (out.budget !== undefined) out.budget = Number(out.budget) || 0
  const valid = ['planejando', 'andando', 'concluida']
  if (out.status && !valid.includes(out.status)) throw new Error('status inválido')
  return out
}

function tripWithTotals(trip) {
  const expenses = db.expenses.filter((e) => e.tripId === trip.id)
  const spent = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return { ...trip, expenses, spent: Math.round(spent * 100) / 100 }
}

export function listTrips() {
  return db.trips.map(tripWithTotals)
}

export function getTrip(id) {
  const trip = db.trips.find((t) => t.id === id)
  return trip ? tripWithTotals(trip) : null
}

export function createTrip(data) {
  const trip = {
    id: db.seq.trip++,
    title: '', destination: '', startDate: '', endDate: '',
    budget: 0, status: 'planejando', notes: '',
    createdAt: new Date().toISOString(),
    ...sanitizeTrip(data)
  }
  db.trips.push(trip)
  save()
  return tripWithTotals(trip)
}

export function updateTrip(id, data) {
  const trip = db.trips.find((t) => t.id === id)
  if (!trip) return null
  Object.assign(trip, sanitizeTrip(data))
  save()
  return tripWithTotals(trip)
}

export function deleteTrip(id) {
  const exists = db.trips.some((t) => t.id === id)
  if (!exists) return false
  db.trips = db.trips.filter((t) => t.id !== id)
  db.expenses = db.expenses.filter((e) => e.tripId !== id)
  db.transportQuotes = db.transportQuotes.filter((q) => q.tripId !== id)
  db.documents = db.documents.filter((d) => d.tripId !== id)
  save()
  return true
}

// ---------- Cotações de transporte ----------
export function listQuotes(tripId) {
  return db.transportQuotes.filter((q) => q.tripId === tripId)
}

export function addQuote(tripId, data) {
  if (!db.trips.some((t) => t.id === tripId)) throw new Error('viagem não encontrada')
  const q = {
    id: db.seq.transportQuote++,
    tripId,
    mode: 'aviao', from: '', to: '', company: '', price: 0, date: '', notes: '',
    createdAt: new Date().toISOString(),
    ...sanitizeQuote(data)
  }
  db.transportQuotes.push(q)
  save()
  return q
}

export function updateQuote(id, data) {
  const q = db.transportQuotes.find((x) => x.id === Number(id))
  if (!q) return null
  Object.assign(q, sanitizeQuote(data))
  // "Comprei!" → lança o valor como gasto na categoria transporte (uma única vez)
  if (data.purchased && !q.expenseId) {
    if (!q.price || q.price <= 0) throw new Error('defina um preço antes de marcar como comprada')
    const MODE_LABEL = { aviao: 'Voo', onibus: 'Ônibus', carro: 'Carro', trem: 'Trem', barco: 'Barco', voo_interno: 'Voo interno', outro: 'Transporte' }
    const desc = [
      `${MODE_LABEL[q.mode] || 'Transporte'}${q.from || q.to ? ` ${q.from}→${q.to}` : ''}`,
      q.company
    ].filter(Boolean).join(' ').trim() || 'Passagem de transporte'
    const exp = addExpense(q.tripId, {
      description: desc,
      category: 'transporte',
      amount: q.price,
      date: q.date || new Date().toISOString().slice(0, 10)
    })
    q.expenseId = exp.id
  }
  save()
  return q
}

export function deleteQuote(id) {
  const before = db.transportQuotes.length
  db.transportQuotes = db.transportQuotes.filter((q) => q.id !== Number(id))
  if (before === db.transportQuotes.length) return false
  save()
  return true
}

// Converte uma cotação em gasto da viagem ("comprei essa passagem")
export function convertQuoteToExpense(quoteId) {
  const q = db.transportQuotes.find((x) => x.id === Number(quoteId))
  if (!q) throw new Error('cotação não encontrada')
  if (!q.price || q.price <= 0) throw new Error('defina um preço na cotação antes de converter em gasto')
  const trip = db.trips.find((t) => t.id === q.tripId)
  if (!trip) throw new Error('viagem não encontrada')
  const MODE_LABEL = { aviao: 'Voo', onibus: 'Ônibus', carro: 'Carro', trem: 'Trem', barco: 'Barco', voo_interno: 'Voo interno', outro: 'Transporte' }
  const desc = [
    `${MODE_LABEL[q.mode] || 'Transporte'}${q.from || q.to ? ` ${q.from}→${q.to}` : ''}`,
    q.company
  ].filter(Boolean).join(' ').trim() || 'Passagem de transporte'
  const exp = addExpense(q.tripId, {
    description: desc,
    category: 'transporte',
    amount: q.price,
    date: q.date || new Date().toISOString().slice(0, 10)
  })
  exp.quoteId = q.id
  save()
  return exp
}

// ---------- Documentos (ingressos, passagens, comprovantes) ----------
export function listDocs(tripId) {
  // sem o conteúdo base64 para não pesar na listagem
  return db.documents
    .filter((d) => d.tripId === tripId)
    .map(({ data, ...rest }) => ({ ...rest, size: data ? Math.round((data.length * 3) / 4) : 0 }))
}

export function getDoc(id) {
  return db.documents.find((d) => d.id === Number(id)) || null
}

export function getDocMeta(id) {
  const doc = getDoc(id)
  if (!doc) return null
  const { data, ...rest } = doc
  return { ...rest, size: Math.round((data.length * 3) / 4) }
}

export function addDoc(tripId, data) {
  if (!db.trips.some((t) => t.id === tripId)) throw new Error('viagem não encontrada')
  const clean = sanitizeDoc(data)
  if (!clean.data) throw new Error('envie o arquivo do documento')
  const doc = {
    id: db.seq.document++,
    tripId,
    name: clean.name || 'documento',
    type: clean.type || 'outro',
    mimeType: clean.mimeType,
    data: clean.data,
    expenseId: data.expenseId ? Number(data.expenseId) : null,
    createdAt: new Date().toISOString()
  }
  db.documents.push(doc)
  // se estiver vinculado a um gasto, atualiza a lista dele
  if (doc.expenseId) {
    const exp = db.expenses.find((e) => e.id === doc.expenseId && e.tripId === tripId)
    if (exp) {
      exp.documentIds = [...new Set([...(exp.documentIds || []), doc.id])]
    }
  }
  save()
  const { data: _omit, ...rest } = doc
  return { ...rest, size: Math.round((doc.data.length * 3) / 4) }
}

export function updateDoc(id, data) {
  const doc = db.documents.find((d) => d.id === Number(id))
  if (!doc) return null
  const clean = sanitizeDoc({ ...data, data: undefined }) // permite trocar só nome/tipo
  Object.assign(doc, clean)
  save()
  const { data: _omit, ...rest } = doc
  return { ...rest, size: Math.round((doc.data.length * 3) / 4) }
}

export function deleteDoc(id) {
  const before = db.documents.length
  db.documents = db.documents.filter((d) => d.id !== Number(id))
  if (before === db.documents.length) return false
  for (const e of db.expenses) {
    if (Array.isArray(e.documentIds)) e.documentIds = e.documentIds.filter((x) => x !== Number(id))
  }
  save()
  return true
}

export function addExpense(tripId, data) {
  if (!db.trips.some((t) => t.id === tripId)) throw new Error('viagem não encontrada')
  const amount = Number(data.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('valor deve ser um número positivo')
  const exp = {
    id: db.seq.expense++,
    tripId,
    description: String(data.description).trim(),
    category: data.category || 'outros',
    amount,
    date: data.date || new Date().toISOString().slice(0, 10),
    documentIds: Array.isArray(data.documentIds) ? data.documentIds.map(Number).filter(Boolean) : []
  }
  db.expenses.push(exp)
  save()
  return exp
}

export function updateExpense(id, data) {
  const exp = db.expenses.find((e) => e.id === id)
  if (!exp) return null
  for (const f of FIELDS_EXPENSE) {
    if (data[f] !== undefined) exp[f] = f === 'amount' ? Number(data[f]) : data[f]
  }
  save()
  return exp
}

export function deleteExpense(id) {
  const before = db.expenses.length
  db.expenses = db.expenses.filter((e) => e.id !== id)
  if (before === db.expenses.length) return false
  save()
  return true
}

export function stats() {
  const totalBudget = db.trips.reduce((s, t) => s + (Number(t.budget) || 0), 0)
  const totalSpent = db.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return {
    trips: db.trips.length,
    byStatus: {
      planejando: db.trips.filter((t) => t.status === 'planejando').length,
      andando: db.trips.filter((t) => t.status === 'andando').length,
      concluida: db.trips.filter((t) => t.status === 'concluida').length
    },
    totalBudget: Math.round(totalBudget * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100
  }
}
