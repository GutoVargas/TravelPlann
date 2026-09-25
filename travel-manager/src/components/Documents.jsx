import { useRef, useState } from 'react'
import { api, readFileAsDataURL, DOC_TYPES } from '../api.js'

const MAX_MB = 3.5

// Upload e arquivo dos documentos (ingressos, passagens, comprovantes...) da viagem
export default function Documents({ tripId, docs, expenses = [], onChanged, onError }) {
  const [type, setType] = useState('ingresso')
  const [expenseId, setExpenseId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(null) // doc completo em visualização
  const inputRef = useRef(null)

  const tripDocs = docs || []

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setUploading(true)
    try {
      for (const file of files) {
        if (file.size > MAX_MB * 1024 * 1024) {
          throw new Error(`"${file.name}" é maior que ${MAX_MB} MB`)
        }
        const dataUrl = await readFileAsDataURL(file)
        await api.uploadDoc(tripId, {
          name: file.name,
          type,
          data: dataUrl,
          expenseId: expenseId ? Number(expenseId) : null
        })
      }
      await onChanged()
    } catch (err) { onError(err.message) } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const openDoc = async (id) => {
    try {
      const meta = await api.getDoc(tripId, id)
      setPreview({ ...meta, url: `/api/trips/${tripId}/docs/${id}/file` })
    } catch (err) { onError(err.message) }
  }

  const removeDoc = async (id) => {
    if (!confirm('Excluir este documento?')) return
    try { await api.deleteDoc(tripId, id); await onChanged() }
    catch (err) { onError(err.message) }
  }

  const fmtSize = (bytes) => bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

  return (
    <div className="card panel">
      <h2>🎟️ Ingressos & Documentos ({tripDocs.length})</h2>
      <p className="muted small-text">
        Suba a foto ou PDF do ingresso/passagem para deixar salvo no app e não perder na hora.
      </p>

      <div className="doc-controls">
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={expenseId} onChange={(e) => setExpenseId(e.target.value)}>
          <option value="">Vincular a um gasto (opcional)</option>
          {expenses.map((ex) => (
            <option key={ex.id} value={ex.id}>{ex.description}</option>
          ))}
        </select>
      </div>

      <label className={`dropzone ${uploading ? 'busy' : ''}`}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? '⏳ Enviando…' : '📤 Toque para escolher imagem ou PDF'}
      </label>

      {tripDocs.length === 0 && !uploading && <p className="muted">Nenhum documento salvo ainda.</p>}
      <ul className="docs">
        {tripDocs.map((d) => (
          <li key={d.id}>
            <span className="cat">{DOC_TYPES[d.type]?.label || d.type}</span>
            <div className="exp-desc">
              <strong title={d.name}>{d.name}</strong>
              <span className="muted small">{fmtSize(d.size)}</span>
            </div>
            <button className="btn-small" onClick={() => openDoc(d.id)}>👁️ Ver</button>
            <a
              className="btn-small"
              href={`/api/trips/${tripId}/docs/${d.id}/file`}
              target="_blank" rel="noreferrer"
              title="Abrir em nova aba"
            >↗</a>
            <button className="icon-btn" title="Excluir" onClick={() => removeDoc(d.id)}>🗑️</button>
          </li>
        ))}
      </ul>

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{preview.name}</strong>
              <div>
                <a className="btn-small" href={preview.url} download={preview.name}>⬇️ Baixar</a>
                <button className="icon-btn" onClick={() => setPreview(null)}>✖️</button>
              </div>
            </div>
            {preview.mimeType === 'application/pdf' ? (
              <iframe title={preview.name} src={preview.url} className="pdf-viewer" />
            ) : (
              <img src={preview.url} alt={preview.name} className="doc-img" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
