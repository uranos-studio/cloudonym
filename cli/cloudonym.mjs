#!/usr/bin/env node
// @ts-check
// cloudonym CLI 진입 (D102) — `node cli/cloudonym.mjs <command>` · `npm run cli -- <command>`. 본체는 cli/lib/main.mjs
import { main } from './lib/main.mjs';

process.exitCode = await main(process.argv.slice(2));
