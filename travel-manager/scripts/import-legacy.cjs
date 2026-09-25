// Importa o data.json legado para o SQLite (roda uma única vez)
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const SRC = process.argv[2] || path.join(__dirname, '..', 'server', 'data.json')
const DST = process.argv[3] || path.join(__dirname, '..', 'data', 'viajamaiss.db')
if (!fs.existsSync(SRC)) { console.log('sem data.json legado, nada a importar'); process.exit(0) }

fs.mkdirSync(path.dirname(DST), { recursive: true })
const db = new Database(DST)
db.pragma('journal_mode = WAL')
const migSql = fs.readFileSync(path.join(__dirname, '..', 'server', 'src', 'migrations', '001_init.sql'), 'utf-8')
const MIG_TABLES = ['trips', 'expenses', 'transport_quotes', 'documents']
for (const t of MIG_TABLES) {
  db.prepare(`CREATE TABLE IF NOT EXISTS ${t} AS SELECT * FROM sqlite_master WHERE 0`).run?.() ?? null
}
// cria as tabelas de verdade via exec, uma instrução por vez é arriscado; então:
// melhor criar tudo e depois zerar os ids? Não — o schema já usa IF NOT EXISTS.
db.exec(migSql)

const legacy = JSON.parse(fs.readFileSync(SRC, 'utf-8'))
if (Number(db.prepare("SELECT COUNT(*) c FROM _migrations WHERE name='001_init.sql'").get().c) === 0) {
  db.prepare("INSERT INTO _migrations (name) VALUES ('001_init.sql')").run()
}

const hasTrips = db.prepare('SELECT COUNT(*) c FROM trips').get().c > 0
if (hasTrips) { console.log('SQLite já tem dados — importação legada ignorada.'); process.exit(0) }

const tx = db.transaction(() => {
  for (const t of legacy.trips || []) {
    db.prepare(`INSERT INTO trips (id,title,destination,start_date,end_date,budget,status,notes,currency,created_at,updated_at)
                VALUES (@id,@title,@destination,@start_date,@end_date,@budget,@status,@notes,'BRL',@created_at,unixepoch())`)
      .run({
        id: t.id, title: t.title || '', destination: t.destination || '',
        start_date: t.startDate || '', end_date: t.endDate || '',
        budget: Number(t.budget) || 0, status: t.status || 'planejando',
        notes: t.notes || '', created_at: t.createdAt || new Date().toISOString()
      })
  }
  for (const e of legacy.expenses || []) {
    db.prepare(`INSERT INTO expenses (id,trip_id,description,category,amount,date,quote_id,document_ids,updated_at)
                VALUES (@id,@tripId,@description,@category,@amount,@date,@quoteId,@document_ids,unixepoch())`)
      .run({
        id: e.id, tripId: e.tripId, description: e.description || '', category: e.category || 'outros',
        amount: Number(e.amount) || 0, date: e.date || '', quoteId: e.quoteId ?? null,
        document_ids: JSON.stringify(e.documentIds || [])
      })
  }
  for (const q of legacy.transportQuotes || []) {
    db.prepare(`INSERT INTO transport_quotes (id,trip_id,mode,origin,destination,company,price,date,notes,purchased,expense_id,bus_type,departure_time,arrival_time,duration_min,source,url,updated_at)
                VALUES (@id,@tripId,@mode,@from,@to,@company,@price,@date,@notes,@purchased,@expenseId,@busType,@departureTime,@arrivalTime,@durationMin,@source,@url,unixepoch())`)
      .run({
        id: q.id, tripId: q.tripId, mode: q.mode || 'aviao', from: q.from || '', to: q.to || '',
        company: q.company || '', price: Number(q.price) || 0, date: q.date || '', notes: q.notes || '',
        purchased: q.purchased ? 1 : 0, expenseId: q.expenseId ?? null, busType: q.busType ?? null,
        departureTime: q.departureTime ?? null, arrivalTime: q.arrivalTime ?? null,
        durationMin: q.durationMin ?? null, source: q.source ?? null, url: q.url ?? null
      })
  }
  for (const d of legacy.documents || []) {
    db.prepare(`INSERT INTO documents (id,trip_id,name,type,mime_type,data,expense_id,created_at,updated_at)
                VALUES (@id,@tripId,@name,@type,@mime_type,@data,@expenseId,@created_at,unixepoch())`)
      .run({
        id: d.id, tripId: d.tripId, name: d.name || 'documento', type: d.type || 'outro',
        mime_type: d.mimeType || '', data: d.data || '', expenseId: d.expenseId ?? null,
        created_at: d.createdAt || new Date().toISOString()
      })
  }
})
tx()
console.log(`✅ Importados ${(legacy.trips||[]).length} viagens, ${(legacy.expenses||[]).length} gastos, ${(legacy.transportQuotes||[]).length} cotações, ${(legacy.documents||[]).length} documentos → ${DST}`)
