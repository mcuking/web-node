# ROADMAP — web-node 路线图

> **用途**：一份**固定、可追溯**的任务清单，回答两个问题——「现在坐到哪了？」「还剩多少任务？」
> 与 `docs/DEVLOG.md` 的分工：DEVLOG 记**已发生**的变更（倒序流水）；ROADMAP 记**还没做**的事（正序规划）。每完成一项，在这里打勾并把成果写进 DEVLOG。
>
> - **状态图例**：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[-]` 不做（有意不做 / 死路，附理由）
> - **编号**：沿用里程碑号 `M88` 起。已完成的 `M1–M87` 见文末「已完成总览」。
> - **验收标准（每项都适用）**：① 差分语料对真 Node v26.9.0 **0 diff**；② `npm run typecheck` 干净；③ `npx vitest run` 全绿；④ `npm run build` 记录 worker 体积；⑤ 部署 gh-pages 且线上资产 200；⑥ 更新 DEVLOG + memory；⑦ 不能对真的东西响亮抛 `NotImplementedError`，绝不静默伪造。
> - **最后更新**：2026-09-22（基线 = M91 完成；ML-KEM（FIPS 203）上线，**阶段 A crypto 全部收尾**）

---

## 进度总览

| 阶段 | 主题 | 任务数 | 已完成 | 剩余 |
|---|---|---|---|---|
| A | crypto 收尾（接续 M87） | 22 | 20 | 2 |
| B | 语义深度（差分语料继续扩面） | 4 | 0 | 4 |
| C | 平台无对应物的补齐（选择性） | 3 | 0 | 3 |
| D | 运行时常量小项收尾 | 4 | 0 | 4 |
| E | 性能路线（wasm / 共享内存） | 2 | 0 | 2 |
| F | 构建工具链（**用户愿景，最后做**） | 5 | 0 | 5 |
| — | 已判定不做 | 1 | — | — |
| **合计** | | **41** | **22** | **18**（+1 不做） |

> 加上已完成的 **M1–M87**，项目整体：**已完成 109 个里程碑，剩余 18 个规划任务（其中 5 个是 webpack/rspack 构建工具链，排最后）**。
> 注：M90 于 2026-09-22 拆为 M90.1–M90.4（26 → 30），同日晚 M90.5 又拆为 M90.5–M90.9（30 → 34）。
> 注：M90 于 2026-09-22 拆为 M90.1–M90.5（任务数 26 → 30）。

---

## 阶段 A — crypto 收尾（接续 M87）

> 现状：非对称半边（RSA/EC/Ed25519/ECDH/DH/X509）已在 M83–M87 完成。剩下的都是「还没做的算法/API」。
>
> **本阶段执行顺序**：M88 → M89 → M90.* → **M92 → M93 → M94 → M91**。其中 **M91（PQC KEM）按原说明后置到末尾**（代码量大、依赖向量多，可后置或砍）；2026-09-22 据其「优先级最低」的原始标注调整了排序。

- [x] **M88 · 素数生成与素性检验** ✅ 2026-09-22
  - `generatePrime` / `generatePrimeSync` / `checkPrime` / `checkPrimeSync`
  - 纯 JS：BigInt 模幂 + Miller-Rabin；对齐 `safe` / `bigint` / `add` / `rem` / `checks` 选项与错误形状（`ERR_OUT_OF_RANGE` / `ERR_INVALID_ARG_TYPE`）。
  - 对应 OpenSSL `BN_generate_prime_ex` / `BN_check_prime`。默认返回 **`ArrayBuffer`**；`size <= 1` 报 `ERR_OSSL_BN_BITS_TOO_SMALL`。
  - 差分：`tools/crypto-primes-probe.cjs` → `test/fixtures/crypto-primes.json`（**0 diff**）；`test/crypto-primes.test.ts`。

- [x] **M89 · Argon2** ✅ 2026-09-22
  - `argon2` / `argon2Sync`（对齐 Node 的选项：`algorithm`/`type`、`message`/`nonce`/`parallelism`/`tagLength`/`memory`/`passes`、`associatedData`/`secret`）。
  - 纯 JS 实现 Argon2d/i/id：`src/node-runtime/crypto/blake2b.ts` + `argon2.ts`（BLAKE2b + BlaMka 压缩 + 三类索引生成）。
  - 差分：`tools/crypto-argon2-probe.cjs` → `test/fixtures/crypto-argon2.json`（**0 diff**，含 RFC 9106 三条官方向量）；`test/crypto-argon2.test.ts`。
  - 风险：中（代码量大，算法是公开规范）。

- [ ] **M90 · `createMac` / `getMacs`**（拆为 M90.1–M90.5）
  > **2026-09-22 拆分原因**：原估计「低–中」偏乐观。实测 `crypto.getMacs()` 返回 11 项（`blake2bmac`/`blake2smac`/`cmac`/`gmac`/`hmac`/`kmac-128`/`kmac-256`/`kmac128`/`kmac256`/`poly1305`/`siphash`），`createMac(algorithm, key, options)` 每个算法各自要一套底层原语。拆成四个可独立验证的里程碑。

- [x] **M90.1 · `getMacs()` + `createMac` 前端与 HMAC / BLAKE2b MAC** ✅ 2026-09-22
  - `Mac` 类（`update`/`final`，继承 `LazyTransform` 的流接口、`_transform`/`_flush`）、`createMac`、`getMacs`。
  - 选项/错误面：`options.digest` 对 HMAC 必填、`options.cipher`/`iv`/`customization`/`salt`/`outputLength`、`ERR_CRYPTO_INVALID_MAC`、`ERR_CRYPTO_MAC_FINALIZED`、`ERR_CRYPTO_MAC_UPDATE_FAILED`、input/output 编码。
  - 复用已有 `hash.ts` 的 hmac 与 `blake2b.ts`。M90.1–M90.4 已全部落地（HMAC / BLAKE2b / BLAKE2s MAC / KMAC / CMAC / GMAC / Poly1305 / SipHash）；唯一已知偏离是非 AES 的 CMAC 块密码与 `aria-*-gcm` 等抛 `NotImplementedError`。
  - 风险：中低。

- [x] **M90.2 · KMAC128 / KMAC256** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/keccak.ts`：Keccak-f[1600] 置换 + sponge；SHA3-224/256/384/512、SHAKE128/256，以及 SP 800-185 的 cSHAKE128/256 与 KMAC128/256。
  - `createMac` 接入 `kmac-128`/`kmac-256`：默认输出 32/64 字节、`customization` 映射为 `S`、key 长度 <4 报 `ERR_OSSL_INVALID_KEY_LENGTH`、`options.digest` 不支持。
  - 差分：`test/crypto-mac.test.ts` 已扩展 KMAC 语料（含 SP 800-185 sample #1/#2/#4/#5/#6 与 key 长度扫描）——**0 diff**；`test/keccak.test.ts` 用 FIPS 202 / SP 800-185 官方向量直接钉住置换。
  - **踩坑**：KMAC 尾部是 `right_encode(L)`（L 为**比特**长度），不是 `right_encode(0)`（后者是 KMACXOF）；写成 0 时 sample#1 全错。
  - 风险：中。

