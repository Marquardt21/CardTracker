export default function SetProgressBar({ owned, total, showLabel = true }) {
  const pct = total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0
  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-xs text-[#94A3B8] mb-1">
          <span>{owned} of {total} owned</span>
          <span>{pct}%</span>
        </div>
      )}
      <div className="h-2 bg-[#0D1B2A] rounded-full overflow-hidden">
        <div className="h-full bg-[#A8DADC] rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
