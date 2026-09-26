// Search controller — buscas REAIS de transporte via Google Maps Platform (sem mock).
import { Request, Response } from 'express'
import { computeRoutes, googleAutocomplete } from '../services/googleRoutes'
import type { TravelMode } from '../services/googleRoutes'
import { getSetting } from '../services/settings'

const VALID_MODES: TravelMode[] = ['DRIVE', 'TRANSIT', 'WALK', 'BICYCLE', 'FLIGHT']

export async function routesCtrl(req: Request, res: Response) {
  try {
    const modesRaw = String(req.query.modes || 'DRIVE,TRANSIT')
    const modes = modesRaw
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter((m): m is TravelMode => VALID_MODES.includes(m as TravelMode))
    const data = await computeRoutes({
      origin: String(req.query.origin || ''),
      destination: String(req.query.destination || ''),
      modes: modes.length ? modes : ['DRIVE'],
      departureTime: req.query.date ? String(req.query.date) : undefined,
    })
    res.json(data)
  } catch (e: any) {
    const status = e?.code === 'NO_KEY' ? 400 : e?.status === 403 ? 403 : 502
    res.status(status).json({ error: e?.message || 'Falha na consulta ao Google Routes' })
  }
}

// Autocomplete real do Google Places — usuário digita qualquer pedaço do nome.
export async function suggestPlacesCtrl(req: Request, res: Response) {
  const q = String(req.query.q || '')
  if (q.trim().length < 2) return res.json({ query: q, count: 0, results: [] })
  try {
    const key = getSetting('GOOGLE_MAPS_API_KEY')
    if (!key) {
      return res.status(400).json({ error: 'Configure GOOGLE_MAPS_API_KEY no server/.env para usar o autocomplete do Google.' })
    }
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 8))
    const results = await googleAutocomplete(q, key, limit)
    res.json({ query: q, count: results.length, results })
  } catch (e: any) {
    res.status(e?.status === 403 ? 403 : 502).json({ query: q, count: 0, results: [], error: e?.message || 'indisponível' })
  }
}

// Status da integração Google (para a UI avisar se falta chave / mostrar quais APIs estão ok)
export async function googleStatusCtrl(_req: Request, res: Response) {
  const key = getSetting('GOOGLE_MAPS_API_KEY')
  res.json({ hasKey: !!key, apis: ['Routes API', 'Places Autocomplete', 'Maps Embed'] })
}
