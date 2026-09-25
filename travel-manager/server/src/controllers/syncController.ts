// Sync controller — protocolo de sincronização offline ↔ SQLite.
// O frontend guarda um "cursor" (timestamp da última sync). A cada chamada:
//   1. aplica as mudanças enviadas pelo dispositivo (upserts/deletes locais);
//   2. devolve todas as mudanças do servidor desde o cursor + snapshot completo
//      quando o cliente pede (primeira sincronização / restauração total).
import { Request, Response } from 'express'
import { db, upsertFromSync, type EntityTable } from '../db'

const TABLES = ['trips', 'expenses', 'transport_quotes', 'documents'] as const

interface Change {
  table: string
  action: 'upsert' | 'delete'
  row?: Record<string, unknown>
  id?: number
}

export function pullChanges(req: Request, res: Response) {
  const since = Number(req.query.since || 0)
  const full = req.query.full === '1'

  let changes: Array<{ table: string; rowId: number; action: string; payload: unknown; at: number }> = []
  if (full) {
    for (const t of TABLES) {
      const rows = db.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>
      for (const r of rows) {
        const copy = { ...r }
        if (t === 'documents') delete copy.data // snapshot inicial não inclui binários
        changes.push({ table: t, rowId: Number(r.id), action: 'upsert', payload: copy, at: Math.floor(Date.now() / 1000) })
      }
    }
  } else {
    changes = db
      .prepare(
        `SELECT table_name AS "table", row_id AS rowId, action, payload, at
         FROM audit_log WHERE CAST(at AS REAL) > ? ORDER BY CAST(at AS REAL) LIMIT 5000`
      )
      .all(since) as typeof changes
    changes = changes.map((c) => ({
      ...c,
      payload: c.payload ? JSON.parse(String(c.payload)) : null
    }))
  }

  const head = db.prepare('SELECT COALESCE(MAX(at), 0) m FROM audit_log').get() as { m: number }
  res.json({ serverTime: head.m, changes })
}

export function pushChanges(req: Request, res: Response) {
  const body = req.body || {}
  const clientId = String(body.clientId || 'anon')
  const changes: Change[] = Array.isArray(body.changes) ? body.changes : []
  const applied: string[] = []
  const failed: Array<{ change: Change; error: string }> = []

  const tx = db.transaction(() => {
    for (const ch of changes) {
      try {
        if (!TABLES.includes(ch.table as (typeof TABLES)[number])) throw new Error('tabela desconhecida')
        const table = ch.table as EntityTable
        if (ch.action === 'upsert' && ch.row && Number.isFinite(Number(ch.row.id))) {
          if (table === 'documents' && !ch.row.data) {
            // atualização de metadados sem reenviar o binário
            const { name, type, expense_id, mime_type } = ch.row as Record<string, unknown>
            const sets: string[] = []
            const params: Record<string, unknown> = { id: Number(ch.row.id) }
            if (name !== undefined) { sets.push('name = @name'); params.name = String(name).slice(0, 300) }
            if (type !== undefined) { sets.push('type = @type'); params.type = String(type) }
            if (expense_id !== undefined) { sets.push('expense_id = @expense_id'); params.expense_id = Number(expense_id) }
            if (mime_type !== undefined) { sets.push('mime_type = @mime_type'); params.mime_type = String(mime_type) }
            if (sets.length) {
              db.prepare(`UPDATE documents SET ${sets.join(', ')}, updated_at = strftime(\'%s\',\'now\') WHERE id = @id`).run(params)
            }
          } else {
            upsertFromSync(table, ch.row)
          }
          db.prepare(`INSERT INTO audit_log (table_name, row_id, action, payload, at) VALUES (?, ?, 'upsert', ?, strftime(\'%s\',\'now\'))`)
            .run(ch.table, Number((ch.row as Record<string, unknown>).id), JSON.stringify({ by: clientId }))
        } else if (ch.action === 'delete' && Number.isFinite(Number(ch.id))) {
          db.prepare(`DELETE FROM ${ch.table} WHERE id = ?`).run(Number(ch.id))
          db.prepare(`INSERT INTO audit_log (table_name, row_id, action, payload, at) VALUES (?, ?, 'delete', ?, strftime(\'%s\',\'now\'))`)
            .run(ch.table, Number(ch.id), JSON.stringify({ by: clientId }))
        } else {
          throw new Error('mudança inválida')
        }
        applied.push(`${ch.table}:${ch.row?.id ?? ch.id}`)
      } catch (e) {
        failed.push({ change: ch, error: (e as Error).message })
      }
    }
  })
  tx()

  const head = db.prepare('SELECT COALESCE(MAX(at), 0) m FROM audit_log').get() as { m: number }
  res.json({ ok: true, applied: applied.length, failed, serverTime: head.m })
}
