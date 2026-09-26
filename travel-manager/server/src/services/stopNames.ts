// Vocabulário de cidades europeias: nome em PT-BR (e grafias comuns) -> termo
// que o índice HAFAS reconhece. Isso resolve a reclamação de que "ninguém sabe
// o nome exato da estação": digite "Munique", "Londres" ou "Florença" e o app
// traduz sozinho para München / London / Firenze antes de consultar o HAFAS.
// A tabela é só um dicionário de tradução — os resultados continuam vindos
// 100% do HAFAS real (transport.rest/bahn.de), nunca inventamos estações.
export const EU_CITY_ALIASES: Record<string, string[]> = {
  munique: ['München'], munich: ['München'], munchen: ['München'],
  berlim: ['Berlin'], berlin: ['Berlin'],
  paris: ['Paris'], pariz: ['Paris'],
  londres: ['London'], london: ['London'],
  roma: ['Roma'], rome: ['Roma'],
  florenca: ['Firenze'], florença: ['Firenze'], firenze: ['Firenze'], florence: ['Firenze'],
  veneza: ['Venezia'], venice: ['Venezia'],
  milao: ['Milano'], milão: ['Milano'], milan: ['Milano'],
  napoles: ['Napoli'], naples: ['Napoli'],
  barcelona: ['Barcelona'], madri: ['Madrid'], madrid: ['Madrid'],
  lisboa: ['Lisboa'], porto: ['Porto'],
  amsta: ['Amsterdam'], amsterdam: ['Amsterdam'], amsterda: ['Amsterdam'],
  rotterdam: ['Rotterdam'], haia: ["'s-Gravenhage"], haye: ['Den Haag'],
  bruxelas: ['Bruxelles'], bruselas: ['Bruxelles'], brussels: ['Brussel'],
  antuerpia: ['Antwerpen'], antwerp: ['Antwerpen'],
  viena: ['Wien'], vieana: ['Wien'], vienna: ['Wien'],
  zurique: ['Zürich'], zurich: ['Zürich'],
  genebra: ['Genève'], geneva: ['Genève'],
  pragua: ['Praha'], praga: ['Praha'], prague: ['Praha'],
  budapeste: ['Budapest'], warsavia: ['Warszawa'], warsaw: ['Warszawa'],
  cracovia: ['Kraków'], krakow: ['Kraków'],
  estocolmo: ['Stockholm'], oslo: ['Oslo'], copenhague: ['København'], copenhagen: ['København'],
  helsinque: ['Helsinki'], dublin: ['Dublin'], dublim: ['Dublin'],
  franfurt: ['Frankfurt'], frankfurt: ['Frankfurt'],
  hamburg: ['Hamburg'], hambrugo: ['Hamburg'], colonia: ['Köln'], cologne: ['Köln'],
  stuttgart: ['Stuttgart'], dusseldorf: ['Düsseldorf'], dusseldorfe: ['Düsseldorf'],
  nuremberg: ['Nürnberg'], nuremberga: ['Nürnberg'],
  strassbourg: ['Strasbourg'], estrasburgo: ['Strasbourg'],
  lyon: ['Lyon'], marselha: ['Marseille'], marseille: ['Marseille'],
  bordeaux: ['Bordeaux'], nice: ['Nice'], cannes: ['Cannes'],
  gene: ['Genève'], interlaken: ['Interlaken'], luzerna: ['Luzern'], lucerne: ['Luzern'],
  salzburg: ['Salzburg'], saltzburgo: ['Salzburg'], innsbruck: ['Innsbruck'],
  valencia: ['Valencia'], sevilha: ['Sevilla'], seville: ['Sevilla'],
  malaga: ['Málaga'], bilbao: ['Bilbao'], granada: ['Granada'], zaragoza: ['Zaragoza'],
  portimao: ['Portimão'], faro: ['Faro'], coimbra: ['Coimbra'], averio: ['Aveiro'],
  varsavia: ['Warszawa'], gdansk: ['Gdańsk'], krakovia: ['Kraków']
}

const stripAccents = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Se "munique" for digitado, devolve ['München'] (termos aceitos pelo HAFAS). */
export function translateCity(query: string): string[] {
  const key = stripAccents(query)
  if (!key) return []
  const out: string[] = []
  // alias exato
  const exact = Object.values(EU_CITY_ALIASES) // placeholder; usamos busca por chave abaixo
  void exact
  for (const [alias, targets] of Object.entries(EU_CITY_ALIASES)) {
    if (stripAccents(alias) === key) for (const t of targets) if (!out.includes(t)) out.push(t)
  }
  if (out.length) return out
  // prefixo (ex.: "mun" -> Munique; "floren" -> Florença) — máx. 2 traduções
  const seen = new Set<string>()
  for (const [alias, targets] of Object.entries(EU_CITY_ALIASES)) {
    if (key.length >= 4 && stripAccents(alias).startsWith(key)) {
      for (const t of targets) if (!seen.has(t)) { seen.add(t); out.push(t) }
    }
    if (out.length >= 2) break
  }
  return out.slice(0, 2)
}
