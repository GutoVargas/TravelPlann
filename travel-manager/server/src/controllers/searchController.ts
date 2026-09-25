// Search controller — buscas REAIS de transporte (sem mock).
import { Request, Response } from 'express'
import { searchTransport } from '../services/searchTransport'
import { searchTrains } from '../services/searchTrains'

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
