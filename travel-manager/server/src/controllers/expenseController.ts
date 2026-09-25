// Expense controller — rotas aninhadas /api/trips/:id/expenses/:subId.
import { Request, Response } from 'express'
import * as expenseModel from '../models/expenseModel'

export function listExpenses(req: Request, res: Response) {
  res.json(expenseModel.listByTrip(Number(req.params.id)))
}

export function addExpense(req: Request, res: Response) {
  res.status(201).json(expenseModel.create(Number(req.params.id), req.body || {}))
}

export function updateExpense(req: Request, res: Response) {
  const e = expenseModel.update(Number(req.params.subId), req.body || {})
  if (!e) return res.status(404).json({ error: 'gasto não encontrado' })
  res.json(e)
}

export function deleteExpense(req: Request, res: Response) {
  const ok = expenseModel.remove(Number(req.params.subId))
  res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: 'gasto não encontrado' })
}
