// Sync controller — apenas HTTP: lê a requisição, chama syncService e responde.
import { Request, Response } from 'express'
import * as syncService from '../services/syncService'

export function pullChanges(req: Request, res: Response) {
  const since = Number(req.query.since || 0)
  const full = req.query.full === '1'
  res.json(syncService.pullChanges(since, full))
}

export function pushChanges(req: Request, res: Response) {
  const body = req.body || {}
  const clientId = String(body.clientId || 'anon')
  const changes = Array.isArray(body.changes) ? body.changes : []
  const result = syncService.pushChanges(clientId, changes)
  res.json(result)
}
