// Cliente HTTP da API
const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data
}

export const api = {
  stats: () => request('/stats'),
  listTrips: () => request('/trips'),
  getTrip: (id) => request(`/trips/${id}`),
  createTrip: (trip) => request('/trips', { method: 'POST', body: JSON.stringify(trip) }),
  updateTrip: (id, trip) => request(`/trips/${id}`, { method: 'PUT', body: JSON.stringify(trip) }),
  deleteTrip: (id) => request(`/trips/${id}`, { method: 'DELETE' }),
  addExpense: (tripId, exp) => request(`/trips/${tripId}/expenses`, { method: 'POST', body: JSON.stringify(exp) }),
  updateExpense: (tripId, eid, exp) => request(`/trips/${tripId}/expenses/${eid}`, { method: 'PUT', body: JSON.stringify(exp) }),
  deleteExpense: (tripId, eid) => request(`/trips/${tripId}/expenses/${eid}`, { method: 'DELETE' })
}

export const CATEGORIES = {
  transporte: { label: '🚗 Transporte' },
  hospedagem: { label: '🏨 Hospedagem' },
  alimentacao: { label: '🍽️ Alimentação' },
  passeios: { label: '🎟️ Passeios' },
  compras: { label: '🛍️ Compras' },
  outros: { label: '📦 Outros' }
}

export const STATUSES = {
  planejando: { label: 'Planejando', icon: '📝' },
  andando: { label: 'Andando', icon: '🧳' },
  concluida: { label: 'Concluída', icon: '✅' }
}

export const brl = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmtDate = (iso) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
