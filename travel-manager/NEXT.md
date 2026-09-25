# NEXT.md — Roadmap de próximas features do Viaja+

> Documento de planejamento para as próximas iterações. Estado atual (commit 4379ae5):
> frontend React 18 + Vite (pt-BR), backend MVC em TypeScript com Express, banco SQLite
> (`server/data/viajamaiss.db`), sincronização offline-first via IndexedDB + audit_log,
> busca de ônibus Brasil (HaFFas/BuscaPassagem) e trens Europa (HAFAS bahn.de / transport.rest).

---

## 🎯 Prioridade 0 — Pendências diretas da última rodada

### P0.1 · PWA real (Service Worker + manifest)
Hoje os **dados** funcionam offline (IndexedDB), mas o **HTML/JS/CSS** ainda dependem do cache do navegador.
- [ ] Criar `public/manifest.webmanifest` (nome "Viaja+", ícones 192/512, `display: standalone`, tema `#0f6b5c`)
- [ ] Adicionar Workbox (`vite-plugin-pwa`): precache de assets, runtime caching
      `NetworkFirst` para `/api/*` (timeout 3s → cai no IndexedDB) e `CacheFirst` para fontes/ícones
- [ ] Cache offline das respostas de `GET /api/trips/:id/docs/:subId/file` (ingressos/passagens abrem sem internet)
- [ ] Botão "Instalar app" (beforeinstallprompt) + testar com Lighthouse PWA ≥ 90

### P0.2 · Teste E2E de sincronização no dispositivo real
- [ ] Criar gasto com DevTools em modo offline → conferir banner "pendente" (`OfflineBanner.jsx`)
- [ ] Voltar online → confirmar push da fila (`src/offline.js`) e remap de ids temporários
- [ ] Conflito de edição (mesmo registro alterado em 2 dispositivos) → last-write-wins por `updated_at`; validar UI avisando

---

## ✨ Funcionalidades agregadoras já prometidas

### F1 · Contagem regressiva no Dashboard
- [ ] Card por viagem: "✈️ faltam X dias" / "🏖️ em andamento (dia Y de Z)" / "✅ concluída"
- [ ] Ordenar lista de viagens por proximidade da data de ida

### F2 · Resumo de orçamento multi-viagem
- [ ] Endpoint `GET /api/stats` já existe → expandir: total gasto, total orçado e % usado somando todas as viagens ativas
- [ ] Gráfico simples (barras por categoria — Transporte, Hospedagem, Alimentação…) sem lib pesada; CSS puro ou `recharts` se aceitarmos ~40kb

### F3 · Exportação CSV dos gastos
- [ ] Botão "⬇️ Exportar CSV" na aba Gastos e no Dashboard (todas as viagens)
- [ ] Colunas: viagem, data, categoria, descrição, valor, pago? · separador `;` e BOM UTF-8 (Excel pt-BR)
- [ ] Gerar no cliente a partir do IndexedDB → funciona offline

### F4 · Histórico de buscas favoritas
- [ ] Tabela `search_favorites` (migração `002_search_favorites.sql`): origem, destino, data, provedor, JSON do último resultado
- [ ] Estrela ⭐ nos resultados da tela "🔎 Buscar transporte"; reexecutar busca com 1 clique
- [ ] Sincronizar como entidade nova no protocolo de sync (adicionar ao `entitySchemas` do `syncService.ts`)

---

## 🚌✈️🚆 Busca de transportes — melhorias

### T1 · Preços reais de avião
- [ ] Integrar Kiwi.com Tequila API ou SerpAPI Google Flights (exige chave — guardar em `server/.env`: `KIWI_API_KEY`)
- [ ] Mesma normalização das cotações atuais (price, carrier, departureTime, durationMin, source="kiwi")
- [ ] Fallback gracioso quando sem chave: manter registro manual (já existe)

### T2 · Robustez HAFAS/transport.rest
- [ ] `trainTravels` do transport.rest não retorna preço → exibir "preço sob consulta" em vez de omitir
- [ ] Rate-limit por IP no backend (última tentativa falhou em 403 de datacenter; documentar uso via rede residencial/proxy próprio)
- [ ] Autocomplete de estações DB (HAFAS `stationList`) no formulário de trem

### T3 · Cotações inteligentes
- [ ] Comparador lado a lado (ônibus vs trem vs avião) na mesma tela de busca
- [ ] Alerta "💡 economia": sugerir opção mais barata salva como meta de orçamento

---

