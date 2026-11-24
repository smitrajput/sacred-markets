import { ArrowUpRight, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import type { View } from './Header'
import { PageHead } from './ui'
import { CONTRACTS, explorerAddr } from '@/lib/contracts'
import { shortAddr } from '@/lib/format'

const SECTIONS = [
  ['getting-started', 'Getting started'],
  ['earn-guide', 'Earning on USDC'],
  ['trade-guide', 'Buying BTC'],
  ['protection', 'Risk and protection'],
  ['questions', 'Questions'],
  ['contracts', 'Contracts'],
] as const

function Section({ id, title, lede, children }: { id: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-t border-rule pt-10 mt-12 first:mt-0 first:pt-0 first:border-0">
      <h2 id={`${id}-h`} className="text-xl sm:text-2xl">
        {title}
      </h2>
      {lede ? <p className="mt-3 text-base text-ink-2 max-w-[62ch]">{lede}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  )
}

function Steps({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <ol className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
      {items.map(([t, d], i) => (
        <li key={t} className="border-t border-rule-strong pt-3">
          <p className="font-serif text-lg text-accent leading-none">{i + 1}</p>
          <p className="font-bold text-sm mt-2">{t}</p>
          <p className="text-sm text-ink-2 mt-1">{d}</p>
        </li>
      ))}
    </ol>
  )
}

function Terms({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="card divide-y divide-rule">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-6 px-5 sm:px-6 py-3.5">
          <dt className="label pt-0.5">{k}</dt>
          <dd className="text-sm text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Faq({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="border-b border-rule">
      {items.map(([q, a]) => (
        <details key={q} className="border-t border-rule">
          <summary className="flex items-center justify-between gap-4 py-4 text-base text-ink hover:text-accent">
            {q}
            <ChevronDown aria-hidden className="chev h-4 w-4 shrink-0 text-ink-3 transition-transform" />
          </summary>
          <div className="pb-5 -mt-1 text-sm text-ink-2 max-w-[66ch] space-y-3">{a}</div>
        </details>
      ))}
    </div>
  )
}

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="link" href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
)

export function Guide({ onView }: { onView: (v: View) => void }) {
  const jump = (v: View, label: string) => (
    <a
      className="link"
      href={`#${v}`}
      onClick={(e) => {
        e.preventDefault()
        onView(v)
      }}
    >
      {label}
    </a>
  )
  return (
    <>
      <PageHead eyebrow="Guide" title="How Sacred works">
        Sacred lets you earn on USDC and buy BTC with financing, without interest. This guide covers what you need to use the app on Arc Testnet.
      </PageHead>
      <div className="grid gap-10 lg:grid-cols-12">
        <nav aria-label="On this page" className="lg:col-span-3">
          <ul className="lg:sticky lg:top-24 flex flex-wrap gap-x-5 gap-y-2 lg:block lg:space-y-2.5 text-sm border-b border-rule pb-5 lg:border-0 lg:pb-0">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a className="text-ink-2 no-underline hover:text-accent" href={`#${id}`}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="lg:col-span-9 min-w-0">
          <Section id="getting-started" title="Getting started" lede="The app runs on Arc Testnet, so everything here uses test tokens with no monetary value. You need a browser wallet and a little test USDC.">
            <Steps
              items={[
                [
                  'Connect a wallet',
                  <>
                    Use <Ext href="https://metamask.io/download">MetaMask</Ext>, <Ext href="https://rabby.io">Rabby</Ext> or any browser wallet. Sacred asks your wallet to switch to Arc Testnet the first time you transact.
                  </>,
                ],
                [
                  'Get test USDC',
                  <>
                    Request USDC for Arc Testnet from the <Ext href="https://faucet.circle.com">Circle faucet</Ext>. On Arc, network fees are also paid in USDC, so the app always keeps 0.10 USDC in your wallet for fees.
                  </>,
                ],
                ['Earn', <>Deposit USDC into the vault on the {jump('earn', 'Earn')} page and receive a share of the markup that buyers pay.</>],
                ['Or trade', <>Buy cirBTC with twice your capital on the {jump('trade', 'Trade')} page, for one fixed markup.</>],
              ]}
            />
          </Section>

          <Section id="earn-guide" title="Earning on USDC" lede="Depositors fund purchases. When a buyer repays, the markup they pay is shared with everyone holding vault shares at that moment.">
            <Terms
              rows={[
                ['Deposits', 'You receive vault shares at the current share price. Shares cannot be transferred.'],
                ['Earnings', 'Depositors receive 77% of each markup collected. The other 23% tops up the protection reserves and pays the manager. As markup is collected, the share price rises.'],
                ['Returns', 'Not fixed and not guaranteed. Idle USDC earns nothing; earnings depend on how much of the vault is financing purchases.'],
                ['Withdrawals', 'Request a withdrawal for some or all of your shares. Requests are paid in order as cash is available, then you claim your USDC. A request cannot be cancelled.'],
                ['While you wait', 'Shares waiting to be withdrawn keep earning and stay exposed to losses until they are paid. New deposits and purchases pause while any withdrawal is waiting.'],
              ]}
            />
          </Section>

          <Section id="trade-guide" title="Buying BTC" lede="You put in half the purchase and the vault finances the other half. Instead of interest, you agree one fixed markup before you buy.">
            <Steps
              items={[
                ['The vault buys the BTC', 'The full purchase is made through a Uniswap v4 pool at a live quote, using vault funds.'],
                ['It is sold to you at a fixed price', 'Cost plus the markup: 10% a year, charged for a 14-day term. On 0.10 USDC of financing that is 0.000383 USDC.'],
                ['Your BTC is held as security', 'You pay your half, and the BTC stays pledged in the contract until you have repaid.'],
                ['Repay or sell', 'Repay in full to receive all the BTC, or sell: the proceeds repay what you owe and the rest is yours.'],
              ]}
            />
            <div className="mt-8">
              <Terms
                rows={[
                  ['Cost', 'The markup is fixed when you buy. It never grows, and there are no late fees or funding payments. Repaying early does not reduce it.'],
                  ['Coverage', 'The value of your BTC against what you owe. A purchase must start at 190% or more.'],
                  ['If the price falls', 'When coverage reaches 160%, part of your BTC is sold to bring it back to 190%. The contract decides the amount; nobody can sell more than that.'],
                  ['At the due date', 'After 14 days an unpaid position can be settled: the BTC is sold, the vault is repaid and anything left is returned to you.'],
                  ['Your maximum loss', 'What you pledged. If a sale does not cover the debt, there is no further claim against you.'],
                  ['Limits', 'Financing per wallet and in total is kept deliberately small on testnet. Your remaining limit is shown on the Trade page.'],
                ]}
              />
            </div>
          </Section>

          <Section id="protection" title="Risk and protection" lede="If a position is sold for less than the financing still owed, the shortfall is absorbed in a fixed order before it reaches depositors.">
            <ol className="card divide-y divide-rule">
              {[
                ['Primary reserve', 'Funded from the 23% share of markup. Used first.'],
                ['Tail reserve', 'A second reserve, used once the primary reserve is empty.'],
                ['Depositors', 'Any remaining loss lowers the share price for everyone in the vault.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4 px-5 sm:px-6 py-4">
                  <span className="font-serif text-lg text-accent leading-6 w-4 shrink-0">{i + 1}</span>
                  <div>
                    <p className="text-sm font-bold">{t}</p>
                    <p className="text-sm text-ink-2">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-sm text-ink-2 max-w-[66ch]">New purchases pause whenever a reserve is below its target, and resume once it is refilled. The contracts have not been audited. Use test funds only.</p>
          </Section>

          <Section id="questions" title="Questions">
            <Faq
              items={[
                ['Is this real money?', <p>No. The app runs on Arc Testnet. Test USDC and test cirBTC have no monetary value, and positions are limited to very small amounts.</p>],
                [
                  'Why are deposits or purchases paused?',
                  <>
                    <p>There are four reasons the app pauses new deposits and purchases: the reference price needs refreshing, a withdrawal is waiting to be paid, a position is being settled, or a protection reserve is below its target.</p>
                    <p>Repaying a position and claiming a paid withdrawal always work, whatever the state of the market.</p>
                  </>,
                ],
                ['What is the reference price?', <p>The BTC price used to measure coverage. On testnet it is published by Sacred once a day and expires after 24 hours. Purchases execute at the live pool quote, which must stay close to the reference price.</p>],
                ['How is this different from a loan?', <p>Nothing is lent and no interest accrues. The vault buys an asset and sells it to you at a disclosed, fixed price that you pay later. What you owe is known the moment you buy and cannot increase.</p>],
                ['Why did my transaction ask for two confirmations?', <p>The first approves the exact amount of USDC for that action; the second performs it. The app never asks for an unlimited approval.</p>],
                ['Who settles positions and pays withdrawals?', <p>An automated service normally does. Both actions are also open to any wallet, so nothing depends on that service: the buttons appear on the Earn and Trade pages whenever something is waiting.</p>],
                [
                  'Where can I read more?',
                  <p>
                    The full design, including economics and Shariah reasoning, is in the <Ext href="https://sacred.markets/docs">Sacred docs</Ext>. Everything the contracts do is listed under {jump('activity', 'Activity')}.
                  </p>,
                ],
              ]}
            />
          </Section>

          <Section id="contracts" title="Contracts" lede="All four contracts are deployed on Arc Testnet with verified source.">
            <ul className="card divide-y divide-rule">
              {(
                [
                  ['Vault', 'Holds deposits and pays withdrawals', CONTRACTS.vault],
                  ['Trade engine', 'Buys, pledges and settles BTC', CONTRACTS.engine],
                  ['Price reference', 'Publishes the reference price', CONTRACTS.guard],
                  ['Swap adapter', 'Trades through the Uniswap v4 pool', CONTRACTS.venue],
                ] as const
              ).map(([name, role, addr]) => (
                <li key={name} className="flex items-baseline justify-between gap-4 px-5 sm:px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{name}</p>
                    <p className="text-xs text-ink-3">{role}</p>
                  </div>
                  <a className="link font-mono text-xs inline-flex items-center gap-0.5 shrink-0" href={`${explorerAddr(addr)}?tab=contract`} target="_blank" rel="noopener noreferrer">
                    {shortAddr(addr)}
                    <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  )
}
