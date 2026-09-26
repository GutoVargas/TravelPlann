// Service (S "de negócio" do MVC) — protocolo de sincronização offline.
// Valida e aplica as mudanças enviadas por um dispositivo, grava o audit_log
// e devolve o snapshot para o pull com cursor.
import { db, nextId, upsertFromSync, type EntityTable } from '../db'

export const SYNC_TABLES = ['trips', 'expenses', 'transport_quotes', 'documents'] as const

const DOC_ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|heic|heif)$|^application\/pdf$/

export interface SyncChange {
  qid?: number
  table: string
  action: 'upsert' | 'delete'
  row?: Record<string, unknown>
  id?: number
}

/** Sanitiza uma linha recebida de sync (valores — colunas já são filtradas no db.ts). */
function sanitizeRow(table: EntityTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const str = (v: unknown, max = 500) => String(v ?? '').slice(0, max)
  const numOrNull = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
  switch (table) {
    case 'trips':
      if (row.id !== undefined && row.id !== null && Number.isFinite(Number(row.id))) out.id = Number(row.id)
      out.title = str(row.title, 200)
      out.destination = str(row.destination, 200)
      out.start_date = str(row.start_date, 10)
      out.end_date = str(row.end_date, 10)
      out.budget = Math.max(0, Number(row.budget) || 0)
      out.status = ['planejando', 'andando', 'concluida'].includes(String(row.status)) ? row.status : 'planejando'
      out.notes = str(row.notes, 5000)
      out.currency = str(row.currency, 8) || 'BRL'
      if (row.created_at !== undefined) out.created_at = str(row.created_at, 40)
      break
    case 'expenses':
      out.trip_id = Number(row.trip_id)
      out.description = str(row.description, 300)
      out.category = str(row.category, 40)
      out.amount = Number(row.amount) || 0
      out.date = str(row.date, 10)
      out.quote_id = numOrNull(row.quote_id)
      out.document_ids = str(row.document_ids ?? '[]', 5000)
      break
    case 'transport_quotes':
      out.trip_id = Number(row.trip_id)
      out.mode = str(row.mode, 40)
      out.origin = str(row.origin, 200)
      out.destination = str(row.destination, 200)
      out.company = str(row.company, 200)
      out.price = Number(row.price) || 0
      out.date = str(row.date, 10)
      out.notes = str(row.notes, 1000)
      out.purchased = row.purchased ? 1 : 0
      out.expense_id = numOrNull(row.expense_id)
      out.bus_type = str(row.bus_type ?? '', 200) || null
      out.departure_time = str(row.departure_time ?? '', 16) || null
      out.arrival_time = str(row.arrival_time ?? '', 16) || null
      out.duration_min = numOrNull(row.duration_min)
      out.source = str(row.source ?? '', 100) || null
      out.url = str(row.url ?? '', 500) || null
      break
    case 'documents':
      out.trip_id = Number(row.trip_id)
      out.name = str(row.name, 300)
      out.type = str(row.type, 40)
      out.mime_type = str(row.mime_type, 100)
      out.data = typeof row.data === 'string' ? row.data.slice(0, 6e6) : ''
      out.expense_id = numOrNull(row.expense_id)
      if (row.created_at !== undefined) out.created_at = str(row.created_at, 40)
      break
  }
  return out
}

function validateRow(table: EntityTable, row: Record<string, unknown>): void {
  // ids negativos são temporários (dispositivo offline): só precisam ser números finitos;
  // o push resolve as dependências entre linhas do mesmo lote antes de gravar.
  const tripId = Number(row.trip_id ?? (table === 'trips' ? row.id : NaN))
  if (!Number.isFinite(tripId) || tripId === 0) throw new Error('id/trip_id inválido')
  if (table !== 'trips' && tripId > 0 && !db.prepare('SELECT id FROM trips WHERE id = ?').get(tripId)) {
    throw new Error(`viagem ${tripId} não existe`)
  }
  if (table === 'trips' && !String(row.title ?? '').trim()) throw new Error('título é obrigatório')
  if (table === 'expenses' && !String(row.description ?? '').trim()) throw new Error('descrição é obrigatória')
  if (table === 'documents') {
    const mime = String(row.mime_type ?? '')
    if (row.data && !DOC_ALLOWED_MIME.test(mime)) throw new Error('formato de documento não suportado')
  }
}

