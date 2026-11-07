# Sacred demo: depositor and trader transactions only

Open [Sacred](https://sacred.markets/app). The prepared pool and reference are near 80,000 USDC/cirBTC. Refresh the page and check initial coverage is at least 190% before opening. There is no scheduled operator price move.

1. **Depositor 0x5B93…2659:** Earn → deposit 0.10 USDC, accept the mandate, sign approval and deposit.
2. **Trader 0xAA46…dEcC:** Trade → contribute 0.10 USDC, review the fixed 0.100383 USDC debt, then sign approval and opening.
3. **Trader:** click **Repay 0.100383 and release**; sign the exact approval and repayment. The position closes and its cirBTC is released to the trader. Show the confirmation or Activity.
4. **Depositor:** request withdrawal of the actual unlocked shares shown. Once confirmed, click **Process queue (up to 16)** in Earn and sign it. Processing is permissionless, so the depositor can do it directly. Then click **Claim** and sign.

Use the app's transaction confirmations and explorer links. This demo shows fixed-markup financing and repayment, not a price-rise or trading-profit claim. The founder signs all wallet transactions. No CLI price-rise command is part of this recording.

If needed, `bun run demo:record status` in Studio Terminal is read-only. The fallback one-shot queue command is `bun run demo:record process`, but the on-screen Process queue button keeps the demo entirely in the app.

Earlier price-rise rehearsals and their journals remain intact as historical evidence: [Position 5 verification](review/SELF_SERVICE_REHEARSAL_VERIFICATION.json), [final preparation](review/FINAL_RECORDING_PREP_VERIFICATION.json). No state reset is needed if the trader has not opened yet. If a new position is already active, repay and release that position instead of opening another.
