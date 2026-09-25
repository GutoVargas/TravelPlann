// Controllers (C do MVC) — só HTTP: valida entrada, chama o model, responde.
import { Request, Response } from 'express'
import * as tripModel from '../models/tripModel'
import * as quoteModel from '../models/quoteModel'
import * as docModel from '../models/documentModel'

const idOf = (req: Request): number => Number(req.params.id)
const subIdOf = (req: Request): number => Number(req.params.subId)

export function listTrips(_req: Request, res: Response) {
  res.json(tripModel.list())
}

export function getTrip(req: Request, res: Response) {
  const trip = tripModel.get(idOf(req))
  if (!trip) return res.status(404).json({ error: 'viagem não encontrada' })
  trip.quotes = quoteModel.listByTrip(trip.id)
  trip.docs = docModel.listByTrip(trip.id)
  res.json(trip)
}

export function createTrip(req: Request, res: Response) {
  res.status(201).json(tripModel.create(req.body || {}))
}

export function updateTrip(req: Request, res: Response) {
  const trip = tripModel.update(idOf(req), req.body || {})
  if (!trip) return res.status(404).json({ error: 'viagem não encontrada' })
  res.json(trip)
}

export function deleteTrip(req: Request, res: Response) {
  const ok = tripModel.remove(idOf(req))
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'viagem não encontrada' })
}

export function stats(_req: Request, res: Response) {
  res.json(tripModel.stats())
}

// ---------- cotações ----------
export function listQuotes(req: Request, res: Response) {
  res.json(quoteModel.listByTrip(idOf(req)))
}

export function addQuote(req: Request, res: Response) {
  res.status(201).json(quoteModel.create(idOf(req), req.body || {}))
}

export function updateQuote(req: Request, res: Response) {
  const q = quoteModel.update(subIdOf(req), req.body || {})
  if (!q) return res.status(404).json({ error: 'cotação não encontrada' })
  res.json(q)
}

export function deleteQuote(req: Request, res: Response) {
  const ok = quoteModel.remove(subIdOf(req))
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'cotação não encontrada' })
}

export function convertQuote(req: Request, res: Response) {
  res.status(201).json(quoteModel.convertToExpense(subIdOf(req)))
}

// ---------- documentos ----------
export function listDocs(req: Request, res: Response) {
  res.json(docModel.listByTrip(idOf(req)))
}

export function addDoc(req: Request, res: Response) {
  res.status(201).json(docModel.create(idOf(req), req.body || {}))
}

export function getDocMeta(req: Request, res: Response) {
  const meta = docModel.getMeta(subIdOf(req))
  if (!meta || meta.tripId !== idOf(req)) return res.status(404).json({ error: 'documento não encontrado' })
  res.json(meta)
}

export function getDocFile(req: Request, res: Response) {
  const doc = docModel.get(subIdOf(req))
  if (!doc || doc.trip_id !== idOf(req)) return res.status(404).json({ error: 'documento não encontrado' })
  const base64 = String(doc.data).split(',')[1] || ''
  res.setHeader('Content-Type', doc.mime_type)
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`)
  res.send(Buffer.from(base64, 'base64'))
}

export function updateDoc(req: Request, res: Response) {
  const d = docModel.update(subIdOf(req), req.body || {})
  if (!d) return res.status(404).json({ error: 'documento não encontrado' })
  res.json(d)
}

export function deleteDoc(req: Request, res: Response) {
  const ok = docModel.remove(subIdOf(req))
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'documento não encontrado' })
}
