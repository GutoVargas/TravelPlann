// Model Document — ingressos/passagens (base64 no SQLite → funciona offline).
import { db, logChange } from '../db'

export const DOC_TYPES = ['passagem', 'ingresso', 'comprovante', 'reserva', 'outro']

interface DocRow {
  id: number
  trip_id: number
  name: string
  type: string
  mime_type: string
  data: string
  expense_id: number | null
}

export interface DocInput {
  name?: string
  type?: string
  mimeType?: string
  data?: string // data URL base64
  expenseId?: number | null
}

function sizeOf(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  return i >= 0 ? Math.round((dataUrl.length - i - 1) * 0.75) : 0
}

function toDto(r: DocRow) {
  return {
    id: r.id,
    tripId: r.trip_id,
    name: r.name,
    type: r.type,
    mimeType: r.mime_type,
    expenseId: r.expense_id,
    size: sizeOf(r.data)
  }
}

function sanitizeMeta(data: DocInput): Partial<DocRow> {
  const out: Record<string, unknown> = {}
  if (data.name !== undefined) out.name = String(data.name).slice(0, 300)
  if (data.type !== undefined) {
    if (!DOC_TYPES.includes(data.type)) throw new Error('tipo de documento inválido')
    out.type = data.type
  }
  if (data.mimeType !== undefined) out.mime_type = String(data.mimeType).slice(0, 100)
  return out as Partial<DocRow>
}

function validateDataUrl(raw: string): { mime: string; full: string } {
  const m = String(raw).match(/^data:([\w/+.-]+);base64,(.*)$/)
  if (!m) throw new Error('arquivo enviado em formato inválido')
  const mime = m[1]
  const b64 = m[2]
  if (b64.length > 5e6) throw new Error('arquivo muito grande (limite ~3,5 MB)')
  const allowed = /^image\/(png|jpe?g|webp|gif|heic|heif)$|^application\/pdf$/
  if (!allowed.test(mime)) throw new Error('formato não suportado. Envie imagem (PNG/JPG/WebP/GIF) ou PDF.')
  return { mime, full: `data:${mime};base64,${b64}` }
}

export function listByTrip(tripId: number) {
  const rows = db.prepare('SELECT * FROM documents WHERE trip_id = ? ORDER BY id DESC').all(tripId) as DocRow[]
  return rows.map(toDto)
}

export function get(id: number) {
  const r = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocRow | undefined
  return r || null
}

export function getMeta(id: number) {
  const r = get(id)
  return r ? toDto(r) : null
}

export function create(tripId: number, data: DocInput) {
  if (!db.prepare('SELECT id FROM trips WHERE id = ?').get(tripId)) throw new Error('viagem não encontrada')
  if (!data.data) throw new Error('envie o arquivo do documento')
  const { mime, full } = validateDataUrl(data.data)
  const meta = sanitizeMeta(data)
  const expenseId = data.expenseId ? Number(data.expenseId) : null
  const info = db
    .prepare(
      `INSERT INTO documents (trip_id, name, type, mime_type, data, expense_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      tripId,
      meta.name || 'documento',
      meta.type || 'outro',
      mime,
      full,
      expenseId
    )
  const id = Number(info.lastInsertRowid)
  if (expenseId) linkExpense(expenseId, id)
  logChange('documents', id, 'upsert')
  return getMeta(id)!
}

function linkExpense(expenseId: number, docId: number, tripId?: number) {
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as
    | { id: number; trip_id: number; document_ids: string }
    | undefined
  if (!exp) return
  if (tripId && exp.trip_id !== tripId) return
  const ids = JSON.parse(String(exp.document_ids || '[]')) as number[]
  if (!ids.includes(docId)) {
    db.prepare('UPDATE expenses SET document_ids = ?, updated_at = unixepoch() WHERE id = ?')
      .run(JSON.stringify([...new Set([...ids, docId])]), expenseId)
    logChange('expenses', expenseId, 'upsert')
  }
}

export function update(id: number, data: DocInput) {
  const existing = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocRow | undefined
  if (!existing) return null
  const meta = sanitizeMeta({ ...data, data: undefined })
  const cols = Object.keys(meta)
  if (cols.length) {
    db.prepare(`UPDATE documents SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = unixepoch() WHERE id = @__id`)
      .run({ ...meta, __id: id })
    logChange('documents', id, 'upsert')
  }
  if (data.expenseId !== undefined && data.expenseId !== null) {
    linkExpense(Number(data.expenseId), id, existing.trip_id)
  }
  return getMeta(id)
}

export function remove(id: number): boolean {
  const info = db.prepare('DELETE FROM documents WHERE id = ?').run(id)
  if (info.changes === 0) return false
  // limpa a referência nos gastos
  const rows = db.prepare("SELECT id, document_ids FROM expenses WHERE document_ids LIKE ?").all(String(id)) as Array<{ id: number; document_ids: string }>
  for (const e of rows) {
    const ids = (JSON.parse(e.document_ids) as number[]).filter((x) => x !== id)
    db.prepare('UPDATE expenses SET document_ids = ?, updated_at = unixepoch() WHERE id = ?').run(JSON.stringify(ids), e.id)
    logChange('expenses', e.id, 'upsert')
  }
  logChange('documents', id, 'delete')
  return true
}
