import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCards, getListingSummaries, refreshListingSummary, toggleWatchlist } from '../api/client'
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

  // Structured filters (applied client-side, cascading under Set)
  const [filters, setFilters] = useState({ set: '', cardType: '', parallel: '', player: '', team: '' })

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
        for (const s of data) map[s.card_id] = s
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
      // Changing the set resets the dependent filters so options stay valid
      if (key === 'set') { next.cardType = ''; next.parallel = ''; next.player = ''; next.team = '' }
      return next
    })
  }

  // ── Cascading filter options ────────────────────────────────────────────────
  const setOptions = useMemo(() => uniq(cards.map(c => c.set_name)), [cards])
  const scopedCards = useMemo(
    () => filters.set ? cards.filter(c => c.set_name === filters.set) : cards,
    [cards, filters.set]
  )
  const typeOptions     = useMemo(() => uniq(scopedCards.map(c => c.card_type)), [scopedCards])
  const parallelOptions = useMemo(() => uniq(scopedCards.map(c => c.parallel_color)), [scopedCards])
  const playerOptions   = useMemo(() => uniq(scopedCards.map(c => c.player_name)), [scopedCards])
  const teamOptions     = useMemo(() => uniq(scopedCards.map(c => c.team)), [scopedCards])

  const filteredCards = useMemo(() => cards.filter(c =>
    (!filters.set      || c.set_name === filters.set) &&
    (!filters.cardType || c.card_type === filters.cardType) &&
    (!filters.parallel || c.parallel_color === filters.parallel) &&
    (!filters.player   || c.player_name === filters.player) &&
    (!filters.team     || c.team === filters.team)
  ), [cards, filters])

  const anyFilter = filters.set || filters.cardType || filters.parallel || filters.player || filters.team
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

      {/* ── Filters: Set first, then Type / Parallel / Player / Team ─────────── */}
      <div className="grid grid-cols-2 gap-2 mb-3">
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
          {anyFilter && (
            <button onClick={() => setFilters({ set: '', cardType: '', parallel: '', player: '', team: '' })}
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

      {!loading && filteredCards.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8]">
          <p className="text-4xl mb-4">🏒</p>
          <p className="text-lg">
            {anyFilter ? 'No cards match these filters.' : showUnmatched ? 'No unmatched cards.' : 'No cards yet.'}
          </p>
          {!showUnmatched && !anyFilter && <p className="text-sm mt-1">Tap <strong className="text-white">Add Card</strong> to get started.</p>}
        </div>
      )}

      <ul className="space-y-3">
        {filteredCards.map(card => {
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
                  ? <img src={`/photos/${card.photo_path.split('/').pop()}`} alt={card.player_name} className="w-12 h-16 object-cover rounded-lg flex-shrink-0" />
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
                          onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : card.id) }}
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

              {/* ── Expanded live-listing carousel ──────────────────────────── */}
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
              <button
                onClick={() => setShowDraftModal(true)}
                className="bg-[#A8DADC] text-[#0D1B2A] font-semibold text-sm px-4 py-2 rounded-xl"
              >
                List on eBay
              </button>
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
    </div>
  )
}
