import { useRef, useState } from 'react'
import { importUrl, previewUrl } from '../api/client'

const SPORTS = ['Hockey', 'Baseball', 'Football']
const READ_ERROR = 'Could not read that URL. Use an Upper Deck checklist page or a direct link to an .xlsx checklist file.'

/**
 * URL paste → preview (editable) → confirm → import flow.
 * onImported(result) called after successful import.
 */
export default function ImportSetPanel({ onImported, onCancel }) {
  const [stage, setStage] = useState('input') // 'input' | 'preview' | 'importing'
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const urlRef = useRef()

  async function handlePreview(e) {
    e.preventDefault()
    const url = urlRef.current.value.trim()
    if (!url) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await previewUrl(url)
      setPreview({ ...data, url })
      setStage('preview')
    } catch (err) {
      setError(err.response?.data?.detail || READ_ERROR)
    } finally {
      setLoading(false)
    }
  }

  function setField(key, value) {
    setPreview(p => ({ ...p, [key]: value }))
  }

  async function handleImport() {
    setStage('importing')
    setError(null)
    try {
      const { data } = await importUrl(preview.url, {
        set_name: preview.set_name,
        brand:    preview.brand,
        year:     parseInt(preview.year) || undefined,
        sport:    preview.sport,
      })
      onImported(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Import failed.')
      setStage('preview')
    }
  }

  return (
    <div className="bg-[#1A2E45] rounded-2xl p-5">
      <h2 className="text-white font-semibold mb-1">Import Set Checklist</h2>
      <p className="text-[#94A3B8] text-sm mb-4">Paste an Upper Deck checklist URL, or a link to an .xlsx checklist file, to import the full set.</p>

      {stage === 'input' && (
        <form onSubmit={handlePreview} className="space-y-3">
          <input
            ref={urlRef}
            type="url"
            placeholder="https://upperdeck.com/checklist/2025-26-flair-hockey-checklist/"
            className="w-full bg-[#0D1B2A] text-white placeholder-[#94A3B8] rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-[#A8DADC] text-sm"
          />
          <p className="text-[#94A3B8] text-xs">
            Browse checklists at{' '}
            <a href="https://upperdeck.com/checklists/" target="_blank" rel="noreferrer" className="text-[#A8DADC] underline">
              upperdeck.com/checklists
            </a>
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3">
            {onCancel && (
              <button type="button" onClick={onCancel} className="flex-1 bg-[#0D1B2A] text-white rounded-xl py-3 text-sm">
                Cancel
              </button>
            )}
            <button type="submit" disabled={loading} className="flex-1 bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3 text-sm disabled:opacity-50">
              {loading ? 'Fetching…' : 'Preview'}
            </button>
          </div>
        </form>
      )}

      {stage === 'preview' && preview && (
        <div className="space-y-4">
          <div className="bg-[#0D1B2A] rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-[#94A3B8] text-xs mb-1">Set name</label>
              <input type="text" value={preview.set_name} onChange={e => setField('set_name', e.target.value)}
                className="w-full bg-[#1A2E45] text-white rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#A8DADC]" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[#94A3B8] text-xs mb-1">Brand</label>
                <input type="text" value={preview.brand} onChange={e => setField('brand', e.target.value)}
                  className="w-full bg-[#1A2E45] text-white rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#A8DADC]" />
              </div>
              <div>
                <label className="block text-[#94A3B8] text-xs mb-1">Year</label>
                <input type="number" value={preview.year} onChange={e => setField('year', e.target.value)}
                  className="w-full bg-[#1A2E45] text-white rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#A8DADC]" />
              </div>
            </div>
            <div>
              <label className="block text-[#94A3B8] text-xs mb-1">Sport</label>
              <select value={preview.sport} onChange={e => setField('sport', e.target.value)}
                className="w-full bg-[#1A2E45] text-white rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#A8DADC]">
                {SPORTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <p className="text-[#94A3B8] text-xs">{preview.card_count} cards found</p>
          </div>
          <p className="text-white text-sm text-center">Import this set?</p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => setStage('input')} className="flex-1 bg-[#0D1B2A] text-white rounded-xl py-3 text-sm">
              Back
            </button>
            <button onClick={handleImport} className="flex-1 bg-[#A8DADC] text-[#0D1B2A] font-semibold rounded-xl py-3 text-sm">
              Confirm Import
            </button>
          </div>
        </div>
      )}

      {stage === 'importing' && (
        <div className="text-center py-6 text-[#94A3B8]">Importing… this may take a moment.</div>
      )}
    </div>
  )
}
