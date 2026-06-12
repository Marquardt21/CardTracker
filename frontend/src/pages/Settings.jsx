import { useEffect, useState } from 'react'
import { disconnectEbay, exportCsv, getEbayAuthStatus, getSettings, storeEbayUserToken } from '../api/client'

export default function Settings() {
  const [settings, setSettings]           = useState(null)
  const [exporting, setExporting]         = useState(false)
  const [ebayConnected, setEbayConnected] = useState(null)
  const [tokenValue, setTokenValue]       = useState('')
  const [tokenError, setTokenError]       = useState(null)
  const [tokenSaving, setTokenSaving]     = useState(false)

  useEffect(() => {
    getSettings().then(r => setSettings(r.data)).catch(() => {})
    getEbayAuthStatus().then(r => setEbayConnected(r.data.connected)).catch(() => setEbayConnected(false))
  }, [])

  async function handleSaveToken(e) {
    e.preventDefault()
    if (!tokenValue.trim()) return
    setTokenSaving(true)
    setTokenError(null)
    try {
      await storeEbayUserToken(tokenValue.trim())
      setEbayConnected(true)
      setTokenValue('')
    } catch (err) {
      setTokenError(err.response?.data?.detail || 'Failed to save token.')
    } finally {
      setTokenSaving(false)
    }
  }

  async function handleDisconnect() {
    await disconnectEbay().catch(() => {})
    setEbayConnected(false)
  }

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

      {/* eBay Account */}
      <div className="bg-[#1A2E45] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[#94A3B8] text-xs font-semibold uppercase tracking-wide">eBay Selling Account</p>
          {ebayConnected === null
            ? <span className="text-[#94A3B8] text-xs">Checking…</span>
            : ebayConnected
              ? <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-500/20 text-green-400">Connected</span>
              : <span className="text-xs font-semibold px-2 py-1 rounded-full bg-[#94A3B8]/20 text-[#94A3B8]">Not connected</span>
          }
        </div>

        {/* Instructions */}
        <div className="bg-[#0D1B2A] rounded-lg p-3 mb-3 space-y-1">
          <p className="text-[#94A3B8] text-xs font-medium">How to get your User Token:</p>
          <ol className="text-[#94A3B8] text-xs space-y-1 list-decimal list-inside">
            <li>Go to <span className="text-[#A8DADC]">developer.ebay.com/my/auth</span></li>
            <li>Select <strong className="text-white">Production</strong> environment and your app</li>
            <li>Click <strong className="text-white">Get a Token for This App</strong> → log in with your eBay seller account</li>
            <li>Copy the <strong className="text-white">User Access Token</strong> shown on screen</li>
            <li>Paste it below (token lasts 2 hours)</li>
          </ol>
          <p className="text-yellow-400/80 text-xs mt-2">If drafts fail, Disconnect and paste a fresh token.</p>
        </div>

        {/* Token input — always visible */}
        <form onSubmit={handleSaveToken} className="space-y-2">
          <textarea
            rows={3}
            value={tokenValue}
            onChange={e => setTokenValue(e.target.value)}
            placeholder="Paste User Token here…"
            className="w-full bg-[#0D1B2A] text-white rounded-xl px-4 py-2.5 text-xs outline-none focus:ring-2 focus:ring-[#A8DADC] font-mono resize-none"
          />
          {tokenError && <p className="text-red-400 text-xs">{tokenError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={tokenSaving || !tokenValue.trim()}
              className="flex-1 bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-2.5 text-sm disabled:opacity-40"
            >
              {tokenSaving ? 'Saving…' : 'Save Token'}
            </button>
            {ebayConnected && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="px-4 bg-red-900/30 text-red-400 rounded-xl text-sm"
              >
                Disconnect
              </button>
            )}
          </div>
        </form>

        <p className="text-[#4A6080] text-xs mt-3">Token expires after 2 hours — re-paste when needed.</p>
      </div>

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
