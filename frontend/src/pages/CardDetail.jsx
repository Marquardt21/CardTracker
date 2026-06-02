import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteCard, generateGrading, getCard, getValues, refreshValue, toggleWatchlist, updateCard, updateSelling, uploadPhoto } from '../api/client'
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
  const [photoUploading, setPhotoUploading] = useState(false)
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
  const [sellingDirty, setSellingDirty] = useState(false)
  const [sellingSaving,setSellingSaving]= useState(false)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    try {
      const [{ data: c }, { data: v }] = await Promise.all([getCard(id), getValues(id)])
      setCard(c)
      setValues(v)
      // Seed selling state from card data
      setIsSelling(c.is_selling || false)
      setListedPrice(c.listed_price != null ? String(c.listed_price) : '')
      setListingDate(c.listing_date ? c.listing_date.split('T')[0] : '')
      setListingUrl(c.listing_url || '')
      setIsSold(c.is_sold || false)
      setSoldAmount(c.sold_price != null ? String(c.sold_price) : '')
      setSoldDate(c.sold_date ? c.sold_date.split('T')[0] : '')
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
        condition: get('condition'), notes: get('notes')||null,
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

  async function handlePhoto(e) {
    const file = e.target.files?.[0]; if (!file) return
    setPhotoUploading(true)
    try { const { data } = await uploadPhoto(id, file); setCard(data) }
    catch { setError('Photo upload failed.') }
    finally { setPhotoUploading(false) }
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

  if (loading) return <div className="text-center py-16 text-[#94A3B8]">Loading…</div>
  if (!card)   return <div className="text-center py-16 text-red-400">{error || 'Card not found.'}</div>

  const photoUrl = card.photo_path ? `/photos/${card.photo_path.split('/').pop()}` : null
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

      {/* Photo */}
      <div className="mb-5 flex flex-col items-center">
        {photoUrl
          ? <img src={photoUrl} alt={card.player_name} className="max-h-64 rounded-xl object-contain bg-[#1A2E45] w-full" />
          : <div className="w-full h-40 bg-[#1A2E45] rounded-xl flex items-center justify-center text-5xl">🃏</div>}
        <label className="mt-2 cursor-pointer text-[#A8DADC] text-sm min-h-0">
          {photoUploading ? 'Uploading…' : photoUrl ? 'Change Photo' : '+ Add Photo'}
          <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} disabled={photoUploading} />
        </label>
      </div>

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

      {/* Price */}
      {latestValue
        ? <div className="bg-[#1A2E45] rounded-xl p-4 mb-4 flex justify-between items-center">
            <div>
              <p className="text-2xl font-bold text-white">${latestValue.price.toFixed(2)}</p>
              <p className="text-[#94A3B8] text-xs">{latestValue.source} · {new Date(latestValue.fetched_at).toLocaleDateString()}</p>
            </div>
            <button onClick={handleRefreshValue} className="text-[#A8DADC] text-sm border border-[#A8DADC]/30 rounded-xl px-3 py-2 min-h-0">Refresh</button>
          </div>
        : <div className="bg-[#1A2E45] rounded-xl p-4 mb-4 flex justify-between items-center">
            <p className="text-[#94A3B8] text-sm">No value yet</p>
            <button onClick={handleRefreshValue} className="text-[#A8DADC] text-sm border border-[#A8DADC]/30 rounded-xl px-3 py-2 min-h-0">Fetch Value</button>
          </div>}

      {/* Price chart */}
      {values.length > 1 && (
        <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
          <p className="text-[#94A3B8] text-xs mb-2">Price History</p>
          <PriceChart values={[...values].sort((a,b) => new Date(a.fetched_at) - new Date(b.fetched_at))} />
        </div>
      )}

      {/* Card fields */}
      <div className="bg-[#1A2E45] rounded-xl divide-y divide-[#0D1B2A] mb-4">
        {[
          ['Card #',    card.card_number],
          ['Team',      card.team],
          ['Position',  card.position],
          ['Type',      TYPE_LABELS[card.card_type]],
          ['Condition', COND_LABELS[card.condition]],
          ['Parallel',  card.parallel_color],
          ['Print Run', card.print_run ? `/${card.print_run}` : null],
          ['Matched',   card.checklist_matched ? '✓ Yes' : '✗ Not yet'],
          ['Notes',     card.notes],
        ].filter(([,v]) => v).map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-3">
            <span className="text-[#94A3B8] text-sm">{label}</span>
            <span className="text-white text-sm font-medium text-right max-w-[60%]">{value}</span>
          </div>
        ))}
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

      {/* ── Selling section ─────────────────────────────────────────────── */}
      <div className="bg-[#1A2E45] rounded-xl p-4 mb-4">
        <p className="text-white font-semibold mb-3">🏷️ Selling</p>

        {/* For Sale toggle */}
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <input type="checkbox" checked={isSelling} onChange={e => { setIsSelling(e.target.checked); if (!e.target.checked) { setIsSold(false) } setSellingDirty(true) }}
            className="w-5 h-5 rounded accent-[#A8DADC] cursor-pointer" />
          <span className="text-white text-sm font-medium">For Sale</span>
        </label>

        {/* Listing fields */}
        {isSelling && !isSold && (
          <div className="space-y-3 pl-8 mb-3">
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

        {/* Sold toggle — only visible once For Sale is checked */}
        {isSelling && (
          <label className="flex items-center gap-3 cursor-pointer mb-3">
            <input type="checkbox" checked={isSold} onChange={e => { setIsSold(e.target.checked); setSellingDirty(true) }}
              className="w-5 h-5 rounded accent-[#A8DADC] cursor-pointer" />
            <span className="text-white text-sm font-medium">Sold</span>
          </label>
        )}

        {/* Sold fields */}
        {isSold && (
          <div className="space-y-3 pl-8 mb-3">
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
          </div>
        )}

        {sellingDirty && (
          <button onClick={handleSaveSelling} disabled={sellingSaving}
            className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold py-2.5 rounded-xl text-sm disabled:opacity-40">
            {sellingSaving ? 'Saving…' : 'Save Selling Info'}
          </button>
        )}

        {/* Status badge when saved and clean */}
        {!sellingDirty && (card.is_sold
          ? <p className="text-green-400 text-xs text-center">✓ Sold{card.sold_price ? ` · $${card.sold_price.toFixed(2)}` : ''}{card.sold_date ? ` on ${new Date(card.sold_date).toLocaleDateString()}` : ''}</p>
          : card.is_selling
            ? <p className="text-yellow-300 text-xs text-center">Listed{card.listed_price ? ` · $${card.listed_price.toFixed(2)}` : ''}{card.listing_url ? <> · <a href={card.listing_url} target="_blank" rel="noreferrer" className="underline">View listing</a></> : null}</p>
            : <p className="text-[#4A6080] text-xs text-center">Not listed</p>
        )}
      </div>

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
    </div>
  )
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
