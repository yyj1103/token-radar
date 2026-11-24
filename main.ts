// Token Radar's program (Node 22, standard library only, no network).
//
// It reads the sealed snapshot — /input/snapshot.json in the grader, or a
// file or directory named by --input when run by hand — scores every
// pre-token protocol with the radar-2 model in lib/model.ts, and writes the
// entry's outputs:
//
//   board.json    the ranked board, one row per protocol
//   data.js       the same board in the dashboard's compact form
//   dashboard/    this repository's dashboard, copied as it stands
//   screenshots/  this repository's three screenshots, copied as they stand
//   dossier.json  the judge's summary, built last by the vendored library
//
// The dashboard is a static page with no framework and no network: it reads
// data.js, which this program writes from the same board, and it recomputes
// every row from the snapshot figures with the same model. The model is
// stated in full on the page, so the screenshots, the code and the board
// agree with each other.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRadar, dataModule, readSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** This file's own directory, so dashboard/ and screenshots/ are found wherever it is run from. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/**
 * The scorer's own caps (reference/gate.json): the text cap shapes the
 * dossier's bytes, and the rest refuse an entry that breaks them.
 */
const GATE = {
  textMaxBytes: 65_536,
  screenshotMax: 4,
  screenshotMaxBytes: 524_288,
  dashboardMaxFiles: 400,
  dashboardMaxBytes: 4_194_304,
};

/** A screenshot's name: letters, digits and . _ -, 1 to 128 characters. */
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The run's options, from the flags and the environment. */
interface RunOptions {
  input: string; // the snapshot file, or a directory holding snapshot.json
  output: string; // where the entry's outputs are written
}

/**
 * Read --name <value> and --name=<value> out of the arguments, or fall back.
 * The first form wins when both are given.
 */
function flagValue(argv: string[], name: string, fallback: string): string {
  const spaced = argv.indexOf('--' + name);
  if (spaced >= 0 && spaced + 1 < argv.length) return argv[spaced + 1]!;
  const joined = argv.find((a) => a.startsWith('--' + name + '='));
  if (joined !== undefined) return joined.slice(name.length + 3);
  return fallback;
}

/** Write a message to stderr and stop with the given code. */
function fail(message: string, code: number): never {
  process.stderr.write('token radar: ' + message + '\n');
  process.exit(code);
}

/** The run's options, resolved from the flags and the environment. */
function readOptions(argv: string[]): RunOptions {
  const input = flagValue(argv, 'input', '/input');
  const output = flagValue(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  return { input, output };
}

/**
 * The snapshot's path: the --input value itself when it names a .json file,
 * else snapshot.json inside the directory it names.
 */
function snapshotPath(raw: string): string {
  return raw.endsWith('.json') ? raw : path.join(raw, 'snapshot.json');
}

/**
 * Copy one directory's regular files into `to`, skipping names that start
 * with a dot, and return the names copied. A missing source copies nothing.
 */
function copyDirectory(from: string, to: string): string[] {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of fs.readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = path.join(from, name);
    if (!fs.statSync(source).isFile()) continue;
    fs.copyFileSync(source, path.join(to, name));
    copied.push(name);
  }
  return copied;
}

const options = readOptions(process.argv);
const snapshotFile = snapshotPath(options.input);
if (!fs.existsSync(snapshotFile)) {
  fail(
    'no snapshot at ' + snapshotFile + ': pass --input <snapshot.json|directory> or mount the sealed /input',
    2,
  );
}

const snapshot = readSnapshot(fs.readFileSync(snapshotFile, 'utf8'));
const { board, radar } = assembleRadar(snapshot);
const problem = validateBoard(board, snapshot);
if (problem !== null) fail('the model wrote a board the gate refuses: ' + problem, 1);

fs.mkdirSync(options.output, { recursive: true });
fs.writeFileSync(path.join(options.output, 'board.json'), JSON.stringify({ rows: board }) + '\n');
fs.writeFileSync(path.join(options.output, 'data.js'), dataModule(radar));

const dashboardFiles = copyDirectory(path.join(HERE, 'dashboard'), path.join(options.output, 'dashboard'));
const shotFiles = copyDirectory(path.join(HERE, 'screenshots'), path.join(options.output, 'screenshots'));
if (shotFiles.length < 3) {
  fail(
    'screenshots/ holds ' + shotFiles.length + ' image' + (shotFiles.length === 1 ? '' : 's') + ': hand in 3, the board, a detail view and a filtered view',
    1,
  );
}
for (const name of shotFiles) {
  if (!SHOT_NAME.test(name)) {
    fail('screenshots/' + name + ': a name is letters, digits and . _ -, 1 to 128 characters', 1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
fs.writeFileSync(
  path.join(options.output, 'dossier.json'),
  buildDossier(options.output, {
    text_max_bytes: GATE.textMaxBytes,
    screenshots: { max: GATE.screenshotMax, max_bytes: GATE.screenshotMaxBytes },
    dashboard: { max_files: GATE.dashboardMaxFiles, max_bytes: GATE.dashboardMaxBytes },
  }),
);

process.stdout.write(
  'token radar: ' +
    snapshot.protocols.length +
    ' protocols, ' +
    snapshot.watchlist.length +
    ' on the watchlist, ' +
    board.length +
    ' rows scored (' +
    radar.early_size +
    ' early, ' +
    radar.live_size +
    ' live set aside)\n' +
    'token radar: wrote ' +
    path.join(options.output, 'board.json') +
    ', ' +
    path.join(options.output, 'data.js') +
    ', ' +
    path.join(options.output, 'dashboard') +
    ' (' +
    dashboardFiles.length +
    ' files), ' +
    path.join(options.output, 'screenshots') +
    ' (' +
    shotFiles.length +
    ' images) and ' +
    path.join(options.output, 'dossier.json') +
    '\n',
);
