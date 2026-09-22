// Differential observation program for M98 (`http`/`https` wire-level semantics).
// Runs unchanged on real Node v26.9.0 AND inside web-node; the emitted JSON must
// be equal. The ephemeral port is normalised out (both in URLs and Host headers).
const http = require('http');
const https = require('https');

// A throwaway self-signed cert so real Node's TLS listener can start; web-node's
// virtual network ignores it. Shared by both environments so the JSON matches.
/* eslint-disable */
const TLS_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC0wq7On5LaPDx9\nEP49pwapt7IcNHbTLpJJvYoog8eqc8ZH87s4GNNoYlPL/OMiZRJ0N0NYcIHQ76GJ\nYFhoFYkiIpae7ka+xGgCr+kV4O8dzYoQ8pY7KT+r8Ch3XUmKAbnZ1R69CKDsuJv4\n4GFNWG146ja2TCGBPgECC2/h+8YJdAlBKwCMGs0Vkaj4KXGqn9domnMwpjuWrFkk\nGF8sz6BWA48Pag8QMV0UuidXnypWgFuwdECQ4A1xjAkgj87hw7OQQo3746eDUFgl\nUWO6xSMWJaGmnA9gTOWBOrO5TxQbbSWIecEdNG+BwPaom8U/QxbI19q6KdxLFOFI\nehCulbWrAgMBAAECggEBAK7EXEciOdYOz10MhQQO7X5CQU7L2ucr6/yn6WBqqS3A\nakE/AhCm0B/okaR0iRbEKid7Fv33KUxdpA0yvcdEqyX50y8uqe/f7cBLXEzvAcIK\n7CaepWnl483VkQp3g5aPPKXETMfwA8dcZlEmgG1LxexWZzeyO+K9lDPp4u7Xgw23\nJm9HtGtqEfZ7ao/ZVdBqbHT86BE2ZBwQKOlmwHB/GjUUrbUbtTCPjc4cNxmV7dDq\n/BIqg6i6EsUQ2UHwUFYoFYa8bSsfVbFHOu2H470lsYSK76HPvEJygmAX+9JVrQ4u\n94uDm3CT4n8OWwDND6ptujHXEFSxvJT5dclHy1JCJgECgYEA410lGr4ZciuopeZh\num3SHxsnoVCwT8wiGn/D8zPXTsULYP1YzCKHSmcSAMHIk79mEcU7ooW7abzt3dhM\n7A5Uy1S2tLDeT6qGgm3iC5aKrWaQ4d0cclekkzNiW6rNnjvCinMQuXO0VwxkYC/S\nLT0hDcuViSdrHo41FzGLlSiE4cECgYEAy4bpx4oaxSrapBi6x9POp1o53ZlQDzzT\noEMDE/srcJgJQB1fxsgWhGTL9SzSkRFnIN3D3aeaXxdUDBTASHdQ7jd/jQyXKCus\nIX2RkTuTGyEGz1jDxTuJOaYOZsknj79UOG3ovDUhclkTwoNKpoGmjKrmSpvmWHsP\nWuTDQCAN2msCgYAhG2QWw82iwVa6aZSbd/hbzTF1HPG/fOMOZsJavJbCgpDIm7t9\nZh27KM0HTTBuyzUKq2SmosCKghdE8YUp7mBMh1Zfc0273gHeJi//LfmdjEzWhsLo\np3hwctAEtxdfziXi0SSDTKTa9BP9qZj6O2d/wcBRi2retShn6y//FTpcQQKBgEZm\n/stFXIlDj6of28xv2hZNwaKD/AupUNMpGxF4Wshx7xE8l/rdD9zwORUwUg5YZMIb\ntDsiVOX73djn/LOUgmxEylxyNH9yy/Ixy37fir1hqUdkPyQkug01AdpQTt0MpAd5\nDX69Kjqx0YIBhHsgcgpKu6qnTwDgYKliZJ/z9pbNAoGBAJAaukrhsk0bDrxTv7mx\nqMdSg9ZlnyA+M7yNi/6ZWs6pr7b4dk+bkt/1sq+KA7eJNmXovBrEUhYJaSh5/W0C\nIUmaN3Qu5GVUoESWpbYIKz6F/8T4B0U112CjrZpZt+oC+JoQJ6U1ISFS+byPDC99\nCizEmvwOtLHGRrk1B/sWcoEA\n-----END PRIVATE KEY-----";
const TLS_CERT = "-----BEGIN CERTIFICATE-----\nMIICpDCCAYwCCQCwP6AoGKh31zANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls\nb2NhbGhvc3QwHhcNMjYwOTIyMTAwNTM1WhcNMzYwOTE5MTAwNTM1WjAUMRIwEAYD\nVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC0\nwq7On5LaPDx9EP49pwapt7IcNHbTLpJJvYoog8eqc8ZH87s4GNNoYlPL/OMiZRJ0\nN0NYcIHQ76GJYFhoFYkiIpae7ka+xGgCr+kV4O8dzYoQ8pY7KT+r8Ch3XUmKAbnZ\n1R69CKDsuJv44GFNWG146ja2TCGBPgECC2/h+8YJdAlBKwCMGs0Vkaj4KXGqn9do\nmnMwpjuWrFkkGF8sz6BWA48Pag8QMV0UuidXnypWgFuwdECQ4A1xjAkgj87hw7OQ\nQo3746eDUFglUWO6xSMWJaGmnA9gTOWBOrO5TxQbbSWIecEdNG+BwPaom8U/QxbI\n19q6KdxLFOFIehCulbWrAgMBAAEwDQYJKoZIhvcNAQELBQADggEBADPTo7RexJDM\nHCZ+/tiEXsyMtlzDa0x0dZina+FUqbGY4BEh5hrpQueDentTFBFVjeL+BP3y2SRk\nQ+7wHfBh5xfOFEEszvHUZX8Dv7FFDXNNLAezZOWigLjj67QdJ67/sj1hwgAc3y/t\no6oehvrb1mcadtrQE3MqNycQPxEXGybiSq1JinHtnvo5GMpl4hZY/maKWU/uo+MX\nlfitQBbLFK48tZgT6dY120kRRus/JpuKNViKUsOISuh+nVkMARcdl7xmoFzmLvrt\n46CVGiyxq3ZjAQLZFEB6Ti8qNSaRfZbkcVztHu34XL3BWhw3xj/Cd7245SMKM825\nGBZdxVtQZUk=\n-----END CERTIFICATE-----";
/* eslint-enable */

