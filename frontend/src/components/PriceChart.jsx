import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function PriceChart({ values }) {
  if (!values || values.length === 0) {
    return <p className="text-[#94A3B8] text-sm text-center py-4">No price history yet.</p>
  }
  const data = values.map(v => ({
    date: new Date(v.fetched_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
    price: v.price,
  }))
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data}>
        <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11 }} />
        <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} tickFormatter={v => `$${v}`} width={48} />
        <Tooltip
          contentStyle={{ background: '#1A2E45', border: 'none', borderRadius: 8 }}
          labelStyle={{ color: '#94A3B8' }}
          formatter={v => [`$${v.toFixed(2)}`, 'Price']}
        />
        <Line type="monotone" dataKey="price" stroke="#A8DADC" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
