#!/usr/bin/env bun
/** `bun run demo:record ...` - the FINAL recording episode (journal deployments/demo-final-recording-20261107.json). Same planner, same limits, same exclusive lock as `bun run demo`. */
import { main } from './demo'

process.exit(await main('final'))
