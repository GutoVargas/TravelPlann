// Model Trip — toda a lógica de acesso/validação da tabela trips.
import { db, logChange } from '../db'

export interface TripRow {
  id: number
  title: string
  destination: string
  start_date: string
  end_date: string
  budget: number
  status: string
  notes: string
  currency: string
  created_at: string
  updated_at: number
}

export interface TripDTO {
  id: number
  title: string
  destination: string
  startDate: string
  endDate: string
  budget: number
  status: string
  notes: string
  currency: string
  createdAt: string
  expenses?: unknown[]
  quotes?: unknown[]
  docs?: unknown[]
  spent?: number
}

export function toDto(r: TripRow): TripDTO {
  return {
    id: r.id,
    title: r.title,
    destination: r.destination,
    startDate: r.start_date,
    endDate: r.end_date,
    budget: Number(r.budget) || 0,
    status: r.status,
    notes: r.notes,
    currency: r.currency,
    createdAt: r.created_at
  }
}

const STATUS = ['planejando', 'andando', 'concluida']

interface TripInput {
  title?: string
  destination?: string
  startDate?: string
  endDate?: string
  budget?: number | string
  status?: string
  notes?: string
  currency?: string
}

function sanitize(data: TripInput): Partial<TripRow> {
  const out: Record<string, unknown> = {}
  if (data.title !== undefined) out.title = String(data.title).slice(0, 200)
  if (data.destination !== undefined) out.destination = String(data.destination).slice(0, 200)
  if (data.startDate !== undefined) out.start_date = String(data.startDate).slice(0, 10)
  if (data.endDate !== undefined) out.end_date = String(data.endDate).slice(0, 10)
  if (data.budget !== undefined) {
    const b = Number(data.budget)
    if (!Number.isFinite(b) || b < 0) throw new Error('orçamento deve ser um número ≥ 0')
    out.budget = Math.round(b * 100) / 100
  }
  if (data.status !== undefined) {
    if (!STATUS.includes(data.status)) throw new Error('status inválido')
    out.status = data.status
  }
  if (data.notes !== undefined) out.notes = String(data.notes).slice(0, 5000)
  if (data.currency !== undefined) out.currency = String(data.currency).slice(0, 8)
  return out as Partial<TripRow>
}

function rowWithTotals(r: TripRow): TripDTO {
  const dto = toDto(r)
  const expenses = db
    .prepare('SELECT * FROM expenses WHERE trip_id = ? ORDER BY date DESC, id DESC')
    .all(r.id) as Array<Record<string, unknown>>
  const spent = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  dto.expenses = expenses.map((e) => ({
    id: e.id,
    tripId: e.trip_id,
    description: e.description,
    category: e.category,
    amount: Number(e.amount),
    date: e.date,
    quoteId: e.quote_id,
    documentIds: JSON.parse(String(e.document_ids || '[]'))
  }))
  dto.spent = Math.round(spent * 100) / 100
  return dto
}

export function list(): TripDTO[] {
  const rows = db.prepare('SELECT * FROM trips ORDER BY id DESC').all() as TripRow[]
  return rows.map(rowWithTotals)
}

export function get(id: number): TripDTO | null {
  const r = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as TripRow | undefined
  return r ? rowWithTotals(r) : null
}

export function create(data: TripInput): TripDTO {
  const s = sanitize(data)
  if (!String(s.title ?? '').trim()) throw new Error('título é obrigatório')
  const info = db
    .prepare(
      `INSERT INTO trips (title, destination, start_date, end_date, budget, status, notes, currency)
       VALUES (@title, @destination, @start_date, @end_date, @budget, @status, @notes, @currency)`
    )
    .run({
      title: s.title ?? '',
      destination: s.destination ?? '',
      start_date: s.start_date ?? '',
      end_date: s.end_date ?? '',
      budget: s.budget ?? 0,
      status: s.status ?? 'planejando',
      notes: s.notes ?? '',
      currency: s.currency ?? 'BRL'
    })
  const id = Number(info.lastInsertRowid)
  logChange('trips', id, 'upsert')
  return get(id)!
}

export function update(id: number, data: TripInput): TripDTO | null {
  const existing = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as TripRow | undefined
  if (!existing) return null
  const s = sanitize(data)
  const cols = Object.keys(s)
  if (cols.length) {
    db.prepare(`UPDATE trips SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = unixepoch() WHERE id = @__id`)
      .run({ ...s, __id: id })
    logChange('trips', id, 'upsert')
  }
  return get(id)
}

export function remove(id: number): boolean {
  const info = db.prepare('DELETE FROM trips WHERE id = ?').run(id)
  if (info.changes > 0) {
    logChange('trips', id, 'delete')
    return true
  }
  return false
}

export function stats() {
  const totalBudget = (db.prepare('SELECT COALESCE(SUM(budget),0) s FROM trips').get() as { s: number }).s
  const totalSpent = (db.prepare('SELECT COALESCE(SUM(amount),0) s FROM expenses').get() as { s: number }).s
  const byStatus = Object.fromEntries(
    (db.prepare('SELECT status, COUNT(*) c FROM trips GROUP BY status').all() as Array<{ status: string; c: number }>)
      .map((r) => [r.status, r.c])
  )
  return {
    trips: (db.prepare('SELECT COUNT(*) c FROM trips').get() as { c: number }).c,
    byStatus: {
      planejando: byStatus['planejando'] ?? 0,
      andando: byStatus['andando'] ?? 0,
      concluida: byStatus['concluida'] ?? 0
    },
    totalBudget: Math.round(totalBudget * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100
  }
}
