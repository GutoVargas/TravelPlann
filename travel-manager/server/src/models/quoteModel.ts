// Model TransportQuote — cotações de transporte; "comprei" vira gasto.
import { db, logChange } from '../db'
import * as expenseModel from './expenseModel'

export const TRANSPORT_MODES = [
  'aviao', 'onibus', 'carro', 'trem', 'barco', 'voo_interno',
  'metro', 'bus_uefa', 'transfer', 'travessia', 'outro'
]

const MODE_LABEL: Record<string, string> = {
  aviao: 'Voo', onibus: 'Ônibus', carro: 'Carro', trem: 'Trem', barco: 'Barco',
  voo_interno: 'Voo interno', metro: 'Metrô', bus_uefa: 'Ônibus urbano',
  transfer: 'Transfer', travessia: 'Travessia', outro: 'Transporte'
}

interface QuoteRow {
  id: number
  trip_id: number
  mode: string
  origin: string
  destination: string
  company: string
  price: number
  date: string
  notes: string
  purchased: number
  expense_id: number | null
  bus_type: string | null
  departure_time: string | null
  arrival_time: string | null
  duration_min: number | null
  source: string | null
  url: string | null
}

export interface QuoteInput {
  mode?: string
  from?: string
  to?: string
  company?: string
  price?: number | string
  date?: string
  notes?: string
  purchased?: boolean
  busType?: string
  departureTime?: string
  arrivalTime?: string
  durationMin?: number
  source?: string
  url?: string
}

function toDto(r: QuoteRow) {
  return {
    id: r.id,
    tripId: r.trip_id,
    mode: r.mode,
    from: r.origin,
    to: r.destination,
    company: r.company,
    price: Number(r.price),
    date: r.date,
    notes: r.notes,
    purchased: !!r.purchased,
    expenseId: r.expense_id,
    busType: r.bus_type,
    departureTime: r.departure_time,
    arrivalTime: r.arrival_time,
    durationMin: r.duration_min,
    source: r.source,
    url: r.url
  }
}

function sanitize(data: QuoteInput): Partial<QuoteRow> {
  const out: Record<string, unknown> = {}
  if (data.mode !== undefined) {
    if (!TRANSPORT_MODES.includes(data.mode)) throw new Error('tipo de transporte inválido')
    out.mode = data.mode
  }
  for (const [src, col] of [
    ['from', 'origin'], ['to', 'destination'], ['company', 'company'],
    ['date', 'date'], ['notes', 'notes'], ['busType', 'bus_type']
  ] as const) {
    if ((data as Record<string, unknown>)[src] !== undefined) {
      out[col] = String((data as Record<string, unknown>)[src]).slice(0, src === 'notes' ? 1000 : 200)
    }
  }
  if (data.price !== undefined) {
    const p = Number(data.price)
    if (!Number.isFinite(p) || p < 0) throw new Error('preço deve ser um número ≥ 0')
    out.price = Math.round(p * 100) / 100
  }
  if (data.purchased !== undefined) out.purchased = data.purchased ? 1 : 0
  for (const f of ['source', 'url'] as const) {
    if (data[f] !== undefined) out[f] = String(data[f]).slice(0, 500)
  }
  if (data.durationMin !== undefined) {
    const d = Number(data.durationMin)
    out.duration_min = Number.isFinite(d) && d >= 0 ? Math.round(d) : null
  }
  if (data.departureTime !== undefined) out.departure_time = String(data.departureTime).slice(0, 16)
  if (data.arrivalTime !== undefined) out.arrival_time = String(data.arrivalTime).slice(0, 16)
  return out as Partial<QuoteRow>
}

export function listByTrip(tripId: number) {
  const rows = db.prepare('SELECT * FROM transport_quotes WHERE trip_id = ? ORDER BY id').all(tripId) as QuoteRow[]
  return rows.map(toDto)
}

export function get(id: number) {
  const r = db.prepare('SELECT * FROM transport_quotes WHERE id = ?').get(id) as QuoteRow | undefined
  return r ? toDto(r) : null
}

