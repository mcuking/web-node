// Records the complete `crypto.getHashes()` surface plus one digest per name,
// as a real Node sees it. Used by tools/crypto-gets-hashes-oracle.mjs to build
// test/fixtures/crypto-gets-hashes.json; web-node's parity test checks its own
// output against that fixture rather than re-running this program, so a name we
// forget to register cannot hide behind our own list.
const crypto = require('crypto');

const hashes = crypto.getHashes();
const digests = {};
for (const name of hashes) {
  digests[name] = crypto.createHash(name).update('abc').digest('hex');
}

console.log('__OBS__' + JSON.stringify({ hashes, digests }));