const clone = (c: SyncChange): SyncChange => JSON.parse(JSON.stringify(c))

/** Aplica as mudanças do dispositivo; retorna ids remapeados (inserts locais ganham id real).
 *  Suporta dependências entre linhas da mesma fila (ex.: gasto criado offline antes da
 *  viagem chegar ao servidor) com até algumas passadas de reprocessamento. */
export function pushChanges(clientId: string, input: SyncChange[]) {
  const applied: string[] = []
  const failed: Array<{ change: SyncChange; error: string }> = []
  const remap: Array<{ qid: number; table: string; oldId: number; newId: number }> = []
  // mapa id-cliente → id-servidor por tabela (para resolver refs temporárias em lote)
  const idMap: Record<string, Map<number, number>> = { trips: new Map(), expenses: new Map(), transport_quotes: new Map(), documents: new Map() }

  // substitui ids negativos conhecidos (temporários) nas referências cruzadas
  function resolveRefs(table: EntityTable, row: Record<string, unknown>): Record<string, unknown> {
    const r = { ...row }
    const map = (t: string, v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) && n < 0 && idMap[t].has(n) ? idMap[t].get(n)! : v
    }
    if (table === 'trips') {
      // o id temporário da viagem é resolvido no próprio INSERT (idMap trips)
    } else {
      r.trip_id = map('trips', r.trip_id)
    }
    if (table === 'expenses') r.quote_id = map('transport_quotes', r.quote_id)
    if (table === 'transport_quotes' || table === 'documents') r.expense_id = map('expenses', r.expense_id)
    return r
  }

  let pending = input.map(clone)
  let attempt = 0
  const tx = db.transaction(() => {
    while (pending.length && attempt < 6) {
      attempt++
      const retry: SyncChange[] = []
      let progressed = false
      for (const ch of pending) {
        try {
          if (!SYNC_TABLES.includes(ch.table as (typeof SYNC_TABLES)[number])) throw new Error('tabela desconhecida')
          const table = ch.table as EntityTable

          if (ch.action === 'delete') {
            const rawId = Number(ch.id ?? ch.row?.id)
            const id = Number.isFinite(rawId) && rawId < 0 && idMap[table].has(rawId) ? idMap[table].get(rawId)! : rawId
            if (!Number.isFinite(id)) throw new Error('id inválido')
            const exists = !!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)
            if (exists) {
              db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
              db.prepare(`INSERT INTO audit_log (table_name, row_id, action, payload, at) VALUES (?, ?, 'delete', ?, strftime('%s','now'))`)
                .run(table, id, JSON.stringify({ by: clientId }))
            }
            applied.push(`${table}:${id}`)
            continue
          }

          if (ch.action !== 'upsert' || !ch.row) throw new Error('mudança inválida')
          const clientRawId = Number(ch.row.id)
          let row = resolveRefs(table, sanitizeRow(table, ch.row))
          validateRow(table, row)

          const known = Number.isFinite(clientRawId) && clientRawId > 0 && !!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(clientRawId)
          const isInsert = !known

          // documentos enviados sem binário = atualização só de metadados
          if (table === 'documents' && !row.data && !isInsert) {
            const sets: string[] = []
            const params: Record<string, unknown> = { id: clientRawId }
            for (const col of ['name', 'type', 'mime_type', 'expense_id']) {
              if (row[col] !== undefined && row[col] !== null) { sets.push(`${col} = @${col}`); params[col] = row[col] }
            }
            if (sets.length) {
              db.prepare(`UPDATE documents SET ${sets.join(', ')}, updated_at = strftime('%s','now') WHERE id = @id`).run(params)
              db.prepare(`INSERT INTO audit_log (table_name, row_id, action, payload, at) VALUES (?, ?, 'upsert', ?, strftime('%s','now'))`)
                .run(table, clientRawId, JSON.stringify(snapshotPayload(table, clientRawId)))
            }
            applied.push(`${table}:${clientRawId}`)
            continue
          }

          const serverId = isInsert ? nextId(table) : clientRawId
          if (isInsert && table === 'trips' && Number.isFinite(clientRawId) && clientRawId < 0) {
            idMap.trips.set(clientRawId, serverId) // resolve trip_id negativo dos filhos neste lote
          }
          upsertFromSync(table, { ...row, id: serverId })
          db.prepare(`INSERT INTO audit_log (table_name, row_id, action, payload, at) VALUES (?, ?, 'upsert', ?, strftime('%s','now'))`)
            .run(table, serverId, JSON.stringify(snapshotPayload(table, serverId)))

          if (isInsert) {
            // registra o mapeamento cliente→servidor SEMPRE no insert (inclusive ids positivos
            // desconhecidos), senão filhos do mesmo lote que referenciam esse id quebram a FK
            idMap[table].set(serverId, serverId)
            if (Number.isFinite(clientRawId)) idMap[table].set(clientRawId, serverId)
            if (Number.isFinite(clientRawId) && clientRawId !== serverId) {
              remap.push({ qid: Number(ch.qid ?? -1), table, oldId: clientRawId, newId: serverId })
            }
          }
          applied.push(`${table}:${serverId}`)
          progressed = true
        } catch (e) {
          const msg = (e as Error).message
          // referência temporária ainda não resolvida? tenta de novo na próxima passada
          if (/não existe|inválido/.test(msg) && attempt < 6 && hasTempRef(ch, idMap)) {
            retry.push(ch)
          } else {
            failed.push({ change: ch, error: msg })
          }
        }
      }
      if (!retry.length || !progressed) {
        for (const r of retry) failed.push({ change: r, error: 'dependência não sincronizada' })
        pending = []
        break
      }
      pending = retry
    }
  })
  tx()

  const head = db.prepare('SELECT COALESCE(MAX(CAST(at AS REAL)), 0) m FROM audit_log').get() as { m: number }
  return { ok: true, applied: applied.length, failed, remap, serverTime: Math.floor(head.m) }
}

