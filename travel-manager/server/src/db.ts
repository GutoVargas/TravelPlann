// Conexão SQLite + migrações + trilha de auditoria (audit_log) para sync offline.
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', '..', 'data', 'viajamaiss.db')

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })

export const db: Database.Database = new Database(DB_FILE)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ---------- migrações ----------
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

function runMigrations(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name as string))
  const apply = db.prepare('INSERT INTO _migrations (name) VALUES (?)')
  for (const file of files) {
    if (done.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    db.transaction(() => {
      db.exec(sql)
      apply.run(file)
    })()
    console.log(`🛠️  migração aplicada: ${file}`)
  }
}

runMigrations()

// ---------- helpers de sincronização ----------
export type EntityTable = 'trips' | 'expenses' | 'transport_quotes' | 'documents'

const SYNC_TABLES: Record<EntityTable, string> = {
  trips: 'trips',
  expenses: 'expenses',
  transport_quotes: 'transport_quotes',
  documents: 'documents'
}

/** Registra a alteração no audit_log (usado pelo /api/sync para propagar mudanças). */
export function logChange(table: EntityTable, rowId: number, action: 'upsert' | 'delete'): void {
  const payload = action === 'upsert' ? JSON.stringify(snapshot(table, rowId)) : null
  db.prepare(
    `INSERT INTO audit_log (table_name, row_id, action, payload, at) VALUES (?, ?, ?, ?, strftime('%s','now'))`
  ).run(table, rowId, action, payload)
}

/** Carrega a linha atual para o payload do audit_log.
 *  Para documents incluímos `data` (base64) para que clientes offline recebam
 *  os ingressos sem precisar de um segundo request por arquivo. */
export function snapshot(table: EntityTable, rowId: number): unknown {
  const t = SYNC_TABLES[table]
  const row = db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(rowId)
  if (!row) return null
  return row
}

/** Próximo id inteiro da tabela (usado em inserts offline sincronizados via /api/sync/push). */
export function nextId(table: EntityTable): number {
  const t = SYNC_TABLES[table]
  const r = db.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM ${t}`).get() as { n: number }
  return Number(r.n)
}

/** Colunas conhecidas de cada tabela (exceto id/updated_at) — protege contra SQL injection
 *  vindo de payloads de sync e descarta campos desconhecidos enviados pelo cliente. */
const TABLE_COLS: Record<EntityTable, string[]> = {
  trips: ['title', 'destination', 'start_date', 'end_date', 'budget', 'status', 'notes', 'currency', 'created_at'],
  expenses: ['trip_id', 'description', 'category', 'amount', 'date', 'quote_id', 'document_ids'],
  transport_quotes: ['trip_id', 'mode', 'origin', 'destination', 'company', 'price', 'date', 'notes', 'purchased', 'expense_id', 'bus_type', 'departure_time', 'arrival_time', 'duration_min', 'source', 'url'],
  documents: ['trip_id', 'name', 'type', 'mime_type', 'data', 'expense_id', 'created_at']
}

/** Cria/atualiza uma linha preservando o id (folha de sync vinda do cliente). */
export function upsertFromSync(table: EntityTable, row: Record<string, unknown>): void {
  const t = SYNC_TABLES[table]
  const allowed = new Set(TABLE_COLS[table])
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row || {})) if (allowed.has(k)) data[k] = v
  const id = Number(row?.id)
  delete data.updated_at
  const cols = Object.keys(data)
  const existing = db.prepare(`SELECT id FROM ${t} WHERE id = ?`).get(id)
  if (existing) {
    db.prepare(`UPDATE ${t} SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = strftime(\'%s\',\'now\') WHERE id = @id`, ).run({ ...data, id })
  } else {
    db.prepare(`INSERT INTO ${t} (id, ${cols.join(', ')}, updated_at) VALUES (@id, ${cols.map((c) => `@${c}`).join(', ')}, strftime(\'%s\',\'now\'))`).run({ ...data, id })
  }
}

export { SYNC_TABLES }
