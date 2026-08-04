import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { autocomplete, checkCardExists, createCard, getActiveListings, searchSets } from '../api/client'
import AutocompleteInput from '../components/AutocompleteInput'
import CardPhotoCapture from '../components/CardPhotoCapture'
import CreateEbayDraftModal from '../components/CreateEbayDraftModal'
import ImportSetPanel from '../components/ImportSetPanel'
import UnmatchedReviewModal from '../components/UnmatchedReviewModal'

const CARD_TYPES  = ['base', 'rookie', 'parallel', 'autograph', 'patch_relic']
const CONDITIONS  = ['poor', 'good', 'very_good', 'excellent', 'near_mint', 'mint']
const SPORTS      = ['Hockey', 'Baseball', 'Football']
const TYPE_LABELS = { base: 'Base', rookie: 'Rookie', parallel: 'Parallel', autograph: 'Autograph', patch_relic: 'Patch / Relic' }
const COND_LABELS = { poor: 'Poor', good: 'Good', very_good: 'Very Good', excellent: 'Excellent', near_mint: 'Near Mint', mint: 'Mint' }

const inputCls  = "w-full bg-[#1A2E45] text-white placeholder-[#94A3B8] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]"
const selectCls = "w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]"

export default function AddCard() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const prefillFromUrl = {
    playerName:    params.get('player') || '',
    brand:         params.get('brand') || '',
    year:          params.get('year') || '',
    setName:       params.get('set') || '',
    cardNumber:    params.get('number') || '',
    cardType:      params.get('type') || 'base',
    parallelColor: params.get('parallel') || '',
    printRun:      params.get('print_run') || '',
    team:          params.get('team') || '',
    sport:         params.get('sport') || 'Hockey',
    packLabel:     params.get('pack') || '',
  }

  // ── Step 1: Set ─────────────────────────────────────────────────────────────
  const [setQuery,        setSetQuery]        = useState(prefillFromUrl.setName)
  const [setOptions,      setSetOptions]      = useState([])
  const [setOpen,         setSetOpen]         = useState(false)
  const [setActive,       setSetActive]       = useState(-1)
  const [selectedSet,     setSelectedSet]     = useState(null)
  const setTimerRef      = useRef(null)
  const setContainerRef  = useRef(null)
  const cardNumberRef    = useRef(null)
  const [selectedYear,    setSelectedYear]    = useState(prefillFromUrl.year || '')

  // ── Step 2: Card number + variant selection ─────────────────────────────────
  const [cardNumber,    setCardNumber]    = useState(prefillFromUrl.cardNumber)
  const [cardType,      setCardType]      = useState(prefillFromUrl.cardType || 'base')
  const [parallelColor, setParallelColor] = useState(prefillFromUrl.parallelColor || '')
  const [sport,         setSport]         = useState(prefillFromUrl.sport || 'Hockey')

  // ── Uncontrolled fields (remounted via formKey when prefill changes) ─────────
  const [prefill,  setPrefill]  = useState(prefillFromUrl)
  const [formKey,  setFormKey]  = useState(0)

  // ── Recently sold ────────────────────────────────────────────────────────────
  const [showSoldSection, setShowSoldSection] = useState(false)

  // ── Misc ────────────────────────────────────────────────────────────────────
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState(null)
  const [savedCard,    setSavedCard]    = useState(null)
  // Photos captured for the just-saved card, so the listing modal can show what
  // it's about to publish with.
  const [savedPhotos,  setSavedPhotos]  = useState([])
  const [duplicates,   setDuplicates]   = useState(null)
  const [pendingSave,  setPendingSave]  = useState(null)
  const [showImport,   setShowImport]   = useState(false)
  const [importResult, setImportResult] = useState(null)

  // ── Live eBay listings + List-on-eBay flow for the just-saved card ───────────
  const [activeListings,  setActiveListings]  = useState(null)
  const [listingsLoading, setListingsLoading] = useState(false)
  const [listingsError,   setListingsError]   = useState(false)
  const [showListModal,   setShowListModal]   = useState(false)
  const [listed,          setListed]          = useState(false)

  // Auto-load active eBay listings whenever a card is saved
  useEffect(() => {
    if (!savedCard) { setActiveListings(null); return }
    let cancelled = false
    setListingsLoading(true)
    setListingsError(false)
    setActiveListings(null)
    getActiveListings(savedCard.id)
      .then(({ data }) => { if (!cancelled) setActiveListings(data) })
      .catch(() => { if (!cancelled) setListingsError(true) })
      .finally(() => { if (!cancelled) setListingsLoading(false) })
    return () => { cancelled = true }
  }, [savedCard])

  // ── Set autocomplete ─────────────────────────────────────────────────────────
  function handleSetInput(e) {
    const q = e.target.value
    setSetQuery(q)
    setSelectedSet(null)
    clearTimeout(setTimerRef.current)

    if (q.length < 2) { setSetOptions([]); setSetOpen(false); return }

    setTimerRef.current = setTimeout(async () => {
      try {
        const { data } = await searchSets(q)
        setSetOptions(data)
        setSetOpen(data.length > 0)
        setSetActive(-1)
      } catch {}
    }, 250)
  }

  function handleSetKeyDown(e) {
    if (!setOpen) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSetActive(i => Math.min(i + 1, setOptions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSetActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && setActive >= 0) { e.preventDefault(); pickSet(setOptions[setActive]) }
    else if (e.key === 'Escape') setSetOpen(false)
  }

  function pickSet(set) {
    setSetQuery(set.set_name)
    setSelectedSet(set)
    setSetOpen(false)
    setSelectedYear(String(set.year))
    setSport(set.sport || 'Hockey')
    setPrefill(p => ({ ...p, brand: set.brand }))
    setFormKey(k => k + 1)
    setCardNumber('')
    setCardType('base')
    setParallelColor('')
    setTimeout(() => cardNumberRef.current?.focus(), 0)
  }

  useEffect(() => {
    const handler = (e) => { if (!setContainerRef.current?.contains(e.target)) setSetOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [])

  // ── Card number autocomplete: filtered by selected set ───────────────────────
  const cardFetchFn = useCallback((q) => {
    const extra = {}
    const currentSetName = selectedSet?.set_name || (setQuery.length >= 2 ? setQuery : null)
    const currentYear    = selectedYear ? parseInt(selectedYear) : null
    if (currentSetName) extra.set_name = currentSetName
    if (currentYear)    extra.year = currentYear
    return autocomplete(q, 'card_number', extra)
  }, [selectedSet, setQuery, selectedYear])

  // Selecting from the card number dropdown fills ALL fields immediately
  function handleCardSelect(s) {
    setCardNumber(s.card_number)
    setCardType(s.card_type || 'base')
    setParallelColor(s.parallel_color || '')
    if (!selectedSet) {
      setSetQuery(s.set_name)
      setSelectedYear(String(s.year))
    }
    setPrefill({
      playerName:    s.player_name,
      brand:         s.brand || prefill.brand,
      year:          String(s.year),
      setName:       s.set_name,
      cardNumber:    s.card_number,
      cardType:      s.card_type || 'base',
      parallelColor: s.parallel_color || '',
      printRun:      s.print_run ? String(s.print_run) : '',
      team:          s.team || '',
      packLabel:     prefill.packLabel || '',
    })
    setFormKey(k => k + 1)
  }

  function renderCardItem(s) {
    return (
      <>
        <div className="text-white font-medium text-sm">
          #{s.card_number} — {s.player_name}
        </div>
        <div className="text-[#94A3B8] text-xs mt-0.5">
          {TYPE_LABELS[s.card_type] ?? s.card_type}
          {s.parallel_color && <span className="text-[#A8DADC] ml-1">· {s.parallel_color}</span>}
          {s.print_run      && <span className="text-yellow-400 ml-1">· /{s.print_run}</span>}
        </div>
      </>
    )
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault()
    const fd  = new FormData(e.target)
    const get = k => fd.get(k)?.toString().trim() || null

    const playerNameVal = get('player_name')
    if (!playerNameVal) { setError('Player name is required'); return }

    const yearVal    = parseInt(selectedYear || get('year') || new Date().getFullYear())
    const setNameVal = selectedSet?.set_name || setQuery || get('set_name') || ''
    const effectiveType = parallelColor && cardType === 'base' ? 'parallel' : cardType

    const payload = {
      player_name:      playerNameVal,
      brand:            get('brand') || 'Upper Deck',
      year:             yearVal,
      set_name:         setNameVal,
      card_number:      cardNumber || get('card_number') || '',
      team:             get('team') || null,
      card_type:        effectiveType,
      sport:            sport,
      parallel_color:   parallelColor || null,
      print_run:        get('print_run') ? parseInt(get('print_run')) : null,
      condition:        get('condition') || 'near_mint',
      pack_label:       get('pack_label') || null,
      notes:            get('notes') || null,
      sold_date:        get('sold_date') ? new Date(get('sold_date')).toISOString() : null,
      sold_price:       get('sold_price') ? parseFloat(get('sold_price')) : null,
      sold_listing_url: get('sold_listing_url') || null,
    }

    setError(null)
    try {
      const { data: existing } = await checkCardExists({
        set_name:       payload.set_name,
        card_number:    payload.card_number,
        parallel_color: payload.parallel_color ?? undefined,
      })
      if (existing.length > 0) {
        setDuplicates(existing)
        setPendingSave(payload)
        return
      }
    } catch {}

    await doSave(payload)
  }

  async function doSave(payload) {
    setSaving(true)
    setError(null)
    try {
      const { data } = await createCard(payload)
      setSavedCard(data)
      setDuplicates(null)
      setPendingSave(null)
    } catch {
      setError('Failed to save card. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setSavedCard(null); setSavedPhotos([]); setDuplicates(null); setPendingSave(null); setListed(false)
    setSetQuery(''); setSetOptions([]); setSetOpen(false); setSetActive(-1)
    setSelectedSet(null); setSelectedYear('')
    setCardNumber(''); setCardType('base'); setParallelColor(''); setSport('Hockey')
    setShowSoldSection(false)
    setPrefill({ playerName: '', brand: '', year: '', setName: '', cardNumber: '', cardType: 'base', parallelColor: '', printRun: '', team: '', packLabel: '' })
    setError(null)
    setFormKey(k => k + 1)
  }

  function addAnother() {
    // Keep the set and pack from the card just saved; clear everything else
    setSavedCard(null); setSavedPhotos([]); setDuplicates(null); setPendingSave(null); setListed(false)
    setCardNumber(''); setCardType('base'); setParallelColor('')
    setShowSoldSection(false)
    setPrefill(p => ({ playerName: '', brand: p.brand, year: p.year, setName: p.setName, cardNumber: '', cardType: 'base', parallelColor: '', printRun: '', team: '', packLabel: p.packLabel }))
    setError(null)
    setFormKey(k => k + 1)
    setTimeout(() => cardNumberRef.current?.focus(), 0)
  }

  if (showImport) {
    return (
      <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
        <button onClick={() => setShowImport(false)} className="text-[#A8DADC] text-sm mb-4 min-h-0">← Back</button>
        <ImportSetPanel
          onImported={(result) => { setShowImport(false); setImportResult(result) }}
          onCancel={() => setShowImport(false)}
        />
      </div>
    )
  }

  return (
    <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
      {importResult && (
        <UnmatchedReviewModal
          result={importResult.reconciliation}
          setName={importResult.set_name}
          onClose={() => setImportResult(null)}
        />
      )}

      <h1 className="text-2xl font-bold text-white mb-1">Add a Card</h1>
      <p className="text-[#94A3B8] text-sm mb-5">
        Pick the set, then enter a card number — select a version from the dropdown to auto-fill.
      </p>

      {savedCard && (
        <div className="bg-green-900/30 border border-green-500/30 rounded-xl p-4 mb-5">
          <p className="text-green-400 font-semibold text-sm mb-1">Card saved!</p>
          <p className="text-[#94A3B8] text-xs mb-4">
            {savedCard.player_name} · #{savedCard.card_number} · {savedCard.set_name}
          </p>

          {/* ── Photos ────────────────────────────────────────────────────
              The card has an id now, so the camera can be used before listing —
              shoot front and back here and the listing picks them up. */}
          <div className="bg-[#1A2E45] rounded-xl p-3 mb-4">
            <p className="text-white font-semibold text-sm mb-2">Photos</p>
            <CardPhotoCapture cardId={savedCard.id} compact onChange={setSavedPhotos} />
          </div>

          {/* ── Current eBay listings (live) ──────────────────────────────── */}
          <div className="bg-[#1A2E45] rounded-xl p-3 mb-4">
            <p className="text-white font-semibold text-sm mb-2">Current eBay Listings</p>

            {listingsLoading && (
              <p className="text-[#94A3B8] text-sm">Fetching active listings…</p>
            )}
            {listingsError && (
              <p className="text-[#94A3B8] text-sm">Couldn't load listings — eBay may be rate-limiting.</p>
            )}
            {!listingsLoading && !listingsError && activeListings?.length === 0 && (
              <p className="text-[#94A3B8] text-sm">No active listings found for this card.</p>
            )}

            {activeListings?.length > 0 && (
              <>
                <p className="text-[#4A6080] text-xs mb-2">Live asking prices (closest matches first) — tap to verify on eBay.</p>
                <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-2
                  [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {activeListings.map((l, i) => (
                    <a key={i} href={l.url} target="_blank" rel="noreferrer"
                      className="snap-start shrink-0 w-36 bg-[#0D1B2A] rounded-xl overflow-hidden active:bg-[#A8DADC]/10">
                      <div className="w-full h-36 bg-[#1A2E45] flex items-center justify-center">
                        {l.image_url
                          ? <img src={l.image_url} alt="" className="w-full h-full object-cover" />
                          : <span className="text-2xl">🃏</span>}
                      </div>
                      <div className="p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[#A8DADC] text-base font-bold">${l.price.toFixed(2)}</span>
                          <span className="text-[#A8DADC] text-xs">↗</span>
                        </div>
                        {l.condition && <p className="text-[#94A3B8] text-xs truncate">{l.condition}</p>}
                        <p className="text-white text-xs line-clamp-2 mt-0.5">{l.title}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ── List on eBay ──────────────────────────────────────────────── */}
          {listed ? (
            <div className="bg-[#0D1B2A] rounded-xl p-3 mb-4 text-center">
              <p className="text-yellow-300 text-sm font-medium">Listed on eBay ✓</p>
            </div>
          ) : (
            <button type="button" onClick={() => setShowListModal(true)}
              className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-2.5 text-sm mb-4">
              🏷️ List on eBay
            </button>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={addAnother}
              className="flex-1 bg-[#1A2E45] text-white rounded-xl py-2.5 text-sm font-medium">
              Add Another
            </button>
            <button type="button" onClick={() => navigate(`/cards/${savedCard.id}`)}
              className="flex-1 bg-[#A8DADC] text-[#0D1B2A] rounded-xl py-2.5 text-sm font-semibold">
              View Card
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">

        {/* ── Set / Series ─────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[#94A3B8] text-sm mb-1">Set / Series</label>
          <div ref={setContainerRef} className="relative">
            <input
              type="text"
              value={setQuery}
              onChange={handleSetInput}
              onKeyDown={handleSetKeyDown}
              placeholder="e.g. Flair, Allure, SP"
              autoComplete="off"
              className={inputCls}
            />
            {selectedSet && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-lg select-none">✓</span>
            )}
            {setOpen && setOptions.length > 0 && (
              <ul className="absolute z-50 left-0 right-0 mt-1 bg-[#1A2E45] border border-[#A8DADC]/20 rounded-xl overflow-hidden shadow-xl max-h-64 overflow-y-auto">
                {setOptions.map((s, i) => (
                  <li
                    key={s.id}
                    onMouseDown={() => pickSet(s)}
                    onTouchStart={() => pickSet(s)}
                    className={`px-4 py-3 cursor-pointer border-b border-[#0D1B2A] last:border-0 ${i === setActive ? 'bg-[#A8DADC]/20' : 'active:bg-[#A8DADC]/10'}`}
                  >
                    <div className="text-white text-sm font-medium">{s.set_name}</div>
                    <div className="text-[#94A3B8] text-xs mt-0.5">{s.brand} · {s.year} · {s.total_cards} cards</div>
                  </li>
                ))}
              </ul>
            )}
            {setQuery.length >= 2 && setOptions.length === 0 && !setOpen && (
              <div className="mt-2 bg-yellow-900/30 border border-yellow-500/30 rounded-xl p-3 text-sm">
                <p className="text-yellow-300 mb-2">No imported set matches "{setQuery}".</p>
                <button type="button" onClick={() => setShowImport(true)}
                  className="text-yellow-300 underline text-xs">
                  Import a set checklist URL →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Card Number ───────────────────────────────────────────────────── */}
        <AutocompleteInput
          ref={cardNumberRef}
          label="Card Number"
          field="card_number"
          value={cardNumber}
          onChange={setCardNumber}
          onSelect={handleCardSelect}
          placeholder="e.g. 42 — pick a version from the list"
          fetchFn={cardFetchFn}
          renderItem={renderCardItem}
        />

        {/* ── Sport ────────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[#94A3B8] text-sm mb-1">Sport</label>
          <select value={sport} onChange={e => setSport(e.target.value)} className={selectCls}>
            {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* ── Type ─────────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[#94A3B8] text-sm mb-1">Type</label>
          <select value={cardType} onChange={e => setCardType(e.target.value)} className={selectCls}>
            {CARD_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        {/* ── Parallel ─────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[#94A3B8] text-sm mb-1">Parallel</label>
          <input
            type="text"
            value={parallelColor}
            onChange={e => {
              const val = e.target.value
              setParallelColor(val)
              if (val.trim() && cardType === 'base') setCardType('parallel')
            }}
            placeholder="e.g. Blue Ice, Gold /99"
            className={inputCls}
          />
        </div>

        {/* ── Card details (keyed individually so only these remount on prefill change) */}
        <UField key={`player-${formKey}`} label="Player Name *" name="player_name" defaultValue={prefill.playerName} placeholder="e.g. Connor McDavid" />
        <UField key={`brand-${formKey}`}  label="Brand"         name="brand"       defaultValue={prefill.brand || 'Upper Deck'} />
        <UField key={`team-${formKey}`}   label="Team"          name="team"        defaultValue={prefill.team} />
        <UField key={`pack-${formKey}`}   label="Pulled from (pack)" name="pack_label" defaultValue={prefill.packLabel} placeholder="e.g. Week 3 Pack 2 — optional" />

        <div key={`condition-${formKey}`}>
          <label className="block text-[#94A3B8] text-sm mb-1">Condition</label>
          <select name="condition" defaultValue="near_mint" className={selectCls}>
            {CONDITIONS.map(c => <option key={c} value={c}>{COND_LABELS[c]}</option>)}
          </select>
        </div>

        <UField key={`print-${formKey}`} label="Print Run" name="print_run" defaultValue={prefill.printRun} type="number" placeholder="e.g. 99" />
        <UField key={`notes-${formKey}`} label="Notes"     name="notes"     multiline />

        {/* ── Recently Sold ─────────────────────────────────────────────────── */}
        <div className="border-t border-[#1A2E45] pt-4">
          <button
            type="button"
            onClick={() => setShowSoldSection(s => !s)}
            className="flex items-center gap-2 text-[#94A3B8] hover:text-white text-sm font-medium transition-colors"
          >
            <span className={`text-xs transition-transform duration-200 inline-block ${showSoldSection ? 'rotate-90' : ''}`}>▶</span>
            Recently Sold
            {!showSoldSection && <span className="text-[#4A6080] text-xs">(optional)</span>}
          </button>

          {showSoldSection && (
            <div className="mt-3 space-y-3 bg-[#0D1B2A]/50 rounded-xl p-4">
              <UField label="Date Sold" name="sold_date" type="date" defaultValue={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()} />
              <UField label="Sale Price ($)" name="sold_price" type="number" placeholder="e.g. 45.00" />
              <div>
                <label className="block text-[#94A3B8] text-sm mb-1">
                  Listing URL <span className="text-[#4A6080] text-xs">(optional)</span>
                </label>
                <input
                  name="sold_listing_url"
                  type="url"
                  placeholder="https://www.ebay.com/itm/…"
                  className={inputCls}
                />
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {duplicates && (
          <div className="bg-yellow-900/30 border border-yellow-500/40 rounded-xl p-4 space-y-3">
            <p className="text-yellow-300 font-semibold text-sm">This card is already in your collection</p>
            {duplicates.map(d => (
              <div key={d.id} className="bg-[#0D1B2A] rounded-lg px-3 py-2 text-sm">
                <p className="text-white font-medium">{d.player_name}</p>
                <p className="text-[#94A3B8] text-xs">
                  #{d.card_number} · {d.set_name}
                  {d.parallel_color && ` · ${d.parallel_color}`}
                  {` · Added ${new Date(d.date_added).toLocaleDateString()}`}
                </p>
              </div>
            ))}
            <div className="flex gap-3 pt-1">
              <button type="button"
                onClick={() => { setDuplicates(null); setPendingSave(null) }}
                className="flex-1 bg-[#1A2E45] text-white rounded-xl py-2.5 text-sm">
                Cancel
              </button>
              <button type="button"
                onClick={() => doSave(pendingSave)}
                disabled={saving}
                className="flex-1 bg-yellow-500/80 text-[#0D1B2A] font-semibold rounded-xl py-2.5 text-sm disabled:opacity-40">
                {saving ? 'Saving…' : 'Save Anyway'}
              </button>
            </div>
          </div>
        )}

        {!duplicates && (
          <button type="submit" disabled={saving}
            className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold py-3 rounded-xl disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Card'}
          </button>
        )}
      </form>

      {showListModal && savedCard && (
        <CreateEbayDraftModal
          cards={[savedCard]}
          onClose={() => setShowListModal(false)}
          onSuccess={() => setListed(true)}
        />
      )}
    </div>
  )
}

function UField({ label, name, defaultValue = '', placeholder = '', type = 'text', multiline = false }) {
  const cls = "w-full bg-[#1A2E45] text-white placeholder-[#94A3B8] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]"
  return (
    <div>
      {label && <label className="block text-[#94A3B8] text-sm mb-1">{label}</label>}
      {multiline
        ? <textarea name={name} defaultValue={defaultValue} placeholder={placeholder} rows={3} className={cls + ' resize-none'} />
        : <input name={name} type={type} defaultValue={defaultValue} placeholder={placeholder} className={cls} />}
    </div>
  )
}
