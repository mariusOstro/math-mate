import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { LEVEL_CODES, type Json } from '@/entities/models/mathmate';

const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
type XmlNode = { [key: string]: XmlNode | XmlNode[] | string };
function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const node = value as XmlNode;
  if ('#text' in node) return String(node['#text']);
  if ('t' in node) return array(node.t).map(text).join('');
  if ('r' in node) return array(node.r).map(text).join('');
  return '';
}
export interface ImportItem {
  problem: Record<string, Json>;
  steps: { step_number: number; title: string; content: string }[];
}

export async function readExcelProblems(file: string): Promise<ImportItem[]> {
  const entries = unzipSync(await readFile(file));
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
  });
  // XML is read-only source data, never executable formulas or browser markup.
  const xml = (name: string) => {
    if (!entries[name]) throw new Error(`Workbook is missing ${name}.`);
    return parser.parse(strFromU8(entries[name]));
  };
  const sheet = array<{ name: string; id: string }>(
    xml('xl/workbook.xml').workbook?.sheets?.sheet,
  ).find((item) => item.name === 'Oppgaver');
  const relations = array<{ Id: string; Target: string }>(
    xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship,
  );
  const target = relations.find((item) => item.Id === sheet?.id)?.Target;
  if (!target) throw new Error('Workbook needs the Oppgaver worksheet.');
  const path = target.startsWith('/')
    ? target.slice(1)
    : posix.normalize(posix.join('xl', target));
  const strings = entries['xl/sharedStrings.xml']
    ? array(xml('xl/sharedStrings.xml').sst?.si).map(text)
    : [];
  const rows = array<{
    r: string;
    c: { r: string; t?: string; v?: string; is?: XmlNode }[];
  }>(xml(path).worksheet?.sheetData?.row);
  const cells = (row: (typeof rows)[number]) => {
    const values = Array<string>(8).fill('');
    for (const cell of array(row.c)) {
      if (!/^[A-H]\d+$/.test(cell.r)) continue;
      values[cell.r.charCodeAt(0) - 65] = (
        cell.t === 's'
          ? (strings[Number(cell.v)] ?? '')
          : cell.t === 'inlineStr'
            ? text(cell.is)
            : text(cell.v)
      ).trim();
    }
    return values;
  };
  const headers = [
    'oppgave_id',
    'oppgavetekst',
    'trinn_fag',
    'vanskelighetsgrad',
    'kategori',
    'fasit_verdi',
    'fasit_enhet',
    'løsningsforslag',
  ];
  if (
    !rows.length ||
    headers.some((header, index) => cells(rows[0])[index] !== header)
  )
    throw new Error(
      'Workbook headers do not match the expected eight columns.',
    );
  const seen = new Set<string>();
  const result: ImportItem[] = [];
  for (const row of rows.slice(1)) {
    const [
      source_id,
      question,
      level_code,
      difficulty,
      category,
      answer_value,
      answer_unit,
      solution,
    ] = cells(row);
    if (!source_id && !question) continue;
    if (
      !source_id ||
      !question ||
      !category ||
      !answer_value ||
      !solution ||
      !LEVEL_CODES.includes(level_code as (typeof LEVEL_CODES)[number]) ||
      !Number.isInteger(Number(difficulty)) ||
      Number(difficulty) <= 0
    )
      throw new Error(`Invalid or incomplete problem at Excel row ${row.r}.`);
    if (seen.has(source_id))
      throw new Error(`Duplicate source_id at Excel row ${row.r}.`);
    seen.add(source_id);
    const parts = solution
      .replace(/\s*Svar:\s*[\s\S]*$/i, '')
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-ZÆØÅ])/)
      .filter(Boolean);
    const steps = [
      {
        step_number: 1,
        title: 'Forstå oppgaven',
        content:
          'Les oppgaven én gang til. Hva vet du allerede, og hva skal du finne? Skriv gjerne ned tallene og enhetene før du regner.',
      },
      ...(parts.length ? parts : [solution]).map((content, index) => ({
        step_number: index + 2,
        title: parts.length > 1 ? `Regn ut · del ${index + 1}` : 'Regn ut',
        content,
      })),
    ];
    result.push({
      problem: {
        source_id,
        question,
        level_code,
        difficulty: Number(difficulty),
        category,
        answer_value,
        answer_unit,
        solution,
        validation_rules: {
          answer_type: 'numeric_or_text',
          absolute_tolerance: 0,
          relative_tolerance: 0,
          accepted_answers: [],
        },
      },
      steps,
    });
  }
  if (!result.length) throw new Error('No problems found in workbook.');
  return result;
}
