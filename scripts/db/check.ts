import { scriptDatabase } from './env';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function checkClientBundles(directory: string) {
  const secrets = [
    'SUPABASE_SECRET_KEY',
    'OPENAI_API_KEY',
    'BROWSER_ID_SECRET',
    'CRON_SECRET',
  ]
    .map((name) => ({ name, value: process.env[name]?.trim() }))
    .filter((item): item is { name: string; value: string } =>
      Boolean(item.value && item.value.length >= 16),
    );
  async function inspect(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        const text = await readFile(file, 'utf8');
        for (const secret of secrets)
          if (text.includes(secret.value))
            throw new Error(
              `Client bundle contains server secret ${secret.name}.`,
            );
      }
    }
  }
  try {
    await readdir(directory);
  } catch {
    return;
  }
  await inspect(directory);
  console.log('Browser bundle check: no configured server secrets found.');
}

async function main() {
  await checkClientBundles('.next/static');
  const db = scriptDatabase();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() ?? '';
  console.log(
    'Key type:',
    key.startsWith('sb_secret_')
      ? 'server secret'
      : key.startsWith('eyJ')
        ? 'legacy JWT key'
        : key.startsWith('sb_publishable_')
          ? 'publishable (incorrect for this server)'
          : 'unrecognized',
  );
  const { error, count } = await db
    .from('problems')
    .select('id', { count: 'exact', head: true });
  if (error) {
    console.error('Supabase check failed:', {
      code: error.code,
      message: error.message.replace(/sb_[a-z]+_[A-Za-z0-9_-]+/g, '[redacted]'),
    });
    process.exitCode = 1;
    return;
  }
  console.log('Supabase schema accessible. Problems:', count);
  const { error: numberError, count: profileCount } = await db
    .from('app_users')
    .select('user_number', { count: 'exact', head: true });
  if (numberError) {
    console.error('User-number migration is not accessible:', numberError.code);
    process.exitCode = 1;
    return;
  }
  console.log('User-number migration: available. Profiles:', profileCount);
  const { data: queue, error: queueError } = await db.rpc(
    'mathmate_unattempted_problems',
    {
      p_user_id: '00000000-0000-4000-8000-000000000000',
      p_level: '4',
      p_offset: 0,
      p_limit: 1,
    },
  );
  if (
    queueError ||
    !Array.isArray(queue?.problems) ||
    typeof queue?.total !== 'number'
  ) {
    console.error(
      'Personal-queue migration is not accessible:',
      queueError?.code ?? 'invalid_response',
    );
    process.exitCode = 1;
    return;
  }
  console.log('Personal-queue migration: available.');
  const { error: rpcError } = await db.rpc('mathmate_level_counts');
  console.log(
    'Application command migration:',
    rpcError ? 'not available yet' : 'available',
  );
}
main().catch(() => {
  console.error(
    'Could not reach Supabase. Check the URL and network connection.',
  );
  process.exitCode = 1;
});
