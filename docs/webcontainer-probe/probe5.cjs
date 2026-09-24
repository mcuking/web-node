const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));
const crypto = require('crypto');
try { out('sha256', crypto.createHash('sha256').update('hi').digest('hex')); } catch (e) { out('sha256-err', e.message); }
try { out('hmac', crypto.createHmac('sha256', 'k').update('hi').digest('hex')); } catch (e) { out('hmac-err', e.message); }
try { out('randomBytes', crypto.randomBytes(8).toString('hex')); } catch (e) { out('randomBytes-err', e.message); }
try { out('uuid', crypto.randomUUID()); } catch (e) { out('uuid-err', e.message); }
try { const c = crypto.createCipheriv('aes-256-gcm', Buffer.alloc(32), Buffer.alloc(12)); out('aes-gcm', c.update('hi','utf8','hex')); } catch (e) { out('aes-gcm-err', e.message); }
try { out('pbkdf2sync', crypto.pbkdf2Sync('p','s',1000,16,'sha256').toString('hex')); } catch (e) { out('pbkdf2-err', e.message); }
try { out('timingSafeEqual', crypto.timingSafeEqual(Buffer.from('ab'), Buffer.from('ac'))); } catch (e) { out('tse-err', e.message); }