const out = { client: [], server: [], httpsClient: [], httpsServer: [] };
let port = 0;
let httpsPort = 0;

/** Drop volatile headers (Date) and normalise the Host port away. */
function clean(headers, portValue) {
  const result = {};
  for (const key of Object.keys(headers).sort()) {
    let value = headers[key];
    if (key === 'date') continue;
    if (key === 'host') value = String(value).replace(':' + portValue, ':<port>');
    result[key] = value;
  }
  return result;
}

function doRequest(mod, portValue, opts) {
  return new Promise((resolve) => {
    const req = mod.request(
      {
        host: '127.0.0.1',
        port: portValue,
        path: opts.path,
        method: opts.method || 'GET',
        headers: opts.headers,
        agent: opts.agent,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () =>
          resolve({
            name: opts.name,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            httpVersion: res.httpVersion,
            headers: clean(res.headers, portValue),
            trailers: res.trailers,
            complete: res.complete,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', (e) => resolve({ name: opts.name, error: e.code || e.message }));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** The routes shared by both the http and https servers. */
function makeHandler(sink, portRef) {
  return (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      sink.push({
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        headers: clean(req.headers, portRef()),
        body: Buffer.concat(chunks).toString('utf8'),
      });

      switch (req.url) {
        case '/hello':
          res.end('hello world');
          break;
        case '/echo':
          res.setHeader('X-Echo', 'yes');
          res.end(Buffer.concat(chunks).toString('utf8').toUpperCase());
          break;
        case '/chunked':
          res.write('part-one;');
          res.write('part-two;');
          res.end('part-three');
          break;
        case '/trailer':
          res.writeHead(200, { Trailer: 'X-Checksum', 'Content-Type': 'text/plain' });
          res.write('some-body');
          res.addTrailers({ 'X-Checksum': 'abc123' });
          res.end();
          break;
        case '/no-body':
          res.writeHead(204);
          res.end();
          break;
        case '/headers':
          res.setHeader('X-Dropped', 'gone');
          res.removeHeader('X-Dropped');
          res.writeHead(200, { 'X-Kept': 'kept', 'Content-Type': 'text/plain' });
          res.end('hdr');
          break;
        case '/status':
          res.statusCode = 418;
          res.statusMessage = 'Short and Stout';
          res.end('teapot');
          break;
        default:
          res.statusCode = 404;
          res.end('not found');
      }
    });
  };
}

function runSuite(mod, portGetter, seq, clientSink) {
  return (async () => {
    for (const item of seq) {
      clientSink.push(await doRequest(mod, portGetter(), item));
    }
  })();
}

const server = http.createServer(makeHandler(out.server, () => port));

server.listen(0, async () => {
  port = server.address().port;

  const keepAlive = new http.Agent({ keepAlive: true, maxSockets: 1 });
  await runSuite(
    http,
    () => port,
    [
      { name: 'hello', path: '/hello' },
      { name: 'echo', path: '/echo', method: 'POST', body: 'Ping Pong' },
      { name: 'chunked', path: '/chunked' },
      { name: 'trailer', path: '/trailer' },
      { name: 'no-body', path: '/no-body' },
      { name: 'headers', path: '/headers' },
      { name: 'status', path: '/status' },
      { name: 'missing', path: '/nope' },
      { name: 'head', path: '/hello', method: 'HEAD' },
      { name: 'close', path: '/hello', headers: { Connection: 'close' } },
      // Two requests over one keep-alive socket.
      { name: 'ka1', path: '/hello', agent: keepAlive },
      { name: 'ka2', path: '/hello', agent: keepAlive },
    ],
    out.client,
  );
  out.serverCount = out.server.length;
  keepAlive.destroy();

  server.close(() => {
    const tlsServer = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, makeHandler(out.httpsServer, () => httpsPort));
    tlsServer.listen(0, async () => {
      httpsPort = tlsServer.address().port;
      const tlsAgent = new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false });
      await runSuite(
        https,
        () => httpsPort,
        [
          { name: 'hello', path: '/hello' },
          { name: 'echo', path: '/echo', method: 'POST', body: 'Tls Body' },
          { name: 'chunked', path: '/chunked' },
          { name: 'trailer', path: '/trailer' },
          { name: 'status', path: '/status' },
          { name: 'head', path: '/hello', method: 'HEAD' },
          { name: 'ka1', path: '/hello', agent: tlsAgent },
          { name: 'ka2', path: '/hello', agent: tlsAgent },
        ],
        out.httpsClient,
      );
      out.httpsServerCount = out.httpsServer.length;
      tlsAgent.destroy();
      tlsServer.close(() => {
        console.log('__OBS__' + JSON.stringify(out));
      });
    });
  });
});
