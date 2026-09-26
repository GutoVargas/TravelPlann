// Service (C do MVC) — Rotas, mapas e tempo de deslocamento via Google Maps Platform.
// APIs usadas (server-side, com GOOGLE_MAPS_API_KEY no .env):
//  - Routes API (new) : computeRoutes  → rotas + duração + distância + trechos por modal
//  - Places API       : places/placeDetails/suggestplace → geocodificação leve e autocomplete
// Docs: https://developers.google.com/maps/documentation/routes/compute-routes
import { getSetting } from './settings'

const ROUTES_ENDPOINT =
  'https://routes.googleapis.com/directions/v2:computeRoutes'
const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const PLACE_DETAILS_ENDPOINT = 'https://places.googleapis.com/v1/places'
const AUTOCOMPLET_ENDPOINT =
  'https://places.googleapis.com/v1/places:autocomplete'

export type TravelMode = 'DRIVE' | 'TRANSIT' | 'WALK' | 'BICYCLE' | 'FLIGHT'

const MODE_LABEL: Record<string, string> = {
  DRIVE: '🚗 Carro',
  TRANSIT: '🚆 Transporte público',
  WALK: '🚶 A pé',
  BICYCLE: '🚲 Bicicleta',
  FLIGHT: '✈️ Voo (estimativa em linha reta)'
}

export interface RouteLegOut {
  mode: string
  label: string
  startName: string
  endName: string
  startSecondsFromEpoch: number
  endSecondsFromEpoch: number
  durationMin: number
  distanceKm: number
  steps: { instruction: string; distanceMeters: number; durationMin: number }[]
}

export interface RouteOut {
  mode: TravelMode
  label: string
  originName: string
  destinationName: string
  departureTime?: string
  arrivalTime?: string
  durationMin: number
  distanceKm: number
  trafficDelayMin?: number
  tolls?: { currency: string; amountMicros: number; display: string }
  polyline: string // encoded polyline p90 — para desenhar o mapa no front
  legs: RouteLegOut[]
  fallbackStraightLine?: boolean
}

interface GeoPoint {
  latitude: number
  longitude: number
}

async function fetchJson(url: string, apiKey: string, body: unknown, fieldMask: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j: any = await res.json()
      msg = j?.error?.message || msg
    } catch { /* ignore */ }
    const err: any = new Error(msg)
    err.status = res.status
    throw err
  }
  return res.json() as Promise<any>
}

function decodePolylineLength(_poly: string) {
  return _poly
}

function toRad(d: number) {
  return (d * Math.PI) / 180
}

