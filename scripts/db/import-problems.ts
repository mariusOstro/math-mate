import { resolve } from 'node:path';
import { readExcelProblems } from '../../src/infrastructure/datasets/excel';
import { scriptDatabase } from './env';

async function main() {
  const fileFlag = process.argv.indexOf('--file');
  const file = resolve(
    fileFlag >= 0
      ? process.argv[fileFlag + 1]
      : 'Matematikk_tekstoppgaver_1550.xlsx',
  );
  const items = await readExcelProblems(file);
  const levels = Object.fromEntries(
    [...new Set(items.map((item) => String(item.problem.level_code)))].map(
      (level) => [
        level,
        items.filter((item) => item.problem.level_code === level).length,
      ],
    ),
  );
  console.log('Validated source:', { problems: items.length, levels });
  if (
    process.argv.includes('--dry-run') ||
    process.env.npm_config_dry_run === 'true'
  ) {
    console.log('Dry run: no database connection or writes.');
    return;
  }
  const db = scriptDatabase();
  const totals = { inserted: 0, skipped: 0, versioned: 0 };
  for (let offset = 0; offset < items.length; offset += 40) {
    const { data, error } = await db.rpc('mathmate_import_problems', {
      p_items: items.slice(offset, offset + 40),
    });
    if (error) {
      console.error('Import failed:', {
        code: error.code,
        completed: offset,
        message:
          'Check migrations and Supabase credentials. Re-running safely skips unchanged problems.',
      });
      process.exitCode = 1;
      return;
    }
    for (const key of ['inserted', 'skipped', 'versioned'] as const)
      totals[key] += Number(data[key]);
    if ((offset / 40) % 5 === 0)
      console.log(
        `Processed ${Math.min(offset + 40, items.length)} / ${items.length}`,
      );
  }
  console.log('Import complete:', totals);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Import failed.');
  process.exitCode = 1;
});