- [x] **M90.3 · CMAC / GMAC** ✅ 2026-09-22
  - `cipher.ts` 新增 `aesCmac`（SP 800-38B）与 `aesGmac`（SP 800-38D）；`createMac` 接入 `cmac`/`gmac`。
  - 语义：`options.cipher` 必填；CMAC 要求 CBC 模式（否则 `ERR_OSSL_INVALID_MODE`）、key 长度必须等于 cipher 密钥长（否则 `ERR_OSSL_EVP_INVALID_KEY_LENGTH`）；GMAC 要求 iv 非空（`The property 'options.iv' must be non-empty for GMAC`）、GCM 模式、key 长度对齐（`ERR_OSSL_INVALID_KEY_LENGTH`）；`iv`/`customization`/`salt`/`outputLength` 对 cmac 均不支持，`customization`/`salt`/`outputLength` 对 gmac 不支持（复刻 Node 的校验顺序）。
  - **已知偏离**：非 AES 的 CBC 块密码（des-ede3-cbc / camellia-128-cbc / aria-\*-gcm …）→ 响亮抛 `NotImplementedError`（Node 能算）。
  - 差分：`test/fixtures/crypto-mac.json` 已扩 cmac/gmac（含 keyobj / 大写 cipher / 各种错误面共 51 项）——**0 diff**。
  - 风险：中低。

- [x] **M90.4 · BLAKE2s MAC / Poly1305 / SipHash** ✅ 2026-09-22
  - 新增 `crypto/blake2s.ts`（BLAKE2s，带 key/salt/personal 参数块）、`crypto/poly1305.ts`（RFC 8439）、`crypto/siphash.ts`（匹配 OpenSSL：**默认 16 字节输出**，即 SipHash-2-4 的 128-bit 变体 v1/v2 ^= 0xee；`outputLength:8` 走经典 64-bit 变体）。
  - `createMac` 接入 `blake2smac`/`poly1305`/`siphash`，并用统一的「允许选项集 + 固定校验顺序（digest→cipher→iv→customization→salt→outputLength）」复刻所有「not supported」错误。
  - **修正 M90.1 的缺口**：blake2b/blake2s 的 `salt`/`customization` 是**支持的**（影响参数块），M90.1 忽略了它们（会在传 salt 时算错），现已修正并纳入差分语料。
  - 关键语义：blake2s 输出/密钥 ≤32、salt/custom ≤8；blake2b ≤64 / salt,custom ≤16；poly1305 密钥必须 32；siphash 密钥必须 16、输出∈{8,16}（其他 → `ERR_CRYPTO_OPERATION_FAILED`）。
  - 差分：`test/fixtures/crypto-mac.json` 扩到 **78 个错误项** + blake2s/poly1305/siphash 正向向量——**0 diff**。
  - 风险：中低。

