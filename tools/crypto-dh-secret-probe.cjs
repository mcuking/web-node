// M92.2 differential probe: `crypto.diffieHellman({ privateKey, publicKey })`.
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. The DH/EC *fixtures* below were recorded from real
// Node, so the shared-secret bytes are deterministic; freshly generated pairs
// only contribute stability/consistency booleans.
const crypto = require('crypto');

const DH_PRIV = '3082013f0201003082011706092a864886f70d010301308201080282010100ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff020102041f021d01c8f59c63b6f984d82c57c2571f334d65f49945650b47a99fa52cc367';
const DH_PUB = '308202243082011706092a864886f70d010301308201080282010100ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff02010203820105000282010039682110fc1f77f2c6a14b651f4da29f1542fbde9640401b895a030a767867de0550c2a06301f7b19c3785b3a43de1662d16473816532624f71f9c9dee7164b895e20394ea8d6c939c672a4d7b56ade2829a139ed002e6ed8705d56b9bcd68ac6b3bafe9d6ff31bd1a61323fc39e4545e3c62af0e967ca43893b35992889f8cdc073cab7d5e6bb847208b97a54f30e0b352dcf6582f91bf5dc2c53b65446683b51a5eb32960197aaa2c59d88900db7515f17236fa929eaaa6742b8bcbce0405c279f764b894a48bf4b5312cd88ed6b9866dee8e7503df769bc0570c7cfab8324722ac6616b21aa52c8f004582ac4084da03638d88784e328f5c8f433aa890d0d';
const EC_PRIV = '308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420c499a09a500d5312ff38b28ab383dccdd00c37dce17c00732465fac9e2908192a144034200041ffbfd9eeca443b69546f113986dce2175da97568b602a5ebc624c1c2c835156d6cbd68c583e9a897524db66545d9ce0b97919f24df4f08e65c02166da2b6962';
const EC_PUB = '3059301306072a8648ce3d020106082a8648ce3d030107034200041ffbfd9eeca443b69546f113986dce2175da97568b602a5ebc624c1c2c835156d6cbd68c583e9a897524db66545d9ce0b97919f24df4f08e65c02166da2b6962';

const fromHex = (h) => Buffer.from(h, 'hex');
const hex = (b) => Buffer.from(b).toString('hex');
const obs = {};

function err(fn) {
  try {
    return { ok: true, value: hex(fn()) };
  } catch (e) {
    return { ok: false, name: e.name, code: e.code, message: e.message };
  }
}

const dhPriv = crypto.createPrivateKey({ key: fromHex(DH_PRIV), format: 'der', type: 'pkcs8' });
const dhPub = crypto.createPublicKey({ key: fromHex(DH_PUB), format: 'der', type: 'spki' });
const ecPriv = crypto.createPrivateKey({ key: fromHex(EC_PRIV), format: 'der', type: 'pkcs8' });
const ecPub = crypto.createPublicKey({ key: fromHex(EC_PUB), format: 'der', type: 'spki' });

obs.dhSecretSelf = hex(crypto.diffieHellman({ privateKey: dhPriv, publicKey: dhPub }));
obs.dhSecretPrivAsPub = hex(crypto.diffieHellman({ privateKey: dhPriv, publicKey: dhPriv }));
obs.ecSecretSelf = hex(crypto.diffieHellman({ privateKey: ecPriv, publicKey: ecPub }));
obs.ecSecretPrivAsPub = hex(crypto.diffieHellman({ privateKey: ecPriv, publicKey: ecPriv }));

const a = crypto.generateKeyPairSync('dh', { group: 'modp14' });
const b = crypto.generateKeyPairSync('dh', { group: 'modp14' });
obs.dhCrossEqual =
  hex(crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey })) ===
  hex(crypto.diffieHellman({ privateKey: b.privateKey, publicKey: a.publicKey }));
obs.dhSecretLen = crypto.diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey }).length;

const ea = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const eb = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
obs.ecCrossEqual =
  hex(crypto.diffieHellman({ privateKey: ea.privateKey, publicKey: eb.publicKey })) ===
  hex(crypto.diffieHellman({ privateKey: eb.privateKey, publicKey: ea.publicKey }));
obs.ecSecretLen = crypto.diffieHellman({ privateKey: ea.privateKey, publicKey: eb.publicKey }).length;

obs.noArg = err(() => crypto.diffieHellman());
obs.nullArg = err(() => crypto.diffieHellman(null));
obs.empty = err(() => crypto.diffieHellman({}));
obs.pubOnly = err(() => crypto.diffieHellman({ publicKey: dhPub }));
obs.privOnly = err(() => crypto.diffieHellman({ privateKey: dhPriv }));
obs.pubAsPriv = err(() => crypto.diffieHellman({ privateKey: dhPub, publicKey: dhPriv }));

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 512 });
obs.dhPrivRsaPub = err(() => crypto.diffieHellman({ privateKey: dhPriv, publicKey: rsa.publicKey }));
obs.rsaPrivDhPub = err(() => crypto.diffieHellman({ privateKey: rsa.privateKey, publicKey: dhPub }));
obs.dhPrivEcPub = err(() => crypto.diffieHellman({ privateKey: dhPriv, publicKey: ecPub }));

const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
obs.ecDiffCurves = err(() => crypto.diffieHellman({ privateKey: ecPriv, publicKey: p384.publicKey }));

const k15 = crypto.generateKeyPairSync('dh', { prime: crypto.getDiffieHellman('modp15').getPrime(), generator: 2 });
obs.dhCrossGroup = err(() => crypto.diffieHellman({ privateKey: dhPriv, publicKey: k15.publicKey }));

console.log('__OBS__' + JSON.stringify(obs));