export function create(tripId: number, data: QuoteInput) {
  if (!db.prepare('SELECT id FROM trips WHERE id = ?').get(tripId)) throw new Error('viagem não encontrada')
  const s = sanitize(data)
  const info = db
    .prepare(
      `INSERT INTO transport_quotes
        (trip_id, mode, origin, destination, company, price, date, notes, purchased,
         bus_type, departure_time, arrival_time, duration_min, source, url)
       VALUES
        (@trip_id, @mode, @origin, @destination, @company, @price, @date, @notes, @purchased,
         @bus_type, @departure_time, @arrival_time, @duration_min, @source, @url)`
    )
    .run({
      trip_id: tripId,
      mode: s.mode ?? 'aviao',
      origin: s.origin ?? '',
      destination: s.destination ?? '',
      company: s.company ?? '',
      price: s.price ?? 0,
      date: s.date ?? '',
      notes: s.notes ?? '',
      purchased: s.purchased ?? 0,
      bus_type: s.bus_type ?? null,
      departure_time: s.departure_time ?? null,
      arrival_time: s.arrival_time ?? null,
      duration_min: s.duration_min ?? null,
      source: s.source ?? null,
      url: s.url ?? null
    })
  const id = Number(info.lastInsertRowid)
  logChange('transport_quotes', id, 'upsert')
  return get(id)!
}

function quoteExpenseDescription(q: QuoteRow): string {
  const label = MODE_LABEL[q.mode] || 'Transporte'
  const route = q.origin || q.destination ? ` ${q.origin}→${q.destination}` : ''
  return `${label}${route}${q.company ? ' ' + q.company : ''}`.trim() || 'Passagem de transporte'
}

/** Lança o preço da cotação como gasto na categoria transporte (uma única vez). */
function purchase(q: QuoteRow) {
  if (!q.price || q.price <= 0) throw new Error('defina um preço antes de marcar como comprada')
  const exp = expenseModel.create(q.trip_id, {
    description: quoteExpenseDescription(q),
    category: 'transporte',
    amount: q.price,
    date: q.date || new Date().toISOString().slice(0, 10)
  })
  db.prepare('UPDATE transport_quotes SET purchased = 1, expense_id = ?, updated_at = unixepoch() WHERE id = ?')
    .run(exp.id, q.id)
  logChange('transport_quotes', q.id, 'upsert')
}

export function update(id: number, data: QuoteInput) {
  const existing = db.prepare('SELECT * FROM transport_quotes WHERE id = ?').get(id) as QuoteRow | undefined
  if (!existing) return null
  const s = sanitize(data)
  const cols = Object.keys(s)
  if (cols.length) {
    db.prepare(`UPDATE transport_quotes SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = unixepoch() WHERE id = @__id`)
      .run({ ...s, __id: id })
    logChange('transport_quotes', id, 'upsert')
  }
  // "Comprei!" → lança gasto uma única vez
  if (data.purchased && !existing.expense_id) {
    const fresh = db.prepare('SELECT * FROM transport_quotes WHERE id = ?').get(id) as QuoteRow
    purchase(fresh)
  }
  return get(id)
}

/** Converte a cotação em gasto explicitamente (rota .../convert). */
export function convertToExpense(id: number) {
  const q = db.prepare('SELECT * FROM transport_quotes WHERE id = ?').get(id) as QuoteRow | undefined
  if (!q) throw new Error('cotação não encontrada')
  if (q.expense_id) {
    const e = expenseModel.get(q.expense_id)
    if (e) return e
  }
  purchase(q)
  const fresh = db.prepare('SELECT * FROM transport_quotes WHERE id = ?').get(id) as QuoteRow
  return expenseModel.get(fresh.expense_id!)!
}

export function remove(id: number): boolean {
  const info = db.prepare('DELETE FROM transport_quotes WHERE id = ?').run(id)
  if (info.changes > 0) {
    logChange('transport_quotes', id, 'delete')
    return true
  }
  return false
}
