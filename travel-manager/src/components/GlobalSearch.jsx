import { useEffect, useState } from 'react'

const RECENTS_KEY = 'viajamaiss.recentSearches'
function loadRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY)) || [] } catch { return [] }
}
import { api, brl } from '../api.js'
import { cacheStops, localStopSuggestions } from '../offline.js'

function fmtDuration(min) {
  if (min == null) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}min`
}

const PROVIDERS = {
  onibus: {
    label: '🚌 Ônibus no Brasil',
    hint: 'HaFFas / BuscaPassagem — câmara de compensação do transporte rodoviário BR.',
    api: 'searchTransport',
    originPh: 'Cidade de origem (ex.: São Paulo)',
    destPh: 'Cidade de destino',
    searchLabel: 'Buscar ônibus'
  },
  trem: {
    label: '🚆 Trem na Europa',
    hint: 'HAFAS europeu (base oficial da Deutsche Bahn/ÖBB/SBB) — horários, duração, conexões e preço "ab X €" quando disponível. Basta digitar a cidade (ex.: "Munique", "Paris", "Viena") e escolher uma estação na lista que aparece — não precisa saber o nome exato.',
    api: 'searchTrains',
    originPh: 'Origem — digite a cidade (ex.: Munique)',
    destPh: 'Destino — digite a cidade (ex.: Berlim)',
    searchLabel: 'Buscar trens'
  }
}

// Campo de estação com AUTOCOMPLETE — ninguém precisa saber o nome exato.
// Enquanto você digita (2+ letras), busca sugestões reais no HAFAS e mostra
// uma lista para clicar. Se o provedor estiver bloqueado/offline, cai num
// CACHE local (IndexedDB): histórico de sugestões que já funcionaram + um
// dicionário embutido de cidades europeias em PT-BR (Munique→München Hbf…).
function StopInput({ placeholder, value, onChange, enabled }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fromCache, setFromCache] = useState(false)

  useEffect(() => {
    if (!enabled) { setSuggestions([]); return }
    const q = String(value || '').trim()
    if (q.length < 2) { setSuggestions([]); return }
    // se o usuário já escolheu uma sugestão exata, não reabre a lista
    if (suggestions.some((s) => s.name === q)) { return }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.suggestStops(q)
        const list = r?.results || []
        if (cancelled) return
        if (list.length > 0) {
          setSuggestions(list)
          setFromCache(false)
          cacheStops(list) // aprende para uso futuro offline
        } else {
          // provedor vazio/bloqueado → fallback do cache local
          setSuggestions(await localStopSuggestions(q))
          setFromCache(true)
        }
      } catch {
        if (cancelled) return
        setSuggestions(await localStopSuggestions(q))
        setFromCache(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 350) // debounce: evita martelar a API a cada tecla
    return () => { cancelled = true; clearTimeout(t) }
  }, [value, enabled])

  return (
    <div className="stop-input">
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {enabled && loading && <span className="ac-spinner" title="buscando estações…">⏳</span>}
      {enabled && open && suggestions.length > 0 && (
        <>
          {fromCache && <div className="ac-note">💾 sugestões locais (offline/sem resposta do provedor)</div>}
          <ul className="autocomplete">
            {suggestions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(s.name); setSuggestions([]); setOpen(false) }}
                >
                  🚉 {s.name}{s.district && s.district !== s.name ? ` — ${s.district}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// TELA DE BUSCA GLOBAL DE TRANSPORTE — independente de viagem.
