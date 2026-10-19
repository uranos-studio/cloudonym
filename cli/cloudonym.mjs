#!/usr/bin/env node
// @ts-check
// cloudonym CLI 진입 (D102 · D121) — `cloudonym` · `node cli/cloudonym.mjs <command>` · `npm run cli -- <command>`. 본체는 cli/lib/main.mjs.
// 터미널인지는 여기서만 본다 — main 의 기본값은 「터미널 아님」이라 시험 · 다른 호출자는 묻지 않는다
import { main } from './lib/main.mjs';

process.exitCode = await main(process.argv.slice(2), { tty: { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true } });
