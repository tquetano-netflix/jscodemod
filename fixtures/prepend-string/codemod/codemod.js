module.exports = {
  ignore: /codemod-ignored/,
  postProcess: modifiedFiles => {
    console.log('codemod post process', JSON.stringify(modifiedFiles));
  },
  transform({source, commandLineArgs}) {
    console.log('commandLineArgs', JSON.stringify(commandLineArgs));
    return `/* prefix prepend string */\n${source}`;
  }
};