// O usuário escolhe o provedor (ônibus BR / trem Europa), busca preços e
// tempos reais e salva a cotação direto na viagem desejada (ou várias).
export default function GlobalSearch({ trips, onError, onSaved }) {
  const [provider, setProvider] = useState('onibus')
  const [form, setForm] = useState({ origin: '', destination: '', date: '' })
  const [tripId, setTripId] = useState(trips[0]?.id || '')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null) // {items, channel}
  const [savedTags, setSavedTags] = useState([])
  const [recents, setRecents] = useState(loadRecents)

  useEffect(() => { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 6))) }, [recents])

  const rememberSearch = () => {
    const item = { provider, origin: form.origin.trim(), destination: form.destination.trim(), date: form.date, at: Date.now() }
    setRecents((prev) => [item, ...prev.filter((r) => !(r.provider === item.provider && r.origin === item.origin && r.destination === item.destination && r.date === item.date))].slice(0, 6))
  }

  const p = PROVIDERS[provider]
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const runSearch = async (e) => {
    e.preventDefault()
    if (!form.origin.trim() || !form.destination.trim() || !form.date) {
      onError('Preencha origem, destino e data para buscar')
      return
    }
    setSearching(true)
    setResults(null)
    try {
      const data = await api[p.api]({
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        date: form.date
      })
      setResults({ items: data.results || [], channel: data.channel || '' })
      rememberSearch()
    } catch (err) {
      onError(err.message)
    } finally {
      setSearching(false)
    }
  }

  const tagOf = (r) => `${provider}|${r.company}|${r.departureTime}|${r.price}|${r.from}→${r.to}`

  const saveResult = async (r) => {
    if (!tripId) { onError('Selecione a viagem onde salvar esta cotação'); return }
    try {
      await api.addQuote(Number(tripId), {
        mode: r.mode || provider,
        from: r.from, to: r.to,
        company: r.company,
        price: r.price,
        date: r.date,
        notes: [
          r.busType && `Veículo ${r.busType}`,
          r.departureTime && `saída ${r.departureTime}`,
          r.arrivalTime && `chegada ${r.arrivalTime}`,
          r.durationMin != null && `duração ${fmtDuration(r.durationMin)}`,
          r.source === 'hafas-eu' ? 'Fonte: HAFAS (Europa)' : 'Fonte: HaFFas'
        ].filter(Boolean).join(' · '),
        busType: r.busType,
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        durationMin: r.durationMin,
        source: r.source,
        url: r.url
      })
      setSavedTags((prev) => [...prev, tagOf(r)])
      onSaved?.()
    } catch (err) { onError(err.message) }
  }

  const swap = () => setForm((f) => ({ ...f, origin: f.destination, destination: f.origin }))
  const applyRecent = (r) => { setProvider(r.provider); setForm({ origin: r.origin, destination: r.destination, date: r.date }); setResults(null) }

  const activeTrips = trips.filter((t) => t.status !== 'concluida')

  return (
    <section>
      <h1>🔎 Buscar transporte</h1>
      <p className="muted">
        Pesquise preços e tempos reais antes de decidir — depois salve a cotação na sua viagem
        e, quando comprar, lance tudo nos gastos com um clique.
      </p>

      <div className="card panel">
        {/* Seletor de provedor */}
        <div className="provider-tabs">
          {Object.entries(PROVIDERS).map(([k, v]) => (
            <button
              key={k}
              className={`provider-tab ${provider === k ? 'active' : ''}`}
              onClick={() => { setProvider(k); setResults(null) }}
            >{v.label}</button>
          ))}
        </div>
        <p className="muted small-text">{p.hint}</p>

        <form className="quote-form" onSubmit={runSearch}>
          <StopInput
            placeholder={p.originPh}
            value={form.origin}
            onChange={(v) => setForm((f) => ({ ...f, origin: v }))}
            enabled={provider === 'trem'}
          />
          <span className="arrow">→</span>
          <button type="button" className="btn-small swap" title="Inverter origem e destino" onClick={swap}>⇄</button>
          <StopInput
            placeholder={p.destPh}
            value={form.destination}
            onChange={(v) => setForm((f) => ({ ...f, destination: v }))}
            enabled={provider === 'trem'}
          />
          <input type="date" value={form.date} onChange={set('date')} title="Data da viagem" />
          <button className="btn-primary" disabled={searching}>
            {searching ? '⏳ Buscando…' : `🔍 ${p.searchLabel}`}
          </button>
        </form>

        {recents.length > 0 && (
          <div className="recent-chips">
            <span className="cat">🕘 Recentes:</span>
            {recents.map((r, i) => (
              <button key={i} className="chip" onClick={() => applyRecent(r)} title={`${r.date} · ${r.provider === 'trem' ? '🚆 Europa' : '🚌 Brasil'}`}>
                {(r.provider === 'trem' ? '🚆 ' : '🚌 ') + r.origin.split(' ')[0] + ' → ' + r.destination.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        <div className="save-into">
          <span className="cat">Salvar resultados em:</span>
          {trips.length === 0 ? (
            <span className="muted small">nenhuma viagem cadastrada — crie uma primeiro 😉</span>
          ) : (
            <select value={tripId} onChange={(e) => setTripId(e.target.value)}>
              {(activeTrips.length ? activeTrips : trips).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}{t.destination ? ` (${t.destination})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {results !== null && results.items.length > 0 && (
          <>
            <p className="muted small-text">📡 {results.items.length} opção(ões) · fonte: {results.channel || 'dados reais do provedor'}</p>
            <ul className="quotes search-results">
            {results.items.map((r, i) => {
              const tag = tagOf(r)
              return (
                <li key={i}>
                  <span className="cat">{r.mode === 'trem' ? '🚆' : '🚌'} {r.company || 'Operadora'}</span>
                  <div className="exp-desc">
                    <strong>
                      {r.departureTime || '?'} → {r.arrivalTime || '?'}
                      {r.durationMin != null && ` (${fmtDuration(r.durationMin)})`}
                    </strong>
                    <span className="muted small">
                      {r.from} → {r.to}{r.busType && ` · ${r.busType}`}{r.notes && ` · ${r.notes}`}
                    </span>
                  </div>
                  <span className="quote-price-static">
                    <strong>{r.price > 0 ? brl(r.price) : 'sob consulta'}</strong>
                  </span>
                  {savedTags.includes(tag) ? (
                    <span className="badge-ok">✅ salva</span>
                  ) : (
                    <button className="btn-small" onClick={() => saveResult(r)}>＋ Salvar na viagem</button>
                  )}
                  {r.url && (
                    <a className="btn-small link" href={r.url} target="_blank" rel="noreferrer" title="Comprar no site">🛒</a>
                  )}
                </li>
              )
            })}
            </ul>
          </>
        )}
        {results !== null && results.items.length === 0 && (
          <p className="muted">Nenhum resultado. Confira a grafia das cidades/estações.</p>
        )}
      </div>

      <div className="card panel">
        <h2>💡 Dica</h2>
        <p className="muted small-text">
          As cotações ficam na aba 🚌 Transporte de cada viagem. Ao clicar em “💰 Comprei!”,
          o valor entra automaticamente nos gastos daquela viagem. Avião ainda é manual
          (APIs de voo exigem chave paga) — registre a cotação dentro da viagem.
        </p>
      </div>
    </section>
  )
}
