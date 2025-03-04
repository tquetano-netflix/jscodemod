#!/usr/bin/env node

// This is a bin file, so console logs are ok.
/* eslint-disable no-console */

import yargs from 'yargs';
import jscodemod, {defaultPiscinaLowerBoundInclusive} from './';
import _ from 'lodash';
import 'loud-rejection/register';
import getLogger from './get-logger';
import {CodemodMetaResult} from './run-codemod-on-file';
import PrettyError from 'pretty-error';
import ansiColors from 'ansi-colors';

const tsOnlyNote = '(Only applicable if your codemod is written in TypeScript)';

// Passing paths as file globs that start with `.` doesn't work.
// https://github.com/sindresorhus/globby/issues/168

const {argv} = yargs
  // TODO: Some of these options should be hidden.
  .command(
    /**
     * I feel like '$0 [options] [inputFilePatterns...] is what want, but that breaks things. It's not obvious how yargs
     * parses this string.
     */
    '$0 [inputFilesPatterns...]',
    'Run the codemod. Any arguments after "--" will be passed through to the codemod.',
    yargs => {
      yargs.positional('inputFilesPatterns', {
        type: 'string'
      })
      // Yargs' types are wrong.
      // @ts-expect-error
        .example([
          ['$0 --codemod codemod.js "source/**/*.js"', 'Run codemod.js against JS files in source'],
          [
            '$0 --codemod codemod.js --inputFileList files-to-modify.txt',
            'Run the codemod against a set of files listed in the text file.'
          ]
        ]);
    })
  .middleware(argv => {
    argv.codemodArgs = argv['--'];
    return argv;
  }, true)
  .options({
    codemod: {
      alias: 'c',
      type: 'string',
      required: true,
      describe: 'Path to the codemod to run'
    },
    inputFileList: {
      alias: 'l',
      type: 'string',
      describe: 'A file containing a newline-delimited set of file paths to run on'
    },
    // TODO: allow arbitrary TS arg passthrough at your own risk.
    tsconfig: {
      type: 'string',
      describe: `${tsOnlyNote} path to the tsconfig.json`
    },
    // I'm going to skip adding tests for this for now, because I'm not sure it's actually necessary.
    tsOutDir: {
      type: 'string',
      describe: `${tsOnlyNote} directory in which to compile your codemod to. Defaults to a temporary directory.`
    },
    tsc: {
      type: 'string',
      describe: `${tsOnlyNote} path to a "tsc" executable to compile your codemod. ` +
       'Defaults to looking for a "tsc" bin accessible from the current working directory.'
    },
    dry: {
      alias: 'd',
      type: 'boolean',
      describe: 'Print a list of files to modify, then stop.'
    },
    piscinaLowerBoundInclusive: {
      alias: 'b',
      type: 'number',
      default: defaultPiscinaLowerBoundInclusive,
      describe: 'Only use piscina if there are at least this many files. At smaller file sizes, the fixed cost of ' +
        'spinning up piscina outweighs the benefits.'
    },
    porcelain: {
      alias: 'p',
      default: false,
      type: 'boolean',
      describe: 'Produce machine-readable output.'
    },
    codemodArgs: {
      type: 'string',
      hidden: true,
      describe: 'Do not pass this argument. This is only here to make yargs happy.'
    },
    resetDirtyInputFiles: {
      alias: 'r',
      type: 'boolean',
      default: false,
      describe: 'Use git to restore dirty files to a clean state before running the codemod. ' +
        'This assumes that all input files have the same .git root. If you use submodules, this may not work.'
    },
    jsonOutput: {
      type: 'boolean',
      default: false,
      describe: 'Output logs as JSON, instead of human-readable formatting. Useful if you want to consume the output ' +
        ' of this tool from another tool, or process the logs using your own Bunyan log processor/formatter.'
    }
  })
  .group(['codemod', 'dry', 'resetDirtyInputFiles', 'inputFileList'], 'Primary')
  .group(['tsconfig', 'tsOutDir', 'tsc'], 'TypeScript')
  .group(['jsonOutput', 'porcelain'], 'Rarely Useful')
  .check(argv => {
    const log = getLogger(_.pick(argv, 'jsonOutput', 'porcelain'));
    log.debug({argv});

    // Yarg's types are messed up.
    // @ts-expect-error
    if (!((argv.inputFilesPatterns && argv.inputFilesPatterns.length) || argv.inputFileList)) {
      throw new Error('You must pass at least one globby pattern of files to transform, or an --inputFileList.');
    }
    // Yarg's types are messed up.
    // @ts-expect-error
    if (argv.inputFilesPatterns && argv.inputFilesPatterns.length && argv.inputFileList) {
      throw new Error("You can't pass both an --inputFileList and a globby pattern.");
    }
    if (argv.porcelain && !argv.dry) {
      throw new Error('Porcelain is only supported for dry mode.');
    }
    return true;
  })
  .strict()
  .help();

async function main() {
  const log = getLogger(_.pick(argv, 'jsonOutput', 'porcelain'));

  // This is not an exhaustive error wrapper, but I think it's ok for now. Making it catch more cases would introduce
  // complexity without adding much safety.
  try {
    const opts = {
      ..._.pick(argv, 'tsconfig', 'tsOutDir', 'tsc', 'dry', 'resetDirtyInputFiles', 'porcelain', 'jsonOutput',
        'piscinaLowerBoundInclusive', 'inputFileList', 'inputFilesPatterns'),
      log
    };

    // This is intentional.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function safeConsoleLog(...args: any[]) {
      if (opts.jsonOutput || opts.porcelain) {
        return;
      }

      console.log(...args);
    }

    // Yarg's types are messed up.
    Object.assign(opts, _.pick(argv, 'codemodArgs'));

    const codemodMetaResults = await jscodemod(
      argv.codemod,
      // Yarg's types are messed up.
      // @ts-expect-error
      opts
    );

    const erroredFiles = _(codemodMetaResults)
      .filter({action: 'error'})
      .map((result: CodemodMetaResult<unknown>) => _.omit(result, 'fileContents'))
      .value();
    if (erroredFiles.length) {
      if (opts.jsonOutput) {
        log.error({erroredFiles}, 'The codemod threw errors for some files.');
      } else {
        const prettyError = new PrettyError();
        safeConsoleLog(ansiColors.bold(
          'The codemod threw errors for some files. This would not stop other files from being transformed.'
        ));
        // Lodash's types are messed up.
        // @ts-expect-error
        erroredFiles.forEach(({error}) => {
          safeConsoleLog(prettyError.render(error));
        });
      }

      process.exit(1);
    }

    log.debug({codemodMetaResults});
  } catch (err) {
    // TODO: Maybe known errors should be marked with a flag, since showing a stack trace for them probably
    // is just noise.
    log.error({err}, err.message || 'Potential bug in jscodemod: uncaught error.');
    if (!argv.jsonOutput) {
      // This is intentional.
      // eslint-disable-next-line no-console
      console.log(err);
    }
    log.info("If you need help, please see this project's README, or the --help output. " +
      "If you're filing a bug report, please re-run this command with env var 'loglevel=debug', and provide the " +
      'full output.');
    process.exit(1);
  }
}

main();