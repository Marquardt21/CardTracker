import { useEffect, useRef, useState } from 'react'
import { deleteCardPhoto, getCardPhotos, uploadCardPhoto } from '../api/client'

/**
 * Front / back photo capture for one card.
 *
 * Each tile is a plain file input with `capture="environment"`, which on an iPad
 * opens the rear camera straight away and otherwise falls back to the photo
 * library. Deliberately not getUserMedia: that needs a secure context, and the
 * app is served over plain http:// on the home network.
 *
 * Front is always the primary image — it leads on the eBay listing — so it is
 * shown first and labelled as such.
 */

const SIDES = [
  { key: 'front', label: 'Front', hint: 'Main listing photo' },
  { key: 'back',  label: 'Back',  hint: 'Optional' },
]

export default function CardPhotoCapture({ cardId, onChange, compact = false }) {
  const [photos, setPhotos]   = useState({})
  const [busy, setBusy]       = useState(null)   // which side is uploading
  const [error, setError]     = useState(null)
  // Cache-buster so a retake visibly replaces the old picture instead of the
  // browser re-showing the cached one at the same URL.
  const [stamp, setStamp]     = useState(() => Date.now())
  const inputs = useRef({})

  useEffect(() => {
    if (!cardId) return
    let cancelled = false
    getCardPhotos(cardId)
      .then(({ data }) => {
        if (cancelled) return
        setPhotos(Object.fromEntries(data.map(p => [p.side, p])))
      })
      .catch(() => { if (!cancelled) setError('Could not load photos.') })
    return () => { cancelled = true }
  }, [cardId])

  function publish(next) {
    setPhotos(next)
    setStamp(Date.now())
    onChange?.(Object.values(next))
  }

  async function handleFile(side, e) {
    const file = e.target.files?.[0]
    // Clear the input so picking the same file twice still fires a change event.
    e.target.value = ''
    if (!file) return
    setBusy(side)
    setError(null)
    try {
      const { data } = await uploadCardPhoto(cardId, side, file)
      publish({ ...photos, [side]: data })
    } catch (err) {
      setError(err.response?.data?.detail || `Could not save the ${side} photo.`)
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(side) {
    setBusy(side)
    setError(null)
    try {
      await deleteCardPhoto(cardId, side)
      const next = { ...photos }
      delete next[side]
      publish(next)
    } catch {
      setError(`Could not remove the ${side} photo.`)
    } finally {
      setBusy(null)
    }
  }

  if (!cardId) return null

  return (
    <div className="mb-5">
      {!compact && (
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-white font-semibold">Card Photos</h3>
          <span className="text-[#4A6080] text-xs">Used on the eBay listing</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {SIDES.map(({ key, label, hint }) => {
          const photo = photos[key]
          const uploading = busy === key
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => inputs.current[key]?.click()}
                disabled={uploading}
                className="relative w-full aspect-[3/4] bg-[#1A2E45] rounded-xl overflow-hidden
                           flex items-center justify-center border-2 border-dashed
                           disabled:opacity-50"
                style={{ borderColor: photo ? 'transparent' : '#2C4364' }}
                aria-label={photo ? `Retake ${label} photo` : `Take ${label} photo`}
              >
                {photo ? (
                  <img
                    src={`${photo.url}?v=${stamp}`}
                    alt={`${label} of card`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="flex flex-col items-center text-[#94A3B8]">
                    <span className="text-3xl">📷</span>
                    <span className="text-sm mt-1">Take {label}</span>
                    <span className="text-[#4A6080] text-xs mt-0.5">{hint}</span>
                  </span>
                )}
                {uploading && (
                  <span className="absolute inset-0 bg-[#0D1B2A]/70 flex items-center justify-center
                                   text-[#A8DADC] text-sm">
                    Uploading…
                  </span>
                )}
              </button>

              {/* capture="environment" opens the rear camera on iPad/iPhone. */}
              <input
                ref={el => { inputs.current[key] = el }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => handleFile(key, e)}
              />

              <div className="flex items-center justify-between mt-1 px-0.5">
                <span className="text-[#94A3B8] text-xs">
                  {label}{key === 'front' && ' · main'}
                </span>
                {photo && (
                  <button
                    type="button"
                    onClick={() => handleRemove(key)}
                    disabled={uploading}
                    className="text-[#EF4444] text-xs min-h-0 disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

      {!compact && !photos.front && (
        <p className="text-[#4A6080] text-xs mt-2">
          A front photo becomes the listing's main image. Without one, listings fall back
          to the placeholder image.
        </p>
      )}
    </div>
  )
}