- [x] **M90.5 · SHA-3 / Keccak / SHAKE / keccak-kmac 注册** ✅ 2026-09-22
  > **拆分原因**：动手做 M90.5 时实测真 Node 的 `getHashes()` 有 **81 个可用名字**（不是原先以为的十来种），包含 SHA-3/Keccak/SHAKE/keccak-kmac/blake2/SM3/RIPEMD-160/SHA-512-t/SHA-256-192/md5-sha1 及大量 RSA-*/…WithRSAEncryption 别名。原估「中低」严重偏低，故拆为 **M90.5–M90.9** 五个子任务（任务数 30 → 34）。
  - `keccak.ts` 导出原始 sponge；`Hash` 支持 XOF 的 `options.outputLength`（缺省 **shake128=16 / shake256=32**）；注册 `sha3-224/256/384/512`、`keccak-224/256/384/512`（pad 0x01）、`shake-128/256`、`keccak-kmac-128/256`（pad 0x04，rate 168/136）及其全部别名。
  - 风险：低。

- [x] **M90.6 · BLAKE2b-512 / BLAKE2s-256 注册** ✅ 2026-09-22
  - 直接用 M90.1/M90.4 的 `blake2b.ts`/`blake2s.ts`（无 key/salt/personal 的普通摘要形式）；注册 `blake2b512`/`blake2b-512`/`blake2s256`/`blake2s-256`。
  - 风险：低。

- [x] **M90.7 · SM3 + RIPEMD-160** ✅ 2026-09-22
  - 新增两个纯 JS 摘要实现（GB/T 32905 与 ISO/IEC 10118-3），并注册 `sm3`/`RSA-SM3`/`sm3WithRSAEncryption`、`ripemd160`/`ripemd`/`ripemd-160`/`rmd160`/`RSA-RIPEMD160`/`ripemd160WithRSA`。
  - 风险：中低（两套轮函数）。

- [x] **M90.8 · 截断变体与复合摘要** ✅ 2026-09-22
  - `sha-512/224`、`sha-512/256`（SHA-512/t，需改 IV）+ `RSA-SHA512/224`/`RSA-SHA512/256`；`sha-256/192`（`sha2-256/192`/`sha256-192`，SHA-256 截断）；`md5-sha1`（复合）；`ssl3-md5`/`ssl3-sha1` 别名。
  - 风险：中低。

- [x] **M90.9 · `getHashes()` 全表对齐（差分门禁）** ✅ 2026-09-22（getHashes 已 **81/81** 与真 Node 一致）
  - 把 `getHashes()` 与真 Node 的 **81 名列表**逐项比对（含排序与所有别名），并加 `createHash(每个名字)` 的差分回归。
  - 风险：低。

- [x] **M91 · 后量子 KEM** ✅ 2026-09-22
  - `encapsulate` / `decapsulate`（ML-KEM / Kyber），以及 `ml-kem-512/768/1024` 密钥类型。
  - 纯 JS 实现 ML-KEM（FIPS 203），建在既有 Keccak（SHA3/SHAKE）之上；NTT 常量由 `ζ = 17` 程序化推导，不手抄。
  - 与真 Node / OpenSSL 逐字节对齐（差分 0 diff）；签名验签/封装/解封类全绿。
  - 风险：高（已控制，实测通过）。

- [x] **M92 · `crypto.diffieHellman` + DH KeyObject** ✅ 2026-09-22
  > **拆分原因**：动手前调查发现 web-node **根本没有 DH 类型的 `KeyObject`**（`AsymType` 只有 `rsa|ec|ed25519`，`generateKeyPairSync('dh')` 会抛错）。而 `crypto.diffieHellman` 既接 DH 也接 EC 的 `KeyObject`，所以要先把 DH KeyObject 补上。原估「低风险」偏低，故拆为 M92.1/M92.2（任务数 34 → 35）。

- [x] **M92.1 · DH `KeyObject`** ✅ 2026-09-22
  - `KeyMaterial` 增 `dh`；`generateKeyPairSync('dh', { group } | { prime, generator })`；`asymmetricKeyType === 'dh'`；导出/解析 PKCS#3（私钥）与 SPKI（公钥，OID `dhKeyAgreement`），PEM 标签 `DH PRIVATE KEY`/`PUBLIC KEY`；`export`/`equals`/`toCryptoKey` 相应支持。
  - 风险：中（DER 编解码 + 参数校验）。