function hasTempRef(ch: SyncChange, idMap: Record<string, Map<number, number>>): boolean {
  const row = (ch.row || {}) as Record<string, unknown>
  const anyTemp = (v: unknown) => Number.isFinite(Number(v)) && Number(v) < 0
  const knownElsewhere = (t: string, v: unknown) => idMap[t]?.has(Number(v))
  if (anyTemp(row.trip_id) && !knownElsewhere('trips', row.trip_id)) return true
  if (anyTemp(row.expense_id) && !knownElsewhere('expenses', row.expense_id)) return true
  if (anyTemp(row.quote_id) && !knownElsewhere('transport_quotes', row.quote_id)) return true
  return false
}

function snapshotPayload(table: EntityTable, rowId: number): unknown {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rowId)
  return row ?? null
}

/** Pull incremental com cursor (timestamp do audit_log). */
export function pullChanges(since: number, full: boolean) {
  let changes: Array<{ table: string; rowId: number; action: string; payload: unknown; at: number }> = []
  if (full) {
    const at = Math.floor(Date.now() / 1000)
    for (const t of SYNC_TABLES) {
      const rows = db.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>
      for (const r of rows) {
        const copy = { ...r }
        if (t === 'documents') delete copy.data // snapshot inicial não inclui binários pesados
        changes.push({ table: t, rowId: Number(r.id), action: 'upsert', payload: copy, at })
      }
    }
  } else {
    changes = db
      .prepare(
        `SELECT table_name AS "table", row_id AS rowId, action, payload, CAST(at AS REAL) AS at
         FROM audit_log WHERE CAST(at AS REAL) > ? ORDER BY CAST(at AS REAL), id LIMIT 5000`
      )
      .all(since) as typeof changes
    changes = changes.map((c) => ({ ...c, payload: c.payload ? JSON.parse(String(c.payload)) : null }))
  }
  const head = db.prepare('SELECT COALESCE(MAX(CAST(at AS REAL)), 0) m FROM audit_log').get() as { m: number }
  return { serverTime: Math.floor(head.m), changes }
}
