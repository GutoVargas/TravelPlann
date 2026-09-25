import { useState } from 'react'
import { api, STATUSES } from '../api.js'

const empty = {
  title: '', destination: '', startDate: '', endDate: '',
  budget: '', status: 'planejando', notes: ''
}

export default function TripForm({ trip, onSaved, onCancel }) {
  const [form, setForm] = useState(trip ? { ...trip, budget: trip.budget || '' } : empty)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return setError('Informe um título para a viagem.')
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      return setError('A data de retorno não pode ser anterior à de ida.')
    }
    setSaving(true)
    setError('')
    const payload = { ...form, budget: Number(form.budget) || 0 }
    delete payload.expenses
    delete payload.spent
    delete payload.id
    delete payload.createdAt
    try {
      if (trip) await api.updateTrip(trip.id, payload)
      else await api.createTrip(payload)
      onSaved()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <section className="form-wrap">
      <h1>{trip ? '✏️ Editar Viagem' : '✈️ Nova Viagem'}</h1>
      <form className="card form" onSubmit={submit}>
        {error && <div className="toast error inline">⚠️ {error}</div>}

        <label>Título *
          <input value={form.title} onChange={set('title')} placeholder="Ex.: Férias em Portugal" autoFocus />
        </label>

        <label>Destino
          <input value={form.destination || ''} onChange={set('destination')} placeholder="Ex.: Lisboa, Portugal" />
        </label>

        <div className="grid-2">
          <label>Data de ida
            <input type="date" value={form.startDate} onChange={set('startDate')} />
          </label>
          <label>Data de volta
            <input type="date" value={form.endDate} onChange={set('endDate')} />
          </label>
        </div>

        <div className="grid-2">
          <label>Orçamento (R$)
            <input type="number" min="0" step="0.01" value={form.budget} onChange={set('budget')} placeholder="Ex.: 8000" />
          </label>
          <label>Status
            <select value={form.status} onChange={set('status')}>
              {Object.entries(STATUSES).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label>Notas / roteiro
          <textarea rows="4" value={form.notes || ''} onChange={set('notes')} placeholder="Hotéis, passagens, dicas, checklist…" />
        </label>

        <div className="actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Salvando…' : trip ? 'Salvar alterações' : 'Criar viagem'}
          </button>
        </div>
      </form>
    </section>
  )
}
