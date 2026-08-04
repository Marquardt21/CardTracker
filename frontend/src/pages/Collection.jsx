import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exportWhatnotCsv, getActiveListings, getCards, getListingSummaries, photoSrc, refreshListingSummary, toggleWatchlist } from '../api/client'
import CreateEbayDraftModal from '../components/CreateEbayDraftModal'

const TYPE_LABELS = { base:'Base', rookie:'RC', parallel:'Parallel', autograph:'Auto', patch_relic:'Patch' }
const COND_LABELS = { poor:'Poor', good:'Good', very_good:'VG', excellent:'EX', near_mint:'NM', mint:'Mint' }

const PRICE_CONCURRENCY = 3  // simultaneous eBay fetches when pulling prices

const selectCls = "bg-[#1A2E45] text-white text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#A8DADC]"
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort()

export default function Collection() {
  const navigate = useNavigate()
  const [cards, setCards]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [selectMode, setSelectMode]     = useState(false)
  const [selectedIds, setSelectedIds]   = useState(new Set())
  const [showDraftModal, setShowDraftModal] = useState(false)
  const [showWhatnotModal, setShowWhatnotModal] = useState(false)

  // Structured filters (applied client-side, cascading under Sport → Set)
  const [filters, setFilters] = useState({ sport: '', set: '', cardType: '', parallel: '', player: '', team: '' })

  // eBay value sort/filter (uses the high end of each card's listing range)
  const [sortBy, setSortBy]     = useState('default')  // 'default' | 'value_desc' | 'value_asc'
  const [minValue, setMinValue] = useState('')

  // eBay active-listing summaries: card_id -> { low, high, count, listings, stale }
  const [summaries, setSummaries]   = useState({})
  const [pricesLoading, setPricesLoading] = useState(false)
  const [priceProgress, setPriceProgress] = useState({ done: 0, total: 0 })
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    const t = setTimeout(fetchCards, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [search, showUnmatched])

  // Pre-populate the price column with whatever we already have cached
  useEffect(() => {
    getListingSummaries()
      .then(({ data }) => {
        const map = {}
        // Drop the (empty) listings array so `listings === undefined` means
        // "not loaded yet" — the carousel lazy-loads it on tap.
        for (const s of data) { const { listings, ...rest } = s; map[s.card_id] = rest }
        setSummaries(map)
      })
      .catch(() => {})
  }, [])

  async function fetchCards() {
    setLoading(true)
    try {
      const params = {}
      if (search) params.search = search
      if (showUnmatched) params.unmatched = true
      const { data } = await getCards(params)
      setCards(data)
      if (!showUnmatched) {
        const { data: all } = await getCards({ unmatched: true })
        setUnmatchedCount(all.length)
      }
    } finally { setLoading(false) }
  }

  async function handleWatchlist(e, id) {
    e.stopPropagation()
    const { data } = await toggleWatchlist(id)
    setCards(cs => cs.map(c => c.id === id ? data : c))
  }

  // Tap a price to expand its listing carousel. Listings aren't shipped in the
  // bulk summaries (memory), so lazy-load this one card's set on first expand.
  // getActiveListings is cache-aware — no eBay call unless the cache is stale.
  async function toggleExpand(card) {
    if (expandedId === card.id) { setExpandedId(null); return }
    setExpandedId(card.id)
    const s = summaries[card.id]
    if (s?.listings?.length) return
    try {
      const { data } = await getActiveListings(card.id)
      setSummaries(prev => ({ ...prev, [card.id]: { ...(prev[card.id] || {}), listings: data } }))
    } catch { /* leave carousel empty on error */ }
  }

  function handleCardClick(card) {
    if (selectMode) {
      if (card.is_selling || card.is_sold) return  // can't relist listed/sold cards
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.has(card.id) ? next.delete(card.id) : next.add(card.id)
        return next
      })
    } else {
      navigate(`/cards/${card.id}`)
    }
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  function setFilter(key, value) {
    setFilters(prev => {
      const next = { ...prev, [key]: value }
      // Changing the sport (or the set) resets everything below it so options stay valid
      if (key === 'sport') next.set = ''
      if (key === 'sport' || key === 'set') { next.cardType = ''; next.parallel = ''; next.player = ''; next.team = '' }
      return next
    })
  }

  // ── Cascading filter options ────────────────────────────────────────────────
  const sportCards = useMemo(
    () => filters.sport ? cards.filter(c => c.sport === filters.sport) : cards,
    [cards, filters.sport]
  )
  const sportOptions = useMemo(() => uniq(cards.map(c => c.sport)), [cards])
  const setOptions = useMemo(() => uniq(sportCards.map(c => c.set_name)), [sportCards])
  const scopedCards = useMemo(
    () => filters.set ? sportCards.filter(c => c.set_name === filters.set) : sportCards,
    [sportCards, filters.set]
  )
  const typeOptions     = useMemo(() => uniq(scopedCards.map(c => c.card_type)), [scopedCards])
  const parallelOptions = useMemo(() => uniq(scopedCards.map(c => c.parallel_color)), [scopedCards])
  const playerOptions   = useMemo(() => uniq(scopedCards.map(c => c.player_name)), [scopedCards])
  const teamOptions     = useMemo(() => uniq(scopedCards.map(c => c.team)), [scopedCards])

  const filteredCards = useMemo(() => cards.filter(c =>
    (!filters.sport    || c.sport === filters.sport) &&
    (!filters.set      || c.set_name === filters.set) &&
    (!filters.cardType || c.card_type === filters.cardType) &&
    (!filters.parallel || c.parallel_color === filters.parallel) &&
    (!filters.player   || c.player_name === filters.player) &&
    (!filters.team     || c.team === filters.team)
  ), [cards, filters])

  // Apply eBay-value min filter + sort as a display layer (price fetch still uses filteredCards)
  const displayCards = useMemo(() => {
    const min = parseFloat(minValue)
    let list = filteredCards
    if (!isNaN(min)) list = list.filter(c => (summaries[c.id]?.high ?? -Infinity) >= min)
    if (sortBy !== 'default') {
      list = [...list].sort((a, b) => {
        const va = summaries[a.id]?.high, vb = summaries[b.id]?.high
        // cards without a fetched value sort to the bottom either way
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        return sortBy === 'value_desc' ? vb - va : va - vb
      })
    }
    return list
  }, [filteredCards, summaries, sortBy, minValue])

  const anyFilter = filters.sport || filters.set || filters.cardType || filters.parallel || filters.player || filters.team
  const anyValueFilter = sortBy !== 'default' || minValue !== ''
  const selectedCards = cards.filter(c => selectedIds.has(c.id))

  // ── Pull eBay prices for the filtered cards (throttled, cache-aware) ─────────
  async function pullPrices() {
    // Only fetch cards we don't already have fresh prices for
    const targets = filteredCards.filter(c => {
      const s = summaries[c.id]
      return !s || s.stale
    })
    if (targets.length === 0) return
    setPricesLoading(true)
    setPriceProgress({ done: 0, total: targets.length })
    const queue = [...targets]
    async function worker() {
      while (queue.length) {
        const card = queue.shift()
        try {
          const { data } = await refreshListingSummary(card.id)
          setSummaries(prev => ({ ...prev, [card.id]: data }))
        } catch { /* skip on error */ }
        setPriceProgress(p => ({ ...p, done: p.done + 1 }))
      }
    }
    await Promise.all(Array.from({ length: PRICE_CONCURRENCY }, worker))
    setPricesLoading(false)
  }

  const pricedCount = filteredCards.filter(c => summaries[c.id]?.count > 0).length

  return (
    <div className="pb-24 px-4 pt-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-white">Collection</h1>
        {!selectMode
          ? <button
              onClick={() => setSelectMode(true)}
              className="text-sm text-[#A8DADC] bg-[#1A2E45] px-3 py-1.5 rounded-lg"
            >Select</button>
          : <button
              onClick={exitSelectMode}
              className="text-sm text-[#94A3B8] bg-[#1A2E45] px-3 py-1.5 rounded-lg"
            >Cancel</button>
        }
      </div>

      <input type="search" placeholder="Search player, set, brand…" value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-[#1A2E45] text-white placeholder-[#94A3B8] rounded-xl px-4 py-3 mb-3 outline-none focus:ring-2 focus:ring-[#A8DADC]" />

      {/* ── Filters: Sport → Set, then Type / Parallel / Player / Team ───────── */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select value={filters.sport} onChange={e => setFilter('sport', e.target.value)} className={`${selectCls} col-span-2`}>
          <option value="">All sports</option>
          {sportOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.set} onChange={e => setFilter('set', e.target.value)} className={`${selectCls} col-span-2`}>
          <option value="">All sets</option>
          {setOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.cardType} onChange={e => setFilter('cardType', e.target.value)} className={selectCls}>
          <option value="">Any type</option>
          {typeOptions.map(t => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
        </select>
        <select value={filters.parallel} onChange={e => setFilter('parallel', e.target.value)} className={selectCls}>
          <option value="">Any parallel</option>
          {parallelOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.player} onChange={e => setFilter('player', e.target.value)} className={selectCls}>
          <option value="">Any player</option>
          {playerOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.team} onChange={e => setFilter('team', e.target.value)} className={selectCls}>
          <option value="">Any team</option>
          {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* ── eBay value sort / filter ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className={`${selectCls} flex-1`}>
          <option value="default">Sort: Default</option>
          <option value="value_desc">eBay value: High → Low</option>
          <option value="value_asc">eBay value: Low → High</option>
        </select>
        <input type="number" inputMode="decimal" placeholder="Min $" value={minValue}
          onChange={e => setMinValue(e.target.value)}
          className="bg-[#1A2E45] text-white text-sm rounded-xl px-3 py-2 w-24 outline-none focus:ring-2 focus:ring-[#A8DADC] placeholder-[#94A3B8]" />
      </div>

      {/* ── eBay price pull ─────────────────────────────────────────────────── */}
      {!loading && filteredCards.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <button onClick={pullPrices} disabled={pricesLoading}
            className="text-sm font-medium bg-[#1A2E45] text-[#A8DADC] border border-[#A8DADC]/30 rounded-xl px-4 py-2 disabled:opacity-50">
            {pricesLoading
              ? `Fetching ${priceProgress.done}/${priceProgress.total}…`
              : `Get eBay Prices (${filteredCards.length})`}
          </button>
          {pricedCount > 0 && !pricesLoading && (
            <span className="text-[#4A6080] text-xs">{pricedCount} priced · cached 7 days</span>
          )}
          {(anyFilter || anyValueFilter) && (
            <button onClick={() => { setFilters({ sport: '', set: '', cardType: '', parallel: '', player: '', team: '' }); setSortBy('default'); setMinValue('') }}
              className="text-[#94A3B8] text-xs underline ml-auto">Clear filters</button>
          )}
        </div>
      )}

      {unmatchedCount > 0 && !selectMode && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => setShowUnmatched(false)}
            className={`px-4 py-2 rounded-full text-sm font-medium ${!showUnmatched ? 'bg-[#A8DADC] text-[#0D1B2A]' : 'bg-[#1A2E45] text-[#94A3B8]'}`}>
            All
          </button>
          <button onClick={() => setShowUnmatched(true)}
            className={`px-4 py-2 rounded-full text-sm font-medium ${showUnmatched ? 'bg-yellow-400 text-[#0D1B2A]' : 'bg-[#1A2E45] text-yellow-400'}`}>
            Unmatched ({unmatchedCount})
          </button>
        </div>
      )}

      {loading && <p className="text-[#94A3B8] text-center py-8">Loading…</p>}

      {!loading && displayCards.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8]">
          <p className="text-4xl mb-4">🏒</p>
          <p className="text-lg">
            {minValue !== '' ? 'No priced cards meet that minimum value.'
              : anyFilter ? 'No cards match these filters.'
              : showUnmatched ? 'No unmatched cards.' : 'No cards yet.'}
          </p>
          {minValue !== '' && <p className="text-sm mt-1">Tap <strong className="text-white">Get eBay Prices</strong> first to value your cards.</p>}
          {!showUnmatched && !anyFilter && minValue === '' && <p className="text-sm mt-1">Tap <strong className="text-white">Add Card</strong> to get started.</p>}
        </div>
      )}

      <ul className="space-y-3">
        {displayCards.map(card => {
          const isSelected = selectedIds.has(card.id)
          const unlistable = card.is_selling || card.is_sold
          const summary = summaries[card.id]
          const expanded = expandedId === card.id
          return (
            <li key={card.id}
              className={`bg-[#1A2E45] rounded-xl overflow-hidden transition-all
                ${selectMode && isSelected ? 'ring-2 ring-[#A8DADC]' : ''}
                ${selectMode && unlistable ? 'opacity-40' : ''}`}
            >
              <div onClick={() => handleCardClick(card)}
                className="p-4 flex items-center gap-3 active:opacity-75 cursor-pointer">
                {selectMode && (
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                    ${unlistable ? 'border-[#2A3E55] bg-transparent'
                      : isSelected ? 'bg-[#A8DADC] border-[#A8DADC]' : 'border-[#4A6080]'}`}>
                    {isSelected && <span className="text-[#0D1B2A] text-xs font-bold">✓</span>}
                  </div>
                )}
                {card.photo_path
                  ? <img src={photoSrc(card.photo_path)} alt={card.player_name} className="w-12 h-16 object-cover rounded-lg flex-shrink-0" />
                  : <div className="w-12 h-16 bg-[#0D1B2A] rounded-lg flex-shrink-0 flex items-center justify-center text-xl">🃏</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{card.player_name}</p>
                  <p className="text-[#94A3B8] text-xs truncate">{card.year} {card.brand} · #{card.card_number}</p>
                  <p className="text-[#94A3B8] text-xs truncate">{card.set_name}</p>
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    <span className="text-xs bg-[#0D1B2A] text-[#A8DADC] px-2 py-0.5 rounded-full">{TYPE_LABELS[card.card_type]}</span>
                    <span className="text-xs bg-[#0D1B2A] text-[#94A3B8] px-2 py-0.5 rounded-full">{COND_LABELS[card.condition]}</span>
                    {card.parallel_color && <span className="text-xs bg-[#0D1B2A] text-yellow-400 px-2 py-0.5 rounded-full">{card.parallel_color}</span>}
                    {card.pack_label && <span className="text-xs bg-[#0D1B2A] text-[#A8DADC] px-2 py-0.5 rounded-full">📦 {card.pack_label}</span>}
                    {!card.checklist_matched && <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2 py-0.5 rounded-full">Unmatched</span>}
                    {card.is_sold && <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">Sold</span>}
                    {card.is_selling && !card.is_sold && <span className="text-xs bg-yellow-900/40 text-yellow-300 px-2 py-0.5 rounded-full">Listed</span>}
                  </div>
                </div>

                {/* ── eBay price (right side) ──────────────────────────────── */}
                <div className="flex-shrink-0 text-right">
                  {pricesLoading && (!summary || summary.stale)
                    ? <span className="text-[#4A6080] text-xs">…</span>
                    : summary?.count > 0
                      ? <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(card) }}
                          className="text-right">
                          <span className="block text-[#A8DADC] text-sm font-bold whitespace-nowrap">
                            ${summary.low.toFixed(0)}–${summary.high.toFixed(0)}
                          </span>
                          <span className="block text-[#4A6080] text-xs">
                            {summary.count} listing{summary.count > 1 ? 's' : ''} {expanded ? '▲' : '▾'}
                          </span>
                        </button>
                      : summary
                        ? <span className="text-[#4A6080] text-xs whitespace-nowrap">No listings</span>
                        : null}
                </div>

                {!selectMode && (
                  <button
                    onClick={e => handleWatchlist(e, card.id)}
                    className={`text-lg flex-shrink-0 p-2 rounded-lg ${card.grading_watchlist ? 'text-[#A8DADC]' : 'text-[#94A3B8]/40'}`}
                    title="Toggle grading watchlist"
                  >🎯</button>
                )}
              </div>

              {/* ── Expanded live-listing carousel (lazy-loaded on tap) ─────── */}
              {expanded && summary?.listings === undefined && (
                <div className="px-4 pb-4 -mt-1 text-[#4A6080] text-xs">Loading listings…</div>
              )}
              {expanded && summary?.listings?.length === 0 && (
                <div className="px-4 pb-4 -mt-1 text-[#4A6080] text-xs">No current listings.</div>
              )}
              {expanded && summary?.listings?.length > 0 && (
                <div className="px-4 pb-4 -mt-1">
                  <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-2
                    [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {summary.listings.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="shrink-0 w-32 bg-[#0D1B2A] rounded-xl overflow-hidden active:bg-[#A8DADC]/10">
                        <div className="w-full h-32 bg-[#1A2E45] flex items-center justify-center">
                          {l.image_url
                            ? <img src={l.image_url} alt="" className="w-full h-full object-cover" />
                            : <span className="text-2xl">🃏</span>}
                        </div>
                        <div className="p-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[#A8DADC] text-sm font-bold">${l.price.toFixed(2)}</span>
                            <span className="text-[#A8DADC] text-xs">↗</span>
                          </div>
                          {l.condition && <p className="text-[#94A3B8] text-xs truncate">{l.condition}</p>}
                          <p className="text-white text-xs line-clamp-2 mt-0.5">{l.title}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* ── Select-mode action bar ── */}
      {selectMode && (
        <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
          <div className="max-w-2xl mx-auto bg-[#1A2E45] border border-[#2A3E55] rounded-2xl p-3 flex items-center gap-3 shadow-xl">
            <p className="text-white text-sm flex-1">
              {selectedIds.size === 0
                ? 'Tap cards to select'
                : `${selectedIds.size} card${selectedIds.size > 1 ? 's' : ''} selected`}
            </p>
            {selectedIds.size > 0 && (
              <>
                <button
                  onClick={() => setShowWhatnotModal(true)}
                  className="bg-[#1A2E45] text-[#A8DADC] border border-[#A8DADC]/40 font-semibold text-sm px-4 py-2 rounded-xl"
                >
                  Export to Whatnot
                </button>
                <button
                  onClick={() => setShowDraftModal(true)}
                  className="bg-[#A8DADC] text-[#0D1B2A] font-semibold text-sm px-4 py-2 rounded-xl"
                >
                  List on eBay
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showDraftModal && selectedCards.length > 0 && (
        <CreateEbayDraftModal
          cards={selectedCards}
          onClose={() => setShowDraftModal(false)}
          onSuccess={() => { exitSelectMode(); fetchCards() }}
        />
      )}

      {showWhatnotModal && selectedCards.length > 0 && (
        <ExportWhatnotModal
          cards={selectedCards}
          onClose={() => setShowWhatnotModal(false)}
          onSuccess={() => { exitSelectMode(); fetchCards() }}
        />
      )}
    </div>
  )
}

function ExportWhatnotModal({ cards, onClose, onSuccess }) {
  const [startPrice, setStartPrice] = useState('1.00')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  async function handleExport() {
    const price = parseFloat(startPrice)
    if (isNaN(price) || price <= 0) { setError('Enter a starting bid greater than 0.'); return }
    setBusy(true)
    setError('')
    try {
      const resp = await exportWhatnotCsv({ card_ids: cards.map(c => c.id), start_price: price })

      // Trigger the file download from the returned blob
      const disp = resp.headers['content-disposition'] || ''
      const match = disp.match(/filename="?([^"]+)"?/)
      const filename = match ? match[1] : 'whatnot-export.csv'
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      const missing = parseInt(resp.headers['x-whatnot-missing-images'] || '0', 10)
      if (missing > 0) {
        alert(`${cards.length} card${cards.length > 1 ? 's' : ''} exported.\n\n${missing} card${missing > 1 ? 's have' : ' has'} no public image URL — add photos in Whatnot after importing the CSV.`)
      }
      onSuccess()
    } catch (err) {
      // Error bodies come back as a blob because responseType is 'blob'
      let detail = 'Export failed.'
      try {
        const text = await err.response?.data?.text?.()
        if (text) detail = JSON.parse(text).detail || detail
      } catch { /* keep default */ }
      setError(detail)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-[#1A2E45] rounded-2xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-white text-lg font-bold mb-1">Export to Whatnot</h2>
        <p className="text-[#94A3B8] text-sm mb-4">
          {cards.length} card{cards.length > 1 ? 's' : ''} → one Auction listing each. Downloads a CSV you
          import in Whatnot Seller Hub → Bulk Upload, then assign to your show.
        </p>

        <label className="block text-[#94A3B8] text-xs mb-1">Opening bid (per card)</label>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-white">$</span>
          <input type="number" inputMode="decimal" step="0.01" min="0.01" value={startPrice}
            onChange={e => setStartPrice(e.target.value)}
            className="flex-1 bg-[#0D1B2A] text-white rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#A8DADC]" />
        </div>

        {error && <p className="text-[#EF4444] text-sm mb-3">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy}
            className="flex-1 bg-[#0D1B2A] text-[#94A3B8] font-medium py-3 rounded-xl disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleExport} disabled={busy}
            className="flex-1 bg-[#A8DADC] text-[#0D1B2A] font-semibold py-3 rounded-xl disabled:opacity-50">
            {busy ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}
