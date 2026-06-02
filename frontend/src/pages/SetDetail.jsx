import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteSet, getSet } from '../api/client'
import ChecklistRow from '../components/ChecklistRow'
import ConfirmDialog from '../components/ConfirmDialog'
import SetProgressBar from '../components/SetProgressBar'

export default function SetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [set, setSet]           = useState(null)
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all') // 'all' | 'owned' | 'needed'
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { getSet(id).then(r => { setSet(r.data); setLoading(false) }).catch(() => setLoading(false)) }, [id])

  function handleAddCard(checklistCard) {
    const params = new URLSearchParams({
      player: checklistCard.player_name,
      brand:  set.brand,
      year:   String(set.year),
      set:    set.set_name,
      number: checklistCard.card_number,
      type:   checklistCard.card_type,
      ...(checklistCard.parallel_color ? { parallel: checklistCard.parallel_color } : {}),
      ...(checklistCard.print_run ? { print_run: String(checklistCard.print_run) } : {}),
      ...(checklistCard.team ? { team: checklistCard.team } : {}),
    })
    navigate(`/add?${params.toString()}`)
  }

  async function handleDelete() {
    setDeleting(true)
    try { await deleteSet(id); navigate('/sets') }
    catch { setDeleting(false); setConfirmDel(false) }
  }

  if (loading) return <div className="text-center py-16 text-[#94A3B8]">Loading…</div>
  if (!set)    return <div className="text-center py-16 text-red-400">Set not found.</div>

  const cards = set.cards || []
  const filtered = filter === 'owned'  ? cards.filter(c => c.owned)
                 : filter === 'needed' ? cards.filter(c => !c.owned)
                 : cards

  return (
    <div className="pb-24 max-w-2xl mx-auto">
      {confirmDel && (
        <ConfirmDialog
          message={`Remove "${set.set_name}" checklist? Your owned cards will not be deleted.`}
          confirmLabel={deleting ? 'Removing…' : 'Remove Set'}
          danger
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(false)}
        />
      )}

      {/* Header */}
      <div className="px-4 pt-6 pb-4 border-b border-[#1A2E45]">
        <button onClick={() => navigate('/sets')} className="text-[#A8DADC] text-sm mb-3 min-h-0">← Sets</button>
        <h1 className="text-xl font-bold text-white leading-tight">{set.set_name}</h1>
        <p className="text-[#94A3B8] text-sm mt-0.5">{set.brand} · {set.year}</p>
        {set.source_url && (
          <a href={set.source_url} target="_blank" rel="noreferrer"
            className="text-[#A8DADC] text-xs underline mt-1 inline-block min-h-0">View source ↗</a>
        )}
        <div className="mt-3">
          <SetProgressBar owned={set.owned_count} total={set.total_cards} />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 py-3 border-b border-[#1A2E45]">
        {['all','owned','needed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm capitalize min-h-0 ${filter === f ? 'bg-[#A8DADC] text-[#0D1B2A] font-semibold' : 'bg-[#1A2E45] text-[#94A3B8]'}`}>
            {f}
          </button>
        ))}
      </div>

      {/* Checklist */}
      <div>
        {filtered.length === 0 && (
          <p className="text-[#94A3B8] text-center py-8 text-sm">
            {filter === 'owned' ? 'No cards owned yet.' : filter === 'needed' ? 'You own every card in this set!' : 'No cards in this set.'}
          </p>
        )}
        {filtered.map(card => (
          <ChecklistRow key={card.id} card={card} onAddCard={handleAddCard} />
        ))}
      </div>

      {/* Delete */}
      <div className="px-4 pt-4">
        <button onClick={() => setConfirmDel(true)}
          className="w-full border border-red-500/30 text-red-400 rounded-xl py-3 text-sm">
          Remove This Set
        </button>
      </div>
    </div>
  )
}