- [x] **M92.2 · `crypto.diffieHellman({ privateKey, publicKey })`** ✅ 2026-09-22
  - DH：`y_b^{x_a} mod p`，按 prime 长度补前导零；EC：`d_a · Q_b` 的 x 坐标，按曲线字节长补齐。
  - 错误面：`options` 非对象 → `ERR_INVALID_ARG_TYPE`；私/公钥缺失 → `The property 'options.privateKey/publicKey' is invalid. Received undefined`；类型不符 → `ERR_CRYPTO_INCOMPATIBLE_KEY`（`Incompatible key types for Diffie-Hellman: dh and rsa`）；跨组 → `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`。
  - 风险：中低。

- [x] **M93 · 更多对称密码**（拆为 M93.1–M93.4）✅ 完成
  > **2026-09-22 拆分原因**：原估「低–中」但覆盖面很大（DES/3DES、ChaCha20、CCM、OCB、SIV、XTS、wrap 系列，以及 Camellia/ARIA/SM4），每个都有各自的模式/参数/向量，混作一个里程碑无法逐项验证。按建议顺序拆为四个子项（任务数 35 → 38）。

- [x] **M93.1 · ChaCha20 / ChaCha20-Poly1305** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/chacha20.ts`：ChaCha20 块函数 + 流式 keystream（raw 用 64-bit 计数器、AEAD 用 32-bit），以及 RFC 8439 Poly1305 AEAD（复用 `poly1305.ts`）。
  - `createCipheriv` 接入 `chacha20`（IV 16）与 `chacha20-poly1305`（IV 12）；两套实现共用 `SyncCipher` 接口，`crypto/cipher.ts` 新增 `createCipher` 工厂与 `cipherTagLengthIsValid`。
  - 语义修正（对齐真 Node）：`getCipherInfo` 对 stream 模式不再返回 `blockSize`；`setAuthTag` 改为要求长度**等于** `authTagLength`（GCM 一并修正）；chaCha 解密未 `setAuthTag` 时也按全零 tag 校验并报 `Unsupported state or unable to authenticate data`（无 `code`）。
  - 差分：`tools/crypto-chacha-probe.cjs` → `test/fixtures/crypto-chacha.json`（含 RFC 8439 §2.4.2/§2.8.2 官方向量、截断 tag、AAD、错误面）——**0 diff**；`test/crypto-chacha.test.ts`。
  - 风险：低。

- [x] **M93.2 · DES / 3DES** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/des.ts`：纯 JS DES 块密码（FIPS 46-3 全表）+ EDE2/EDE3；`createCipheriv` 接入 `des-ede`/`des-ede-ecb`/`des-ede-cbc`/`des-ede-cfb`/`des-ede-ofb` 与 `des-ede3`/`des-ede3-ecb`/`des-ede3-cbc`/`des-ede3-cfb`/`des-ede3-ofb`/`des3`（ECB/CBC/CFB-128/OFB，8 字节块 + PKCS#7）。
  - 顺带把 CMAC 改成**通用块密码 CMAC**（`cmacCore` + `aesCmac`/`desCmac`），于是 `createMac('cmac', key, { cipher: 'des-ede3-cbc' })` 也能算了（8 字节 tag）——M90.3 记的「非 AES CMAC 报错」偏离因此收窄。
  - **已知偏离**：`des-ede3-cfb1`/`des-ede3-cfb8` 与 `des3-wrap`/`id-smime-alg-cms3deswrap` 仍抛 `NotImplementedError`。
  - 差分：`tools/crypto-des-probe.cjs` → `test/fixtures/crypto-des.json`（**0 diff**）；`test/crypto-des.test.ts`；CMAC 语料并入 `test/fixtures/crypto-mac.json`。
  - 风险：中低。

