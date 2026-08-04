import { useEffect, useState } from 'react'
import { createEbayDraft, getCardPhotos, getSettings } from '../api/client'

const COND_LABELS = { poor: 'Poor', good: 'Good', very_good: 'VG', excellent: 'EX', near_mint: 'NM', mint: 'Mint' }
const AUCTION_DURATIONS = [['DAYS_1', '1 day'], ['DAYS_3', '3 days'], ['DAYS_5', '5 days'], ['DAYS_7', '7 days'], ['DAYS_10', '10 days']]
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
  const [format, setFormat]         = useState('FIXED_PRICE')  // FIXED_PRICE | AUCTION
  const [duration, setDuration]     = useState('DAYS_7')
  const [price, setPrice]           = useState('')
  const [description, setDescription] = useState(() => buildDescription(cards))
  const [photoUrl, setPhotoUrl]     = useState('')
  const [placeholderUrl, setPlaceholderUrl] = useState('')
  const [photoCustom, setPhotoCustom] = useState(false)
  // Photos captured in the app for these cards. When there are any, they are
  // what gets listed — the backend uploads them to eBay Picture Services and
  // uses the front shots as the lead images.
  const [cardPhotos, setCardPhotos] = useState([])
  const [photosLoading, setPhotosLoading] = useState(true)
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

  // Every call site builds the `cards` array inline, so it is a new reference on
  // each render — keying the fetch on the ids keeps this from refetching
  // forever.
  const cardIdsKey = cards.map(c => c.id).join(',')

  useEffect(() => {
    let cancelled = false
    setPhotosLoading(true)
    Promise.all(cardIdsKey.split(',').filter(Boolean).map(id =>
      getCardPhotos(id).then(r => r.data).catch(() => [])
    )).then(perCard => {
      if (cancelled) return
      // Front photos of every card first, then the backs — the order eBay
      // receives them in, so the listing leads with card fronts.
      const flat = perCard.flat()
      setCardPhotos([
        ...flat.filter(p => p.side === 'front'),
        ...flat.filter(p => p.side === 'back'),
      ])
      setPhotosLoading(false)
    })
    return () => { cancelled = true }
  }, [cardIdsKey])

  // An explicit URL always wins; otherwise captured photos are used if present.
  const usingCardPhotos = !photoCustom && cardPhotos.length > 0

  const worstCond = cards.reduce((worst, c) =>
    (COND_RANK[c.condition] ?? 5) > (COND_RANK[worst] ?? 5) ? c.condition : worst,
    cards[0]?.condition
  )

  async function handleSubmit(e) {
    e.preventDefault()
    const p = parseFloat(price)
    if (!p || p <= 0) { setError('Enter a valid price.'); return }
    if (!usingCardPhotos && !photoUrl.trim()) {
      setError('This listing has no pictures. Take a front photo on the card, or paste a public HTTPS image URL.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data } = await createEbayDraft({
        card_ids:       cards.map(c => c.id),
        price:          p,
        title:          title.trim() || undefined,
        description:    description.trim() || undefined,
        // Empty means "use the cards' own photos" — the backend uploads them to
        // eBay and fills in the URLs.
        image_urls:     usingCardPhotos ? [] : [photoUrl.trim()],
        listing_format: format,
        auction_duration: duration,
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
              Goes live in ~30 minutes. Review or cancel it in Seller Hub before then.
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

            {/* Format: Buy It Now / Auction */}
            <div className="mb-3">
              <span className="text-[#94A3B8] text-xs uppercase tracking-wide">Format</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {[['FIXED_PRICE', 'Buy It Now'], ['AUCTION', 'Auction']].map(([val, label]) => (
                  <button
                    type="button"
                    key={val}
                    onClick={() => setFormat(val)}
                    className={`rounded-xl py-2.5 text-sm font-medium ${
                      format === val
                        ? 'bg-[#A8DADC] text-[#0D1B2A]'
                        : 'bg-[#1A2E45] text-[#94A3B8]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auction duration */}
            {format === 'AUCTION' && (
              <label className="block mb-3">
                <span className="text-[#94A3B8] text-xs uppercase tracking-wide">Duration</span>
                <select
                  value={duration}
                  onChange={e => setDuration(e.target.value)}
                  className="mt-1 w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"
                >
                  {AUCTION_DURATIONS.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </label>
            )}

            {/* Price */}
            <label className="block mb-3">
              <span className="text-[#94A3B8] text-xs uppercase tracking-wide">
                {format === 'AUCTION'
                  ? (cards.length === 1 ? 'Starting Bid (USD)' : 'Lot Starting Bid (USD)')
                  : (cards.length === 1 ? 'Price (USD)' : 'Lot Price (USD)')}
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

            {/* Photo */}
            {photosLoading ? (
              <div className="mb-3 bg-[#1A2E45] rounded-xl px-4 py-3">
                <p className="text-[#94A3B8] text-sm">Checking for card photos…</p>
              </div>
            ) : usingCardPhotos ? (
              <div className="mb-3 bg-[#1A2E45] rounded-xl px-4 py-3">
                <p className="text-[#94A3B8] text-sm">
                  📷 Using your card photo{cardPhotos.length > 1 ? 's' : ''} ({cardPhotos.length})
                </p>
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1
                  [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {cardPhotos.map((p, i) => (
                    <div key={`${p.url}-${i}`} className="shrink-0 relative">
                      <img src={p.url} alt={p.side}
                        className="w-14 h-[74px] object-cover rounded-lg bg-[#0D1B2A]" />
                      {i === 0 && (
                        <span className="absolute -top-1 -left-1 bg-[#A8DADC] text-[#0D1B2A]
                                         text-[9px] font-bold px-1 rounded">MAIN</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[#4A6080] text-xs mt-1.5">
                  Uploaded to eBay when the listing is created. Front is the main image.
                </p>
                <button type="button"
                  onClick={() => { setPhotoCustom(true); setPhotoUrl('') }}
                  className="text-[#A8DADC] text-xs underline mt-2">
                  Use a custom photo URL instead
                </button>
              </div>
            ) : placeholderUrl && !photoCustom ? (
              <div className="mb-3 bg-[#1A2E45] rounded-xl px-4 py-3">
                <p className="text-[#94A3B8] text-sm">📷 Using placeholder image</p>
                <p className="text-[#4A6080] text-xs mt-0.5">
                  No photos captured for {cards.length > 1 ? 'these cards' : 'this card'} — take a front photo on the
                  card's page to list with the real thing.
                </p>
                <button type="button"
                  onClick={() => { setPhotoCustom(true); setPhotoUrl('') }}
                  className="text-[#A8DADC] text-xs underline mt-2">
                  Use a custom photo URL instead
                </button>
              </div>
            ) : (
              <label className="block mb-3">
                <span className="text-[#94A3B8] text-xs uppercase tracking-wide">Photo URL</span>
                <input
                  type="url"
                  value={photoUrl}
                  onChange={e => setPhotoUrl(e.target.value)}
                  placeholder="https://i.imgur.com/yourphoto.jpg"
                  className="mt-1 w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"
                />
                <p className="text-[#4A6080] text-xs mt-1">
                  Public HTTPS link (Imgur or GitHub raw).
                  {cardPhotos.length > 0 && (
                    <button type="button"
                      onClick={() => { setPhotoCustom(false); setPhotoUrl('') }}
                      className="text-[#A8DADC] underline ml-1">Use card photos</button>
                  )}
                  {placeholderUrl && cardPhotos.length === 0 && (
                    <button type="button"
                      onClick={() => { setPhotoCustom(false); setPhotoUrl(placeholderUrl) }}
                      className="text-[#A8DADC] underline ml-1">Use placeholder</button>
                  )}
                </p>
              </label>
            )}

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
                Listing goes live in 30 minutes — review or cancel it in Seller Hub before then.
                {format === 'AUCTION' ? ` Auction runs ${AUCTION_DURATIONS.find(([v]) => v === duration)?.[1]}.` : ''} Shipping: USPS First Class flat rate.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3 disabled:opacity-40"
            >
              {loading ? 'Scheduling on eBay…' : 'Schedule Listing (30 min delay)'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
