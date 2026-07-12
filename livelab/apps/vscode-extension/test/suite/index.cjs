const path = require('node:path');
const Mocha = require('mocha');

exports.run = function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 120_000 });
  mocha.addFile(path.resolve(__dirname, 'extension.test.cjs'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} extension test(s) failed`));
      else resolve();
    });
  });
};
