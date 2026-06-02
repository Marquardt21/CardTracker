import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSets } from '../api/client'
import ImportSetPanel from '../components/ImportSetPanel'
import SetProgressBar from '../components/SetProgressBar'
import UnmatchedReviewModal from '../components/UnmatchedReviewModal'

export default function SetChecklists() {
  const navigate = useNavigate()
  const [sets, setSets]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [importResult, setImportResult] = useState(null)

  useEffect(() => { fetchSets() }, [])

  async function fetchSets() {
    try { const { data } = await getSets(); setSets(data) }
    finally { setLoading(false) }
  }

  function handleImported(result) {
    setImportResult(result)
    fetchSets()
  }

  return (
    <div className="pb-24 px-4 pt-6 max-w-2xl mx-auto">
      {importResult && (
        <UnmatchedReviewModal
          result={importResult.reconciliation}
          setName={importResult.set_name}
          onClose={() => setImportResult(null)}
        />
      )}

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-white">Set Checklists</h1>
        <button onClick={() => setShowImport(s => !s)}
          className="bg-[#A8DADC] text-[#0D1B2A] font-semibold px-4 py-2 rounded-xl text-sm min-h-0">
          {showImport ? 'Cancel' : '+ Add Set'}
        </button>
      </div>

      {showImport && (
        <div className="mb-5">
          <ImportSetPanel onImported={(r) => { setShowImport(false); handleImported(r) }} onCancel={() => setShowImport(false)} />
        </div>
      )}

      {loading && <p className="text-[#94A3B8] text-center py-8">Loading…</p>}

      {!loading && sets.length === 0 && !showImport && (
        <div className="text-center py-16 text-[#94A3B8]">
          <p className="text-4xl mb-4">📋</p>
          <p>No sets imported yet.</p>
          <p className="text-sm mt-1">Tap <strong className="text-white">+ Add Set</strong> to import a checklist.</p>
        </div>
      )}

      <ul className="space-y-3">
        {sets.map(s => (
          <li key={s.id} onClick={() => navigate(`/sets/${s.id}`)}
            className="bg-[#1A2E45] rounded-xl p-4 cursor-pointer active:opacity-75">
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-white font-semibold truncate">{s.set_name}</p>
                <p className="text-[#94A3B8] text-xs mt-0.5">{s.brand} · {s.year}</p>
              </div>
              <span className="text-[#94A3B8] text-xs flex-shrink-0">{s.owned_count}/{s.total_cards}</span>
            </div>
            <SetProgressBar owned={s.owned_count} total={s.total_cards} showLabel={false} />
          </li>
        ))}
      </ul>
    </div>
  )
}
