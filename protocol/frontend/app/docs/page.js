import Link from "next/link";
import styles from "./docs.module.css";
import { sections } from "./nav";

export const metadata = { title: "Overview" };

// Who the reader is, and the page that answers their first question. Two to a row.
const paths = [
  { who: "Saver", go: "earn", title: "Put stablecoins to work", line: "Earnings come from fixed financing markup. The return is variable, and it depends on how much of the vault is in use." },
  { who: "Trader", go: "trade", title: "More buying power, costs upfront", line: "Buy BTC or ETH with up to 5× leverage and one fixed dollar cost, no funding payments and no share of your profit." },
  { who: "Holder", go: "borrow", title: "USDC against your crypto", line: "Pledge collateral, receive spendable USDC, repay a fixed amount and take your collateral back." },
  { who: "Prop trader", go: "trade/sift", title: "SIFT: financing grows with your results", line: "Real trades from day one. Build to $100,000 of financing in 12 weeks, or bring a verified record and start at up to $50,000." },
  { who: "Investor", go: "thesis", title: "Thesis", line: "The market, the one new primitive, and the tradeoffs of fixed-price financing, with numbers." },
  { who: "Scholar", go: "shariah", title: "The contracts and what needs approval", line: "Each sale, pledge and partnership, the Arc and USDC premise, and the open questions." },
  { who: "Engineer", go: "architecture", title: "How it is built", line: "The live Arc Testnet MVP, planned product controls and shared-liquidity research." },
  { who: "Getting started", go: "funding", title: "Add funds", line: "Exchange and wallet routes onto Arc, with the exact tokens and networks." },
];

const products = [
  { name: "Earn", status: "USDC testnet demo live. Production planned.", line: "Stablecoin deposits finance spot purchases. The production design allocates 77% of base Trade markup to depositors." },
  { name: "Trade", status: "2x cirBTC testnet demo live. Broader tiers planned.", line: "A 14-day fixed sale of BTC or ETH, up to 5×. From 10% annualized on financing, 0% of your profit." },
  { name: "Borrow", status: "Proposed. After Trade.", line: "A 30-day fixed sale of USDC against collateral, funded by Earn's 12-month Borrow vault." },
];

export default function DocsOverview() {
  return (
    <>
      <h1>Sacred Documentation</h1>
      <p className={styles.lead}>
        Sacred is onchain financing for holding and trading halal assets. It gives people three things to do with their
        crypto: earn on stablecoins, trade BTC and ETH with more buying power, and access USDC against what they already
        hold. All three use sales with a price fixed upfront, instead of loans with a rate that moves.
      </p>

      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>What it is</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.line}</td>
              <td>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        The USDC Earn and 2x cirBTC Trade demo is live on Arc Testnet. Production terms, Borrow, SIFT and Aqua
        integration remain planned. Preliminary scholar feedback has identified changes to address before final
        Shariah approval. Independent security audits and formal certification remain pending.
      </p>

      <h2>Planned shared liquidity</h2>
      <p>
        We plan to evaluate 1inch Aqua so available Earn liquidity can serve Trade, Borrow and later approved
        strategies. Our 100x capital-efficiency ambition has no validated benchmark yet. Existing forecasts
        include no Aqua uplift. See <Link href="/docs/architecture#planned-shared-liquidity">the architecture</Link>.
      </p>

      <h2>Start where your question is</h2>
      <ul className={styles.cards}>
        {paths.map((p) => (
          <li key={p.go}>
            <Link href={`/docs/${p.go}`} className={styles.card}>
              <small>{p.who}</small>
              <b>{p.title}</b>
              <span>{p.line}</span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>Everything here</h2>
      {sections.map((section) => (
        <div key={section.title}>
          <h3>{section.title}</h3>
          <ul className={styles.map}>
            {section.pages
              .filter((p) => p.slug)
              .map((p) => (
                <li key={p.slug}>
                  <Link href={`/docs/${p.slug}`}>{p.title}</Link>
                  <span>{p.blurb}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}
