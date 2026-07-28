import { useEffect, useMemo, useState } from 'react'
import { analyzeStrategy, createEbayDraft, generateGrading, getCards, getSettings, toggleWatchlist } from '../api/client'

const TYPE_LABELS = { base:'Base', rookie:'RC', parallel:'Parallel', autograph:'Auto', patch_relic:'Patch' }

const MAX_CARDS = 50          // keep in sync with STRATEGY_MAX_CARDS in backend/config.py
const GRADING_SERVICE = 'PSA Standard'

const ACTION_LABELS = {
  list:            { label: 'List on eBay',   color: 'text-[#A8DADC]' },
  send_to_grading: { label: 'Send to Grading', color: 'text-[#EAB308]' },
  hold:            { label: 'Hold',            color: 'text-[#94A3B8]' },
}

const selectCls = "bg-[#1A2E45] text-white text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-[#A8DADC]"
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort()

export default function Strategy() {
  const [cards, setCards]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filters, setFilters]     = useState({ sport: '', set: '', cardType: '', parallel: '', player: '', team: '' })

  const [groups, setGroups]       = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError]         = useState('')

  const [checkedGroups, setCheckedGroups] = useState(new Set())
  const [executing, setExecuting]  = useState(false)
  const [results, setResults]      = useState({})   // group index -> { ok, message }
  const [placeholderUrl, setPlaceholderUrl] = useState('')

  useEffect(() => {
    // Only cards that can still be acted on — listed/sold cards can't be relisted.
    getCards()
      .then(({ data }) => setCards(data.filter(c => !c.is_selling && !c.is_sold)))
      .finally(() => setLoading(false))
    getSettings()
      .then(r => setPlaceholderUrl(r.data?.ebay_placeholder_image_url || ''))
      .catch(() => {})
  }, [])

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
  const setOptions   = useMemo(() => uniq(sportCards.map(c => c.set_name)), [sportCards])
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

  const cardsById = useMemo(() => Object.fromEntries(cards.map(c => [c.id, c])), [cards])
  const anyFilter = filters.sport || filters.set || filters.cardType || filters.parallel || filters.player || filters.team

  function toggleCard(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filteredCards.slice(0, MAX_CARDS).map(c => c.id)))
  }

  const tooMany = selectedIds.size > MAX_CARDS
  const canAnalyze = selectedIds.size > 0 && !tooMany && !analyzing

  async function handleAnalyze() {
    setAnalyzing(true)
    setError('')
    setGroups(null)
    setCheckedGroups(new Set())
    setResults({})
    try {
      const { data } = await analyzeStrategy([...selectedIds])
      setGroups(data.groups || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Analysis failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  function toggleGroup(i) {
    setCheckedGroups(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  async function executeGroup(group) {
    if (group.action === 'list') {
      if (!placeholderUrl) {
        throw new Error('No placeholder image URL — set one in Settings first (eBay requires a photo).')
      }
      await createEbayDraft({
        card_ids:         group.card_ids,
        price:            group.suggested_price,
        title:            null,
        description:      null,
        image_urls:       [placeholderUrl],
        listing_format:   group.listing_format || 'FIXED_PRICE',
        auction_duration: group.auction_duration || 'DAYS_7',
      })
      return `Listed ${group.card_ids.length} card${group.card_ids.length > 1 ? 's' : ''} on eBay.`
    }

    for (const id of group.card_ids) {
      if (!cardsById[id]?.grading_watchlist) await toggleWatchlist(id)
      await generateGrading(id, GRADING_SERVICE)
    }
    return `Added ${group.card_ids.length} card${group.card_ids.length > 1 ? 's' : ''} to the grading watchlist.`
  }

  async function handleExecute() {
    setExecuting(true)
    const indexes = [...checkedGroups]
    // Run each group independently — one failure must not block the rest.
    const settled = await Promise.allSettled(indexes.map(i => executeGroup(groups[i])))
    const next = { ...results }
    settled.forEach((r, n) => {
      const i = indexes[n]
      next[i] = r.status === 'fulfilled'
        ? { ok: true, message: r.value }
        : { ok: false, message: r.reason?.response?.data?.detail || r.reason?.message || 'Failed.' }
    })
    setResults(next)
    setCheckedGroups(new Set(indexes.filter(i => !next[i].ok)))
    setExecuting(false)
  }

  const actionableChecked = checkedGroups.size

  return (
    <div className="pb-24 px-4 pt-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-1">Strategy</h1>
      <p className="text-[#94A3B8] text-sm mb-4">
        Pick a group of cards and let AI recommend what to sell, bundle, grade or hold.
      </p>

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

      <div className="flex items-center gap-3 mb-4">
        <button onClick={selectAllFiltered}
          className="text-sm text-[#A8DADC] bg-[#1A2E45] px-3 py-2 rounded-lg min-h-[44px]">
          Select first {Math.min(filteredCards.length, MAX_CARDS)}
        </button>
        {selectedIds.size > 0 && (
          <button onClick={() => setSelectedIds(new Set())}
            className="text-sm text-[#94A3B8] bg-[#1A2E45] px-3 py-2 rounded-lg min-h-[44px]">
            Clear selection
          </button>
        )}
        {anyFilter && (
          <button onClick={() => setFilters({ sport: '', set: '', cardType: '', parallel: '', player: '', team: '' })}
            className="text-[#94A3B8] text-xs underline ml-auto">Clear filters</button>
        )}
      </div>

      {loading && <p className="text-[#94A3B8] text-center py-8">Loading…</p>}

      {!loading && filteredCards.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8]">
          <p className="text-4xl mb-4">🎯</p>
          <p className="text-lg">{anyFilter ? 'No cards match these filters.' : 'No sellable cards yet.'}</p>
        </div>
      )}

      {/* ── Cohort picker ───────────────────────────────────────────────────── */}
      <ul className="space-y-2">
        {filteredCards.map(card => {
          const isSelected = selectedIds.has(card.id)
          return (
            <li key={card.id}>
              <button onClick={() => toggleCard(card.id)}
                className={`w-full text-left bg-[#1A2E45] rounded-xl p-3 flex items-center gap-3 min-h-[44px] active:opacity-75
                  ${isSelected ? 'ring-2 ring-[#A8DADC]' : ''}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                  ${isSelected ? 'bg-[#A8DADC] border-[#A8DADC]' : 'border-[#4A6080]'}`}>
                  {isSelected && <span className="text-[#0D1B2A] text-xs font-bold">✓</span>}
                </div>
                {card.photo_path
                  ? <img src={`/photos/${card.photo_path.split('/').pop()}`} alt={card.player_name} className="w-10 h-14 object-cover rounded-lg flex-shrink-0" />
                  : <div className="w-10 h-14 bg-[#0D1B2A] rounded-lg flex-shrink-0 flex items-center justify-center text-lg">🃏</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{card.player_name}</p>
                  <p className="text-[#94A3B8] text-xs truncate">{card.year} {card.brand} · #{card.card_number}</p>
                  <p className="text-[#94A3B8] text-xs truncate">{card.set_name}</p>
                </div>
                <span className="text-xs bg-[#0D1B2A] text-[#A8DADC] px-2 py-0.5 rounded-full flex-shrink-0">
                  {TYPE_LABELS[card.card_type] || card.card_type}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {/* ── Recommendations ─────────────────────────────────────────────────── */}
      {error && <p className="text-[#EF4444] text-sm mt-4">{error}</p>}

      {groups && groups.length === 0 && (
        <p className="text-[#94A3B8] text-sm mt-6 text-center">No recommendations came back for this selection.</p>
      )}

      {groups && groups.length > 0 && (
        <div className="mt-6">
          <h2 className="text-white text-lg font-bold mb-3">Recommendations</h2>
          <ul className="space-y-3">
            {groups.map((g, i) => {
              const meta = ACTION_LABELS[g.action]
              const actionable = g.action !== 'hold'
              const checked = checkedGroups.has(i)
              const result = results[i]
              return (
                <li key={i} className={`bg-[#1A2E45] rounded-xl p-4 ${checked ? 'ring-2 ring-[#A8DADC]' : ''}`}>
                  <div className="flex items-start gap-3">
                    {actionable && (
                      <button onClick={() => toggleGroup(i)}
                        className="p-2 -m-2 min-w-[44px] min-h-[44px] flex items-start justify-center">
                        <span className={`w-5 h-5 rounded border-2 flex items-center justify-center
                          ${checked ? 'bg-[#A8DADC] border-[#A8DADC]' : 'border-[#4A6080]'}`}>
                          {checked && <span className="text-[#0D1B2A] text-xs font-bold">✓</span>}
                        </span>
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`font-semibold text-sm ${meta.color}`}>
                          {meta.label}
                          {g.action === 'list' && g.card_ids.length > 1 && ' (lot)'}
                        </span>
                        {g.action === 'list' && g.suggested_price != null && (
                          <span className="text-white font-bold text-sm whitespace-nowrap">
                            ${g.suggested_price.toFixed(2)}
                            <span className="text-[#94A3B8] font-normal text-xs ml-1">
                              {g.listing_format === 'AUCTION'
                                ? `Auction · ${(g.auction_duration || 'DAYS_7').replace('DAYS_', '')}d`
                                : 'BIN'}
                            </span>
                          </span>
                        )}
                      </div>

                      <ul className="space-y-1 mb-2">
                        {g.card_ids.map(id => {
                          const c = cardsById[id]
                          return (
                            <li key={id} className="flex items-center gap-2">
                              {c?.photo_path
                                ? <img src={`/photos/${c.photo_path.split('/').pop()}`} alt="" className="w-6 h-8 object-cover rounded flex-shrink-0" />
                                : <div className="w-6 h-8 bg-[#0D1B2A] rounded flex-shrink-0 flex items-center justify-center text-[10px]">🃏</div>
                              }
                              <span className="text-white text-xs truncate">
                                {c ? `${c.player_name} — ${c.year} ${c.set_name} #${c.card_number}` : `Card ${id}`}
                              </span>
                            </li>
                          )
                        })}
                      </ul>

                      <p className="text-[#94A3B8] text-xs">{g.reasoning}</p>

                      {result && (
                        <p className={`text-xs mt-2 ${result.ok ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                          {result.ok ? '✓ ' : '✕ '}{result.message}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <button onClick={handleExecute} disabled={actionableChecked === 0 || executing}
            className="w-full mt-4 bg-[#A8DADC] text-[#0D1B2A] font-semibold py-3 rounded-xl min-h-[44px] disabled:opacity-50">
            {executing ? 'Executing…' : `Execute Selected${actionableChecked ? ` (${actionableChecked})` : ''}`}
          </button>
        </div>
      )}

      {/* ── Analyze bar ─────────────────────────────────────────────────────── */}
      <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
        <div className="max-w-2xl mx-auto bg-[#1A2E45] border border-[#2A3E55] rounded-2xl p-3 flex items-center gap-3 shadow-xl">
          <p className="text-sm flex-1">
            {tooMany
              ? <span className="text-[#EF4444]">Select {MAX_CARDS} or fewer cards ({selectedIds.size} selected)</span>
              : selectedIds.size === 0
                ? <span className="text-[#94A3B8]">Tap cards to select</span>
                : <span className="text-white">{selectedIds.size} card{selectedIds.size > 1 ? 's' : ''} selected</span>}
          </p>
          <button onClick={handleAnalyze} disabled={!canAnalyze}
            className="bg-[#A8DADC] text-[#0D1B2A] font-semibold text-sm px-4 py-2 rounded-xl min-h-[44px] disabled:opacity-50">
            {analyzing ? 'Analyzing…' : 'Generate Strategy'}
          </button>
        </div>
      </div>
    </div>
  )
}
