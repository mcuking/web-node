// M92.1 differential probe: DH `KeyObject`s.
//
// Runs unchanged on real Node v26.9.0 and inside web-node; both must print an
// identical `__OBS__` line. Generation is random so only stable shapes are
// compared for keygen; the key *fixture* below was recorded from real Node, so
// the import/export/derive paths are checked on identical bytes.
const crypto = require('crypto');

const PRIV_DER = '3082013f0201003082011706092a864886f70d010301308201080282010100ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff020102041f021d01c8f59c63b6f984d82c57c2571f334d65f49945650b47a99fa52cc367';
const PUB_DER = '308202243082011706092a864886f70d010301308201080282010100ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aacaa68ffffffffffffffff02010203820105000282010039682110fc1f77f2c6a14b651f4da29f1542fbde9640401b895a030a767867de0550c2a06301f7b19c3785b3a43de1662d16473816532624f71f9c9dee7164b895e20394ea8d6c939c672a4d7b56ade2829a139ed002e6ed8705d56b9bcd68ac6b3bafe9d6ff31bd1a61323fc39e4545e3c62af0e967ca43893b35992889f8cdc073cab7d5e6bb847208b97a54f30e0b352dcf6582f91bf5dc2c53b65446683b51a5eb32960197aaa2c59d88900db7515f17236fa929eaaa6742b8bcbce0405c279f764b894a48bf4b5312cd88ed6b9866dee8e7503df769bc0570c7cfab8324722ac6616b21aa52c8f004582ac4084da03638d88784e328f5c8f433aa890d0d';

const fromHex = (h) => Buffer.from(h, 'hex');
const hex = (b) => Buffer.from(b).toString('hex');
const obs = {};

function err(fn) {
  try {
    const value = fn();
    return { ok: true, value: typeof value === 'string' ? value : hex(value) };
  } catch (e) {
    return { ok: false, name: e.name, code: e.code, message: e.message };
  }
}

const priv = crypto.createPrivateKey({ key: fromHex(PRIV_DER), format: 'der', type: 'pkcs8' });
const pub = crypto.createPublicKey({ key: fromHex(PUB_DER), format: 'der', type: 'spki' });

obs.privType = priv.type;
obs.privAsym = priv.asymmetricKeyType;
obs.pubType = pub.type;
obs.pubAsym = pub.asymmetricKeyType;
obs.privDetailsKeys = Object.keys(priv.asymmetricKeyDetails || {});
obs.pubDetailsKeys = Object.keys(pub.asymmetricKeyDetails || {});
obs.reencodePriv = hex(priv.export({ type: 'pkcs8', format: 'der' })) === PRIV_DER;
obs.reencodePub = hex(pub.export({ type: 'spki', format: 'der' })) === PUB_DER;
obs.pemPrivFirst = priv.export({ type: 'pkcs8', format: 'pem' }).split('\n')[0];
obs.pemPubFirst = pub.export({ type: 'spki', format: 'pem' }).split('\n')[0];
obs.derivedEqualsPub = crypto.createPublicKey(priv).equals(pub);
obs.derivedDerMatches = hex(crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' })) === PUB_DER;
obs.privEqualsSelf = priv.equals(crypto.createPrivateKey({ key: fromHex(PRIV_DER), format: 'der', type: 'pkcs8' }));
obs.privNotEqualPub = priv.equals(pub);
obs.symSizePriv = priv.symmetricKeySize;
obs.symSizePub = pub.symmetricKeySize;

obs.expPrivSec1 = err(() => priv.export({ type: 'sec1', format: 'pem' }));
obs.expPrivPkcs1 = err(() => priv.export({ type: 'pkcs1', format: 'pem' }));
obs.expPubSec1 = err(() => pub.export({ type: 'sec1', format: 'pem' }));
obs.expPubPkcs1 = err(() => pub.export({ type: 'pkcs1', format: 'pem' }));
obs.expPubJwk = err(() => pub.export({ format: 'jwk' }));
obs.expPrivJwk = err(() => priv.export({ format: 'jwk' }));

// --- keygen: stable shapes only (the actual values are random) --------------
const kp = crypto.generateKeyPairSync('dh', { group: 'modp14' });
obs.genAsym = kp.privateKey.asymmetricKeyType;
obs.genPubAsym = kp.publicKey.asymmetricKeyType;
obs.genDetails = Object.keys(kp.publicKey.asymmetricKeyDetails || {});
obs.genDerived = crypto.createPublicKey(kp.privateKey).equals(kp.publicKey);
obs.genPrivRoundtrip = kp.privateKey.equals(
  crypto.createPrivateKey({ key: kp.privateKey.export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' }),
);
obs.genPubRoundtrip = kp.publicKey.equals(
  crypto.createPublicKey({ key: kp.publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' }),
);
const genPubLen = kp.publicKey.export({ type: 'spki', format: 'der' }).length;
obs.genPubLenInRange = genPubLen >= 548 && genPubLen <= 556;

// An explicit prime that matches a named group is treated as that group
// (keylength 225), so its DER shape matches the group path above.
const g14 = crypto.getDiffieHellman('modp14');
const kp2 = crypto.generateKeyPairSync('dh', { prime: g14.getPrime(), generator: 2 });
obs.modp14PrimeDerived = crypto.createPublicKey(kp2.privateKey).equals(kp2.publicKey);
obs.modp14PrimePrivRoundtrip = kp2.privateKey.equals(
  crypto.createPrivateKey({ key: kp2.privateKey.export({ type: 'pkcs8', format: 'der' }), format: 'der', type: 'pkcs8' }),
);

// modp1 is *not* an OpenSSL named group, so the exponent is (bits(p) - 2) with
// the top bit forced: deterministic 766 bits -> deterministic DER length.
const kp1 = crypto.generateKeyPairSync('dh', { prime: crypto.getDiffieHellman('modp1').getPrime(), generator: 2 });
obs.modp1PrivDerLen = kp1.privateKey.export({ type: 'pkcs8', format: 'der' }).length;
obs.modp1Derived = crypto.createPublicKey(kp1.privateKey).equals(kp1.publicKey);

// --- option validation ------------------------------------------------------
obs.genNoParams = err(() => crypto.generateKeyPairSync('dh', {}));
obs.genBadGroup = err(() => crypto.generateKeyPairSync('dh', { group: 'nope' }));
obs.genGroupType = err(() => crypto.generateKeyPairSync('dh', { group: 123 }));
obs.genPrimeType = err(() => crypto.generateKeyPairSync('dh', { prime: 'modp14' }));
obs.genGeneratorType = err(() => crypto.generateKeyPairSync('dh', { prime: g14.getPrime(), generator: 2n }));

console.log('__OBS__' + JSON.stringify(obs));
