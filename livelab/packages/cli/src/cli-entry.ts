#!/usr/bin/env node
import { cliMain } from './cli';

void cliMain(process.argv).catch((err) => {
  process.stderr.write(`error: ${err?.message ?? err}\n`);
  process.exit(1);
});
