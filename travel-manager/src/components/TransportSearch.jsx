import { useState } from 'react'
import { api, brl, fmtDate, TRANSPORT_MODES } from '../api.js'

function fmtDuration(min) {
  if (min == null) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}min`
}

// Busca/comparação de meios de transporte para o destino da viagem.
// - Busca REAL de ônibus via HaFFas (preço + horário + duração)
// - Cotações manuais para qualquer tipo de transporte
// As cotações ficam salvas na viagem e podem ser convertidas em gasto ("Comprei!").
export default function TransportSearch({ trip, quotes, onAdd, onUpdate, onDelete, onError }) {
  const [form, setForm] = useState({
    mode: 'aviao',
    from: '',
    to: trip.destination || '',
    company: '',
    price: '',
    date: trip.startDate || '',
    notes: ''
  })
  const [busy, setBusy] = useState(false)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)
  const [addedUrls, setAddedUrls] = useState([])
  const [searchForm, setSearchForm] = useState({
    origin: '',
    destination: trip.destination || '',
    date: trip.startDate || ''
  })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.from.trim() && !form.to.trim()) {
      onError('Informe a origem ou o destino da cotação')
      return
    }
    setBusy(true)
    try {
      await onAdd({ ...form, price: Number(form.price) || 0 })
      setForm((f) => ({ ...f, from: '', company: '', price: '', notes: '' }))
    } catch (err) { onError(err.message) } finally { setBusy(false) }
  }

  const sortedQuotes = [...quotes].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date)
    return (a.price || 0) - (b.price || 0)
  })

  const cheapest = quotes.filter((q) => q.price > 0).sort((a, b) => a.price - b.price)[0]
  const totalEstimate = quotes.reduce((s, q) => s + (Number(q.price) || 0), 0)

  // ---- Busca real de ônibus (HaFFas / BuscaPassagem) ----
  const setSearch = (k) => (e) => setSearchForm((f) => ({ ...f, [k]: e.target.value }))

  const runSearch = async (e) => {
    e.preventDefault()
    if (!searchForm.origin.trim() || !searchForm.destination.trim() || !searchForm.date) {
      onError('Preencha origem, destino e data para buscar')
      return
    }
    setSearching(true)
    setResults(null)
    try {
      const data = await api.searchTransport({
        origin: searchForm.origin.trim(),
        destination: searchForm.destination.trim(),
        date: searchForm.date
      })
      setResults(data.results || [])
    } catch (err) {
      onError(err.message)
    } finally { setSearching(false) }
  }

  const alreadySaved = (r) =>
    addedUrls.includes(r.url || `${r.company}|${r.departureTime}|${r.price}`)

  const saveResult = async (r) => {
    const tag = r.url || `${r.company}|${r.departureTime}|${r.price}`
    try {
      await onAdd({
        mode: 'onibus',
        from: r.from, to: r.to,
        company: r.company,
        price: r.price,
        date: r.date,
        notes: [
          r.busType && `Ônibus ${r.busType}`,
          r.departureTime && `saída ${r.departureTime}`,
          r.arrivalTime && `chegada ${r.arrivalTime}`,
          r.durationMin != null && `duração ${fmtDuration(r.durationMin)}`,
          'Fonte: HaFFas'
        ].filter(Boolean).join(' · '),
        busType: r.busType,
        departureTime: r.departureTime,
        arrivalTime: r.arrivalTime,
        durationMin: r.durationMin,
        source: 'haffas',
        url: r.url
      })
      setAddedUrls((prev) => [...prev, tag])
    } catch (err) { onError(err.message) }
  }

  return (
    <div className="card panel">
      <h2>🚌 Buscar transporte para o destino</h2>
      <p className="muted small-text">
        Compare opções (avião, ônibus, trem…) e salve as cotações. Quando comprar, clique em
        “💰 Comprei!” para lançar o valor automaticamente nos gastos.
      </p>

      {/* Busca REAL de ônibus via HaFFas */}
      <form className="quote-form" onSubmit={runSearch}>
        <span className="cat">🔎 Tempos &amp; preços reais — ônibus (HaFFas)</span>
        <input
          placeholder="Cidade de origem (ex.: São Paulo)"
          value={searchForm.origin} onChange={setSearch('origin')}
        />
        <span className="arrow">→</span>
        <input
          placeholder="Cidade de destino"
          value={searchForm.destination} onChange={setSearch('destination')}
        />
        <input type="date" value={searchForm.date} onChange={setSearch('date')} title="Data da viagem" />
        <button className="btn-primary" disabled={searching}>
          {searching ? '⏳ Buscando…' : '🚌 Buscar ônibus'}
        </button>
      </form>

      {results !== null && results.length > 0 && (
        <ul className="quotes search-results">
          {results.map((r, i) => {
            const tag = r.url || `${r.company}|${r.departureTime}|${r.price}`
            return (
              <li key={i}>
                <span className="cat">🚌 {r.company || 'Viação'}</span>
                <div className="exp-desc">
                  <strong>{r.departureTime || '?'} → {r.arrivalTime || '?'}{r.durationMin != null && ` (${fmtDuration(r.durationMin)})`}</strong>
                  <span className="muted small">
                    {r.from} → {r.to}{r.busType && ` · ${r.busType}`}
                  </span>
                </div>
                <span className="quote-price-static"><strong>{brl(r.price)}</strong></span>
                {alreadySaved(r) ? (
                  <span className="badge-ok">✅ salva</span>
                ) : (
                  <button className="btn-small" onClick={() => saveResult(r)}>＋ Salvar cotação</button>
                )}
                {r.url && (
                  <a className="btn-small link" href={r.url} target="_blank" rel="noreferrer" title="Comprar no site">🛒</a>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <details className="manual-quote">
        <summary>➕ Registrar cotação manualmente (avião, trem, carro…)</summary>
        <form className="quote-form" onSubmit={submit}>
          <select value={form.mode} onChange={set('mode')}>
            {Object.entries(TRANSPORT_MODES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input placeholder="Origem (ex.: São Paulo)" value={form.from} onChange={set('from')} />
          <span className="arrow">→</span>
          <input placeholder="Destino" value={form.to} onChange={set('to')} />
          <input placeholder="Companhia (ex.: LATAM, Azul, 12Bis)" value={form.company} onChange={set('company')} />
          <input type="date" value={form.date} onChange={set('date')} title="Data da viagem" />
          <input
            type="number" min="0" step="0.01" placeholder="Preço R$"
            value={form.price} onChange={set('price')}
          />
          <button className="btn-primary" disabled={busy}>🔍 Salvar cotação</button>
        </form>
      </details>

      {sortedQuotes.length === 0 ? (
        <p className="muted">Nenhuma cotação salva ainda. Use a busca de ônibus acima 👆 ou registre manualmente (avião, trem…).</p>
      ) : (
        <>
          <div className="quote-summary">
            <span>{sortedQuotes.length} cotação(ões)</span>
            {cheapest && <span>· Melhor preço: <strong>{brl(cheapest.price)}</strong></span>}
            <span>· Total estimado: <strong>{brl(totalEstimate)}</strong></span>
          </div>
          <ul className="quotes">
            {sortedQuotes.map((q) => (
              <li key={q.id} className={q.purchased ? 'purchased' : ''}>
                <span className="cat">{TRANSPORT_MODES[q.mode]?.label || q.mode}</span>
                <div className="exp-desc">
                  <strong>{q.from || '?'} → {q.to || '?'}</strong>
                  <span className="muted small">
                    {q.company || 'companhia não informada'}
                    {q.date && ` · ${fmtDate(q.date)}`}
                    {q.notes && ` · ${q.notes}`}
                  </span>
                </div>
                <input
                  className="quote-price"
                  type="number" min="0" step="0.01"
                  defaultValue={q.price || ''}
                  placeholder="R$"
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== q.price) onUpdate(q.id, { price: v || 0 }).catch((err) => onError(err.message))
                  }}
                />
                {q.purchased ? (
                  <span className="badge-ok">✅ comprada</span>
                ) : (
                  <button
                    className="btn-small"
                    title="Lançar como gasto na viagem"
                    onClick={() => onUpdate(q.id, { purchased: true }).catch((err) => onError(err.message))}
                  >💰 Comprei!</button>
                )}
                <button className="icon-btn" title="Excluir cotação" onClick={() => onDelete(q.id)}>🗑️</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
