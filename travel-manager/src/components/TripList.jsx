import { useState } from 'react'
import { brl, fmtDate, STATUSES } from '../api.js'

export default function TripList({ trips, onOpen, onEdit, onDelete, onNew }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('todas')

  const filtered = trips.filter((t) => {
    const text = (t.title + ' ' + t.destination).toLowerCase()
    if (q && !text.includes(q.toLowerCase())) return false
    if (status !== 'todas' && t.status !== status) return false
    return true
  })

  return (
    <section>
      <div className="row-between">
        <h1>Minhas Viagens <span className="muted small">({trips.length})</span></h1>
      </div>

      <div className="filters">
        <input
          placeholder="🔍 Buscar por título ou destino…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="todas">Todas</option>
          {Object.entries(STATUSES).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <p>{trips.length === 0 ? 'Nenhuma viagem cadastrada ainda.' : 'Nada encontrado com esses filtros.'}</p>
          {trips.length === 0 && <button className="btn-primary" onClick={onNew}>✈️ Criar primeira viagem</button>}
        </div>
      ) : (
        <div className="trip-grid">
          {filtered.map((t) => {
            const pct = t.budget > 0 ? Math.min(100, (t.spent / t.budget) * 100) : 0
            const over = t.budget > 0 && t.spent > t.budget
            return (
              <article className="card trip-card" key={t.id} onClick={() => onOpen(t.id)}>
                <div className="trip-head">
                  <h3>{t.title}</h3>
                  <span className={`badge ${t.status}`}>{STATUSES[t.status].icon} {STATUSES[t.status].label}</span>
                </div>
                <p className="muted">
                  📍 {t.destination || 'destino a definir'}
                  {t.startDate && <> · 🗓️ {fmtDate(t.startDate)}{t.endDate && ` → ${fmtDate(t.endDate)}`}</>}
                </p>
                <div className="progress-wrap">
                  <div className="progress"><div className={`bar ${over ? 'red' : ''}`} style={{ width: `${t.budget > 0 ? pct : (t.spent > 0 ? 100 : 0)}%` }} /></div>
                  <div className="progress-label">
                    <span className={over ? 'over' : ''}>{brl(t.spent)}</span>
                    <span className="muted small">{t.budget > 0 ? `de ${brl(t.budget)}` : 'sem orçamento definido'}</span>
                  </div>
                </div>
                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="link" onClick={() => onEdit(t)}>✏️ Editar</button>
                  <button className="link danger" onClick={() => onDelete(t)}>🗑️ Excluir</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