- [x] **M93.3 · AES-CCM** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/ccm.ts`：SP 800-38C 的 CBC-MAC + 计数器模式 AEAD，含 B0/A0 构造、AAD 长度前缀（<0xff00 用 2 字节，否则 0xfffe/0xffff 变长）、payload 块切分。
  - 把 AES 块密码从 `cipher.ts` 抽到新模块 `src/node-runtime/crypto/aes.ts`（`AesKey` 导出），`cipher.ts` 与 `ccm.ts` 共用，避免循环依赖。
  - `createCipheriv` 接入 `aes-{128,192,256}-ccm` 与其 `id-aes*-ccm` 别名；`authTagLength` **必填**（缺失报 `ERR_CRYPTO_INVALID_AUTH_TAG: authTagLength required for aes-128-ccm`），合法值 `{4,6,8,10,12,14,16}`；nonce 长度限 `[7,13]`，越界报 `ERR_CRYPTO_INVALID_IV: Invalid initialization vector`。
  - 语义对齐真 Node：带 AAD 时 `plaintextLength` 必填（缺失报 `ERR_MISSING_ARGS: options.plaintextLength required for CCM mode with AAD`）；`update` 必须**一次性**给出精确 `plaintextLength` 字节，否则报 `Trying to add data in unsupported state`（无 `code`）；解密 tag 不匹配报 `Unsupported state or unable to authenticate data`。
  - 差分：`tools/crypto-ccm-probe.cjs` → `test/fixtures/crypto-ccm.json`（含 SP 800-38C 附录 C 例 1、16/24/32 密钥、tag 4–16、nonce 7–13、空 payload、全套错误面）——**0 diff**；`test/crypto-ccm.test.ts`。
  - 风险：中低。

- [ ] **M93.4 · 其余模式与密码**（拆为 M93.4a–M93.4d）
  > **2026-09-22 拆分原因**：与 M93 同理——覆盖面过大（三种额外块密码 + 四种额外模式/包装），逐项验证无法混在一起。拆为：

  - [x] **M93.4a · Camellia** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/camellia.ts`：纯 JS 实现 RFC 3713（128 位分组、128/192/256 位密钥；BigInt 写密钥编排与 Feistel 数据路径，S 盒 `s2/s3/s4` 由 `s1` 旋转得到）。
    - 把 AES 风格的模式驱动 `Cipheriv` 泛化：新增 `BlockCipher` 接口（`encryptBlock`/`decryptBlock`），构造函数可选传入块密码（默认 `AesKey`），于是 Camellia 直接复用 ECB/CBC/CFB/OFB/CTR 与 PKCS#7。
    - 接入 `camellia-{128,192,256}` 的 ecb/cbc/cfb/ofb/ctr + `camellia128/192/256` 别名；CMAC 现按 cipher 分派（`cmacForCipher` → `aesCmac`/`desCmac`/`camelliaCmac`）。
    - **关键坑**：128 位密钥的 `k1..k18` 并非连续半字对——`k10` 取的是 `KL<<<60` 的**低**半字（RFC 3713 §2.2），初版按 `halves()` 成对生成导致密文错位；改用显式 `hi()/lo()` 后与官方向量一致。
    - 差分：`tools/crypto-camellia-probe.cjs` → `test/fixtures/crypto-camellia.json`（RFC 3713 三条官方向量 + 15 个模式组合 + 流式/padding + CMAC + 错误面）——**0 diff**；`test/crypto-camellia.test.ts`。
    - 风险：中低。
  - [x] **M93.4b · ARIA / SM4** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/aria.ts`（RFC 5794：`FO=A(SL1(D^RK))`/`FE=A(SL2(D^RK))`、三层 Feistel 密钥编排、末轮 SL2 加双密钥；SB3/SB4 由 SB1/SB2 的逆**推导**而非手抄）与 `src/node-runtime/crypto/sm4.ts`（GB/T 32907：32 轮、`tau` + `L`、密钥编排 `L'`）。
    - 两者都是 128 位块，直接复用泛化后的 `Cipheriv`。接入 `aria-{128,192,256}` 与 `sm4` 的 ecb/cbc/cfb/ofb/ctr，加 `aria128/192/256`、`sm4` 别名；CMAC 分派扩展到 aria/sm4。
    - 顺手修掉 M93.4a 遗留的一个隐患：camellia/aria/sm4 用专用的 5 模式表（不再误用含 gcm 的 6 项 `modes` 生成幽灵 `*-gcm` 条目）。
    - 差分：`tools/crypto-aria-sm4-probe.cjs` → `test/fixtures/crypto-aria-sm4.json`（ARIA/SM4 全部 20 个名称的 info + 20 组模式密文/回环 + 流式/无 padding + CMAC + 错误面）——**0 diff**；`test/crypto-aria-sm4.test.ts`。
    - 风险：中低。
  - [x] **M93.4c · AES-OCB 与 key wrap** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/ocb.ts`：按 OpenSSL `ocb128.c` 逐字节实现 RFC 7253（`L_*`/`L_$`/`L_i` 双倍、stretch 取位生成 `Offset_0`、CBC-MAC 式 checksum 与 AAD sum）。**注意 OpenSSL 的 nonce 不标准**：`nonce[0]=((taglen*8)%128)<<1`、IV 靠右、其左一字节置 1——所以密文会随 tag 长度变化，必须按它来。
    - 新增 `src/node-runtime/crypto/wrap.ts`：RFC 3394 `wrap` 与 RFC 5649 `wrap-pad`（含 n=1 的 AIV||P 单块特例）；两者都是**单次 update**（`update` 返回全部输出、`final` 空，二次 update 报 `Trying to add data in unsupported state`）。
    - 接入 `aes-{128,192,256}-ocb`（IV 1..15、`authTagLength` 必填、0..16）与 `aes-{128,192,256}-wrap`/`-wrap-pad`（含 `aes128-wrap`、`id-aes128-wrap` 等拼写，IV 8/4 字节且必填）。
    - 语义细节：OCB 按 OpenSSL provider 那样**缓存尾巴不满块**，末块输出在 `final`；解密 tag 不符在 `final` 报 `Unsupported state or unable to authenticate data`；`getAuthTag` 在 `final` 前报 `ERR_CRYPTO_INVALID_STATE`。
    - **已知偏离**：`aes-*-wrap-inv`/`-wrap-pad-inv`（OpenSSL 的逆 wrap）与 `des3-wrap`/`id-smime-alg-cms3deswrap` 仍抛 `NotImplementedError`。
    - 差分：`tools/crypto-ocb-wrap-probe.cjs` → `test/fixtures/crypto-ocb-wrap.json`（RFC 7253 附录 A、tag 8/12/16、IV 8/12/13/15、空/块/长 payload、流式分块、wrap/wrap-pad 的 RFC 3394/5649 向量与回环、全套错误面）——**0 diff**（首次运行）；`test/crypto-ocb-wrap.test.ts`。
    - 风险：中。
  - [x] **M93.4d · AES-SIV / AES-XTS** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/siv.ts`：RFC 5297 的 S2V（`d = dbl(d) ^ CMAC(K, aad)`，载荷块 `len>=16` 用 `S||(S_last^d)`、否则 `dbl(d) ^ pad(S)`）+ AES-CTR；密钥为两半（CMAC 半 + CTR 半），tag 即 IV，tag 固定 16 字节。
    - 新增 `src/node-runtime/crypto/xts.ts`：IEEE 1619 的 tweak = AES(k2, iv)、逐块 doubling、尾部不满块按**密文窃取**（CTS）处理；密钥两半不可相同（否则 `ERR_OSSL_XTS_DUPLICATED_KEYS`）。
    - 接入 `aes-{128,192,256}-siv`（无 IV、`ivLength=0`、无 nid）与 `aes-{128,256}-xts`（IV 16、nid 913/914，无 192 变体）；`getCipherInfo` 现在会像 OpenSSL 那样在 nid/ivLength 为 0 时**省略该字段**。
    - **关键坑**：①XTS 的 tweak doubling 是**小端**方向的 GF 倍乘（进位从末字节流向首字节），与 SIV/GCM 的大端方向相反——最初复用了大端的 `dbl` 导致从第 2 块起全错；②`Buffer.prototype.slice` 在本 runtime 里返回**共享内存的视图**，CTR 计数器自增因此改写了存起来的 auth tag 末字节，必须用 `new Uint8Array(x)` 显式拷贝。
    - 语义细节：SIV/XTS 都是**单次 update**（二次 update 与不足一块报 `Trying to add data in unsupported state`）；SIV 未 `update` 就 `final` 报鉴权错误，XTS 报 `Unsupported state`；XTS 的 `setAAD`/`getAuthTag`/`setAuthTag` 报 `ERR_CRYPTO_INVALID_STATE`。
    - 差分：`tools/crypto-siv-xts-probe.cjs` → `test/fixtures/crypto-siv-xts.json`（SIV：128/192/256 密钥、多 AAD、空/16/32/40 字节载荷；XTS：16/20/32/33/48/1000 字节、全块与 CTS、两套 key/iv；全套错误面）——**0 diff**；`test/crypto-siv-xts.test.ts`。
    - 风险：中高。

