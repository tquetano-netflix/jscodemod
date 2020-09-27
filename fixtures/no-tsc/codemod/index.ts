import {Codemod} from 'jscodemod';

// Compiling this will not work automatically, because no TSC will be found.

const codemod: Codemod = {
  transform({source}) {
    return `/* prefix */\n${source}`;
  }
};

export default codemod;