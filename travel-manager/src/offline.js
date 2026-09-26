// Camada offline-first: IndexedDB como espelho local + fila de sincronização.
// - Leituras vêm do IndexedDB (instantâneas e disponíveis sem internet).
// - Toda mutação é aplicada localmente na hora; quando online, enviamos à API REST
//   normalmente (o servidor grava no SQLite); ao reconectar, syncNow() empurra a fila
//   de mudanças feitas OFFLINE para /api/sync/push e puxa novidades via cursor.
const DB_NAME = 'viajamaiss-offline'
const DB_VERSION = 2
const STORES = ['trips', 'expenses', 'transport_quotes', 'documents']
const QUEUE = 'sync_queue'
const META = 'meta'

let dbPromise = null
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' })
        if (!d.objectStoreNames.contains(QUEUE)) d.createObjectStore(QUEUE, { keyPath: 'qid', autoIncrement: true })
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META)
        if (!d.objectStoreNames.contains(STOP_CACHE)) d.createObjectStore(STOP_CACHE, { keyPath: 'name' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

async function tx(store, mode, fn) {
  const d = await openDB()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

const getMeta = async (k) => (await tx(META, 'readonly', (s) => s.get(k))) ?? null
const setMeta = (k, v) => tx(META, 'readwrite', (s) => s.put(v, k))

// ---------- cache de sugestões de estações (fallback offline) ----------
// Toda sugestão de lugar (Google Places) recebida em vida é espelhada no IndexedDB. Quando a
// rede/provedor falha, procuramos nesse histórico + num dicionário embutido de
// cidades populares, para o autocomplete nunca ficar vazio.
const STOP_CACHE = 'stop_cache' // value: [{ name, district }] — histórico aprendido

// carrega o histórico inteiro uma vez e mantém em memória (evita N transações)
let stopHistory = null
async function getStopHistory() {
  if (!stopHistory) {
    try { stopHistory = (await tx(STOP_CACHE, 'readonly', (s) => s.getAll()))?.result || [] }
    catch { stopHistory = [] }
  }
  return stopHistory
}

export async function cacheStops(list) {
  try {
    const hist = await getStopHistory()
    let dirty = false
    for (const s of list || []) {
      const name = String(s.name || '').trim()
      if (!name) continue
      if (!hist.some((p) => p.name === name)) { hist.push({ name, district: s.district || '' }); dirty = true }
    }
    if (dirty) {
      const trimmed = hist.slice(-4000) // teto de segurança
      await tx(STOP_CACHE, 'readwrite', (st) => { st.clear(); for (const e of trimmed) st.put(e) })
    }
  } catch { /* cache é melhor esforço */ }
}

// dicionário embutido PT-BR -> nomes oficiais (espelho do stopNames.ts do server).
// Usado APENAS como fallback quando a API está fora do ar — são nomes reais de
// cidades europeias; a busca final ainda tenta o provedor quando online.
const EU_CITY_ALIASES = {
  munique: ['München'], munich: ['München'], berlim: ['Berlin'], paris: ['Paris'],
  londres: ['London'], london: ['London'], roma: ['Roma'], florenca: ['Firenze'],
  veneza: ['Venezia'], milao: ['Milano'], napoles: ['Napoli'], barcelona: ['Barcelona'],
  madri: ['Madrid'], lisboa: ['Lisboa'], porto: ['Porto'], amsterda: ['Amsterdam'],
  haia: ["'s-Gravenhage"], bruxelas: ['Bruxelles'], antuerpia: ['Antwerpen'],
  viena: ['Wien'], zurique: ['Zürich'], genebra: ['Genève'], praga: ['Praha'],
  budapeste: ['Budapest'], warsavia: ['Warszawa'], cracovia: ['Kraków'],
  estocolmo: ['Stockholm'], copenhague: ['København'], helsinque: ['Helsinki'],
  dublim: ['Dublin'], franfurt: ['Frankfurt'], hamburg: ['Hamburg'], colonia: ['Köln'],
  nuremberga: ['Nürnberg'], estrasburgo: ['Strasbourg'], lyon: ['Lyon'],
  marselha: ['Marseille'], nice: ['Nice'], salzburg: ['Salzburg'], innsbruck: ['Innsbruck'],
  valencia: ['Valencia'], sevilha: ['Sevilla'], sevila: ['Sevilla'], oporto: ['Porto']
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export async function localStopSuggestions(q) {
  const query = fold(String(q || '').trim())
  if (query.length < 2) return []
  const out = []
  const seen = new Set()
  const push = (name, district) => {
    const k = fold(name)
    // casa se o nome contém a busca ("münchen"→"Munique Hbf") OU se a busca casa
    // com um alias PT-BR da cidade desse nome ("munique"→"München Hbf")
    const aliasHit = Object.entries(EU_CITY_ALIASES).some(([a, targets]) =>
      targets.some((t) => k.startsWith(fold(t))) && (fold(a) === query || fold(a).startsWith(query) || query.startsWith(fold(a))))
    if (!seen.has(k) && (k.includes(query) || aliasHit)) { seen.add(k); out.push({ name, district }) }
  }
  // 1) histórico real aprendido (IndexedDB)
  const hist = await getStopHistory()
  for (const e of hist) push(e.name, e.district)
  // 2) dicionário embutido (igualdade/prefixo em PT-BR ou grafia local).
  //    Para as capitais, adicionamos também a estação central real mais usada.
  const CENTRAL = { Paris: 'Paris Gare de Lyon', London: 'London St Pancras Intl', Wien: 'Wien Hbf', Praha: 'Praha main station' }
  for (const [alias, targets] of Object.entries(EU_CITY_ALIASES)) {
    if (fold(alias) === query || fold(alias).startsWith(query) || query.startsWith(fold(alias))) {
      for (const t of targets) push(CENTRAL[t] || `${t} Hbf`, '')
    }
  }
  return out.slice(0, 8)
}

// ---------- conversões ----------
const SNAKE_RE = /_([a-z])/g
const toCamel = (row) => {
  const o = {}
  for (const [k, v] of Object.entries(row || {})) {
    const nk = k.replace(SNAKE_RE, (_, c) => c.toUpperCase())
    if (nk === 'documentIds' && typeof v === 'string') { try { o[nk] = JSON.parse(v) } catch { o[nk] = [] } }
    else o[nk] = v
  }
  return o
}

// mapeia objetos da UI (camelCase) para linhas SQLite (colunas reais)
const COLS = {
  trips: ['title', 'destination', 'start_date', 'end_date', 'budget', 'status', 'notes', 'currency', 'created_at'],
  expenses: ['trip_id', 'description', 'category', 'amount', 'date', 'quote_id', 'document_ids'],
  transport_quotes: ['trip_id', 'mode', 'origin', 'destination', 'company', 'price', 'date', 'notes', 'purchased', 'expense_id', 'bus_type', 'departure_time', 'arrival_time', 'duration_min', 'source', 'url'],
  documents: ['trip_id', 'name', 'type', 'mime_type', 'data', 'expense_id', 'created_at']
}
const camel = (c) => c.replace(/_([a-z])/g, (_, x) => x.toUpperCase())
const toRow = (table, obj) => {
  const out = {}
  for (const col of COLS[table]) {
    let v = obj[camel(col)]
    if (v === undefined) v = obj[col]
    if (v === undefined) continue
    if (Array.isArray(v)) v = JSON.stringify(v)
    else if (col === 'purchased') v = v ? 1 : 0
    out[col] = v
  }
  const nid = Number(obj.id)
  out.id = Number.isFinite(nid) ? nid : undefined
  return out
}

// ---------- status observable (banner offline na UI) ----------
const listeners = new Set()
export const subscribeOffline = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
let status = { online: navigator.onLine, syncing: false, pending: 0, lastSync: null, error: null }
function emit(patch) {
  status = { ...status, ...patch }
  for (const l of listeners) l(status)
}
setInterval(() => refreshPending(), 4000)
async function refreshPending() {
  try {
    const d = await openDB()
    const count = await new Promise((res) => { const r = d.transaction(QUEUE).objectStore(QUEUE).count(); r.onsuccess = () => res(r.result) })
    if (count !== status.pending) emit({ pending: count })
  } catch { /* ignore */ }
}

// ---------- bootstrap: snapshot inicial quando nunca sincronizamos ----------
export async function ensureBootstrapped(fetchFullSnapshot) {
  const cursor = await getMeta('cursor')
  if (cursor != null) return false
  try {
    const data = await fetchFullSnapshot() // { serverTime, changes:[{table,rowId,action,payload}] }
    for (const ch of data.changes || []) {
      if (ch.action === 'upsert' && ch.payload && ch.payload.id != null) await applyServerRow(ch.table, ch.payload)
    }
    await setMeta('cursor', Math.floor(Number(data.serverTime) || 0))
    emit({ lastSync: Date.now() })
    cacheMissingDocFiles().catch(() => {})
    return true
  } catch {
    return false // sem servidor e sem cache: primeira carga falhou, tenta depois
  }
}

// Carrega dados vindos da API (viagens com expenses/quotes/docs aninhados) no IndexedDB
export async function loadFromApi(trips) {
  const d = await openDB()
  await new Promise((resolve, reject) => {
    const t = d.transaction([...STORES], 'readwrite')
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    const stores = Object.fromEntries(STORES.map((s) => [s, t.objectStore(s)]))
    for (const trip of trips || []) {
      const { expenses = [], quotes = [], docs = [] } = trip
      stores.trips.put(toRow('trips', trip))
      for (const e of expenses) stores.expenses.put(toRow('expenses', { ...e, tripId: trip.id }))
      for (const q of quotes) stores.transport_quotes.put(toRow('transport_quotes', { ...q, tripId: trip.id }))
      for (const doc of docs) stores.documents.put(toRow('documents', { ...doc, tripId: trip.id })) // sem binário por enquanto
    }
  })
  cacheMissingDocFiles().catch(() => {})
}

// Baixa os binários dos documentos ainda não cacheados (para abrir ingressos offline)
async function cacheMissingDocFiles() {
  const rows = await tx('documents', 'readonly', (s) => s.getAll())
  const missing = (rows || []).filter((r) => !r.data)
  for (const r of missing) {
    try {
      const res = await fetch(`/api/trips/${r.trip_id}/docs/${r.id}/file`)
      if (!res.ok) continue
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let b64 = ''
      for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
      const dataUrl = `data:${r.mime_type || 'application/octet-stream'};base64,${btoa(b64)}`
      await tx('documents', 'readwrite', (s) => s.put({ ...r, data: dataUrl }))
    } catch { /* offline ou servidor fora — tenta na próxima sync */ }
  }
}

// ---------- leituras locais ----------
export async function localTrips() {
  const d = await openDB()
  const read = (store) => new Promise((res) => { const r = d.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result || []) })
  const [trips, expenses, quotes, docs] = await Promise.all(STORES.map(read))
  const byTrip = (rows) => {
    const m = new Map()
    for (const r of rows) { const k = r.trip_id; if (!m.has(k)) m.set(k, []); m.get(k).push(toCamel(r)) }
    return m
  }
  const em = byTrip(expenses), qm = byTrip(quotes), dm = byTrip(docs)
  return trips
    .map(toCamel)
    .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')))
    .map((t) => ({
      ...t,
      expenses: (em.get(t.id) || []).sort((a, b) => String(b.date).localeCompare(String(a.date))),
      quotes: qm.get(t.id) || [],
      docs: dm.get(t.id) || []
    }))
}

export async function localStats() {
  const trips = await localTrips()
  const byStatus = { planejando: 0, andando: 0, concluida: 0 }
  let totalBudget = 0, totalSpent = 0
  for (const t of trips) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1
    totalBudget += Number(t.budget) || 0
    totalSpent += (t.expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  }
  return { trips: trips.length, byStatus, totalBudget, totalSpent }
}

// ---------- gravação local + fila ----------
async function queue(table, action, row) {
  await tx(QUEUE, 'readwrite', (s) => s.add({ table, action, row, ts: Date.now() }))
  refreshPending()
}

export async function localUpsert(table, row) {
  const r = toRow(table, row)
  await tx(table, 'readwrite', (s) => s.put(r))
  return r
}

export async function localDelete(table, id) {
  await tx(table, 'readwrite', (s) => s.delete(Number(id)))
}

// registra a mudança para envio posterior (usada apenas quando estamos OFFLINE)
export async function queueChange(table, action, rowOrId) {
  if (action === 'upsert') await queue(table, 'upsert', toRow(table, rowOrId))
  else await queue(table, 'delete', { id: Number(rowOrId) })
}

// aplica linha vinda do servidor (pull) sem enfileirar
export async function applyServerRow(table, row) {
  await tx(table, 'readwrite', (s) => s.put(toRow(table, row)))
}
export async function removeLocal(table, id) {
  await tx(table, 'readwrite', (s) => s.delete(Number(id)))
}

// ---------- ciclo de sincronização (fila offline -> servidor; servidor -> cliente) ----------
let syncing = false
export async function syncNow(apiFetch) {
  if (syncing) return false
  syncing = true
  emit({ syncing: true, error: null })
  try {
    if (!navigator.onLine) throw Object.assign(new Error('offline'), { soft: true })
    const clientId = await getClientId()
    // 1) push da fila de mudanças feitas offline
    const d = await openDB()
    const items = await new Promise((res) => { const r = d.transaction(QUEUE).objectStore(QUEUE).getAll(); r.onsuccess = () => res(r.result || []) })
    if (items.length) {
      const changes = items.map(({ qid, table, action, row }) => ({ qid, table, action, row, id: row?.id }))
      const out = await apiFetch('/sync/push', { method: 'POST', body: JSON.stringify({ clientId, changes }) })
      const failedQids = new Set((out.failed || []).map((f) => f.change?.qid).filter((x) => x != null))
      // servidor devolveu ids reais p/ inserts locais → remapeia no espelho e nas refs cruzadas
      for (const r of out.remap || []) {
        if (r.oldId !== r.newId) await remapLocalId(r.table, r.oldId, r.newId)
      }
      await tx(QUEUE, 'readwrite', (s) => { for (const it of items) if (!failedQids.has(it.qid)) s.delete(it.qid) })
      if (out.failed?.length) console.warn('sync: mudanças rejeitadas pelo servidor', out.failed)
    }
    // 2) pull de mudanças do servidor desde o último cursor
    let cursor = (await getMeta('cursor')) ?? 0
    // primeira vez neste dispositivo? pede snapshot completo (inclui linhas criadas antes de eu existir)
    if (!(await getMeta('bootstrapped'))) {
      cursor = 0
      var bootstrap = true
    }
    let more = true
    while (more) {
      const data = await apiFetch(`/sync/changes?since=${cursor}${bootstrap ? '&full=1' : ''}`)
      bootstrap = false
      await setMeta('bootstrapped', 1)
      for (const ch of data.changes || []) {
        if (ch.action === 'upsert' && ch.payload && ch.payload.id != null) {
          await applyServerRow(ch.table, ch.payload)
        } else if (ch.action === 'delete') {
          await removeLocal(ch.table, ch.rowId)
        }
      }
      const next = Math.floor(Number(data.serverTime))
      more = (data.changes || []).length >= 5000 && next > cursor
      cursor = Math.max(cursor, next)
      await setMeta('cursor', cursor)
    }
    cacheMissingDocFiles().catch(() => {})
    emit({ syncing: false, lastSync: Date.now(), online: true })
    return true
  } catch (e) {
    emit({ syncing: false, online: !!navigator.onLine, error: e.soft ? null : String(e.message || e) })
    return false
  } finally {
    syncing = false
    refreshPending()
  }
}

async function getClientId() {
  let id = await getMeta('clientId')
  if (!id) { id = 'c-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36); await setMeta('clientId', id) }
  return id
}

// ---------- documentos offline ----------
export async function cacheDocBlob(doc) {
  const cur = (await tx('documents', 'readonly', (s) => s.get(Number(doc.id)))) || {}
  await tx('documents', 'readwrite', (s) => s.put({ ...cur, id: Number(doc.id), data: doc.data }))
}
export async function getLocalDoc(id) {
  const row = await tx('documents', 'readonly', (s) => s.get(Number(id)))
  return row ? toCamel(row) : null
}

// ---------- ativação automática ----------
export function startAutoSync(apiFetch) {
  window.addEventListener('online', () => { emit({ online: true }); syncNow(apiFetch) })
  window.addEventListener('offline', () => emit({ online: false }))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(apiFetch) })
  setInterval(() => { if (navigator.onLine) syncNow(apiFetch) }, 30000)
  setTimeout(() => syncNow(apiFetch), 1500)
}

// menor id local da tabela (para gerar ids negativos temporários offline)
export async function getMinLocalId(table) {
  const rows = await tx(table, 'readonly', (s) => s.getAllKeys())
  const nums = (rows || []).map(Number).filter((n) => Number.isFinite(n))
  return nums.length ? Math.min(0, ...nums) : 0
}

// troca um id local (negativo) pelo id real do servidor, inclusive em referências cruzadas
export async function remapLocalId(table, oldId, newId) {
  oldId = Number(oldId); newId = Number(newId)
  if (!Number.isFinite(oldId) || !Number.isFinite(newId) || oldId === newId) return
  const row = await tx(table, 'readonly', (s) => s.get(oldId))
  if (!row) return
  await tx(table, 'readwrite', (s) => { s.delete(oldId); s.put({ ...row, id: newId }) })
  if (table === 'expenses') {
    const qs = await tx('transport_quotes', 'readonly', (s) => s.getAll())
    for (const q of qs || []) if (Number(q.expense_id) === oldId) await tx('transport_quotes', 'readwrite', (s) => s.put({ ...q, expense_id: newId }))
  }
  if (table === 'transport_quotes') {
    const es = await tx('expenses', 'readonly', (s) => s.getAll())
    for (const e of es || []) if (Number(e.quote_id) === oldId) await tx('expenses', 'readwrite', (s) => s.put({ ...e, quote_id: newId }))
  }
  if (table === 'documents') {
    const es = await tx('expenses', 'readonly', (s) => s.getAll())
    for (const e of es || []) {
      try {
        const ids = JSON.parse(e.document_ids || '[]')
        if (ids.includes(oldId)) await tx('expenses', 'readwrite', (s) => s.put({ ...e, document_ids: JSON.stringify(ids.map((i) => (i === oldId ? newId : i))) }))
      } catch { /* ignore */ }
    }
    const qs2 = await tx('transport_quotes', 'readonly', (s) => s.getAll())
    void qs2
  }
  if (table === 'trips') {
    for (const t of ['expenses', 'transport_quotes', 'documents']) {
      const rows = await tx(t, 'readonly', (s) => s.getAll())
      for (const r of rows || []) if (Number(r.trip_id) === oldId) await tx(t, 'readwrite', (s) => s.put({ ...r, trip_id: newId }))
    }
  }
}

// ---------- utilitários usados pelo cliente REST ----------
export async function listQueue() {
  const d = await openDB()
  return new Promise((res) => { const r = d.transaction(QUEUE).objectStore(QUEUE).getAll(); r.onsuccess = () => res(r.result || []) })
}
export async function replaceQueueItem(qid, item) {
  await tx(QUEUE, 'readwrite', (s) => s.put({ ...item, qid }))
}
export async function deleteQueueItem(qid) {
  await tx(QUEUE, 'readwrite', (s) => s.delete(qid))
}

// empurra imediatamente as mudanças pendentes de UMA linha (ex.: usuário criou offline
// e agora edita de novo estando online — o servidor precisa conhecer a linha antes do PUT)
export async function flushQueueFor(table, id) {
  if (!navigator.onLine) return false
  const items = await listQueue()
  const mine = items.filter((it) => it.table === table && Number(it.row?.id ?? it.row?.id) === Number(id))
  if (!mine.length) return false
  const clientId = await getClientId()
  const res = await fetch('/api/sync/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, changes: mine.map(({ qid, table, action, row }) => ({ qid, table, action, row, id: row?.id })) })
  })
  if (!res.ok) throw new Error('flush falhou')
  const out = await res.json()
  const failedQids = new Set((out.failed || []).map((f) => f.change?.qid).filter((x) => x != null))
  for (const it of mine) {
    if (failedQids.has(it.qid)) continue
    await deleteQueueItem(it.qid)
    const r = (out.remap || []).find((m) => m.oldId === Number(it.row?.id))
    if (r && r.oldId !== r.newId) await remapLocalId(table, r.oldId, r.newId)
  }
  refreshPending()
  return true
}
