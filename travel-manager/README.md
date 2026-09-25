# ✈️ Viaja+ — Sistema de Gerenciamento de Viagens

App web para planejar viagens, organizar roteiros e controlar gastos com orçamento.

## Funcionalidades
- **Visão Geral (Dashboard):** total de viagens, orçamento x gasto, contagem por status, próximas viagens e ranking de gastos.
- **CRUD de viagens:** título, destino, datas (ida/volta), orçamento, status (📝 Planejando / 🧳 Andando / ✅ Concluída) e notas/roteiro.
- **Controle de gastos por viagem:** categorias (🚗 Transporte, 🏨 Hospedagem, 🍽️ Alimentação, 🎟️ Passeios, 🛍️ Compras, 📦 Outros), barra de progresso do orçamento (fica vermelha ao estourar) e resumo por categoria.
- **Busca e filtros** por texto e status.
- Interface responsiva em português, tema escuro.

## Stack
- **Frontend:** React 18 + Vite
- **Backend:** API REST em Node.js puro (sem dependências obrigatórias) — `server/index.js`
- **Persistência:** arquivo JSON (`server/data.json`), fácil de migrar para SQLite/Postgres (toda a camada de dados está isolada em `server/db.js`)

## Como rodar

### Modo desenvolvimento (front + API com hot reload)
```bash
cd travel-manager
npm install
npm run dev        # abre o Vite em http://localhost:5173 (proxy /api → localhost:3001)
```

### Modo produção (um único servidor serve UI + API)
```bash
cd travel-manager
npm run build
npm start          # http://localhost:3001
```

## API REST
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Status da API |
| GET | `/api/stats` | Estatísticas gerais |
| GET | `/api/trips` | Lista viagens (com gastos somados) |
| POST | `/api/trips` | Cria viagem |
| GET | `/api/trips/:id` | Detalhe da viagem |
| PUT | `/api/trips/:id` | Atualiza viagem/status |
| DELETE | `/api/trips/:id` | Exclui viagem e seus gastos |
| POST | `/api/trips/:id/expenses` | Adiciona gasto |
| PUT | `/api/trips/:id/expenses/:eid` | Atualiza gasto |
| DELETE | `/api/trips/:id/expenses/:eid` | Remove gasto |

## Próximos passos sugeridos
- Login/multiusuário, checklists por viagem, exportação (CSV/PDF), modo offline (PWA) e deploy (ex.: Render, Railway, Fly.io).
