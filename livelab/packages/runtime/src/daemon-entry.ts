/** Executable entry for the bundled daemon (`daemon.cjs`). */
import { daemonMain } from './daemon';

void daemonMain(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`[livelab] failed to start: ${err?.message ?? err}\n`);
  process.exit(1);
});