// Distância haversine em km (usada apenas como estimativa honesta p/ voos)
function haversineKm(a: GeoPoint, b: GeoPoint) {
  const R = 6371
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function formatSeconds(sec: number) {
  const ms = sec * 1000
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`
}

// Resolve um texto ("Paris", "Torre Eiffel") em coordenadas via Places (Text Search).
export async function geocodeViaPlaces(query: string, apiKey: string): Promise<{ name: string; point: GeoPoint }> {
  const j = await fetchJson(
    PLACES_ENDPOINT,
    apiKey,
    { textQuery: query, languageCode: 'pt-BR', maxResultCount: 1 },
    'places.id,places.displayName,places.location'
  )
  const p = j?.places?.[0]
  if (!p?.location) throw new Error(`Local não encontrado: "${query}"`)
  return {
    name: p.displayName?.text || query,
    point: { latitude: p.location.latitude, longitude: p.location.longitude }
  }
}

// Autocomplete real do Google Places.
export async function googleAutocomplete(input: string, apiKey: string, limit = 8) {
  const j = await fetchJson(
    AUTOCOMPLET_ENDPOINT,
    apiKey,
    { input, languageCode: 'pt-BR', sessionToken: undefined, strims: [] },
    'suggestions.placeInput,suggestions.placePrediction'
  )
  const out: { name: string; text: string; placeId: string }[] = []
  for (const s of j?.suggestions || []) {
    const pred = s?.placePrediction
    const structured = pred?.structuredText
    const main = structured?.mainText?.text || s?.placeInput?.text || ''
    if (!main) continue
    const secondary = (structured?.secondaryTextParts || [])
      .map((x: any) => x?.text)
      .filter(Boolean)
      .join(', ')
    out.push({ name: main, text: secondary ? `${main} — ${secondary}` : main, placeId: pred?.placeId || s?.placeInput?.text || main })
    if (out.length >= limit) break
  }
  return out
}

// Detalhes de um lugar (coordenadas) via Place Details (new)
export async function placeDetailCoords(placeId: string, apiKey: string): Promise<{ name: string; point: GeoPoint }> {
  const j = await fetchJson(
    `${PLACE_DETAILS_ENDPOINT}/${encodeURIComponent(placeId)}`,
    apiKey,
    {},
    'displayName,location,id'
  )
  if (!j?.location) throw new Error('Place sem localização')
  return {
    name: j.displayName?.text || placeId,
    point: { latitude: j.location.latitude, longitude: j.location.longitude }
  }
}

async function resolveAny(term: string, apiKey: string): Promise<{ name: string; point: GeoPoint }> {
  // Se vier "place:<id>" usa Place Details; senão Text Search.
  if (term.startsWith('place:')) {
    return placeDetailCoords(term.slice(6), apiKey)
  }
  return geocodeViaPlaces(term, apiKey)
}

function legToOut(leg: any, fallbackMode: string): RouteLegOut {
  const durSec = Number(leg?.duration?.replace('s', '') || 0)
  const distM = Number(leg?.distanceMeters || 0)
  const steps = (leg?.steps || []).slice(0, 40).map((st: any) => ({
    instruction: st?.htmlInstructions || st?.navigationInstruction?.instructions || '',
    distanceMeters: Number(st?.distanceMeters || 0),
    durationMin: Math.round(Number(String(st?.staticDuration || '0s').replace('s', '')) / 60)
  }))
  return {
    mode: leg?.travelMode || fallbackMode,
    label: MODE_LABEL[leg?.travelMode || fallbackMode] || leg?.travelMode || fallbackMode,
    startName: leg?.startLocation?.waypoint?.location?.latLng
      ? `${leg.startLocation.waypoint.location.latLng.latitude.toFixed(4)},${leg.startLocation.waypoint.location.latLng.longitude.toFixed(4)}`
      : '',
    endName: '',
    startSecondsFromEpoch: leg?.startLocation?.time ? new Date(leg.startLocation.time).getTime() / 1000 : 0,
    endSecondsFromEpoch: leg?.endLocation?.time ? new Date(leg.endLocation.time).getTime() / 1000 : 0,
    durationMin: Math.round(durSec / 60),
    distanceKm: Math.round((distM / 1000) * 10) / 10,
    steps
  }
}

function routeToOut(route: any, originName: string, destName: string, mode: TravelMode): RouteOut {
  const legs = (route.legs || []).map((l: any) => legToOut(l, mode))
  const summary = route.routeSummary || {}
  const durSec = Number(summary.duration?.replace('s', '') || 0)
  const distM = Number(summary.distanceMeters || 0)
  const dep = legs[0]?.startSecondsFromEpoch
  const arr = legs[legs.length - 1]?.endSecondsFromEpoch
  const toll = summary.tollInfo
  return {
    mode,
    label: MODE_LABEL[mode] || mode,
    originName,
    destinationName: destName,
    departureTime: dep ? formatSeconds(dep) : undefined,
    arrivalTime: arr ? formatSeconds(arr) : undefined,
    durationMin: Math.round(durSec / 60),
    distanceKm: Math.round((distM / 1000) * 10) / 10,
    trafficDelayMin: summary.trafficFacts?.length
      ? Math.max(
          0,
          ...summary.trafficFacts.map((f: any) =>
            Math.round(Number(String(f?.delay?._value ?? f?.delay ?? '0s').replace('s', '')) / 60)
          )
        )
      : undefined,
    tolls: toll?.activeTolls?.length
      ? {
          currency: toll.currencyCode || 'EUR',
          amountMicros: toll.activeTolls[0]?.tollElements?.reduce(
            (acc: number, el: any) => acc + Number(el?.cost?.micros || 0), 0) || 0,
          display: ''
        }
      : undefined,
    polyline: decodePolylineLength(summary.polyline?.encodedPolyline || ''),
    legs
  }
}

export interface ComputeRoutesParams {
  origin: string
  destination: string
  modes: TravelMode[]
  departureTime?: string // ISO local, opcional
  avoidTolls?: boolean
  transitMode?: 'BUS' | 'RAIL' | 'TRAIN' | 'SUBWAY' | 'TRAM'
}

export async function computeRoutes(params: ComputeRoutesParams) {
  const key = getSetting('GOOGLE_MAPS_API_KEY') || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!key) {
    const err: any = new Error(
      'Chave do Google não configurada. Adicione GOOGLE_MAPS_API_KEY em server/.env.'
    )
    err.code = 'NO_KEY'
    throw err
  }

  const [o, d] = await Promise.all([resolveAny(params.origin, key), resolveAny(params.destination, key)])
  const modes: TravelMode[] = params.modes.length ? params.modes : ['DRIVE']

  const results: RouteOut[] = []
  const errors: string[] = []

  for (const mode of modes) {
    if (mode === 'FLIGHT') {
      // Google Routes não vende passagens nem tem horário de voo na Routes API.
      // Estimativa honesta: linha reta + velocidade média de cruzeiro (~780 km/h) + 90 min de embarque/check-in.
      const km = Math.round(haversineKm(o.point, d.point) * 10) / 10
      const flightMin = Math.round((km / 780) * 60)
      results.push({
        mode,
        label: MODE_LABEL.FLIGHT,
        originName: o.name,
        destinationName: d.name,
        durationMin: flightMin + 90,
        distanceKm: km,
        polyline: '',
        legs: [{
          mode: 'FLIGHT', label: MODE_LABEL.FLIGHT, startName: o.name, endName: d.name,
          startSecondsFromEpoch: 0, endSecondsFromEpoch: 0,
          durationMin: flightMin, distanceKm: km,
          steps: [{ instruction: 'Estimativa em linha reta (voo direto teórico). Preços reais: use o buscador de voos.', distanceMeters: km * 1000, durationMin: flightMin }]
        }],
        fallbackStraightLine: true
      })
      continue
    }

    const body: any = {
      origin: { location: { latLng: { latitude: o.point.latitude, longitude: o.point.longitude } } },
      destination: { location: { latLng: { latitude: d.point.latitude, longitude: d.point.longitude } } },
      travelMode: mode,
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      languageCode: 'pt-BR',
      regionCode: 'BR'
    }
    if (params.departureTime) {
      const iso = params.departureTime.length <= 10 ? `${params.departureTime}T09:00:00Z` : params.departureTime
      body.tripCondition = { timeOfDay: /^\d{4}-\d{2}-\d{2}$/.test(params.departureTime) ? iso : new Date(iso).toISOString().replace(/\.\d+Z$/, 'Z') }
    } else if (mode !== 'TRANSIT') {
      body.tripCondition = { currentTime: 'true' }
    }
    const routeOptions: any = {}
    if (params.avoidTolls) routeOptions.avoidTolls = true
    if (mode === 'TRANSIT' && params.transitMode) {
      routeOptions.transitRouteModifiers = {
        considerHotelStationLocation: false,
        transitPreferences: { allowedModes: [params.transitMode] }
      }
    }
    if (Object.keys(routeOptions).length) body.routeOptions = routeOptions

    try {
      const fieldMask = [
        'routes.routeSummary',
        'routes.legs.duration',
        'routes.legs.distanceMeters',
        'routes.legs.startLocation',
        'routes.legs.endLocation',
        'routes.legs.travelMode',
        'routes.legs.steps.staticDuration',
        'routes.legs.steps.distanceMeters',
        'routes.legs.steps.navigationInstruction',
        'routes.legs.steps.htmlInstructions'
      ].join(',')
      const j = await fetchJson(ROUTES_ENDPOINT, key, body, fieldMask)
      const routes = j?.routes || []
      if (!routes.length) {
        errors.push(`${MODE_LABEL[mode]}: nenhuma rota encontrada`)
        continue
      }
      results.push(routeToOut(routes[0], o.name, d.name, mode))
    } catch (e: any) {
      errors.push(`${MODE_LABEL[mode]}: ${e.message}`)
    }
  }

  return {
    origin: o.name,
    destination: d.name,
    originLocation: o.point,
    destinationLocation: d.point,
    routes: results.sort((a, b) => a.durationMin - b.durationMin),
    errors
  }
}