- [x] **M94 · `crypto.Certificate`** ✅ 2026-09-22
  - Node 已弃用的 `crypto.Certificate` 类（`verifySpkac`/`exportPublicKey`/`exportChallenge`）。由 `src/node-runtime/crypto/spkac.ts` 实现（NETSCAPE_SPKI 解析 + OpenSSL 风格 base64 解码 + 签名校验），在 builtin 里接成「可 new 也可直接调用」的函数 + 原型/静态三方法。
  - 风险：低。

---

## 阶段 B — 语义深度（差分语料继续扩面）

> 已做：`http`(M79) · `net`(M80) · `fs`(M81) · `crypto` 非对称(M83–87)。方法固定为「同一观测程序在真 Node 与 web-node 各跑一遍，JSON 逐字段相等」。

- [ ] **M95 · `net` 连接生命周期与超时**
  - 连接状态机、`connect`/`timeout`/`error` 事件序、`socket.setTimeout`、半开连接、`allowHalfOpen` 语义的差异对齐。

- [ ] **M96 · `fs` 错误形状补全**
  - 把剩余 ENOENT/EACCES/EISDIR/ENOTDIR 等路径的错误码、`syscall`、`path`、`errno` 逐字对齐真 Node（VFS 层）。

- [ ] **M97 · `module` 语义**
  - `registerHooks`（同步 loader hooks）、`stripTypeScriptTypes`（需 TS transform）、`SourceMap` 的注册/查找语义、`_load`/`_findPath` 的 loader 面。
  - 现状：`module.ts` 里这些是响亮抛错或返回 `undefined`；按需落地。

