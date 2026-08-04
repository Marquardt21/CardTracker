import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteCard, generateGrading, getActiveListings, getCard, getPriceRecommendation, getValues, refreshValue, toggleWatchlist, updateCard, updateSelling } from '../api/client'
import CardPhotoCapture from '../components/CardPhotoCapture'
import CreateEbayDraftModal from '../components/CreateEbayDraftModal'
import GradingBadge from '../components/GradingBadge'
import PriceChart from '../components/PriceChart'

const COND_LABELS = { poor:'Poor', good:'Good', very_good:'Very Good', excellent:'Excellent', near_mint:'Near Mint', mint:'Mint' }
const TYPE_LABELS = { base:'Base', rookie:'Rookie', parallel:'Parallel', autograph:'Autograph', patch_relic:'Patch / Relic' }
const TYPES = ['base','rookie','parallel','autograph','patch_relic']
const CONDS = ['poor','good','very_good','excellent','near_mint','mint']

export default function CardDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [card, setCard]       = useState(null)
  const [values, setValues]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [gradingRec, setGradingRec] = useState(null)
  const [gradingLoading, setGradingLoading] = useState(false)
  const [error, setError]     = useState(null)

  // Selling section state — initialised once card loads
  const [isSelling,    setIsSelling]    = useState(false)
  const [listedPrice,  setListedPrice]  = useState('')
  const [listingDate,  setListingDate]  = useState('')
  const [listingUrl,   setListingUrl]   = useState('')
  const [isSold,       setIsSold]       = useState(false)
  const [soldAmount,   setSoldAmount]   = useState('')
  const [soldDate,     setSoldDate]     = useState('')
  const [sellingDirty,  setSellingDirty]  = useState(false)
  const [sellingSaving, setSellingSaving] = useState(false)
  const [ebayFeeRate,   setEbayFeeRate]   = useState('13.25')
  const [priceRec,      setPriceRec]      = useState(null)
  const [priceRecLoading, setPriceRecLoading] = useState(false)

  // Active eBay listings (live, not stored)
  const [activeListings, setActiveListings] = useState(null)
  const [listingsLoading, setListingsLoading] = useState(false)
  const [listingsError, setListingsError]     = useState(false)

  // Create-listing modal
  const [showListModal, setShowListModal] = useState(false)

  useEffect(() => { fetchAll() }, [id])
  useEffect(() => { loadActiveListings() }, [id])

  async function loadActiveListings(force = false) {
    setListingsLoading(true)
    setListingsError(false)
    try {
      const { data } = await getActiveListings(id, force)
      setActiveListings(data)
    } catch {
      setListingsError(true)
    } finally {
      setListingsLoading(false)
    }
  }

  async function fetchAll() {
    try {
      const [{ data: c }, { data: v }] = await Promise.all([getCard(id), getValues(id)])
      setCard(c)
      setValues(v)
      // Seed selling state from card data
      setIsSelling(c.is_selling || false)
      setListedPrice(c.listed_price != null ? String(c.listed_price) : '')
      const today = localDateStr(new Date())
      setListingDate(c.listing_date ? c.listing_date.split('T')[0] : today)
      setListingUrl(c.listing_url || '')
      setIsSold(c.is_sold || false)
      setSoldAmount(c.sold_price != null ? String(c.sold_price) : '')
      setSoldDate(c.sold_date ? c.sold_date.split('T')[0] : today)
      setSellingDirty(false)
    } catch { setError('Card not found.') }
    finally { setLoading(false) }
  }

  async function handleSave(e) {
    e.preventDefault()
    const fd = new FormData(e.target)
    const get = k => fd.get(k)?.toString().trim() || null
    setSaving(true)
    try {
      const parallelColor = get('parallel_color')
      const rawType = get('card_type')
      const effectiveType = parallelColor && rawType === 'base' ? 'parallel' : rawType
      const { data } = await updateCard(id, {
        brand: get('brand'), year: parseInt(get('year')), set_name: get('set_name'),
        card_number: get('card_number'), player_name: get('player_name'),
        team: get('team')||null, position: get('position')||null,
        card_type: effectiveType, parallel_color: parallelColor||null,
        print_run: get('print_run') ? parseInt(get('print_run')) : null,
        condition: get('condition'), pack_label: get('pack_label')||null, notes: get('notes')||null,
      })
      setCard(data)
      setEditing(false)
    } catch { setError('Save failed.') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try { await deleteCard(id); navigate('/cards') }
    catch { setError('Delete failed.'); setDeleting(false); setConfirmDel(false) }
  }

  // Capture writes photo_path server-side (the front photo doubles as the
  // collection thumbnail), so re-read the card after a change.
  async function refreshCard() {
    try { const { data } = await getCard(id); setCard(data) } catch { /* keep showing what we have */ }
  }

  async function handleWatchlist() {
    const { data } = await toggleWatchlist(id)
    setCard(data)
  }

  async function handleRefreshValue() {
    const { data } = await refreshValue(id)
    if (data) setValues(v => [data, ...v])
  }

  async function handleGenerateGrading() {
    setGradingLoading(true)
    try { const { data } = await generateGrading(id, 'PSA Standard'); setGradingRec(data) }
    catch { setError('Could not generate grading recommendation — no price data available.') }
    finally { setGradingLoading(false) }
  }

  async function handleSaveSelling() {
    setSellingSaving(true)
    try {
      const payload = {
        is_selling:   isSelling && !isSold,
        listed_price: listedPrice ? parseFloat(listedPrice) : null,
        listing_date: listingDate ? new Date(listingDate).toISOString() : null,
        listing_url:  listingUrl || null,
        is_sold:      isSold,
        sold_price:   isSold && soldAmount ? parseFloat(soldAmount) : null,
        sold_date:    isSold && soldDate ? new Date(soldDate).toISOString() : null,
      }
      const { data } = await updateSelling(id, payload)
      setCard(data)
      setSellingDirty(false)
    } catch { setError('Failed to save selling info.') }
    finally { setSellingSaving(false) }
  }

  async function handleGetRecommendation() {
    setPriceRecLoading(true)
    setPriceRec(null)
    try {
      const { data } = await getPriceRecommendation(id)
      setPriceRec(data)
    } catch { setPriceRec({ error: 'Failed to get recommendation.' }) }
    finally { setPriceRecLoading(false) }
  }

  if (loading) return <div className="text-center py-16 text-[#94A3B8]">Loading…</div>
  if (!card)   return <div className="text-center py-16 text-red-400">{error || 'Card not found.'}</div>

  const latestValue = values.length ? values.reduce((a, b) => new Date(a.fetched_at) > new Date(b.fetched_at) ? a : b) : null

  if (editing) {
    return (
      <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
        <button onClick={() => { setEditing(false); setError(null) }} className="text-[#A8DADC] text-sm mb-4 min-h-0">← Cancel</button>
        <h1 className="text-xl font-bold text-white mb-4">Edit Card</h1>
        <form key={`edit-${card.id}`} onSubmit={handleSave} className="space-y-4">
          {[['Player Name','player_name','text'],['Brand','brand','text'],['Set / Series','set_name','text'],
            ['Card Number','card_number','text'],['Year','year','number'],['Team','team','text'],['Position','position','text']
          ].map(([lbl,name,type]) => (
            <div key={name}>
              <label className="block text-[#94A3B8] text-sm mb-1">{lbl}</label>
              <input name={name} type={type} defaultValue={card[name]??''}
                className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]" />
            </div>
          ))}
          <div><label className="block text-[#94A3B8] text-sm mb-1">Card Type</label>
            <select name="card_type" defaultValue={card.card_type}
              className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]">
              {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select></div>
          <div><label className="block text-[#94A3B8] text-sm mb-1">Condition</label>
            <select name="condition" defaultValue={card.condition}
              className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]">
              {CONDS.map(c => <option key={c} value={c}>{COND_LABELS[c]}</option>)}
            </select></div>
          <div><label className="block text-[#94A3B8] text-sm mb-1">Parallel Color</label>
            <input name="parallel_color" defaultValue={card.parallel_color??''}
              className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]" /></div>
          <div><label className="block text-[#94A3B8] text-sm mb-1">Print Run</label>
            <input name="print_run" type="number" defaultValue={card.print_run??''}
              className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]" /></div>
          <div><label className="block text-[#94A3B8] text-sm mb-1">Pulled from (pack)</label>
            <input name="pack_label" defaultValue={card.pack_label??''} placeholder="e.g. Week 3 Pack 2"
              className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]" /></div>
          <div><label className="block text-[#94A3B8] text-sm mb-1">Notes</label>
            <textarea name="notes" rows={3} defaultValue={card.notes??''}
              className="w-full bg-[#1A2E45] text-white rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] resize-none" /></div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" disabled={saving}
            className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold py-3 rounded-xl disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
      <button onClick={() => navigate('/cards')} className="text-[#A8DADC] text-sm mb-4 min-h-0">← Collection</button>

      {/* Photos — front and back, captured from the iPad camera */}
      <CardPhotoCapture cardId={card.id} onChange={() => refreshCard()} />

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{card.player_name}</h1>
          <p className="text-[#94A3B8] text-sm">{card.year} {card.brand} · {card.set_name}</p>
        </div>
        <button onClick={handleWatchlist}
          className={`text-2xl p-1 rounded-lg ${card.grading_watchlist ? 'text-[#A8DADC]' : 'text-[#94A3B8]/40'}`}
          title="Toggle grading watchlist">🎯</button>
      </div>

      {/* ── Card Info ────────────────────────────────────────────────────── */}
      <div className="bg-[#1A2E45] rounded-xl divide-y divide-[#0D1B2A] mb-4">
        {[
          ['Card #',    card.card_number],
          ['Team',      card.team],
          ['Type',      TYPE_LABELS[card.card_type]],
          ['Condition', COND_LABELS[card.condition]],
          ['Parallel',  card.parallel_color],
          ['Print Run', card.print_run ? `/${card.print_run}` : null],
          ['Matched',   card.checklist_matched ? '✓ Yes' : '✗ Not yet'],
          ['Pulled from', card.pack_label],
          ['Notes',     card.notes],
        ].filter(([,v]) => v).map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-3">
            <span className="text-[#94A3B8] text-sm">{label}</span>
            <span className="text-white text-sm font-medium text-right max-w-[60%]">{value}</span>
          </div>
        ))}
      </div>

      {/* ── eBay Price Data ───────────────────────────────────────────────── */}
      <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-white font-semibold text-sm">eBay Price Data</p>
          <button onClick={handleRefreshValue}
            className="text-[#A8DADC] text-xs border border-[#A8DADC]/30 rounded-lg px-2.5 py-1.5 min-h-0">
            Refresh
          </button>
        </div>

        {values.length === 0 ? (
          <div className="space-y-1">
            <p className="text-[#94A3B8] text-sm">No sold data available yet.</p>
            <p className="text-[#4A6080] text-xs">
              Sold price lookup requires eBay Marketplace Insights API access.
              Apply at developer.ebay.com → your app → Marketplace Insights.
            </p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-3 gap-2 px-2 pb-1 border-b border-[#0D1B2A] mb-1">
              <span className="text-[#94A3B8] text-xs font-medium">Type</span>
              <span className="text-[#94A3B8] text-xs font-medium text-right">Amount</span>
              <span className="text-[#94A3B8] text-xs font-medium text-right">Date</span>
            </div>

            {/* My listed price row */}
            {card.listed_price && !card.is_sold && (
              <div className="grid grid-cols-3 gap-2 px-2 py-2 border-b border-[#0D1B2A]/50">
                <span className="text-yellow-300 text-xs">My Listing</span>
                <span className="text-yellow-300 text-sm font-semibold text-right">${card.listed_price.toFixed(2)}</span>
                <span className="text-[#94A3B8] text-xs text-right">
                  {card.listing_date ? new Date(card.listing_date).toLocaleDateString() : '—'}
                </span>
              </div>
            )}

            {/* eBay sold rows */}
            {[...values]
              .sort((a, b) => new Date(b.fetched_at) - new Date(a.fetched_at))
              .map((v) => (
                <div key={v.id} className="grid grid-cols-3 gap-2 px-2 py-2 border-b border-[#0D1B2A]/50 last:border-0">
                  <span className="text-green-400 text-xs">Sold</span>
                  <span className="text-white text-sm font-medium text-right">${v.price.toFixed(2)}</span>
                  <span className="text-[#94A3B8] text-xs text-right">{new Date(v.fetched_at).toLocaleDateString()}</span>
                </div>
              ))}
          </>
        )}
      </div>

      {/* Price chart */}
      {values.length > 1 && (
        <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
          <p className="text-[#94A3B8] text-xs mb-2">Price History</p>
          <PriceChart values={[...values].sort((a,b) => new Date(a.fetched_at) - new Date(b.fetched_at))} />
        </div>
      )}

      {/* ── Current eBay listings (live) ──────────────────────────────────── */}
      <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-white font-semibold text-sm">Current eBay Listings</p>
          <button onClick={() => loadActiveListings(true)} disabled={listingsLoading}
            className="text-[#A8DADC] text-xs border border-[#A8DADC]/30 rounded-lg px-2.5 py-1.5 min-h-0 disabled:opacity-40">
            {listingsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {listingsLoading && !activeListings && (
          <p className="text-[#94A3B8] text-sm">Fetching active listings…</p>
        )}
        {listingsError && (
          <p className="text-[#94A3B8] text-sm">Couldn't load listings — eBay may be rate-limiting. Try Refresh.</p>
        )}
        {!listingsLoading && !listingsError && activeListings?.length === 0 && (
          <p className="text-[#94A3B8] text-sm">No active listings found for this card.</p>
        )}

        {activeListings?.length > 0 && (
          <div>
            <p className="text-[#4A6080] text-xs mb-2">Live asking prices (closest matches first) — swipe and tap to verify on eBay.</p>
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
          </div>
        )}
      </div>

      {/* ── Selling section ─────────────────────────────────────────────── */}
      <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
        <p className="text-white font-semibold mb-3">🏷️ Selling</p>

        {/* ── List on eBay (create a real listing) ──────────────────────── */}
        {card.is_sold ? (
          <div className="bg-[#0D1B2A] rounded-xl p-3 mb-4 text-center">
            <p className="text-green-400 text-sm font-medium">Sold ✓</p>
          </div>
        ) : card.is_selling ? (
          <div className="bg-[#0D1B2A] rounded-xl p-3 mb-4 flex items-center justify-between">
            <span className="text-yellow-300 text-sm font-medium">Listed on eBay</span>
            {card.listing_url && (
              <a href={card.listing_url} target="_blank" rel="noreferrer"
                className="text-[#A8DADC] text-xs underline">View listing ↗</a>
            )}
          </div>
        ) : (
          <button onClick={() => setShowListModal(true)}
            className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3 text-sm mb-4">
            🏷️ List on eBay
          </button>
        )}

        {/* ── For Sale (manual tracking) ────────────────────────────────── */}
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input type="checkbox" checked={isSelling} onChange={e => {
            setIsSelling(e.target.checked)
            if (!e.target.checked) setIsSold(false)
            setSellingDirty(true)
          }} className="w-5 h-5 rounded accent-[#A8DADC] cursor-pointer" />
          <span className="text-white text-sm font-medium">For Sale</span>
        </label>

        {isSelling && (
          <div className="space-y-3 pl-8 mb-4">
            <Field label="Listed Price ($)">
              <input type="number" min="0" step="0.01" value={listedPrice}
                onChange={e => { setListedPrice(e.target.value); setSellingDirty(true) }}
                placeholder="e.g. 75.00" className={inp} />
            </Field>
            <Field label="Listing Date">
              <input type="date" value={listingDate}
                onChange={e => { setListingDate(e.target.value); setSellingDirty(true) }}
                className={inp} />
            </Field>
            <Field label={<>Listing URL <span className="text-[#4A6080] text-xs">(optional)</span></>}>
              <input type="url" value={listingUrl}
                onChange={e => { setListingUrl(e.target.value); setSellingDirty(true) }}
                placeholder="https://www.ebay.com/itm/…" className={inp} />
            </Field>
          </div>
        )}

        {/* ── AI recommendation ──────────────────────────────────────────── */}
        <div className="mb-4">
          <button onClick={handleGetRecommendation} disabled={priceRecLoading}
            className="w-full bg-[#0D1B2A] text-[#A8DADC] border border-[#A8DADC]/30 rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
            {priceRecLoading ? 'Asking AI…' : '✦ Get AI Price Recommendation'}
          </button>
          {priceRec && !priceRec.error && (
            <div className="mt-3 bg-[#0D1B2A] rounded-xl p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[#94A3B8] text-xs">Recommended</span>
                <span className="text-[#A8DADC] text-xl font-bold">${priceRec.recommended_price.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#94A3B8] text-xs">Range</span>
                <span className="text-white text-sm">${priceRec.price_range_low.toFixed(2)} – ${priceRec.price_range_high.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#94A3B8] text-xs">Confidence</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  priceRec.confidence === 'high'   ? 'bg-green-900/40 text-green-400' :
                  priceRec.confidence === 'medium' ? 'bg-yellow-900/40 text-yellow-300' :
                                                      'bg-red-900/40 text-red-400'
                }`}>{priceRec.confidence}</span>
              </div>
              <p className="text-[#94A3B8] text-xs pt-2 border-t border-[#1A2E45] leading-relaxed">{priceRec.reasoning}</p>
            </div>
          )}
          {priceRec?.error && <p className="text-red-400 text-xs mt-2 text-center">{priceRec.error}</p>}
        </div>

        {/* ── Sold ──────────────────────────────────────────────────────── */}
        <div className="border-t border-[#0D1B2A] pt-3">
          <label className="flex items-center gap-3 cursor-pointer mb-3">
            <input type="checkbox" checked={isSold} onChange={e => {
              setIsSold(e.target.checked)
              if (e.target.checked && !isSelling) setIsSelling(true)
              setSellingDirty(true)
            }} className="w-5 h-5 rounded accent-green-400 cursor-pointer" />
            <span className="text-white text-sm font-medium">Sold</span>
          </label>

          {isSold && (() => {
            const soldNum  = parseFloat(soldAmount) || 0
            const feeRate  = parseFloat(ebayFeeRate) || 0
            const feeAmt   = (soldNum * feeRate / 100) + 0.30
            const profit   = soldNum - feeAmt
            return (
              <div className="pl-8 space-y-3">
                <Field label="Sold Amount ($)">
                  <input type="number" min="0" step="0.01" value={soldAmount}
                    onChange={e => { setSoldAmount(e.target.value); setSellingDirty(true) }}
                    placeholder="e.g. 62.00" className={inp} />
                </Field>
                <Field label="Sold Date">
                  <input type="date" value={soldDate}
                    onChange={e => { setSoldDate(e.target.value); setSellingDirty(true) }}
                    className={inp} />
                </Field>

                {soldNum > 0 && (
                  <div className="bg-[#0D1B2A] rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[#94A3B8] text-xs">Sold Amount</span>
                      <span className="text-white text-sm">${soldNum.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#94A3B8] text-xs whitespace-nowrap">eBay Fee</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min="0" max="100" step="0.01"
                          value={ebayFeeRate}
                          onChange={e => setEbayFeeRate(e.target.value)}
                          className="w-16 bg-[#1A2E45] text-white text-xs rounded-lg px-2 py-1 outline-none text-right"
                        />
                        <span className="text-[#94A3B8] text-xs">% + $0.30</span>
                        <span className="text-red-400 text-sm ml-1">-${feeAmt.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-[#1A2E45] pt-2">
                      <span className="text-white text-sm font-medium">Net Profit</span>
                      <span className={`text-sm font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {sellingDirty && (
          <button onClick={handleSaveSelling} disabled={sellingSaving}
            className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold py-2.5 rounded-xl text-sm disabled:opacity-40 mt-4">
            {sellingSaving ? 'Saving…' : 'Save'}
          </button>
        )}

        {!sellingDirty && (
          <p className="text-xs text-center mt-2">
            {card.is_sold
              ? <span className="text-green-400">✓ Sold{card.sold_price ? ` · $${card.sold_price.toFixed(2)}` : ''}{card.sold_date ? ` on ${new Date(card.sold_date).toLocaleDateString()}` : ''}</span>
              : card.is_selling
                ? <span className="text-yellow-300">Listed{card.listed_price ? ` · $${card.listed_price.toFixed(2)}` : ''}</span>
                : <span className="text-[#4A6080]">Not listed</span>
            }
          </p>
        )}
      </div>

      {/* Grading section */}
      {card.grading_watchlist && (
        <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
          <p className="text-white font-semibold mb-3">🎯 Grading Analysis</p>
          {gradingRec ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#94A3B8]">Raw Value</span>
                <span className="text-white">${latestValue?.price.toFixed(2) || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#94A3B8]">Est. Graded Value</span>
                <span className="text-white">${gradingRec.estimated_graded_value.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#94A3B8]">Grading Cost</span>
                <span className="text-white">${gradingRec.grading_cost_estimate}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#94A3B8]">Net ROI</span>
                <span className={gradingRec.roi_estimate > 0 ? 'text-green-400' : 'text-red-400'}>
                  ${gradingRec.roi_estimate.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-[#0D1B2A]">
                <span className="text-[#94A3B8] text-sm">Verdict</span>
                <GradingBadge verdict={gradingRec.verdict} />
              </div>
            </div>
          ) : (
            <button onClick={handleGenerateGrading} disabled={gradingLoading || !latestValue}
              className="w-full bg-[#0D1B2A] text-[#A8DADC] rounded-xl py-2 text-sm disabled:opacity-40">
              {gradingLoading ? 'Calculating…' : latestValue ? 'Generate Recommendation' : 'Fetch a price first'}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      <div className="space-y-3">
        <button onClick={() => { setEditing(true); setError(null) }}
          className="w-full bg-[#1A2E45] text-white font-semibold py-3 rounded-xl">Edit Card</button>
        {!confirmDel
          ? <button onClick={() => setConfirmDel(true)}
              className="w-full border border-red-500/40 text-red-400 font-semibold py-3 rounded-xl">Delete Card</button>
          : <div className="bg-red-900/20 border border-red-500/40 rounded-xl p-4">
              <p className="text-red-300 text-sm text-center mb-3">Delete this card permanently?</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDel(false)} className="flex-1 bg-[#1A2E45] text-white py-2 rounded-xl text-sm">Cancel</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="flex-1 bg-red-600 text-white py-2 rounded-xl text-sm disabled:opacity-40">
                  {deleting ? 'Deleting…' : 'Yes, Delete'}
                </button>
              </div>
            </div>}
      </div>

      {showListModal && (
        <CreateEbayDraftModal
          cards={[card]}
          onClose={() => setShowListModal(false)}
          onSuccess={() => { fetchAll() }}
        />
      )}
    </div>
  )
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function priceLabel(v) {
  return `Sold ${new Date(v.fetched_at).toLocaleDateString()}`
}

const inp = "w-full bg-[#0D1B2A] text-white placeholder-[#94A3B8] rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[#94A3B8] text-xs mb-1">{label}</label>
      {children}
    </div>
  )
}
