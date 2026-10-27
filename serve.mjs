const modes = new Set(['supabase', 'local', 'mock']);
const requested = process.argv.slice(2).find((arg) => modes.has(arg));
const invalid = process.argv.slice(2).filter((arg) => !modes.has(arg));
if (invalid.length) {
  console.error(`Unknown serve mode: ${invalid.join(', ')}. Choose supabase, local, or mock.`);
  process.exit(1);
}

process.env.LOCKOUT_MODE = requested || 'supabase';
await import('./build.mjs');
await import('./server.mjs');