- [ ] **M98 · `http`/`https` 报文级差分**
  - 请求/响应全流程（keep-alive、pipeline、chunked、trailer 已在 M69 部分覆盖）的端到端差分；`https` 无 TLS 加密但语义对齐。

---

## 阶段 C — 平台无对应物的补齐（选择性，代价大）

> 这些「真 Node 能、浏览器平台没有对应物」。当前是**响亮抛错**（正确姿态）。只有确有需求才做。

- [ ] **M99 · `zlib` 同步形式 + 编码参数**
  - `gzipSync`/`deflateSync`/… 与 `level`/`windowBits`/`memLevel`/`strategy`/`dictionary`/`flush()`。
  - 需要**自研纯 JS deflate/inflate**（平台 `CompressionStream` 只有异步、无参数面）。
  - 工作量：大。除非确实需要同步压缩，否则维持抛错。

- [ ] **M100 · `perf_hooks` 直方图**
  - `createHistogram`/`importHistogram`/`monitorEventLoopDelay`（需 JS 版 hdr_histogram + 统计检验）。
  - 工作量：中–大。

- [ ] **M101 · `stream/iter` 的 `transform`**
  - `internal/streams/iter/transform.js`（顶层 `internalBinding('zlib')`，native 绑定）——依赖上面 M99 的纯 JS zlib。

---

## 阶段 D — 运行时常量小项收尾

- [ ] **M102 · `net.BoundSocket`**
  - `net.BoundSocket`（`isPipe`/`fd`/`close`/`address`）——无 OS 句柄，仍是抛错桩；按需评估。

- [ ] **M103 · `http.Agent` 的连接方法**
  - `Agent#createSocket` / `Agent#createConnection`（目前抛错）。

- [ ] **M104 · `url.fileURLToPath({ windows: true })`**
  - Windows 路径形态（浏览器标签页无 Windows FS，但可纯字符串实现）。

- [ ] **M105 · `console` / `v8` inspector 面收尾**
  - `console.createTask` 的 async_hooks 链路、`v8` inspector 相关成员的最终收尾（M75 已做移植）。

---

## 阶段 E — 性能路线

- [ ] **M106 · 热点 binding → wasm**
  - 把热点（buffer/fs/crypto）替换为 wasm 实现；引入 **SharedArrayBuffer + Atomics** 做同步 syscall。
  - 前置：COOP/COEP 响应头（子域名隔离路由已就绪 M3.5d）。

- [ ] **M107 · 启动性能**
  - 缩短冷启动（模块懒加载、预编译缓存、快照）——对标 WebContainer 的「毫秒级启动」。

---

## 阶段 F — 构建工具链（**用户愿景，拍到最后做**）

> 目标：这个浏览器 Node 环境能跑 **rspack / vite / webpack** 等前端构建工具。现状：**vite 已通**（M5c–M5f，build + dev + HMR）。

- [ ] **M108 · 对齐异步 / tick 语义，跑通 webpack build**  ⚠️ 关键前置，建议排在 F 阶段首位
  - 已定位阻塞点：webpack 5 能加载、能进 `compiler.run`，卡在 `enhanced-resolve` 的模块解析（回调不推进）。
  - 根因候选：① `fs` 回调的投递时机与真 Node 不一致；② 程序结束前 pending 的 **nextTick / microtask 未排空**；③ `CachedInputFileSystem` 的「缓存命中 → `process.nextTick`」路径在此语义下停摆。
  - 顺手已修：`browser` 字段替换目标的解析基准（`78f8a59`）。
  - 验收：页内 `webpack` 生产构建产出 bundle。

- [ ] **M109 · webpack loader / plugin 生态**
  - `babel-loader` / `ts-loader` / `css-loader` / `style-loader` / `html-webpack-plugin` / `terser-webpack-plugin`。

- [ ] **M110 · webpack watch / dev-server**

