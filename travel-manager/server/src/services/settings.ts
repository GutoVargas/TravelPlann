// Config helper — lê variáveis do ambiente (.env carregado no bootstrap).
export function getSetting(name: string): string {
  return process.env[name] || ''
}
