// Cliente HTTP da API + camada offline-first.
// - Leituras: sempre do IndexedDB (via offline.js) → instantâneas e sem internet.
// - Mutations online: API REST normal + espelho local imediato.
// - Mutations offline: aplica local + fila de sync (syncNow empurra ao reconectar).
import * as off from './offline.js'

const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await res.json().catch(() => {})
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data
}

export const apiFetch = request

// Lê um File como data URL (base64) para envio à API
export const readFileAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo'))
    fr.readAsDataURL(file)
  })

const isOnline = () => navigator.onLine

// ---------- helpers de escrita com fallback offline ----------
// ids locais negativos evitam colisão com AUTOINCREMENT do servidor;
// após o push, o servidor devolve o id real (remap na fila).
let idCounter = Number(localStorage.getItem('viaja+tempId') || 0)
async function tempId() {
  if (!idCounter) idCounter = Math.min(-1, await off.getMinLocalId('trips'), await off.getMinLocalId('expenses'), await off.getMinLocalId('transport_quotes'), await off.getMinLocalId('documents'))
  idCounter -= 1
  localStorage.setItem('viaja+tempId', String(idCounter))
  return idCounter
}

async function mutate({ endpoint, method = 'POST', body, table, row, after }) {
  // se existe uma mudança desta linha na fila (criada offline antes), envia primeiro
  // para que o PUT/DELETE do servidor encontre o registro.
  if (isOnline() && row?.id != null) await off.flushQueueFor(table, Number(row.id)).catch(() => {})
  if (isOnline()) {
    try {
      const result = await request(endpoint, { method, body: body ? JSON.stringify(body) : undefined })
      const finalRow = after ? after(result) : result
      if (finalRow?.id != null) await off.localUpsert(table, finalRow)
      // linha estava na fila com id temporário? → remapeia p/ id real do servidor
      if (Number(row?.id) < 0 && result?.id != null) {
        await requeueAfterRemap(table, Number(row.id), Number(result.id), { ...(row || {}), ...finalRow, id: Number(result.id) })
      }
      return result
    } catch (e) {
      if (String(e.message).match(/Failed to fetch|NetworkError|Load failed/i)) {
        // servidor caiu no meio da chamada → cai para o modo offline
      } else throw e
    }
  }
  // OFFLINE: aplica localmente + enfileira
  const saved = { ...(row || {}), id: await tempId() }
  await off.localUpsert(table, saved)
  await off.queueChange(table, 'upsert', saved)
  return saved
}

async function destroy(endpoint, table, id) {
  if (isOnline()) {
    try {
      const r = await request(endpoint, { method: 'DELETE' })
      await off.localDelete(table, id)
      return r
    } catch (e) {
      if (!String(e.message).match(/Failed to fetch|NetworkError|Load failed/i)) throw e
    }
  }
  await off.localDelete(table, id)
  await off.queueChange(table, 'delete', id)
  return { ok: true }
}


// troca o id temporário (negativo) pelo id real retornado pela API e atualiza a fila
async function requeueAfterRemap(table, oldId, newId, row) {
  await off.localDelete(table, oldId)
  await off.localUpsert(table, { ...row, id: newId })
  try {
    const items = await off.listQueue()
    for (const it of items) {
      if (it.table === table && Number(it.row?.id) === Number(oldId)) {
        await off.replaceQueueItem(it.qid, { ...it, row: { ...(it.row || {}), id: newId } })
      }
    }
  } catch { /* ignore */ }
}

const tripBody = (t) => ({
  title: t.title, destination: t.destination, startDate: t.startDate, endDate: t.endDate,
  budget: t.budget, status: t.status, notes: t.notes, currency: t.currency
})
const expBody = (e) => ({ description: e.description, category: e.category, amount: e.amount, date: e.date, documentIds: e.documentIds })
const quoteBody = (q) => ({
  mode: q.mode, from: q.from, to: q.to, company: q.company, price: q.price, date: q.date, notes: q.notes,
  purchased: q.purchased, busType: q.busType, departureTime: q.departureTime, arrivalTime: q.arrivalTime,
  durationMin: q.durationMin, source: q.source, url: q.url
})

