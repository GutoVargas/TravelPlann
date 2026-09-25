import { useEffect, useState, useCallback } from 'react'
import { api, initOffline } from './api.js'
import OfflineBanner from './components/OfflineBanner.jsx'
import Dashboard from './components/Dashboard.jsx'
import TripList from './components/TripList.jsx'
import TripForm from './components/TripForm.jsx'
import TripDetail from './components/TripDetail.jsx'
import GlobalSearch from './components/GlobalSearch.jsx'

export default function App() {
  const [trips, setTrips] = useState([])
  const [stats, setStats] = useState(null)
  const [view, setView] = useState('dashboard') // dashboard | trips | form | detail | search
  const [editing, setEditing] = useState(null) // trip em edição
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.listTrips(), api.stats()])
      setTrips(t)
      setStats(s)
      setError('')
    } catch (e) {
      setError('Não foi possível conectar à API: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // bootstrap offline-first: snapshot inicial + sync automática em background
    initOffline().finally(refresh)
    const t = setInterval(refresh, 15000) // re-renderiza quando a sync local mudar
    return () => clearInterval(t)
  }, [refresh])

  const openNew = () => { setEditing(null); setView('form') }
  const openEdit = (trip) => { setEditing(trip); setView('form') }
  const openDetail = (id) => { setSelectedId(id); setView('detail') }

  const handleDelete = async (trip) => {
    if (!confirm(`Excluir a viagem "${trip.title}" e todos os seus gastos?`)) return
    try {
      await api.deleteTrip(trip.id)
      await refresh()
      if (view === 'detail') setView('trips')
    } catch (e) { setError(e.message) }
  }

  const selected = trips.find((t) => t.id === selectedId)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setView('dashboard')}>✈️ Viaja<span>+</span></div>
        <nav>
          <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Visão Geral</button>
          <button className={view === 'trips' || view === 'detail' ? 'active' : ''} onClick={() => setView('trips')}>Viagens</button>
          <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}>🔎 Buscar transporte</button>
          <button className="btn-primary" onClick={openNew}>+ Nova Viagem</button>
        </nav>
      </header>

      <OfflineBanner />
      {error && <div className="toast error" onClick={() => setError('')}>⚠️ {error}</div>}

      <main>
        {loading && <p className="muted center">Carregando…</p>}

        {!loading && view === 'dashboard' && (
          <Dashboard stats={stats} trips={trips} onOpen={openDetail} onNew={openNew} />
        )}

        {!loading && view === 'trips' && (
          <TripList trips={trips} onOpen={openDetail} onEdit={openEdit} onDelete={handleDelete} onNew={openNew} />
        )}

        {!loading && view === 'search' && (
          <GlobalSearch trips={trips} onError={setError} onSaved={refresh} />
        )}

        {view === 'form' && (
          <TripForm
            trip={editing}
            onSaved={async () => { await refresh(); setView('trips') }}
            onCancel={() => setView(editing ? 'trips' : 'dashboard')}
          />
        )}

        {view === 'detail' && selectedId && (
          <TripDetail
            key={selectedId}
            tripId={selectedId}
            onBack={() => setView('trips')}
            onEdit={() => openEdit(selected)}
            onChangedTrip={refresh}
          />
        )}
      </main>

      <footer className="footer">Viaja+ — organize roteiros, controle gastos e aproveite a viagem 🌍</footer>
    </div>
  )
}
