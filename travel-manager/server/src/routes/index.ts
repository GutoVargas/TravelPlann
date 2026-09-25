// Routes (R do MVC) — apenas mapeiam URL/método → controller.
import { Router } from 'express'
import * as tripCtrl from '../controllers/tripController'
import * as expenseCtrl from '../controllers/expenseController'
import * as searchCtrl from '../controllers/searchController'
import * as syncCtrl from '../controllers/syncController'

export const tripsRouter = Router({ mergeParams: true })

// /api/trips/:id/expenses...
tripsRouter.get('/:id/expenses', expenseCtrl.listExpenses)
tripsRouter.post('/:id/expenses', expenseCtrl.addExpense)
tripsRouter.put('/:id/expenses/:subId', expenseCtrl.updateExpense)
tripsRouter.delete('/:id/expenses/:subId', expenseCtrl.deleteExpense)
// /api/trips/:id/quotes...
tripsRouter.get('/:id/quotes', tripCtrl.listQuotes)
tripsRouter.post('/:id/quotes', tripCtrl.addQuote)
tripsRouter.put('/:id/quotes/:subId', tripCtrl.updateQuote)
tripsRouter.delete('/:id/quotes/:subId', tripCtrl.deleteQuote)
tripsRouter.post('/:id/quotes/:subId/convert', tripCtrl.convertQuote)
// /api/trips/:id/docs...
tripsRouter.get('/:id/docs', tripCtrl.listDocs)
tripsRouter.post('/:id/docs', tripCtrl.addDoc)
tripsRouter.get('/:id/docs/:subId/file', tripCtrl.getDocFile)
tripsRouter.get('/:id/docs/:subId', tripCtrl.getDocMeta)
tripsRouter.put('/:id/docs/:subId', tripCtrl.updateDoc)
tripsRouter.delete('/:id/docs/:subId', tripCtrl.deleteDoc)
// /api/trips e /api/trips/:id
tripsRouter.get('/', tripCtrl.listTrips)
tripsRouter.post('/', tripCtrl.createTrip)
tripsRouter.get('/:id', tripCtrl.getTrip)
tripsRouter.put('/:id', tripCtrl.updateTrip)
tripsRouter.delete('/:id', tripCtrl.deleteTrip)

export const apiRouter = Router()
apiRouter.get('/health', (_req, res) => res.json({ ok: true }))
apiRouter.get('/stats', tripCtrl.stats)
apiRouter.get('/search-transport', searchCtrl.searchTransportCtrl)
apiRouter.get('/search-trains', searchCtrl.searchTrainsCtrl)
apiRouter.get('/sync/changes', syncCtrl.pullChanges)
apiRouter.post('/sync/push', syncCtrl.pushChanges)
apiRouter.use('/trips', tripsRouter)
