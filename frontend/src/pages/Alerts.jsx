import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAlerts } from '../api/client'

export default function Alerts() {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAlerts().then(r => { setAlerts(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  return (
    <div className="pb-24 px-4 pt-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-5">Price Alerts</h1>

      {loading && <p className="text-[#94A3B8] text-center py-8">Loading…</p>}

      {!loading && alerts.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8]">
          <p className="text-4xl mb-4">🔔</p>
          <p>No price spikes detected.</p>
          <p className="text-sm mt-1">Alerts appear when a card's value rises more than 25%.</p>
        </div>
      )}

      <ul className="space-y-3">
        {alerts.map((a, i) => (
          <li key={i} onClick={() => navigate(`/cards/${a.card_id}`)}
            className="bg-[#1A2E45] rounded-xl p-4 cursor-pointer active:opacity-75">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white font-semibold">{a.player_name}</p>
                <p className="text-[#94A3B8] text-xs">{a.year} {a.brand} · {a.set_name} · #{a.card_number}</p>
              </div>
              <span className="text-green-400 font-bold text-lg">+{a.pct_change}%</span>
            </div>
            <div className="flex gap-4 mt-2 text-sm">
              <span className="text-[#94A3B8]">Was <span className="text-white">${a.old_price}</span></span>
              <span className="text-[#94A3B8]">Now <span className="text-green-400 font-semibold">${a.new_price}</span></span>
              <span className="text-[#94A3B8] text-xs ml-auto">{new Date(a.spike_date).toLocaleDateString()}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