export const api = {
  // ---------- leituras: locais (offline-first) ----------
  listTrips: () => off.localTrips(),
  stats: () => off.localStats(),
  getTrip: async (id) => {
    const trips = await off.localTrips()
    const t = trips.find((x) => String(x.id) === String(id))
    if (!t) throw new Error('viagem não encontrada')
    return t
  },
  // busca externa (só funciona online — UI trata a falha)
  routes: (params) => request(`/routes?${new URLSearchParams(params)}`),
  suggestPlaces: (q) => request(`/suggest-places?q=${encodeURIComponent(q)}`),
  googleStatus: () => request(`/google-status`),

  // ---------- viagens ----------
  createTrip: async (trip) => {
    const base = { ...tripBody(trip), createdAt: new Date().toISOString() }
    return mutate({
      endpoint: '/trips', body: base, table: 'trips',
      row: { ...base, created_at: base.createdAt }
    })
  },
  updateTrip: async (id, patch) => {
    const cur = await api.getTrip(id)
    const merged = { ...cur, ...patch }
    const body = tripBody(merged)
    await mutate({
      endpoint: `/trips/${id}`, method: 'PUT', body, table: 'trips',
      row: { ...body, id: Number(id), created_at: cur.createdAt }
    })
    return merged
  },
  deleteTrip: (id) => destroy(`/trips/${id}`, 'trips', id),

  // ---------- gastos ----------
  addExpense: (tripId, exp) => {
    const body = expBody(exp)
    return mutate({
      endpoint: `/trips/${tripId}/expenses`, body, table: 'expenses',
      row: { ...body, trip_id: Number(tripId) }
    })
  },
  updateExpense: async (tripId, eid, patch) => {
    const trips = await off.localTrips()
    const cur = trips.flatMap((t) => t.expenses).find((e) => String(e.id) === String(eid)) || {}
    const merged = { ...expBody(cur), ...expBody({ ...cur, ...patch }) }
    return mutate({
      endpoint: `/trips/${tripId}/expenses/${eid}`, method: 'PUT', body: merged, table: 'expenses',
      row: { ...merged, id: Number(eid), trip_id: Number(tripId) }
    })
  },
  deleteExpense: (tripId, eid) => destroy(`/trips/${tripId}/expenses/${eid}`, 'expenses', eid),

  // ---------- cotações ----------
  addQuote: (tripId, q) => {
    const body = quoteBody(q)
    return mutate({
      endpoint: `/trips/${tripId}/quotes`, body, table: 'transport_quotes',
      row: { ...body, trip_id: Number(tripId) }
    })
  },
  updateQuote: async (tripId, qid, patch) => {
    const cur = (await api.getTrip(tripId)).quotes.find((q) => String(q.id) === String(qid)) || {}
    const merged = { ...quoteBody(cur), ...quoteBody({ ...cur, ...patch }) }
    const row = { ...merged, id: Number(qid), trip_id: Number(tripId) }
    // "Comprei!" offline → também cria o gasto localmente
    let expense = null
    if (patch.purchased && !cur.purchased && !cur.expenseId) {
      expense = await api.addExpense(tripId, {
        description: quoteExpenseDescription(merged), category: 'transporte',
        amount: merged.price, date: merged.date
      })
      row.expense_id = Number(expense?.id ?? 0) || null
    }
    const out = await mutate({
      endpoint: `/trips/${tripId}/quotes/${qid}`, method: 'PUT', body: merged, table: 'transport_quotes', row
    })
    return expense ? { ...out, expense } : out
  },
  deleteQuote: (tripId, qid) => destroy(`/trips/${tripId}/quotes/${qid}`, 'transport_quotes', qid),
  convertQuote: (tripId, qid) => request(`/trips/${tripId}/quotes/${qid}/convert`, { method: 'POST' }),

  // ---------- documentos ----------
  uploadDoc: async (tripId, doc) => {
    const body = { name: doc.name, type: doc.type, data: doc.data, expenseId: doc.expenseId }
    const row = {
      name: doc.name, type: doc.type, mime_type: (String(doc.data).split(',')[0].replace(/^data:/, '').replace(';base64', '')) || 'application/octet-stream',
      data: doc.data, expense_id: doc.expenseId ?? null, trip_id: Number(tripId)
    }
    if (!isOnline()) row.id = await tempId() // garante id na fila p/ o push criar a linha
    const created = await mutate({
      endpoint: `/trips/${tripId}/docs`, body, table: 'documents', row
    })
    // garante que o binário fique no cache local mesmo se o servidor remapeou o id
    if (created?.id != null) await off.cacheDocBlob({ id: created.id, data: doc.data })
    return created
  },
  deleteDoc: (tripId, did) => destroy(`/trips/${tripId}/docs/${did}`, 'documents', did),
  getDoc: async (tripId, did) => {
    const local = await off.getLocalDoc(did)
    if (local) return { ...local, size: Math.round(((String(local.data || '').split(',')[1] || '').length) * 0.75) }
    return request(`/trips/${tripId}/docs/${did}`)
  },
  docUrl: (tripId, did) => `${BASE}/trips/${tripId}/docs/${did}/file`
}

