// Differential observation program: run on real Node v26.9.0 AND inside web-node,
// then diff the JSON. Only public API; deterministic observations only.
const http = require('http');
const net = require('net');

const out = {};

function once(emitter, ev) {
  return new Promise((resolve) => emitter.once(ev, (...a) => resolve(a)));
}

async function main() {
  // ---- module-level statics ----
  out.maxHeaderSize = http.maxHeaderSize;
  out.methodsLen = http.METHODS.length;
  out.methodsHasPATCH = http.METHODS.includes('PATCH');
  out.statusCodesCount = Object.keys(http.STATUS_CODES).length;
  out.globalAgentInstance = http.globalAgent instanceof http.Agent;
  out.agentDefaults = {
    maxSockets: new http.Agent().maxSockets,
    maxFreeSockets: new http.Agent().maxFreeSockets,
    keepAlive: new http.Agent().keepAlive,
    maxTotalSockets: new http.Agent().maxTotalSockets,
  };
  out.globalAgentMaxSockets = http.globalAgent.maxSockets;
  out.agentGetName = new http.Agent().getName({ host: 'example.com', port: 80 });
  out.agentGetNameHttps = new http.Agent().getName({ host: 'example.com', port: 443 });
  out.validateHeaderNameThrows = (() => { try { http.validateHeaderName('X Bad'); return false; } catch (e) { return e.code; } })();
  out.validateHeaderValueThrows = (() => { try { http.validateHeaderValue('X', '\n'); return false; } catch (e) { return e.code; } })();
  out.serverResponseWriteContinueType = typeof http.ServerResponse.prototype.writeContinue;
  out.serverResponseWriteProcessingType = typeof http.ServerResponse.prototype.writeProcessing;
  out.outgoingMessageProtoMethods = ['setHeader', 'getHeader', 'getHeaders', 'getHeaderNames', 'getRawHeaderNames', 'hasHeader', 'removeHeader', 'setHeaders', 'appendHeader', 'addTrailers', 'flushHeaders'].filter((m) => m in http.OutgoingMessage.prototype);

  const serverObs = {};
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    requestCount++;
    if (requestCount === 1) {
      // ---- request observations ----
      serverObs.method = req.method;
      serverObs.url = req.url;
      serverObs.httpVersion = req.httpVersion;
      serverObs.httpVersionMajor = req.httpVersionMajor;
      serverObs.httpVersionMinor = req.httpVersionMinor;
      serverObs.complete = req.complete;
      serverObs.headersLower = req.headers['x-a'];
      serverObs.rawHeadersInclude = req.rawHeaders.includes('X-A');
      serverObs.connectionIsSocket = req.connection === req.socket;
      serverObs.readable = typeof req.readable;
      serverObs.httpVersionIsString = typeof req.httpVersion;

      // ---- response header API ----
      serverObs.res_statusCodeDefault = res.statusCode;
      serverObs.setHeaderReturnsThis = res.setHeader('X-One', '1') === res;
      serverObs.getHeaderCI = res.getHeader('x-ONE');
      serverObs.hasHeaderCI = res.hasHeader('X-one');
      res.setHeader('X-Two', ['a', 'b']);
      serverObs.getHeaderArray = res.getHeader('x-two');
      serverObs.getHeadersProtoNull = Object.getPrototypeOf(res.getHeaders()) === null;
      serverObs.getHeaderNamesBefore = res.getHeaderNames();
      res.removeHeader('X-Two');
      serverObs.hasHeaderAfterRemove = res.hasHeader('X-Two');
      serverObs.rawHeaderNamesBefore = res.getRawHeaderNames();
      serverObs.headersSentBefore = res.headersSent;
      serverObs.appendHeaderReturnsThis = typeof res.appendHeader('X-Append', 'a');
      res.appendHeader('X-Append', 'b');
      serverObs.appendHeaderValue = res.getHeader('x-append');
      serverObs.getHeaderUndefined = res.getHeader('X-Nope') === undefined;
      // validation
      serverObs.setHeaderInvalidToken = (() => { try { res.setHeader('X Bad', '1'); return false; } catch (e) { return e.code; } })();
      serverObs.setHeaderInvalidChar = (() => { try { res.setHeader('X-Ok', 'a\nb'); return false; } catch (e) { return e.code; } })();
      serverObs.setHeaderUndefValue = (() => { try { res.setHeader('X-Ok', undefined); return false; } catch (e) { return e.code; } })();
      serverObs.statusCodeOutOfRange = (() => { try { res.statusCode = 1000; return false; } catch (e) { return e.code; } })();
      serverObs.writeHeadInvalidStatus = (() => { try { res.writeHead(99); return false; } catch (e) { return e.code; } })();
      serverObs.writeHeadReturnsThis = res.writeHead(201) === res;
      serverObs.statusCodeAfterWriteHead = res.statusCode;
      serverObs.headersSentAfter = res.headersSent;
      serverObs.writeHeadTwice = (() => { try { res.writeHead(200); return false; } catch (e) { return e.code; } })();
      serverObs.setHeaderAfterSent = (() => { try { res.setHeader('X-Late', '1'); return false; } catch (e) { return e.code; } })();
      serverObs.removeHeaderAfterSent = (() => { try { res.removeHeader('X-One'); return false; } catch (e) { return e.code; } })();
      serverObs.res_reqIsReq = res.req === req;
      serverObs.req_resIsRes = req.res === res;
      serverObs.req_setTimeoutReturnsThis = req.setTimeout(0) === req;
      serverObs.res_writeContinueType = typeof res.writeContinue;
      serverObs.res_writeProcessingType = typeof res.writeProcessing;
      serverObs.req_headersDistinct = Object.keys(req.headersDistinct);
      serverObs.req_rawHeadersIsArray = Array.isArray(req.rawHeaders);
      serverObs.req_headersProtoNull = Object.getPrototypeOf(req.headers) === null;
      serverObs.res_getHeaderNamesAfterWriteHead = res.getHeaderNames();
      serverObs.res_getRawHeaderNamesAfterWriteHead = res.getRawHeaderNames();
      res.end('body');
      serverObs.writableEnded = res.writableEnded;
      serverObs.finished = res.finished;
    } else if (requestCount === 2) {
      // streaming: no content-length -> chunked
      res.write('a');
      res.write('b');
      res.end('c');
      serverObs.chunkedWhenStreaming = res.chunkedEncoding;
    } else if (requestCount === 3) {
      // HEAD-ish: explicit content-length + 204-ish semantics left to client
      res.setHeader('Content-Length', '5');
      res.end('hello');
    } else {
      res.statusCode = 418;
      res.statusMessage = 'Teapot';
      res.end('x');
    }
  });

  server.on('clientError', () => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  out.address = { family: server.address().family, address: server.address().address, isPortNumber: typeof server.address().port === 'number' };
  out.serverAddressIsObject = typeof server.address() === 'object';

  const clientObs = {};

  const doReq = (opts, collect, pre) => new Promise((resolve, reject) => {
    const req = http.request(Object.assign({ port, host: '127.0.0.1' }, opts), (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        collect({
          res,
          text: Buffer.concat(chunks).toString(),
          req,
        });
        resolve();
      });
    });
    if (pre) pre(req);
    req.on('error', reject);
    req.end();
  });

  await doReq({ path: '/hello?x=1', method: 'GET', headers: { 'X-A': 'v' } }, (o) => {
    clientObs.statusCode = o.res.statusCode;
    clientObs.statusMessage = o.res.statusMessage;
    clientObs.httpVersion = o.res.httpVersion;
    clientObs.headersCT = o.res.headers['content-length'];
    clientObs.rawHeadersHasDate = o.res.rawHeaders.some((h) => h.toLowerCase() === 'date');
    clientObs.complete = o.res.complete;
    clientObs.text = o.text;
    clientObs.reqPath = o.req.path;
    clientObs.reqMethod = o.req.method;
    clientObs.reqProtocol = o.req.protocol;
    clientObs.reqAborted = o.req.aborted;
    clientObs.reqFinished = o.req.finished;
    clientObs.socketNotNull = o.req.socket !== null;
    clientObs.res_reqIsReq = o.res.req === o.req;
    clientObs.res_rawHeadersIsArray = Array.isArray(o.res.rawHeaders);
    clientObs.res_headersDistinctKeys = Object.keys(o.res.headersDistinct);
    clientObs.res_trailersDistinctIsObject = typeof o.res.trailersDistinct === 'object';
    clientObs.res_socketNotNull = o.res.socket !== null;
    clientObs.req_agentHasGetName = typeof o.req.agent?.getName;
    clientObs.res_urlType = typeof o.res.url;
  }, (req) => {
    clientObs.reqGetHeader = req.getHeader('X-A');
    clientObs.reqGetHeaderCI = req.getHeader('x-a');
    clientObs.reqHasHeader = req.hasHeader('x-a');
    clientObs.reqGetHeadersLower = Object.keys(req.getHeaders());
    clientObs.reqGetHeaderNames = req.getHeaderNames();
    clientObs.reqSetHeaderReturnsThis = req.setHeader('X-Z', '1') === req;
    clientObs.reqRemoveHeaderReturns = typeof req.removeHeader('X-Z');
  });

  await doReq({ path: '/stream', method: 'GET' }, (o) => {
    clientObs.streamTransferEncoding = o.res.headers['transfer-encoding'];
    clientObs.streamText = o.text;
  });

  await doReq({ path: '/len', method: 'GET' }, (o) => {
    clientObs.lenText = o.text;
  });

  await doReq({ path: '/teapot', method: 'GET' }, (o) => {
    clientObs.teapotStatus = o.res.statusCode;
    clientObs.teapotStatusMessage = o.res.statusMessage;
    clientObs.teapotText = o.text;
  });

  out.server = serverObs;
  out.client = clientObs;
  await new Promise((r) => server.close(r));
  out.afterCloseListening = server.listening;

  // ---- net module semantic spot-checks ----
  const netObs = {};
  netObs.isIP = [net.isIP('127.0.0.1'), net.isIP('::1'), net.isIP('nope')];
  netObs.isIPv4 = [net.isIPv4('127.0.0.1'), net.isIPv4('::1')];
  netObs.isIPv6 = [net.isIPv6('::1'), net.isIPv6('127.0.0.1')];
  out.net = netObs;

  console.log('__OBS__' + JSON.stringify(out));
}

main().catch((e) => {
  console.log('__OBS__' + JSON.stringify({ error: String((e && e.stack) || e) }));
  process.exitCode = 1;
});
