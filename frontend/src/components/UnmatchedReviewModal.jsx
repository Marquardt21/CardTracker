import { useNavigate } from 'react-router-dom'

export default function UnmatchedReviewModal({ result, setName, onClose }) {
  const navigate = useNavigate()

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#1A2E45] w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-[#0D1B2A]">
          <h2 className="text-white font-semibold">Import Complete — {setName}</h2>
          <div className="flex gap-4 mt-2 text-sm">
            <span className="text-green-400">✓ {result.newly_matched} cards matched</span>
            {result.still_unmatched > 0 && (
              <span className="text-yellow-400">⚠ {result.still_unmatched} still unmatched</span>
            )}
          </div>
        </div>

        {result.still_unmatched > 0 && (
          <div className="flex-1 overflow-y-auto">
            <p className="text-[#94A3B8] text-sm px-5 py-3">
              These cards in your collection didn't match any entry in the imported set:
            </p>
            <ul>
              {result.unmatched_cards.map(card => (
                <li
                  key={card.id}
                  onClick={() => { onClose(); navigate(`/cards/${card.id}`) }}
                  className="px-5 py-3 border-b border-[#0D1B2A] cursor-pointer active:opacity-75"
                >
                  <p className="text-white text-sm font-medium">{card.player_name}</p>
                  <p className="text-[#94A3B8] text-xs">{card.year} {card.brand} · #{card.card_number}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.still_unmatched === 0 && (
          <p className="text-[#94A3B8] text-sm px-5 py-6 text-center">All your collection cards matched successfully.</p>
        )}

        <div className="p-4 border-t border-[#0D1B2A]">
          <button onClick={onClose} className="w-full bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
