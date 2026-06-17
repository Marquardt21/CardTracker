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

// Autocomplete
export const autocomplete  = (q, field, extra = {}) => client.get('/autocomplete', { params: { q, field, ...extra } })

// Values
export const getValues     = (id) => client.get(`/cards/${id}/values`)
export const refreshValue  = (id) => client.post(`/cards/${id}/values/refresh`)
export const getActiveListings = (id) => client.get(`/cards/${id}/active-listings`)
export const refreshAllValues   = () => client.post('/values/refresh-all')
export const getRefreshAllStatus = () => client.get('/values/refresh-all/status')

// Sets
export const getCardVariants = (setId, cardNumber) => client.get(`/sets/${setId}/card-variants`, { params: { card_number: cardNumber } })
export const getSets       = () => client.get('/sets')
export const searchSets    = (q) => client.get('/sets/search', { params: { q } })
export const getSet        = (id) => client.get(`/sets/${id}`)
export const deleteSet     = (id) => client.delete(`/sets/${id}`)
export const previewUrl    = (url) => client.post('/sets/preview-url', { url })
export const importUrl     = (url) => client.post('/sets/import-url', { url })
export const reconcile     = () => client.post('/sets/reconcile')

// Grading
export const getWatchlist      = () => client.get('/grading')
export const generateGrading   = (id, service) => client.post(`/grading/${id}/generate`, { grading_service: service })

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
