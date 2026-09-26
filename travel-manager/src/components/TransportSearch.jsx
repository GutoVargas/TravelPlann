import { useState } from 'react'
import { api, brl, fmtDate, TRANSPORT_MODES } from '../api.js'

// Cotações da viagem: registro manual (qualquer modal) + atalho para a tela
// global de rotas do Google. "💰 Comprei!" lança o valor nos gastos.
export default function TransportSearch({ trip, quotes, onAdd, onUpdate, onDelete, onError }) {
  const [form, setForm] = useState({
    mode: 'aviao',
    from: trip.origin || '',
    to: trip.destination || '',
    company: '',
    price: '',
    date: trip.startDate || '',
    notes: ''
  })
  const [busy, setBusy] = useState(false)

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
      setForm((f) => ({ ...f, company: '', price: '', notes: '' }))
    } catch (err) { onError(err.message) } finally { setBusy(false) }
  }

  const sortedQuotes = [...quotes].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date)
    return (a.price || 0) - (b.price || 0)
  })

  const cheapest = quotes.filter((q) => q.price > 0).sort((a, b) => a.price - b.price)[0]
  const totalEstimate = quotes.reduce((s, q) => s + (Number(q.price) || 0), 0)

  return (
    <div className="card panel">
      <h2>🚌 Transporte deste destino</h2>
      <p className="muted small-text">
        Compare opções e salve cotações. Use a tela 🔎 Rotas & deslocamentos (menu lateral) para
        buscar tempos, distâncias e mapas reais do Google — e salvar o resultado aqui. Quando
        comprar, clique em “💰 Comprei!” para lançar o valor automaticamente nos gastos.
      </p>

      <details className="manual-quote" open={sortedQuotes.length === 0}>
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
        <p className="muted">Nenhuma cotação salva ainda. Busque rotas na tela 🔎 Rotas &amp; deslocamentos ou registre manualmente acima 👆.</p>
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
