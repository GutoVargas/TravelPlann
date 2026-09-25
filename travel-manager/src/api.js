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

// Lê um File como data URL (base64) para envio à API
export const readFileAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo'))
    fr.readAsDataURL(file)
  })

export const api = {
  stats: () => request('/stats'),
  searchTransport: (params) => {
    const q = new URLSearchParams(params).toString()
    return request(`/search-transport?${q}`)
  },
  searchTrains: (params) => {
    const q = new URLSearchParams(params).toString()
    return request(`/search-trains?${q}`)
  },
  listTrips: () => request('/trips'),
  getTrip: (id) => request(`/trips/${id}`),
  createTrip: (trip) => request('/trips', { method: 'POST', body: JSON.stringify(trip) }),
  updateTrip: (id, trip) => request(`/trips/${id}`, { method: 'PUT', body: JSON.stringify(trip) }),
  deleteTrip: (id) => request(`/trips/${id}`, { method: 'DELETE' }),
  addExpense: (tripId, exp) => request(`/trips/${tripId}/expenses`, { method: 'POST', body: JSON.stringify(exp) }),
  updateExpense: (tripId, eid, exp) => request(`/trips/${tripId}/expenses/${eid}`, { method: 'PUT', body: JSON.stringify(exp) }),
  deleteExpense: (tripId, eid) => request(`/trips/${tripId}/expenses/${eid}`, { method: 'DELETE' }),
  // cotações de transporte
  listQuotes: (tripId) => request(`/trips/${tripId}/quotes`),
  addQuote: (tripId, q) => request(`/trips/${tripId}/quotes`, { method: 'POST', body: JSON.stringify(q) }),
  updateQuote: (tripId, qid, q) => request(`/trips/${tripId}/quotes/${qid}`, { method: 'PUT', body: JSON.stringify(q) }),
  deleteQuote: (tripId, qid) => request(`/trips/${tripId}/quotes/${qid}`, { method: 'DELETE' }),
  convertQuote: (tripId, qid) => request(`/trips/${tripId}/quotes/${qid}/convert`, { method: 'POST' }),
  // documentos (ingressos, passagens, comprovantes)
  listDocs: (tripId) => request(`/trips/${tripId}/docs`),
  getDoc: (tripId, did) => request(`/trips/${tripId}/docs/${did}`),
  uploadDoc: (tripId, doc) => request(`/trips/${tripId}/docs`, { method: 'POST', body: JSON.stringify(doc) }),
  deleteDoc: (tripId, did) => request(`/trips/${tripId}/docs/${did}`, { method: 'DELETE' })
}

export const TRANSPORT_MODES = {
  aviao: { label: '✈️ Avião' },
  onibus: { label: '🚌 Ônibus' },
  carro: { label: '🚗 Carro / aluguel' },
  trem: { label: '🚆 Trem / metrô' },
  barco: { label: '⛴️ Barco / balsa' },
  voo_interno: { label: '🛩️ Voo interno' },
  metro: { label: '🚇 Metrô' },
  bus_uefa: { label: '🚍 Ônibus urbano (Europa)' },
  transfer: { label: '🚐 Transfer / táxi' },
  travessia: { label: '⛴️ Travessia de balsa' },
  outro: { label: '🧭 Outro' }
}

export const DOC_TYPES = {
  passagem: { label: '🎫 Passagem' },
  ingresso: { label: '🎟️ Ingresso' },
  comprovante: { label: '🧾 Comprovante' },
  reserva: { label: '🏨 Reserva' },
  outro: { label: '📎 Outro' }
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
