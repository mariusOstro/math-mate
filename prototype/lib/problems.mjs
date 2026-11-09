import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { posix } from 'node:path';

export const workbookPath = new URL(
    '../data/Matematikk_tekstoppgaver_1550.xlsx',
    import.meta.url,
);
export const groupOrder = [
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '1P',
    '2P',
    '1T',
    'R1',
    'R2',
    'S1',
    'S2',
];

export const groupLabel = (group) =>
    /^\d+$/.test(group) ? `${group}. trinn` : `Matematikk ${group}`;

const array = (value) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: false,
});

function cellText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'object') return String(value);
    if ('#text' in value) return String(value['#text']);
    if ('t' in value) return array(value.t).map(cellText).join('');
    if ('r' in value) return array(value.r).map(cellText).join('');
    return '';
}

export async function loadProblems(path = workbookPath) {
    // Les bare oppgavedata. removeNSPrefix støtter også denne filens x:workbook/x:row-navn.
    // Kildearbeidsboken endres aldri, og formler kjøres ikke.
    const entries = unzipSync(await readFile(path));
    function xml(entry) {
        if (!entries[entry]) throw new Error(`Excel-filen mangler ${entry}.`);
        return parser.parse(strFromU8(entries[entry]));
    }
    const workbook = xml('xl/workbook.xml').workbook;
    const sheet = array(workbook?.sheets?.sheet).find(
        (item) => item.name === 'Oppgaver',
    );
    const relationships = array(
        xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship,
    );
    const target = relationships.find((item) => item.Id === sheet?.id)?.Target;
    const sheetPath = target?.startsWith('/')
        ? target.slice(1)
        : target
          ? posix.normalize(posix.join('xl', target))
          : '';
    const strings = entries['xl/sharedStrings.xml']
        ? array(xml('xl/sharedStrings.xml').sst?.si).map(cellText)
        : [];
    const rows = sheetPath
        ? array(xml(sheetPath).worksheet?.sheetData?.row)
        : [];
    function valuesFor(row) {
        const values = Array(8).fill('');
        for (const cell of array(row.c)) {
            const column = /^[A-H]\d+$/.test(cell.r)
                ? cell.r.charCodeAt(0) - 65
                : -1;
            if (column >= 0)
                values[column] = (
                    cell.t === 's'
                        ? (strings[Number(cell.v)] ?? '')
                        : cell.t === 'inlineStr'
                          ? cellText(cell.is)
                          : cellText(cell.v)
                ).trim();
        }
        return values;
    }
    const columns = [
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
        !sheet ||
        !rows.length ||
        columns.some((name, index) => valuesFor(rows[0])[index] !== name)
    ) {
        throw new Error(
            'Excel-filen må ha arket Oppgaver og de åtte opprinnelige kolonnene.',
        );
    }

    const allProblems = [];
    for (const row of rows.slice(1)) {
        const rowNumber = Number(row.r);
        const values = valuesFor(row);
        const [
            id,
            question,
            group,
            difficulty,
            category,
            answer,
            unit,
            solution,
        ] = values;
        if (!id && !question) continue;
        if (!id || !question || !group || !answer || !solution) {
            throw new Error(
                `Oppgaven på Excel-rad ${rowNumber} mangler påkrevde felt.`,
            );
        }
        allProblems.push({
            id,
            question,
            group,
            difficulty: Number(difficulty),
            category,
            answer,
            unit,
            solution,
            sourceRow: rowNumber,
        });
    }

    // Tre representative oppgaver per gruppe. Utvalget endres når Excel-filen endres.
    const problems = [];
    const groups = groupOrder.filter((group) =>
        allProblems.some((problem) => problem.group === group),
    );
    for (const group of groups) {
        const candidates = allProblems
            .filter((problem) => problem.group === group)
            .sort(
                (a, b) =>
                    a.difficulty - b.difficulty || a.sourceRow - b.sourceRow,
            );
        const chosen = [];
        for (const start of [
            0,
            Math.floor(candidates.length / 2),
            candidates.length - 1,
        ]) {
            const byDistance = candidates.toSorted(
                (a, b) =>
                    Math.abs(candidates.indexOf(a) - start) -
                    Math.abs(candidates.indexOf(b) - start),
            );
            const available = byDistance.filter(
                (candidate) => !chosen.includes(candidate),
            );
            const pick =
                available.find(
                    (candidate) =>
                        !chosen.some(
                            (item) => item.category === candidate.category,
                        ),
                ) ?? available[0];
            if (pick) chosen.push(pick);
        }
        problems.push(...chosen);
    }
    if (!problems.length)
        throw new Error(
            'Fant ingen oppgaver for de støttede trinnene og fagene.',
        );
    return {
        problems,
        groups: groups.map((id) => ({
            id,
            label: groupLabel(id),
            count: problems.filter((problem) => problem.group === id).length,
        })),
        totalSourceProblems: allProblems.length,
    };
}
