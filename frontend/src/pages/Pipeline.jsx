// Embeds the MClubCards video-pipeline dashboard (`mclub gui`, launched
// separately on port 8765 — see start.sh) so both apps live under one nav
// without merging their very different backend dependency stacks.
const PIPELINE_URL = 'http://127.0.0.1:8765'

export default function Pipeline() {
  return (
    <div className="fixed inset-0 bottom-16">
      <iframe
        src={PIPELINE_URL}
        title="M Club Cards pipeline dashboard"
        className="w-full h-full border-0 bg-white"
      />
    </div>
  )
}
