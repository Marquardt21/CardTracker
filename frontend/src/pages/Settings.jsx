import { useEffect, useState } from 'react'
import { exportCsv, getSettings } from '../api/client'

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getSettings().then(r => setSettings(r.data)).catch(() => {})
  }, [])

  async function handleExport() {
    setExporting(true)
    try {
      const { data } = await exportCsv()
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url; a.download = 'hockey_cards.csv'; a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  return (
    <div className="pb-24 px-4 pt-6 max-w-lg mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* API Key Status */}
      {settings && (
        <div className="bg-[#1A2E45] rounded-xl p-4">
          <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-3">API Keys</p>
          {[
            { label: 'eBay Developer API', key: 'ebay', note: 'Required for price lookups' },
            { label: 'Anthropic API', key: 'anthropic', note: 'Required for AI card scan' },
          ].map(({ label, key, note }) => (
            <div key={key} className="flex justify-between items-center py-2 border-b border-[#0D1B2A] last:border-0">
              <div>
                <p className="text-white text-sm">{label}</p>
                <p className="text-[#94A3B8] text-xs">{note}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${settings.api_keys[key] ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                {settings.api_keys[key] ? 'Set' : 'Missing'}
              </span>
            </div>
          ))}
          {(!settings.api_keys.ebay || !settings.api_keys.anthropic) && (
            <p className="text-[#94A3B8] text-xs mt-3">
              Add missing keys to <code className="text-[#A8DADC]">.env</code> in the project root and restart the server.
            </p>
          )}
        </div>
      )}

      {/* Export */}
      <div className="bg-[#1A2E45] rounded-xl p-4">
        <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-3">Data</p>
        <button onClick={handleExport} disabled={exporting}
          className="w-full bg-[#0D1B2A] text-white rounded-xl py-3 text-sm disabled:opacity-40">
          {exporting ? 'Exporting…' : '⬇ Export Collection to CSV'}
        </button>
      </div>

      {/* Thresholds */}
      {settings && (
        <div className="bg-[#1A2E45] rounded-xl p-4">
          <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-3">Configured Thresholds</p>
          {[
            ['Price Spike Alert', `>${settings.thresholds.price_spike_pct}%`],
            ['ROI — Worth It', `>$${settings.thresholds.grading_roi_worth_it}`],
            ['ROI — Borderline', `$${settings.thresholds.grading_roi_borderline}–$${settings.thresholds.grading_roi_worth_it}`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-2 border-b border-[#0D1B2A] last:border-0">
              <span className="text-[#94A3B8] text-sm">{label}</span>
              <span className="text-white text-sm font-medium">{value}</span>
            </div>
          ))}
          <p className="text-[#94A3B8] text-xs mt-3">Edit thresholds in <code className="text-[#A8DADC]">backend/config.py</code></p>
        </div>
      )}

      {/* Grading costs */}
      {settings && (
        <div className="bg-[#1A2E45] rounded-xl p-4">
          <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-3">Grading Cost Table</p>
          {Object.entries(settings.grading_costs).map(([service, cost]) => (
            <div key={service} className="flex justify-between py-2 border-b border-[#0D1B2A] last:border-0">
              <span className="text-[#94A3B8] text-sm">{service}</span>
              <span className="text-white text-sm font-medium">${cost}</span>
            </div>
          ))}
        </div>
      )}

      {/* Coming soon */}
      <div className="bg-[#1A2E45] rounded-xl p-4 opacity-50">
        <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide mb-1">Remote Access / PIN Protection</p>
        <p className="text-[#94A3B8] text-sm">Coming soon — Tailscale VPN integration</p>
      </div>
    </div>
  )
}
