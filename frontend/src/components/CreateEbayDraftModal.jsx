import { useEffect, useState } from 'react'
import { createEbayDraft, getSettings } from '../api/client'

const COND_LABELS = { poor: 'Poor', good: 'Good', very_good: 'VG', excellent: 'EX', near_mint: 'NM', mint: 'Mint' }
const COND_RANK   = { mint: 0, near_mint: 1, excellent: 2, very_good: 3, good: 4, poor: 5 }

function buildTitle(cards) {
  if (cards.length === 1) {
    const c = cards[0]
    const parts = [c.year, c.brand, `#${c.card_number}`, c.player_name]
    if (c.parallel_color) parts.push(c.parallel_color)
    if (c.card_type !== 'base') parts.push(c.card_type.replace(/_/g, ' '))
    return parts.join(' ').slice(0, 80)
  }
  const players = [...new Set(cards.map(c => c.player_name))]
  if (players.length === 1) return `${cards.length}x ${players[0]} Hockey Cards Lot`.slice(0, 80)
  return `${cards.length}x Hockey Cards Lot - Mixed Players`.slice(0, 80)
}

function buildDescription(cards) {
  if (cards.length === 1) {
    const c = cards[0]
    const lines = [
      `${c.year} ${c.brand} ${c.set_name}`,
      `Player: ${c.player_name}`,
      `Card #: ${c.card_number}`,
      `Condition: ${COND_LABELS[c.condition] || c.condition}`,
    ]
    if (c.team) lines.push(`Team: ${c.team}`)
    if (c.parallel_color) lines.push(`Parallel: ${c.parallel_color}`)
    if (c.print_run) lines.push(`Print Run: /${c.print_run}`)
    if (c.notes) lines.push(`\nNotes: ${c.notes}`)
    lines.push('\nSee photos for condition details. Ships in a penny sleeve inside a top loader.')
    return lines.join('\n')
  }
  const lines = [`Lot of ${cards.length} hockey cards.\n`]
  cards.forEach((c, i) => {
    let entry = `${i + 1}. ${c.year} ${c.brand} #${c.card_number} ${c.player_name} (${COND_LABELS[c.condition] || c.condition})`
    if (c.parallel_color) entry += ` [${c.parallel_color}]`
    lines.push(entry)
  })
  lines.push('\nSee photos for condition details. All cards ship in penny sleeves inside top loaders.')
  return lines.join('\n')
}

