// Importa o data.json legado para o SQLite (roda uma única vez).
// Uso: node scripts/import-legacy.cjs [src.json] [dest.db]
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const SRC = process.argv[2] || path.join(__dirname, '..', 'server', 'data.json')
const DST = process.argv[3] || path.join(__dirname, '..', 'data', 'viajamaiss.db')
if (!fs.existsSync(SRC)) { console.log('sem data.json legado, nada a importar'); process.exit(0) }

fs.mkdirSync(path.dirname(DST), { recursive: true })
const db = new Database(DST)
db.pragma('journal_mode = WAL')

// aplica as migrações oficiais (idempotente — mesmo mecanismo do servidor)
const MIGRATIONS_DIR = path.join(__dirname, '..', 'server', 'src', 'migrations')
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`)
const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name))
for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
  db.transaction(() => {
    db.exec(sql)
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file)
  })()
  console.log(`🛠️  migração aplicada: ${file}`)
}

const hasTrips = db.prepare('SELECT COUNT(*) c FROM trips').get().c > 0
if (hasTrips) { console.log('SQLite já tem dados — importação legada ignorada.'); process.exit(0) }

const legacy = JSON.parse(fs.readFileSync(SRC, 'utf-8'))

const tx = db.transaction(() => {
  for (const t of legacy.trips || []) {
    db.prepare(`INSERT INTO trips (id,title,destination,start_date,end_date,budget,status,notes,currency,created_at,updated_at)
                VALUES (@id,@title,@destination,@start_date,@end_date,@budget,@status,@notes,'BRL',@created_at,strftime('%s','now'))`)
      .run({
        id: Number(t.id), title: t.title || '', destination: t.destination || '',
        start_date: t.startDate || '', end_date: t.endDate || '',
        budget: Number(t.budget) || 0, status: t.status || 'planejando',
        notes: t.notes || '', created_at: t.createdAt || new Date().toISOString()
      })
  }
  for (const e of legacy.expenses || []) {
    db.prepare(`INSERT INTO expenses (id,trip_id,description,category,amount,date,quote_id,document_ids,updated_at)
                VALUES (@id,@trip_id,@description,@category,@amount,@date,@quote_id,@document_ids,strftime('%s','now'))`)
      .run({
        id: Number(e.id), trip_id: Number(e.tripId), description: e.description || '',
        category: e.category || 'outros', amount: Number(e.amount) || 0, date: e.date || '',
        quote_id: e.quoteId != null ? Number(e.quoteId) : null,
        document_ids: JSON.stringify(e.documentIds || [])
      })
  }
  for (const q of legacy.transportQuotes || []) {
    db.prepare(`INSERT INTO transport_quotes (id,trip_id,mode,origin,destination,company,price,date,notes,purchased,expense_id,bus_type,departure_time,arrival_time,duration_min,source,url,updated_at)
                VALUES (@id,@trip_id,@mode,@origin,@destination,@company,@price,@date,@notes,@purchased,@expense_id,@bus_type,@departure_time,@arrival_time,@duration_min,@source,@url,strftime('%s','now'))`)
      .run({
        id: Number(q.id), trip_id: Number(q.tripId), mode: q.mode || 'aviao',
        origin: q.from || q.origin || '', destination: q.to || q.destination || '',
        company: q.company || '', price: Number(q.price) || 0, date: q.date || '', notes: q.notes || '',
        purchased: q.purchased ? 1 : 0,
        expense_id: q.expenseId != null ? Number(q.expenseId) : null,
        bus_type: q.busType ?? null, departure_time: q.departureTime ?? null,
        arrival_time: q.arrivalTime ?? null, duration_min: q.durationMin ?? null,
        source: q.source ?? null, url: q.url ?? null
      })
  }
  for (const d of legacy.documents || []) {
    db.prepare(`INSERT INTO documents (id,trip_id,name,type,mime_type,data,expense_id,created_at,updated_at)
                VALUES (@id,@trip_id,@name,@type,@mime_type,@data,@expense_id,@created_at,strftime('%s','now'))`)
      .run({
        id: Number(d.id), trip_id: Number(d.tripId), name: d.name || 'documento',
        type: d.type || 'outro', mime_type: d.mimeType || '', data: d.data || '',
        expense_id: d.expenseId != null ? Number(d.expenseId) : null,
        created_at: d.createdAt || new Date().toISOString()
      })
  }
})
tx()

// alimenta o audit_log para que clientes offline recebam os dados na 1ª sincronização
const seedAudit = db.transaction(() => {
  const now = Math.floor(Date.now() / 1000)
  const ins = db.prepare(`INSERT INTO audit_log (table_name,row_id,action,payload,at) VALUES (?,?,?,?,?)`)
  let at = now
  for (const t of ['trips', 'expenses', 'transport_quotes', 'documents']) {
    for (const r of db.prepare(`SELECT id FROM ${t}`).all()) {
      ins.run(t, r.id, 'upsert', null, at++)
    }
  }
})
seedAudit()

console.log(`✅ Importados ${(legacy.trips || []).length} viagens, ${(legacy.expenses || []).length} gastos, ${(legacy.transportQuotes || []).length} cotações, ${(legacy.documents || []).length} documentos → ${DST}`)
db.close()
