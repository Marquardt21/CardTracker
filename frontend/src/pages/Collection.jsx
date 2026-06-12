import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCards, toggleWatchlist } from '../api/client'
import CreateEbayDraftModal from '../components/CreateEbayDraftModal'

const TYPE_LABELS = { base:'Base', rookie:'RC', parallel:'Parallel', autograph:'Auto', patch_relic:'Patch' }
const COND_LABELS = { poor:'Poor', good:'Good', very_good:'VG', excellent:'EX', near_mint:'NM', mint:'Mint' }

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

  useEffect(() => {
    const t = setTimeout(fetchCards, search ? 350 : 0)
    return () => clearTimeout(t)
  }, [search, showUnmatched])

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

  const selectedCards = cards.filter(c => selectedIds.has(c.id))

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

      {!loading && cards.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8]">
          <p className="text-4xl mb-4">🏒</p>
          <p className="text-lg">{showUnmatched ? 'No unmatched cards.' : 'No cards yet.'}</p>
          {!showUnmatched && <p className="text-sm mt-1">Tap <strong className="text-white">Add Card</strong> to get started.</p>}
        </div>
      )}

      <ul className="space-y-3">
        {cards.map(card => {
          const isSelected = selectedIds.has(card.id)
          return (
            <li key={card.id}
              onClick={() => handleCardClick(card)}
              className={`bg-[#1A2E45] rounded-xl p-4 flex items-center gap-3 active:opacity-75 cursor-pointer transition-all
                ${selectMode && isSelected ? 'ring-2 ring-[#A8DADC]' : ''}`}
            >
              {selectMode && (
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                  ${isSelected ? 'bg-[#A8DADC] border-[#A8DADC]' : 'border-[#4A6080]'}`}>
                  {isSelected && <span className="text-[#0D1B2A] text-xs font-bold">✓</span>}
                </div>
              )}
              {card.photo_path
                ? <img src={`/photos/${card.photo_path.split('/').pop()}`} alt={card.player_name} className="w-12 h-18 object-cover rounded-lg flex-shrink-0 h-16" />
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
                </div>
              </div>
              {!selectMode && (
                <button
                  onClick={e => handleWatchlist(e, card.id)}
                  className={`text-lg flex-shrink-0 p-2 rounded-lg ${card.grading_watchlist ? 'text-[#A8DADC]' : 'text-[#94A3B8]/40'}`}
                  title="Toggle grading watchlist"
                >🎯</button>
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
