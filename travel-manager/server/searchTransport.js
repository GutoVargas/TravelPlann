// Busca REAL de passagens de ônibus via HaFFas / BuscaPassagem.com
// ---------------------------------------------------------------------------
// A HaFFas é a câmara de compensação do transporte rodoviário brasileiro; o
// site BuscaPassagem.com usa os dados dela. Não há API pública oficial com
// documentação aberta, então usamos o endpoint JSON que alimenta o buscador
// deles (poderá mudar sem aviso — nesse caso a busca retorna um erro amigável
// e você ainda pode registrar as cotações manualmente).
//
// Cobertura: apenas ÔNIBUS no Brasil (avião/trem não são cobertos pela HaFFas).
// Para avião, uma integração futura possível: Kiwi/Amadeus ou SerpAPI
// (Google Flights), ambas pagas/com chave.
//
// Configuração opcional via variáveis de ambiente (.env):
//   BUSCAPASSAGEM_KEY / BUSCAPASSAGEM_TOKEN  -> enviado como header x-api-key
//   HAFFAS_BASE_URL                          -> override da URL do endpoint
// ---------------------------------------------------------------------------

const DEFAULT_BASE = 'https://www.buscapassagem.com.br/v2/api/public/search'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutos
const cache = new Map()

function envKey() {
  return process.env.BUSCAPASSAGEM_KEY || process.env.BUSCAPASSAGEM_TOKEN || ''
}

function baseUrl() {
  return process.env.HAFFAS_BASE_URL || DEFAULT_BASE
}

// Normaliza "São Paulo - SP, BR" -> "SAO PAULO"; "Rio de Janeiro" -> "RIO DE JANEIRO"
export function normalizeCity(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s*[-–]\s*[A-Z]{2}(,\s*BR)?\s*$/i, '') // remove sufixo "- SP" etc.
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toMinutes(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function fmtHM(d) {
  if (!d) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Converte o payload da HaFFas/BuscaPassagem no formato das nossas cotações
function mapResults(json, origin, destination, date) {
  const raw = json?.results ?? json?.data ?? json?.searches?.[0]?.results ?? []
  if (!Array.isArray(raw)) return []
  const out = []
  for (const r of raw) {
    try {
      const price = Number(r.price ?? r.ticket_price ?? r.finalPrice ?? r.value)
      if (!Number.isFinite(price) || price <= 0) continue
      const dep = toMinutes(r.departure_date ?? r.departureDate ?? r.departure)
      const arr = toMinutes(r.arrival_date ?? r.arrivalDate ?? r.arrival)
      const durationMin = dep && arr ? Math.round((arr - dep) / 60000) : null
      out.push({
        mode: 'onibus',
        from: r.origin_city || r.from || origin,
        to: r.destination_city || r.to || destination,
        company: r.company?.name || r.company || r.operator || '',
        busType: r.bus_type?.name || r.busType || r.service || '',
        price: Math.round(price * 100) / 100,
        date,
        departureTime: fmtHM(dep),
        arrivalTime: fmtHM(arr),
        durationMin,
        notes: r.bus_type?.name ? `Ônibus ${r.bus_type.name}` : '',
        source: 'haffas',
        url: r.buy_url || r.url || null
      })
    } catch { /* ignora item malformado */ }
  }
  // ordena por preço
  return out.sort((a, b) => a.price - b.price).slice(0, 30)
}

async function fetchWithTimeout(url, options, ms = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/**
 * Busca horários/preços reais de ônibus (HaFFas/BuscaPassagem).
 * @returns {Promise<{count:number, results:Array}>}
 */
export async function searchTransport({ origin, destination, date }) {
  if (!origin || !destination) throw new Error('informe origem e destino')
  if (!date) throw new Error('informe a data da viagem')

  const o = normalizeCity(origin)
  const d = normalizeCity(destination)
  const key = `${o}|${d}|${date}`

  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload

  const headers = { Accept: 'application/json' }
  const apiKey = envKey()
  if (apiKey) headers['x-api-key'] = apiKey

  const target = `${baseUrl()}?origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&date=${encodeURIComponent(date)}`

  let res
  try {
    res = await fetchWithTimeout(target, { headers })
  } catch (e) {
    throw new Error(
      `Falha ao consultar a HaFFas/BuscaPassagem (${e.name === 'AbortError' ? 'tempo esgotado' : e.message}). ` +
      'Verifique sua conexão ou registre a cotação manualmente.'
    )
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'A HaFFas/BuscaPassagem exigiu credenciais (HTTP ' + res.status + '). ' +
      (apiKey
        ? 'A chave configurada parece inválida.'
        : 'Configure BUSCAPASSAGEM_KEY no arquivo .env da pasta server/, ou contate a HaFFas para obter acesso à API.') +
      ' Enquanto isso, você pode salvar cotações manualmente.'
    )
  }
  if (res.status === 429) throw new Error('Muitas buscas em pouco tempo (limite da HaFFas). Aguarde alguns minutos.')
  if (!res.ok) {
    throw new Error(`Erro ${res.status} na consulta à HaFFas/BuscaPassagem. Tente novamente ou salve a cotação manualmente.`)
  }

  let json
  try { json = await res.json() } catch { json = {} }
  const payload = { count: 0, results: [] }
  try {
    const results = mapResults(json, o, d, date)
    payload.count = results.length
    payload.results = results
  } catch {
    // resposta em formato inesperado → trata como vazio
  }

  if (payload.count === 0) {
    throw new Error(
      `A HaFFas não retornou resultados para "${o}" → "${d}" em ${date}. ` +
      'Confira a grafia das cidades (ex.: "São Paulo") ou salve a cotação manualmente.'
    )
  }

  cache.set(key, { at: Date.now(), payload })
  return payload
}
