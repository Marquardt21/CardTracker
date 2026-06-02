export default function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#1A2E45] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <p className="text-white text-center mb-5">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 bg-[#0D1B2A] text-white rounded-xl py-3 font-semibold">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-xl py-3 font-semibold text-white ${danger ? 'bg-red-600' : 'bg-[#A8DADC] text-[#0D1B2A]'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
