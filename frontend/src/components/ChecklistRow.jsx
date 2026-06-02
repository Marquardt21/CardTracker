import { useNavigate } from 'react-router-dom'

const TYPE_LABELS = { base: 'Base', rookie: 'RC', parallel: 'Parallel', autograph: 'Auto', patch_relic: 'Patch' }

export default function ChecklistRow({ card, onAddCard }) {
  const navigate = useNavigate()

  function handleTap() {
    if (card.owned && card.collection_card_id) {
      navigate(`/cards/${card.collection_card_id}`)
    } else {
      onAddCard(card)
    }
  }

  return (
    <div
      onClick={handleTap}
      className={`flex items-center gap-3 px-4 py-3 border-b border-[#0D1B2A] cursor-pointer active:opacity-75 ${card.owned ? 'opacity-100' : 'opacity-50'}`}
    >
      <span className="text-lg w-6 text-center flex-shrink-0">
        {card.owned ? '✅' : '○'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[#94A3B8] text-xs w-10 flex-shrink-0">#{card.card_number}</span>
          <span className="text-white text-sm font-medium truncate">{card.player_name}</span>
        </div>
        <div className="flex gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-[#94A3B8]">{TYPE_LABELS[card.card_type] || card.card_type}</span>
          {card.parallel_color && <span className="text-xs text-yellow-400">{card.parallel_color}</span>}
          {card.print_run && <span className="text-xs text-yellow-400">/{card.print_run}</span>}
          {card.team && <span className="text-xs text-[#94A3B8]">· {card.team}</span>}
        </div>
      </div>
    </div>
  )
}
