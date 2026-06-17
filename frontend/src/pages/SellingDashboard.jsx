import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSellingDashboard, markListingSold, updateSelling } from '../api/client'

const FEE_RATE  = 0.1325   // eBay final value fee (matches Card Detail default)
const FEE_FIXED = 0.30

function netProfit(price) {
  if (!price) return 0
  return price - (price * FEE_RATE + FEE_FIXED)
}

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

  const { listed_count, sold_count, listed_value, sold_value, listed_groups, sold_groups } = data

  return (
    <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Selling</h1>
      <p className="text-[#94A3B8] text-sm mb-5">Track cards you're selling and what you've sold.</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <StatCard label="Listed" count={listed_count} value={listed_value}
          color="text-yellow-300" bg="bg-yellow-900/20 border-yellow-500/30" />
        <StatCard label="Sold" count={sold_count} value={sold_value}
          color="text-green-400" bg="bg-green-900/20 border-green-500/30" />
      </div>

      <Section title="For Sale" count={listed_groups.length} accent="text-yellow-300">
        {listed_groups.length === 0
          ? <Empty>No active listings. Select cards in Collection and tap "List on eBay".</Empty>
          : listed_groups.map(g => (
              <ListedGroup key={`${g.kind}-${g.ref_id}`} group={g} navigate={navigate} onSold={fetchDashboard} />
            ))
        }
      </Section>

      <Section title="Sold" count={sold_groups.length} accent="text-green-400">
        {sold_groups.length === 0
          ? <Empty>No sold cards yet. Mark a listing sold once it sells.</Empty>
          : sold_groups.map(g => (
              <SoldGroup key={`${g.kind}-${g.ref_id}`} group={g} navigate={navigate} />
            ))
        }
      </Section>
    </div>
  )
}

function ListedGroup({ group, navigate, onSold }) {
  const [marking, setMarking] = useState(false)
  const [amount, setAmount]   = useState(group.price ? String(group.price) : '')
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState(null)

  async function submit() {
    const p = parseFloat(amount)
    if (!p || p <= 0) { setErr('Enter a valid sold amount.'); return }
    setSaving(true); setErr(null)
    try {
      if (group.kind === 'listing') {
        await markListingSold(group.ref_id, { sold_price: p, sold_date: date })
      } else {
        const c = group.cards[0]
        await updateSelling(group.ref_id, {
          is_selling: false, is_sold: true,
          listed_price: c.listed_price, listing_date: c.listing_date, listing_url: c.listing_url,
          sold_price: p, sold_date: date,
        })
      }
      onSold()
    } catch { setErr('Failed to mark sold.') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-[#1A2E45] rounded-xl px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm font-medium truncate">
            {group.is_lot && <span className="text-[#A8DADC]">Lot · </span>}{group.title}
          </p>
          <GroupCards group={group} navigate={navigate} />
        </div>
        {group.price
          ? <span className="text-yellow-300 text-sm font-semibold whitespace-nowrap">${group.price.toFixed(2)}</span>
          : <span className="text-[#4A6080] text-xs whitespace-nowrap">No price</span>}
      </div>

      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          {group.listing_date && (
            <span className="text-[#94A3B8] text-xs">Listed {new Date(group.listing_date).toLocaleDateString()}</span>
          )}
          {group.url && (
            <a href={group.url} target="_blank" rel="noreferrer"
              className="text-[#A8DADC] text-xs underline" onClick={e => e.stopPropagation()}>Listing ↗</a>
          )}
        </div>
        {!marking && (
          <button onClick={() => setMarking(true)}
            className="text-xs bg-green-900/30 text-green-400 border border-green-500/30 rounded-lg px-3 py-1.5">
            Mark Sold
          </button>
        )}
      </div>

      {marking && (
        <div className="mt-3 bg-[#0D1B2A] rounded-xl p-3 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-sm">$</span>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="Sold amount" className="w-full bg-[#1A2E45] text-white text-sm rounded-lg pl-7 pr-3 py-2 outline-none" />
            </div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="bg-[#1A2E45] text-white text-sm rounded-lg px-3 py-2 outline-none" />
          </div>
          {amount > 0 && (
            <p className="text-xs text-[#94A3B8]">
              Net after eBay fee: <span className="text-green-400 font-semibold">${netProfit(parseFloat(amount)).toFixed(2)}</span>
            </p>
          )}
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving}
              className="flex-1 bg-green-500 text-[#0D1B2A] text-sm font-semibold rounded-lg py-2 disabled:opacity-40">
              {saving ? 'Saving…' : 'Confirm Sold'}
            </button>
            <button onClick={() => { setMarking(false); setErr(null) }}
              className="bg-[#1A2E45] text-[#94A3B8] text-sm rounded-lg px-4 py-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SoldGroup({ group, navigate }) {
  const profit = netProfit(group.sold_price)
  return (
    <div className="bg-[#1A2E45] rounded-xl px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-white text-sm font-medium truncate">
            {group.is_lot && <span className="text-[#A8DADC]">Lot · </span>}{group.title}
          </p>
          <GroupCards group={group} navigate={navigate} />
        </div>
        {group.sold_price
          ? <span className="text-green-400 text-sm font-semibold whitespace-nowrap">${group.sold_price.toFixed(2)}</span>
          : <span className="text-[#4A6080] text-xs whitespace-nowrap">Amount not recorded</span>}
      </div>
      <div className="flex items-center justify-between mt-2">
        {group.sold_date
          ? <span className="text-[#94A3B8] text-xs">Sold {new Date(group.sold_date).toLocaleDateString()}</span>
          : <span />}
        {group.sold_price > 0 && (
          <span className="text-xs text-[#94A3B8]">
            Net: <span className="text-green-400 font-semibold">${profit.toFixed(2)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

function GroupCards({ group, navigate }) {
  if (!group.is_lot) {
    const c = group.cards[0]
    return (
      <p className="text-[#94A3B8] text-xs truncate cursor-pointer"
        onClick={() => navigate(`/cards/${c.id}`)}>
        #{c.card_number} · {c.set_name}
      </p>
    )
  }
  return (
    <div className="mt-1 space-y-0.5">
      {group.cards.map(c => (
        <p key={c.id} className="text-[#94A3B8] text-xs truncate cursor-pointer hover:text-white"
          onClick={() => navigate(`/cards/${c.id}`)}>
          • {c.player_name} #{c.card_number}
        </p>
      ))}
    </div>
  )
}

function StatCard({ label, count, value, color, bg }) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className={`text-2xl font-bold ${color}`}>{count}</p>
      <p className="text-[#94A3B8] text-xs mt-0.5">{label}</p>
      {value > 0 && <p className={`text-sm font-medium mt-2 ${color}`}>${value.toFixed(2)}</p>}
      {value === 0 && count === 0 && <p className="text-[#4A6080] text-xs mt-2">$0.00</p>}
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

function Empty({ children }) {
  return (
    <div className="bg-[#1A2E45] rounded-xl px-4 py-5 text-center">
      <p className="text-[#94A3B8] text-sm">{children}</p>
    </div>
  )
}
