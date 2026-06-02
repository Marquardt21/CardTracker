import { forwardRef, useEffect, useRef, useState } from 'react'
import { autocomplete } from '../api/client'

const AutocompleteInput = forwardRef(function AutocompleteInput({
  label, field, value, onChange, onSelect, placeholder = '',
  fetchFn = null, renderItem = null,
}, forwardedRef) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const timerRef        = useRef(null)
  const containerRef    = useRef(null)
  const justSelectedRef = useRef(false)

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (value.length < 1) { setSuggestions([]); setOpen(false); return }
    if (justSelectedRef.current) { justSelectedRef.current = false; return }
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const fetch = fetchFn ?? ((v) => autocomplete(v, field))
        const { data } = await fetch(value)
        setSuggestions(data)
        setOpen(data.length > 0)
        setActiveIdx(-1)
      } catch { setSuggestions([]) }
      finally { setLoading(false) }
    }, 250)
    return () => clearTimeout(timerRef.current)
  }, [value, field, fetchFn])

  // Close on outside tap/click
  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler) }
  }, [])

  function handleKeyDown(e) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(suggestions[activeIdx]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  function pick(s) {
    justSelectedRef.current = true
    setOpen(false)
    setSuggestions([])
    onSelect(s)
  }

  const inputCls = "w-full bg-[#1A2E45] text-white placeholder-[#94A3B8] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC]"

  function defaultRenderItem(s, isActive) {
    return (
      <>
        <div className="text-white font-medium text-sm">{s.player_name}</div>
        <div className="text-[#94A3B8] text-xs mt-0.5">
          #{s.card_number} · {s.set_name}
          {s.card_type !== 'base' && <span className="ml-1 text-[#A8DADC]">· {s.card_type}</span>}
          {s.print_run && <span className="ml-1 text-yellow-400">· /{s.print_run}</span>}
        </div>
      </>
    )
  }

  const render = renderItem ?? defaultRenderItem

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="block text-[#94A3B8] text-sm mb-1">{label}</label>}
      <input
        ref={forwardedRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={inputCls}
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-xs">…</span>
      )}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-[#1A2E45] border border-[#A8DADC]/20 rounded-xl overflow-hidden shadow-xl max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => (
            <li
              key={s.set_checklist_card_id ?? i}
              onMouseDown={() => pick(s)}
              onTouchStart={() => pick(s)}
              className={`px-4 py-3 cursor-pointer border-b border-[#0D1B2A] last:border-0 ${i === activeIdx ? 'bg-[#A8DADC]/20' : 'active:bg-[#A8DADC]/10'}`}
            >
              {render(s, i === activeIdx)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

export default AutocompleteInput
