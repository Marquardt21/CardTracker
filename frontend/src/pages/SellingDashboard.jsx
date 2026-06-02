import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSellingDashboard } from '../api/client'

export default function SellingDashboard() {
  const navigate = useNavigate()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => { fetchDashboard() }, [])

  async function fetchDashboard() {
    setLoading(true)
    try {
      const { data: d } = await getSellingDashboard()
      setData(d)
    } catch { setError('Could not load selling dashboard.') }
    finally { setLoading(false) }
  }

  if (loading) return <div className="text-center py-16 text-[#94A3B8]">Loading…</div>
  if (error)   return <div className="text-center py-16 text-red-400">{error}</div>

  const { listed_count, sold_count, listed_value, sold_value, listed_cards, sold_cards } = data

  return (
    <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Selling</h1>
      <p className="text-[#94A3B8] text-sm mb-5">Track cards you're selling and what you've sold.</p>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard
          label="Listed"
          count={listed_count}
          value={listed_value}
          color="text-yellow-300"
          bg="bg-yellow-900/20 border-yellow-500/30"
        />
        <StatCard
          label="Sold"
          count={sold_count}
          value={sold_value}
          color="text-green-400"
          bg="bg-green-900/20 border-green-500/30"
        />
      </div>

      {/* ── Listed Cards ──────────────────────────────────────────────────── */}
      <Section title="For Sale" count={listed_count} accent="text-yellow-300">
        {listed_cards.length === 0
          ? <Empty>No cards currently listed. Open a card and check "For Sale" to list it.</Empty>
          : listed_cards.map(c => (
              <CardRow key={c.id} card={c} navigate={navigate}>
                <div className="flex items-center justify-between mt-1">
                  {c.listed_price
                    ? <span className="text-yellow-300 text-sm font-semibold">${c.listed_price.toFixed(2)}</span>
                    : <span className="text-[#4A6080] text-xs">No price set</span>}
                  <div className="flex items-center gap-2">
                    {c.listing_date && (
                      <span className="text-[#94A3B8] text-xs">Listed {new Date(c.listing_date).toLocaleDateString()}</span>
                    )}
                    {c.listing_url && (
                      <a href={c.listing_url} target="_blank" rel="noreferrer"
                        className="text-[#A8DADC] text-xs underline" onClick={e => e.stopPropagation()}>
                        Listing ↗
                      </a>
                    )}
                  </div>
                </div>
              </CardRow>
            ))
        }
      </Section>

      {/* ── Sold Cards ────────────────────────────────────────────────────── */}
      <Section title="Sold" count={sold_count} accent="text-green-400">
        {sold_cards.length === 0
          ? <Empty>No sold cards yet. Mark a listed card as sold from its detail page.</Empty>
          : sold_cards.map(c => (
              <CardRow key={c.id} card={c} navigate={navigate}>
                <div className="flex items-center justify-between mt-1">
                  {c.sold_price
                    ? <span className="text-green-400 text-sm font-semibold">${c.sold_price.toFixed(2)}</span>
                    : <span className="text-[#4A6080] text-xs">Amount not recorded</span>}
                  {c.sold_date && (
                    <span className="text-[#94A3B8] text-xs">Sold {new Date(c.sold_date).toLocaleDateString()}</span>
                  )}
                </div>
              </CardRow>
            ))
        }
      </Section>
    </div>
  )
}

function StatCard({ label, count, value, color, bg }) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
      <p className="text-[#94A3B8] text-xs mt-0.5">{label}</p>
      {value > 0 && (
        <p className={`text-sm font-medium mt-2 ${color}`}>${value.toFixed(2)}</p>
      )}
      {value === 0 && count === 0 && (
        <p className="text-[#4A6080] text-xs mt-2">$0.00</p>
      )}
    </div>
  )
}

function Section({ title, count, accent, children }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className={`text-base font-semibold ${accent}`}>{title}</h2>
        <span className="text-[#4A6080] text-xs">({count})</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function CardRow({ card, navigate, children }) {
  return (
    <div
      onClick={() => navigate(`/cards/${card.id}`)}
      className="bg-[#1A2E45] rounded-xl px-4 py-3 cursor-pointer active:bg-[#A8DADC]/10"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm font-medium truncate">{card.player_name}</p>
          <p className="text-[#94A3B8] text-xs truncate">#{card.card_number} · {card.set_name}</p>
        </div>
        <span className="text-[#94A3B8] text-sm ml-2">›</span>
      </div>
      {children}
    </div>
  )
}

function Empty({ children }) {
  return (
    <div className="bg-[#1A2E45] rounded-xl px-4 py-5 text-center">
      <p className="text-[#94A3B8] text-sm">{children}</p>
    </div>
  )
}
