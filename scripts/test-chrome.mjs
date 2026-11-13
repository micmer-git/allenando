import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statfsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Lascia margine sopra i 5 GiB richiesti anche mentre Chrome scrive il profilo.
export function startTestChrome(executable, args) {
  const temp = tmpdir();
  const disk = statfsSync(temp, { bigint: true });
  const free = disk.bavail * disk.bsize;
  if (free < 8n * 1024n ** 3n) {
    throw new Error(`Collaudo sospeso: ${(Number(free) / 1024 ** 3).toFixed(1)} GiB liberi in ${temp}. Ne servono 8.`);
  }
  const profile = mkdtempSync(join(temp, 'allenando-ui-'));
  let child;
  const cleanup = () => {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    } catch (error) {
      console.warn(`Pulizia del profilo di test ${profile}: ${error.message}`);
    }
  };
  try {
    child = spawn(executable, [`--user-data-dir=${profile}`, ...args], { stdio: 'ignore' });
  } catch (error) {
    cleanup();
    throw error;
  }
  child.on('error', error => console.error(error.message));
  const closed = new Promise(resolve => child.once('close', () => { cleanup(); resolve(); }));
  return { child, closed };
}
