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
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <Header />
      <main className="mx-auto max-w-5xl px-4 py-4 pb-24">
        <div role="tablist" aria-label="Sections" className="flex gap-1 border-b border-hairline mb-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                const i = TABS.findIndex((x) => x.id === tab)
                if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length].id)
                if (e.key === 'ArrowLeft') setTab(TABS[(i + TABS.length - 1) % TABS.length].id)
              }}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${tab === t.id ? 'border-accent text-ink font-medium' : 'border-transparent text-secondary hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'earn' ? <EarnTab /> : tab === 'trade' ? <TradeTab /> : <ActivityTab />}
        </div>
        <p className="text-xs text-muted mt-8">Sacred is a testnet demonstration on Arc Testnet. Test USDC and test cirBTC have no value. Not financial advice.</p>
      </main>
    </div>
  )
}