function quoteExpenseDescription(q) {
  const labels = { aviao: 'Voo', onibus: 'Ônibus', carro: 'Carro', trem: 'Trem', barco: 'Barco', voo_interno: 'Voo interno', metro: 'Metrô', bus_uefa: 'Ônibus urbano', transfer: 'Transfer', travessia: 'Travessia', outro: 'Transporte' }
  const label = labels[q.mode] || 'Transporte'
  const route = q.from || q.to ? ` ${q.from}→${q.to}` : ''
  return `${label}${route}${q.company ? ' ' + q.company : ''}`.trim() || 'Passagem de transporte'
}

// bootstrap offline: snapshot inicial + sincronização automática
export async function initOffline() {
  await off.ensureBootstrapped(async () => {
    const trips = await request('/sync/changes?full=1')
    return trips
  })
  off.startAutoSync(request)
}

export { off }

export const TRANSPORT_MODES = {
  aviao: { label: '✈️ Avião' },
  onibus: { label: '🚌 Ônibus' },
  carro: { label: '🚗 Carro / aluguel' },
  trem: { label: '🚆 Trem / metrô' },
  barco: { label: '⛴️ Barco / balsa' },
  voo_interno: { label: '🛩️ Voo interno' },
  metro: { label: '🚇 Metrô' },
  bus_uefa: { label: '🚍 Ônibus urbano (Europa)' },
  transfer: { label: '🚐 Transfer / táxi' },
  travessia: { label: '⛴️ Travessia de balsa' },
  outro: { label: '🧭 Outro' }
}

export const DOC_TYPES = {
  passagem: { label: '🎫 Passagem' },
  ingresso: { label: '🎟️ Ingresso' },
  comprovante: { label: '🧾 Comprovante' },
  reserva: { label: '🏨 Reserva' },
  outro: { label: '📎 Outro' }
}

export const CATEGORIES = {
  transporte: { label: '🚗 Transporte' },
  hospedagem: { label: '🏨 Hospedagem' },
  alimentacao: { label: '🍽️ Alimentação' },
  passeios: { label: '🎟️ Passeios' },
  compras: { label: '🛍️ Compras' },
  outros: { label: '📦 Outros' }
}

export const STATUSES = {
  planejando: { label: 'Planejando', icon: '📝' },
  andando: { label: 'Andando', icon: '🧳' },
  concluida: { label: 'Concluída', icon: '✅' }
}

export const brl = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
