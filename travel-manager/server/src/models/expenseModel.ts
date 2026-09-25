// Model Expense — CRUD de gastos da viagem.
import { db, logChange } from '../db'

export const CATEGORIES = ['transporte', 'hospedagem', 'alimentacao', 'passeios', 'compras', 'outros']

interface ExpenseRow {
  id: number
  trip_id: number
  description: string
  category: string
  amount: number
  date: string
  quote_id: number | null
  document_ids: string
}

export interface ExpenseInput {
  description?: string
  category?: string
  amount?: number | string
  date?: string
  documentIds?: number[]
}

export function toDto(r: ExpenseRow) {
  return {
    id: r.id,
    tripId: r.trip_id,
    description: r.description,
    category: r.category,
    amount: Number(r.amount),
    date: r.date,
    quoteId: r.quote_id,
    documentIds: JSON.parse(String(r.document_ids || '[]'))
  }
}

function mapDocIds(ids: unknown): string {
  if (!Array.isArray(ids)) return '[]'
  return JSON.stringify([...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))])
}

export function listByTrip(tripId: number) {
  const rows = db
    .prepare('SELECT * FROM expenses WHERE trip_id = ? ORDER BY date DESC, id DESC')
    .all(tripId) as ExpenseRow[]
  return rows.map(toDto)
}

export function get(id: number) {
  const r = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined
  return r ? toDto(r) : null
}

export function create(tripId: number, data: ExpenseInput) {
  if (!db.prepare('SELECT id FROM trips WHERE id = ?').get(tripId)) throw new Error('viagem não encontrada')
  const description = String(data.description ?? '').trim().slice(0, 300)
  if (!description) throw new Error('descrição é obrigatória')
  const amount = Number(data.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('valor deve ser um número positivo')
  const category = data.category && CATEGORIES.includes(data.category) ? data.category : 'outros'
  const date = String(data.date || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const info = db
    .prepare(
      `INSERT INTO expenses (trip_id, description, category, amount, date, document_ids)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(tripId, description, category, Math.round(amount * 100) / 100, date, mapDocIds(data.documentIds))
  const id = Number(info.lastInsertRowid)
  logChange('expenses', id, 'upsert')
  return get(id)!
}

export function update(id: number, data: ExpenseInput) {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as ExpenseRow | undefined
  if (!existing) return null
  const sets: string[] = []
  const params: Record<string, unknown> = { id }
  if (data.description !== undefined) {
    const d = String(data.description).trim()
    if (!d) throw new Error('descrição não pode ficar vazia')
    sets.push('description = @description')
    params.description = d.slice(0, 300)
  }
  if (data.category !== undefined) {
    if (!CATEGORIES.includes(data.category)) throw new Error('categoria inválida')
    sets.push('category = @category')
    params.category = data.category
  }
  if (data.amount !== undefined) {
    const a = Number(data.amount)
    if (!Number.isFinite(a) || a <= 0) throw new Error('valor deve ser um número positivo')
    sets.push('amount = @amount')
    params.amount = Math.round(a * 100) / 100
  }
  if (data.date !== undefined) {
    sets.push('date = @date')
    params.date = String(data.date).slice(0, 10)
  }
  if (data.documentIds !== undefined) {
    sets.push('document_ids = @document_ids')
    params.document_ids = mapDocIds(data.documentIds)
  }
  if (sets.length) {
    db.prepare(`UPDATE expenses SET ${sets.join(', ')}, updated_at = strftime(\'%s\',\'now\') WHERE id = @id`).run(params)
    logChange('expenses', id, 'upsert')
  }
  return get(id)
}

export function remove(id: number): boolean {
  const info = db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
  if (info.changes > 0) {
    logChange('expenses', id, 'delete')
    return true
  }
  return false
}
