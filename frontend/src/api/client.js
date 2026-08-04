import axios from 'axios'

const client = axios.create({ baseURL: '/api', timeout: 15000 })
export default client

// Cards
export const getCards      = (p) => client.get('/cards', { params: p })
export const checkCardExists = (p) => client.get('/cards/exists', { params: p })
export const getCard       = (id) => client.get(`/cards/${id}`)
export const createCard    = (d) => client.post('/cards', d)
export const updateCard    = (id, d) => client.put(`/cards/${id}`, d)
export const deleteCard    = (id) => client.delete(`/cards/${id}`)
export const toggleWatchlist      = (id) => client.patch(`/cards/${id}/watchlist`)
export const getPriceRecommendation = (id) => client.post(`/cards/${id}/price-recommendation`)
export const updateSelling    = (id, d) => client.patch(`/selling/${id}`, d)
export const markListingSold  = (listingId, d) => client.patch(`/selling/listing/${listingId}/sold`, d)
export const getSellingDashboard = () => client.get('/selling/dashboard')
export const uploadPhoto   = (id, file) => {
  const form = new FormData()
  form.append('photo', file)
  return client.post(`/cards/${id}/photo`, form)
}

// Card photos — one per side ("front" | "back"). Front is the primary image and
// the first picture on an eBay listing. Camera captures off an iPad are several
// MB, so these get a longer timeout than the default 15s.
/** Thumbnail URL for a card's front photo.
 *  `photo_path` is a bare filename now, but databases written before that
 *  migration held a full path — from either OS — so split on both separators. */
export const photoSrc = (photoPath) =>
  photoPath ? `/photos/${String(photoPath).split(/[\\/]/).pop()}` : null

export const getCardPhotos  = (id) => client.get(`/cards/${id}/photos`)
export const uploadCardPhoto = (id, side, file) => {
  const form = new FormData()
  form.append('photo', file)
  return client.post(`/cards/${id}/photos/${side}`, form, { timeout: 120000 })
}
export const deleteCardPhoto = (id, side) => client.delete(`/cards/${id}/photos/${side}`)
export const getPhotoStatus  = () => client.get('/photos/status')
export const purgePhotos     = (dryRun = false) => client.post('/photos/purge', null, { params: { dry_run: dryRun } })

// Autocomplete
export const autocomplete  = (q, field, extra = {}) => client.get('/autocomplete', { params: { q, field, ...extra } })

// Values
export const getValues     = (id) => client.get(`/cards/${id}/values`)
export const refreshValue  = (id) => client.post(`/cards/${id}/values/refresh`)
export const getActiveListings = (id, force = false) => client.get(`/cards/${id}/active-listings`, { params: { force } })
export const getListingSummaries  = () => client.get('/listing-summaries')
export const refreshListingSummary = (id, force = false) => client.post(`/cards/${id}/listing-summary`, null, { params: { force } })
export const refreshAllValues   = () => client.post('/values/refresh-all')
export const getRefreshAllStatus = () => client.get('/values/refresh-all/status')

// Sets
export const getCardVariants = (setId, cardNumber) => client.get(`/sets/${setId}/card-variants`, { params: { card_number: cardNumber } })
export const getSets       = () => client.get('/sets')
export const searchSets    = (q) => client.get('/sets/search', { params: { q } })
export const getSet        = (id) => client.get(`/sets/${id}`)
export const deleteSet     = (id) => client.delete(`/sets/${id}`)
export const previewUrl    = (url) => client.post('/sets/preview-url', { url })
export const importUrl     = (url, overrides = {}) => client.post('/sets/import-url', { url, ...overrides })
export const reconcile     = () => client.post('/sets/reconcile')

// Grading
export const getWatchlist      = () => client.get('/grading')
export const generateGrading   = (id, service) => client.post(`/grading/${id}/generate`, { grading_service: service })

// AI selling strategy
// An agentic Claude run over the whole cohort — needs far longer than the 15s
// default: up to STRATEGY_MAX_TOOL_CALLS (15) turns, and each tool call can be a
// live eBay lookup, so a worst-case run runs for minutes.
export const analyzeStrategy    = (card_ids) => client.post('/strategy/analyze', { card_ids }, { timeout: 300000 })

// Dashboard / Alerts / Settings
export const getDashboard  = () => client.get('/dashboard')
export const getAlerts     = () => client.get('/alerts')
export const getSettings   = () => client.get('/settings')
export const exportCsv     = () => client.get('/export/csv', { responseType: 'blob' })

// eBay
export const getEbayAuthStatus  = () => client.get('/ebay/auth/status')
export const storeEbayUserToken = (token) => client.post('/ebay/auth/user-token', { token })
export const disconnectEbay     = () => client.delete('/ebay/auth/token')
export const createEbayDraft    = (d) => client.post('/ebay/listings/draft', d)
export const getEbayDrafts      = () => client.get('/ebay/listings')

// Whatnot (CSV bulk-upload export)
export const exportWhatnotCsv   = (d) => client.post('/whatnot/export', d, { responseType: 'blob' })