- [ ] **M111 · rspack（wasm32-wasi + emnapi）**
  - 现状：核心是 Rust napi 原生插件（`.node`）页面跑不了；但官方有 `@rspack/binding-wasm32-wasi`（2.2.6，基于 `@emnapi/core` + `@napi-rs/wasm-runtime`）。
  - 需要 **WASI 宿主 + 线程（SharedArrayBuffer / COOP-COEP）**。**先做一次性 spike 验证 wasm 能否在页内初始化**，再决定投入。

- [ ] **M112 · 其他框架 / 工具链**
  - React（SWC / Babel）、Svelte、TypeScript 项目、Tailwind / PostCSS 管线。

---

## 已判定不做（`[-]`，附理由）

- [-] **`async_hooks` 的 promise hooks（`promiseResolve`）**
  理由：V8 的 `SetPromiseHooks` 只暴露给 embedder（C++），JS 层拦不住 `await`/async 创建的 promise；只在 `Promise.prototype.then` 上做手脚会漏一大半。**浏览器里是死路**，不做半吊子实现（详见设计文档第 9 节）。

---

## 已完成总览（M1–M87）

> 只列主题，细节见 `docs/DEVLOG.md`。**全部 ✅ 完成。**

- **运行层地基**：M1 运行层 · M2 VFS（内存树 + OPFS）
- **网络与 npm**：M3 虚拟 TCP + SW 桥 + 预览 · M3.5a keep-alive · M3.5b 浏览器真流式 · M3.5c https 壳 · M3.5d 子域名路由 · M4/M6 npm client（含 lockfile/完整性/peer/overrides/file:）
- **stream**：M8 收尾 · M10–M16 整套换真源码（state/destroy/eos/events/readable/writable/…）
- **进程与 shell**：M7 child_process + ProcessHost + mini-shell + `.bin` shim
- **vendoring 主线**（把真 Node 源搬进来）：M17 async_hooks · M19–M31（punycode/domain/diagnostics_channel/string_decoder/util.types/inspect/assert/validators/util/EventTarget/AbortController/console/os/timers/worker_threads/readline） · M33 glob · M35 perf_hooks · M36 stream/web · M37 Blob/File · M38 stream/iter · M48 Buffer · M49 vfs 子系统 · M50 fs/promises · M51/M51b/M52 fs 全家 · M53 url · M54 v8 · M55 tty · M56 vm
- **worker**：M57 Worker 协作式 · M59 标准 IO · M30 消息传递
- **错误与 binding 表**：M58 码表补齐 · M60 SystemError 文案 · M61 `internalBinding` 表面 · M62/M63 errors 全表差分
- **公开表面扫描（67 模块差分清零）**：M64 模块表面 · M65 net · M66 crypto · M67 http · M68 process · M69–M78 类原型/静态/arity 收尾
- **构建工具**：M5 esbuild WASM · M5b rollup WASM · M5c Vite build · M5d Vite dev server · M5e HMR · M5f CSS 热更 · **M18 Vue 3 SFC 跑起来**
- **性能/体积**：M32 worker 减重（1259→1028KB） · M41 Buffer slab 池化
- **语义深度（差分语料）**：M79 http · M80 net · M81 fs
- **crypto 主线**：M34 同步面 · M47 对称密码 · M83 非对称 · M84 RSA 加密 + ECDH · M85 DH · M86 对称密钥生成 + FIPS · M87 X509Certificate 真解析 · M88 素数生成/素性检验 · M89 Argon2 · M90.1 MAC（HMAC + BLAKE2b MAC） · M90.2 KMAC（Keccak/SHA-3/cSHAKE） · M90.3 CMAC/GMAC（AES） · M90.4 BLAKE2s MAC / Poly1305 / SipHash · M90.5 SHA-3/Keccak/SHAKE/keccak-kmac · M90.6 BLAKE2b-512/BLAKE2s-256 · M90.7 SM3/RIPEMD-160 · M90.8 截断变体与复合摘要 · M90.9 getHashes 全表对齐（81/81） · M92.1 DH KeyObject · M92.2 crypto.diffieHellman · M93.1 ChaCha20-Poly1305 · M93.2 DES/3DES · M93.3 AES-CCM · M93.4a Camellia · M93.4b ARIA/SM4 · M93.4c OCB/wrap · M93.4d SIV/XTS · M94 crypto.Certificate（SPKAC） · M91 ML-KEM（FIPS 203）

---

## 怎么用这份文件

1. **开工前**：看「进度总览」知道还剩多少；从当前阶段往下挑第一个 `[ ]`。
2. **开工时**：把该项改成 `[~]`。
3. **完成后**：改成 `[x]`，并在 `docs/DEVLOG.md` 顶部加一条变更记录；刷新本文件「最后更新」的基线提交号与进度总览数字。
4. **新任务**：追加到对应阶段；若是新方向，开一个新阶段。
5. **不做了**：移到「已判定不做」并写理由，别删（保留决策痕迹）。
