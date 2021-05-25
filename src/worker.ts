import getLogger from './get-logger';
import piscina from 'piscina';
import fs from 'fs';
import loadCodemod from './load-codemod';
import type {CodemodResult} from './types';
import _ from 'lodash';

const baseLog = getLogger({
  name: 'jscodemod-worker',
  ...piscina.workerData.logOpts
});

const pFs = fs.promises;

/**
 * I don't think we can share this instance across workers – I got an error that said the transform function 
 * "could not be cloned" when I tried to pass the codemod itself on `workerData`.
 */
const codemod = loadCodemod(piscina.workerData.codemodPath);

export type CodemodMetaResult = {
  filePath: string;
  codeModified: boolean;
  fileContents: string;
}
export default async function main(sourceCodeFile: string): Promise<CodemodMetaResult> {
  const log = baseLog.child({sourceCodeFile});
  log.debug({action: 'start'});

  const originalFileContents = await pFs.readFile(sourceCodeFile, 'utf-8');
  const parsedArgs = await codemod.parseArgs?.(piscina.workerData.codemodArgs);

  let transformedCode: CodemodResult;
  let threwError = false;
  try {
    transformedCode = await codemod.transform({
      source: originalFileContents, 
      filePath: sourceCodeFile, 
      commandLineArgs: parsedArgs
    });
  } catch (e) {
    threwError = true;
    log.error({error: _.pick(e, 'message', 'stack')}, 'Codemod threw an error for a file.');
  }

  const codeModified = Boolean(transformedCode && transformedCode !== originalFileContents);

  const {writeFiles} = piscina.workerData; 
  if (codeModified && writeFiles) {
    // This non-null assertion is safe because `codeModified` includes a check on `transformedCode`.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await pFs.writeFile(sourceCodeFile, transformedCode!);
  }
  log.debug({action: threwError ? 'error' : codeModified ? 'modified' : 'skipped', writeFiles});
  return {
    codeModified, 
    fileContents: transformedCode ? transformedCode : originalFileContents,
    filePath: sourceCodeFile
  };
}