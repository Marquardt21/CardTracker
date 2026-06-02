export default function GradingBadge({ verdict }) {
  const styles = {
    'Worth It':    'bg-green-500/20 text-green-400 border-green-500/30',
    'Borderline':  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    'Not Worth It':'bg-red-500/20 text-red-400 border-red-500/30',
  }
  return (
    <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${styles[verdict] || 'bg-[#1A2E45] text-[#94A3B8] border-transparent'}`}>
      {verdict}
    </span>
  )
}