export default function CreateEbayDraftModal({ cards, onClose, onSuccess }) {
  const [title, setTitle]           = useState(() => buildTitle(cards))
  const [price, setPrice]           = useState('')
  const [description, setDescription] = useState(() => buildDescription(cards))
  const [photoUrl, setPhotoUrl]     = useState('')
  const [placeholderUrl, setPlaceholderUrl] = useState('')
  const [showDesc, setShowDesc]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState(null)

  useEffect(() => {
    getSettings().then(r => {
      const url = r.data?.ebay_placeholder_image_url
      if (url) {
        setPlaceholderUrl(url)
        setPhotoUrl(prev => prev || url)
      }
    }).catch(() => {})
  }, [])

  const worstCond = cards.reduce((worst, c) =>
    (COND_RANK[c.condition] ?? 5) > (COND_RANK[worst] ?? 5) ? c.condition : worst,
    cards[0]?.condition
  )

  async function handleSubmit(e) {
    e.preventDefault()
    const p = parseFloat(price)
    if (!p || p <= 0) { setError('Enter a valid price.'); return }
    setLoading(true)
    setError(null)
    try {
      const { data } = await createEbayDraft({
        card_ids:    cards.map(c => c.id),
        price:       p,
        title:       title.trim() || undefined,
        description: description.trim() || undefined,
        image_urls:  photoUrl.trim() ? [photoUrl.trim()] : [],
      })
      setResult(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create draft. Check that your eBay account is connected in Settings.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div
        className="bg-[#0D1B2A] w-full max-w-lg rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {result ? (
          /* ── Success screen ── */
          <div className="text-center py-4">
            <p className="text-4xl mb-3">🕐</p>
            <h2 className="text-white text-xl font-bold mb-2">Listing Scheduled!</h2>
            <p className="text-[#94A3B8] text-sm mb-1">
              Goes live in ~2 hours. Add photos now, or cancel in Seller Hub before then.
            </p>
            {result.scheduled_for && (
              <p className="text-[#A8DADC] text-xs mb-5">
                Go-live: {new Date(result.scheduled_for).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
            {result.ebay_listing_url && (
              <a
                href={result.ebay_listing_url}
                target="_blank"
                rel="noreferrer"
                className="block w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3 mb-3 text-center"
              >
                View on eBay ↗
              </a>
            )}
            <a
              href="https://www.ebay.com/sh/lst/scheduled"
              target="_blank"
              rel="noreferrer"
              className="block w-full bg-[#1A2E45] text-[#94A3B8] rounded-xl py-3 mb-3 text-center text-sm"
            >
              Open Seller Hub (Scheduled) ↗
            </a>
            <button
              onClick={() => { onSuccess?.(); onClose() }}
              className="w-full bg-[#1A2E45] text-[#94A3B8] rounded-xl py-3"
            >
              Done
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleSubmit}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white text-lg font-bold">List on eBay</h2>
              <button type="button" onClick={onClose} className="text-[#94A3B8] text-2xl leading-none">×</button>
            </div>

            {/* Card summary */}
            <div className="bg-[#1A2E45] rounded-xl p-3 mb-4">
              <p className="text-[#94A3B8] text-xs uppercase tracking-wide mb-2">
                {cards.length === 1 ? 'Card' : `${cards.length} Cards in lot`}
              </p>
              {cards.slice(0, 4).map(c => (
                <p key={c.id} className="text-white text-sm truncate">
                  {c.player_name} — {c.year} {c.brand} #{c.card_number}
                  {c.parallel_color ? ` · ${c.parallel_color}` : ''}
                  <span className="text-[#94A3B8] ml-1">({COND_LABELS[c.condition]})</span>
                </p>
              ))}
              {cards.length > 4 && (
                <p className="text-[#94A3B8] text-xs mt-1">…and {cards.length - 4} more</p>
              )}
            </div>

            {/* Title */}
            <label className="block mb-3">
              <span className="text-[#94A3B8] text-xs uppercase tracking-wide">
                Listing Title <span className="normal-case">({title.length}/80)</span>
              </span>
              <input
                type="text"
                maxLength={80}
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"
              />
            </label>

            {/* Price */}
            <label className="block mb-3">
              <span className="text-[#94A3B8] text-xs uppercase tracking-wide">
                {cards.length === 1 ? 'Price (USD)' : 'Lot Price (USD)'}
              </span>
              <div className="relative mt-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]">$</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="0.00"
                  required
                  className="w-full bg-[#1A2E45] text-white rounded-xl pl-8 pr-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"
                />
              </div>
            </label>

            {/* Photo URL */}
            <label className="block mb-3">
              <span className="text-[#94A3B8] text-xs uppercase tracking-wide flex justify-between">
                Photo URL
                {photoUrl && photoUrl === placeholderUrl && (
                  <span className="normal-case text-yellow-400 font-normal">using placeholder — swap in eBay</span>
                )}
              </span>
              <input
                type="url"
                value={photoUrl}
                onChange={e => setPhotoUrl(e.target.value)}
                placeholder="https://i.imgur.com/yourphoto.jpg"
                className="mt-1 w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"
              />
              <p className="text-[#4A6080] text-xs mt-1">
                {placeholderUrl
                  ? 'Placeholder pre-filled — replace with the real card photo, or swap it in eBay Seller Hub before go-live.'
                  : 'Upload to Imgur and paste the direct link, or set EBAY_PLACEHOLDER_IMAGE_URL in .env for a default.'}
              </p>
            </label>

            {/* Description (collapsible) */}
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowDesc(v => !v)}
                className="text-[#94A3B8] text-xs uppercase tracking-wide w-full text-left flex justify-between"
              >
                Description {showDesc ? '▲' : '▼'}
              </button>
              {showDesc && (
                <textarea
                  rows={6}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="mt-1 w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm font-mono"
                />
              )}
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-500/40 rounded-xl p-3 mb-3">
                <p className="text-red-400 text-xs font-semibold mb-1">eBay Error</p>
                <p className="text-red-300 text-xs break-all select-all">{error}</p>
              </div>
            )}

            <div className="bg-[#1A2E45] rounded-xl p-3 mb-4">
              <p className="text-[#94A3B8] text-xs">
                Listing goes live in 2 hours — add photos in Seller Hub before then, or cancel it if you change your mind. Shipping: USPS First Class flat rate.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3 disabled:opacity-40"
            >
              {loading ? 'Scheduling on eBay…' : 'Schedule Listing (2 hr delay)'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
