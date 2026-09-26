// Search controller — buscas REAIS de transporte (sem mock).
import { Request, Response } from 'express'
import { searchTransport } from '../services/searchTransport'
import { searchTrains, suggestStops } from '../services/searchTrains'

export async function searchTransportCtrl(req: Request, res: Response) {
  const data = await searchTransport({
    origin: String(req.query.origin || ''),
    destination: String(req.query.destination || ''),
    date: String(req.query.date || '')
  })
  res.json(data)
}

export async function searchTrainsCtrl(req: Request, res: Response) {
  const data = await searchTrains({
    origin: String(req.query.origin || ''),
    destination: String(req.query.destination || ''),
    date: String(req.query.date || '')
  })
  res.json(data)
}

// Autocomplete de estações — o usuário NÃO precisa saber o nome exato.
export async function suggestStopsCtrl(req: Request, res: Response) {
  const q = String(req.query.q || '')
  const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 8))
  try {
    const suggestions = await suggestStops(q, limit)
    res.json({ query: q, count: suggestions.length, results: suggestions })
  } catch (e: any) {
    // Nunca estoura a UI do autocomplete: na pior hipótese retorna lista vazia.
    res.json({ query: q, count: 0, results: [], warning: e?.message || 'indisponível' })
  }
}
