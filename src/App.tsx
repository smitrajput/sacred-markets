import { useEffect, useState } from 'react'

import { ActivityTab } from './components/ActivityTab'
import { Brand } from './components/Brand'
import { EarnTab } from './components/EarnTab'
import { Guide } from './components/Guide'
import { Header, VIEWS, type View } from './components/Header'
import { TradeTab } from './components/TradeTab'

/** The current view lives in the URL hash ("#trade"), so a view can be linked to and the back button works. Any other hash is a section inside the guide. */
function viewFromHash(): View {
  const h = window.location.hash.slice(1)
  if (h === '') return 'earn'
  return VIEWS.find((v) => v.id === h)?.id ?? 'guide'
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash)
  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (next: View) => {
    if (next !== view) {
      window.history.pushState(null, '', `#${next}`)
      setView(next)
    }
    window.scrollTo({ top: 0 })
  }
  return (
    <div className="min-h-dvh flex flex-col bg-paper text-ink">
      <Header view={view} onView={go} />
      <main className="mx-auto w-full max-w-page px-5 sm:px-8 pt-10 sm:pt-14 pb-24 flex-1">{view === 'earn' ? <EarnTab /> : view === 'trade' ? <TradeTab /> : view === 'activity' ? <ActivityTab /> : <Guide onView={go} />}</main>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-page px-5 sm:px-8 py-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <Brand className="!text-lg [&>svg]:h-5 [&>svg]:w-5" />
            <p className="text-xs text-ink-3 max-w-[52ch]">Running on Arc Testnet. Test USDC and test cirBTC have no monetary value. Nothing here is financial advice.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
            <a className="no-underline hover:underline" href="https://sacred.markets/">
              Home
            </a>
            <a className="no-underline hover:underline" href="https://sacred.markets/docs">
              Docs
            </a>
            <a
              className="no-underline hover:underline"
              href="#guide"
              onClick={(e) => {
                e.preventDefault()
                go('guide')
              }}
            >
              Guide
            </a>
            <a className="no-underline hover:underline" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">
              Faucet
            </a>
          </nav>
        </div>
      </footer>
    </div>
  )
}
