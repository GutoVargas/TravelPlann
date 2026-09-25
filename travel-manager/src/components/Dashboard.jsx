import { brl, fmtDate, STATUSES } from '../api.js'

export default function Dashboard({ stats, trips, onOpen, onNew }) {
  if (!stats) return null
  const upcoming = trips
    .filter((t) => t.startDate && t.status !== 'concluida')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 4)

  return (
    <section>
      <h1>Visão Geral</h1>

      <div className="cards">
        <div className="card stat">
          <span className="stat-num">{stats.trips}</span>
          <span className="stat-label">viagens cadastradas</span>
        </div>
        <div className="card stat">
          <span className="stat-num">{brl(stats.totalBudget)}</span>
          <span className="stat-label">orçamento total</span>
        </div>
        <div className="card stat">
          <span className="stat-num">{brl(stats.totalSpent)}</span>
          <span className="stat-label">gastos registrados</span>
        </div>
        <div className="card stat">
          <span className="stat-num">
            {stats.byStatus.planejando} / {stats.byStatus.andando} / {stats.byStatus.concluida}
          </span>
          <span className="stat-label">planejando / andando / concluídas</span>
        </div>
      </div>

      <div className="two-cols">
        <div className="card panel">
          <h2>🗓️ Próximas viagens</h2>
          {upcoming.length === 0 && (
            <p className="muted">
              Nenhuma viagem planejada.{' '}
              <button className="link" onClick={onNew}>Criar a primeira ✈️</button>
            </p>
          )}
          <ul className="mini-list">
            {upcoming.map((t) => (
              <li key={t.id} onClick={() => onOpen(t.id)}>
                <div>
                  <strong>{t.title}</strong>
                  <div className="muted small">{t.destination || 'destino a definir'} · {fmtDate(t.startDate) || 'sem data'}</div>
                </div>
                <span className={`badge ${t.status}`}>{STATUSES[t.status].icon} {STATUSES[t.status].label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card panel">
          <h2>💸 Top gastos por viagem</h2>
          {trips.filter((t) => t.spent > 0).length === 0 && (
            <p className="muted">Nenhum gasto registrado ainda.</p>
          )}
          <ul className="mini-list">
            {[...trips].sort((a, b) => b.spent - a.spent).filter((t) => t.spent > 0).slice(0, 5).map((t) => (
              <li key={t.id} onClick={() => onOpen(t.id)}>
                <div><strong>{t.title}</strong></div>
                <div className={t.budget > 0 && t.spent > t.budget ? 'over' : 'money'}>{brl(t.spent)}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
