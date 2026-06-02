import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDashboard } from '../api/client'
import SetProgressBar from '../components/SetProgressBar'

export default function Dashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDashboard().then(r => { setData(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-center py-16 text-[#94A3B8]">Loading…</div>
  if (!data) return <div className="text-center py-16 text-[#94A3B8]">Could not load dashboard.</div>

  return (
    <div className="pb-24 px-4 pt-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total Cards"      value={data.total_cards} />
        <Stat label="Collection Value" value={data.total_value > 0 ? `$${data.total_value.toFixed(2)}` : '—'} />
        <Stat label="30-Day Change"
          value={data.value_change_30d === 0 ? '—' : `${data.value_change_30d >= 0 ? '+' : ''}$${data.value_change_30d.toFixed(2)}`}
          color={data.value_change_30d > 0 ? 'text-green-400' : data.value_change_30d < 0 ? 'text-red-400' : ''} />
        <Stat label="Grading Picks" value={data.watchlist_worth_it.length} />
      </div>

      {/* Top cards */}
      {data.top_cards.length > 0 && (
        <Section title="Top 5 Most Valuable">
          {data.top_cards.map(c => (
            <div key={c.id} onClick={() => navigate(`/cards/${c.id}`)}
              className="flex justify-between items-center py-2 border-b border-[#0D1B2A] last:border-0 cursor-pointer active:opacity-75">
              <div>
                <p className="text-white text-sm font-medium">{c.player_name}</p>
                <p className="text-[#94A3B8] text-xs">{c.year} {c.brand} · #{c.card_number}</p>
              </div>
              <span className="text-[#A8DADC] text-sm font-semibold">—</span>
            </div>
          ))}
        </Section>
      )}

      {/* Grading worth it */}
      {data.watchlist_worth_it.length > 0 && (
        <Section title="🎯 Worth Grading">
          {data.watchlist_worth_it.map(c => (
            <div key={c.id} onClick={() => navigate(`/cards/${c.id}`)}
              className="flex justify-between items-center py-2 border-b border-[#0D1B2A] last:border-0 cursor-pointer active:opacity-75">
              <div>
                <p className="text-white text-sm font-medium">{c.player_name}</p>
                <p className="text-[#94A3B8] text-xs">{c.year} {c.brand}</p>
              </div>
              <span className="text-green-400 text-xs font-semibold">Worth It</span>
            </div>
          ))}
        </Section>
      )}

      {/* Set completion */}
      {data.set_completion.length > 0 && (
        <Section title="Set Completion">
          {data.set_completion.map(s => (
            <div key={s.set_id} onClick={() => navigate(`/sets/${s.set_id}`)}
              className="py-3 border-b border-[#0D1B2A] last:border-0 cursor-pointer active:opacity-75">
              <div className="flex justify-between mb-1">
                <p className="text-white text-sm font-medium truncate pr-2">{s.set_name}</p>
                <span className="text-[#94A3B8] text-xs flex-shrink-0">{s.owned}/{s.total}</span>
              </div>
              <SetProgressBar owned={s.owned} total={s.total} showLabel={false} />
            </div>
          ))}
        </Section>
      )}

      {/* Price spikes */}
      {data.price_spikes.length > 0 && (
        <Section title="🔥 Price Spikes">
          {data.price_spikes.map((s, i) => (
            <div key={i} onClick={() => navigate(`/cards/${s.card_id}`)}
              className="flex justify-between items-center py-2 border-b border-[#0D1B2A] last:border-0 cursor-pointer active:opacity-75">
              <div>
                <p className="text-white text-sm font-medium">{s.player_name}</p>
                <p className="text-[#94A3B8] text-xs">${s.old_price} → ${s.new_price}</p>
              </div>
              <span className="text-green-400 text-sm font-semibold">+{s.pct_change}%</span>
            </div>
          ))}
        </Section>
      )}

      {data.total_cards === 0 && (
        <div className="text-center py-12 text-[#94A3B8]">
          <p className="text-4xl mb-3">🏒</p>
          <p>Add your first card to get started.</p>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-[#1A2E45] rounded-xl p-4">
      <p className="text-[#94A3B8] text-xs mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-[#1A2E45] rounded-xl overflow-hidden">
      <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide px-4 py-3 border-b border-[#0D1B2A]">{title}</p>
      <div className="px-4">{children}</div>
    </div>
  )
}