## 🔐 Backend / Arquitetura

### B1 · Usuários e autenticação (multi-usuário real)
- [ ] Tabela `users` + JWT (`jsonwebtoken`) + hash `bcryptjs`; middleware `requireAuth` em `routes/index.ts`
- [ ] Escopar trips/expenses/quotes/docs por `user_id` (hoje é single-tenant)
- [ ] Sync passa a enviar apenas mudanças do usuário autenticado

### B2 · Migrações versionadas
- [ ] Runner de migração no boot do `db.ts` (tabela `_migrations`); hoje só `001_init.sql`
- [ ] Próximas: `002_search_favorites`, `003_users`, `004_trip_collaborators`

### B3 · Qualidade
- [ ] Vitest + Supertest: cobrir `syncService` (caso-regressão: lote com trip id negativo + filho apontando p/ ele), CRUD de trips e parsers HAFAS
- [ ] ESLint + Prettier no `server/` (TS) e `src/` (JSX); CI simples no GitHub Actions (lint + test + build)
- [ ] Zod para validar body de todos os controllers (hoje validação manual)

### B4 · Arquivos e backups
- [ ] Hoje documentos (ingressos/PDFs) ficam como BLOB no SQLite → adicionar espelho em pasta `uploads/` com caminho relativo (backup mais fácil)
- [ ] Rota `GET /api/export` → dump JSON completo (viagens, gastos, cotações, docs em base64) para restore
- [ ] Limpeza automática de WAL/checkpoint periódico

---

## 🧭 UX / Produto

- [ ] **Itinerário dia a dia** (`itinerary_items`): eventos com data/hora/local vinculados a docs e gastos (ex.: "14/01 08:30 voo LA-3123 🎫")
- [ ] **Checklist de viagem** gerado por tipo (avião→documentos, passaporte válido, seguro…); editável e offline
- [ ] **Moeda**: gastos em EUR/USD com conversão (taxa fixa informada pelo usuário; API de câmbio quando online)
- [ ] **Compartilhar viagem** (link somente-leitura) e colaboração em tempo real (mais difícil — depois de B1)
- [ ] **Notificações**: push Web Push "faltam 7 dias para Portugal 🇵🇹" e lembrete de check-in 24h antes (depende de P0.1)
- [ ] Modo escuro (CSS variables já facilitam) e acessibilidade (labels, foco visível)

---

## 📦 Deploy & Distribuição

- [ ] Dockerfile único (build Vite → serve estático + Express + volume p/ `data/`)
- [ ] Fly.io/Railway: SQLite em volume persistente; alternativa Postgres atrás de interface de repo (`models/*.ts` já centralizam SQL)
- [ ] Empacotar como app desktop com Tauri/Electron reaproveitando o mesmo código + SQLite local (offline 100%)
- [ ] Script `npm run seed-demo` com dados fictícios para screenshots/demos

---

## 🗂️ Mapa do código (referência rápida)

```
travel-manager/
├─ src/                      # Frontend React (Vite)
│  ├─ api.js                 # Cliente HTTP + camada offline-first
│  ├─ offline.js             # IndexedDB mirror, fila de sync, cursor pull/push
│  └─ components/            # Dashboard, TripDetail, GlobalSearch, TransportSearch,
│                            # Documents, OfflineBanner, TripForm, TripList
├─ server/                   # Backend MVC TypeScript (Express)
│  ├─ src/routes/index.ts    # Rotas REST (/api/trips..., /api/search-*, /api/sync/*)
│  ├─ src/controllers/       # trip, expense, search, sync
│  ├─ src/models/            # trip, expense, quote, document (SQL c/ node:sqlite)
│  ├─ src/services/          # hafasProxy, searchTrains, searchTransport, syncService
│  ├─ src/migrations/        # 001_init.sql (+ novas aqui — ver B2)
│  └─ data/viajamaiss.db     # SQLite (WAL)
└─ scripts/import-legacy.cjs # Importador do antigo data.json
```

**Endpoints atuais:** `GET /api/health` · `GET /api/stats` · CRUD `/api/trips[/:id]` ·
`/api/trips/:id/expenses|quotes|docs` (+ `POST .../quotes/:subId/convert`, `GET .../docs/:subId/file`) ·
`GET /api/search-transport` · `GET /api/search-trains` · `GET /api/sync/changes` · `POST /api/sync/push`

**Rodar:** `cd server && npm run dev` (porta 3001) · `npm run dev` na raiz (Vite 5173, proxy /api→3001)
