// Busca REAL de horários de trens/transporte público na EUROPA.
// ---------------------------------------------------------------------------
// Fonte dos dados: HAFAS — a "espinha dorsal" de horários que a Deutsche Bahn
// publica para toda a Europa (DB, ÖBB, SBB e parceiros). Duas portas de
// entrada públicas, SEM mock e SEM chave de API:
//   A) bahn.de REST API (endpoint oficial do site da DB) — melhor fonte; o
//      firewall (Akamai) bloqueia redes de datacenter, mas funciona de redes
//      domésticas ou através de proxy configurável (TRAINS_PROXY_URL).
//   B) transport.rest (proxy comunitário do HAFAS da DB) — alternativa quando
//      o acesso direto ao bahn.de é bloqueado.
// Se nenhum canal responder, a API devolve ERRO amigável — nunca dados falsos.
//
// Cobertura: trens em quase toda a Europa (ICE/TGV/RJ/EC…), metrô, bondes.
// Preço: o payload do HAFAS nem sempre traz tarifa; quando traz, exibimos o
// valor real ("ab X €"). Caso contrário o resultado aparece "sob consulta" e
// você pode editar o preço ao salvar a cotação.
//
// Configuração opcional via .env:
//   TRAINS_BASE_URL   -> override do endpoint de busca do bahn.de
//   TRAINS_STOPS_URL  -> override do autocomplete de estações do bahn.de
//   TRAINS_PROXY_URL  -> prefixo de proxy seu, ex.: https://meu-proxy/?url=
//   TRANSPORT_REST    -> base do proxy comunitário (padrão v6.db.transport.rest)
// ---------------------------------------------------------------------------

import { hafasRequest } from './hafasProxy.js'

const DEFAULT_SEARCH =
  'https://www.bahn.de/web/api/automated-trip-production/product/DE/db/regioTripSearch/rest/search'
const DEFAULT_STOPS =
  'https://www.bahn.de/web/api/automated-trip-production/search/stopWords'
const DEFAULT_COMMUNITY = 'https://v6.db.transport.rest'

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map()

const baseUrl = () => process.env.TRAINS_BASE_URL || DEFAULT_SEARCH
const stopsUrl = () => process.env.TRAINS_STOPS_URL || DEFAULT_STOPS
const communityBase = () => process.env.TRANSPORT_REST || DEFAULT_COMMUNITY

// --- resolução de estações -------------------------------------------------
// 1º tenta o autocomplete oficial do bahn.de; se bloqueado, usa o
// /locations do transport.rest (mesma base HAFAS; id = número EVa).
async function resolveStop(name) {
  const clean = String(name).trim()
  try {
    const url = `${stopsUrl()}?query=${encodeURIComponent(clean)}&limit=1`
    const json = await hafasRequest({ url })
    const hit = Array.isArray(json) ? json[0] : json?.stops?.[0] ?? null
    if (hit && (hit.id || hit.evaNo || hit.globalId)) {
      return {
        id: String(hit.id || hit.evaNo || hit.globalId),
        name: hit.name || hit.label || clean
      }
    }
  } catch { /* segue para o canal comunitário */ }

  let json = null
  try {
    const url = `${communityBase()}/locations?query=${encodeURIComponent(clean)}&results=1`
    json = await hafasRequest({ url })
  } catch { /* sem canais disponíveis */ }
  const hit = Array.isArray(json) ? json[0] : null
  if (!hit || !hit.id) {
    throw new Error(
      `Não encontramos a estação "${clean}" na Europa. Tente o nome oficial (ex.: "München Hbf", "Paris Gare de Lyon", "Wien Hbf").`
    )
  }
  return { id: String(hit.id), name: hit.name || clean }
}

// --- helpers de formato ------------------------------------------------------
const hm = (d) =>
  d && !Number.isNaN(d.getTime())
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : ''

function parseDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function extractPrice(t) {
  const candidates = [
    t?.summary?.fare?.amount, t?.fare?.amount, t?.price?.amount,
    t?.offers?.price?.amount, t?.offers?.[0]?.price?.amount,
    t?.fare?.fareItems?.[0]?.price?.amount, t?.raw?.fare?.price
  ]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100
  }
  return null
}

// Formato A: resposta JSON do bahn.de (regioTripSearch)
function mapBahnDe(json, originName, destName, date) {
  const trips = json?.trips ?? json?.offers ?? []
  const out = []
  for (const t of (Array.isArray(trips) ? trips : []).slice(0, 20)) {
    try {
      const lg = t.legs || [t]
      const dep = parseDate(lg[0]?.departure ?? t.serviceStart)
      const arr = parseDate(lg[lg.length - 1]?.arrival ?? t.serviceEnd)
      if (!dep) continue
      const trains = lg.map((l) => l.train?.name || l.product?.name).filter(Boolean)
      const changes = Math.max(0, lg.filter((l) => l.train || l.mode === 'TRAIN').length - 1)
      out.push({
        mode: 'trem',
        from: lg[0]?.departure?.station?.name || lg[0]?.stop?.name || originName,
        to: lg[lg.length - 1]?.arrival?.station?.name || lg[lg.length - 1]?.stop?.name || destName,
        company: String(trains[0] || 'Trem'),
        busType: '',
        price: extractPrice(t) ?? 0,
        date,
        departureTime: hm(dep),
        arrivalTime: hm(arr),
        durationMin: arr ? Math.round((arr - dep) / 60000) : null,
        notes: [
          changes > 0 ? `${changes} conexão(ões)` : 'direto',
          trains.join(' + ') || null,
          'Fonte: HAFAS (bahn.de)'
        ].filter(Boolean).join(' · '),
        source: 'hafas-eu',
        url: 'https://www.bahn.de/'
      })
    } catch { /* ignora item malformado */ }
  }
  return out
}

