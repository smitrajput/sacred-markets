import { useState } from 'react'

import { ActivityTab } from './components/ActivityTab'
import { EarnTab } from './components/EarnTab'
import { Header } from './components/Header'
import { TradeTab } from './components/TradeTab'

const TABS = [
  { id: 'earn', label: 'Earn' },
  { id: 'trade', label: 'Trade' },
  { id: 'activity', label: 'Activity' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function App() {
  const [tab, setTab] = useState<TabId>('earn')
  const go = (next: TabId) => {
    setTab(next)
    document.getElementById(`tab-${next}`)?.focus()
  }
  return (
    <div className="min-h-dvh flex flex-col bg-paper text-ink">
      <Header />
      <nav aria-label="Sacred sections" className="sticky top-0 z-10 bg-paper">
        <div className="mx-auto max-w-page px-5 sm:px-8">
          <div role="tablist" aria-label="Sections" className="flex border-b border-rule">
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                type="button"
                tabIndex={tab === t.id ? 0 : -1}
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => {
                  const i = TABS.findIndex((x) => x.id === tab)
                  if (e.key === 'ArrowRight') go(TABS[(i + 1) % TABS.length].id)
                  if (e.key === 'ArrowLeft') go(TABS[(i + TABS.length - 1) % TABS.length].id)
                  if (e.key === 'Home') {
                    e.preventDefault()
                    go(TABS[0].id)
                  }
                  if (e.key === 'End') {
                    e.preventDefault()
                    go(TABS[TABS.length - 1].id)
                  }
                }}
                className={`h-14 flex-1 sm:flex-none px-6 font-serif text-base sm:text-lg border-b-2 -mb-px transition-colors ${tab === t.id ? 'border-red text-ink font-semibold' : 'border-transparent text-secondary hover:text-ink'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-page px-5 sm:px-8 pt-8 sm:pt-10 pb-20 flex-1">
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {tab === 'earn' ? <EarnTab /> : tab === 'trade' ? <TradeTab /> : <ActivityTab />}
        </div>
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-page px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <img src="/brand/sacred-wordmark-ink.svg" alt="" className="w-40 h-auto self-start sm:self-auto" />
          <p className="text-sm text-secondary">Sacred is a testnet demonstration on Arc Testnet. Test USDC and test cirBTC have no value. Not financial advice.</p>
        </div>
      </footer>
    </div>
  )
}
