import { useEffect, useState } from 'react'
import { subscribeOffline, syncNow, apiFetch } from './offlineBridge.js'

// Banner de status offline-first: conectado/sincronizado/offline/fila pendente.
export default function OfflineBanner() {
  const [st, setSt] = useState({ online: navigator.onLine, syncing: false, pending: 0, lastSync: null, error: null })
  useEffect(() => subscribeOffline(setSt), [])

  const cls = !st.online ? 'offline' : st.error ? 'error' : st.pending ? 'pending' : 'online'
  const label = !st.online
    ? `📴 Offline — alterações salvas no aparelho${st.pending ? ` (${st.pending} na fila)` : ''}`
    : st.syncing
      ? '🔄 Sincronizando…'
      : st.error
        ? `⚠️ ${st.error}`
        : st.pending
          ? `☁️ Enviando ${st.pending} mudança(s) pendente(s)…`
          : `✅ Sincronizado${st.lastSync ? ` · ${new Date(st.lastSync).toLocaleTimeString('pt-BR')}` : ''}`

  return (
    <div className={`offline-banner ${cls}`} title="Clique para sincronizar agora">
      <span>{label}</span>
      {st.online && (
        <button onClick={() => syncNow(apiFetch)}>↻</button>
      )}
    </div>
  )
}
