// Camada de dados: persistência em arquivo JSON (travel-manager/server/data.json).
// Simples, sem dependências, fácil de trocar por SQLite/Postgres no futuro.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json')

function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return { trips: data.trips || [], expenses: data.expenses || [], seq: data.seq || { trip: 1, expense: 1 } }
  } catch {
    return { trips: [], expenses: [], seq: { trip: 1, expense: 1 } }
  }
}

let db = load()

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

const FIELDS_TRIP = ['title', 'destination', 'startDate', 'endDate', 'budget', 'status', 'notes']
const FIELDS_EXPENSE = ['description', 'category', 'amount', 'date']

function sanitizeTrip(data) {
  const out = {}
  for (const f of FIELDS_TRIP) if (data[f] !== undefined) out[f] = data[f]
  if (out.budget !== undefined) out.budget = Number(out.budget) || 0
  const valid = ['planejando', 'andando', 'concluida']
  if (out.status && !valid.includes(out.status)) throw new Error('status inválido')
  return out
}

function tripWithTotals(trip) {
  const expenses = db.expenses.filter((e) => e.tripId === trip.id)
  const spent = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return { ...trip, expenses, spent: Math.round(spent * 100) / 100 }
}

export function listTrips() {
  return db.trips.map(tripWithTotals)
}

export function getTrip(id) {
  const trip = db.trips.find((t) => t.id === id)
  return trip ? tripWithTotals(trip) : null
}

export function createTrip(data) {
  const trip = {
    id: db.seq.trip++,
    title: '', destination: '', startDate: '', endDate: '',
    budget: 0, status: 'planejando', notes: '',
    createdAt: new Date().toISOString(),
    ...sanitizeTrip(data)
  }
  db.trips.push(trip)
  save()
  return tripWithTotals(trip)
}

export function updateTrip(id, data) {
  const trip = db.trips.find((t) => t.id === id)
  if (!trip) return null
  Object.assign(trip, sanitizeTrip(data))
  save()
  return tripWithTotals(trip)
}

export function deleteTrip(id) {
  const exists = db.trips.some((t) => t.id === id)
  if (!exists) return false
  db.trips = db.trips.filter((t) => t.id !== id)
  db.expenses = db.expenses.filter((e) => e.tripId !== id)
  save()
  return true
}

export function addExpense(tripId, data) {
  if (!db.trips.some((t) => t.id === tripId)) throw new Error('viagem não encontrada')
  const amount = Number(data.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('valor deve ser um número positivo')
  const exp = {
    id: db.seq.expense++,
    tripId,
    description: String(data.description).trim(),
    category: data.category || 'outros',
    amount,
    date: data.date || new Date().toISOString().slice(0, 10)
  }
  db.expenses.push(exp)
  save()
  return exp
}

export function updateExpense(id, data) {
  const exp = db.expenses.find((e) => e.id === id)
  if (!exp) return null
  for (const f of FIELDS_EXPENSE) {
    if (data[f] !== undefined) exp[f] = f === 'amount' ? Number(data[f]) : data[f]
  }
  save()
  return exp
}

export function deleteExpense(id) {
  const before = db.expenses.length
  db.expenses = db.expenses.filter((e) => e.id !== id)
  if (before === db.expenses.length) return false
  save()
  return true
}

export function stats() {
  const totalBudget = db.trips.reduce((s, t) => s + (Number(t.budget) || 0), 0)
  const totalSpent = db.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  return {
    trips: db.trips.length,
    byStatus: {
      planejando: db.trips.filter((t) => t.status === 'planejando').length,
      andando: db.trips.filter((t) => t.status === 'andando').length,
      concluida: db.trips.filter((t) => t.status === 'concluida').length
    },
    totalBudget: Math.round(totalBudget * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100
  }
}
