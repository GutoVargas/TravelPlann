import { useMemo, useState } from 'react'
import { api, brl, fmtDate, CATEGORIES, STATUSES } from '../api.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function TripDetail({ trip, onBack, onEdit, onChanged }) {
  const [expForm, setExpForm] = useState({ description: '', category: 'transporte', amount: '', date: today() })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const byCategory = useMemo(() => {
    const map = {}
    for (const e of trip.expenses) map[e.category] = (map[e.category] || 0) + Number(e.amount)
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [trip.expenses])

  const remaining = trip.budget - trip.spent
  const pct = trip.budget > 0 ? Math.min(100, (trip.spent / trip.budget) * 100) : 0
  const over = trip.budget > 0 && trip.spent > trip.budget

  const addExpense = async (e) => {
    e.preventDefault()
    if (!expForm.description.trim() || !Number(expForm.amount)) return
    setBusy(true); setError('')
    try {
      await api.addExpense(trip.id, { ...expForm, amount: Number(expForm.amount) })
      setExpForm({ description: '', category: expForm.category, amount: '', date: today() })
      await onChanged()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const removeExpense = async (id) => {
    setBusy(true)
    try { await api.deleteExpense(trip.id, id); await onChanged() }
    catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const changeStatus = async (status) => {
    try { await api.updateTrip(trip.id, { status }); await onChanged() }
    catch (err) { setError(err.message) }
  }

  const sorted = [...trip.expenses].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <section>
      <button className="btn-ghost small" onClick={onBack}>← Voltar</button>
      {error && <div className="toast error inline">⚠️ {error}</div>}

      <div className="detail-head card">
        <div>
          <h1>{trip.title}</h1>
          <p className="muted">
            📍 {trip.destination || 'destino a definir'}
            {trip.startDate && <> · 🗓️ {fmtDate(trip.startDate)}{trip.endDate && ` → ${fmtDate(trip.endDate)}`}</>}
          </p>
        </div>
        <div className="detail-actions">
          <select value={trip.status} onChange={(e) => changeStatus(e.target.value)}>
            {Object.entries(STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={onEdit}>✏️ Editar</button>
        </div>
      </div>

      <div className="cards">
        <div className="card stat"><span className="stat-num">{brl(trip.budget)}</span><span className="stat-label">orçamento</span></div>
        <div className="card stat"><span className="stat-num">{brl(trip.spent)}</span><span className="stat-label">gasto até agora</span></div>
        <div className="card stat">
          <span className={`stat-num ${over ? 'over' : 'ok'}`}>{brl(Math.abs(remaining))}</span>
          <span className="stat-label">{remaining >= 0 ? 'disponível' : 'acima do orçamento 😬'}</span>
        </div>
      </div>

      {trip.budget > 0 && (
        <div className="progress big"><div className={`bar ${over ? 'red' : ''}`} style={{ width: `${pct}%` }} /></div>
      )}

      <div className="two-cols">
        <div className="card panel">
          <h2>💳 Gastos ({trip.expenses.length})</h2>
          <form className="expense-form" onSubmit={addExpense}>
            <input
              placeholder="Descrição (ex.: voo GRU→LIS)"
              value={expForm.description}
              onChange={(e) => setExpForm((f) => ({ ...f, description: e.target.value }))}
            />
            <select value={expForm.category} onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))}>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input
              type="number" min="0.01" step="0.01" placeholder="Valor R$"
              value={expForm.amount}
              onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <input type="date" value={expForm.date} onChange={(e) => setExpForm((f) => ({ ...f, date: e.target.value }))} />
            <button className="btn-primary" disabled={busy}>+ Add</button>
          </form>

          {sorted.length === 0 && <p className="muted">Nenhum gasto registrado. Some os primeiros acima 👆</p>}
          <ul className="expenses">
            {sorted.map((e) => (
              <li key={e.id}>
                <span className="cat">{CATEGORIES[e.category]?.label || e.category}</span>
                <div className="exp-desc">
                  <strong>{e.description}</strong>
                  <span className="muted small">{fmtDate(e.date)}</span>
                </div>
                <span className="money">{brl(e.amount)}</span>
                <button className="icon-btn" title="Excluir" onClick={() => removeExpense(e.id)}>🗑️</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card panel">
          <h2>📊 Resumo por categoria</h2>
          {byCategory.length === 0 && <p className="muted">Adicione gastos para ver o resumo.</p>}
          {byCategory.map(([cat, val]) => {
            const p = trip.spent > 0 ? (val / trip.spent) * 100 : 0
            return (
              <div key={cat} className="cat-row">
                <div className="cat-head">
                  <span>{CATEGORIES[cat]?.label || cat}</span>
                  <span className="money">{brl(val)}</span>
                </div>
                <div className="progress"><div className="bar blue" style={{ width: `${p}%` }} /></div>
              </div>
            )
          })}

          {trip.notes && (
            <>
              <h2>📝 Notas / Roteiro</h2>
              <p className="notes">{trip.notes}</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
