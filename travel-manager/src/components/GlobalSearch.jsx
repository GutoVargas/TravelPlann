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

// Modos de rota suportados pelo Google Routes API (+ estimativa de voo)
export const ROUTE_MODES = [
  { key: 'DRIVE', label: '🚗 Carro' },
  { key: 'TRANSIT', label: '🚆 Trem / ônibus / metrô' },
  { key: 'WALK', label: '🚶 A pé' },
  { key: 'BICYCLE', label: '🚲 Bicicleta' },
  { key: 'FLIGHT', label: '✈️ Voo (estimativa)' }
]

// Campo de lugar com AUTOCOMPLETE real do Google Places — ninguém precisa
// saber o nome exato. Enquanto você digita (2+ letras), o backend consulta
// places:autocomplete e mostra a lista para clicar. Sem internet/chave/bloqueio,
// cai no CACHE local (IndexedDB): histórico aprendido + dicionário PT-BR.
function PlaceInput({ placeholder, value, onChange }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fromCache, setFromCache] = useState(false)

  useEffect(() => {
    const q = String(value || '').trim()
    // se o usuário escolheu uma sugestão exata ("Nome — detalhe"), não reabre
    if (suggestions.some((s) => s.name === q || s.text === q)) return
    if (q.length < 2) { setSuggestions([]); return }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.suggestPlaces(q)
        const list = (r?.results || []).map((x) => ({ name: x.text || x.name, text: x.text, placeId: x.placeId }))
        if (cancelled) return
        if (list.length > 0) {
          setSuggestions(list)
          setFromCache(false)
          cacheStops(list.map((x) => ({ name: x.name, district: '' })))
        } else {
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
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [value])

  return (
    <div className="stop-input">
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
      />
      {loading && <span className="ac-spinner" title="buscando lugares…">⏳</span>}
      {open && suggestions.length > 0 && (
        <>
          {fromCache && <div className="ac-note">💾 sugestões locais (offline/sem resposta do provedor)</div>}
          <ul className="autocomplete">
            {suggestions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); onChange(s.name); setSuggestions([]); setOpen(false) }}
                >
                  📍 {s.name}{s.district && s.district !== s.name ? ` — ${s.district}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

// Mapa estático do Google (ou link para o Google Maps) desenhando a rota.
function RouteMap({ route, originLocation, destinationLocation }) {
  if (!route?.polyline || !originLocation || !destinationLocation) {
    const q = encodeURIComponent(`${route?.originName || ''} to ${route?.destinationName || ''}`)
    return (
      <a className="maps-link" href={`https://www.google.com/maps/dir/?api=1&origin=${originLocation?.latitude},${originLocation?.longitude}&destination=${destinationLocation?.latitude},${destinationLocation?.longitude}&travelmode=${(route?.mode || 'drive').toLowerCase()}`} target="_blank" rel="noreferrer">
        🗺️ Abrir rota no Google Maps
      </a>
    )
  }
  return (
    <iframe
      title="mapa da rota"
      className="route-map"
      loading="lazy"
      src={`https://www.google.com/maps/embed/v1/directions?origin=${originLocation.latitude},${originLocation.longitude}&destination=${destinationLocation.latitude},${destinationLocation.longitude}&mode=${(route.mode || 'DRIVE').toLowerCase()}&zoom=7`}
    />
  )
}

// TELA DE BUSCA GLOBAL — rotas, mapas e tempo de deslocamento via Google.
export default function GlobalSearch({ trips, onError, onSaved }) {
  const [form, setForm] = useState({ origin: '', destination: '', date: '' })
  const [modes, setModes] = useState(['DRIVE', 'TRANSIT'])
  const [tripId, setTripId] = useState(trips[0]?.id || '')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState(null) // {origin,destination,routes,...}
  const [selected, setSelected] = useState(0)
  const [savedTags, setSavedTags] = useState([])
  const [recents, setRecents] = useState(loadRecents)
  const [googleReady, setGoogleReady] = useState(null) // null=desconhecido

  useEffect(() => { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, 6))) }, [recents])
  useEffect(() => { api.googleStatus().then((r) => setGoogleReady(!!r?.hasKey)).catch(() => setGoogleReady(false)) }, [])

  const toggleMode = (k) =>
    setModes((prev) => (prev.includes(k) ? prev.filter((m) => m !== k) : [...prev, k]))

  const runSearch = async (e) => {
    e.preventDefault()
    if (!form.origin.trim() || !form.destination.trim()) {
      onError('Informe origem e destino')
      return
    }
    if (!modes.length) { onError('Escolha ao menos um meio de transporte'); return }
    setSearching(true)
    setResult(null)
    setSelected(0)
    try {
      const data = await api.routes({
        origin: form.origin.trim(),
        destination: form.destination.trim(),
        modes: modes.join(','),
        ...(form.date ? { date: form.date } : {})
      })
      setResult(data)
      setRecents((prev) => [{ provider: 'google', origin: form.origin.trim(), destination: form.destination.trim(), date: form.date, at: Date.now() }, ...prev.filter((r) => !(r.origin === form.origin.trim() && r.destination === form.destination.trim()))].slice(0, 6))
    } catch (err) {
      onError(err.message)
    } finally {
      setSearching(false)
    }
  }

  const tagOf = (r) => `google|${r.mode}|${r.originName}→${r.destinationName}|${r.durationMin}|${r.distanceKm}`

  const saveRoute = async (r) => {
    if (!tripId) { onError('Selecione a viagem onde salvar esta rota'); return }
    const modeMap = { DRIVE: 'carro', TRANSIT: 'trem', WALK: 'onibus', BICYCLE: 'carro', FLIGHT: 'aviao' }
    try {
      await api.addQuote(Number(tripId), {
        mode: modeMap[r.mode] || 'outro',
        from: r.originName, to: r.destinationName,
        company: `Google Rotas · ${r.label}`,
        price: 0,
        date: form.date || undefined,
        notes: [
          `${fmtDuration(r.durationMin)} · ${r.distanceKm} km`,
          r.legs?.length > 1 && `${r.legs.length} trechos (${r.legs.map((l) => l.label.split(' ')[0]).join('+')})`,
          r.trafficDelayMin > 0 && `trânsito +${r.trafficDelayMin}min`,
          r.fallbackStraightLine && 'estimativa linha reta',
          'Fonte: Google Routes'
        ].filter(Boolean).join(' · '),
        durationMin: r.durationMin,
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        source: 'google-routes'
      })
      setSavedTags((prev) => [...prev, tagOf(r)])
      onSaved?.()
    } catch (err) { onError(err.message) }
  }

  const swap = () => setForm((f) => ({ ...f, origin: f.destination, destination: f.origin }))
  const applyRecent = (r) => { setForm({ origin: r.origin, destination: r.destination, date: r.date }); setResult(null) }

  const activeTrips = trips.filter((t) => t.status !== 'concluida')
  const best = result?.routes?.[0]

  return (
    <section>
      <h1>🔎 Rotas & deslocamentos</h1>
      <p className="muted">
        Tempos, distâncias e rotas reais do Google Maps para qualquer lugar do mundo — carro,
        trem/transporte público, a pé, bicicleta ou voo. Salve a opção escolhida na sua viagem
        e, quando comprar, lance nos gastos com um clique.
      </p>

      {googleReady === false && (
        <div className="card panel warn-panel">
          ⚠️ <strong>Chave do Google não configurada.</strong> Abra o arquivo{' '}
          <code>server/.env</code>, adicione <code>GOOGLE_MAPS_API_KEY=sua_chave</code> e reinicie o servidor.
          Seus dados continuam funcionando offline normalmente.
        </div>
      )}

      <div className="card panel">
        <form className="quote-form" onSubmit={runSearch}>
          <PlaceInput placeholder="Origem (ex.: São Paulo, Torre Eiffel, Aeroporto de Lisboa)" value={form.origin} onChange={(v) => setForm((f) => ({ ...f, origin: v }))} />
          <span className="arrow">→</span>
          <button type="button" className="btn-small swap" title="Inverter origem e destino" onClick={swap}>⇄</button>
          <PlaceInput placeholder="Destino" value={form.destination} onChange={(v) => setForm((f) => ({ ...f, destination: v }))} />
          <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} title="Data/hora da partida (opcional)" />
          <button className="btn-primary" disabled={searching}>
            {searching ? '⏳ Consultando Google…' : '🔍 Buscar rotas'}
          </button>
        </form>

        <div className="mode-chips">
          {ROUTE_MODES.map((m) => (
            <button key={m.key} type="button" className={`chip ${modes.includes(m.key) ? 'chip-on' : ''}`} onClick={() => toggleMode(m.key)}>{m.label}</button>
          ))}
        </div>

        {recents.length > 0 && (
          <div className="recent-chips">
            <span className="cat">🕘 Recentes:</span>
            {recents.map((r, i) => (
              <button key={i} className="chip" onClick={() => applyRecent(r)}>
                🧭 {r.origin.split(',')[0]} → {r.destination.split(',')[0]}
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
                <option key={t.id} value={t.id}>{t.title}{t.destination ? ` (${t.destination})` : ''}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {result && (
        <div className="card panel">
          <h2>🧭 {result.origin} → {result.destination}</h2>
          {best && <p className="muted small-text">⏱️ Mais rápido: <strong>{best.label}</strong> · {fmtDuration(best.durationMin)} · {best.distanceKm} km</p>}
          <div className="route-tabs">
            {(result.routes || []).map((r, i) => (
              <button key={i} className={`provider-tab ${selected === i ? 'active' : ''}`} onClick={() => setSelected(i)}>
                {r.label}<br /><small>{fmtDuration(r.durationMin)}</small>
              </button>
            ))}
          </div>
          {result.errors?.map((er, i) => <p key={i} className="muted small-text">⚠️ {er}</p>)}

          {result.routes?.[selected] && (() => {
            const r = result.routes[selected]
            const tag = tagOf(r)
            return (
              <div className="route-detail">
                <RouteMap route={r} originLocation={result.originLocation} destinationLocation={result.destinationLocation} />
                <div className="route-stats">
                  <span>⏱️ <strong>{fmtDuration(r.durationMin)}</strong></span>
                  <span>📏 <strong>{r.distanceKm} km</strong></span>
                  {r.departureTime && <span>🛫 saída {new Date(r.departureTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
                  {r.arrivalTime && <span>🏁 chegada {new Date(r.arrivalTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
                  {r.trafficDelayMin > 0 && <span>🚦 trânsito +{r.trafficDelayMin}min</span>}
                  {r.tolls && <span>🛑 pedágio ~{(r.tolls.amountMicros / 1_000_000).toFixed(2)} {r.tolls.currency}</span>}
                </div>
                {r.fallbackStraightLine && (
                  <p className="ac-note">ℹ️ Estimativa teórica de voo direto (linha reta + check-in). Para preços reais de passagens, registre a cotação após consultar um buscador de voos.</p>
                )}
                {r.legs?.length > 1 && (
                  <ul className="route-legs">
                    {r.legs.map((l, i) => (
                      <li key={i}><span className="cat">{l.label}</span> {fmtDuration(l.durationMin)} · {l.distanceKm} km</li>
                    ))}
                  </ul>
                )}
                {savedTags.includes(tag) ? (
                  <span className="badge-ok">✅ salva na viagem</span>
                ) : (
                  <button className="btn-primary" onClick={() => saveRoute(r)}>＋ Salvar rota na viagem</button>
                )}
              </div>
            )
          })()}
          {(!result.routes || result.routes.length === 0) && (
            <p className="muted">Nenhuma rota encontrada para os modos selecionados.</p>
          )}
        </div>
      )}

      <div className="card panel">
        <h2>💡 Dica</h2>
        <p className="muted small-text">
          Rotas salvas aparecem na aba 🚌 Transporte de cada viagem. Ao clicar em “💰 Comprei!”,
          o valor entra automaticamente nos gastos. O mapa precisa de internet; suas viagens,
          gastos e ingressos continuam acessíveis offline.
        </p>
      </div>
    </section>
  )
}
