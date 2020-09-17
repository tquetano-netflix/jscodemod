import globby from 'globby';
import {promisify} from 'util';
import resolveBin from 'resolve-bin';
import tempy from 'tempy';
import execa from 'execa';
import log from 'nth-log';
import pathIsTS from './path-is-ts';
import path from 'path';
import findUp from 'find-up';
import Piscina from 'piscina';
import ProgressBar from 'progress';

// In this case, load-json-file is overkill.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('../package');

const resolveBinP = promisify(resolveBin);

type Options = {
  tsconfig?: string;
  tsOutDir?: string;
  tsc?: string;
}

// The rule is too broad.
// eslint-disable-next-line require-await
async function getTSCPath(specifiedTSCPath?: string): Promise<string> {
  if (specifiedTSCPath) {
    return specifiedTSCPath;
  }

  return resolveBinP('typescript', {executable: 'tsc'});
}

// The rule is too broad.
// eslint-disable-next-line require-await
async function getTSOutDir(specifiedTSOutDir?: string): Promise<string> {
  if (specifiedTSOutDir) {
    return specifiedTSOutDir;
  }

  return tempy.directory({prefix: `${packageJson.name}-ts-out-dir`});
}

async function compileTS(
  pathToCodemod: string, {tsconfig, tsOutDir: specifiedTSOutDir, tsc: specifiedTSC}: Options
): Promise<string> {
  if (!tsconfig) {
    throw new Error('If your codemod is TypeScript, option "tsconfig" is required.');
  }

  const tsc = await getTSCPath(specifiedTSC);
  const tsOutDir = await getTSOutDir(specifiedTSOutDir);

  const tscArgs = ['--project', tsconfig, '--outDir', tsOutDir];
  log.debug({tsc, tscArgs}, 'exec');
  await execa(tsc, tscArgs);

  const originalNodeModules = await findUp(
    'node_modules',
    // async dir => findUp.exists(path.join(dir, 'node_modules')), 
    {cwd: path.dirname(pathToCodemod), type: 'directory'}
  );
  // If this var is not defined, then it means that the codemod had no node_modules. This seems very unlikely, but I
  // suppose it's possible.
  if (originalNodeModules) {
    await execa('ln', ['-s', originalNodeModules, 'node_modules'], {cwd: tsOutDir});
  }
  log.debug({originalNodeModules}, 'Searched for original node_modules');

  return path.join(tsOutDir, path.dirname(pathToCodemod), `${path.basename(pathToCodemod, '.ts')}.js`);
}

// The rule is too broad.
// eslint-disable-next-line require-await
async function getCodemodPath(pathToCodemod: string, options: Options) {
  if (pathIsTS(pathToCodemod)) {
    return compileTS(pathToCodemod, options);
  }

  return path.resolve(pathToCodemod);
}

async function transformCode(codemodPath: string, inputFiles: string[]) {
  const piscina = new Piscina({
    filename: require.resolve('./worker'),
    argv: [codemodPath],
    workerData: {codemodPath}
  });

  const progressBar = new ProgressBar(':bar (:current/:total, :percent%)', {total: inputFiles.length});
  await Promise.all(inputFiles.map(async inputFile => {
    await piscina.runTask(inputFile);
    progressBar.tick();
  }));
}

async function codemod(pathToCodemod: string, inputFilesPatterns: string[], options: Options): Promise<void> {
  const inputFiles = await globby(inputFilesPatterns);
  log.debug({inputFiles});
  
  const codemodPath = await getCodemodPath(pathToCodemod, options);
  log.debug({codemodPath});
  
  await transformCode(codemodPath, inputFiles);
}

export default codemod;