// Formato B: resposta do transport.rest (journeys → legs ISO-8601)
function mapTransportRest(json, originName, destName, date) {
  const journeys = json?.journeys ?? []
  const out = []
  for (const j of journeys.slice(0, 20)) {
    try {
      const legs = j.legs || []
      if (!legs.length) continue
      const dep = parseDate(legs[0].departure)
      const arr = parseDate(legs[legs.length - 1].arrival)
      if (!dep) continue
      const trains = legs.map((l) => l.line?.name || (l.line ? `${l.line.type || ''} ${l.line.id || ''}`.trim() : null)).filter(Boolean)
      const changes = Math.max(0, legs.filter((l) => l.line).length - 1)
      out.push({
        mode: 'trem',
        from: legs[0].departureStop?.name || originName,
        to: legs[legs.length - 1].arrivalStop?.name || destName,
        company: trains[0] || 'Trem',
        busType: '',
        price: 0, // transport.rest não expõe tarifas
        date,
        departureTime: hm(dep),
        arrivalTime: hm(arr),
        durationMin: arr ? Math.round((arr - dep) / 60000) : null,
        notes: [
          changes > 0 ? `${changes} conexão(ões)` : 'direto',
          trains.join(' + ') || null,
          'Fonte: HAFAS (transport.rest)'
        ].filter(Boolean).join(' · '),
        source: 'hafas-eu',
        url: 'https://www.bahn.de/'
      })
    } catch { /* ignora */ }
  }
  return out
}

/**
 * Busca conexões REAIS de trem na Europa (HAFAS).
 * @returns {Promise<{count:number, results:Array, channel:string}>}
 */
export async function searchTrains({ origin, destination, date }) {
  if (!origin || !destination) throw new Error('informe origem e destino')
  if (!date) throw new Error('informe a data da viagem')

  const key = `train|${origin}|${destination}|${date}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload

  let from, to
  try {
    ;[from, to] = await Promise.all([resolveStop(origin), resolveStop(destination)])
  } catch (e) {
    if (/Não encontramos/.test(e.message)) throw e
    throw new Error(`Falha ao localizar as estações (${e.message}). Verifique os nomes.`)
  }

  let results = []
  let channel = ''
  let lastErr = null

  // Canal A: bahn.de (oficial)
  try {
    const body = {
      arrivalMode: 'DEPARTURE',
      class: 'SECOND_CLASS',
      currency: 'EUR',
      directFareOnly: false,
      mainTransportationMeans: ['RAIL'],
      minConnectionTime: 5,
      noAirplane: true,
      passengers: [{ age: 30, type: 'ADULT' }],
      reservation: false,
      searchDate: date,
      searchTime: '08:00',
      singleFilter: 'FARE_CLASS_2',
      start: { id: from.id, name: from.name },
      target: { id: to.id, name: to.name },
      travelMode: 'TRAIN_TYPE'
    }
    const json = await hafasRequest({
      url: baseUrl(),
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    })
    results = mapBahnDe(json, from.name, to.name, date)
    if (results.length) channel = 'bahn.de (HAFAS oficial)'
  } catch (e) {
    lastErr = e
  }

  // Canal B: transport.rest (proxy comunitário do HAFAS da DB)
  if (!results.length) {
    try {
      const url = `${communityBase()}/journeys?from=${encodeURIComponent(from.id)}&to=${encodeURIComponent(to.id)}&results=8&transfers=true`
      const json = await hafasRequest({ url })
      results = mapTransportRest(json, from.name, to.name, date)
      if (results.length) channel = 'transport.rest (HAFAS DB)'
    } catch (e) {
      lastErr = e
    }
  }

  if (!results.length) {
    throw new Error(
      `O HAFAS europeu não respondeu por nenhum canal${lastErr ? ` (${lastErr.message})` : ''}. ` +
      'Em redes corporativas/datacenters o bahn.de costuma ser bloqueado — rode o app de uma rede ' +
      'doméstica ou configure TRAINS_PROXY_URL no .env. Você sempre pode registrar a cotação manualmente.'
    )
  }

  const payload = {
    count: results.length,
    channel,
    results: results.sort(
      (a, b) => (a.price || Infinity) - (b.price || Infinity) || (a.durationMin ?? Infinity) - (b.durationMin ?? Infinity)
    )
  }

  cache.set(key, { at: Date.now(), payload })
  return payload
}
