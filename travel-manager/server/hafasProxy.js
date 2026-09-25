// Camada de rede para o HAFAS europeu (trens) SEM mock nenhum.
// ---------------------------------------------------------------------------
// O bahn.de bloqueia requisições vindas de servidores/datacenters (Akamai
// OPS_BLOCKED). Para contornar isso usamos, em ordem de preferência:
//   1. Proxy configurável via env TRAINS_PROXY_URL (recomendado no seu PC:
//      deixe vazio — requests diretos funcionam de redes residenciais);
//   2. Request direto;
//   3. Fallbacks públicos de CORS-proxy (corsproxy.io, allorigins, codetabs).
// Todos os DADOS exibidos vêm sempre do HAFAS real da Deutsche Bahn — se
// nenhum canal funcionar, a API retorna erro amigável (nunca dados falsos).
// ---------------------------------------------------------------------------

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export function withTimeout(promiseFactory, ms = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  const p = promiseFactory(ctrl.signal)
  p.catch(() => {}) // evita unhandled rejection quando um canal falha
  return Promise.race([p.finally(() => clearTimeout(t)), new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(Object.assign(new Error('tempo esgotado'), { name: 'AbortError' }))))])
}

function buildCandidates(url, method, body, headers) {
  const encoded = encodeURIComponent(url)
  const list = []
  if (process.env.TRAINS_PROXY_URL) {
    // coloque aqui um proxy seu, ex.: https://meu-proxy.example.com/?url=
    list.push({ url: process.env.TRAINS_PROXY_URL + encoded })
  }
  list.push({ url, method, body, headers })
  // Proxies CORS públicos (podem exigir chave/estar indisponíveis — por isso
  // são só fallback; os DADOS continuam vindo sempre do HAFAS real):
  list.push({ url: `https://api.allorigins.win/raw?url=${encoded}`, headers: { Accept: 'application/json' } })
  list.push({ url: `https://api.codetabs.com/v1/proxy?quest=${encoded}`, headers: { Accept: 'application/json' } })
  if (process.env.CORSPROXY_KEY) {
    list.push({ url: `https://corsproxy.io/?key=${encodeURIComponent(process.env.CORSPROXY_KEY)}&url=${encoded}`, headers: { Accept: 'application/json' } })
  }
  return list
}

/**
 * Faz uma requisição ao HAFAS tentando todos os canais disponíveis.
 * @returns {Promise<any>} JSON parseado
 */
export async function hafasRequest({ url, method = 'GET', body = null, headers = {} }) {
  const baseHeaders = {
    Accept: 'application/json',
    'User-Agent': UA,
    Origin: 'https://www.bahn.de',
    Referer: 'https://www.bahn.de/',
    ...headers
  }
  const candidates = buildCandidates(url, method, body, baseHeaders)
  let lastStatus = null
  for (const c of candidates) {
    try {
      const res = await withTimeout(
        (signal) =>
          fetch(c.url, {
            method: c.method || method,
            body: c.body !== undefined ? c.body : body,
            headers: c.headers || baseHeaders,
            signal
          }),
        15000
      )
      if (!res.ok) {
        lastStatus = res.status
        continue // tenta o próximo canal (403 do Akamai, 429 etc.)
      }
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        // alguns proxies devolvem HTML com JSON embutido
        const m = text.match(/\{[\s\S]*\}/)
        if (m) { try { return JSON.parse(m[0]) } catch { /* segue */ } }
        lastStatus = 502
        continue
      }
    } catch {
      /* canal indisponível → próximo */
    }
  }
  throw Object.assign(
    new Error(
      `Não foi possível acessar o HAFAS europeu${lastStatus ? ` (último HTTP ${lastStatus})` : ''}. ` +
      'Isso ocorre em redes que bloqueiam o bahn.de (corporate/datacenter). ' +
      'De redes domésticas funciona normalmente; ou configure TRAINS_PROXY_URL no .env.'
    ),
    { status: lastStatus }
  )
}
