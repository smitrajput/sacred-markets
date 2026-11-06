# Sacred implementation guide

[Read the visual guide](implementation-guide.html). Open the HTML in a browser; it includes five diagrams and supports Print / Save PDF. The local preview is http://127.0.0.1:8765/guide.html and the public copy is https://sacred-arc-mvp.vercel.app/guide.html.

The guide explains the architecture, data and money flows, depositor/trader/keeper journeys, accounting examples and technical decisions. [SVG diagrams](diagrams/) can be reused in the presentation.

Status: reconciled with the deployed application checkpoint d71ddbd and the completed separate-wallet browser rehearsal on November 6. It distinguishes the earlier operator receipts from the nine browser/keeper receipts, explains the three withdrawal steps, records the completed bounded keeper episode and states the later thin-pool quote limitation. The founder chose the existing Studio and Vercel URLs with Studio history/code/traces in the demo; organizer confirmation is no longer a blocker. The video and presentation sharing remain open.

Drafted with Claude Haiku 5.5 from bounded implementation context; reviewed and corrected by Codex against the specification, contract sources and execution evidence. No certification or audit is claimed.
