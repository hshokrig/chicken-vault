import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

let loaded = false;

export function loadEnv(): void {
  if (loaded) {
    return;
  }

  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env')
  ];

  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }

  loaded = true;
}
