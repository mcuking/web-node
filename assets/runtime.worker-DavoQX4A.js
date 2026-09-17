class Ae{id;#e=null;#n=[];#t=[];#r=[];#o=[];#s=!1;#i=!1;#a;#l;constructor(e,t=0,o=0){this.id=e,this.#l=t,this.#a=o}_pair(e){this.#e=e}_stamp(e,t){this.#l=e,this.#a=t}get destroyed(){return this.#s}get readableEnded(){return this.#i}get writableEnded(){return this.#s}get localPort(){return this.#l}get remotePort(){return this.#a}onData(e){this.#n.push(e)}onEnd(e){this.#t.push(e)}onClose(e){this.#r.push(e)}onError(e){this.#o.push(e)}write(e){if(this.#s)return!1;const t=typeof e=="string"?new TextEncoder().encode(e):e,o=this.#e;return!o||o.#s?!1:(queueMicrotask(()=>o._deliver(t)),!0)}_deliver(e){if(!this.#s)for(const t of[...this.#n])t(e)}end(e){if(this.#s)return;e!==void 0&&this.write(e);const t=this.#e;queueMicrotask(()=>{if(!this.#s){this.#i=!0;for(const o of[...this.#t])o();t?._remoteEnded()}})}_remoteEnded(){if(!(this.#s||this.#i)){this.#i=!0;for(const e of[...this.#t])e()}}destroy(e){if(this.#s)return;this.#s=!0;const t=this.#e;if(e)for(const o of[...this.#o])o(e);for(const o of[...this.#r])o();t&&!t.#s&&queueMicrotask(()=>t.destroy())}_forceClose(){if(!this.#s){this.#s=!0;for(const e of[...this.#r])e()}}}class ct{#e=new Map;#n=1;get ports(){return[...this.#e.keys()].sort((e,t)=>e-t)}isListening(e){return this.#e.has(e)}listen(e,t){if(this.#e.has(e))throw Object.assign(new Error(`listen EADDRINUSE: address already in use :::${e}`),{code:"EADDRINUSE",errno:-98,syscall:"listen",port:e});this.#e.set(e,t)}unlisten(e){this.#e.delete(e)}dial(e){const t=this.#e.get(e);if(!t)throw Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${e}`),{code:"ECONNREFUSED",errno:-111,syscall:"connect",address:"127.0.0.1",port:e});const o=new Ae(this.#n++,0,e),n=new Ae(this.#n++,e,0);return o._pair(n),n._pair(o),queueMicrotask(()=>t(n)),o}reset(){this.#e.clear()}}class dt extends Error{code="ERR_WEB_NODE_NOT_IMPLEMENTED";subject;kind;constructor(e,t,o){super(`[web-node] ${e} "${t}" is not implemented.`+(o?` ${o}`:"")+" See docs/superpowers/specs/2026-09-17-web-node-design.md for the supported surface."),this.name="NotImplementedError",this.kind=e,this.subject=t}}function K(r,e,t){return new dt(r,e,t)}const ut=()=>({isWindows:!1,isMacOS:!1,isLinux:!0,isFreeBSD:!1,isOpenBSD:!1,isAIX:!1,isSunOS:!1,isAndroid:!1,hasIntl:!0,hasSmallICU:!1,hasStringBytes:!0,hasUtf8Write:!0,hasIntlDateFormat:!0,hasIntlDateTimeFormat:!0,hasIntlCollator:!0,hasIntlLocale:!0,hasIntlListFormat:!0,hasIntlRelativeTimeFormat:!0,hasIntlPluralRules:!0,hasIntlDisplayNames:!0,hasIntlSegmenter:!0,hasTemporal:!1,hasWebStorage:!1,hasSQLite:!1,experimentalWasmWebEmbedding:!1,hasOpenSSL:!1,hasCrypto:!1,hasUserInfo:!0,hasFfi:!1,hasInspector:!1,hasNetworkFamily:!1,hasQuic:!1,hasDtls:!1,hasVfs:!0,hasSea:!1,hasPnpm:!1,sharedArrayBufferMode:0,vendor:"web-node",target_arch:"wasm32",platform:"browser"});class I extends Error{code;errno;syscall;path;constructor(e,t,o,n){super(n??`${e}: ${t}${o?`, '${o}'`:""}`),this.name="VfsError",this.code=e,this.errno=We[e]??-1,this.syscall=t,this.path=o}}const We={EPERM:-1,ENOENT:-2,ESRCH:-3,EINTR:-4,EIO:-5,ENXIO:-6,E2BIG:-7,ENOEXEC:-8,EBADF:-9,ECHILD:-10,EAGAIN:-11,ENOMEM:-12,EACCES:-13,EFAULT:-14,EBUSY:-16,EEXIST:-17,EXDEV:-18,ENODEV:-19,ENOTDIR:-20,EISDIR:-21,EINVAL:-22,ENFILE:-23,EMFILE:-24,ENOTTY:-25,ETXTBSY:-26,EFBIG:-27,ENOSPC:-28,ESPIPE:-29,EROFS:-30,EMLINK:-31,EPIPE:-32,EDOM:-33,ERANGE:-34,ENAMETOOLONG:-36,ENOSYS:-38,ENOTEMPTY:-39,ELOOP:-40,EOVERFLOW:-75,ENOTSUP:-95,EISNAM:-120,EKEYREJECTED:-129},ht=0,pt=1,ft=2,mt=64,gt=128,yt=512,bt=1024,St=65536,wt={SIGHUP:1,SIGINT:2,SIGQUIT:3,SIGILL:4,SIGTRAP:5,SIGABRT:6,SIGBUS:7,SIGFPE:8,SIGKILL:9,SIGUSR1:10,SIGSEGV:11,SIGUSR2:12,SIGPIPE:13,SIGALRM:14,SIGTERM:15},Et=()=>{const r={};for(const[e,t]of Object.entries(We))r[e]=Math.abs(t);return{errno:r,errnoMessage:{},signals:wt,priority:{PRIORITY_LOW:19,PRIORITY_BELOW_NORMAL:10,PRIORITY_NORMAL:0,PRIORITY_ABOVE_NORMAL:-7,PRIORITY_HIGH:-14,PRIORITY_HIGHEST:-20},fs:{O_RDONLY:ht,O_WRONLY:pt,O_RDWR:ft,O_CREAT:mt,O_EXCL:gt,O_TRUNC:yt,O_APPEND:bt,O_DIRECTORY:St,S_IFMT:61440,S_IFREG:32768,S_IFDIR:16384,S_IFLNK:40960,S_IRWXU:448,S_IRUSR:256,S_IWUSR:128,S_IXUSR:64,S_IRWXG:56,S_IRWXO:7,UV_FS_O_FILEMAP:0,COPYFILE_EXCL:1,COPYFILE_FICLONE:2,COPYFILE_FICLONE_FORCE:4},crypto:{},zlib:{},dlopen:{},trace:{},...r}},vt=()=>({isAnyArrayBuffer:r=>r instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&r instanceof SharedArrayBuffer,isArgumentsObject:r=>Object.prototype.toString.call(r)==="[object Arguments]",isArrayBuffer:r=>r instanceof ArrayBuffer,isAsyncFunction:r=>typeof r=="function"&&r.constructor?.name==="AsyncFunction",isBigInt64Array:r=>r instanceof BigInt64Array,isBigUint64Array:r=>r instanceof BigUint64Array,isBooleanObject:r=>r instanceof Boolean,isBoxedPrimitive:r=>r instanceof Boolean||r instanceof Number||r instanceof String||typeof r=="bigint"||r instanceof Symbol,isDataView:r=>r instanceof DataView,isDate:r=>r instanceof Date,isExternal:()=>!1,isFloat16Array:()=>!1,isFloat32Array:r=>r instanceof Float32Array,isFloat64Array:r=>r instanceof Float64Array,isGeneratorFunction:r=>typeof r=="function"&&r.constructor?.name==="GeneratorFunction",isGeneratorObject:r=>Object.prototype.toString.call(r)==="[object Generator]",isInt8Array:r=>r instanceof Int8Array,isInt16Array:r=>r instanceof Int16Array,isInt32Array:r=>r instanceof Int32Array,isMap:r=>r instanceof Map,isMapIterator:r=>Object.prototype.toString.call(r)==="[object Map Iterator]",isModuleNamespaceObject:r=>Object.prototype.toString.call(r)==="[object Module]",isNativeError:r=>r instanceof Error,isNumberObject:r=>r instanceof Number,isPromise:r=>r instanceof Promise||Object.prototype.toString.call(r)==="[object Promise]",isProxy:()=>!1,isRegExp:r=>r instanceof RegExp,isSet:r=>r instanceof Set,isSetIterator:r=>Object.prototype.toString.call(r)==="[object Set Iterator]",isSharedArrayBuffer:r=>typeof SharedArrayBuffer<"u"&&r instanceof SharedArrayBuffer,isStringObject:r=>r instanceof String,isSymbolObject:r=>Object.prototype.toString.call(r)==="[object Symbol]",isTypedArray:r=>ArrayBuffer.isView(r)&&!(r instanceof DataView),isUint8Array:r=>r instanceof Uint8Array,isUint8ClampedArray:r=>r instanceof Uint8ClampedArray,isUint16Array:r=>r instanceof Uint16Array,isUint32Array:r=>r instanceof Uint32Array,isWeakMap:r=>r instanceof WeakMap,isWeakSet:r=>r instanceof WeakSet,isWasmModuleObject:r=>typeof WebAssembly<"u"&&r instanceof WebAssembly.Module,isWasmMemoryObject:r=>typeof WebAssembly<"u"&&r instanceof WebAssembly.Memory,isWasmInstanceObject:r=>typeof WebAssembly<"u"&&r instanceof WebAssembly.Instance}),At={r:{read:!0,write:!1,create:!1,excl:!1,trunc:!1,append:!1},"r+":{read:!0,write:!0,create:!1,excl:!1,trunc:!1,append:!1},rs:{read:!0,write:!1,create:!1,excl:!1,trunc:!1,append:!1},"rs+":{read:!0,write:!0,create:!1,excl:!1,trunc:!1,append:!1},w:{read:!1,write:!0,create:!0,excl:!1,trunc:!0,append:!1},wx:{read:!1,write:!0,create:!0,excl:!0,trunc:!0,append:!1},"w+":{read:!0,write:!0,create:!0,excl:!1,trunc:!0,append:!1},"wx+":{read:!0,write:!0,create:!0,excl:!0,trunc:!0,append:!1},a:{read:!1,write:!0,create:!0,excl:!1,trunc:!1,append:!0},ax:{read:!1,write:!0,create:!0,excl:!0,trunc:!1,append:!0},"a+":{read:!0,write:!0,create:!0,excl:!1,trunc:!1,append:!0},"ax+":{read:!0,write:!0,create:!0,excl:!0,trunc:!1,append:!0}},Pt=r=>{const e=new Map;let t=10;const o=r.vfs;function n(l){const w=l.type==="dir",b=l.type==="file";return{dev:l.dev,mode:l.mode,nlink:l.nlink,uid:l.uid,gid:l.gid,rdev:l.rdev,blksize:l.blksize,ino:l.ino,size:l.size,blocks:l.blocks,atimeMs:l.atimeMs,mtimeMs:l.mtimeMs,ctimeMs:l.ctimeMs,birthtimeMs:l.birthtimeMs,atime:new Date(l.atimeMs),mtime:new Date(l.mtimeMs),ctime:new Date(l.ctimeMs),birthtime:new Date(l.birthtimeMs),isDirectory:()=>w,isFile:()=>b,isBlockDevice:()=>!1,isCharacterDevice:()=>!1,isSymbolicLink:()=>!1,isFIFO:()=>!1,isSocket:()=>!1}}function s(l){return n(o.stat(l))}function i(l){return o.readFile(l)}function h(l,w,b="w"){o.writeFile(l,w,{flag:b})}function p(l,w="r",b=438){const v=At[w];if(!v)throw new I("EINVAL","open",l,`Unknown file open flag: ${w}`);if(o.exists(l)){if(v.excl&&v.create)throw new I("EEXIST","open",l)}else{if(!v.create)throw new I("ENOENT","open",l);v.excl,o.writeFile(l,new Uint8Array(0),{mode:b})}v.trunc&&o.writeFile(l,new Uint8Array(0),{mode:b});const C=t++;return e.set(C,{path:o.resolve(l),flags:w,position:0,append:v.append}),C}function g(l){if(!e.delete(l))throw new I("EBADF","close",String(l))}function a(l,w,b=0,v=w.byteLength-b,P=null){if(l===0)return 0;const C=e.get(l);if(!C)throw new I("EBADF","read",String(l));const T=o.readFile(C.path),_=P??C.position,y=Math.max(0,T.byteLength-_),d=Math.min(v,y);return w.set(T.subarray(_,_+d),b),P===null&&(C.position=_+d),d}function m(l,w,b=0,v=w.byteLength-b,P=null){if(l===1)return r.writeStdout(new TextDecoder().decode(w.subarray(b,b+v))),v;if(l===2)return r.writeStderr(new TextDecoder().decode(w.subarray(b,b+v))),v;const C=e.get(l);if(!C)throw new I("EBADF","write",String(l));const T=w.subarray(b,b+v);if(C.append)o.appendFile(C.path,T),C.position=o.readFile(C.path).byteLength;else{const _=P??C.position,y=o.readFile(C.path),d=_+T.byteLength,S=new Uint8Array(Math.max(y.byteLength,d));S.set(y,0),S.set(T,_),o.writeFile(C.path,S),P===null&&(C.position=d)}return T.byteLength}function c(l,w,b){r.nextTick(()=>{if(typeof w=="function")try{const v=l();w(null,b?b(v):v)}catch(v){w(v)}})}return{openSync:p,closeSync:g,readSync:a,writeSync:m,statSync:s,lstatSync:s,fstatSync:l=>{const w=e.get(l);if(!w)throw new I("EBADF","fstat",String(l));return s(w.path)},existsSync:l=>o.exists(l),readFileSync:i,writeFileSync:h,appendFileSync:(l,w)=>o.appendFile(l,w),readdirSync:(l,w,b)=>o.readdir(l,{withFileTypes:!!b}),mkdirSync:(l,w)=>o.mkdir(l,w??{}),rmdirSync:(l,w)=>o.rm(l,{recursive:w?.recursive}),unlinkSync:l=>o.rm(l),renameSync:(l,w)=>o.rename(l,w),copyFileSync:(l,w)=>o.copyFile(l,w),chmodSync:(l,w)=>o.chmod(l,w),accessSync:l=>{if(!o.exists(l))throw new I("ENOENT","access",l)},ftruncateSync:(l,w=0)=>{const b=e.get(l);if(!b)throw new I("EBADF","ftruncate",String(l));const v=o.readFile(b.path),P=new Uint8Array(w);P.set(v.subarray(0,Math.min(w,v.byteLength))),o.writeFile(b.path,P)},fsyncSync:()=>{},fdatasyncSync:()=>{},realpathSync:l=>o.resolve(l),rmSync:(l,w)=>o.rm(l,w??{}),open:(l,w,b,v)=>c(()=>p(l,w,b),v),close:(l,w)=>c(()=>g(l),w),read:(l,w,b,v,P,C)=>c(()=>a(l,w,b,v,P),C,T=>T),write:(l,w,b,v,P,C)=>c(()=>m(l,w,b,v,P),C,T=>T),stat:(l,w)=>c(()=>s(l),w),lstat:(l,w)=>c(()=>s(l),w),fstat:(l,w)=>{const b=e.get(l);c(()=>{if(!b)throw new I("EBADF","fstat",String(l));return s(b.path)},w)},readdir:(l,w)=>c(()=>o.readdir(l).map(b=>b.name),w),mkdir:(l,w,b)=>c(()=>o.mkdir(l,w??{}),b),unlink:(l,w)=>c(()=>o.rm(l),w),rename:(l,w,b)=>c(()=>o.rename(l,w),b),__fds:e,__statSync:s}},_t=r=>{let e=1;const t=new Map;return{setTimeout:(o,n,...s)=>{const i=e++,h=setTimeout(()=>{t.delete(i),o(...s)},Math.max(1,n||0));return t.set(i,h),i},clearTimeout:o=>{const n=t.get(o);n!==void 0&&(clearTimeout(n),t.delete(o))},setInterval:(o,n,...s)=>{const i=e++,h=setInterval(()=>o(...s),Math.max(1,n||0));return t.set(i,h),i},clearInterval:o=>{const n=t.get(o);n!==void 0&&(clearInterval(n),t.delete(o))},setImmediate:(o,...n)=>{const s=e++,i=setTimeout(()=>{t.delete(s),o(...n)},0);return t.set(s,i),s},clearImmediate:o=>{const n=t.get(o);n!==void 0&&(clearTimeout(n),t.delete(o))},getLibuvNow:()=>r.now(),__activeCount:()=>t.size}},Rt=r=>({getOwnNonIndexProperties:(e,t)=>Object.keys(e).concat(Object.getOwnPropertySymbols(e)).filter(n=>{if(typeof n=="string"){const s=Number(n);return!(Number.isInteger(s)&&s>=0&&String(s)===n)}return!0}),getConstructorName:e=>{if(e==null)return String(e);const t=Object.getPrototypeOf(e);if(t===null)return"Object";const o=t.constructor;return o?o.name:"Object"},getExternalValue:()=>0n,getPromiseDetails:e=>e instanceof Promise?[0]:[0],getProxyDetails:()=>{},previewEntries:()=>{},isInsideNodeModules:()=>!1,shouldAbortOnUncaughtToggle:new Uint8Array(1),getCallSites:()=>[],getHeapSnapshot:()=>{throw new Error("heap snapshot is not supported in web-node")},getHeapStatistics:()=>({total_heap_size:0,total_heap_size_executable:0,total_physical_size:0,total_available_size:0,used_heap_size:0,heap_size_limit:0,malloced_memory:0,peak_malloced_memory:0,does_zap_garbage:0,number_of_native_contexts:0,number_of_detached_contexts:0}),getHeapSpaceStatistics:()=>[],setPromiseHooks:()=>{},getStringWidth:e=>e.length,sleep:()=>{throw new Error("synchronous sleep is not available in web-node")},arrayBufferViewHasBuffer:e=>e.buffer!==void 0,getOwnPropertyDescriptors:e=>Object.getOwnPropertyDescriptors(e),noSideEffectsToString:e=>String(e),getSystemErrorName:e=>String(e),getDevToolsConfig:()=>({}),setTraceCategoryStateUpdateHandler:()=>{},triggerUncaughtException:e=>{r.writeStderr(e&&e.stack||String(e)),r.exit(1)}}),xt=()=>({atob:r=>atob(r),btoa:r=>btoa(r),isAscii:r=>{for(let e=0;e<r.length;e++)if(r[e]>127)return!1;return!0},isUtf8:r=>{try{return new TextDecoder("utf-8",{fatal:!0}).decode(r),!0}catch{return!1}}}),Ct=()=>{const r=e=>Symbol(e);return{async_id_symbol:r("async_id_symbol"),handle_onclose:r("handle_onclose"),owner_symbol:r("owner_symbol"),onread_optimise:r("onread_optimise"),onwrite_optimise:r("onwrite_optimise"),kResource:r("kResource"),kHandle:r("kHandle"),kIncomingMessage:r("kIncomingMessage"),kOnMessageBegin:r("kOnMessageBegin"),kRequest:r("kRequest"),kResponse:r("kResponse"),kServerResponse:r("kServerResponse"),kSocket:r("kSocket"),kStreamBaseField:r("kStreamBaseField"),kReinitializeHandle:r("kReinitializeHandle"),kFsStatsFieldsNumber:r("kFsStatsFieldsNumber"),kUpdateTimer:r("kUpdateTimer"),kStatsFieldName:r("kStatsFieldName"),kStatsFieldNames:r("kStatsFieldNames"),kJavaStreamBaseField:r("kJavaStreamBaseField"),kTestingOnlyJsStream:r("kTestingOnlyJsStream"),kPendingHandle:r("kPendingHandle")}},Tt=()=>({setSourceMapsEnabled:()=>{},setPrepareStackTraceCallback:()=>{},triggerUncaughtException:()=>{},updateExceptionDetails:()=>{},fatalException:()=>{},getErrorSource:()=>{},setErrorSource:()=>{},hasPrepareStackTraceCallback:()=>!1}),Ot=r=>({now:()=>r.now(),timeOrigin:0,mark:()=>{},clearMark:()=>{},measure:()=>{},clearMeasures:()=>{},getEntries:()=>[],getEntriesByName:()=>[],getEntriesByType:()=>[],setupGarbageCollectionTracking:()=>{}}),kt=r=>({getStdout:()=>1,getStderr:()=>2,getStdin:()=>0,getCwd:()=>r.vfs.cwd,chdir:e=>r.vfs.chdir(e),setStdout:()=>{},setStderr:()=>{},setStdin:()=>{},umask:()=>18,exit:e=>r.exit(e),kill:()=>{throw new Error("process.kill is not supported in web-node")},availableMemory:()=>512*1024*1024,constrainedMemory:()=>512*1024*1024}),It=()=>({getHostname:()=>"web-node",getOSRelease:()=>"browser",getOSType:()=>"Browser",getOSVersion:()=>"",getMachine:()=>"wasm32",getFreeMem:()=>512*1024*1024,getTotalMem:()=>1024*1024*1024,getUptime:()=>performance.now()/1e3,getCPUs:()=>[],getInterfaceAddresses:()=>({}),getHomeDirectory:()=>"/home/web-node",getTmpdir:()=>"/tmp",getUserInfo:()=>({uid:0,gid:0,username:"web-node",homedir:"/home/web-node",shell:null})}),Dt=()=>({decode:()=>""}),Nt=()=>({getDefaultLocale:()=>"en-US",getAvailableLocales:()=>["en-US"],getBestAvailableLocale:()=>"en-US",getStringWidth:r=>r.length,hasSmallICU:()=>!1}),jt=()=>({setDeserializeMainFunction:()=>{},isBuildingSnapshot:()=>!1}),Mt=()=>({hrtime:()=>[0,0],getLibuvNow:()=>Date.now(),updateTime:()=>{},guessHandleType:()=>"FILE"}),qe={config:ut,constants:Et,types:vt,fs:Pt,timers:_t,util:Rt,buffer:xt,symbols:Ct,errors:Tt,performance:Ot,process_methods:kt,os:It,string_decoder:Dt,icu:Nt,messaging:jt,uv:Mt},Lt=new Set(["crypto","zlib","tcp_wrap","udp_wrap","pipe_wrap","stream_wrap","tty_wrap","worker","contextify","module_wrap","modules","inspector","sea","ffi","quic","dtls","cares_wrap","http_parser","task_queue","encoding_binding","blob","url","url_pattern","credentials","trace_events","heap_utils","mksnapshot","profiler","builtins","options","async_wrap","sqlite","vfs","report","permission","webstorage","block_list"]);function Ut(r){const e=new Map;for(const[t,o]of Object.entries(qe))e.set(t,o(r));return e}function Ft(r){return Object.prototype.hasOwnProperty.call(qe,r)}function Ht(r){throw K("binding",r,Lt.has(r)?"It is explicitly outside the MVP whitelist. Milestones 3/4 add network and npm.":void 0)}const Ve={ERR_INVALID_ARG_TYPE:'The "%s" argument must be of type %s. Received %s',ERR_INVALID_ARG_VALUE:"The argument '%s' is invalid. Received %s",ERR_INVALID_URI:"URI malformed",ERR_OUT_OF_RANGE:'The value of "%s" is out of range. It must be %s. Received %s',ERR_INVALID_STATE:"Invalid state: %s",ERR_MISSING_ARGS:'The "%s" argument must be specified',ERR_UNKNOWN_FILE_EXTENSION:'Unknown file extension "%s" for %s',ERR_MODULE_NOT_FOUND:"Cannot find module '%s' imported from %s",ERR_UNSUPPORTED_ESM_URL_SCHEME:"Only file and data URLs are supported by the default ESM loader. Received protocol '%s'",ERR_WEB_NODE_NOT_IMPLEMENTED:"[web-node] %s is not implemented."};class ae extends Error{code;constructor(e,t,...o){let n=t,s=0;n=n.replace(/%[sdj]/g,()=>String(o[s++])),super(n),this.code=e,this.name="Error"}}function $t(r){const e=Ve[r]??r,t=class extends ae{constructor(...o){super(r,e,...o),this.name=r.replace(/^ERR_/,"").replace(/_/g," ").toLowerCase().replace(/\b\w/g,n=>n.toUpperCase())}};return Object.defineProperty(t,"name",{value:r}),t}function Bt(){const r={};for(const e of Object.keys(Ve))r[e]=$t(e);return{codes:r,NodeError:ae,AbortError:class extends Error{code="ABORT_ERR"},hideStackFrames:e=>e,aggregateTwoErrors:(e,t)=>t??e,isErrorStackTraceLimitWritable:()=>!1,uvException:e=>new ae(e.code??"EIO",e.message??"Unknown error"),errnoException:e=>e instanceof Error?e:new Error(String(e)),exceptionWithHostPort:e=>e,connResetException:e=>new ae("ECONNRESET",e),setErrorSource:()=>{}}}const Wt={id:"internal/errors",origin:"web-node",init:()=>Bt()},qt={id:"internal/validators",origin:"web-node",init:r=>{const e=r.require("internal/errors").codes;function t(n,s,...i){if(!n){const h=e[s];throw h?new h(...i):new Error(String(s))}}function o(n){return n===null?"null":Array.isArray(n)?"object":typeof n}return{validateAbortSignal:()=>{},validateAbortSignalArray:()=>{},validateArray:(n,s)=>t(Array.isArray(n),"ERR_INVALID_ARG_TYPE",s,"Array",o(n)),validateBoolean:(n,s)=>t(typeof n=="boolean","ERR_INVALID_ARG_TYPE",s,"boolean",o(n)),validateBooleanArray:()=>{},validateBuffer:()=>{},validateDictionary:()=>{},validateEncoding:()=>{},validateFiniteNumber:(n,s)=>t(typeof n=="number"&&Number.isFinite(n),"ERR_INVALID_ARG_TYPE",s,"number",o(n)),validateFunction:(n,s)=>t(typeof n=="function","ERR_INVALID_ARG_TYPE",s,"Function",o(n)),validateInteger:(n,s)=>t(Number.isInteger(n),"ERR_INVALID_ARG_TYPE",s,"integer",o(n)),validateNumber:(n,s)=>t(typeof n=="number","ERR_INVALID_ARG_TYPE",s,"number",o(n)),validateObject:(n,s,i)=>{const h=n!==null&&typeof n=="object"&&(i?.allowArray===!0||!Array.isArray(n))&&(i?.allowFunction===!0||typeof n!="function");t(h,"ERR_INVALID_ARG_TYPE",s,"object",o(n))},validateOneOf:()=>{},validatePlainFunction:()=>{},validatePort:(n,s)=>t(Number.isInteger(n)&&n>=0&&n<=65535,"ERR_OUT_OF_RANGE",s,">= 0 && <= 65535",String(n)),validateSignalName:()=>{},validateString:(n,s)=>t(typeof n=="string","ERR_INVALID_ARG_TYPE",s,"string",o(n)),validateStringArray:()=>{},validateStringWithoutNullBytes:()=>{},validateThisInternalField:()=>{},validateUndefined:()=>{},validateUnion:()=>{},validateLinkHeaderValue:()=>{},validateIgnoreOption:()=>{},validateAbortSignalOnly:()=>{}}},deps:["internal/errors"]},Vt={id:"internal/util",origin:"web-node",init:()=>{function r(o){let n,s=!1;return function(){return s||(n=o(),s=!0),n}}function e(o){let n=!1,s;return function(...h){return n||(n=!0,s=o.apply(this,h)),s}}function t(o,n,s){return o}return{kEmptyObject:Object.freeze({}),isWindows:!1,isMacOS:!1,isLinux:!0,getLazy:r,once:e,deprecate:t,deprecateProperty:()=>{},normalizeEncoding:o=>o&&String(o).toLowerCase(),isArrayBufferView:o=>ArrayBuffer.isView(o),isInsideNodeModules:()=>!1,getCallerLocation:()=>{},getSystemErrorName:o=>String(o),isErrorLike:o=>o instanceof Error,getStringWidth:o=>o.length,defineLazyProperties:()=>{},SideEffectFreeRegExpPrototypeSymbolReplace:(o,n,s)=>n.replace(o,s),Buffer:void 0,customInspectSymbol:Symbol.for("nodejs.util.inspect.custom"),promisify:void 0,isPromise:o=>o instanceof Promise,isRegExp:o=>o instanceof RegExp,toUSVString:o=>o}}},Gt={id:"internal/fs/glob",origin:"web-node",init:()=>({matchGlobPattern:()=>{throw K("api","path.matchesGlob","Glob matching is outside the MVP whitelist.")},globSync:()=>{throw K("api","fs.globSync","Glob matching is outside the MVP whitelist.")}})},zt=[{id:"internal/constants",vendorPath:"internal/constants.js",origin:"node-source"},{id:"internal/encoding/util",vendorPath:"internal/encoding/util.js",origin:"node-source"},{id:"internal/querystring",vendorPath:"internal/querystring.js",origin:"node-source",deps:["internal/errors"]},{id:"path",aliases:["node:path"],vendorPath:"path.js",origin:"node-source",deps:["internal/constants","internal/validators","internal/util","internal/fs/glob"]},{id:"querystring",aliases:["node:querystring"],vendorPath:"querystring.js",origin:"node-source",deps:["buffer","internal/querystring"]}],Pe=2147483647;function _e(r){return r instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&r instanceof SharedArrayBuffer}function Z(r,e){switch(e){case"utf8":case"utf-8":return new TextEncoder().encode(r);case"ascii":case"latin1":case"binary":{const t=new Uint8Array(r.length);for(let o=0;o<r.length;o++)t[o]=r.charCodeAt(o)&255;return t}case"base64":case"base64url":{const t=r.replace(/-/g,"+").replace(/_/g,"/").replace(/[^A-Za-z0-9+/=]/g,""),o=t.padEnd(t.length+(4-t.length%4)%4,"="),n=atob(o),s=new Uint8Array(n.length);for(let i=0;i<n.length;i++)s[i]=n.charCodeAt(i);return s}case"hex":{const t=r.length%2===0?r:r.slice(0,r.length-1);if(!/^[0-9a-fA-F]*$/.test(t))throw new TypeError("Invalid hex string");const o=new Uint8Array(t.length/2);for(let n=0;n<o.length;n++)o[n]=parseInt(t.substr(n*2,2),16);return o}case"utf16le":case"utf-16le":case"ucs2":case"ucs-2":{const t=new Uint8Array(r.length*2);for(let o=0;o<r.length;o++){const n=r.charCodeAt(o);t[o*2]=n&255,t[o*2+1]=n>>8}return t}default:throw new TypeError(`Unknown encoding: ${e}`)}}function Kt(r,e="utf8",t=0,o=r.length){const n=r.subarray(t,o);switch(e){case"utf8":case"utf-8":return new TextDecoder("utf-8").decode(n);case"ascii":case"latin1":case"binary":{let s="";for(let i=0;i<n.length;i++)s+=String.fromCharCode(n[i]);return s}case"base64":case"base64url":{let s="";for(let h=0;h<n.length;h++)s+=String.fromCharCode(n[h]);const i=btoa(s);return e==="base64url"?i.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""):i}case"hex":{let s="";for(let i=0;i<n.length;i++)s+=n[i].toString(16).padStart(2,"0");return s}case"utf16le":case"utf-16le":case"ucs2":case"ucs-2":{let s="";for(let i=0;i+1<n.length;i+=2)s+=String.fromCharCode(n[i]|n[i+1]<<8);return s}default:throw new TypeError(`Unknown encoding: ${e}`)}}function Yt(r,e,t){if(e.length===0)return Math.min(Math.max(0,t),r.length);for(let o=Math.max(0,t);o<=r.length-e.length;o++){let n=!0;for(let s=0;s<e.length;s++)if(r[o+s]!==e[s]){n=!1;break}if(n)return o}return-1}function Jt(r,e,t){for(let o=Math.min(t,r.length-e.length);o>=0;o--){let n=!0;for(let s=0;s<e.length;s++)if(r[o+s]!==e[s]){n=!1;break}if(n)return o}return-1}const Xt={id:"buffer",aliases:["node:buffer"],origin:"web-node",init:r=>{class e extends Uint8Array{static poolSize=8192;static#e(n){const s=new e(n.byteLength);return s.set(n),s}static from(n,s,i){if(typeof n=="string")return e.#e(Z(n,typeof s=="string"?s:"utf8"));if(_e(n)){const h=typeof s=="number"?s:0,p=typeof i=="number"?i:n.byteLength-h;return e.#e(new Uint8Array(n,h,p))}if(ArrayBuffer.isView(n)||Array.isArray(n))return e.#e(Uint8Array.from(n));if(n!==null&&typeof n=="object"&&typeof n.length=="number")return e.#e(Uint8Array.from(Array.from(n)));throw new TypeError("The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array")}static alloc(n,s,i){const h=new e(n);return s!==void 0&&h.fill(s,0,n,i),h}static allocUnsafe(n){return new e(n)}static allocUnsafeSlow(n){return new e(n)}static isBuffer(n){return n instanceof e}static isEncoding(n){return typeof n=="string"&&["utf8","utf-8","ascii","latin1","binary","base64","base64url","hex","utf16le","ucs2"].includes(n.toLowerCase())}static byteLength(n,s="utf8"){if(typeof n=="string")return Z(n,s).byteLength;if(ArrayBuffer.isView(n)||_e(n))return n.byteLength;throw new TypeError("The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array")}static concat(n,s){if(!Array.isArray(n))throw new TypeError('The "list" argument must be an instance of Array');const i=s??n.reduce((g,a)=>g+a.length,0),h=new e(i);let p=0;for(const g of n){if(p+g.length>i){h.set(g.subarray(0,i-p),p);break}h.set(g,p),p+=g.length}return h}static compare(n,s){const i=Math.min(n.length,s.length);for(let h=0;h<i;h++)if(n[h]!==s[h])return n[h]<s[h]?-1:1;return n.length===s.length?0:n.length<s.length?-1:1}toString(n,s,i){let h="utf8",p=0,g=this.length;return typeof n=="string"?(h=n,p=s??0,g=i??this.length):n&&typeof n=="object"&&(h=n.encoding??"utf8",p=n.start??0,g=n.end??this.length),Kt(this,h,p,g)}toJSON(){return{type:"Buffer",data:Array.from(this)}}equals(n){return e.compare(this,n)===0}compare(n){return e.compare(this,n)}copy(n,s=0,i=0,h=this.length){const p=Math.min(h-i,n.length-s,this.length-i);return n.set(this.subarray(i,i+p),s),p}write(n,s=0,i,h="utf8"){let p=i,g=h;typeof p=="string"&&(g=p,p=void 0);const a=Z(n,g),m=Math.min(p??this.length-s,a.length,this.length-s);return this.set(a.subarray(0,m),s),m}fill(n,s=0,i=this.length,h="utf8"){if(typeof n=="string"){const p=Z(n,h);for(let g=s;g<i;g++)this[g]=p[(g-s)%p.length]}else if(typeof n=="number")Uint8Array.prototype.fill.call(this,n&255,s,i);else for(let p=s;p<i;p++)this[p]=n[(p-s)%n.length];return this}indexOf(n,s=0,i="utf8"){const h=typeof n=="number"?Uint8Array.of(n&255):typeof n=="string"?Z(n,i):n;return Yt(this,h,s)}lastIndexOf(n,s=this.length,i="utf8"){const h=typeof n=="number"?Uint8Array.of(n&255):typeof n=="string"?Z(n,i):n;return Jt(this,h,s)}includes(n,s=0,i="utf8"){return this.indexOf(n,s,i)!==-1}slice(n,s){return e.#e(Uint8Array.prototype.slice.call(this,n,s))}subarray(n,s){return e.#e(Uint8Array.prototype.slice.call(this,n,s))}readUInt8(n=0){return this[n]}readUInt16LE(n=0){return this[n]|this[n+1]<<8}readUInt16BE(n=0){return this[n]<<8|this[n+1]}readUInt32LE(n=0){return(this[n]|this[n+1]<<8|this[n+2]<<16|this[n+3]*16777216)>>>0}readUInt32BE(n=0){return this[n]*16777216+(this[n+1]<<16|this[n+2]<<8|this[n+3])>>>0}readInt8(n=0){return this[n]<<24>>24}readInt16LE(n=0){return(this[n]|this[n+1]<<8)<<16>>16}readInt16BE(n=0){return(this[n]<<8|this[n+1])<<16>>16}readInt32LE(n=0){return this[n]|this[n+1]<<8|this[n+2]<<16|this[n+3]<<24}readInt32BE(n=0){return this[n]<<24|this[n+1]<<16|this[n+2]<<8|this[n+3]}readBigInt64LE(n=0){return new DataView(this.buffer,this.byteOffset+n,8).getBigInt64(0,!0)}readBigUInt64LE(n=0){return new DataView(this.buffer,this.byteOffset+n,8).getBigUint64(0,!0)}readFloatLE(n=0){return new DataView(this.buffer,this.byteOffset+n,4).getFloat32(0,!0)}readFloatBE(n=0){return new DataView(this.buffer,this.byteOffset+n,4).getFloat32(0,!1)}readDoubleLE(n=0){return new DataView(this.buffer,this.byteOffset+n,8).getFloat64(0,!0)}readDoubleBE(n=0){return new DataView(this.buffer,this.byteOffset+n,8).getFloat64(0,!1)}writeUInt8(n,s=0){return this[s]=n&255,s+1}writeUInt16LE(n,s=0){return this[s]=n&255,this[s+1]=n>>>8&255,s+2}writeUInt16BE(n,s=0){return this[s]=n>>>8&255,this[s+1]=n&255,s+2}writeUInt32LE(n,s=0){return this[s]=n&255,this[s+1]=n>>>8&255,this[s+2]=n>>>16&255,this[s+3]=n>>>24&255,s+4}writeUInt32BE(n,s=0){return this[s]=n>>>24&255,this[s+1]=n>>>16&255,this[s+2]=n>>>8&255,this[s+3]=n&255,s+4}writeInt8(n,s=0){return this[s]=n&255,s+1}writeInt16LE(n,s=0){return this[s]=n&255,this[s+1]=n>>8&255,s+2}writeInt16BE(n,s=0){return this[s]=n>>8&255,this[s+1]=n&255,s+2}writeInt32LE(n,s=0){return this[s]=n&255,this[s+1]=n>>8&255,this[s+2]=n>>16&255,this[s+3]=n>>24&255,s+4}writeInt32BE(n,s=0){return this[s]=n>>24&255,this[s+1]=n>>16&255,this[s+2]=n>>8&255,this[s+3]=n&255,s+4}writeBigInt64LE(n,s=0){return new DataView(this.buffer,this.byteOffset+s,8).setBigInt64(0,n,!0),s+8}writeBigUInt64LE(n,s=0){return new DataView(this.buffer,this.byteOffset+s,8).setBigUint64(0,n,!0),s+8}writeFloatLE(n,s=0){return new DataView(this.buffer,this.byteOffset+s,4).setFloat32(0,n,!0),s+4}writeFloatBE(n,s=0){return new DataView(this.buffer,this.byteOffset+s,4).setFloat32(0,n,!1),s+4}writeDoubleLE(n,s=0){return new DataView(this.buffer,this.byteOffset+s,8).setFloat64(0,n,!0),s+8}writeDoubleBE(n,s=0){return new DataView(this.buffer,this.byteOffset+s,8).setFloat64(0,n,!1),s+8}swap16(){for(let n=0;n<this.length;n+=2){const s=this[n];this[n]=this[n+1],this[n+1]=s}return this}swap32(){for(let n=0;n<this.length;n+=4){const s=this[n];this[n]=this[n+3],this[n+3]=s;const i=this[n+1];this[n+1]=this[n+2],this[n+2]=i}return this}}return{Buffer:e,SlowBuffer:o=>e.alloc(o),Blob:typeof Blob<"u"?Blob:void 0,File:typeof File<"u"?File:void 0,atob:o=>atob(o),btoa:o=>btoa(o),kMaxLength:Pe,kStringMaxLength:536870888,constants:{MAX_LENGTH:Pe,MAX_STRING_LENGTH:536870888},transcode:()=>{throw new Error("buffer.transcode is not supported in web-node")},isUtf8:o=>{try{return new TextDecoder("utf-8",{fatal:!0}).decode(o),!0}catch{return!1}},isAscii:o=>{for(let n=0;n<o.length;n++)if(o[n]>127)return!1;return!0},resolveObjectURL:()=>{}}}},Zt={id:"events",aliases:["node:events"],origin:"web-node",init:()=>{const r=Symbol.for("events.errorMonitor"),e=Symbol.for("nodejs.rejection");class t{#e=new Map;#n=10;static captureRejections=!1;static defaultMaxListeners=10;static getEventListeners(s,i){const h=s.#e.get(i);return h?h.map(p=>p.fn):[]}static listenerCount(s,i){return s.#e.get(i)?.length??0}static once(s,i){return new Promise(h=>{s.once(i,(...p)=>h(p))})}static on(s,i){const h=[];let p=null;return s.on(i,(...g)=>{if(p){const a=p;p=null,a({value:g,done:!1})}else h.push(g)}),{[Symbol.asyncIterator](){return this},next(){return h.length>0?Promise.resolve({value:h.shift(),done:!1}):new Promise(g=>{p=g})}}}#t(s,i,h,p){if(typeof i!="function")throw new TypeError('The "listener" argument must be of type function');const g=this.#e.get(s)??[],a={fn:i,once:h};return p?g.unshift(a):g.push(a),this.#e.set(s,g),this}on(s,i){return this.#t(s,i,!1,!1)}addListener(s,i){return this.on(s,i)}once(s,i){return this.#t(s,i,!0,!1)}prependListener(s,i){return this.#t(s,i,!1,!0)}prependOnceListener(s,i){return this.#t(s,i,!0,!0)}#r(s,i){const h=this.#e.get(s);if(!h)return this;const p=h.findIndex(g=>g.fn===i);return p>=0&&h.splice(p,1),h.length===0&&this.#e.delete(s),this}removeListener(s,i){return this.#r(s,i)}off(s,i){return this.#r(s,i)}removeAllListeners(s){return s===void 0?this.#e.clear():this.#e.delete(s),this}emit(s,...i){if(s==="error"){const p=this.#e.get(r);if(p)for(const g of[...p])g.fn(...i)}const h=this.#e.get(s);if(!h||h.length===0){if(s==="error"){const p=i[0];throw p instanceof Error?p:new Error("Unhandled error"+(p?`. (${String(p)})`:""))}return!1}for(const p of[...h])p.once&&this.#r(s,p.fn),p.fn.apply(this,i);return!0}listeners(s){return(this.#e.get(s)??[]).map(i=>i.fn)}rawListeners(s){return this.listeners(s)}listenerCount(s){return this.#e.get(s)?.length??0}eventNames(){return[...this.#e.keys()]}setMaxListeners(s){return this.#n=s,this}getMaxListeners(){return this.#n}}Object.defineProperty(t,"errorMonitor",{value:r,enumerable:!0}),Object.defineProperty(t.prototype,"kCapture",{value:Symbol.for("nodejs.kCapture")});const o=t;return o.EventEmitter=t,o.default=t,o.once=t.once,o.on=t.on,o.getEventListeners=t.getEventListeners,o.listenerCount=t.listenerCount,o.captureRejectionSymbol=e,o.EventEmitterAsyncResource=t,o}},Qt={id:"fs",aliases:["node:fs"],origin:"web-node",deps:["buffer","stream","events"],init:r=>{const e=r.internalBinding("fs"),t=r.require("buffer").Buffer,{Readable:o,Writable:n}=r.require("stream"),s=r.binding,i=s.vfs,{EventEmitter:h}=r.require("events");class p extends h{#e=null;#n={};_attach(f,E){this.#e=f,this.#n=E}close(){this.#e?.(),this.#e=null}ref(){return this}unref(){return this}get options(){return this.#n}}function g(u){return t.from(u)}function a(u,f){if(typeof u=="string")return t.from(u,f??"utf8");if(ArrayBuffer.isView(u))return new Uint8Array(u.buffer,u.byteOffset,u.byteLength);if(u instanceof ArrayBuffer)return new Uint8Array(u);throw new TypeError('The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView')}function m(u,f){const E=g(e.readFileSync(u)),R=typeof f=="string"?f:f?.encoding??null;return R?E.toString(R):E}function c(u,f,E){const R=typeof E=="string"?"w":E?.flag??"w";e.writeFileSync(u,a(f,typeof E=="string"?E:E?.encoding),R)}function l(u,f,E){e.appendFileSync(u,a(f,typeof E=="string"?E:E?.encoding))}function w(u,f){const E=typeof f=="object"&&f!==null?!!f.withFileTypes:!1,R=e.readdirSync(u,void 0,E);return E?R.map(x=>({name:x.name,parentPath:u,path:u,isFile:()=>x.type==="file",isDirectory:()=>x.type==="dir",isSymbolicLink:()=>!1,isBlockDevice:()=>!1,isCharacterDevice:()=>!1,isFIFO:()=>!1,isSocket:()=>!1})):R.map(x=>x.name)}const b=64*1024;function v(u){if(typeof u=="string")return new TextEncoder().encode(u);if(u instanceof Uint8Array)return u;if(ArrayBuffer.isView(u)){const f=u;return new Uint8Array(f.buffer,f.byteOffset,f.byteLength)}if(u instanceof ArrayBuffer)return new Uint8Array(u);throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer')}class P extends o{path;fd=null;bytesRead=0;pending=!0;closed=!1;#e;#n;#t;#r;#o;constructor(f,E={}){super({highWaterMark:E.highWaterMark??b}),this.path=f,this.#e=E.start??0,this.#n=E.end??Number.POSITIVE_INFINITY,this.#t=E.highWaterMark??b,this.#r=E.autoClose!==!1,this.#o=E.encoding??null}_read(f){if(this.closed){this.push(null);return}if(this.fd===null){try{this.fd=e.openSync(this.path,"r",438)}catch(M){this.destroy(M);return}this.pending=!1;const k=this.fd;s.nextTick(()=>{this.emit("open",k),this.emit("ready")})}const E=Math.max(1,Math.min(this.#t,f>0?f:this.#t)),R=this.#n-this.#e+1;if(R<=0){this.push(null),this.close();return}const x=t.allocUnsafe(Math.min(E,R));let O;try{O=e.readSync(this.fd,x,0,x.byteLength,this.#e)}catch(k){this.destroy(k);return}if(O===0){this.push(null),this.close();return}this.#e+=O,this.bytesRead+=O,this.push(x.subarray(0,O))}close(f){if(this.fd!==null){try{e.closeSync(this.fd)}catch{}this.fd=null}this.closed=!0,typeof f=="function"&&s.nextTick(f)}_destroy(f,E){this.#r&&this.close(),E(f)}}class C extends n{path;fd=null;bytesWritten=0;pending=!0;closed=!1;#e;#n;#t;#r;constructor(f,E={}){super({highWaterMark:E.highWaterMark??b}),this.path=f,this.#e=E.flags??"w",this.#n=E.mode??438,this.#t=typeof E.start=="number"?E.start:null,this.#r=E.autoClose!==!1}#o(){if(this.fd!==null)return;this.fd=e.openSync(this.path,this.#e,this.#n),this.pending=!1;const f=this.fd;s.nextTick(()=>{this.emit("open",f),this.emit("ready")})}_write(f,E,R){try{this.#o();const x=v(f),O=e.writeSync(this.fd,x,0,x.byteLength,this.#t);this.bytesWritten+=O,this.#t!==null&&(this.#t+=O),R(null)}catch(x){R(x)}}close(f){if(this.fd!==null){try{e.closeSync(this.fd)}catch{}this.fd=null}this.closed=!0,typeof f=="function"&&s.nextTick(f)}_final(f){this.#r&&this.close(),f(null)}_destroy(f,E){this.#r&&this.close(),E(f)}}function T(u,f){const E=typeof f=="string"?{encoding:f}:f??{};if(typeof u!="string")throw new TypeError('The "path" argument must be of type string');return new P(u,E)}function _(u,f){const E=typeof f=="string"?{encoding:f}:f??{};if(typeof u!="string")throw new TypeError('The "path" argument must be of type string');return new C(u,E)}function y(u,f){s.nextTick(()=>{if(typeof f=="function")try{f(null,u())}catch(E){f(E)}})}const d={constants:{F_OK:0,R_OK:4,W_OK:2,X_OK:1,COPYFILE_EXCL:1,O_RDONLY:0,O_WRONLY:1,O_RDWR:2,O_CREAT:64,O_EXCL:128,O_TRUNC:512,O_APPEND:1024},readFileSync:m,writeFileSync:c,appendFileSync:l,existsSync:u=>e.existsSync(u),statSync:u=>e.statSync(u),lstatSync:u=>e.lstatSync(u),fstatSync:u=>e.fstatSync(u),readdirSync:w,mkdirSync:(u,f)=>e.mkdirSync(u,f),rmdirSync:(u,f)=>e.rmdirSync(u,f),unlinkSync:u=>e.unlinkSync(u),rmSync:(u,f)=>e.rmSync(u,f),renameSync:(u,f)=>e.renameSync(u,f),copyFileSync:(u,f)=>e.copyFileSync(u,f),chmodSync:(u,f)=>e.chmodSync(u,f),accessSync:u=>e.accessSync(u),truncateSync:(u,f=0)=>{const E=e.openSync(u,"r+",438);try{e.ftruncateSync(E,f)}finally{e.closeSync(E)}},openSync:(u,f="r",E=438)=>e.openSync(u,f,E),closeSync:u=>e.closeSync(u),readSync:(u,f,E=0,R=f.byteLength-E,x=null)=>e.readSync(u,f,E,R,x),writeSync:(u,f,E=0,R=f.byteLength-E,x=null)=>e.writeSync(u,f,E,R,x),realpathSync:Object.assign(u=>e.realpathSync(u),{native:u=>e.realpathSync(u)}),readFile:(u,f,E)=>{const R=typeof f=="function"?f:E,x=typeof f=="function"?void 0:f;y(()=>m(u,x),R)},writeFile:(u,f,E,R)=>{const x=typeof E=="function"?E:R,O=typeof E=="function"?void 0:E;y(()=>c(u,f,O),x)},appendFile:(u,f,E,R)=>{y(()=>l(u,f),typeof E=="function"?E:R)},stat:(u,f)=>y(()=>e.statSync(u),f),lstat:(u,f)=>y(()=>e.lstatSync(u),f),readdir:(u,f,E)=>{const R=typeof f=="function"?f:E,x=typeof f=="function"?void 0:f;y(()=>w(u,x),R)},mkdir:(u,f,E)=>{const R=typeof f=="function"?f:E,x=typeof f=="function"?void 0:f;y(()=>e.mkdirSync(u,x),R)},rmdir:(u,f,E)=>{const R=typeof f=="function"?f:E,x=typeof f=="function"?void 0:f;y(()=>e.rmdirSync(u,x),R)},unlink:(u,f)=>y(()=>e.unlinkSync(u),f),rm:(u,f,E)=>{const R=typeof f=="function"?f:E,x=typeof f=="function"?void 0:f;y(()=>e.rmSync(u,x),R)},rename:(u,f,E)=>y(()=>e.renameSync(u,f),E),copyFile:(u,f,E)=>y(()=>e.copyFileSync(u,f),E),chmod:(u,f,E)=>y(()=>e.chmodSync(u,f),E),access:(u,f,E)=>{y(()=>e.accessSync(u),typeof f=="function"?f:E)},exists:(u,f)=>y(()=>e.existsSync(u),f),open:(u,f,E,R)=>{const x=typeof E=="function"?E:R,O=typeof E=="number"?E:438;y(()=>e.openSync(u,typeof f=="string"?f:"r",O),x)},close:(u,f)=>y(()=>e.closeSync(u),f),read:(u,f,E,R,x,O)=>y(()=>e.readSync(u,f,E,R,x),O),write:(u,f,E,R,x,O)=>y(()=>e.writeSync(u,f,E,R,x),O),realpath:(u,f)=>y(()=>e.realpathSync(u),f),watch:(u,f,E)=>{const R=typeof f=="function"?void 0:f,x=typeof f=="function"?f:E,O=i.resolve(u),k=(()=>{try{return i.stat(O).type==="dir"}catch{return!1}})(),M=O==="/"?"/":O+"/",j=new p,N=i.subscribe(B=>{if(B.path!==O&&!B.path.startsWith(M))return;const G=k?B.path===O?"":B.path.slice(M.length):O.split("/").pop()??"",Y=B.type==="change"?"change":"rename";x?.(Y,G),j.emit("change",Y,G)});return j._attach(N,{recursive:!!R?.recursive,path:O,isDir:k}),j},createReadStream:T,createWriteStream:_,ReadStream:P,WriteStream:C},S={},A=u=>(...f)=>new Promise((E,R)=>{u(...f,(x,O)=>x?R(x):E(O))});return S.readFile=A((...u)=>d.readFile(...u)),S.writeFile=A((...u)=>d.writeFile(...u)),S.appendFile=A((u,f,E)=>d.appendFile(u,f,void 0,E)),S.mkdir=A((...u)=>d.mkdir(...u)),S.readdir=A((...u)=>d.readdir(...u)),S.rmdir=A((...u)=>d.rmdir(...u)),S.rm=A((...u)=>d.rm(...u)),S.unlink=A((...u)=>d.unlink(...u)),S.rename=A((...u)=>d.rename(...u)),S.copyFile=A((...u)=>d.copyFile(...u)),S.stat=A((...u)=>d.stat(...u)),S.lstat=A((...u)=>d.lstat(...u)),S.access=A((u,f)=>d.access(u,void 0,f)),S.chmod=A((...u)=>d.chmod(...u)),S.open=A((...u)=>d.open(...u)),S.realpath=A((...u)=>d.realpath(...u)),S.constants=d.constants,d.promises=S,d}},en={id:"fs/promises",aliases:["node:fs/promises"],origin:"web-node",deps:["fs"],init:r=>{const e=r.require("fs");if(!e.promises)throw new Error("web-node: fs builtin did not expose a promises API");return e.promises}},tn={id:"perf_hooks",aliases:["node:perf_hooks"],origin:"web-node",init:()=>{const r=globalThis.performance;if(!r)throw new Error("web-node: this host has no Performance global");return{performance:r,PerformanceObserver:globalThis.PerformanceObserver,PerformanceObserverEntryList:void 0,PerformanceEntry:void 0,PerformanceMark:void 0,PerformanceMeasure:void 0,constants:{NODE_PERFORMANCE_GC_MAJOR:4,NODE_PERFORMANCE_GC_MINOR:1,NODE_PERFORMANCE_GC_INCREMENTAL:8,NODE_PERFORMANCE_GC_WEAKCB:16},monitorEventLoopDelay:()=>{throw new Error("web-node: perf_hooks.monitorEventLoopDelay is not supported")},createHistogram:()=>{throw new Error("web-node: perf_hooks.createHistogram is not supported")}}}},nn=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]);function W(r,e){return r>>>e|r<<32-e}function rn(r){const e=new Uint32Array([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]),t=r.length,o=t+9+63>>6<<6,n=new Uint8Array(o);n.set(r),n[t]=128;const s=t*8,i=new DataView(n.buffer);i.setUint32(o-4,s>>>0,!1),i.setUint32(o-8,Math.floor(s/4294967296),!1);const h=new Uint32Array(64);for(let a=0;a<o;a+=64){for(let T=0;T<16;T++)h[T]=i.getUint32(a+T*4,!1);for(let T=16;T<64;T++){const _=W(h[T-15],7)^W(h[T-15],18)^h[T-15]>>>3,y=W(h[T-2],17)^W(h[T-2],19)^h[T-2]>>>10;h[T]=h[T-16]+_+h[T-7]+y>>>0}let[m,c,l,w,b,v,P,C]=e;for(let T=0;T<64;T++){const _=W(b,6)^W(b,11)^W(b,25),y=b&v^~b&P,d=C+_+y+nn[T]+h[T]>>>0,S=W(m,2)^W(m,13)^W(m,22),A=m&c^m&l^c&l,u=S+A>>>0;C=P,P=v,v=b,b=w+d>>>0,w=l,l=c,c=m,m=d+u>>>0}e[0]=e[0]+m>>>0,e[1]=e[1]+c>>>0,e[2]=e[2]+l>>>0,e[3]=e[3]+w>>>0,e[4]=e[4]+b>>>0,e[5]=e[5]+v>>>0,e[6]=e[6]+P>>>0,e[7]=e[7]+C>>>0}const p=new Uint8Array(32),g=new DataView(p.buffer);for(let a=0;a<8;a++)g.setUint32(a*4,e[a],!1);return p}function on(r){let e=1732584193,t=4023233417,o=2562383102,n=271733878,s=3285377520;const i=r.length,h=i+9+63>>6<<6,p=new Uint8Array(h);p.set(r),p[i]=128;const g=i*8,a=new DataView(p.buffer);a.setUint32(h-4,g>>>0,!1),a.setUint32(h-8,Math.floor(g/4294967296),!1);const m=new Uint32Array(80);for(let w=0;w<h;w+=64){for(let _=0;_<16;_++)m[_]=a.getUint32(w+_*4,!1);for(let _=16;_<80;_++){const y=m[_-3]^m[_-8]^m[_-14]^m[_-16];m[_]=(y<<1|y>>>31)>>>0}let[b,v,P,C,T]=[e,t,o,n,s];for(let _=0;_<80;_++){let y,d;_<20?(y=v&P|~v&C,d=1518500249):_<40?(y=v^P^C,d=1859775393):_<60?(y=v&P|v&C|P&C,d=2400959708):(y=v^P^C,d=3395469782);const S=(b<<5|b>>>27)+y+T+d+m[_]>>>0;T=C,C=P,P=(v<<30|v>>>2)>>>0,v=b,b=S}e=e+b>>>0,t=t+v>>>0,o=o+P>>>0,n=n+C>>>0,s=s+T>>>0}const c=new Uint8Array(20),l=new DataView(c.buffer);return l.setUint32(0,e,!1),l.setUint32(4,t,!1),l.setUint32(8,o,!1),l.setUint32(12,n,!1),l.setUint32(16,s,!1),c}const sn=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21],Ge=new Uint32Array(64);for(let r=0;r<64;r++)Ge[r]=Math.floor(Math.abs(Math.sin(r+1))*4294967296)>>>0;function an(r){let e=1732584193,t=4023233417,o=2562383102,n=271733878;const s=r.length,i=s+9+63>>6<<6,h=new Uint8Array(i);h.set(r),h[s]=128;const p=new DataView(h.buffer);p.setUint32(i-8,s*8>>>0,!0),p.setUint32(i-4,Math.floor(s*8/4294967296),!0);for(let m=0;m<i;m+=64){const c=new Uint32Array(16);for(let P=0;P<16;P++)c[P]=p.getUint32(m+P*4,!0);let[l,w,b,v]=[e,t,o,n];for(let P=0;P<64;P++){let C,T;P<16?(C=w&b|~w&v,T=P):P<32?(C=v&w|~v&b,T=(5*P+1)%16):P<48?(C=w^b^v,T=(3*P+5)%16):(C=b^(w|~v),T=7*P%16);const _=v;v=b,b=w;const y=l+C+Ge[P]+c[T]>>>0,d=sn[P];w=w+(y<<d|y>>>32-d)>>>0,l=_}e=e+l>>>0,t=t+w>>>0,o=o+b>>>0,n=n+v>>>0}const g=new Uint8Array(16),a=new DataView(g.buffer);return a.setUint32(0,e,!0),a.setUint32(4,t,!0),a.setUint32(8,o,!0),a.setUint32(12,n,!0),g}const ln={sha1:on,sha256:rn,md5:an};function cn(r,e){if(typeof r=="string"){if(e==="hex"){const t=new Uint8Array(r.length>>1);for(let o=0;o<t.length;o++)t[o]=parseInt(r.substr(o*2,2),16);return t}if(e==="base64"){const t=atob(r),o=new Uint8Array(t.length);for(let n=0;n<t.length;n++)o[n]=t.charCodeAt(n);return o}if(e==="latin1"||e==="binary"){const t=new Uint8Array(r.length);for(let o=0;o<r.length;o++)t[o]=r.charCodeAt(o)&255;return t}return new TextEncoder().encode(r)}return r instanceof Uint8Array?r:ArrayBuffer.isView(r)?new Uint8Array(r.buffer,r.byteOffset,r.byteLength):r instanceof ArrayBuffer?new Uint8Array(r):new Uint8Array(0)}function dn(r){let e="";for(let t=0;t<r.length;t++)e+=r[t].toString(16).padStart(2,"0");return e}function un(r){let e="";for(let t=0;t<r.length;t++)e+=String.fromCharCode(r[t]);return btoa(e)}const hn={id:"crypto",aliases:["node:crypto"],origin:"web-node",init:()=>{const r=globalThis.crypto;if(!r)throw new Error("web-node: this host has no WebCrypto");const e=o=>{const n=new Uint8Array(o);return r.getRandomValues(n),n},t=o=>{const n=ln[o.toLowerCase().replace("-","")];if(!n)throw new Error(`web-node: crypto.createHash('${o}') is not supported (sha1, sha256, md5 only)`);const s=[],i={update(h,p){return s.push(cn(h,p)),i},digest(h){let p=0;for(const c of s)p+=c.length;const g=new Uint8Array(p);let a=0;for(const c of s)g.set(c,a),a+=c.length;const m=n(g);return h==="hex"?dn(m):h==="base64"?un(m):m},copy(){return t(o)}};return i};return{createHash:t,randomBytes:e,randomUUID:()=>r.randomUUID(),randomFillSync:o=>r.getRandomValues(o),getRandomValues:o=>r.getRandomValues(o),webcrypto:r,crypto:r,constants:{},default:{createHash:t,randomBytes:e,webcrypto:r}}}};function Re(r){const e=typeof r=="string"?new URL(r):r;if(e.protocol!=="file:")throw new TypeError(`The URL must be of scheme file, got ${e.protocol}`);let t=decodeURIComponent(e.pathname);return e.hostname&&e.hostname!=="localhost"&&(t="//"+e.hostname+t),t}function xe(r){const t=(r.startsWith("/")?r:"/"+r).split("/").map(o=>encodeURIComponent(o).replace(/%2F/gi,"/")).join("/");return new URL("file://"+t)}const pn={id:"url",aliases:["node:url"],origin:"web-node",init:()=>{const r=t=>{const o=new URL(t,"http://localhost");return{protocol:o.protocol,slashes:!0,auth:o.username?`${o.username}:${o.password}`:null,host:o.host,port:o.port,hostname:o.hostname,hash:o.hash,search:o.search,query:o.search.slice(1),pathname:o.pathname,path:o.pathname+o.search,href:o.href}},e=t=>{const o=(t.protocol??"http:").replace(/:?$/,":"),n=t.host??t.hostname??"",s=t.port?":"+t.port:"",i=t.pathname??"/";let h=t.search??"";!h&&t.query&&typeof t.query=="object"?h="?"+new URLSearchParams(t.query).toString():!h&&typeof t.query=="string"&&(h="?"+t.query);const p=t.hash?t.hash.startsWith("#")?t.hash:"#"+t.hash:"";return`${o}//${n}${s}${i}${h}${p}`};return{URL,URLSearchParams,pathToFileURL:xe,fileURLToPath:Re,urlToHttpOptions:t=>({protocol:t.protocol,hostname:t.hostname.startsWith("[")?t.hostname.slice(1,-1):t.hostname,hash:t.hash,search:t.search,pathname:t.pathname,path:t.pathname+t.search,href:t.href,port:t.port,auth:t.username?`${t.username}:${t.password}`:void 0}),domainToASCII:t=>t,domainToUnicode:t=>t,parse:r,format:e,resolve:(t,o)=>new URL(o,t).href,resolveObject:(t,o)=>r(new URL(o,t).href),default:{URL,URLSearchParams,pathToFileURL:xe,fileURLToPath:Re,parse:r,format:e}}}},Se="127.0.0.1",we="::1";function fn(r){return r===6||r==="IPv6"?6:4}function mn(r){const e=fn(r.family);return{address:e===6?we:Se,family:e}}function ze(r,e,t){let o,n;if(typeof e=="function")n=e,o={};else{if(typeof t!="function")throw Object.assign(new TypeError('The "callback" argument must be of type function. Received type '+typeof t),{code:"ERR_INVALID_ARG_TYPE"});n=t,o=e??{}}queueMicrotask(()=>{if(typeof r!="string"||r.length===0){n(Object.assign(new Error("ENOTFOUND "+r),{code:"ENOTFOUND",hostname:r}));return}const s=mn(o);o.all?n(null,[s]):n(null,s.address,s.family)})}const Ke={lookup(r,e={}){return new Promise((t,o)=>{ze(r,e,(n,s,i)=>{n?o(n):e.all?t(s):t({address:s,family:i})})})},resolve4(r){return Promise.resolve([Se])},resolve6(r){return Promise.resolve([we])},reverse(r){return Promise.resolve(["localhost"])}},gn={id:"dns/promises",aliases:["node:dns/promises"],origin:"web-node",init:()=>Ke},yn={id:"dns",aliases:["node:dns"],origin:"web-node",init:()=>{const r=e=>()=>{throw K("api",`dns.${e}`)};return{lookup:ze,promises:Ke,reverse:(e,t)=>queueMicrotask(()=>t(null,["localhost"])),resolve4:(e,t)=>queueMicrotask(()=>t(null,[Se])),resolve6:(e,t)=>queueMicrotask(()=>t(null,[we])),getDefaultResultOrder:()=>"verbatim",setDefaultResultOrder:()=>{},resolve:r("resolve"),resolveAny:r("resolveAny"),resolveCname:r("resolveCname"),resolveMx:r("resolveMx"),resolveNaptr:r("resolveNaptr"),resolveNs:r("resolveNs"),resolvePtr:r("resolvePtr"),resolveSoa:r("resolveSoa"),resolveSrv:r("resolveSrv"),resolveTxt:r("resolveTxt"),Resolver:class{},NODATA:"ENODATA",FORMERR:"EFORMERR",SERVFAIL:"ESERVFAIL",NOTFOUND:"ENOTFOUND",NOTIMP:"ENOTIMP",REFUSED:"EREFUSED",BADQUERY:"EBADQUERY",BADNAME:"EBADNAME",BADFAMILY:"EBADFAMILY",BADRESP:"EBADRESP",CONNREFUSED:"ECONNREFUSED",TIMEOUT:"ETIMEOUT",EOF:"EOF",FILE:"EFILE",NOMEM:"ENOMEM",DESTRUCTION:"EDESTRUCTION",BADSTR:"EBADSTR",BADFLAGS:"EBADFLAGS",NONAME:"ENONAME",BADHINTS:"EBADHINTS",NOTINITIALIZED:"ENOTINITIALIZED",LOADIPHLPAPI:"ELOADIPHLPAPI",ADDRGETNETWORKPARAMS:"EADDRGETNETWORKPARAMS",CANCELLED:"ECANCELLED"}}};function bn(r,e){return()=>{throw K("api",`${r}.${e}`)}}function J(r,e={}){const t=o=>o==="__esModule"||o==="default"||o==="then";return new Proxy(e,{get(o,n){if(typeof n=="symbol"||Object.prototype.hasOwnProperty.call(o,n))return o[n];if(!t(n))return bn(r,n)},has(o,n){return Object.prototype.hasOwnProperty.call(o,n)?!0:typeof n=="symbol"?!1:!t(n)}})}const Sn=[{id:"tty",aliases:["node:tty"],origin:"web-node",init:()=>J("tty",{isatty:()=>!1,WriteStream:class{},ReadStream:class{}})},{id:"child_process",aliases:["node:child_process"],origin:"web-node",init:()=>J("child_process")},{id:"v8",aliases:["node:v8"],origin:"web-node",init:()=>J("v8",{serialize:void 0,deserialize:void 0})},{id:"worker_threads",aliases:["node:worker_threads"],origin:"web-node",init:()=>J("worker_threads",{isMainThread:!0,parentPort:null,workerData:null,threadId:0})},{id:"readline",aliases:["node:readline"],origin:"web-node",init:()=>J("readline")},{id:"tls",aliases:["node:tls"],origin:"web-node",init:()=>J("tls")},{id:"zlib",aliases:["node:zlib"],origin:"web-node",init:()=>J("zlib",{constants:{Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1}})}],wn={id:"util",aliases:["node:util"],origin:"web-node",init:()=>{function r(c,...l){if(typeof c!="string")return[c,...l].map(P=>typeof P=="string"?P:t(P)).join(" ");let w=0;const b=c.replace(/%[sdifjoOc%]/g,P=>{if(P==="%%")return"%";if(w>=l.length)return P;const C=l[w++];switch(P){case"%s":return typeof C=="string"?C:t(C);case"%d":return String(Number(C));case"%i":return String(parseInt(String(C),10));case"%f":return String(parseFloat(String(C)));case"%j":try{return JSON.stringify(C)}catch{return"[Circular]"}case"%o":case"%O":return t(C);case"%c":return"";default:return P}});for(;w<l.length;w++)b.concat(" ",typeof l[w]=="string"?l[w]:t(l[w]));let v=b;for(;w<l.length;w++)v+=" "+(typeof l[w]=="string"?l[w]:t(l[w]));return v}function e(c,l,...w){return r(l,...w)}function t(c,l){const b=(typeof l=="object"&&l!==null?l:{}).depth??2;return o(c,b,new Set)}function o(c,l,w){if(c===null)return"null";if(c===void 0)return"undefined";const b=typeof c;if(b==="string")return`'${c}'`;if(b==="number"||b==="boolean"||b==="bigint")return String(c);if(b==="symbol")return c.toString();if(b==="function")return`[Function: ${c.name||"anonymous"}]`;if(w.has(c))return"[Circular]";if(l<0)return Array.isArray(c)?"[Array]":"[Object]";w.add(c);let v;if(Array.isArray(c))v="[ "+c.map(P=>o(P,l-1,w)).join(", ")+" ]";else if(c instanceof Date)v=c.toISOString();else if(c instanceof RegExp)v=c.toString();else if(c instanceof Error)v=c.stack??`${c.name}: ${c.message}`;else if(ArrayBuffer.isView(c))v=`${c.constructor.name}(${c.length}) [ ${Array.from(c).join(", ")} ]`;else{const P=c,C=Object.keys(P),T=c.constructor?.name;v=(T&&T!=="Object"?`${T} `:"")+"{ "+C.map(y=>`${y}: ${o(P[y],l-1,w)}`).join(", ")+" }"}return w.delete(c),v}const n={isAnyArrayBuffer:c=>c instanceof ArrayBuffer,isArrayBuffer:c=>c instanceof ArrayBuffer,isAsyncFunction:c=>typeof c=="function"&&c.constructor?.name==="AsyncFunction",isDate:c=>c instanceof Date,isMap:c=>c instanceof Map,isNativeError:c=>c instanceof Error,isPromise:c=>c instanceof Promise,isRegExp:c=>c instanceof RegExp,isSet:c=>c instanceof Set,isTypedArray:c=>ArrayBuffer.isView(c)&&!(c instanceof DataView),isUint8Array:c=>c instanceof Uint8Array};function s(c,l){if(c===l)return!0;if(typeof c!="object"||typeof l!="object"||c===null||l===null)return!1;if(c instanceof Date&&l instanceof Date)return c.getTime()===l.getTime();if(c instanceof RegExp&&l instanceof RegExp)return c.toString()===l.toString();const w=Object.keys(c),b=Object.keys(l);if(w.length!==b.length)return!1;for(const v of w)if(!Object.prototype.hasOwnProperty.call(l,v)||!s(c[v],l[v]))return!1;return!0}function i(c){if(typeof c!="function")throw new TypeError('The "original" argument must be of type function');return function(...w){return new Promise((b,v)=>{c.call(this,...w,(P,C)=>{P?v(P):b(C)})})}}function h(c){return function(...w){const b=w.pop();if(typeof b!="function")throw new TypeError("The last argument must be of type function");c.apply(this,w).then(v=>queueMicrotask(()=>b(null,v)),v=>queueMicrotask(()=>b(v)))}}function p(c,l){Object.setPrototypeOf(c.prototype,l.prototype)}function g(c,l,w){return c}function a(c){return c.replace(/\u001b\[[0-9;]*m/g,"")}function m(c,l,w){return l}return{format:r,formatWithOptions:e,inspect:t,types:n,isDeepStrictEqual:s,promisify:i,callbackify:h,inherits:p,deprecate:g,stripVTControlCharacters:a,styleText:m,toUSVString:c=>c,getSystemErrorName:c=>String(c),getSystemErrorMap:()=>new Map,TextEncoder,TextDecoder,debuglog:()=>()=>{},debug:()=>{},parseArgs:()=>{throw new Error("util.parseArgs is not supported in web-node yet")},transferableAbortController:()=>new AbortController,transferableAbortSignal:c=>c,aborted:()=>new Promise(()=>{}),emitWarning:()=>{},setTraceSigInt:()=>{},getCallSites:()=>[],isCollected:()=>!1,MIMEType:void 0,MIMEParams:void 0,_errnoException:c=>c}}},En={id:"console",aliases:["node:console"],origin:"web-node",deps:["util"],init:r=>{const e=r.require("util"),t=r.binding;function o(p){return typeof p=="string"?p:e.inspect(p)}class n{#e;#n;#t="";constructor(g){this.#e=g?.stdout??t.writeStdout,this.#n=g?.stderr??t.writeStderr}log(...g){this.#e(this.#t+g.map(o).join(" ")+`
`)}info(...g){this.log(...g)}debug(...g){this.log(...g)}warn(...g){this.#n(this.#t+g.map(o).join(" ")+`
`)}error(...g){this.warn(...g)}trace(...g){const a=new Error;this.#n(this.#t+"Trace: "+g.map(o).join(" ")+`
`+(a.stack??"")+`
`)}dir(g){this.log(e.inspect(g))}assert(g,...a){g||this.#n("Assertion failed"+(a.length?": "+a.map(o).join(" "):"")+`
`)}count(g="default"){this.log(`${g}: 1`)}countReset(g="default"){this.log(`${g}: 0`)}group(...g){this.log(...g),this.#t+="  "}groupCollapsed(...g){this.group(...g)}groupEnd(){this.#t=this.#t.slice(2)}table(g){this.log(e.inspect(g))}time(g="default"){this.log(`${g}: 0ms`)}timeEnd(g="default"){this.log(`${g}: 0ms`)}timeLog(g="default"){this.log(`${g}: 0ms`)}clear(){}profile(){}profileEnd(){}}const s=new n,i={Console:n,default:s},h=["log","info","debug","warn","error","trace","dir","assert","count","countReset","group","groupCollapsed","groupEnd","table","time","timeEnd","timeLog","clear","profile","profileEnd"];for(const p of h)i[p]=s[p].bind(s);return i}},vn={id:"timers",aliases:["node:timers"],origin:"web-node",init:r=>{const e=r.binding.timers;class t{_id;_kind;_destroyed=!1;_repeat;_callback;constructor(m,c,l,w){this._id=m,this._kind=c,this._callback=l,this._repeat=w}refresh(){return this}ref(){return this}unref(){return this}hasRef(){return!this._destroyed}[Symbol.toPrimitive](){return this._id}close(){this._destroyed=!0,e.clearTimeout(this._id)}}function o(a,m,...c){const l=e.setTimeout(a,m??1,...c);return new t(l,"timeout",a,null)}function n(a,m,...c){const l=e.setInterval(a,m??1,...c);return new t(l,"interval",a,m??1)}function s(a,...m){const c=e.setImmediate(a,...m);return new t(c,"immediate",a,null)}function i(a){a!==void 0&&(typeof a=="number"?e.clearTimeout(a):(a._destroyed=!0,e.clearTimeout(a._id)))}function h(a){a!==void 0&&(typeof a=="number"?e.clearInterval(a):(a._destroyed=!0,e.clearInterval(a._id)))}function p(a){a!==void 0&&(typeof a=="number"?e.clearImmediate(a):(a._destroyed=!0,e.clearImmediate(a._id)))}return{setTimeout:o,setInterval:n,setImmediate:s,clearTimeout:i,clearInterval:h,clearImmediate:p,promises:{setTimeout:(a,m)=>new Promise(c=>o(()=>c(m),a)),setImmediate:a=>new Promise(m=>s(()=>m(a))),setInterval:async function*(a,m){for(;;)yield await new Promise(c=>o(()=>c(m),a))},scheduler:{wait:a=>new Promise(m=>o(m,a)),yield:()=>new Promise(a=>s(a))}},Timeout:t,_unrefActive:()=>{},active:()=>0,enroll:()=>{},unenroll:()=>{}}}},An={id:"process",aliases:["node:process"],origin:"web-node",deps:["events"],init:r=>{const e=r.require("events").EventEmitter,t=r.binding;function o(g,a){return{write(m,c,l){return g(typeof m=="string"?m:String(m)),typeof l=="function"&&queueMicrotask(l),!0},end(m,c){m!==void 0&&this.write(m),typeof c=="function"&&queueMicrotask(c)},isTTY:a,columns:80,rows:24,on:()=>{},once:()=>{},emit:()=>!1,setDefaultEncoding:()=>{}}}class n extends e{isTTY=!1;readable=!0;fd=0;read(){return null}pause(){return this}resume(){return this}setEncoding(){return this}setRawMode(){return this}ref(){return this}unref(){return this}}const s=Date.now();class i extends e{argv=["/bin/node",...t.argv];argv0="node";execArgv=[];execPath=t.execPath;env=t.env;version="v26.9.1";versions={node:"26.9.1",webnode:"0.1.0",v8:"0.0.0-web-node",uv:"0.0.0-web-node",modules:"137"};platform="linux";arch="wasm32";pid=1;ppid=0;title="node";exitCode=void 0;noDeprecation=!1;throwDeprecation=!1;traceDeprecation=!1;features={inspector:!1,debug:!1,uv:!1,ipv6:!1,tls:!1,tls_alpn:!1,tls_sni:!1,tls_ocsp:!1,tls_psk:!1,cached_builtins:!0,openssl_is_boringssl:!1,require_module:!0,typescript:"strip"};release={name:"node",sourceUrl:"",headersUrl:""};config={variables:{},target_defaults:{}};allowedNodeEnvironmentFlags=new Set;stdout=o(t.writeStdout,!1);stderr=o(t.writeStderr,!1);stdin=new n;cwd(){return t.vfs.cwd}chdir(a){t.vfs.chdir(a)}exit(a){throw t.exit(a??0),new Error("unreachable")}nextTick(a,...m){t.nextTick(a,...m)}hrtime(a){const m=p.hrtime.bigint();if(a){const c=m-(BigInt(a[0])*1000000000n+BigInt(a[1]));return[Number(c/1000000000n),Number(c%1000000000n)]}return[Number(m/1000000000n),Number(m%1000000000n)]}uptime(){return(Date.now()-s)/1e3}memoryUsage(){const a=performance.memory;return{rss:a?.usedJSHeapSize??0,heapTotal:a?.totalJSHeapSize??0,heapUsed:a?.usedJSHeapSize??0,external:0,arrayBuffers:0}}getuid=()=>0;getgid=()=>0;geteuid=()=>0;getegid=()=>0;getgroups=()=>[0];umask=()=>18;setuid=()=>{};setgid=()=>{};abort=()=>{throw new Error("process.abort is not supported in web-node")};kill=()=>{throw new Error("process.kill is not supported in web-node")};emitWarning=()=>{};resourceUsage=()=>({userCPUTime:0,systemCPUTime:0,maxRSS:0,sharedMemorySize:0,unsharedDataSize:0,unsharedStackSize:0,minorPageFault:0,majorPageFault:0,swappedOut:0,fsRead:0,fsWrite:0,ipcSent:0,ipcReceived:0,signalsCount:0,voluntaryContextSwitches:0,involuntaryContextSwitches:0});cpuUsage=()=>({user:0,system:0});threadCpuUsage=()=>({user:0,system:0});availableMemory=()=>512*1024*1024;constrainedMemory=()=>512*1024*1024;sourceMapsEnabled=!1;setSourceMapsEnabled=()=>{};binding=a=>{throw new Error(`process.binding('${a}') is not available in web-node`)};_linkedBinding=a=>{throw new Error(`process._linkedBinding('${a}') is not available in web-node`)}}const h=i.prototype;h.hrtime.bigint=()=>BigInt(Math.round(performance.now()*1e6));const p=new i;return p.hrtime.bigint=h.hrtime.bigint,p}},Pn={id:"string_decoder",aliases:["node:string_decoder"],origin:"web-node",deps:["buffer"],init:()=>{class r{#e;#n=[];lastNeed=0;lastTotal=0;lastChar=new Uint8Array(0);constructor(t="utf8"){this.#e=t.toLowerCase()}get encoding(){return this.#e}write(t){const o=new Uint8Array([...this.#n,...t]);switch(this.#n=[],this.#e){case"utf8":case"utf-8":return this.#t(o);case"utf16le":case"utf-16le":case"ucs2":case"ucs-2":return this.#r(o);case"latin1":case"binary":case"ascii":return this.#o(o);case"base64":return this.#s(o,!1);case"base64url":return this.#s(o,!0);case"hex":return this.#i(o);default:throw new TypeError(`Unknown encoding: ${this.#e}`)}}#t(t){return new TextDecoder("utf-8",{fatal:!1}).decode(t,{stream:!0})}#r(t){const o=t.length%2;o&&(this.#n=[t[t.length-1]]);let n="";const s=t.length-o;for(let i=0;i<s;i+=2)n+=String.fromCharCode(t[i]|t[i+1]<<8);return n}#o(t){let o="";for(let n=0;n<t.length;n++)o+=String.fromCharCode(t[n]);return o}#s(t,o){let n="";for(let i=0;i<t.length;i++)n+=String.fromCharCode(t[i]);const s=btoa(n);return o?s.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""):s}#i(t){let o="";for(let n=0;n<t.length;n++)o+=t[n].toString(16).padStart(2,"0");return o}end(t){if(t)return this.write(t);const o=this.#n;return this.#n=[],this.write(new Uint8Array(o))}}return{StringDecoder:r,default:{StringDecoder:r}}}},_n={id:"os",aliases:["node:os"],origin:"web-node",init:()=>({EOL:`
`,devNull:"/dev/null",arch:()=>"wasm32",platform:()=>"linux",type:()=>"Browser",release:()=>"browser",version:()=>"web-node",machine:()=>"wasm32",hostname:()=>"web-node",endianness:()=>"LE",tmpdir:()=>"/tmp",homedir:()=>"/home/web-node",userInfo:()=>({uid:0,gid:0,username:"web-node",homedir:"/home/web-node",shell:null}),cpus:()=>[],availableParallelism:()=>navigator.hardwareConcurrency??1,totalmem:()=>1024*1024*1024,freemem:()=>512*1024*1024,uptime:()=>Math.floor(performance.now()/1e3),loadavg:()=>[0,0,0],networkInterfaces:()=>({}),getPriority:()=>0,setPriority:()=>{},constants:{UV_UDP_REUSEADDR:4,errno:{},signals:{},priority:{}}})},Rn={id:"assert",aliases:["node:assert"],origin:"web-node",deps:["util"],init:r=>{const e=r.require("util");class t extends Error{code="ERR_ASSERTION";actual;expected;operator;generatedMessage=!0;constructor(c){super(c.message??"Assertion failed"),this.name="AssertionError",this.actual=c.actual,this.expected=c.expected,this.operator=c.operator??"=="}}function o(m,c){if(!m)throw c instanceof Error?c:new t({message:c??`The expression evaluated to a falsy value: ${e.inspect(m)}`,actual:m,expected:!0,operator:"=="})}function n(m,c,l){if(!Object.is(m,c))throw l instanceof Error?l:new t({message:l??`${e.inspect(m)} !== ${e.inspect(c)}`,actual:m,expected:c,operator:"strictEqual"})}function s(m,c,l){if(!e.isDeepStrictEqual(m,c))throw l instanceof Error?l:new t({message:l??"Values are not deeply equal",actual:m,expected:c,operator:"deepStrictEqual"})}function i(m,c,l){if(Object.is(m,c))throw l instanceof Error?l:new t({message:l??"Values are strictly equal",actual:m,expected:c,operator:"notStrictEqual"})}function h(m,c){let l=!1;try{m()}catch{l=!0}if(!l)throw c instanceof Error?c:new t({message:c??"Missing expected exception",operator:"throws"})}async function p(m,c){let l=!1;try{await m()}catch{l=!0}if(!l)throw c instanceof Error?c:new t({message:c??"Missing expected rejection",operator:"rejects"})}function g(m){throw m instanceof Error?m:new t({message:m??"Failed",operator:"fail"})}const a=Object.assign(o,{ok:o,equal:(m,c,l)=>{if(m!=c)throw new t({message:typeof l=="string"?l:"Values are not equal",actual:m,expected:c,operator:"=="})},notEqual:(m,c,l)=>{if(m==c)throw new t({message:typeof l=="string"?l:"Values are equal",actual:m,expected:c,operator:"!="})},strictEqual:n,notStrictEqual:i,deepStrictEqual:s,deepEqual:s,notDeepStrictEqual:(m,c,l)=>{if(e.isDeepStrictEqual(m,c))throw new t({message:typeof l=="string"?l:"Values are deeply equal",actual:m,expected:c,operator:"notDeepStrictEqual"})},throws:h,rejects:p,doesNotThrow:m=>m(),doesNotReject:async m=>await m(),ifError:m=>{if(m)throw m},fail:g,AssertionError:t,CallTracker:class{}});return{...a,default:a}}},xn={id:"module",aliases:["node:module"],origin:"web-node",init:r=>{const e=[...r.builtinModuleIds].sort();class t{id;filename;path;exports={};parent;children=[];paths=[];loaded=!1;constructor(s="",i){this.id=s,this.filename=s,this.path=s.split("/").slice(0,-1).join("/")||"/",this.parent=i??null}require(s){const i=r.userRequire;return i?i(this.filename,s):r.require(s)}static _nodeModulePaths(s){const i=s.split("/").filter(Boolean),h=[];for(let p=i.length;p>=0;p--)h.push("/"+i.slice(0,p).concat("node_modules").join("/"));return h}static _resolveFilename=s=>s;static Module=t;static builtinModules=e;static isBuiltin=s=>e.includes(s.replace(/^node:/,""));static syncBuiltinESMExports=()=>{};static createRequire=s=>{const i=typeof s=="string"?s:s.href,h=i.startsWith("file://")?decodeURIComponent(i.slice(7)):i,p=r.userRequire,g=a=>p?p(h,a):r.require(a);return g.resolve=(a,m)=>p?.resolve?p.resolve(h,a,m):a,g};static register=()=>{};static _cache=new Map;static _extensions={};static globalPaths=[]}Object.assign(t,{Module:t});const o=t;return o.Module=t,o.default=t,o}},Cn={id:"net",aliases:["node:net"],origin:"web-node",deps:["events"],init:r=>{const{EventEmitter:e}=r.require("events"),t=r.binding.network,o=Symbol("web-node.socket.side");class n extends e{connecting=!1;destroyed=!1;pending=!1;readyState="closed";remoteAddress="127.0.0.1";remoteFamily="IPv4";remotePort=0;localAddress="127.0.0.1";localPort=0;bytesRead=0;bytesWritten=0;bufferSize=0;timeout=0;#e=null;#n=null;_attach(m,c){this.#e=m,this[o]=c,this.remotePort=m.remotePort,this.localPort=m.localPort,this.readyState="open",m.onData(l=>{this.bytesRead+=l.byteLength,this.emit("data",this.#n?new TextDecoder(this.#n).decode(l):p(r,l))}),m.onEnd(()=>{this.readyState="readOnly",this.emit("end")}),m.onClose(()=>this.#t()),m.onError(l=>this.emit("error",l))}#t(){this.destroyed||(this.destroyed=!0,this.readyState="closed",this.emit("close",!1))}connect(m,c,l){typeof c=="function"&&(l=c,c=void 0),this.connecting=!0,this.readyState="opening";let w;try{w=t.dial(m)}catch(b){return this.connecting=!1,this.readyState="closed",this.destroyed=!0,r.binding.nextTick(()=>this.emit("error",b)),this}return this._attach(w,"client"),this.connecting=!1,r.binding.nextTick(()=>{this.emit("connect"),typeof l=="function"&&l()}),this}write(m,c,l){typeof c=="function"&&(l=c,c=void 0);const w=this.#e;if(!w||this.destroyed){const v=Object.assign(new Error("This socket has been ended by the other party"),{code:"EPIPE"});return typeof l=="function"?r.binding.nextTick(()=>l(v)):r.binding.nextTick(()=>this.emit("error",v)),!1}const b=h(m);return this.bytesWritten+=b.byteLength,w.write(b),typeof l=="function"&&r.binding.nextTick(l),!0}end(m,c,l){return typeof m=="function"?(l=m,m=void 0):typeof c=="function"&&(l=c,c=void 0),m!==void 0&&this.write(m),this.readyState="readOnly",this.#e?.end(),typeof l=="function"&&r.binding.nextTick(l),this}destroy(m){return this.destroyed?this:(this.#e?.destroy(m),this.#e||this.#t(),this)}setEncoding(m){return this.#n=m,this}setNoDelay(){return this}setKeepAlive(){return this}setTimeout(m,c){return this.timeout=m,typeof c=="function"&&this.once("timeout",c),this}ref(){return this}unref(){return this}address(){return{address:this.localAddress,family:"IPv4",port:this.localPort}}get writableLength(){return 0}get readableLength(){return 0}}class s extends e{listening=!1;maxConnections=1/0;connections=0;#e=0;#n="127.0.0.1";constructor(m){super(),typeof m=="function"&&this.on("connection",m)}listen(...m){let c=0,l="127.0.0.1",w;if(typeof m[0]=="object"&&m[0]!==null){const b=m[0];c=b.port??0,l=b.host??l,typeof m[1]=="function"&&(w=m[1])}else{c=typeof m[0]=="number"?m[0]:Number(m[0]??0);let b=1;typeof m[b]=="string"&&(l=m[b++]),typeof m[b]=="number"&&b++,typeof m[b]=="function"&&(w=m[b])}c===0&&(c=i(t)),this.#e=c,this.#n=l;try{t.listen(c,b=>{this.connections++;const v=new n;v.once("close",()=>{this.connections--}),v._attach(b,"server"),this.emit("connection",v)})}catch(b){return r.binding.nextTick(()=>this.emit("error",b)),this}return this.listening=!0,r.binding.nextTick(()=>{this.emit("listening"),typeof w=="function"&&w()}),this}close(m){return this.listening&&t.unlisten(this.#e),this.listening=!1,r.binding.nextTick(()=>{this.emit("close"),typeof m=="function"&&m()}),this}address(){return this.listening?{address:this.#n,family:"IPv4",port:this.#e}:null}ref(){return this}unref(){return this}getConnections(m){r.binding.nextTick(()=>m(null,this.connections))}}function i(a){for(let m=0;m<200;m++){const c=3e4+Math.floor(Math.random()*1e4);if(!a.isListening(c))return c}throw new Error("EADDRINUSE: could not find a free ephemeral port")}function h(a){if(typeof a=="string")return new TextEncoder().encode(a);if(a instanceof Uint8Array)return a;if(ArrayBuffer.isView(a))return new Uint8Array(a.buffer,a.byteOffset,a.byteLength);if(a instanceof ArrayBuffer)return new Uint8Array(a);throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer, ArrayBuffer, or Array')}function p(a,m){const{Buffer:c}=a.require("buffer");return c.from(m)}function g(a){return typeof a!="string"?0:/^(\d{1,3}\.){3}\d{1,3}$/.test(a)?4:a.includes(":")?6:0}return{Server:s,Socket:n,createServer:a=>new s(a),createConnection:(a,m,c)=>new n().connect(a,m,c),connect:(a,m,c)=>new n().connect(a,m,c),isIP:g,isIPv4:a=>g(a)===4,isIPv6:a=>g(a)===6,default:{Server:s,Socket:n},_network:t}}},Tn=[13,10,13,10];function On(r){e:for(let e=0;e+3<r.length;e++){for(let t=0;t<4;t++)if(r[e+t]!==Tn[t])continue e;return e}return-1}function kn(r,e){if(r.length===0)return e;const t=new Uint8Array(r.length+e.length);return t.set(r,0),t.set(e,r.length),t}function Ce(r,e=0){for(let t=e;t+1<r.length;t++)if(r[t]===13&&r[t+1]===10)return t;return-1}function In(r){const e=r.split(`\r
`),t=e.shift();if(!t)return null;const o={},n=[];for(const h of e){if(!h)continue;const p=h.indexOf(":");if(p<0)continue;const g=h.slice(0,p).trim(),a=h.slice(p+1).trim();n.push(g,a);const m=g.toLowerCase(),c=o[m];c===void 0?o[m]=a:Array.isArray(c)?c.push(a):o[m]=[c,a]}const s=/^([A-Za-z]+) (\S+) HTTP\/(\d\.\d)$/.exec(t);if(s)return{method:s[1].toUpperCase(),target:s[2],version:s[3],headers:o,rawHeaders:n};const i=/^HTTP\/(\d\.\d) (\d{3})(?: (.*))?$/.exec(t);return i?{version:i[1],statusCode:Number(i[2]),statusMessage:i[3]??"",headers:o,rawHeaders:n}:null}class Te{constructor(e,t,o){this.onHead=e,this.onBody=t,this.onEnd=o}#e=new Uint8Array(0);#n=null;#t="head";#r=0;get done(){return this.#t==="done"}rest(){return this.#e}push(e){if(this.#e=kn(this.#e,e),this.#t!=="done")for(;;){if(this.#t==="head"){const t=On(this.#e);if(t<0)return;const o=new TextDecoder("latin1").decode(this.#e.subarray(0,t));this.#e=this.#e.subarray(t+4);const n=In(o);if(!n){this.#t="done",this.onEnd();return}this.#n=n,this.onHead(n);const s=n.headers["transfer-encoding"],i=Array.isArray(s)?s.join(","):s??"",h=n.headers["content-length"],p=h===void 0?0:Number(Array.isArray(h)?h[0]:h);if(/chunked/i.test(i))this.#t="chunk-size";else if(Number.isFinite(p)&&p>0)this.#t="length",this.#r=p;else{this.#t="done",this.onEnd();return}continue}if(this.#t==="length"||this.#t==="chunk-data"){if(this.#e.length===0)return;const t=Math.min(this.#r,this.#e.length);if(this.onBody(this.#e.slice(0,t)),this.#e=this.#e.subarray(t),this.#r-=t,this.#r>0)return;if(this.#t==="length"){this.#t="done",this.onEnd();return}this.#t="chunk-crlf";continue}if(this.#t==="chunk-size"){const t=Ce(this.#e);if(t<0)return;const o=new TextDecoder("latin1").decode(this.#e.subarray(0,t)).split(";")[0].trim();this.#e=this.#e.subarray(t+2);const n=parseInt(o,16);if(!Number.isFinite(n)||n<0){this.#t="done",this.onEnd();return}if(n===0){this.#t="trailer";continue}this.#r=n,this.#t="chunk-data";continue}if(this.#t==="trailer"){const t=Ce(this.#e);if(t<0)return;const o=new TextDecoder("latin1").decode(this.#e.subarray(0,t));if(this.#e=this.#e.subarray(t+2),o===""){this.#t="done",this.onEnd();return}continue}if(this.#e.length<2)return;this.#e=this.#e.subarray(2),this.#t="chunk-size"}}}const Dn=new TextEncoder().encode(`\r
`),Nn=new TextEncoder().encode(`0\r
\r
`),Oe={100:"Continue",101:"Switching Protocols",200:"OK",201:"Created",202:"Accepted",204:"No Content",206:"Partial Content",301:"Moved Permanently",302:"Found",303:"See Other",304:"Not Modified",307:"Temporary Redirect",308:"Permanent Redirect",400:"Bad Request",401:"Unauthorized",403:"Forbidden",404:"Not Found",405:"Method Not Allowed",408:"Request Timeout",409:"Conflict",410:"Gone",413:"Payload Too Large",415:"Unsupported Media Type",418:"I'm a Teapot",422:"Unprocessable Entity",429:"Too Many Requests",500:"Internal Server Error",501:"Not Implemented",502:"Bad Gateway",503:"Service Unavailable",504:"Gateway Timeout"},jn={id:"http",aliases:["node:http"],origin:"web-node",deps:["net","events","stream"],init:r=>{const{EventEmitter:e}=r.require("events"),t=r.require("net"),{Readable:o,Writable:n}=r.require("stream"),s=r.require("buffer").Buffer;function i(_){return s.from(_)}function h(_){if(typeof _=="string")return new TextEncoder().encode(_);if(_ instanceof Uint8Array)return _;if(ArrayBuffer.isView(_))return new Uint8Array(_.buffer,_.byteOffset,_.byteLength);if(_ instanceof ArrayBuffer)return new Uint8Array(_);throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer')}class p extends o{httpVersion="1.1";httpVersionMajor=1;httpVersionMinor=1;complete=!1;aborted=!1;method=void 0;url="";statusCode=0;statusMessage="";headers={};rawHeaders=[];trailers={};rawTrailers=[];socket=null;connection=null;req=void 0;constructor(){super({})}_read(){}_setup(y,d){this.httpVersion=y.version,this.httpVersionMajor=Number(y.version.split(".")[0]),this.httpVersionMinor=Number(y.version.split(".")[1]),this.method=y.method,this.url=y.target??"",this.statusCode=y.statusCode??0,this.statusMessage=y.statusMessage??"",this.headers=y.headers,this.rawHeaders=y.rawHeaders,this.socket=d,this.connection=d}_pushBody(y){this.push(i(y))}_end(){this.complete||(this.complete=!0,this.push(null))}_destroy(y,d){y&&(this.aborted=!0,this.socket?.destroy()),d(y)}async _readAll(){const y=[];return this.complete?new Uint8Array(0):(await new Promise(d=>{this.on("data",S=>y.push(h(S))),this.on("end",()=>d())}),g(y))}}function g(_){let y=0;for(const A of _)y+=A.byteLength;const d=new Uint8Array(y);let S=0;for(const A of _)d.set(A,S),S+=A.byteLength;return d}class a extends n{statusCode=200;statusMessage=void 0;headersSent=!1;finished=!1;sendDate=!0;socket=null;req=null;#e=new Map;#n=!1;#t=!1;#r=0;#o=!1;_onResponseFinish=null;get shouldKeepAlive(){return this.#o}constructor(y){super({}),this.socket=y}setHeader(y,d){if(this.headersSent)throw new Error("Cannot set headers after they are sent to the client");return this.#e.set(y.toLowerCase(),d),this}getHeader(y){return this.#e.get(y.toLowerCase())}getHeaders(){return Object.fromEntries(this.#e)}getHeaderNames(){return[...this.#e.keys()]}hasHeader(y){return this.#e.has(y.toLowerCase())}removeHeader(y){if(this.headersSent)throw new Error("Cannot remove headers after they are sent to the client");this.#e.delete(y.toLowerCase())}writeHead(y,d,S){if(this.statusCode=y,typeof d=="string"){if(this.statusMessage=d,S&&typeof S=="object")for(const[A,u]of Object.entries(S))this.setHeader(A,u)}else if(d&&typeof d=="object")for(const[A,u]of Object.entries(d))this.setHeader(A,u);return this.headersSent=!0,this}flushHeaders(){this.#s()}_write(y,d,S){try{this.#s();const A=h(y);this.#r+=A.byteLength,this.#t&&this.socket?.write(new TextEncoder().encode(A.byteLength.toString(16)+`\r
`)),A.byteLength&&this.socket?.write(A),this.#t&&this.socket?.write(Dn),S(null)}catch(A){S(A)}}_final(y){try{this.#s(),this.#t&&this.socket?.write(Nn),this.finished=!0,y(null),this._onResponseFinish?.()}catch(d){y(d)}}#s(){if(this.#n)return;this.#n=!0,this.headersSent=!0;const y=this.statusMessage??Oe[this.statusCode]??"Unknown",d=[`HTTP/1.1 ${this.statusCode} ${y}`],S=new Map(this.#e),A=this.statusCode===204||this.statusCode===304||this.statusCode===101;S.has("content-type")||S.set("content-type","text/plain; charset=utf-8"),this.sendDate&&!S.has("date")&&S.set("date",new Date().toUTCString()),A?S.delete("transfer-encoding"):S.has("content-length")||(this.#t=!0,S.set("transfer-encoding","chunked"));const u=this.req?.headers??{},f=S.get("connection"),E=String(Array.isArray(f)?f.join(","):f??"").toLowerCase(),R=String(u.connection??"").toLowerCase(),x=this.req?.httpVersion??"1.1",O=E.includes("close")||R.includes("close")||x==="1.0"&&!R.includes("keep-alive");this.#o=!O,S.set("connection",this.#o?"keep-alive":"close");for(const[k,M]of S){const j=k.replace(/(^|-)([a-z])/g,(N,B,G)=>`${B}${G.toUpperCase()}`);if(Array.isArray(M))for(const N of M)d.push(`${j}: ${N}`);else d.push(`${j}: ${M}`)}d.push("",""),this.socket?.write(new TextEncoder().encode(d.join(`\r
`)))}get _bodyLength(){return this.#r}_fail(y=500){return this.#n?!1:(this.statusCode=y,this.statusMessage=void 0,this.#e=new Map([["content-type","text/plain; charset=utf-8"]]),this.#t=!1,this.#r=0,this.end("Internal Server Error"),!0)}}class m extends t.Server{requestTimeout=0;headersTimeout=0;keepAliveTimeout=0;timeout=0;constructor(y){super(),typeof y=="function"&&this.on("request",y),this.on("connection",d=>this.#e(d))}#e(y){let d,S=null;const A=()=>{let u=null;d=new Te(f=>{const E=new p;E._setup(f,y);const R=new a(y);R.req=E,u=E,S=E,R._onResponseFinish=()=>{if(!R.shouldKeepAlive||y.destroyed){y.end();return}S=null,r.binding.nextTick(()=>{const x=d.rest();A(),x.length>0&&d.push(x)})};try{this.emit("request",E,R)}catch{R._fail(500)||y.destroy()}},f=>u?._pushBody(f),()=>{if(!u){const f=new a(y);f.writeHead(400,{"content-type":"text/plain"}),f._onResponseFinish=()=>y.end(),f.end("Bad Request");return}u._end()})};A(),y.on("data",u=>d.push(h(u))),y.on("end",()=>{S?._end()}),y.on("error",()=>{})}}function c(_){return new m(_)}class l{socket;reader;current=null;keepAlive=!0;destroyed=!1;constructor(y){this.socket=y,this.arm(new Uint8Array(0)),y.onData(d=>this.reader.push(d)),y.onError(d=>{const S=this.current;this.current=null,this.destroy(),S?.onError(d)}),y.onClose(()=>{const d=this.current;this.current=null,this.destroy(),d?.onError(new Error("socket hang up"))})}arm(y){const d=new Te(S=>{const A=S.headers.connection,u=String(Array.isArray(A)?A.join(","):A??"").toLowerCase();this.keepAlive=!u.includes("close")&&!(S.version==="1.0"&&!u.includes("keep-alive")),this.current?.onHead(S)},S=>this.current?.onData(S),()=>{const S=this.current;this.current=null;const A=d.rest();this.keepAlive&&!this.socket.destroyed?w.release(this,A):this.destroy(),S?.onEnd()});this.reader=d,y.length>0&&d.push(y)}send(y,d){this.current=y,d()}destroy(){this.destroyed||(this.destroyed=!0,this.socket.destroy())}}const w={idle:new Map,release(_,y){const d=_.socket.remotePort,S=this.idle.get(d)??[];S.push({conn:_,leftover:y}),this.idle.set(d,S)}};function b(_){const y=w.idle.get(_);for(;y&&y.length>0;){const d=y.pop(),S=d.conn;if(!(S.destroyed||S.socket.destroyed||S.socket.readableEnded))return S.arm(d.leftover),S}return new l(r.binding.network.dial(_))}class v extends n{method;path;host;port;headers;aborted=!1;finished=!1;reusedSocket=!1;#e=null;#n=null;#t=!0;#r=[];#o;#s=null;constructor(y,d){super();const S=P(y);this.method=(S.method??"GET").toUpperCase(),this.path=S.path??"/",this.host=S.hostname??S.host??"127.0.0.1",this.port=Number(S.port??80),this.headers={...S.headers??{}},this.#o=d}setHeader(y,d){return this.headers[y.toLowerCase()]=d,this}getHeader(y){return this.headers[y.toLowerCase()]}removeHeader(y){delete this.headers[y.toLowerCase()]}_write(y,d,S){this.#r.push(h(y)),S(null)}_final(y){this.finished=!0,r.binding.nextTick(()=>{this.#i(),y(null)})}#i(){let y;try{y=b(this.port)}catch(f){this.emit("error",f);return}this.#n=y,this.#e=y.socket;const d=g(this.#r),S=[`${this.method} ${this.path} HTTP/1.1`],A=new Map(Object.entries(this.headers).map(([f,E])=>[f.toLowerCase(),E]));A.has("host")||A.set("host",`${this.host}:${this.port}`);const u=String(A.get("connection")??"").toLowerCase();this.#t=!u.includes("close"),A.has("connection")||A.set("connection","keep-alive"),A.set("content-length",String(d.byteLength));for(const[f,E]of A){const R=f.replace(/(^|-)([a-z])/g,(x,O,k)=>`${O}${k.toUpperCase()}`);if(Array.isArray(E))for(const x of E)S.push(`${R}: ${x}`);else S.push(`${R}: ${E}`)}S.push("",""),y.send({onHead:f=>{const E=new p;E._setup(f,y.socket),E.req=this,E.socket=y.socket,this.#s=E,this.#o&&this.#o(E),this.emit("response",E)},onData:f=>this.#s?._pushBody(f),onEnd:()=>this.#s?._end(),onError:f=>this.emit("error",f)},()=>{y.socket.write(new TextEncoder().encode(S.join(`\r
`))),d.byteLength&&y.socket.write(d),this.#t||y.socket.end()})}abort(){this.aborted=!0,this.#e?.destroy(),this.emit("abort")}_destroy(y,d){this.abort(),d(y)}setTimeout(){return this}}function P(_){if(typeof _=="string"){const y=new URL(_);return{protocol:y.protocol,hostname:y.hostname,port:y.port||(y.protocol==="https:"?443:80),path:y.pathname+y.search}}return _}function C(_,y){const d=new v(_,y);return typeof _!="string"&&typeof _.method=="string"&&(d.method=_.method.toUpperCase()),d}function T(_,y){const d=C(_,y);return d.method="GET",r.binding.nextTick(()=>d.end()),d}return{Server:m,ServerResponse:a,IncomingMessage:p,ClientRequest:v,STATUS_CODES:Oe,METHODS:["ACL","BIND","CHECKOUT","CONNECT","COPY","DELETE","GET","HEAD","LINK","LOCK","M-SEARCH","MERGE","MKACTIVITY","MKCALENDAR","MKCOL","MOVE","NOTIFY","OPTIONS","PATCH","POST","PROPFIND","PROPPATCH","PURGE","PUT","REBIND","REPORT","SEARCH","SOURCE","SUBSCRIBE","TRACE","UNBIND","UNLINK","UNLOCK","UNSUBSCRIBE"],createServer:c,request:C,get:T,default:{Server:m,createServer:c,request:C,get:T},_stream:(_,y,d)=>{const S=new v({hostname:"127.0.0.1",port:_,path:y.path??"/",method:y.method??"GET",headers:y.headers??{}});S.on("error",A=>d.onError(A)),S.on("response",A=>{d.onHead({status:A.statusCode,statusMessage:A.statusMessage,headers:A.headers}),A.on("data",u=>d.onData(h(u))),A.on("end",()=>d.onEnd())}),y.body&&S.write(y.body),S.end()},_request:(_,y)=>new Promise((d,S)=>{const A=[];let u=null;r.require("http")._stream(_,y,{onHead:E=>{u=E},onData:E=>A.push(E),onEnd:()=>d({...u,body:g(A)}),onError:S})})}}},Mn={id:"https",aliases:["node:https"],origin:"web-node",deps:["http"],init:r=>{const e=r.require("http"),t=e.createServer,o=e.request,n=e.get;return{...e,Agent:e.Agent,globalAgent:e.globalAgent,createServer:t,request:o,get:n,default:{createServer:t,request:o,get:n}}}},Ye=16*1024,Je=16;function ne(r,e){return e?1:typeof r=="string"?new TextEncoder().encode(r).byteLength:r instanceof Uint8Array||ArrayBuffer.isView(r)||r instanceof ArrayBuffer?r.byteLength:1}function ie(r){if(typeof r=="string")return new TextEncoder().encode(r);if(r instanceof Uint8Array)return r;if(ArrayBuffer.isView(r)){const e=r;return new Uint8Array(e.buffer,e.byteOffset,e.byteLength)}if(r instanceof ArrayBuffer)return new Uint8Array(r);throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer, ArrayBuffer, or Array')}const Xe=new WeakMap;function H(r){const e=Xe.get(r);if(!e)throw new Error("[web-node] writable state missing; call super() first");return e}function ke(r,e={}){const t=!!e.objectMode;Xe.set(r,{buffer:[],length:0,writing:!1,ending:!1,ended:!1,finished:!1,needDrain:!1,corked:0,hwm:typeof e.highWaterMark=="number"?e.highWaterMark:t?Je:Ye,objectMode:t,decodeStrings:e.decodeStrings!==!1,destroyed:!1,error:null})}const Ln={id:"stream",aliases:["node:stream"],origin:"web-node",deps:["events"],init:r=>{const{EventEmitter:e}=r.require("events"),{Buffer:t}=r.require("buffer"),o=y=>r.binding.nextTick(y);class n extends e{readable=!0;#e=[];#n=0;#t;#r;#o=!1;#s=!1;#i=!1;#a=!1;#l=!1;#c=!1;#p=null;#f=[];constructor(d={}){super(),this.#r=!!d.objectMode,this.#t=typeof d.highWaterMark=="number"?d.highWaterMark:this.#r?Je:Ye,typeof d.read=="function"&&(this._read=d.read.bind(this)),typeof d.encoding=="string"&&(this.#p=d.encoding),typeof d.destroy=="function"&&(this._destroy=d.destroy.bind(this))}_read(d){}_destroy(d,S){S(d)}get readableHighWaterMark(){return this.#t}get readableLength(){return this.#n}get readableEnded(){return this.#s}get readableFlowing(){return this.#i&&!this.#a?!0:this.#a?!1:null}get destroyed(){return this.#c}#h(){return this.#i&&!this.#a&&!this.#c}#d(d){return this.#r||this.#p===null||typeof d=="string"?d:new TextDecoder(this.#p==="utf8"?"utf-8":this.#p).decode(ie(d))}#g(){if(!(this.#l||this.#o||this.#c)){this.#l=!0;try{this._read(this.#t-this.#n)}catch(d){this.destroy(d)}}}#u(){for(;this.#e.length>0&&this.#h();){const d=this.#e.shift();this.#n-=ne(d,this.#r),this.emit("data",this.#d(d))}this.#h()&&!this.#o&&this.#n<this.#t&&this.#g(),this.#o&&this.#e.length===0&&!this.#s&&this.#h()&&(this.#s=!0,o(()=>{this.emit("end"),this.emit("close")}))}push(d){if(this.#c)return!1;if(d===null)return this.#o=!0,this.#l=!1,this.#u(),!1;if(this.#o)throw new Error("stream.push() after EOF");return this.#e.push(d),this.#n+=ne(d,this.#r),this.#l=!1,this.#u(),this.#n<this.#t}unshift(d){if(this.#o)throw new Error("stream.unshift() after EOF");this.#e.unshift(d),this.#n+=ne(d,this.#r)}on(d,S){return super.on(d,S),d==="data"&&(this.#i=!0,this.#a=!1,this.#u()),this}addListener(d,S){return this.on(d,S)}once(d,S){return super.once(d,S),d==="data"&&(this.#i=!0,this.#a=!1,this.#u()),this}pause(){return this.#a=!0,this}isPaused(){return this.#a}resume(){return this.#a=!1,this.#i=!0,this.#u(),this}setEncoding(d){return this.#p=d,this}read(d){if(this.#c||this.#e.length===0&&(this.#o||this.#g(),this.#e.length===0))return null;if(this.#r){const f=this.#e.shift();return this.#n-=1,f}if(d===void 0||Number.isNaN(d)){const f=this.#e;return this.#e=[],this.#n=0,this.#d(s(f))}const S=Math.max(0,Math.floor(d));if(S===0)return this.#d(new Uint8Array(0));const A=[];let u=0;for(;this.#e.length>0&&u<S;){const f=ie(this.#e[0]),E=Math.min(f.byteLength,S-u);A.push(E===f.byteLength?f:f.slice(0,E)),u+=E,E===f.byteLength?this.#e.shift():this.#e[0]=f.subarray(E),this.#n-=E}return this.#d(s(A))}pipe(d,S){this.#f.push(d);const A=R=>{d.write(R)===!1&&(this.pause(),d.once("drain",()=>this.resume()))},u=()=>{this.removeListener("data",A),this.removeListener("end",f),this.removeListener("error",E)},f=()=>{u(),S?.end!==!1&&typeof d.end=="function"&&d.end()},E=R=>{u();const x=d;typeof x.destroy=="function"&&x.destroy(R)};return this.once("end",f),this.once("error",E),d.emit("pipe",this),this.#i=!0,this.#a=!1,this.on("data",A),this.#u(),d}unpipe(d){return d?this.#f=this.#f.filter(S=>S!==d):this.#f=[],this}destroy(d){if(this.#c)return this;this.#c=!0,this.#i=!1;const S=A=>{const u=d??A??null;o(()=>{u&&this.emit("error",u),this.emit("close")})};try{this._destroy(d??null,S)}catch(A){S(A)}return this}[Symbol.asyncIterator](){const d=[];let S=!1,A=null;const u=E=>{if(A){const R=A;A=null,R({value:E,done:!1})}else d.push(E)},f=()=>{if(S=!0,A){const E=A;A=null,E({value:void 0,done:!0})}};return this.on("data",u),this.once("end",f),{next:()=>d.length>0?Promise.resolve({value:d.shift(),done:!1}):S?Promise.resolve({value:void 0,done:!0}):new Promise(E=>{A=E}),return:()=>(f(),Promise.resolve({value:void 0,done:!0})),[Symbol.asyncIterator](){return this}}}static from(d,S){const A={objectMode:!0,...S??{}},u=new n(A),f=i(d);let E=!1;return u._read=()=>{if(E)return;let R;try{R=f.next()}catch(x){E=!0,u.destroy(x);return}Promise.resolve(R).then(x=>{if(x.done){E=!0,u.push(null);return}u.push(x.value)},x=>{E=!0,u.destroy(x)})},u}}function s(y){let d=0;for(const u of y){const f=ie(u);d+=f.byteLength}const S=new Uint8Array(d);let A=0;for(const u of y){const f=ie(u);S.set(f,A),A+=f.byteLength}return S}function i(y){const d=y;if(d&&typeof d[Symbol.asyncIterator]=="function")return d[Symbol.asyncIterator]();if(d&&typeof d[Symbol.iterator]=="function")return d[Symbol.iterator]();throw new TypeError("Readable.from() expects an iterable or async iterable")}class h extends e{writable=!0;constructor(d={}){super(),ke(this,d),typeof d.write=="function"&&(this._write=d.write.bind(this)),typeof d.final=="function"&&(this._final=d.final.bind(this)),typeof d.destroy=="function"&&(this._destroy=d.destroy.bind(this))}_write(d,S,A){A(new Error("[web-node] _write() is not implemented"))}_final(d){d()}_destroy(d,S){S(d)}get writableEnded(){return H(this).ended}get writableFinished(){return H(this).finished}get writableLength(){return H(this).length}get writableHighWaterMark(){return H(this).hwm}get destroyed(){return H(this).destroyed}get writableNeedDrain(){return H(this).needDrain}write(d,S,A){const u=H(this);if(typeof S=="function"&&(A=S,S=void 0),u.ending||u.ended){const R=Object.assign(new Error("write after end"),{code:"ERR_STREAM_WRITE_AFTER_END"});return typeof A=="function"&&o(()=>A(R)),this.destroy(R),!1}const f=u.decodeStrings&&typeof d=="string"?t.from(d,typeof S=="string"?S:"utf8"):d;u.buffer.push({chunk:f,cb:typeof A=="function"?A:void 0}),u.length+=ne(f,u.objectMode),!u.writing&&u.corked===0&&p(this);const E=u.length<u.hwm;return E||(u.needDrain=!0),E}end(d,S,A){const u=H(this);return typeof d=="function"?(A=d,d=void 0):typeof S=="function"&&(A=S,S=void 0),typeof A=="function"&&this.once("finish",A),d!==void 0&&this.write(d,S),u.ending=!0,p(this),this}cork(){H(this).corked++}uncork(){const d=H(this);d.corked>0&&d.corked--,d.corked===0&&p(this)}setDefaultEncoding(d){return this}destroy(d){const S=H(this);if(S.destroyed)return this;S.destroyed=!0,S.buffer=[],S.length=0;const A=u=>{const f=d??u??null;o(()=>{f&&this.emit("error",f),this.emit("close")})};try{this._destroy(d??null,A)}catch(u){A(u)}return this}}function p(y){const d=H(y);if(d.writing||d.destroyed||d.corked>0)return;const S=d.buffer.shift();if(!S){g(y);return}d.length-=ne(S.chunk,d.objectMode),d.writing=!0;let A=!1;const u=f=>{if(!A){if(A=!0,d.writing=!1,f){d.error=f,S.cb&&S.cb(f),y.destroy(f);return}S.cb&&S.cb(null),p(y)}};try{y._write(S.chunk,"buffer",u)}catch(f){u(f)}}function g(y){const d=H(y);if(!(d.buffer.length>0||d.writing)&&(d.needDrain&&(d.needDrain=!1,o(()=>y.emit("drain"))),d.ending&&!d.finished)){d.finished=!0;let S=!1;const A=u=>{if(!S){if(S=!0,u){y.destroy(u);return}d.ended=!0,o(()=>{y.emit("finish"),y.emit("close")})}};try{y._final(A)}catch(u){A(u)}}}class a extends n{constructor(d={}){super(d),ke(this,d);const S=this;typeof d.write=="function"&&(S._write=d.write.bind(this)),typeof d.final=="function"&&(S._final=d.final.bind(this)),typeof d.read=="function"&&(S._read=d.read.bind(this))}_write(d,S,A){A(new Error("[web-node] _write() is not implemented"))}_final(d){d()}}function m(y){for(const d of Object.getOwnPropertyNames(h.prototype))d==="constructor"||d.startsWith("_")||d==="destroy"||d in y.prototype||Object.defineProperty(y.prototype,d,Object.getOwnPropertyDescriptor(h.prototype,d));Object.defineProperty(y.prototype,"destroy",{configurable:!0,writable:!0,value:function(S){const A=H(this);return A.destroyed=!0,A.buffer=[],A.length=0,n.prototype.destroy.call(this,S)}})}m(a);class c extends a{constructor(d={}){super(d);const S=this;typeof d.transform=="function"&&(S._transform=d.transform.bind(this)),typeof d.flush=="function"&&(S._flush=d.flush.bind(this))}_transform(d,S,A){A(new Error("[web-node] _transform() is not implemented"))}_flush(d){d()}_read(){}_write(d,S,A){let u=!1;this._transform(d,S,(f,E)=>{if(!u){if(u=!0,f){A(f);return}E!=null&&this.push(E),A()}})}_final(d){this._flush((S,A)=>{if(S){d(S);return}A!=null&&this.push(A),this.push(null),d()})}}class l extends c{_transform(d,S,A){A(null,d)}}function w(y,d){let S=!1;const A=u=>{S||(S=!0,d&&d(u??null))};return y.on("error",A),y.on("end",()=>A(null)),y.on("finish",()=>A(null)),y.on("close",()=>A(null)),d?()=>{}:new Promise((u,f)=>{y.on("error",E=>f(E)),y.on("end",()=>u()),y.on("finish",()=>u()),y.on("close",()=>u())})}function b(...y){let d;typeof y[y.length-1]=="function"&&(d=y.pop());const S=y;if(S.length<2)throw new TypeError("pipeline() requires at least two streams");let A=!1;const u=R=>{A||(A=!0,d&&d(R??null))};for(let R=0;R<S.length-1;R++){const x=S[R],O=S[R+1];x.on("error",k=>{typeof O.destroy=="function"&&O.destroy(k),u(k)}),x.pipe(O)}const f=S[S.length-1];return f.on("error",R=>u(R)),w(f).then(()=>u(null),R=>u(R)),f}const v={pipeline:(...y)=>{const d=y;return new Promise((S,A)=>{b(...d,u=>u?A(u):S())})},finished:y=>w(y)};function P(){throw new Error("[web-node] stream.addAbortSignal is not implemented")}function C(){throw new Error("[web-node] stream.compose is not implemented")}function T(y){return typeof y?.read=="function"}function _(y){return typeof y?.write=="function"}return{Stream:n,Readable:n,Writable:h,Duplex:a,Transform:c,PassThrough:l,pipeline:b,finished:w,addAbortSignal:P,compose:C,isReadable:T,isWritable:_,promises:v,default:{Readable:n,Writable:h,Duplex:a,Transform:c,PassThrough:l,pipeline:b,finished:w},_base:{Readable:n,Writable:h,Duplex:a,Transform:c,PassThrough:l}}}},Un={id:"stream/promises",aliases:["node:stream/promises"],origin:"web-node",deps:["stream"],init:r=>{const e=r.require("stream");return{...e.promises,default:e.promises}}},Ze=[Wt,qt,Vt,Gt,...zt,Xt,Zt,wn,En,vn,An,Pn,_n,Rn,xn,Cn,Ln,Un,Qt,en,tn,pn,hn,yn,gn,...Sn,jn,Mn],Ie=Ze.filter(r=>!r.id.startsWith("internal/")).map(r=>r.id);var Fn=`'use strict';

const isWindows = process.platform === 'win32';

module.exports = {
  // Alphabet chars.
  CHAR_UPPERCASE_A: 65, /* A */
  CHAR_LOWERCASE_A: 97, /* a */
  CHAR_UPPERCASE_Z: 90, /* Z */
  CHAR_LOWERCASE_Z: 122, /* z */
  CHAR_UPPERCASE_C: 67, /* C */
  CHAR_UPPERCASE_B: 66, /* B */
  CHAR_LOWERCASE_B: 98, /* b */
  CHAR_UPPERCASE_E: 69, /* E */
  CHAR_LOWERCASE_E: 101, /* e */
  CHAR_LOWERCASE_N: 110, /* n */

  // Non-alphabetic chars.
  CHAR_DOT: 46, /* . */
  CHAR_FORWARD_SLASH: 47, /* / */
  CHAR_BACKWARD_SLASH: 92, /* \\ */
  CHAR_VERTICAL_LINE: 124, /* | */
  CHAR_COLON: 58, /* : */
  CHAR_QUESTION_MARK: 63, /* ? */
  CHAR_UNDERSCORE: 95, /* _ */
  CHAR_LINE_FEED: 10, /* \\n */
  CHAR_CARRIAGE_RETURN: 13, /* \\r */
  CHAR_TAB: 9, /* \\t */
  CHAR_FORM_FEED: 12, /* \\f */
  CHAR_EXCLAMATION_MARK: 33, /* ! */
  CHAR_HASH: 35, /* # */
  CHAR_SPACE: 32, /*   */
  CHAR_NO_BREAK_SPACE: 160, /* \\u00A0 */
  CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279, /* \\uFEFF */
  CHAR_LEFT_SQUARE_BRACKET: 91, /* [ */
  CHAR_RIGHT_SQUARE_BRACKET: 93, /* ] */
  CHAR_LEFT_ANGLE_BRACKET: 60, /* < */
  CHAR_RIGHT_ANGLE_BRACKET: 62, /* > */
  CHAR_LEFT_CURLY_BRACKET: 123, /* { */
  CHAR_RIGHT_CURLY_BRACKET: 125, /* } */
  CHAR_HYPHEN_MINUS: 45, /* - */
  CHAR_PLUS: 43, /* + */
  CHAR_DOUBLE_QUOTE: 34, /* " */
  CHAR_SINGLE_QUOTE: 39, /* ' */
  CHAR_PERCENT: 37, /* % */
  CHAR_SEMICOLON: 59, /* ; */
  CHAR_CIRCUMFLEX_ACCENT: 94, /* ^ */
  CHAR_GRAVE_ACCENT: 96, /* \` */
  CHAR_AT: 64, /* @ */
  CHAR_AMPERSAND: 38, /* & */
  CHAR_EQUAL: 61, /* = */

  // Digits
  CHAR_0: 48, /* 0 */
  CHAR_9: 57, /* 9 */

  EOL: isWindows ? '\\r\\n' : '\\n',
};
`,Hn=`// From https://npmjs.com/package/@exodus/bytes
// Copyright Exodus Movement. Licensed under MIT License.

'use strict';

const {
  Uint8Array,
} = primordials;


/**
 * Get a number of last bytes in an Uint8Array \`data\` ending at \`len\` that don't
 * form a codepoint yet, but can be a part of a single codepoint on more data.
 * @param {Uint8Array} data Uint8Array of potentially UTF-8 bytes
 * @param {number} len Position to look behind from
 * @returns {number} Number of unfinished potentially valid UTF-8 bytes ending at position \`len\`
 */
function unfinishedBytesUtf8(data, len) {
  // 0-3
  let pos = 0;
  while (pos < 2 && pos < len && (data[len - pos - 1] & 0xc0) === 0x80) pos++; // Go back 0-2 trailing bytes
  if (pos === len) return 0; // no space for lead
  const lead = data[len - pos - 1];
  if (lead < 0xc2 || lead > 0xf4) return 0; // not a lead
  if (pos === 0) return 1; // Nothing to recheck, we have only lead, return it. 2-byte must return here
  if (lead < 0xe0 || (lead < 0xf0 && pos >= 2)) return 0; // 2-byte, or 3-byte or less and we already have 2 trailing
  const lower = lead === 0xf0 ? 0x90 : lead === 0xe0 ? 0xa0 : 0x80;
  const upper = lead === 0xf4 ? 0x8f : lead === 0xed ? 0x9f : 0xbf;
  const next = data[len - pos];
  return next >= lower && next <= upper ? pos + 1 : 0;
}

/**
 * Merge prefix \`chunk\` with \`data\` and return new combined prefix.
 * For data.length < 3, fully consumes data and can return unfinished data,
 * otherwise returns a prefix with no unfinished bytes
 * @param {Uint8Array} data Uint8Array of potentially UTF-8 bytes
 * @param {Uint8Array} chunk Prefix to prepend before \`data\`
 * @returns {Uint8Array} If data.length >= 3: an Uint8Array containing \`chunk\` and a slice of \`data\`
 *   so that the result has no unfinished UTF-8 codepoints. If data.length < 3: concat(chunk, data).
 */
function mergePrefixUtf8(data, chunk) {
  if (data.length === 0) return chunk;
  if (data.length < 3) {
    // No reason to bruteforce offsets, also it's possible this doesn't yet end the sequence
    const res = new Uint8Array(data.length + chunk.length);
    res.set(chunk);
    res.set(data, chunk.length);
    return res;
  }

  // Slice off a small portion of data into prefix chunk so we can decode them separately without extending array size
  const temp = new Uint8Array(chunk.length + 3); // We have 1-3 bytes and need 1-3 more bytes
  temp.set(chunk);
  temp.set(data.subarray(0, 3), chunk.length);

  // Stop at the first offset where unfinished bytes reaches 0 or fits into data
  // If that doesn't happen (data too short), just concat chunk and data completely (above)
  for (let i = 1; i <= 3; i++) {
    const unfinished = unfinishedBytesUtf8(temp, chunk.length + i); // 0-3
    if (unfinished <= i) {
      // Always reachable at 3, but we still need 'unfinished' value for it
      const add = i - unfinished; // 0-3
      return add > 0 ? temp.subarray(0, chunk.length + add) : chunk;
    }
  }

  // Unreachable
  return null;
}

module.exports = { unfinishedBytesUtf8, mergePrefixUtf8 };
`,$n=`'use strict';

const {
  Error,
  ErrorPrototype,
  NumberIsFinite,
  NumberIsNaN,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectSetPrototypeOf,
  RangeError,
  SafeMap,
  SafeSet,
  SafeWeakMap,
  SymbolToStringTag,
  TypeError,
} = primordials;
const {
  transfer_mode_private_symbol,
} = privateSymbols;
const {
  messaging_clone_symbol,
  messaging_deserialize_symbol,
} = perIsolateSymbols;

/**
 * Maps to BaseObject::TransferMode::kCloneable
 */
const kCloneable = 2;

function throwInvalidThisError(Base, type) {
  const err = new Base();
  const key = 'ERR_INVALID_THIS';
  ObjectDefineProperties(err, {
    message: {
      __proto__: null,
      value: \`Value of "this" must be of \${type}\`,
      enumerable: false,
      writable: true,
      configurable: true,
    },
    toString: {
      __proto__: null,
      value: function toString() {
        return \`\${this.name} [\${key}]: \${this.message}\`;
      },
      enumerable: false,
      writable: true,
      configurable: true,
    },
  });
  err.code = key;
  throw err;
}

const internalsMap = new SafeWeakMap();
const nameToCodeMap = new SafeMap();

// These were removed from the error names table.
// See https://github.com/heycam/webidl/pull/946.
const disusedNamesSet = new SafeSet()
  .add('DOMStringSizeError')
  .add('NoDataAllowedError')
  .add('ValidationError');

// The DOMException WebIDL interface defines that:
// - ObjectGetPrototypeOf(DOMException) === Function.
// - ObjectGetPrototypeOf(DOMException.prototype) === Error.prototype.
// Thus, we can not simply use the pattern of \`class DOMException extends Error\` and call
// \`super()\` to construct an object. The \`super\` in \`super()\` call in the constructor will
// be resolved to \`Function\`, instead of \`Error\`. Use the trick of return overriding to
// create an object with the \`[[ErrorData]]\` internal slot.
// Ref: https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-getsuperconstructor
class DOMException {
  constructor(message = '', options = 'Error') {
    // Invokes the Error constructor to create an object with the [[ErrorData]]
    // internal slot.
    // eslint-disable-next-line no-restricted-syntax
    const self = new Error();
    // Use \`new.target.prototype\` to support DOMException subclasses.
    ObjectSetPrototypeOf(self, new.target.prototype);
    self[transfer_mode_private_symbol] = kCloneable;

    if (options && typeof options === 'object') {
      const { name } = options;
      internalsMap.set(self, {
        message: \`\${message}\`,
        name: \`\${name}\`,
      });

      if ('cause' in options) {
        ObjectDefineProperty(self, 'cause', {
          __proto__: null,
          value: options.cause,
          configurable: true,
          writable: true,
          enumerable: false,
        });
      }
    } else {
      internalsMap.set(self, {
        message: \`\${message}\`,
        name: \`\${options}\`,
      });
    }
    // Return the error object as the return overriding of the constructor.
    // eslint-disable-next-line no-constructor-return
    return self;
  }

  [messaging_clone_symbol]() {
    // See serialization steps in https://webidl.spec.whatwg.org/#dom-domexception-domexception
    const internals = internalsMap.get(this);
    return {
      data: {
        message: internals.message,
        name: internals.name,
        stack: this.stack,
      },
      deserializeInfo: 'internal/worker/clone_dom_exception:DOMException',
    };
  }

  [messaging_deserialize_symbol](data) {
    // See deserialization steps in https://webidl.spec.whatwg.org/#dom-domexception-domexception
    internalsMap.set(this, {
      message: data.message,
      name: data.name,
    });
    this.stack = data.stack;
  }

  get name() {
    const internals = internalsMap.get(this);
    if (internals === undefined) {
      throwInvalidThisError(TypeError, 'DOMException');
    }
    return internals.name;
  }

  get message() {
    const internals = internalsMap.get(this);
    if (internals === undefined) {
      throwInvalidThisError(TypeError, 'DOMException');
    }
    return internals.message;
  }

  get code() {
    const internals = internalsMap.get(this);
    if (internals === undefined) {
      throwInvalidThisError(TypeError, 'DOMException');
    }

    if (disusedNamesSet.has(internals.name)) {
      return 0;
    }

    const code = nameToCodeMap.get(internals.name);
    return code === undefined ? 0 : code;
  }
}

const DOMExceptionPrototype = DOMException.prototype;
ObjectSetPrototypeOf(DOMExceptionPrototype, ErrorPrototype);
ObjectDefineProperties(DOMExceptionPrototype, {
  [SymbolToStringTag]: { __proto__: null, configurable: true, value: 'DOMException' },
  name: { __proto__: null, enumerable: true, configurable: true },
  message: { __proto__: null, enumerable: true, configurable: true },
  code: { __proto__: null, enumerable: true, configurable: true },
});

for (const { 0: name, 1: codeName, 2: value } of [
  ['IndexSizeError', 'INDEX_SIZE_ERR', 1],
  ['DOMStringSizeError', 'DOMSTRING_SIZE_ERR', 2],
  ['HierarchyRequestError', 'HIERARCHY_REQUEST_ERR', 3],
  ['WrongDocumentError', 'WRONG_DOCUMENT_ERR', 4],
  ['InvalidCharacterError', 'INVALID_CHARACTER_ERR', 5],
  ['NoDataAllowedError', 'NO_DATA_ALLOWED_ERR', 6],
  ['NoModificationAllowedError', 'NO_MODIFICATION_ALLOWED_ERR', 7],
  ['NotFoundError', 'NOT_FOUND_ERR', 8],
  ['NotSupportedError', 'NOT_SUPPORTED_ERR', 9],
  ['InUseAttributeError', 'INUSE_ATTRIBUTE_ERR', 10],
  ['InvalidStateError', 'INVALID_STATE_ERR', 11],
  ['SyntaxError', 'SYNTAX_ERR', 12],
  ['InvalidModificationError', 'INVALID_MODIFICATION_ERR', 13],
  ['NamespaceError', 'NAMESPACE_ERR', 14],
  ['InvalidAccessError', 'INVALID_ACCESS_ERR', 15],
  ['ValidationError', 'VALIDATION_ERR', 16],
  ['TypeMismatchError', 'TYPE_MISMATCH_ERR', 17],
  ['SecurityError', 'SECURITY_ERR', 18],
  ['NetworkError', 'NETWORK_ERR', 19],
  ['AbortError', 'ABORT_ERR', 20],
  ['URLMismatchError', 'URL_MISMATCH_ERR', 21],
  ['QuotaExceededError', 'QUOTA_EXCEEDED_ERR', 22],
  ['TimeoutError', 'TIMEOUT_ERR', 23],
  ['InvalidNodeTypeError', 'INVALID_NODE_TYPE_ERR', 24],
  ['DataCloneError', 'DATA_CLONE_ERR', 25],
  // There are some more error names, but since they don't have codes assigned,
  // we don't need to care about them.
]) {
  const desc = { __proto__: null, enumerable: true, value };
  ObjectDefineProperty(DOMException, codeName, desc);
  ObjectDefineProperty(DOMExceptionPrototype, codeName, desc);
  nameToCodeMap.set(name, value);
}

exports.DOMException = DOMException;

// https://webidl.spec.whatwg.org/#quotaexceedederror
class QuotaExceededError extends DOMException {
  #quota;
  #requested;

  constructor(message = '', options = { __proto__: null }) {
    super(message, 'QuotaExceededError');
    this[transfer_mode_private_symbol] = kCloneable;

    let quota = null;
    let requested = null;

    if (options !== null && options !== undefined) {
      if ('quota' in options) {
        quota = +options.quota;
        if (!NumberIsFinite(quota)) {
          // eslint-disable-next-line no-restricted-syntax
          throw new TypeError(
            \`Cannot convert options.quota to a double: the value is \${NumberIsNaN(quota) ? 'NaN' : 'Infinity'}\`,
          );
        }
        if (quota < 0) {
          // eslint-disable-next-line no-restricted-syntax
          throw new RangeError('options.quota must not be negative');
        }
      }

      if ('requested' in options) {
        requested = +options.requested;
        if (!NumberIsFinite(requested)) {
          // eslint-disable-next-line no-restricted-syntax
          throw new TypeError(
            \`Cannot convert options.requested to a double: the value is \${NumberIsNaN(requested) ? 'NaN' : 'Infinity'}\`,
          );
        }
        if (requested < 0) {
          // eslint-disable-next-line no-restricted-syntax
          throw new RangeError('options.requested must not be negative');
        }
      }
    }

    if (quota !== null && requested !== null && requested < quota) {
      // eslint-disable-next-line no-restricted-syntax
      throw new RangeError('options.requested must not be less than options.quota');
    }

    this.#quota = quota;
    this.#requested = requested;
  }

  [messaging_clone_symbol]() {
    const domExceptionClone = DOMExceptionPrototype[messaging_clone_symbol].call(this);
    domExceptionClone.data.quota = this.#quota;
    domExceptionClone.data.requested = this.#requested;
    domExceptionClone.deserializeInfo = 'internal/worker/clone_dom_exception:QuotaExceededError';
    return domExceptionClone;
  }

  [messaging_deserialize_symbol](data) {
    DOMExceptionPrototype[messaging_deserialize_symbol].call(this, data);
    this.#quota = data.quota;
    this.#requested = data.requested;
  }

  get quota() {
    if (!(#quota in this)) {
      throwInvalidThisError(TypeError, 'QuotaExceededError');
    }
    return this.#quota;
  }

  get requested() {
    if (!(#requested in this)) {
      throwInvalidThisError(TypeError, 'QuotaExceededError');
    }
    return this.#requested;
  }
}

ObjectDefineProperties(QuotaExceededError.prototype, {
  [SymbolToStringTag]: { __proto__: null, configurable: true, value: 'QuotaExceededError' },
  quota: { __proto__: null, enumerable: true, configurable: true },
  requested: { __proto__: null, enumerable: true, configurable: true },
});

exports.QuotaExceededError = QuotaExceededError;
`,Bn=`'use strict';
const {
  SymbolFor,
} = primordials;

class MessageEvent {
  constructor(data, target, type, ports) {
    this.data = data;
    this.target = target;
    this.type = type;
    this.ports = ports ?? [];
  }
}

const kHybridDispatch = SymbolFor('nodejs.internal.kHybridDispatch');
const kCurrentlyReceivingPorts =
  SymbolFor('nodejs.internal.kCurrentlyReceivingPorts');

exports.emitMessage = function(data, ports, type) {
  if (typeof this[kHybridDispatch] === 'function') {
    this[kCurrentlyReceivingPorts] = ports;
    try {
      this[kHybridDispatch](data, type, undefined);
    } finally {
      this[kCurrentlyReceivingPorts] = undefined;
    }
    return;
  }

  const event = new MessageEvent(data, this, type, ports);
  if (type === 'message') {
    if (typeof this.onmessage === 'function')
      this.onmessage(event);
  } else {
    // eslint-disable-next-line no-lonely-if
    if (typeof this.onmessageerror === 'function')
      this.onmessageerror(event);
  }
};
`,Wn=`'use strict';

/* eslint-disable node-core/prefer-primordials */

// This file subclasses and stores the JS builtins that come from the VM
// so that Node.js's builtin modules do not need to later look these up from
// the global proxy, which can be mutated by users.

// Use of primordials have sometimes a dramatic impact on performance, please
// benchmark all changes made in performance-sensitive areas of the codebase.
// See: https://github.com/nodejs/node/pull/38248

const {
  defineProperty: ReflectDefineProperty,
  getOwnPropertyDescriptor: ReflectGetOwnPropertyDescriptor,
  ownKeys: ReflectOwnKeys,
} = Reflect;

// \`uncurryThis\` is equivalent to \`func => Function.prototype.call.bind(func)\`.
// It is using \`bind.bind(call)\` to avoid using \`Function.prototype.bind\`
// and \`Function.prototype.call\` after it may have been mutated by users.
const { apply, bind, call } = Function.prototype;
const uncurryThis = bind.bind(call);
primordials.uncurryThis = uncurryThis;

// \`applyBind\` is equivalent to \`func => Function.prototype.apply.bind(func)\`.
// It is using \`bind.bind(apply)\` to avoid using \`Function.prototype.bind\`
// and \`Function.prototype.apply\` after it may have been mutated by users.
const applyBind = bind.bind(apply);
primordials.applyBind = applyBind;

// Methods that accept a variable number of arguments, and thus it's useful to
// also create \`\${prefix}\${key}Apply\`, which uses \`Function.prototype.apply\`,
// instead of \`Function.prototype.call\`, and thus doesn't require iterator
// destructuring.
const varargsMethods = [
  // 'ArrayPrototypeConcat' is omitted, because it performs the spread
  // on its own for arrays and array-likes with a truthy
  // @@isConcatSpreadable symbol property.
  'ArrayOf',
  'ArrayPrototypePush',
  'ArrayPrototypeUnshift',
  // 'FunctionPrototypeCall' is omitted, since there's 'ReflectApply'
  // and 'FunctionPrototypeApply'.
  'MathHypot',
  'MathMax',
  'MathMin',
  'StringFromCharCode',
  'StringFromCodePoint',
  'StringPrototypeConcat',
  'TypedArrayOf',
];

function getNewKey(key) {
  return typeof key === 'symbol' ?
    \`Symbol\${key.description[7].toUpperCase()}\${key.description.slice(8)}\` :
    \`\${key[0].toUpperCase()}\${key.slice(1)}\`;
}

function copyAccessor(dest, prefix, key, { enumerable, get, set }) {
  ReflectDefineProperty(dest, \`\${prefix}Get\${key}\`, {
    __proto__: null,
    value: uncurryThis(get),
    enumerable,
  });
  if (set !== undefined) {
    ReflectDefineProperty(dest, \`\${prefix}Set\${key}\`, {
      __proto__: null,
      value: uncurryThis(set),
      enumerable,
    });
  }
}

function copyPropsRenamed(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const name = \`\${prefix}\${newKey}\`;
      ReflectDefineProperty(dest, name, { __proto__: null, ...desc });
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, \`\${name}Apply\`, {
          __proto__: null,
          // \`src\` is bound as the \`this\` so that the static \`this\` points
          // to the object it was defined on,
          // e.g.: \`ArrayOfApply\` gets a \`this\` of \`Array\`:
          value: applyBind(desc.value, src),
        });
      }
    }
  }
}

function copyPropsRenamedBound(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const { value } = desc;
      if (typeof value === 'function') {
        desc.value = value.bind(src);
      }

      const name = \`\${prefix}\${newKey}\`;
      ReflectDefineProperty(dest, name, { __proto__: null, ...desc });
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, \`\${name}Apply\`, {
          __proto__: null,
          value: applyBind(value, src),
        });
      }
    }
  }
}

function copyPrototype(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const { value } = desc;
      if (typeof value === 'function') {
        desc.value = uncurryThis(value);
      }

      const name = \`\${prefix}\${newKey}\`;
      ReflectDefineProperty(dest, name, { __proto__: null, ...desc });
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, \`\${name}Apply\`, {
          __proto__: null,
          value: applyBind(value),
        });
      }
    }
  }
}

// Create copies of configurable value properties of the global object
[
  'Proxy',
  'globalThis',
].forEach((name) => {
  // eslint-disable-next-line no-restricted-globals
  primordials[name] = globalThis[name];
});

// Create copies of URI handling functions
[
  decodeURI,
  decodeURIComponent,
  encodeURI,
  encodeURIComponent,
].forEach((fn) => {
  primordials[fn.name] = fn;
});

// Create copies of legacy functions
[
  escape,
  eval,
  unescape,
].forEach((fn) => {
  primordials[fn.name] = fn;
});

// Create copies of the namespace objects
[
  'Atomics',
  'JSON',
  'Math',
  'Proxy',
  'Reflect',
].forEach((name) => {
  // eslint-disable-next-line no-restricted-globals
  // [web-node patch] skip intrinsics absent from the host engine
  if (globalThis[name] === undefined) return;
  copyPropsRenamed(globalThis[name], primordials, name);
});

// Create copies of intrinsic objects
[
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'FinalizationRegistry',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'Function',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Iterator',
  'Map',
  'Number',
  'Object',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakRef',
  'WeakSet',
].forEach((name) => {
  // eslint-disable-next-line no-restricted-globals
  // [web-node patch] skip intrinsics absent from the host engine
  const original = globalThis[name];
  if (original === undefined) return;
  primordials[name] = original;
  copyPropsRenamed(original, primordials, name);
  copyPrototype(original.prototype, primordials, \`\${name}Prototype\`);
});


// Create copies of intrinsic objects whose static methods require the
// constructor to be passed as the receiver.
[
  // Refs: https://tc39.es/ecma-262/#sec-promise.all
  'Promise',
].forEach((name) => {
  // eslint-disable-next-line no-restricted-globals
  // [web-node patch] skip intrinsics absent from the host engine
  const original = globalThis[name];
  if (original === undefined) return;
  primordials[name] = original;
  copyPropsRenamedBound(original, primordials, name);
  copyPrototype(original.prototype, primordials, \`\${name}Prototype\`);
});

// Create copies of abstract intrinsic objects that are not directly exposed
// on the global object, and whose static methods require a valid subclass
// constructor to be passed as the receiver.
[
  // Refs: https://tc39.es/ecma262/#sec-%typedarray%-intrinsic-object
  { name: 'TypedArray', original: Reflect.getPrototypeOf(Uint8Array) },
].forEach(({ name, original }) => {
  primordials[name] = original;
  copyPrototype(original, primordials, name);
  copyPrototype(original.prototype, primordials, \`\${name}Prototype\`);
});

// Create copies of abstract intrinsic prototypes that are not directly exposed
// on the global object and which do not have corresponding constructors.
[
  {
    name: 'ArrayIteratorPrototype',
    original: Reflect.getPrototypeOf(Array.prototype[Symbol.iterator]()),
  },
  {
    name: 'AsyncFunctionPrototype',
    original: Reflect.getPrototypeOf(async function() {}),
  },
  {
    name: 'AsyncGeneratorFunctionPrototype',
    original: Reflect.getPrototypeOf(async function*() {}),
  },
  {
    name: 'AsyncIteratorPrototype',
    original: Reflect.getPrototypeOf(Reflect.getPrototypeOf(async function*() {}).prototype),
  },
  {
    name: 'GeneratorFunctionPrototype',
    original: Reflect.getPrototypeOf(function*() {}),
  },
  {
    name: 'IteratorHelperPrototype',
    original: Reflect.getPrototypeOf(primordials.IteratorPrototypeDrop({ __proto__: null }, null)),
  },
  {
    name: 'MapIteratorPrototype',
    original: Reflect.getPrototypeOf(new primordials.Map()[Symbol.iterator]()),
  },
  {
    name: 'RegExpStringIteratorPrototype',
    original: Reflect.getPrototypeOf(primordials.RegExp.prototype[Symbol.matchAll]()),
  },
  {
    name: 'SetIteratorPrototype',
    original: Reflect.getPrototypeOf(new primordials.Set()[Symbol.iterator]()),
  },
  {
    name: 'StringIteratorPrototype',
    original: Reflect.getPrototypeOf(String.prototype[Symbol.iterator]()),
  },
  {
    name: 'WrapForValidIteratorPrototype',
    original: Reflect.getPrototypeOf(primordials.IteratorFrom({ __proto__: null })),
  },
].forEach(({ name, original }) => {
  primordials[name] = original;
  copyPrototype(original, primordials, name);
});

/* eslint-enable node-core/prefer-primordials */

const {
  Array: ArrayConstructor,
  ArrayPrototypeForEach,
  ArrayPrototypeMap,
  ArrayPrototypePushApply,
  ArrayPrototypeSlice,
  FinalizationRegistry,
  FunctionPrototypeCall,
  Map,
  ObjectDefineProperties,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectSetPrototypeOf,
  Promise,
  PromisePrototypeThen,
  PromiseResolve,
  ReflectApply,
  ReflectConstruct,
  ReflectGet,
  ReflectSet,
  RegExp,
  RegExpPrototype,
  RegExpPrototypeExec,
  RegExpPrototypeGetDotAll,
  RegExpPrototypeGetFlags,
  RegExpPrototypeGetGlobal,
  RegExpPrototypeGetHasIndices,
  RegExpPrototypeGetIgnoreCase,
  RegExpPrototypeGetMultiline,
  RegExpPrototypeGetSource,
  RegExpPrototypeGetSticky,
  RegExpPrototypeGetUnicode,
  Set,
  SymbolIterator,
  SymbolMatch,
  SymbolMatchAll,
  SymbolReplace,
  SymbolSearch,
  SymbolSpecies,
  SymbolSplit,
  WeakMap,
  WeakRef,
  WeakSet,
} = primordials;


/**
 * Creates a class that can be safely iterated over.
 *
 * Because these functions are used by \`makeSafe\`, which is exposed on the
 * \`primordials\` object, it's important to use const references to the
 * primordials that they use.
 * @template {Iterable} T
 * @template {*} TReturn
 * @template {*} TNext
 * @param {(self: T) => IterableIterator<T>} factory
 * @param {(...args: [] | [TNext]) => IteratorResult<T, TReturn>} next
 * @returns {Iterator<T, TReturn, TNext>}
 */
const createSafeIterator = (factory, next) => {
  class SafeIterator {
    constructor(iterable) {
      this._iterator = factory(iterable);
    }
    next() {
      return next(this._iterator);
    }
    [SymbolIterator]() {
      return this;
    }
  }
  ObjectSetPrototypeOf(SafeIterator.prototype, null);
  ObjectFreeze(SafeIterator.prototype);
  ObjectFreeze(SafeIterator);
  return SafeIterator;
};

primordials.SafeArrayIterator = createSafeIterator(
  primordials.ArrayPrototypeSymbolIterator,
  primordials.ArrayIteratorPrototypeNext,
);
primordials.SafeStringIterator = createSafeIterator(
  primordials.StringPrototypeSymbolIterator,
  primordials.StringIteratorPrototypeNext,
);

const copyProps = (src, dest) => {
  ArrayPrototypeForEach(ReflectOwnKeys(src), (key) => {
    if (!ReflectGetOwnPropertyDescriptor(dest, key)) {
      ReflectDefineProperty(
        dest,
        key,
        { __proto__: null, ...ReflectGetOwnPropertyDescriptor(src, key) });
    }
  });
};

/**
 * @type {typeof primordials.makeSafe}
 */
const makeSafe = (unsafe, safe, next) => {
  if (next) {
    const dummy = new unsafe();
    ArrayPrototypeForEach(ReflectOwnKeys(unsafe.prototype), (key) => {
      if (!ReflectGetOwnPropertyDescriptor(safe.prototype, key)) {
        const desc = ReflectGetOwnPropertyDescriptor(unsafe.prototype, key);
        if (
          typeof desc.value === 'function' &&
          desc.value.length === 0 &&
          FunctionPrototypeCall(desc.value, dummy)?.next === next
        ) {
          const createIterator = uncurryThis(desc.value);
          const SafeIterator = createSafeIterator(createIterator, next);
          desc.value = function() {
            return new SafeIterator(this);
          };
        }
        ReflectDefineProperty(safe.prototype, key, { __proto__: null, ...desc });
      }
    });
  } else {
    copyProps(unsafe.prototype, safe.prototype);
  }
  copyProps(unsafe, safe);

  ObjectSetPrototypeOf(safe.prototype, null);
  ObjectFreeze(safe.prototype);
  ObjectFreeze(safe);
  return safe;
};
primordials.makeSafe = makeSafe;

// Subclass the constructors because we need to use their prototype
// methods later.
primordials.SafeMap = makeSafe(
  Map,
  class SafeMap extends Map {},
  primordials.MapIteratorPrototypeNext,
);
primordials.SafeWeakMap = makeSafe(
  WeakMap,
  class SafeWeakMap extends WeakMap {},
);

primordials.SafeSet = makeSafe(
  Set,
  class SafeSet extends Set {},
  primordials.SetIteratorPrototypeNext,
);
primordials.SafeWeakSet = makeSafe(
  WeakSet,
  class SafeWeakSet extends WeakSet {},
);

primordials.SafeFinalizationRegistry = makeSafe(
  FinalizationRegistry,
  class SafeFinalizationRegistry extends FinalizationRegistry {},
);
primordials.SafeWeakRef = makeSafe(
  WeakRef,
  class SafeWeakRef extends WeakRef {},
);

const SafePromise = makeSafe(
  Promise,
  class SafePromise extends Promise {},
);

/**
 * Attaches a callback that is invoked when the Promise is settled (fulfilled or
 * rejected). The resolved value cannot be modified from the callback.
 * Prefer using async functions when possible.
 * @param {Promise<any>} thisPromise
 * @param {(() => void) | undefined | null} onFinally The callback to execute
 *   when the Promise is settled (fulfilled or rejected).
 * @returns {Promise} A Promise for the completion of the callback.
 */
primordials.SafePromisePrototypeFinally = (thisPromise, onFinally) =>
  // Wrapping on a new Promise is necessary to not expose the SafePromise
  // prototype to user-land.
  new Promise((a, b) =>
    new SafePromise((a, b) => PromisePrototypeThen(thisPromise, a, b))
      .finally(onFinally)
      .then(a, b),
  );

const arrayToSafePromiseIterable = (promises, mapFn) =>
  new primordials.SafeArrayIterator(
    ArrayPrototypeMap(
      promises,
      (promise, i) =>
        new SafePromise((a, b) => PromisePrototypeThen(mapFn == null ? promise : mapFn(promise, i), a, b)),
    ),
  );

/**
 * @template T,U
 * @param {Array<T | PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<Awaited<U>[]>}
 */
primordials.SafePromiseAll = (promises, mapFn) =>
  // Wrapping on a new Promise is necessary to not expose the SafePromise
  // prototype to user-land.
  new Promise((a, b) =>
    SafePromise.all(arrayToSafePromiseIterable(promises, mapFn)).then(a, b),
  );

/**
 * Should only be used for internal functions, this would produce similar
 * results as \`Promise.all\` but without prototype pollution, and the return
 * value is not a genuine Array but an array-like object.
 * @template T,U
 * @param {ArrayLike<T | PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<ArrayLike<Awaited<U>>>}
 */
primordials.SafePromiseAllReturnArrayLike = (promises, mapFn) =>
  new Promise((resolve, reject) => {
    const { length } = promises;

    const returnVal = ArrayConstructor(length);
    ObjectSetPrototypeOf(returnVal, null);
    if (length === 0) resolve(returnVal);

    let pendingPromises = length;
    for (let i = 0; i < length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(PromiseResolve(promise), (result) => {
        returnVal[i] = result;
        if (--pendingPromises === 0) resolve(returnVal);
      }, reject);
    }
  });

/**
 * Should only be used when we only care about waiting for all the promises to
 * resolve, not what value they resolve to.
 * @template T,U
 * @param {ArrayLike<T | PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<void>}
 */
primordials.SafePromiseAllReturnVoid = (promises, mapFn) =>
  new Promise((resolve, reject) => {
    let pendingPromises = promises.length;
    if (pendingPromises === 0) resolve();
    const onFulfilled = () => {
      if (--pendingPromises === 0) {
        resolve();
      }
    };
    for (let i = 0; i < promises.length; i++) {
      const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
      PromisePrototypeThen(PromiseResolve(promise), onFulfilled, reject);
    }
  });

/**
 * @template T,U
 * @param {Array<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<PromiseSettledResult<any>[]>}
 */
primordials.SafePromiseAllSettled = (promises, mapFn) =>
  // Wrapping on a new Promise is necessary to not expose the SafePromise
  // prototype to user-land.
  new Promise((a, b) =>
    SafePromise.allSettled(arrayToSafePromiseIterable(promises, mapFn)).then(a, b),
  );

/**
 * Should only be used when we only care about waiting for all the promises to
 * settle, not what value they resolve or reject to.
 * @template T,U
 * @param {ArrayLike<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<void>}
 */
primordials.SafePromiseAllSettledReturnVoid = (promises, mapFn) => new Promise((resolve) => {
  let pendingPromises = promises.length;
  if (pendingPromises === 0) resolve();
  const onSettle = () => {
    if (--pendingPromises === 0) resolve();
  };
  for (let i = 0; i < promises.length; i++) {
    const promise = mapFn != null ? mapFn(promises[i], i) : promises[i];
    PromisePrototypeThen(PromiseResolve(promise), onSettle, onSettle);
  }
});

/**
 * @template T,U
 * @param {Array<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<Awaited<U>>}
 */
primordials.SafePromiseAny = (promises, mapFn) =>
  // Wrapping on a new Promise is necessary to not expose the SafePromise
  // prototype to user-land.
  new Promise((a, b) =>
    SafePromise.any(arrayToSafePromiseIterable(promises, mapFn)).then(a, b),
  );

/**
 * @template T,U
 * @param {Array<T|PromiseLike<T>>} promises
 * @param {(v: T|PromiseLike<T>, k: number) => U|PromiseLike<U>} [mapFn]
 * @returns {Promise<Awaited<U>>}
 */
primordials.SafePromiseRace = (promises, mapFn) =>
  // Wrapping on a new Promise is necessary to not expose the SafePromise
  // prototype to user-land.
  new Promise((a, b) =>
    SafePromise.race(arrayToSafePromiseIterable(promises, mapFn)).then(a, b),
  );


const {
  exec: OriginalRegExpPrototypeExec,
  [SymbolMatch]: OriginalRegExpPrototypeSymbolMatch,
  [SymbolMatchAll]: OriginalRegExpPrototypeSymbolMatchAll,
  [SymbolReplace]: OriginalRegExpPrototypeSymbolReplace,
  [SymbolSearch]: OriginalRegExpPrototypeSymbolSearch,
  [SymbolSplit]: OriginalRegExpPrototypeSymbolSplit,
} = RegExpPrototype;

class RegExpLikeForStringSplitting {
  #regex;
  constructor() {
    this.#regex = ReflectConstruct(RegExp, arguments);
  }

  get lastIndex() {
    return ReflectGet(this.#regex, 'lastIndex');
  }
  set lastIndex(value) {
    ReflectSet(this.#regex, 'lastIndex', value);
  }

  exec() {
    return ReflectApply(OriginalRegExpPrototypeExec, this.#regex, arguments);
  }
}
ObjectSetPrototypeOf(RegExpLikeForStringSplitting.prototype, null);

/**
 * @param {RegExp} pattern
 * @returns {RegExp}
 */
primordials.hardenRegExp = function hardenRegExp(pattern) {
  ObjectDefineProperties(pattern, {
    [SymbolMatch]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolMatch,
    },
    [SymbolMatchAll]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolMatchAll,
    },
    [SymbolReplace]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolReplace,
    },
    [SymbolSearch]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolSearch,
    },
    [SymbolSplit]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolSplit,
    },
    constructor: {
      __proto__: null,
      configurable: true,
      value: {
        [SymbolSpecies]: RegExpLikeForStringSplitting,
      },
    },
    dotAll: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetDotAll(pattern),
    },
    exec: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeExec,
    },
    global: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetGlobal(pattern),
    },
    hasIndices: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetHasIndices(pattern),
    },
    ignoreCase: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetIgnoreCase(pattern),
    },
    multiline: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetMultiline(pattern),
    },
    source: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetSource(pattern),
    },
    sticky: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetSticky(pattern),
    },
    unicode: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetUnicode(pattern),
    },
  });
  ObjectDefineProperty(pattern, 'flags', {
    __proto__: null,
    configurable: true,
    value: RegExpPrototypeGetFlags(pattern),
  });
  return pattern;
};


/**
 * @param {string} str
 * @param {RegExp} regexp
 * @returns {number}
 */
primordials.SafeStringPrototypeSearch = (str, regexp) => {
  regexp.lastIndex = 0;
  const match = RegExpPrototypeExec(regexp, str);
  return match ? match.index : -1;
};

/**
 * Variadic functions with lots of arguments will cause stack overflow errors.
 * Use this function when \`items\` can be arbitrarily large, this function splits
 * it into chunks of size 2**16 making stack overflow less likely.
 * @param {Array<unknown>} arr
 * @param {Parameters<typeof Array.prototype.push>} items
 * @returns {ReturnType<typeof Array.prototype.push>}
 */
primordials.SafeArrayPrototypePushApply = (arr, items) => {
  let end = 0x10000;
  if (end < items.length) {
    let start = 0;
    do {
      ArrayPrototypePushApply(arr, ArrayPrototypeSlice(items, start, start = end));
      end += 0x10000;
    } while (end < items.length);
    items = ArrayPrototypeSlice(items, start);
  }
  return ArrayPrototypePushApply(arr, items);
};

ObjectSetPrototypeOf(primordials, null);
ObjectFreeze(primordials);
`,qn=`'use strict';

const {
  Array,
  Int8Array,
  NumberPrototypeToString,
  StringPrototypeCharCodeAt,
  StringPrototypeSlice,
  StringPrototypeToUpperCase,
} = primordials;

const { ERR_INVALID_URI } = require('internal/errors').codes;

const hexTable = new Array(256);
for (let i = 0; i < 256; ++i)
  hexTable[i] = '%' +
                StringPrototypeToUpperCase((i < 16 ? '0' : '') +
                                           NumberPrototypeToString(i, 16));

const isHexTable = new Int8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 64 - 79
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 80 - 95
  0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 96 - 111
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 112 - 127
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 128 ...
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // ... 256
]);

/**
 * @param {string} str
 * @param {Int8Array} noEscapeTable
 * @param {string[]} hexTable
 * @returns {string}
 */
function encodeStr(str, noEscapeTable, hexTable) {
  const len = str.length;
  if (len === 0)
    return '';

  let out = '';
  let lastPos = 0;
  let i = 0;

  outer:
  for (; i < len; i++) {
    let c = StringPrototypeCharCodeAt(str, i);

    // ASCII
    while (c < 0x80) {
      if (noEscapeTable[c] !== 1) {
        if (lastPos < i)
          out += StringPrototypeSlice(str, lastPos, i);
        lastPos = i + 1;
        out += hexTable[c];
      }

      if (++i === len)
        break outer;

      c = StringPrototypeCharCodeAt(str, i);
    }

    if (lastPos < i)
      out += StringPrototypeSlice(str, lastPos, i);

    // Multi-byte characters ...
    if (c < 0x800) {
      lastPos = i + 1;
      out += hexTable[0xC0 | (c >> 6)] +
             hexTable[0x80 | (c & 0x3F)];
      continue;
    }
    if (c < 0xD800 || c >= 0xE000) {
      lastPos = i + 1;
      out += hexTable[0xE0 | (c >> 12)] +
             hexTable[0x80 | ((c >> 6) & 0x3F)] +
             hexTable[0x80 | (c & 0x3F)];
      continue;
    }
    // Surrogate pair
    ++i;

    // This branch should never happen because all URLSearchParams entries
    // should already be converted to USVString. But, included for
    // completion's sake anyway.
    if (i >= len)
      throw new ERR_INVALID_URI();

    const c2 = StringPrototypeCharCodeAt(str, i) & 0x3FF;

    lastPos = i + 1;
    c = 0x10000 + (((c & 0x3FF) << 10) | c2);
    out += hexTable[0xF0 | (c >> 18)] +
           hexTable[0x80 | ((c >> 12) & 0x3F)] +
           hexTable[0x80 | ((c >> 6) & 0x3F)] +
           hexTable[0x80 | (c & 0x3F)];
  }
  if (lastPos === 0)
    return str;
  if (lastPos < len)
    return out + StringPrototypeSlice(str, lastPos);
  return out;
}

module.exports = {
  encodeStr,
  hexTable,
  isHexTable,
};
`,Vn=`// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

const {
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  FunctionPrototypeBind,
  StringPrototypeCharCodeAt,
  StringPrototypeIncludes,
  StringPrototypeIndexOf,
  StringPrototypeLastIndexOf,
  StringPrototypeRepeat,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeToLowerCase,
  StringPrototypeToUpperCase,
} = primordials;

const {
  CHAR_UPPERCASE_A,
  CHAR_LOWERCASE_A,
  CHAR_UPPERCASE_Z,
  CHAR_LOWERCASE_Z,
  CHAR_DOT,
  CHAR_FORWARD_SLASH,
  CHAR_BACKWARD_SLASH,
  CHAR_COLON,
  CHAR_QUESTION_MARK,
} = require('internal/constants');
const {
  validateObject,
  validateString,
} = require('internal/validators');

const {
  isWindows,
  getLazy,
} = require('internal/util');

const lazyMatchGlobPattern = getLazy(() => require('internal/fs/glob').matchGlobPattern);

function isPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
}

function isPosixPathSeparator(code) {
  return code === CHAR_FORWARD_SLASH;
}

const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  'COM\\xb9', 'COM\\xb2', 'COM\\xb3',
  'LPT\\xb9', 'LPT\\xb2', 'LPT\\xb3',
];

function isWindowsReservedName(path, colonIndex) {
  const devicePart = StringPrototypeToUpperCase(StringPrototypeSlice(path, 0, colonIndex));
  return ArrayPrototypeIncludes(WINDOWS_RESERVED_NAMES, devicePart);
}

function isWindowsDeviceRoot(code) {
  return (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) ||
         (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z);
}

// Resolves . and .. elements in a path with directory names
function normalizeString(path, allowAboveRoot, separator, isPathSeparator) {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length)
      code = StringPrototypeCharCodeAt(path, i);
    else if (isPathSeparator(code))
      break;
    else
      code = CHAR_FORWARD_SLASH;

    if (isPathSeparator(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 ||
            StringPrototypeCharCodeAt(res, res.length - 1) !== CHAR_DOT ||
            StringPrototypeCharCodeAt(res, res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            const lastSlashIndex = res.length - lastSegmentLength - 1;
            if (lastSlashIndex === -1) {
              res = '';
              lastSegmentLength = 0;
            } else {
              res = StringPrototypeSlice(res, 0, lastSlashIndex);
              lastSegmentLength =
                res.length - 1 - StringPrototypeLastIndexOf(res, separator);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? \`\${separator}..\` : '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += \`\${separator}\${StringPrototypeSlice(path, lastSlash + 1, i)}\`;
        else
          res = StringPrototypeSlice(path, lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function formatExt(ext) {
  return ext ? \`\${ext[0] === '.' ? '' : '.'}\${ext}\` : '';
}

/**
 * @param {string} sep
 * @param {{
 *  dir?: string;
 *  root?: string;
 *  base?: string;
 *  name?: string;
 *  ext?: string;
 *  }} pathObject
 * @returns {string}
 */
function _format(sep, pathObject) {
  validateObject(pathObject, 'pathObject');
  const dir = pathObject.dir || pathObject.root;
  const base = pathObject.base ||
    \`\${pathObject.name || ''}\${formatExt(pathObject.ext)}\`;
  if (!dir) {
    return base;
  }
  return dir === pathObject.root ? \`\${dir}\${base}\` : \`\${dir}\${sep}\${base}\`;
}

const forwardSlashRegExp = /\\//g;

const win32 = {
  /**
   * path.resolve([from ...], to)
   * @param {...string} args
   * @returns {string}
   */
  resolve(...args) {
    let resolvedDevice = '';
    let resolvedTail = '';
    let resolvedAbsolute = false;

    for (let i = args.length - 1; i >= -1; i--) {
      let path;
      if (i >= 0) {
        path = args[i];
        validateString(path, \`paths[\${i}]\`);

        // Skip empty entries
        if (path.length === 0) {
          continue;
        }
      } else if (resolvedDevice.length === 0) {
        path = process.cwd();
        // Fast path for current directory
        if (args.length === 0 || ((args.length === 1 && (args[0] === '' || args[0] === '.')) &&
            isPathSeparator(StringPrototypeCharCodeAt(path, 0)))) {
          if (!isWindows) {
            path = StringPrototypeReplace(path, forwardSlashRegExp, '\\\\');
          }
          return path;
        }
      } else {
        // Windows has the concept of drive-specific current working
        // directories. If we've resolved a drive letter but not yet an
        // absolute path, get cwd for that drive, or the process cwd if
        // the drive cwd is not available. We're sure the device is not
        // a UNC path at this points, because UNC paths are always absolute.
        path = process.env[\`=\${resolvedDevice}\`] || process.cwd();

        // Verify that a cwd was found and that it actually points
        // to our drive. If not, default to the drive's root.
        if (path === undefined ||
            (StringPrototypeToLowerCase(StringPrototypeSlice(path, 0, 2)) !==
            StringPrototypeToLowerCase(resolvedDevice) &&
            StringPrototypeCharCodeAt(path, 2) === CHAR_BACKWARD_SLASH)) {
          path = \`\${resolvedDevice}\\\\\`;
        }
      }

      const len = path.length;
      let rootEnd = 0;
      let device = '';
      let isAbsolute = false;
      const code = StringPrototypeCharCodeAt(path, 0);

      // Try to match a root
      if (len === 1) {
        if (isPathSeparator(code)) {
          // \`path\` contains just a path separator
          rootEnd = 1;
          isAbsolute = true;
        }
      } else if (isPathSeparator(code)) {
        // Possible UNC root

        // If we started with a separator, we know we at least have an
        // absolute path of some kind (UNC or otherwise)
        isAbsolute = true;

        if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
          // Matched double path separator at beginning
          let j = 2;
          let last = j;
          // Match 1 or more non-path separators
          while (j < len &&
                 !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            const firstPart = StringPrototypeSlice(path, last, j);
            // Matched!
            last = j;
            // Match 1 or more path separators
            while (j < len &&
                   isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j < len && j !== last) {
              // Matched!
              last = j;
              // Match 1 or more non-path separators
              while (j < len &&
                     !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
                j++;
              }
              if (j === len || j !== last) {
                if (firstPart !== '.' && firstPart !== '?') {
                  // We matched a UNC root
                  device =
                    \`\\\\\\\\\${firstPart}\\\\\${StringPrototypeSlice(path, last, j)}\`;
                  rootEnd = j;
                } else {
                  // We matched a device root (e.g. \\\\\\\\.\\\\PHYSICALDRIVE0)
                  device = \`\\\\\\\\\${firstPart}\`;
                  rootEnd = 4;
                }
              }
            }
          }
        } else {
          rootEnd = 1;
        }
      } else if (isWindowsDeviceRoot(code) &&
                  StringPrototypeCharCodeAt(path, 1) === CHAR_COLON) {
        // Possible device root
        device = StringPrototypeSlice(path, 0, 2);
        rootEnd = 2;
        if (len > 2 && isPathSeparator(StringPrototypeCharCodeAt(path, 2))) {
          // Treat separator following drive name as an absolute path
          // indicator
          isAbsolute = true;
          rootEnd = 3;
        }
      }

      if (device.length > 0) {
        if (resolvedDevice.length > 0) {
          if (StringPrototypeToLowerCase(device) !==
              StringPrototypeToLowerCase(resolvedDevice))
            // This path points to another device so it is not applicable
            continue;
        } else {
          resolvedDevice = device;
        }
      }

      if (resolvedAbsolute) {
        if (resolvedDevice.length > 0)
          break;
      } else {
        resolvedTail =
          \`\${StringPrototypeSlice(path, rootEnd)}\\\\\${resolvedTail}\`;
        resolvedAbsolute = isAbsolute;
        if (isAbsolute && resolvedDevice.length > 0) {
          break;
        }
      }
    }

    // At this point the path should be resolved to a full absolute path,
    // but handle relative paths to be safe (might happen when process.cwd()
    // fails)

    // Normalize the tail path
    resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, '\\\\',
                                   isPathSeparator);

    return resolvedAbsolute ?
      \`\${resolvedDevice}\\\\\${resolvedTail}\` :
      \`\${resolvedDevice}\${resolvedTail}\` || '.';
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  normalize(path) {
    validateString(path, 'path');
    const len = path.length;
    if (len === 0)
      return '.';
    let rootEnd = 0;
    let device;
    let isAbsolute = false;
    const code = StringPrototypeCharCodeAt(path, 0);

    // Try to match a root
    if (len === 1) {
      // \`path\` contains just a single char, exit early to avoid
      // unnecessary work
      return isPosixPathSeparator(code) ? '\\\\' : path;
    }
    if (isPathSeparator(code)) {
      // Possible UNC root

      // If we started with a separator, we know we at least have an absolute
      // path of some kind (UNC or otherwise)
      isAbsolute = true;

      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len &&
               !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
          j++;
        }
        if (j < len && j !== last) {
          const firstPart = StringPrototypeSlice(path, last, j);
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len &&
                 isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len &&
                   !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j === len || j !== last) {
              if (firstPart === '.' || firstPart === '?') {
                // We matched a device root (e.g. \\\\\\\\.\\\\PHYSICALDRIVE0)
                device = \`\\\\\\\\\${firstPart}\`;
                rootEnd = 4;
                const colonIndex = StringPrototypeIndexOf(path, ':');
                // Special case: handle \\\\?\\COM1: or similar reserved device paths
                const possibleDevice = StringPrototypeSlice(path, 4, colonIndex + 1);
                if (isWindowsReservedName(possibleDevice, possibleDevice.length - 1)) {
                  device = \`\\\\\\\\?\\\\\${possibleDevice}\`;
                  rootEnd = 4 + possibleDevice.length;
                }
              } else if (j === len) {
                // We matched a UNC root only
                // Return the normalized version of the UNC root since there
                // is nothing left to process
                return \`\\\\\\\\\${firstPart}\\\\\${StringPrototypeSlice(path, last)}\\\\\`;
              } else {
                // We matched a UNC root with leftovers
                device =
                  \`\\\\\\\\\${firstPart}\\\\\${StringPrototypeSlice(path, last, j)}\`;
                rootEnd = j;
              }
            }
          }
        }
      } else {
        rootEnd = 1;
      }
    } else {
      const colonIndex = StringPrototypeIndexOf(path, ':');
      if (colonIndex > 0) {
        if (isWindowsDeviceRoot(code) && colonIndex === 1) {
          device = StringPrototypeSlice(path, 0, 2);
          rootEnd = 2;
          if (len > 2 && isPathSeparator(StringPrototypeCharCodeAt(path, 2))) {
            isAbsolute = true;
            rootEnd = 3;
          }
        } else if (isWindowsReservedName(path, colonIndex)) {
          device = StringPrototypeSlice(path, 0, colonIndex + 1);
          rootEnd = colonIndex + 1;

        }
      }
    }

    let tail = rootEnd < len ?
      normalizeString(StringPrototypeSlice(path, rootEnd),
                      !isAbsolute, '\\\\', isPathSeparator) :
      '';
    if (tail.length === 0 && !isAbsolute)
      tail = '.';
    if (tail.length > 0 &&
        isPathSeparator(StringPrototypeCharCodeAt(path, len - 1)))
      tail += '\\\\';
    if (!isAbsolute && device === undefined && StringPrototypeIncludes(path, ':')) {
      // If the original path was not absolute and if we have not been able to
      // resolve it relative to a particular device, we need to ensure that the
      // \`tail\` has not become something that Windows might interpret as an
      // absolute path. See CVE-2024-36139.
      if (tail.length >= 2 &&
          isWindowsDeviceRoot(StringPrototypeCharCodeAt(tail, 0)) &&
          StringPrototypeCharCodeAt(tail, 1) === CHAR_COLON) {
        return \`.\\\\\${tail}\`;
      }
      let index = StringPrototypeIndexOf(path, ':');

      do {
        if (index === len - 1 || isPathSeparator(StringPrototypeCharCodeAt(path, index + 1))) {
          return \`.\\\\\${tail}\`;
        }
      } while ((index = StringPrototypeIndexOf(path, ':', index + 1)) !== -1);
    }
    const colonIndex = StringPrototypeIndexOf(path, ':');
    if (isWindowsReservedName(path, colonIndex)) {
      return \`.\\\\\${device ?? ''}\${tail}\`;
    }
    if (device === undefined) {
      return isAbsolute ? \`\\\\\${tail}\` : tail;
    }
    return isAbsolute ? \`\${device}\\\\\${tail}\` : \`\${device}\${tail}\`;
  },

  /**
   * @param {string} path
   * @returns {boolean}
   */
  isAbsolute(path) {
    validateString(path, 'path');
    const len = path.length;
    if (len === 0)
      return false;

    const code = StringPrototypeCharCodeAt(path, 0);
    return isPathSeparator(code) ||
      // Possible device root
      (len > 2 &&
      isWindowsDeviceRoot(code) &&
      StringPrototypeCharCodeAt(path, 1) === CHAR_COLON &&
      isPathSeparator(StringPrototypeCharCodeAt(path, 2)));
  },

  /**
   * @param {...string} args
   * @returns {string}
   */
  join(...args) {
    if (args.length === 0)
      return '.';

    const path = [];
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i];
      validateString(arg, 'path');
      if (arg.length > 0) {
        ArrayPrototypePush(path, arg);
      }
    }

    if (path.length === 0)
      return '.';

    const firstPart = path[0];
    let joined = ArrayPrototypeJoin(path, '\\\\');

    // Make sure that the joined path doesn't start with two slashes, because
    // normalize() will mistake it for a UNC path then.
    //
    // This step is skipped when it is very clear that the user actually
    // intended to point at a UNC path. This is assumed when the first
    // non-empty string arguments starts with exactly two slashes followed by
    // at least one more non-slash character.
    //
    // Note that for normalize() to treat a path as a UNC path it needs to
    // have at least 2 components, so we don't filter for that here.
    // This means that the user can use join to construct UNC paths from
    // a server name and a share name; for example:
    //   path.join('//server', 'share') -> '\\\\\\\\server\\\\share\\\\')
    let needsReplace = true;
    let slashCount = 0;
    if (isPathSeparator(StringPrototypeCharCodeAt(firstPart, 0))) {
      ++slashCount;
      const firstLen = firstPart.length;
      if (firstLen > 1 &&
          isPathSeparator(StringPrototypeCharCodeAt(firstPart, 1))) {
        ++slashCount;
        if (firstLen > 2) {
          if (isPathSeparator(StringPrototypeCharCodeAt(firstPart, 2)))
            ++slashCount;
          else {
            // We matched a UNC path in the first part
            needsReplace = false;
          }
        }
      }
    }
    if (needsReplace) {
      // Find any more consecutive slashes we need to replace
      while (slashCount < joined.length &&
             isPathSeparator(StringPrototypeCharCodeAt(joined, slashCount))) {
        slashCount++;
      }

      // Replace the slashes if needed
      if (slashCount >= 2)
        joined = \`\\\\\${StringPrototypeSlice(joined, slashCount)}\`;
    }

    // Skip normalization when reserved device names are present
    const parts = [];
    let part = '';

    for (let i = 0; i < joined.length; i++) {
      if (joined[i] === '\\\\') {
        if (part) parts.push(part);
        part = '';
        // Skip consecutive backslashes
        while (i + 1 < joined.length && joined[i + 1] === '\\\\') i++;
      } else {
        part += joined[i];
      }
    }
    // Add the final part if any
    if (part) parts.push(part);

    // Check if any part has a Windows reserved name
    if (parts.some((p) => {
      const colonIndex = StringPrototypeIndexOf(p, ':');
      return colonIndex !== -1 && isWindowsReservedName(p, colonIndex);
    })) {
      // Replace forward slashes with backslashes
      let result = '';
      for (let i = 0; i < joined.length; i++) {
        result += joined[i] === '/' ? '\\\\' : joined[i];
      }
      return result;
    }

    return win32.normalize(joined);
  },

  /**
   * It will solve the relative path from \`from\` to \`to\`, for instance
   * from = 'C:\\\\orandea\\\\test\\\\aaa'
   * to = 'C:\\\\orandea\\\\impl\\\\bbb'
   * The output of the function should be: '..\\\\..\\\\impl\\\\bbb'
   * @param {string} from
   * @param {string} to
   * @returns {string}
   */
  relative(from, to) {
    validateString(from, 'from');
    validateString(to, 'to');

    if (from === to)
      return '';

    const fromOrig = win32.resolve(from);
    const toOrig = win32.resolve(to);

    if (fromOrig === toOrig)
      return '';

    from = StringPrototypeToLowerCase(fromOrig);
    to = StringPrototypeToLowerCase(toOrig);

    if (from === to)
      return '';

    if (fromOrig.length !== from.length || toOrig.length !== to.length) {
      const fromSplit = StringPrototypeSplit(fromOrig, '\\\\');
      const toSplit = StringPrototypeSplit(toOrig, '\\\\');
      if (fromSplit[fromSplit.length - 1] === '') {
        fromSplit.pop();
      }
      if (toSplit[toSplit.length - 1] === '') {
        toSplit.pop();
      }

      const fromLen = fromSplit.length;
      const toLen = toSplit.length;
      const length = fromLen < toLen ? fromLen : toLen;

      let i;
      for (i = 0; i < length; i++) {
        if (StringPrototypeToLowerCase(fromSplit[i]) !== StringPrototypeToLowerCase(toSplit[i])) {
          break;
        }
      }

      if (i === 0) {
        return toOrig;
      } else if (i === length) {
        if (toLen > length) {
          return ArrayPrototypeJoin(ArrayPrototypeSlice(toSplit, i), '\\\\');
        }
        if (fromLen > length) {
          return StringPrototypeRepeat('..\\\\', fromLen - 1 - i) + '..';
        }
        return '';
      }

      return StringPrototypeRepeat('..\\\\', fromLen - i) + ArrayPrototypeJoin(ArrayPrototypeSlice(toSplit, i), '\\\\');
    }

    // Trim any leading backslashes
    let fromStart = 0;
    while (fromStart < from.length &&
           StringPrototypeCharCodeAt(from, fromStart) === CHAR_BACKWARD_SLASH) {
      fromStart++;
    }
    // Trim trailing backslashes (applicable to UNC paths only)
    let fromEnd = from.length;
    while (
      fromEnd - 1 > fromStart &&
      StringPrototypeCharCodeAt(from, fromEnd - 1) === CHAR_BACKWARD_SLASH
    ) {
      fromEnd--;
    }
    const fromLen = fromEnd - fromStart;

    // Trim any leading backslashes
    let toStart = 0;
    while (toStart < to.length &&
           StringPrototypeCharCodeAt(to, toStart) === CHAR_BACKWARD_SLASH) {
      toStart++;
    }
    // Trim trailing backslashes (applicable to UNC paths only)
    let toEnd = to.length;
    while (toEnd - 1 > toStart &&
           StringPrototypeCharCodeAt(to, toEnd - 1) === CHAR_BACKWARD_SLASH) {
      toEnd--;
    }
    const toLen = toEnd - toStart;

    // Compare paths to find the longest common path from root
    const length = fromLen < toLen ? fromLen : toLen;
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      const fromCode = StringPrototypeCharCodeAt(from, fromStart + i);
      if (fromCode !== StringPrototypeCharCodeAt(to, toStart + i))
        break;
      else if (fromCode === CHAR_BACKWARD_SLASH)
        lastCommonSep = i;
    }

    // We found a mismatch before the first common path separator was seen, so
    // return the original \`to\`.
    if (i !== length) {
      if (lastCommonSep === -1)
        return toOrig;
    } else {
      if (toLen > length) {
        if (StringPrototypeCharCodeAt(to, toStart + i) ===
            CHAR_BACKWARD_SLASH) {
          // We get here if \`from\` is the exact base path for \`to\`.
          // For example: from='C:\\\\foo\\\\bar'; to='C:\\\\foo\\\\bar\\\\baz'
          return StringPrototypeSlice(toOrig, toStart + i + 1);
        }
        if (i === 2) {
          // We get here if \`from\` is the device root.
          // For example: from='C:\\\\'; to='C:\\\\foo'
          return StringPrototypeSlice(toOrig, toStart + i);
        }
      }
      if (fromLen > length) {
        if (StringPrototypeCharCodeAt(from, fromStart + i) ===
            CHAR_BACKWARD_SLASH) {
          // We get here if \`to\` is the exact base path for \`from\`.
          // For example: from='C:\\\\foo\\\\bar'; to='C:\\\\foo'
          lastCommonSep = i;
        } else if (i === 2) {
          // We get here if \`to\` is the device root.
          // For example: from='C:\\\\foo\\\\bar'; to='C:\\\\'
          lastCommonSep = 3;
        }
      }
      if (lastCommonSep === -1)
        lastCommonSep = 0;
    }

    let out = '';
    // Generate the relative path based on the path difference between \`to\` and
    // \`from\`
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd ||
          StringPrototypeCharCodeAt(from, i) === CHAR_BACKWARD_SLASH) {
        out += out.length === 0 ? '..' : '\\\\..';
      }
    }

    toStart += lastCommonSep;

    // Lastly, append the rest of the destination (\`to\`) path that comes after
    // the common path parts
    if (out.length > 0)
      return \`\${out}\${StringPrototypeSlice(toOrig, toStart, toEnd)}\`;

    if (StringPrototypeCharCodeAt(toOrig, toStart) === CHAR_BACKWARD_SLASH)
      ++toStart;
    return StringPrototypeSlice(toOrig, toStart, toEnd);
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  toNamespacedPath(path) {
    // Note: this will *probably* throw somewhere.
    if (typeof path !== 'string' || path.length === 0)
      return path;

    const resolvedPath = win32.resolve(path);

    if (resolvedPath.length <= 2)
      return path;

    if (StringPrototypeCharCodeAt(resolvedPath, 0) === CHAR_BACKWARD_SLASH) {
      // Possible UNC root
      if (StringPrototypeCharCodeAt(resolvedPath, 1) === CHAR_BACKWARD_SLASH) {
        const code = StringPrototypeCharCodeAt(resolvedPath, 2);
        if (code !== CHAR_QUESTION_MARK && code !== CHAR_DOT) {
          // Matched non-long UNC root, convert the path to a long UNC path
          return \`\\\\\\\\?\\\\UNC\\\\\${StringPrototypeSlice(resolvedPath, 2)}\`;
        }
      }
    } else if (
      isWindowsDeviceRoot(StringPrototypeCharCodeAt(resolvedPath, 0)) &&
      StringPrototypeCharCodeAt(resolvedPath, 1) === CHAR_COLON &&
      StringPrototypeCharCodeAt(resolvedPath, 2) === CHAR_BACKWARD_SLASH
    ) {
      // Matched device root, convert the path to a long UNC path
      return \`\\\\\\\\?\\\\\${resolvedPath}\`;
    }

    return resolvedPath;
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  dirname(path) {
    validateString(path, 'path');
    const len = path.length;
    if (len === 0)
      return '.';
    let rootEnd = -1;
    let offset = 0;
    const code = StringPrototypeCharCodeAt(path, 0);

    if (len === 1) {
      // \`path\` contains just a path separator, exit early to avoid
      // unnecessary work or a dot.
      return isPathSeparator(code) ? path : '.';
    }

    // Try to match a root
    if (isPathSeparator(code)) {
      // Possible UNC root

      rootEnd = offset = 1;

      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len &&
               !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len &&
                 isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len &&
                   !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j === len) {
              // We matched a UNC root only
              return path;
            }
            if (j !== last) {
              // We matched a UNC root with leftovers

              // Offset by 1 to include the separator after the UNC root to
              // treat it as a "normal root" on top of a (UNC) root
              rootEnd = offset = j + 1;
            }
          }
        }
      }
    // Possible device root
    } else if (isWindowsDeviceRoot(code) &&
               StringPrototypeCharCodeAt(path, 1) === CHAR_COLON) {
      rootEnd =
        len > 2 && isPathSeparator(StringPrototypeCharCodeAt(path, 2)) ? 3 : 2;
      offset = rootEnd;
    }

    let end = -1;
    let matchedSlash = true;
    for (let i = len - 1; i >= offset; --i) {
      if (isPathSeparator(StringPrototypeCharCodeAt(path, i))) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) {
      if (rootEnd === -1)
        return '.';

      end = rootEnd;
    }
    return StringPrototypeSlice(path, 0, end);
  },

  /**
   * @param {string} path
   * @param {string} [suffix]
   * @returns {string}
   */
  basename(path, suffix) {
    if (suffix !== undefined)
      validateString(suffix, 'suffix');
    validateString(path, 'path');
    let start = 0;
    let end = -1;
    let matchedSlash = true;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded
    if (path.length >= 2 &&
        isWindowsDeviceRoot(StringPrototypeCharCodeAt(path, 0)) &&
        StringPrototypeCharCodeAt(path, 1) === CHAR_COLON) {
      start = 2;
    }

    if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
      if (suffix === path)
        return '';
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (let i = path.length - 1; i >= start; --i) {
        const code = StringPrototypeCharCodeAt(path, i);
        if (isPathSeparator(code)) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === StringPrototypeCharCodeAt(suffix, extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end)
        end = firstNonSlashEnd;
      else if (end === -1)
        end = path.length;
      return StringPrototypeSlice(path, start, end);
    }
    for (let i = path.length - 1; i >= start; --i) {
      if (isPathSeparator(StringPrototypeCharCodeAt(path, i))) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1)
      return '';
    return StringPrototypeSlice(path, start, end);
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  extname(path) {
    validateString(path, 'path');
    let start = 0;
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;

    // Check for a drive letter prefix so as not to mistake the following
    // path separator as an extra separator at the end of the path that can be
    // disregarded

    if (path.length >= 2 &&
        StringPrototypeCharCodeAt(path, 1) === CHAR_COLON &&
        isWindowsDeviceRoot(StringPrototypeCharCodeAt(path, 0))) {
      start = startPart = 2;
    }

    for (let i = path.length - 1; i >= start; --i) {
      const code = StringPrototypeCharCodeAt(path, i);
      if (isPathSeparator(code)) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1)
          startDot = i;
        else if (preDotState !== 1)
          preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 ||
        end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        (preDotState === 1 &&
         startDot === end - 1 &&
         startDot === startPart + 1)) {
      return '';
    }
    return StringPrototypeSlice(path, startDot, end);
  },

  format: FunctionPrototypeBind(_format, null, '\\\\'),

  /**
   * @param {string} path
   * @returns {{
   *  dir: string;
   *  root: string;
   *  base: string;
   *  name: string;
   *  ext: string;
   *  }}
   */
  parse(path) {
    validateString(path, 'path');

    const ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0)
      return ret;

    const len = path.length;
    let rootEnd = 0;
    let code = StringPrototypeCharCodeAt(path, 0);

    if (len === 1) {
      if (isPathSeparator(code)) {
        // \`path\` contains just a path separator, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      ret.base = ret.name = path;
      return ret;
    }
    // Try to match a root
    if (isPathSeparator(code)) {
      // Possible UNC root

      rootEnd = 1;
      if (isPathSeparator(StringPrototypeCharCodeAt(path, 1))) {
        // Matched double path separator at beginning
        let j = 2;
        let last = j;
        // Match 1 or more non-path separators
        while (j < len &&
               !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
          j++;
        }
        if (j < len && j !== last) {
          // Matched!
          last = j;
          // Match 1 or more path separators
          while (j < len &&
                 isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
            j++;
          }
          if (j < len && j !== last) {
            // Matched!
            last = j;
            // Match 1 or more non-path separators
            while (j < len &&
                   !isPathSeparator(StringPrototypeCharCodeAt(path, j))) {
              j++;
            }
            if (j === len) {
              // We matched a UNC root only
              rootEnd = j;
            } else if (j !== last) {
              // We matched a UNC root with leftovers
              rootEnd = j + 1;
            }
          }
        }
      }
    } else if (isWindowsDeviceRoot(code) &&
               StringPrototypeCharCodeAt(path, 1) === CHAR_COLON) {
      // Possible device root
      if (len <= 2) {
        // \`path\` contains just a drive root, exit early to avoid
        // unnecessary work
        ret.root = ret.dir = path;
        return ret;
      }
      rootEnd = 2;
      if (isPathSeparator(StringPrototypeCharCodeAt(path, 2))) {
        if (len === 3) {
          // \`path\` contains just a drive root, exit early to avoid
          // unnecessary work
          ret.root = ret.dir = path;
          return ret;
        }
        rootEnd = 3;
      }
    }
    if (rootEnd > 0)
      ret.root = StringPrototypeSlice(path, 0, rootEnd);

    let startDot = -1;
    let startPart = rootEnd;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;

    // Get non-dir info
    for (; i >= rootEnd; --i) {
      code = StringPrototypeCharCodeAt(path, i);
      if (isPathSeparator(code)) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1)
          startDot = i;
        else if (preDotState !== 1)
          preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (end !== -1) {
      if (startDot === -1 ||
          // We saw a non-dot character immediately before the dot
          preDotState === 0 ||
          // The (right-most) trimmed path component is exactly '..'
          (preDotState === 1 &&
           startDot === end - 1 &&
           startDot === startPart + 1)) {
        ret.base = ret.name = StringPrototypeSlice(path, startPart, end);
      } else {
        ret.name = StringPrototypeSlice(path, startPart, startDot);
        ret.base = StringPrototypeSlice(path, startPart, end);
        ret.ext = StringPrototypeSlice(path, startDot, end);
      }
    }

    // If the directory is the root, use the entire root as the \`dir\` including
    // the trailing slash if any (\`C:\\abc\` -> \`C:\\\`). Otherwise, strip out the
    // trailing slash (\`C:\\abc\\def\` -> \`C:\\abc\`).
    if (startPart > 0 && startPart !== rootEnd)
      ret.dir = StringPrototypeSlice(path, 0, startPart - 1);
    else
      ret.dir = ret.root;

    return ret;
  },

  matchesGlob(path, pattern) {
    return lazyMatchGlobPattern()(path, pattern, true);
  },

  sep: '\\\\',
  delimiter: ';',
  win32: null,
  posix: null,
};

const posixCwd = (() => {
  if (isWindows) {
    // Converts Windows' backslash path separators to POSIX forward slashes
    // and truncates any drive indicator
    const regexp = /\\\\/g;
    return () => {
      const cwd = StringPrototypeReplace(process.cwd(), regexp, '/');
      return StringPrototypeSlice(cwd, StringPrototypeIndexOf(cwd, '/'));
    };
  }

  // We're already on POSIX, no need for any transformations
  return () => process.cwd();
})();

const posix = {
  /**
   * path.resolve([from ...], to)
   * @param {...string} args
   * @returns {string}
   */
  resolve(...args) {
    if (args.length === 0 || (args.length === 1 && (args[0] === '' || args[0] === '.'))) {
      const cwd = posixCwd();
      if (StringPrototypeCharCodeAt(cwd, 0) === CHAR_FORWARD_SLASH) {
        return cwd;
      }
    }
    let resolvedPath = '';
    let resolvedAbsolute = false;

    for (let i = args.length - 1; i >= 0 && !resolvedAbsolute; i--) {
      const path = args[i];
      validateString(path, \`paths[\${i}]\`);

      // Skip empty entries
      if (path.length === 0) {
        continue;
      }

      resolvedPath = \`\${path}/\${resolvedPath}\`;
      resolvedAbsolute =
        StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
    }

    if (!resolvedAbsolute) {
      const cwd = posixCwd();
      resolvedPath = \`\${cwd}/\${resolvedPath}\`;
      resolvedAbsolute =
        StringPrototypeCharCodeAt(cwd, 0) === CHAR_FORWARD_SLASH;
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, '/',
                                   isPosixPathSeparator);

    if (resolvedAbsolute) {
      return \`/\${resolvedPath}\`;
    }
    return resolvedPath.length > 0 ? resolvedPath : '.';
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  normalize(path) {
    validateString(path, 'path');

    if (path.length === 0)
      return '.';

    const isAbsolute =
      StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
    const trailingSeparator =
      StringPrototypeCharCodeAt(path, path.length - 1) === CHAR_FORWARD_SLASH;

    // Normalize the path
    path = normalizeString(path, !isAbsolute, '/', isPosixPathSeparator);

    if (path.length === 0) {
      if (isAbsolute)
        return '/';
      return trailingSeparator ? './' : '.';
    }
    if (trailingSeparator)
      path += '/';

    return isAbsolute ? \`/\${path}\` : path;
  },

  /**
   * @param {string} path
   * @returns {boolean}
   */
  isAbsolute(path) {
    validateString(path, 'path');
    return path.length > 0 &&
           StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
  },

  /**
   * @param {...string} args
   * @returns {string}
   */
  join(...args) {
    if (args.length === 0)
      return '.';

    const path = [];
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i];
      validateString(arg, 'path');
      if (arg.length > 0) {
        path.push(arg);
      }
    }

    if (path.length === 0)
      return '.';

    return posix.normalize(ArrayPrototypeJoin(path, '/'));
  },

  /**
   * @param {string} from
   * @param {string} to
   * @returns {string}
   */
  relative(from, to) {
    validateString(from, 'from');
    validateString(to, 'to');

    if (from === to)
      return '';

    // Trim leading forward slashes.
    from = posix.resolve(from);
    to = posix.resolve(to);

    if (from === to)
      return '';

    const fromStart = 1;
    const fromEnd = from.length;
    const fromLen = fromEnd - fromStart;
    const toStart = 1;
    const toLen = to.length - toStart;

    // Compare paths to find the longest common path from root
    const length = (fromLen < toLen ? fromLen : toLen);
    let lastCommonSep = -1;
    let i = 0;
    for (; i < length; i++) {
      const fromCode = StringPrototypeCharCodeAt(from, fromStart + i);
      if (fromCode !== StringPrototypeCharCodeAt(to, toStart + i))
        break;
      else if (fromCode === CHAR_FORWARD_SLASH)
        lastCommonSep = i;
    }
    if (i === length) {
      if (toLen > length) {
        if (StringPrototypeCharCodeAt(to, toStart + i) === CHAR_FORWARD_SLASH) {
          // We get here if \`from\` is the exact base path for \`to\`.
          // For example: from='/foo/bar'; to='/foo/bar/baz'
          return StringPrototypeSlice(to, toStart + i + 1);
        }
        if (i === 0) {
          // We get here if \`from\` is the root
          // For example: from='/'; to='/foo'
          return StringPrototypeSlice(to, toStart + i);
        }
      } else if (fromLen > length) {
        if (StringPrototypeCharCodeAt(from, fromStart + i) ===
            CHAR_FORWARD_SLASH) {
          // We get here if \`to\` is the exact base path for \`from\`.
          // For example: from='/foo/bar/baz'; to='/foo/bar'
          lastCommonSep = i;
        } else if (i === 0) {
          // We get here if \`to\` is the root.
          // For example: from='/foo/bar'; to='/'
          lastCommonSep = 0;
        }
      }
    }

    let out = '';
    // Generate the relative path based on the path difference between \`to\`
    // and \`from\`.
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd ||
          StringPrototypeCharCodeAt(from, i) === CHAR_FORWARD_SLASH) {
        out += out.length === 0 ? '..' : '/..';
      }
    }

    // Lastly, append the rest of the destination (\`to\`) path that comes after
    // the common path parts.
    return \`\${out}\${StringPrototypeSlice(to, toStart + lastCommonSep)}\`;
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  toNamespacedPath(path) {
    // Non-op on posix systems
    return path;
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  dirname(path) {
    validateString(path, 'path');
    if (path.length === 0)
      return '.';
    const hasRoot = StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
    let end = -1;
    let matchedSlash = true;
    for (let i = path.length - 1; i >= 1; --i) {
      if (StringPrototypeCharCodeAt(path, i) === CHAR_FORWARD_SLASH) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1)
      return hasRoot ? '/' : '.';
    if (hasRoot && end === 1)
      return '//';
    return StringPrototypeSlice(path, 0, end);
  },

  /**
   * @param {string} path
   * @param {string} [suffix]
   * @returns {string}
   */
  basename(path, suffix) {
    if (suffix !== undefined)
      validateString(suffix, 'suffix');
    validateString(path, 'path');

    let start = 0;
    let end = -1;
    let matchedSlash = true;

    if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
      if (suffix === path)
        return '';
      let extIdx = suffix.length - 1;
      let firstNonSlashEnd = -1;
      for (let i = path.length - 1; i >= 0; --i) {
        const code = StringPrototypeCharCodeAt(path, i);
        if (code === CHAR_FORWARD_SLASH) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            start = i + 1;
            break;
          }
        } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === StringPrototypeCharCodeAt(suffix, extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end)
        end = firstNonSlashEnd;
      else if (end === -1)
        end = path.length;
      return StringPrototypeSlice(path, start, end);
    }
    for (let i = path.length - 1; i >= 0; --i) {
      if (StringPrototypeCharCodeAt(path, i) === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // path component
        matchedSlash = false;
        end = i + 1;
      }
    }

    if (end === -1)
      return '';
    return StringPrototypeSlice(path, start, end);
  },

  /**
   * @param {string} path
   * @returns {string}
   */
  extname(path) {
    validateString(path, 'path');
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;
    for (let i = path.length - 1; i >= 0; --i) {
      const char = path[i];
      if (char === '/') {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (char === '.') {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1)
          startDot = i;
        else if (preDotState !== 1)
          preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 ||
        end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        (preDotState === 1 &&
         startDot === end - 1 &&
         startDot === startPart + 1)) {
      return '';
    }
    return StringPrototypeSlice(path, startDot, end);
  },

  format: FunctionPrototypeBind(_format, null, '/'),

  /**
   * @param {string} path
   * @returns {{
   *   dir: string;
   *   root: string;
   *   base: string;
   *   name: string;
   *   ext: string;
   *   }}
   */
  parse(path) {
    validateString(path, 'path');

    const ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0)
      return ret;
    const isAbsolute =
      StringPrototypeCharCodeAt(path, 0) === CHAR_FORWARD_SLASH;
    let start;
    if (isAbsolute) {
      ret.root = '/';
      start = 1;
    } else {
      start = 0;
    }
    let startDot = -1;
    let startPart = 0;
    let end = -1;
    let matchedSlash = true;
    let i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    let preDotState = 0;

    // Get non-dir info
    for (; i >= start; --i) {
      const code = StringPrototypeCharCodeAt(path, i);
      if (code === CHAR_FORWARD_SLASH) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === CHAR_DOT) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1)
          startDot = i;
        else if (preDotState !== 1)
          preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (end !== -1) {
      const start = startPart === 0 && isAbsolute ? 1 : startPart;
      if (startDot === -1 ||
          // We saw a non-dot character immediately before the dot
          preDotState === 0 ||
          // The (right-most) trimmed path component is exactly '..'
          (preDotState === 1 &&
          startDot === end - 1 &&
          startDot === startPart + 1)) {
        ret.base = ret.name = StringPrototypeSlice(path, start, end);
      } else {
        ret.name = StringPrototypeSlice(path, start, startDot);
        ret.base = StringPrototypeSlice(path, start, end);
        ret.ext = StringPrototypeSlice(path, startDot, end);
      }
    }

    if (startPart > 0)
      ret.dir = StringPrototypeSlice(path, 0, startPart - 1);
    else if (isAbsolute)
      ret.dir = '/';

    return ret;
  },

  matchesGlob(path, pattern) {
    return lazyMatchGlobPattern()(path, pattern, false);
  },

  sep: '/',
  delimiter: ':',
  win32: null,
  posix: null,
};

posix.win32 = win32.win32 = win32;
posix.posix = win32.posix = posix;

// Legacy internal API, docs-only deprecated: DEP0080
win32._makeLong = win32.toNamespacedPath;
posix._makeLong = posix.toNamespacedPath;

module.exports = isWindows ? win32 : posix;
`,Gn=`// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Query String Utilities

'use strict';

const {
  Array,
  ArrayIsArray,
  Int8Array,
  MathAbs,
  NumberIsFinite,
  ObjectKeys,
  String,
  StringPrototypeCharCodeAt,
  StringPrototypeSlice,
  decodeURIComponent,
} = primordials;

const { Buffer } = require('buffer');
const {
  encodeStr,
  hexTable,
  isHexTable,
} = require('internal/querystring');
const QueryString = module.exports = {
  unescapeBuffer,
  // \`unescape()\` is a JS global, so we need to use a different local name
  unescape: qsUnescape,

  // \`escape()\` is a JS global, so we need to use a different local name
  escape: qsEscape,

  stringify,
  encode: stringify,

  parse,
  decode: parse,
};

const unhexTable = new Int8Array([
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 0 - 15
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 16 - 31
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 32 - 47
  +0, +1, +2, +3, +4, +5, +6, +7, +8, +9, -1, -1, -1, -1, -1, -1, // 48 - 63
  -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 64 - 79
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 80 - 95
  -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 96 - 111
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 112 - 127
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 128 ...
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,  // ... 255
]);
/**
 * A safe fast alternative to decodeURIComponent
 * @param {string} s
 * @param {boolean} decodeSpaces
 * @returns {string}
 */
function unescapeBuffer(s, decodeSpaces) {
  const out = Buffer.allocUnsafe(s.length);
  let index = 0;
  let outIndex = 0;
  let currentChar;
  let nextChar;
  let hexHigh;
  let hexLow;
  const maxLength = s.length - 2;
  // Flag to know if some hex chars have been decoded
  let hasHex = false;
  while (index < s.length) {
    currentChar = StringPrototypeCharCodeAt(s, index);
    if (currentChar === 43 /* '+' */ && decodeSpaces) {
      out[outIndex++] = 32; // ' '
      index++;
      continue;
    }
    if (currentChar === 37 /* '%' */ && index < maxLength) {
      currentChar = StringPrototypeCharCodeAt(s, ++index);
      hexHigh = unhexTable[currentChar];
      if (!(hexHigh >= 0)) {
        out[outIndex++] = 37; // '%'
        continue;
      } else {
        nextChar = StringPrototypeCharCodeAt(s, ++index);
        hexLow = unhexTable[nextChar];
        if (!(hexLow >= 0)) {
          out[outIndex++] = 37; // '%'
          index--;
        } else {
          hasHex = true;
          currentChar = hexHigh * 16 + hexLow;
        }
      }
    }
    out[outIndex++] = currentChar;
    index++;
  }
  return hasHex ? out.slice(0, outIndex) : out;
}

/**
 * @param {string} s
 * @param {boolean} decodeSpaces
 * @returns {string}
 */
function qsUnescape(s, decodeSpaces) {
  try {
    return decodeURIComponent(s);
  } catch {
    return QueryString.unescapeBuffer(s, decodeSpaces).toString();
  }
}


// These characters do not need escaping when generating query strings:
// ! - . _ ~
// ' ( ) *
// digits
// alpha (uppercase)
// alpha (lowercase)
const noEscape = new Int8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, // 80 - 95
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0,  // 112 - 127
]);

/**
 * QueryString.escape() replaces encodeURIComponent()
 * @see https://www.ecma-international.org/ecma-262/5.1/#sec-15.1.3.4
 * @param {any} str
 * @returns {string}
 */
function qsEscape(str) {
  if (typeof str !== 'string') {
    if (typeof str === 'object')
      str = String(str);
    else
      str += '';
  }

  return encodeStr(str, noEscape, hexTable);
}

/**
 * @param {string | number | bigint | boolean | symbol | undefined | null} v
 * @returns {string}
 */
function stringifyPrimitive(v) {
  if (typeof v === 'string')
    return v;
  if (typeof v === 'number' && NumberIsFinite(v))
    return '' + v;
  if (typeof v === 'bigint')
    return '' + v;
  if (typeof v === 'boolean')
    return v ? 'true' : 'false';
  return '';
}

/**
 * @param {string | number | bigint | boolean} v
 * @param {(v: string) => string} encode
 * @returns {string}
 */
function encodeStringified(v, encode) {
  if (typeof v === 'string')
    return (v.length ? encode(v) : '');
  if (typeof v === 'number' && NumberIsFinite(v)) {
    // Values >= 1e21 automatically switch to scientific notation which requires
    // escaping due to the inclusion of a '+' in the output
    return (MathAbs(v) < 1e21 ? '' + v : encode('' + v));
  }
  if (typeof v === 'bigint')
    return '' + v;
  if (typeof v === 'boolean')
    return v ? 'true' : 'false';
  return '';
}

/**
 * @param {string | number | boolean | null} v
 * @param {(v: string) => string} encode
 * @returns {string}
 */
function encodeStringifiedCustom(v, encode) {
  return encode(stringifyPrimitive(v));
}

/**
 * @param {Record<string, string | number | boolean
 * | ReadonlyArray<string | number | boolean> | null>} obj
 * @param {string} [sep]
 * @param {string} [eq]
 * @param {{ encodeURIComponent?: (v: string) => string }} [options]
 * @returns {string}
 */
function stringify(obj, sep, eq, options) {
  sep ||= '&';
  eq ||= '=';

  let encode = QueryString.escape;
  if (options && typeof options.encodeURIComponent === 'function') {
    encode = options.encodeURIComponent;
  }
  const convert =
    (encode === qsEscape ? encodeStringified : encodeStringifiedCustom);

  if (obj !== null && typeof obj === 'object') {
    const keys = ObjectKeys(obj);
    const len = keys.length;
    let fields = '';
    for (let i = 0; i < len; ++i) {
      const k = keys[i];
      const v = obj[k];
      let ks = convert(k, encode);
      ks += eq;

      if (ArrayIsArray(v)) {
        const vlen = v.length;
        if (vlen === 0) continue;
        if (fields)
          fields += sep;
        for (let j = 0; j < vlen; ++j) {
          if (j)
            fields += sep;
          fields += ks;
          fields += convert(v[j], encode);
        }
      } else {
        if (fields)
          fields += sep;
        fields += ks;
        fields += convert(v, encode);
      }
    }
    return fields;
  }
  return '';
}

/**
 * @param {string} str
 * @returns {number[]}
 */
function charCodes(str) {
  if (str.length === 0) return [];
  if (str.length === 1) return [StringPrototypeCharCodeAt(str, 0)];
  const ret = new Array(str.length);
  for (let i = 0; i < str.length; ++i)
    ret[i] = StringPrototypeCharCodeAt(str, i);
  return ret;
}
const defSepCodes = [38]; // &
const defEqCodes = [61]; // =

function addKeyVal(obj, key, value, keyEncoded, valEncoded, decode) {
  if (key.length > 0 && keyEncoded)
    key = decodeStr(key, decode);
  if (value.length > 0 && valEncoded)
    value = decodeStr(value, decode);

  if (obj[key] === undefined) {
    obj[key] = value;
  } else {
    const curValue = obj[key];
    // A simple Array-specific property check is enough here to
    // distinguish from a string value and is faster and still safe
    // since we are generating all of the values being assigned.
    if (curValue.pop)
      curValue[curValue.length] = value;
    else
      obj[key] = [curValue, value];
  }
}

/**
 * Parse a key/val string.
 * @param {string} qs
 * @param {string} sep
 * @param {string} eq
 * @param {{
 *   maxKeys?: number,
 *   decodeURIComponent?: (v: string) => string,
 * }} [options]
 * @returns {Record<string, string | string[]>}
 */
function parse(qs, sep, eq, options) {
  const obj = { __proto__: null };

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  const sepCodes = (!sep ? defSepCodes : charCodes(String(sep)));
  const eqCodes = (!eq ? defEqCodes : charCodes(String(eq)));
  const sepLen = sepCodes.length;
  const eqLen = eqCodes.length;

  let pairs = 1000;
  if (options && typeof options.maxKeys === 'number') {
    // -1 is used in place of a value like Infinity for meaning
    // "unlimited pairs" because of additional checks V8 (at least as of v5.4)
    // has to do when using variables that contain values like Infinity. Since
    // \`pairs\` is always decremented and checked explicitly for 0, -1 works
    // effectively the same as Infinity, while providing a significant
    // performance boost.
    pairs = (options.maxKeys > 0 ? options.maxKeys : -1);
  }

  let decode = QueryString.unescape;
  if (options && typeof options.decodeURIComponent === 'function') {
    decode = options.decodeURIComponent;
  }
  const customDecode = (decode !== qsUnescape);

  let lastPos = 0;
  let sepIdx = 0;
  let eqIdx = 0;
  let key = '';
  let value = '';
  let keyEncoded = customDecode;
  let valEncoded = customDecode;
  const plusChar = (customDecode ? '%20' : ' ');
  let encodeCheck = 0;
  for (let i = 0; i < qs.length; ++i) {
    const code = StringPrototypeCharCodeAt(qs, i);

    // Try matching key/value pair separator (e.g. '&')
    if (code === sepCodes[sepIdx]) {
      if (++sepIdx === sepLen) {
        // Key/value pair separator match!
        const end = i - sepIdx + 1;
        if (eqIdx < eqLen) {
          // We didn't find the (entire) key/value separator
          if (lastPos < end) {
            // Treat the substring as part of the key instead of the value
            key += StringPrototypeSlice(qs, lastPos, end);
          } else if (key.length === 0) {
            // We saw an empty substring between separators
            if (--pairs === 0)
              return obj;
            lastPos = i + 1;
            sepIdx = eqIdx = 0;
            continue;
          }
        } else if (lastPos < end) {
          value += StringPrototypeSlice(qs, lastPos, end);
        }

        addKeyVal(obj, key, value, keyEncoded, valEncoded, decode);

        if (--pairs === 0)
          return obj;
        keyEncoded = valEncoded = customDecode;
        key = value = '';
        encodeCheck = 0;
        lastPos = i + 1;
        sepIdx = eqIdx = 0;
      }
    } else {
      sepIdx = 0;
      // Try matching key/value separator (e.g. '=') if we haven't already
      if (eqIdx < eqLen) {
        if (code === eqCodes[eqIdx]) {
          if (++eqIdx === eqLen) {
            // Key/value separator match!
            const end = i - eqIdx + 1;
            if (lastPos < end)
              key += StringPrototypeSlice(qs, lastPos, end);
            encodeCheck = 0;
            lastPos = i + 1;
          }
          continue;
        } else {
          eqIdx = 0;
          if (!keyEncoded) {
            // Try to match an (valid) encoded byte once to minimize unnecessary
            // calls to string decoding functions
            if (code === 37/* % */) {
              encodeCheck = 1;
              continue;
            } else if (encodeCheck > 0) {
              if (isHexTable[code] === 1) {
                if (++encodeCheck === 3)
                  keyEncoded = true;
                continue;
              } else {
                encodeCheck = 0;
              }
            }
          }
        }
        if (code === 43/* + */) {
          if (lastPos < i)
            key += StringPrototypeSlice(qs, lastPos, i);
          key += plusChar;
          lastPos = i + 1;
          continue;
        }
      }
      if (code === 43/* + */) {
        if (lastPos < i)
          value += StringPrototypeSlice(qs, lastPos, i);
        value += plusChar;
        lastPos = i + 1;
      } else if (!valEncoded) {
        // Try to match an (valid) encoded byte (once) to minimize unnecessary
        // calls to string decoding functions
        if (code === 37/* % */) {
          encodeCheck = 1;
        } else if (encodeCheck > 0) {
          if (isHexTable[code] === 1) {
            if (++encodeCheck === 3)
              valEncoded = true;
          } else {
            encodeCheck = 0;
          }
        }
      }
    }
  }

  // Deal with any leftover key or value data
  if (lastPos < qs.length) {
    if (eqIdx < eqLen)
      key += StringPrototypeSlice(qs, lastPos);
    else if (sepIdx < sepLen)
      value += StringPrototypeSlice(qs, lastPos);
  } else if (eqIdx === 0 && key.length === 0) {
    // We ended on an empty substring
    return obj;
  }

  addKeyVal(obj, key, value, keyEncoded, valEncoded, decode);

  return obj;
}


/**
 * V8 does not optimize functions with try-catch blocks, so we isolate them here
 * to minimize the damage (Note: no longer true as of V8 5.4 -- but still will
 * not be inlined).
 * @param {string} s
 * @param {(v: string) => string} decoder
 * @returns {string}
 */
function decodeStr(s, decoder) {
  try {
    return decoder(s);
  } catch {
    return QueryString.unescape(s, true);
  }
}
`;const zn=Object.assign({"../../vendor/node-lib/internal/constants.js":Fn,"../../vendor/node-lib/internal/encoding/util.js":Hn,"../../vendor/node-lib/internal/per_context/domexception.js":$n,"../../vendor/node-lib/internal/per_context/messageport.js":Bn,"../../vendor/node-lib/internal/per_context/primordials.js":Wn,"../../vendor/node-lib/internal/querystring.js":qn,"../../vendor/node-lib/path.js":Vn,"../../vendor/node-lib/querystring.js":Gn}),he={};for(const[r,e]of Object.entries(zn)){const t=r.replace(/^.*vendor\/node-lib\//,"");he[t]=e}function De(r){return he[r]}Object.keys(he).sort();const Kn=["exports","require","module","__filename","__dirname","primordials","privateSymbols","perIsolateSymbols"];class Yn extends Error{filename;constructor(e,t){super(`Failed to compile ${e}: ${t instanceof Error?t.message:String(t)}`),this.name="CompileError",this.filename=e}}function Ne(r,e){try{return new Function(...Kn,r)}catch(t){throw new Yn(e,t)}}function je(){const r={};return new Proxy(r,{get(e,t){if(typeof t=="string")return e[t]??=Symbol(t)},has(){return!0}})}class Jn{primordials;privateSymbols;perIsolateSymbols;bindingIds;#e;#n=new Map;#t=new Map;#r;constructor(e){this.#e=Ut(e),this.bindingIds=[...this.#e.keys()].sort(),this.privateSymbols=je(),this.perIsolateSymbols=je(),this.primordials=this.#i(),this.#r={binding:e,internalBinding:t=>this.internalBinding(t),require:t=>this.require(t),primordials:this.primordials,privateSymbols:this.privateSymbols,perIsolateSymbols:this.perIsolateSymbols,builtinModuleIds:Ie};for(const t of Ze){this.#n.set(t.id,{exports:{},state:"unloaded",spec:t});for(const o of t.aliases??[])this.#t.set(o,t.id)}}setUserRequire(e){this.#r.userRequire=e}internalBinding(e){const t=this.#e.get(e);return t!==void 0?t:Ht(e)}hasBinding(e){return Ft(e)}#o(e){const t=e.startsWith("node:")?e.slice(5):e;return this.#t.get(e)??this.#t.get(t)??t}hasBuiltin(e){return typeof e!="string"?!1:this.#n.has(this.#o(e))}require(e){const t=this.#o(e),o=this.#n.get(t);if(!o)throw K("module",e,`Known core modules: ${Ie.join(", ")}.`);return this.#s(t,o)}#s(e,t){if(t.state==="loaded"||t.state==="loading")return t.exports;t.state="loading";for(const o of t.spec.deps??[])this.require(o);if(t.spec.vendorPath){const o=De(t.spec.vendorPath);if(o===void 0)throw K("module",e,`Vendored file vendor/node-lib/${t.spec.vendorPath} is missing. Run \`npm run vendor\`.`);const n=Ne(o,t.spec.vendorPath),s={exports:t.exports},i=e.startsWith("internal/")?`internal/${e.split("/").slice(1,-1).join("/")}`:"/";n(t.exports,h=>this.require(h),s,e,i,this.primordials,this.privateSymbols,this.perIsolateSymbols),t.exports=s.exports}else if(t.spec.init)t.exports=t.spec.init(this.#r);else throw new Error(`Builtin "${e}" has neither vendorPath nor init`);return t.state="loaded",t.exports}#i(){const e={},t=De("internal/per_context/primordials.js");if(t===void 0)throw new Error("Vendored primordials.js missing. Run `npm run vendor`.");return Ne(t,"internal/per_context/primordials.js")(e,()=>({}),{exports:e},"internal/per_context/primordials.js","internal/per_context",e,this.privateSymbols,this.perIsolateSymbols),e}listModules(){return[...this.#n.entries()].map(([e,t])=>({id:e,origin:t.spec.origin,state:t.state})).sort((e,t)=>e.id.localeCompare(t.id))}}function Xn(r){if(typeof r=="string")return r;if(r instanceof URL){if(r.protocol!=="file:")throw new TypeError(`The URL must be of scheme file, received '${r.protocol}'`);return decodeURIComponent(r.pathname)}if(r instanceof Uint8Array)return new TextDecoder().decode(r);throw new TypeError('The "path" argument must be of type string or an instance of Buffer or URL')}function te(r){if(r.length===0)return".";const e=r.charCodeAt(0)===47,t=r.charCodeAt(r.length-1)===47,o=r.split("/").filter(i=>i.length>0&&i!=="."),n=[];for(const i of o)i===".."?n.length>0&&n[n.length-1]!==".."?n.pop():e||n.push(".."):n.push(i);let s=n.join("/");return s.length===0?e?"/":".":(t&&(s+="/"),e?"/"+s:s)}function se(...r){let e="",t=!1;for(let n=r.length-1;n>=0&&!t;n--){const s=r[n];s&&(e=s+"/"+e,t=s.charCodeAt(0)===47)}t||(e="/"+e);const o=te(e);return o.length===0?"/":o.length>1&&o.endsWith("/")?o.slice(0,-1):o}function F(...r){return te(r.filter(e=>e&&e.length>0).join("/"))}function V(r){if(r.length===0)return".";const e=r.charCodeAt(0)===47;let t=-1,o=!0;for(let n=r.length-1;n>=1;n--)if(r.charCodeAt(n)===47){if(!o){t=n;break}}else o=!1;return t===-1?e?"/":".":e&&t===1?"//":r.slice(0,t)}function Zn(r,e){let t=0,o=-1,n=!0;for(let i=r.length-1;i>=0;i--)if(r.charCodeAt(i)===47){if(!n){t=i+1;break}}else o===-1&&(n=!1,o=i+1);return o===-1?"":r.slice(t,o)}function le(r){return r.charCodeAt(0)===47}function ce(r){return te(r).split("/").filter(e=>e.length>0)}let Qn=0;function Me(r){return`__wn_${r}_${Qn++}`}const Qe="__wn_exports",et="__wn_require",tt="__wn_import",q=Qe,re=et;function er(r){const e=[],t=r.length;let o=0,n=0;const s=[{depth:0,templateExpr:!1}];let i="",h="";const p=w=>{w>o&&e.push(r.slice(o,w)),o=w},g=/^(?:export\s+default\s+|export\s+)?(?:async\s+function|function|class|if|for|while|switch|try|do|with)\b/,a=w=>g.test(r.slice(o,w).trimStart()),m="(,=:[!&|?{};+-*%~^<>",c=new Set(["return","typeof","instanceof","in","of","new","delete","void","do","else","yield","await","case","throw"]),l=()=>i===""?!0:/[A-Za-z0-9_$]/.test(i)?c.has(h):m.includes(i);for(;n<t;){const w=s[s.length-1],b=r[n];if(w.templateExpr===!1&&s.length>1){if(b==="\\"){n+=2;continue}if(b==="`"){s.pop(),i="`",h="",n++;continue}if(b==="$"&&r[n+1]==="{"){s.push({depth:0,templateExpr:!0}),n+=2;continue}n++;continue}if(b==="'"||b==='"'){const v=b;for(n++;n<t;){if(r[n]==="\\"){n+=2;continue}if(r[n]===v){n++;break}if(r[n]===`
`&&v==="'")break;n++}i=v,h="";continue}if(b==="`"){s.push({depth:0,templateExpr:!1}),i="`",h="",n++;continue}if(b==="/"&&r[n+1]==="/"){for(;n<t&&r[n]!==`
`;)n++;continue}if(b==="/"&&r[n+1]==="*"){for(n+=2;n<t&&!(r[n]==="*"&&r[n+1]==="/");)n++;n+=2;continue}if(b==="/"&&l()){n++;let v=!1;for(;n<t;){const P=r[n];if(P==="\\"){n+=2;continue}if(P===`
`)break;if(P==="[")v=!0;else if(P==="]")v=!1;else if(P==="/"&&!v){n++;break}n++}for(;n<t&&/[a-z]/i.test(r[n]);)n++;i="/",h="";continue}if(b==="("||b==="["||b==="{"){w.depth++,i=b,h="",n++;continue}if(b===")"||b==="]"){w.depth--,i=b,h="",n++;continue}if(b==="}"){if(w.depth>0){const v=w.depth===1&&s.length===1&&a(n);w.depth--,i=b,h="",n++,v&&p(n);continue}if(w.templateExpr){s.pop(),i="}",h="",n++;continue}n++,p(n),i="}",h="";continue}if(b===";"&&w.depth===0){n++,p(n),i=";",h="";continue}if(/[A-Za-z_$]/.test(b)){let v=n+1;for(;v<t&&/[\w$]/.test(r[v]);)v++;const P=r.slice(n,v);if((P==="export"||P==="import")&&w.depth===0&&s.length===1){let C=v;for(;C<t&&/\s/.test(r[C]);)C++;const T=r[C];!(P==="import"&&(T==="("||T==="."))&&r.slice(o,n).trim()!==""&&p(n)}i=r[v-1],h=P,n=v;continue}if(/[0-9]/.test(b)){let v=n+1;for(;v<t&&/[0-9a-fA-FxX._]/.test(r[v]);)v++;i=r[v-1],h="",n=v;continue}/\s/.test(b)||(i=b,h=""),n++}return p(t),e}const tr=/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2/,nr=/^import\s+(['"])([^'"]+)\1/,rr=/\s+(?:assert|with)\s*\{[\s\S]*\}$/;function Le(r){return r.replace(rr,"")}function or(r){let e=r.replace(/^\s+/,"");for(;;){if(e.startsWith("//")){const t=e.indexOf(`
`);e=t<0?"":e.slice(t+1).replace(/^\s+/,"");continue}if(e.startsWith("/*")){const t=e.indexOf("*/");e=t<0?"":e.slice(t+2).replace(/^\s+/,"");continue}break}return e}function sr(r){return r.split(",").map(e=>e.trim()).filter(Boolean).map(e=>{const t=e.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);return t?`${t[1]}: ${t[2]}`:e}).join(", ")}function ir(r){const e=r.length,t=new Uint8Array(e).fill(1),o=[{depth:0,templateExpr:!1}];let n="",s="";const i="(,=:[!&|?{};+-*%~^<>",h=new Set(["return","typeof","instanceof","in","of","new","delete","void","do","else","yield","await","case","throw"]),p=()=>n===""?!0:/[A-Za-z0-9_$]/.test(n)?h.has(s):i.includes(n),g=(m,c)=>{for(let l=m;l<c&&l<e;l++)t[l]=0};let a=0;for(;a<e;){const m=o[o.length-1],c=r[a];if(m.templateExpr===!1&&o.length>1){if(c==="\\"){g(a,a+1),a+=2;continue}if(c==="`"){o.pop(),n="`",s="",a++;continue}if(c==="$"&&r[a+1]==="{"){g(a,a+1),o.push({depth:0,templateExpr:!0}),a+=2;continue}g(a,a+1),a++;continue}if(c==="'"||c==='"'){const l=c,w=a;for(a++;a<e;){if(r[a]==="\\"){a+=2;continue}if(r[a]===l){a++;break}if(r[a]===`
`&&l==="'")break;a++}g(w,a),n=l,s="";continue}if(c==="`"){o.push({depth:0,templateExpr:!1}),n="`",s="",a++;continue}if(c==="/"&&r[a+1]==="/"){const l=a;for(;a<e&&r[a]!==`
`;)a++;g(l,a);continue}if(c==="/"&&r[a+1]==="*"){const l=a;for(a+=2;a<e&&!(r[a]==="*"&&r[a+1]==="/");)a++;a=Math.min(e,a+2),g(l,a);continue}if(c==="/"&&p()){const l=a;a++;let w=!1;for(;a<e;){const b=r[a];if(b==="\\"){a+=2;continue}if(b===`
`)break;if(b==="[")w=!0;else if(b==="]")w=!1;else if(b==="/"&&!w){a++;break}a++}for(;a<e&&/[a-z]/i.test(r[a]);)a++;g(l,a),n="/",s="";continue}if(c==="("||c==="["||c==="{"){m.depth++,n=c,s="",a++;continue}if(c===")"||c==="]"){m.depth--,n=c,s="",a++;continue}if(c==="}"){m.depth>0?m.depth--:o.length>1&&m.templateExpr&&o.pop(),n=c,s="",a++;continue}if(/[A-Za-z_$]/.test(c)){let l=a+1;for(;l<e&&/[\w$]/.test(r[l]);)l++;s=r.slice(a,l),n=r[l-1],a=l;continue}if(/[0-9]/.test(c)){let l=a+1;for(;l<e&&/[0-9a-fA-FxX._]/.test(r[l]);)l++;n=r[l-1],s="",a=l;continue}/\s/.test(c)||(n=c,s=""),a++}return t}function ar(r){const e=ir(r),t=r.split("");for(let g=0;g<t.length;g++)e[g]||(t[g]=" ");const o=t.join(""),n=[],s=/\bimport\.meta(?:\.(url|filename|dirname))?\b|(?<![\w$.])import\s*\(/g;let i;for(;(i=s.exec(o))!==null;){const g=i.index,a=g+i[0].length;/^import\s*\(/.test(i[0])?n.push({start:g,end:a,text:`${tt}(`}):i[1]==="url"?n.push({start:g,end:a,text:"__mod_url"}):i[1]==="filename"?n.push({start:g,end:a,text:"__mod_file"}):i[1]==="dirname"?n.push({start:g,end:a,text:"__mod_dir"}):n.push({start:g,end:a,text:"({ url: __mod_url })"})}let h="",p=0;for(const g of n)h+=r.slice(p,g.start)+g.text,p=g.end;return h+r.slice(p)}function lr(r,e){const t=[],o=[],n=[];for(const p of er(r)){const g=or(p),a=Le(g).match(tr);if(a&&g.startsWith("import ")){const b=a[1],v=a[3];t.push(v);const P=Me("m"),C=[];let T=b.trim();const _=T.match(/^([A-Za-z_$][\w$]*)\s*(?:,([\s\S]*))?$/);let y=null,d=null;T.startsWith("*")?y=T.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/):T.startsWith("{")?d=T.match(/^\{([\s\S]*)\}$/):_&&(C.push(`${_[1]} = __wnDefault(${P})`),T=(_[2]??"").trim(),T.startsWith("*")?y=T.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/):T.startsWith("{")&&(d=T.match(/^\{([\s\S]*)\}$/))),o.push(`const ${P} = ${re}(${JSON.stringify(v)});`),y&&C.push(`${y[1]} = ${P}`),d&&C.push(`{ ${sr(d[1])} } = ${P}`),C.length>0&&o.push(`const ${C.join(", ")};`);continue}const m=Le(g).match(nr);if(m&&g.startsWith("import ")){t.push(m[2]),o.push(`${re}(${JSON.stringify(m[2])});`);continue}const c=g.match(/^export\s+([\s\S]+?)\s+from\s+(['"])([^'"]+)\2/);if(c){const b=c[1].trim(),v=c[3];if(t.push(v),b==="*")o.push(`Object.assign(${q}, ${re}(${JSON.stringify(v)}));`);else if(/^\*\s+as\s+/.test(b)){const P=b.replace(/^\*\s+as\s+/,"");o.push(`${q}.${P} = ${re}(${JSON.stringify(v)});`)}else{const P=b.match(/^\{([\s\S]*)\}$/);if(P){const C=Me("from");o.push(`const ${C} = ${re}(${JSON.stringify(v)});`);const T=P[1].split(",").map(_=>_.trim()).filter(Boolean).map(_=>{const y=_.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);return y?`${y[2]}: ${C}.${y[1]}`:`${_}: ${C}.${_}`}).join(", ");o.push(`Object.assign(${q}, { ${T} });`)}else o.push(p)}continue}if(/^export\s+default\s+/.test(g)){const b=g.replace(/^export\s+default\s+/,"");if(/^(async\s+)?function\b/.test(b)||/^class\b/.test(b)){const v=b.match(/(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1];o.push(b),o.push(`${q}.default = ${v??"undefined"};`)}else o.push(`${q}.default = ${b.replace(/;$/,"")};`);continue}const l=g.match(/^export\s*\{([\s\S]*)\}\s*;?$/);if(l){const b=l[1].split(",").map(v=>v.trim()).filter(Boolean).map(v=>{const P=v.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);return P?`${q}.${P[2]} = ${P[1]};`:`${q}.${v} = ${v};`}).join(" ");o.push(b);continue}const w=g.match(/^export\s+(const|let|var|async\s+function|function|class)\s+([\s\S]*)$/);if(w){const b=w[1],v=w[2];o.push(`${b} ${v}`.replace(/^async\s+function/,"async function")),n.push(v);continue}o.push(p)}const s=[];for(const p of n)if(/^(async\s+)?function/.test(p)||/^class/.test(p)){const g=p.match(/^(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/)?.[1];g&&s.push(`${q}.${g} = ${g};`)}else{const g=p.replace(/;?\s*$/,"").split(",");for(const a of g){const m=a.match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];m&&s.push(`${q}.${m} = ${m};`)}}const i=`Object.defineProperty(${q}, '__esModule', { value: true });
function __wnDefault(m) { return (m && m.__esModule) ? m.default : m; }
const __mod_url = ${JSON.stringify(e)};
const __mod_file = __mod_url.replace(/^file:\\/\\//, '');
const __mod_dir = __mod_file.slice(0, __mod_file.lastIndexOf('/')) || '/';
`;return{code:ar(i+o.join(`
`)+`
`+s.join(`
`)),imports:t}}const cr=["exports","require","module","__filename","__dirname"],dr=["",".js",".cjs",".mjs",".json"],pe="\0web-node:empty";function ur(r){return r==="import"?["node","import","default"]:["node","require","default"]}class hr{#e;#n;#t=new Map;#r;#o;#s;#i;#a;constructor(e,t,o={}){this.#e=e,this.#n=t,this.#r=o,this.#o={},this.#c()}setGlobals(e){this.#r=e,this.#c()}setAliases(e){this.#o={...e}}get aliases(){return{...this.#o}}#l(e){if(e.startsWith(".")||le(e))return e;const t=this.#o[e];if(t)return t;const o=e.indexOf("/"),n=e.startsWith("@")?e.indexOf("/",o+1):o;if(n>0){const s=e.slice(0,n),i=this.#o[s];if(i)return i+e.slice(n)}return e}#c(){const e=globalThis,t=[],o=[];for(const[n,s]of Object.entries(this.#r))s!==e[n]&&(t.push(n),o.push(s));this.#s=t,this.#i=o,this.#a=[...cr,...t]}get realm(){return this.#e}resolve(e,t,o="require"){if(e=this.#l(e),e.startsWith(".")||le(e)){const s=se(t,e),i=this.#m(s);if(i)return i;throw Object.assign(new Error(`Cannot find module '${e}' from '${t}'`),{code:"MODULE_NOT_FOUND"})}const n=ce(t);for(let s=n.length;s>=0;s--){const i="/"+n.slice(0,s).concat("node_modules").join("/"),h=this.#p(i,e,o);if(h)return h}throw Object.assign(new Error(`Cannot find module '${e}' from '${t}'`),{code:"MODULE_NOT_FOUND"})}#p(e,t,o){const n=t.startsWith("@"),s=t.indexOf("/");let i;n?i=s<0?-1:t.indexOf("/",s+1):i=s;const h=i<0?t:t.slice(0,i),p=i<0?"":t.slice(i+1);if(h==="")return null;const g=F(e,h);if(!this.#n.exists(g)||this.#n.stat(g).type!=="dir")return null;const a=this.#d(g);if(a?.exports!==void 0){const m=this.#f(a.exports,g,p,ur(o));if(m){const c=this.#m(m);if(c)return c}}if(p===""){if(a){const m=this.#y(g,a);if(m)return m}return this.#m(g)}return this.#m(F(g,p))}#f(e,t,o,n){const s=o===""?".":"./"+o,i=this.#h(e,s,n);return i?F(t,i):null}#h(e,t,o){if(typeof e=="string")return e.startsWith("./")?e:null;if(Array.isArray(e)){for(const n of e){const s=this.#h(n,t,o);if(s)return s}return null}if(e&&typeof e=="object"){const n=e,s=Object.keys(n);if(s.some(h=>h.startsWith("."))){let h=null,p="";for(const a of s){if(!a.startsWith("."))continue;if(a===t){h=a,p="";break}const m=a.indexOf("*");if(m>=0){const c=a.slice(0,m),l=a.slice(m+1);t.startsWith(c)&&t.endsWith(l)&&t.length>=a.length-1&&(!h||a.length>h.length)&&(h=a,p=t.slice(c.length,t.length-l.length))}}if(!h)return null;const g=this.#h(n[h],t,o);return g&&p!==""?g.split("*").join(p):g}for(const h of o)if(Object.prototype.hasOwnProperty.call(n,h)){const p=this.#h(n[h],t,o);if(p)return p}return null}return null}#d(e){const t=F(e,"package.json");if(!this.#n.exists(t))return null;try{return JSON.parse(new TextDecoder().decode(this.#n.readFile(t)))}catch{return null}}#g(e){let t=e;for(let o=0;o<40;o++){const n=this.#d(t);if(n)return{dir:t,json:n};const s=V(t);if(s===t)break;t=s}return null}#u(e,t){const o=this.#g(V(t));if(!o)return null;const n=o.json.browser;if(!n||typeof n!="object")return null;const s=n,i=a=>{if(!Object.prototype.hasOwnProperty.call(s,a))return;const m=s[a];return m===!1?pe:m};if(!e.startsWith(".")&&!le(e)){const a=i(e);return a===void 0?null:a}const h=se(V(t),e),p="./"+this.#b(o.dir,h),g=p.replace(/\.(js|cjs|mjs|json)$/,"");for(const a of[p,g,g+".js",g+".cjs",g+".mjs",g+".json"]){const m=i(a);if(m!==void 0)return m}return null}#b(e,t){const o=ce(e),n=ce(t);let s=0;for(;s<o.length&&s<n.length&&o[s]===n[s];)s++;return[...o.slice(s).map(()=>".."),...n.slice(s)].join("/")}#y(e,t){const o=[];if(typeof t.browser=="string")o.push(t.browser);else if(t.browser&&typeof t.browser=="object"){const n=t.browser,s=t.main??"index.js",i="./"+s.replace(/^\.\//,"").replace(/\.js$/,"");for(const h of[".",s,"./"+s.replace(/^\.\//,""),i,i+".js"]){const p=n[h];if(typeof p=="string"){o.push(p);break}}}t.main&&o.push(t.main),t.module&&o.push(t.module),o.push("index.js","index.cjs","index.mjs","index.json");for(const n of o){const s=this.#m(F(e,n));if(s)return s}return null}#m(e){for(const t of dr){const o=e+t;if(this.#n.exists(o)&&this.#n.stat(o).type==="file")return o}if(this.#n.exists(e)&&this.#n.stat(e).type==="dir"){const t=this.#d(e);if(t){const o=this.#y(e,t);if(o)return o}for(const o of["index.js","index.cjs","index.mjs","index.json"]){const n=F(e,o);if(this.#n.exists(n))return n}}return null}require=(e,t,o="require")=>{if(typeof t!="string")throw new TypeError(`The "id" argument must be of type string. Received ${typeof t}`);const n=this.#u(t,e);if(n===pe)return{};if(n!==null&&(t=n),this.#e.hasBuiltin(t))return this.#e.require(t);if(t.startsWith("node:"))throw K("module",t,"Only whitelisted core modules are exposed.");const s=V(e),i=this.resolve(t,s,o);return this.loadModule(i)};loadModule(e){const t=this.#t.get(e);if(t)return t.exports;if(e.endsWith(".json")){const b=new TextDecoder().decode(this.#n.readFile(e)),v=JSON.parse(b);return this.#t.set(e,{exports:v,state:"loaded"}),v}const o=new TextDecoder().decode(this.#n.readFile(e)),n=e.endsWith(".mjs")||e.endsWith(".js")&&this.#S(e),s={exports:{},state:"loading"};this.#t.set(e,s);const i=n?lr(o,`file://${e}`).code:o,h=V(e),p=n?[Qe,et,tt,...this.#s]:this.#a;let g;try{g=new Function(...p,i)}catch(b){throw this.#t.delete(e),new Error(`Failed to compile ${e}: ${b instanceof Error?b.message:String(b)}`)}const a={exports:s.exports},m=n?"import":"require",c=Object.assign(b=>this.require(e,b,m),{resolve:(b,v)=>{const P=v?.paths?.[0]??h,C=this.#u(b,e);return this.resolve(C&&C!==pe?C:b,P,m)}}),l=this.#i,w=b=>Promise.resolve().then(()=>this.require(e,b,"import"));try{n?g(a.exports,c,w,...l):g(a.exports,c,a,e,h,...l)}catch(b){throw this.#t.delete(e),globalThis.__WN_DEBUG__&&console.error("load error in",e,b),b}return s.exports=a.exports,s.state="loaded",s.exports}#S(e){let t=V(e);for(let o=0;o<20;o++){const n=this.#d(t);if(n)return n.type==="module";const s=V(t);if(s===t)break;t=s}return!1}get loadedModules(){return[...this.#t.keys()].sort()}reset(){this.#t.clear()}}const pr=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,fr=/^([0-9xX*]+(?:\.[0-9xX*]+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;function nt(r){const e=pr.exec(String(r).trim());return e?{major:Number(e[1]),minor:Number(e[2]),patch:Number(e[3]),prerelease:e[4]?rt(e[4]):[],build:e[5]?e[5].split("."):[]}:null}function rt(r){return r.split(".").map(e=>/^\d+$/.test(e)?Number(e):e)}function mr(r,e){const t=typeof r=="number",o=typeof e=="number";return t&&o?r-e:t?-1:o?1:String(r)<String(e)?-1:String(r)>String(e)?1:0}function oe(r,e){if(r.major!==e.major)return r.major-e.major;if(r.minor!==e.minor)return r.minor-e.minor;if(r.patch!==e.patch)return r.patch-e.patch;const t=r.prerelease,o=e.prerelease;if(t.length===0&&o.length===0)return 0;if(t.length===0)return 1;if(o.length===0)return-1;const n=Math.min(t.length,o.length);for(let s=0;s<n;s++){const i=mr(t[s],o[s]);if(i!==0)return i}return t.length-o.length}function D(r,e,t,o=[]){return{major:r,minor:e,patch:t,prerelease:o,build:[]}}function me(r){const e=fr.exec(r.trim());return e?{nums:e[1].split(".").map(o=>/^\d+$/.test(o)?Number(o):"x"),pre:e[2]?rt(e[2]):[]}:null}function gr(r){const e=r.trim();if(e===""||e==="*"||e==="x"||e==="X")return{bound:{any:!0},hasPre:!1,tuple:null};const t=/^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(e);if(!t)return null;const o=t[1]??"",n=me(t[2]);if(!n)return null;const{nums:s,pre:i}=n,h=s.indexOf("x"),p=h===-1?s.length:h,g=p>0?s[0]:0,a=p>1?s[1]:0,m=p>2?s[2]:0,c=i.length>0,l=p>=3?D(g,a,m,i):null,w=()=>{const b=D(g,p>1?a:0,p>2?m:0,i);return{bound:{gte:b,lte:b},hasPre:c,tuple:l}};switch(o){case"":case"=":return p===0?{bound:{any:!0},hasPre:c,tuple:null}:p>=3?w():p===2?{bound:{gte:D(g,a,0,i),lt:D(g,a+1,0)},hasPre:c,tuple:l}:{bound:{gte:D(g,0,0,i),lt:D(g+1,0,0)},hasPre:c,tuple:l};case"^":{if(p===0)return{bound:{any:!0},hasPre:c,tuple:null};const b=D(g,p>1?a:0,p>2?m:0,i);let v;return p>=3?g>0?v=D(g+1,0,0):a>0?v=D(0,a+1,0):v=D(0,0,m+1):p===2?v=g>0?D(g+1,0,0):D(0,a+1,0):v=D(g+1,0,0),{bound:{gte:b,lt:v},hasPre:c,tuple:l}}case"~":{if(p===0)return{bound:{any:!0},hasPre:c,tuple:null};const b=D(g,p>1?a:0,p>2?m:0,i),v=p>=2?D(g,a+1,0):D(g+1,0,0);return{bound:{gte:b,lt:v},hasPre:c,tuple:l}}case">":return p===0?{bound:{any:!0},hasPre:c,tuple:null}:p>=3?{bound:{gt:D(g,a,m,i)},hasPre:c,tuple:l}:p===2?{bound:{gte:D(g,a+1,0)},hasPre:c,tuple:l}:{bound:{gte:D(g+1,0,0)},hasPre:c,tuple:l};case">=":return p===0?{bound:{any:!0},hasPre:c,tuple:null}:{bound:{gte:D(g,p>1?a:0,p>2?m:0,i)},hasPre:c,tuple:l};case"<":return p===0?{bound:{any:!0},hasPre:c,tuple:null}:{bound:{lt:D(g,p>1?a:0,p>2?m:0,i)},hasPre:c,tuple:l};case"<=":return p===0?{bound:{any:!0},hasPre:c,tuple:null}:p>=3?{bound:{lte:D(g,a,m,i)},hasPre:c,tuple:l}:p===2?{bound:{lt:D(g,a+1,0)},hasPre:c,tuple:l}:{bound:{lt:D(g+1,0,0)},hasPre:c,tuple:l};default:return null}}function yr(r,e){const t=me(r),o=me(e);if(!t||!o)return null;const n=[],s=t.nums.indexOf("x")===-1?t.nums.length:t.nums.indexOf("x");n.push({bound:{gte:D(t.nums[0]||0,s>1?t.nums[1]:0,s>2?t.nums[2]:0,t.pre)},hasPre:t.pre.length>0,tuple:null});const i=o.nums.indexOf("x")===-1?o.nums.length:o.nums.indexOf("x");return i>=3?n.push({bound:{lte:D(o.nums[0],o.nums[1],o.nums[2],o.pre)},hasPre:o.pre.length>0,tuple:null}):i===2?n.push({bound:{lt:D(o.nums[0],o.nums[1]+1,0)},hasPre:!1,tuple:null}):n.push({bound:{lt:D(o.nums[0]+1,0,0)},hasPre:!1,tuple:null}),{comps:n}}function br(r){const e=String(r).trim();if(e==="")return[{comps:[{bound:{any:!0},hasPre:!1,tuple:null}]}];const t=[];for(const o of e.split("||")){const n=o.trim();if(n==="")continue;const s=/^(\S+)\s+-\s+(\S+)$/.exec(n);if(s){const p=yr(s[1],s[2]);p&&t.push(p);continue}const i=[];let h=!0;for(const p of n.split(/\s+/).filter(Boolean)){const g=gr(p);if(!g){h=!1;break}i.push(g)}h&&i.length&&t.push({comps:i})}return t.length?t:null}function Sr(r,e){return e.any?!0:!(e.gt&&oe(r,e.gt)<=0||e.gte&&oe(r,e.gte)<0||e.lt&&oe(r,e.lt)>=0||e.lte&&oe(r,e.lte)>0)}function wr(r,e){return r.major===e.major&&r.minor===e.minor&&r.patch===e.patch}function ot(r,e,t=!1){const o=nt(r);if(!o)return!1;const n=br(e);return n?n.some(s=>s.comps.every(i=>Sr(o,i.bound))?o.prerelease.length>0&&!t?s.comps.some(i=>i.hasPre&&i.tuple!==null&&wr(o,i.tuple)):!0:!1):!1}function Er(r,e,t=!1){let o=null,n=null;for(const s of r){const i=nt(s);i&&ot(s,e,t)&&(o===null||oe(i,o)>0)&&(o=i,n=s)}return n}const Q=512;async function vr(r){const e=r.getReader(),t=[];let o=0;for(;;){const{done:i,value:h}=await e.read();if(i)break;t.push(h),o+=h.length}const n=new Uint8Array(o);let s=0;for(const i of t)n.set(i,s),s+=i.length;return n}function Ar(r){return r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength)}async function Pr(r){const e=new Blob([Ar(r)]).stream().pipeThrough(new DecompressionStream("gzip"));return vr(e)}function ge(r,e,t){let o=e;const n=Math.min(e+t,r.length);for(;o<n&&r[o]!==0;)o++;return new TextDecoder().decode(r.subarray(e,o))}function Ue(r,e,t){if(r[e]&128){let s=0;for(let i=e+1;i<e+t;i++)s=s*256+r[i];return s}const o=ge(r,e,t).trim();if(o==="")return 0;const n=parseInt(o,8);return Number.isNaN(n)?0:n}function _r(r){const e=new TextDecoder().decode(r),t={};let o=0;for(;o<e.length;){const n=e.indexOf(" ",o);if(n===-1)break;const s=parseInt(e.slice(o,n),10);if(!Number.isFinite(s)||s<=0)break;const i=e.slice(n+1,o+s-1),h=i.indexOf("=");if(h!==-1){const p=i.slice(0,h),g=i.slice(h+1);p==="path"?t.path=g:p==="size"?t.size=parseInt(g,10):p==="linkpath"&&(t.linkpath=g)}o+=s}return t}function Rr(r){let e=r;return e.startsWith("./")&&(e=e.slice(2)),e.startsWith("package/")?e=e.slice(8):e==="package"&&(e=""),e}function xr(r){const e=[];let t=0,o={},n=null;for(;t+Q<=r.length;){let s=!0;for(let v=0;v<Q;v++)if(r[t+v]!==0){s=!1;break}if(s)break;const i=r.subarray(t,t+Q);let h=ge(i,0,100);const p=ge(i,345,155);p.length>0&&!h.startsWith("/")&&(h=`${p}/${h}`);let g=Ue(i,124,12);const a=Ue(i,100,8)||420,m=String.fromCharCode(i[156]||48),c=t+Q,l=c+g,w=r.subarray(c,Math.min(l,r.length));if(t=c+Math.ceil(g/Q)*Q,m==="x"||m==="g"){const v=_r(w);m==="x"&&(o=v);continue}if(m==="L"){n=new TextDecoder().decode(w).replace(/\0[\s\S]*$/,"");continue}n!==null&&(h=n,n=null),o.path&&(h=o.path),o.size!==void 0&&(g=o.size),o={};const b=Rr(h);if(b!==""){if(m==="5"||b.endsWith("/")){e.push({path:b.replace(/\/+$/,""),type:"dir",data:new Uint8Array(0),mode:a});continue}(m==="0"||m==="\0"||m==="")&&e.push({path:b,type:"file",data:w.slice(),mode:a})}}return e}async function Cr(r){return xr(await Pr(r))}const Tr="https://registry.npmjs.org";function Or(r,e=Tr){const t=e.replace(/\/+$/,""),o=new Map,n=new Map,s=i=>`${t}/${i.replace("/","%2f")}`;return{baseUrl:t,packument(i){let h=o.get(i);return h||(h=(async()=>{const p=await r(s(i),{headers:{accept:"application/vnd.npm.install-v1+json, application/json"}});if(!p.ok)throw new Error(`registry request for "${i}" failed: HTTP ${p.status}${p.statusText?` ${p.statusText}`:""}`);const g=await p.json();if(!g||!g.versions||Object.keys(g.versions).length===0)throw new Error(`registry returned no versions for "${i}"`);return g})(),o.set(i,h),h)},tarball(i){let h=n.get(i);return h||(h=(async()=>{const p=await r(i);if(!p.ok)throw new Error(`tarball download failed: HTTP ${p.status} ${i}`);return new Uint8Array(await p.arrayBuffer())})(),n.set(i,h),h)}}}const ee="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",kr=(()=>{const r=new Int16Array(256).fill(-1);for(let e=0;e<ee.length;e++)r[ee.charCodeAt(e)]=e;return r})();function Ee(r){let e="";for(let t=0;t<r.length;t+=3){const o=r[t],n=t+1<r.length?r[t+1]:0,s=t+2<r.length?r[t+2]:0;e+=ee[o>>2],e+=ee[(o&3)<<4|n>>4],e+=t+1<r.length?ee[(n&15)<<2|s>>6]:"=",e+=t+2<r.length?ee[s&63]:"="}return e}function st(r){let e=r.length;for(;e>0&&r.charCodeAt(e-1)===61;)e--;const t=Math.floor(e*3/4),o=new Uint8Array(t);let n=0,s=0,i=0;for(let h=0;h<e;h++){const p=kr[r.charCodeAt(h)];p<0||(s=s<<6|p,i+=6,i>=8&&(i-=8,o[n++]=s>>i&255))}return n===t?o:o.subarray(0,n)}const Ir={sha512:"SHA-512",sha256:"SHA-256",sha1:"SHA-1"};function Dr(r){const e=[];for(const t of r.trim().split(/\s+/)){if(!t)continue;const o=t.indexOf("-");o<=0||e.push({algorithm:t.slice(0,o).toLowerCase(),base64:t.slice(o+1)})}return e}function Nr(r){let e="";for(const t of r)e+=t.toString(16).padStart(2,"0");return e}function jr(r){return Ee(r).replace(/=+$/,"")}function Mr(r){return r.replace(/=+$/,"")}async function Fe(r,e){const t=Ir[r],o=globalThis.crypto?.subtle;if(!t||!o)return null;try{const n=e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength);return new Uint8Array(await o.digest(t,n))}catch{return null}}async function Lr(r,e){const t=(e.integrity??"").trim();if(t){const n=Dr(t);let s=0;for(const i of n){const h=await Fe(i.algorithm,r);if(h&&(s+=1,jr(h)===Mr(i.base64)))return t}if(s>0)throw new Error(`integrity check failed (expected ${t})`)}const o=(e.shasum??"").trim().toLowerCase();if(o){const n=await Fe("sha1",r);if(n){if(Nr(n)!==o)throw new Error(`shasum check failed (expected ${o})`);return`sha1-${Ee(n)}`}}}const it="package-lock.json";function Ur(r){return new TextDecoder().decode(r)}function Fr(r){const e=r.split("node_modules/"),t=e[e.length-1];if(!t||e.length<2)return null;const o=t.split("/");return o[0].startsWith("@")?o.length>=2?`${o[0]}/${o[1]}`:null:o[0]||null}function Hr(r,e){const t=F(e,it);if(!r.exists(t))return new Map;try{const o=JSON.parse(Ur(r.readFile(t))),n=new Map;for(const[s,i]of Object.entries(o.packages??{}))s&&i&&typeof i.version=="string"&&n.set(s,i);return n}catch{return new Map}}function $r(r){const e=new Map,t=[...r.entries()].sort((o,n)=>o[0].split("/").length-n[0].split("/").length);for(const[o,n]of t){const s=Fr(o);s&&!e.has(s)&&e.set(s,n)}return e}function Br(r,e){const t={"":{version:r.version??"0.0.0",...r.dependencies?{dependencies:r.dependencies}:{},...r.devDependencies?{devDependencies:r.devDependencies}:{}}};for(const{path:n,entry:s}of[...e].sort((i,h)=>i.path.localeCompare(h.path)))t[n]=s;const o={...r.name?{name:r.name}:{},version:r.version??"0.0.0",lockfileVersion:3,requires:!0,packages:t};return`${JSON.stringify(o,null,2)}
`}function Wr(r,e,t){r.writeFile(F(e,it),new TextEncoder().encode(t))}function qr(r,e){const t={version:r.version};return e.resolved&&(t.resolved=e.resolved),e.integrity&&(t.integrity=e.integrity),e.dev&&(t.dev=!0),r.dependencies&&Object.keys(r.dependencies).length&&(t.dependencies=r.dependencies),r.optionalDependencies&&Object.keys(r.optionalDependencies).length&&(t.optionalDependencies=r.optionalDependencies),r.peerDependencies&&Object.keys(r.peerDependencies).length&&(t.peerDependencies=r.peerDependencies,r.peerDependenciesMeta&&Object.keys(r.peerDependenciesMeta).length&&(t.peerDependenciesMeta=r.peerDependenciesMeta)),r.bin&&(t.bin=r.bin),r.os&&r.os.length&&(t.os=r.os),r.cpu&&r.cpu.length&&(t.cpu=r.cpu),t}function fe(r,e){e&&e!=="/"&&r.mkdir(e,{recursive:!0})}function Vr(r){return new TextDecoder().decode(r)}function He(r){const e=new Set;for(const[t,o]of Object.entries(r??{}))o?.optional&&e.add(t);return e}function $e(r,e){return!r||r.length===0?!0:r.includes("any")||r.includes(e)}function Gr(r,e){const t=se(r).split("/").filter(Boolean),o=se(e).split("/").filter(Boolean);let n=0;for(;n<t.length&&n<o.length&&t[n]===o[n];)n+=1;return[...Array(t.length-n).fill(".."),...o.slice(n)].join("/")}async function zr(r,e){const t=e.log??(()=>{}),o=typeof e.registry=="object"&&e.registry!==null?e.registry:Or(e.fetch,typeof e.registry=="string"?e.registry:void 0),n=F(e.cwd,"package.json");if(!r.exists(n))throw new Error(`npm install: no package.json found in ${e.cwd}`);const s=JSON.parse(Vr(r.readFile(n))),i={...s.dependencies??{}},h=e.includeDev?{...s.devDependencies??{}}:{};if(Object.assign(i,h),Object.keys(i).length===0)return t("nothing to install — no dependencies declared"),{packages:0,installed:[],warnings:[],fromLockfile:0};const p=e.lockfile===!1?new Map:$r(Hr(r,e.cwd));let g=0;const a=F(e.cwd,"node_modules"),m=e.platform??"linux",c=e.arch??"wasm32",l=[],w=[],b=new Map,v=new Map;let P=e.maxPackages??512;const C=async(u,f,E=!1)=>{const R=B=>{E||l.push(B)},x=(f??"").trim()||"*";if(/^(file:|link:|git\+|git:|https?:)/i.test(x))return R(`skipped ${u}: unsupported specifier "${x}"`),null;const O=p.get(u);if(O&&O.resolved&&ot(O.version,x))return g+=1,{name:u,version:O.version,dependencies:O.dependencies??{},optionalDependencies:O.optionalDependencies??{},peerDependencies:O.peerDependencies??{},peerOptional:He(O.peerDependenciesMeta),peerDependenciesMeta:O.peerDependenciesMeta,bin:O.bin,os:O.os,cpu:O.cpu,tarball:O.resolved,integrity:O.integrity,fromLock:!0};const k=await o.packument(u),j=k["dist-tags"]?.[x]??Er(Object.keys(k.versions),x)??void 0;if(!j||!k.versions[j])return R(`no version of ${u} satisfies "${x}"`),null;const N=k.versions[j];return{name:u,version:j,dependencies:N.dependencies??{},optionalDependencies:N.optionalDependencies??{},peerDependencies:N.peerDependencies??{},peerOptional:He(N.peerDependenciesMeta),peerDependenciesMeta:N.peerDependenciesMeta,bin:N.bin,os:N.os,cpu:N.cpu,tarball:N.dist?.tarball,integrity:N.dist?.integrity??(N.dist?.shasum?`sha1-${N.dist.shasum}`:void 0),fromLock:!1}},T=u=>{for(const[f,E]of Object.entries(u.peerDependencies))u.peerOptional.has(f)||v.has(f)||v.set(f,{range:E,by:`${u.name}@${u.version}`})},_=async(u,f,E,R)=>{for(const[x,O]of Object.entries(u)){let k;try{k=await C(x,O,R==="optional")}catch(Y){if(R==="optional")continue;l.push(`${x}: ${Y.message}`);continue}if(!k)continue;if(!$e(k.os,m)||!$e(k.cpu,c)){R!=="optional"&&l.push(`${x}: skipped, does not match ${m}/${c}`);continue}let M=null;for(const Y of f){const ve=b.get(Y)?.get(x);if(ve===void 0||ve===k.version){M=Y;break}}M===null&&(M=F(E,"node_modules"));let j=b.get(M);if(j||(j=new Map,b.set(M,j)),j.get(x)===k.version)continue;if(j.has(x)){l.push(`version conflict for ${x} at ${M}; kept ${j.get(x)}, skipped ${k.version}`);continue}if(P--<=0){l.push("package budget exceeded — stopping resolution");return}j.set(x,k.version),t(`+ ${k.name}@${k.version}`),w.push({nmDir:M,resolved:k}),T(k);const N=f.indexOf(M),B=N>=0?f.slice(0,N+1):[...f,M],G=F(M,x);await _(k.dependencies,[...B,F(G,"node_modules")],G,"required"),await _(k.optionalDependencies,[...B,F(G,"node_modules")],G,"optional")}};await _(i,[a],e.cwd,"required");const y={};for(const[u,f]of v)[...b.values()].some(R=>R.has(u))||(y[u]=f.range,t(`peer  ${u}@${f.range} (required by ${f.by})`));Object.keys(y).length>0&&await _(y,[a],e.cwd,"required");const d=new Map,S=[],A=[];for(const{nmDir:u,resolved:f}of w){const E=`${f.name}@${f.version}`;let R=d.get(E),x=f.integrity;if(!R){if(!f.tarball){l.push(`${E}: no tarball URL (registry or lockfile)`);continue}t(`↓ ${E}${f.fromLock?" (lockfile)":""}`);const j=await o.tarball(f.tarball),N=await Lr(j,{tarball:f.tarball,integrity:f.integrity});N&&(x=N),R=await Cr(j),d.set(E,R)}const O=F(u,f.name);fe(r,O);for(const j of R){const N=F(O,j.path);j.type==="dir"?fe(r,N):(fe(r,V(N)),r.writeFile(N,j.data))}S.push({name:f.name,version:f.version,path:O});const k={name:f.name,version:f.version,dependencies:f.dependencies,optionalDependencies:f.optionalDependencies,peerDependencies:f.peerDependencies,peerDependenciesMeta:f.peerDependenciesMeta,bin:f.bin,os:f.os,cpu:f.cpu,dist:{tarball:f.tarball??""}},M=Gr(e.cwd,O);A.push({path:M,entry:qr(k,{resolved:f.tarball,integrity:x,dev:!!h[f.name]&&!(s.dependencies??{})[f.name]})})}return e.lockfile!==!1&&Wr(r,e.cwd,Br(s,A)),{packages:S.length,installed:S,warnings:l,fromLockfile:g}}class ye extends Error{code;constructor(e){super(`process.exit(${e})`),this.name="ProcessExit",this.code=e}}const Be=globalThis.setTimeout.bind(globalThis),Kr=globalThis.clearTimeout.bind(globalThis),Yr=globalThis.setInterval.bind(globalThis),Jr=globalThis.clearInterval.bind(globalThis),Xr=["crypto","performance","WebAssembly","TextEncoder","TextDecoder","URL","URLSearchParams","Blob","File","FormData","Headers","Request","Response","fetch","WebSocket","Worker","MessageChannel","MessagePort","BroadcastChannel","structuredClone","atob","btoa","AbortController","AbortSignal","Event","EventTarget","location","navigator","self","origin","caches"];class Zr{vfs;realm;loader;bindingCtx;network;process;console;Buffer;#e=new Map;#n=1;#t=null;constructor(e){this.vfs=e.vfs;const t=e.argv??[],o=e.env??{},n=e.onStdout??(()=>{}),s=e.onStderr??(()=>{}),i={vfs:e.vfs,network:new ct,env:o,argv:t,execPath:e.execPath??"/bin/node",writeStdout:n,writeStderr:s,exit:a=>{throw this.#t=a,new ye(a)},nextTick:(a,...m)=>queueMicrotask(()=>a(...m)),timers:{setTimeout:(a,m,...c)=>{const l=this.#n++,w=Be(()=>{this.#e.delete(l),a(...c)},Math.max(1,m||0));return this.#e.set(l,w),l},clearTimeout:a=>this.#o(a),setInterval:(a,m,...c)=>{const l=this.#n++,w=Yr(()=>a(...c),Math.max(1,m||0));return this.#e.set(l,w),l},clearInterval:a=>this.#o(a),setImmediate:(a,...m)=>{const c=this.#n++,l=Be(()=>{this.#e.delete(c),a(...m)},0);return this.#e.set(c,l),c},clearImmediate:a=>this.#o(a),activeCount:()=>this.#e.size},now:()=>performance.now(),hrtime:()=>{const a=Math.round(performance.now()*1e6);return[Math.floor(a/1e9),a%1e9]}};this.bindingCtx=i,this.network=i.network,this.realm=new Jn(i),this.loader=new hr(this.realm,e.vfs),this.loader.setAliases({rollup:"@rollup/wasm-node",esbuild:"esbuild-wasm"});const h=this.loader;this.realm.setUserRequire(Object.assign((a,m)=>h.require(a,m),{resolve:(a,m,c)=>h.resolve(m,c?.paths?.[0]??V(a),"require")})),this.process=this.realm.require("process"),this.console=this.realm.require("console"),this.Buffer=this.realm.require("buffer").Buffer;const p=this.realm.require("timers"),g={process:this.process,Buffer:this.Buffer,console:this.console,setTimeout:p.setTimeout,clearTimeout:p.clearTimeout,setInterval:p.setInterval,clearInterval:p.clearInterval,setImmediate:p.setImmediate,clearImmediate:p.clearImmediate,queueMicrotask:a=>queueMicrotask(a)};g.global=g,g.globalThis=g;for(const a of Xr){const m=globalThis[a];m!==void 0&&(g[a]=m)}g.self===void 0&&(g.self=globalThis),this.loader.setGlobals(g),this.sandboxGlobals=g,e.installGlobals!==!1&&this.#r(g)}sandboxGlobals;get exitCode(){return this.#t}#r(e){const t=globalThis;for(const o of["process","Buffer","console","setTimeout","clearTimeout","setInterval","clearInterval","setImmediate","clearImmediate"])t[o]=e[o];t.global=globalThis}#o(e){const t=this.#e.get(e);t!==void 0&&(Kr(t),Jr(t),this.#e.delete(e))}get activeTimers(){return this.#e.size}runMain(e){this.resetRunState();try{return this.loader.loadModule(e)}catch(t){if(t instanceof ye)return;throw t}}resetRunState(){this.loader.reset(),this.#s(),this.network.reset(),this.#t=null}#s(){for(const e of[...this.#e.keys()])this.#o(e)}async installDependencies(e={}){const t=e.fetch??(typeof fetch=="function"?fetch.bind(globalThis):void 0);if(!t)throw new Error("npm install requires a fetch implementation");return zr(this.vfs,{cwd:e.cwd??this.vfs.cwd,fetch:t,includeDev:e.includeDev??!1,log:e.onLog})}describe(){return{bindings:this.realm.bindingIds,modules:this.realm.listModules(),ports:this.network.ports}}}const Qr=16384,eo=32768;class ue{#e=new Map;#n=1;#t="/";constructor(e={}){if(this.#t=te(e.cwd??"/"),this.#e.set("/",this.#o()),e.onChange){const t=e.onChange;this.#r.add(o=>t(o.path))}}#r=new Set;subscribe(e){return this.#r.add(e),()=>{this.#r.delete(e)}}#o(){const e=Date.now();return{type:"dir",data:new Uint8Array(0),mode:493,mtimeMs:e,ctimeMs:e,birthtimeMs:e,ino:this.#n++}}#s(e,t=420){const o=Date.now();return{type:"file",data:e,mode:t,mtimeMs:o,ctimeMs:o,birthtimeMs:o,ino:this.#n++}}#i(e,t){for(const o of[...this.#r])o({type:t,path:e})}get cwd(){return this.#t}resolve(e){const t=Xn(e);if(!t)throw new I("ENOENT","open",t);return le(t)?te(t):se(this.#t,t)}chdir(e){const t=this.resolve(e),o=this.#e.get(t);if(!o)throw new I("ENOENT","chdir",e);if(o.type!=="dir")throw new I("ENOTDIR","chdir",e);this.#t=t}#a(e){const t=te(e),o=V(t),n=Zn(t);return[o,n]}#l(e,t,o){const n=this.#e.get(e);if(!n)throw new I("ENOENT",t,o);if(n.type!=="dir")throw new I("ENOTDIR",t,o);return n}exists(e){let t;try{t=this.resolve(e)}catch{return!1}return this.#e.has(t)}stat(e){const t=this.resolve(e),o=this.#e.get(t);if(!o)throw new I("ENOENT","stat",e);return this.#c(o)}#c(e){return{type:e.type,size:e.type==="file"?e.data.byteLength:0,mode:e.mode|(e.type==="dir"?Qr:eo),mtimeMs:e.mtimeMs,ctimeMs:e.ctimeMs,atimeMs:e.mtimeMs,birthtimeMs:e.birthtimeMs,dev:1,ino:e.ino,nlink:1,uid:0,gid:0,rdev:0,blksize:4096,blocks:e.type==="file"?Math.ceil(e.data.byteLength/512):0}}readFile(e){const t=this.resolve(e),o=this.#e.get(t);if(!o)throw new I("ENOENT","open",e);if(o.type==="dir")throw new I("EISDIR","read",e);return o.data.slice()}writeFile(e,t,o={}){const n=this.resolve(e),s=o.flag??"w",[i,h]=this.#a(n);if(n==="/")throw new I("EISDIR","open",e);this.#l(i,"open",e);const p=this.#e.get(n);if(p?.type==="dir")throw new I("EISDIR","open",e);if(p&&(s==="wx"||s==="ax"))throw new I("EEXIST","open",e);if((s==="a"||s==="ax")&&p){const g=new Uint8Array(p.data.byteLength+t.byteLength);g.set(p.data,0),g.set(t,p.data.byteLength),p.data=g,p.mtimeMs=Date.now(),this.#i(n,"change");return}p?(p.data=t.slice(),p.mtimeMs=Date.now(),o.mode!==void 0&&(p.mode=o.mode&511)):this.#e.set(n,this.#s(t.slice(),o.mode!==void 0?o.mode&511:420)),this.#i(n,p?"change":"create")}appendFile(e,t){this.writeFile(e,t,{flag:"a"})}mkdir(e,t={}){const o=this.resolve(e);if(o==="/"){if(t.recursive)return;throw new I("EEXIST","mkdir",e)}if(this.#e.has(o)){if(t.recursive&&this.#e.get(o).type==="dir")return;throw new I("EEXIST","mkdir",e)}if(t.recursive){const s=ce(o);let i="";for(const h of s){i+="/"+h;const p=this.#e.get(i);if(p){if(p.type!=="dir")throw new I("ENOTDIR","mkdir",e);continue}this.#e.set(i,this.#o())}this.#i(o,"create");return}const[n]=this.#a(o);this.#l(n,"mkdir",e),this.#e.set(o,this.#o()),this.#i(o,"create")}readdir(e,t={}){const o=this.resolve(e),n=this.#e.get(o);if(!n)throw new I("ENOENT","scandir",e);if(n.type!=="dir")throw new I("ENOTDIR","scandir",e);const s=o==="/"?"/":o+"/",i=[],h=new Set;for(const p of this.#e.keys()){if(!p.startsWith(s))continue;const g=p.slice(s.length);if(g.length===0)continue;const a=g.indexOf("/"),m=a===-1?g:g.slice(0,a);if(t.recursive){const w=s+g,b=this.#e.get(w);i.push({name:w,type:b.type});continue}if(h.has(m))continue;h.add(m);const c=o==="/"?"/"+m:o+"/"+m,l=this.#e.get(c);i.push({name:m,type:l?l.type:"file"})}return i.sort((p,g)=>p.name<g.name?-1:p.name>g.name?1:0),i}rm(e,t={}){const o=this.resolve(e),n=this.#e.get(o);if(!n){if(t.force)return;throw new I("ENOENT","unlink",e)}if(o==="/")throw new I("EBUSY","unlink",e);if(n.type==="dir"){const s=o+"/",i=[...this.#e.keys()].filter(h=>h.startsWith(s));if(i.length>0){if(!t.recursive)throw new I("ENOTEMPTY","rmdir",e);for(const h of i)this.#e.delete(h)}this.#e.delete(o)}else this.#e.delete(o);this.#i(o,"delete")}rename(e,t){const o=this.resolve(e),n=this.resolve(t),s=this.#e.get(o);if(!s)throw new I("ENOENT","rename",e);const[i]=this.#a(n);if(this.#l(i,"rename",t),this.#e.delete(o),this.#e.set(n,s),s.type==="dir"){const h=o+"/";for(const p of[...this.#e.keys()])if(p.startsWith(h)){const g=n+"/"+p.slice(h.length),a=this.#e.get(p);this.#e.delete(p),this.#e.set(g,a)}}this.#i(o,"delete"),this.#i(n,"create")}copyFile(e,t){const o=this.readFile(e);this.writeFile(t,o)}chmod(e,t){const o=this.resolve(e),n=this.#e.get(o);if(!n)throw new I("ENOENT","chmod",e);n.mode=t&511,this.#i(o,"change")}snapshot(){const e=[];for(const[t,o]of this.#e)t!=="/"&&e.push({path:t,type:o.type,mode:o.mode,data:o.type==="file"?Ee(o.data):void 0});return e.sort((t,o)=>t.path.localeCompare(o.path))}static fromSnapshot(e,t={},o="base64"){const n=new ue(t),s=e.filter(i=>i.type==="dir").sort((i,h)=>i.path.length-h.path.length);for(const i of s)n.mkdir(i.path,{recursive:!0,mode:i.mode});for(const i of e.filter(h=>h.type==="file")){const h=o==="base64"?st(i.data??""):new TextEncoder().encode(i.data??"");n.writeFile(i.path,h,{mode:i.mode})}return n}}class X{#e;#n=null;#t=null;#r=!1;#o;constructor(e="web-node-project",t=400){this.#e=e,this.#o=t}static get supported(){return typeof navigator<"u"&&typeof navigator.storage?.getDirectory=="function"}async#s(){if(this.#n)return this.#n;const e=await navigator.storage.getDirectory();return this.#n=await e.getDirectoryHandle(this.#e,{create:!0}),this.#n}schedule(e){X.supported&&(this.#r=!0,this.#t===null&&(this.#t=setTimeout(()=>{this.#t=null,this.#r&&(this.#r=!1,this.flush(e))},this.#o)))}async flush(e){if(!X.supported)return;const t=await this.#s(),o=e.snapshot();await this.#i(t,".wvm.json",JSON.stringify({v:2,entries:o},null,0));for(const n of o){if(n.type!=="file")continue;const i=n.path.replace(/^\//,"").split("/");let h=t;for(let p=0;p<i.length-1;p++)h=await h.getDirectoryHandle(i[p],{create:!0});await this.#a(h,i[i.length-1],st(n.data??""))}}async#i(e,t,o){await this.#a(e,t,new TextEncoder().encode(o))}async#a(e,t,o){const s=await(await e.getFileHandle(t,{create:!0})).createSyncAccessHandle();try{s.truncate(0),s.write(o,{at:0}),s.flush()}finally{s.close()}}async load(){if(!X.supported)return null;try{const n=await(await(await(await this.#s()).getFileHandle(".wvm.json")).getFile()).text(),s=JSON.parse(n);return Array.isArray(s)?{version:1,entries:s}:s&&Array.isArray(s.entries)?{version:s.v??2,entries:s.entries}:null}catch{return null}}async clear(){if(X.supported)try{await(await navigator.storage.getDirectory()).removeEntry(this.#e,{recursive:!0}),this.#n=null}catch{}}}const at={"/project/package.json":JSON.stringify({name:"web-node-demo",version:"1.0.0",type:"commonjs",main:"index.js",scripts:{start:"node index.js"},dependencies:{ms:"^2.1.3","esbuild-wasm":"^0.28.2","@rollup/wasm-node":"^4.63.3",vite:"^5.4.0",postcss:"^8.4.43",picocolors:"^1.0.0","source-map-js":"^1.2.0",nanoid:"^3.3.7"}},null,2),"/project/index.js":`// Runs on Node.js compiled-in-browser. No server. No install.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');
const { Transform, pipeline } = require('stream');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

console.log('=== web-node demo ===');
console.log('project     :', pkg.name, pkg.version);
console.log('platform    :', process.platform, '/', process.arch);
console.log('node        :', process.version);
console.log('cwd         :', process.cwd());
console.log('');

// --- real vendored Node path.js ---
console.log('-- path (vendored from Node source) --');
console.log('join        :', path.join('/a', 'b', '..', 'c'));
console.log('normalize   :', path.normalize('/a/./b/../c//'));
console.log('extname     :', path.extname('archive.tar.gz'));
console.log('');

// --- Buffer ---
console.log('-- buffer --');
const buf = Buffer.from('hello web-node');
console.log('hex         :', buf.toString('hex'));
console.log('base64      :', buf.toString('base64'));
console.log('slice       :', buf.slice(0, 5).toString());
console.log('');

// --- fs over the virtual file system ---
console.log('-- fs (virtual, persisted to OPFS) --');
const dir = '/project/output';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.txt'), 'generated at ' + new Date().toISOString());
console.log('written     :', fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'));
console.log('readdir     :', fs.readdirSync('/project').sort().join(', '));
console.log('stat.size   :', fs.statSync(path.join(dir, 'report.txt')).size, 'bytes');
console.log('');

// --- local module + ESM ---
const { fib } = require('./lib/fib.js');
console.log('-- local require --');
console.log('fib(10)     :', fib(10));
console.log('');

// --- events + timers (async) ---
const emitter = new EventEmitter();
emitter.on('tick', (n) => console.log('event       : tick #' + n));
let n = 0;
const timer = setInterval(() => {
  emitter.emit('tick', ++n);
  if (n === 3) {
    clearInterval(timer);
    console.log('done. platform:', os.platform(), '| uptime:', process.uptime().toFixed(3) + 's');
  }
}, 120);

console.log('scheduled 3 async ticks...');
console.log('');

// --- streams (milestone 4) ---
// Readable/Writable/Transform/pipe are real here: chunk sizes are bounded by a
// high-water mark and pipe() propagates backpressure.
console.log('-- stream --');
const factsFile = path.join(dir, 'facts.txt');
fs.writeFileSync(factsFile, require('./lib/facts.js')().map(function (r) {
  return r[0] + ' = ' + r[1];
}).join('; ') + ';');

let streamed = 0;
let chunkCount = 0;
fs.createReadStream(factsFile, { highWaterMark: 16 })
  .on('data', function (chunk) { streamed += chunk.length; chunkCount++; })
  .on('end', function () {
    console.log('read stream : ' + streamed + ' bytes in ' + chunkCount + ' chunks of <=16');
  });

pipeline(
  fs.createReadStream(factsFile),
  new Transform({
    transform: function (chunk, enc, cb) { cb(null, chunk.toString().toUpperCase()); },
  }),
  fs.createWriteStream(path.join(dir, 'facts-upper.txt')),
  function (err) {
    console.log('pipeline    : ' + (err ? 'error ' + err.message : 'facts-upper.txt written'));
  }
);
console.log('');

// --- npm (milestone 4) ---
// The npm client downloads and unpacks packages into the virtual node_modules.
// require() already resolves node_modules from the VFS, so once "Install deps"
// has run this call works exactly like it would on the desktop.
console.log('-- npm --');
try {
  const ms = require('ms');
  console.log('require(ms) :', ms(60000), '|', ms('2h') + 'ms');
} catch (err) {
  console.log('require(ms) : not installed yet - click "Install deps"');
}
console.log('');

// --- http server (milestone 3: virtual TCP) ---
// listen(3000) binds a port inside this runtime. The ServiceWorker bridge at
// /preview/3000/ dials it, so this URL is reachable from the browser tab.
function page() {
  const rows = require('./lib/facts.js')()
    .map(function (row) {
      return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>';
    })
    .join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>web-node preview</title>',
    '<style>',
    'body{margin:0;font:14px/1.6 ui-monospace,Menlo,monospace;background:#0b0e14;color:#d7dee9;padding:32px}',
    'h1{font-size:18px;color:#5ef1a5;margin:0 0 4px}',
    '.sub{color:#7b8798;margin-bottom:20px}',
    'table{border-collapse:collapse;width:100%;max-width:560px}',
    'td{padding:7px 10px;border-bottom:1px solid #232a3a}',
    'td:first-child{color:#7b8798;width:40%}',
    'a{color:#5ef1a5}',
    '</style></head><body>',
    '<h1>Hello from your in-browser Node.js server</h1>',
    '<div class="sub">This HTML was rendered inside the runtime worker and piped through a virtual TCP socket.</div>',
    '<table>' + rows + '</table>',
    '<p style="margin-top:24px"><a href="/api/info">GET /api/info</a> &middot; <a href="/api/fib?n=20">GET /api/fib?n=20</a></p>',
    '<p><a href="/download/facts.txt">GET /download/facts.txt</a> (fs.createReadStream().pipe(res))</p>',
    '<p><a href="/api/stream">GET /api/stream</a> (5 x res.write() -> Transfer-Encoding: chunked)</p>',
    '<p><a href="/api/ls?dir=/project/output">GET /api/ls?dir=/project/output</a> (what the streams wrote)</p>',
    '</body></html>',
  ].join('');
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost:3000');

  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      time: new Date().toISOString(),
    }, null, 2));
    return;
  }

  if (url.pathname === '/api/fib') {
    const value = Number(url.searchParams.get('n') || 10);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ n: value, fib: fib(value) }));
    return;
  }

  // Streamed straight off the virtual file system. No Content-Length is set,
  // so the response is framed as chunked and backpressure flows from the
  // socket back into the read stream.
  if (url.pathname === '/download/facts.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    fs.createReadStream(factsFile).pipe(res);
    return;
  }

  // Several writes over time: proves the server can stream a body it cannot
  // know the length of up front.
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    let i = 0;
    const timer = setInterval(function () {
      res.write('tick ' + (++i) + ';');
      if (i === 5) {
        clearInterval(timer);
        res.end('done');
      }
    }, 30);
    return;
  }

  // Reads the virtual file system back out, so the effects of the stream /
  // upload endpoints are visible from the browser.
  if (url.pathname === '/api/ls') {
    const target = url.searchParams.get('dir') || '/project';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fs.readdirSync(target).sort(), null, 2));
    return;
  }

  // Upload: the request body is a Readable, so it pipes straight to a file.
  if (url.pathname === '/api/upload') {
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.createWriteStream(path.join(dir, 'upload.txt'));
    req.pipe(out);
    out.on('finish', function () {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ bytes: out.bytesWritten }));
    });
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
});

server.listen(3000, function () {
  console.log('http server  : listening on http://localhost:3000');
  console.log('preview      : open the Preview tab (or /preview/3000/)');
});
`,"/project/lib/fib.js":`// A plain CommonJS module resolved out of the virtual file system.
function fib(n) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

exports.fib = fib;
exports.default = { fib };
`,"/project/lib/facts.js":`// Feeds the HTML that the virtual HTTP server renders.
module.exports = function facts() {
  return [
    ['process.version', process.version],
    ['process.platform', process.platform],
    ['process.arch', process.arch],
    ['process.cwd()', process.cwd()],
    ['module resolution', 'CJS from the virtual file system'],
    ['transport', 'virtual TCP (no real socket)'],
  ];
};
`,"/project/src/greet.ts":`// TypeScript, compiled by esbuild inside the tab (see build.js).
export interface Greeting {
  to: string;
  message: string;
}

export function greet(to: string): Greeting {
  return { to: to, message: 'hello, ' + to + '!' };
}
`,"/project/src/app.ts":`import { greet, Greeting } from './greet';
import ms from 'ms';

const names: string[] = ['world', 'web-node', 'browser'];

const greetings: Greeting[] = names.map(function (n) {
  return greet(n);
});

export function banner(): string {
  return greetings.map(function (g) { return g.message; }).join(' | ');
}

console.log(banner() + '  (ms: ' + ms('2h') + 'ms)');
`,"/project/build.js":`// Click "Build" to run this: it bundles src/app.ts with esbuild-wasm.
const fs = require('fs');
const path = require('path');

const ROOT = '/project';
const WASM_PATH = path.join(ROOT, 'node_modules', 'esbuild-wasm', 'esbuild.wasm');

function dirname(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

// esbuild's browser build has no file system, so everything it reads is served
// out of the virtual file system through a resolve/load plugin.
function vfsPlugin() {
  return {
    name: 'web-node-vfs',
    setup: function (build) {
      build.onResolve({ filter: /.*/ }, function (args) {
        if (args.kind === 'entry-point') return { path: args.path, namespace: 'vfs' };
        const base = args.resolveDir || dirname(args.importer) || ROOT;
        if (args.path.charAt(0) === '.' || args.path.charAt(0) === '/') {
          const joined = args.path.charAt(0) === '/' ? args.path : path.join(base, args.path);
          return { path: path.normalize(joined), namespace: 'vfs' };
        }
        try {
          return { path: require.resolve(args.path, { paths: [base] }), namespace: 'vfs' };
        } catch (err) {
          return { errors: [{ text: 'vfs: cannot resolve ' + args.path }] };
        }
      });
      build.onLoad({ filter: /.*/, namespace: 'vfs' }, function (args) {
        const tries = [
          args.path,
          args.path + '.ts',
          args.path + '.tsx',
          args.path + '.js',
          args.path + '.json',
          path.join(args.path, 'index.ts'),
          path.join(args.path, 'index.js'),
        ];
        for (let i = 0; i < tries.length; i++) {
          if (fs.existsSync(tries[i]) && fs.statSync(tries[i]).isFile()) {
            const file = tries[i];
            const ext = path.extname(file);
            const loader = ext === '.ts' ? 'ts' : ext === '.tsx' ? 'tsx' : ext === '.json' ? 'json' : 'js';
            return { contents: fs.readFileSync(file, 'utf8'), loader: loader, resolveDir: dirname(file) };
          }
        }
        return { errors: [{ text: 'vfs: cannot find ' + args.path }] };
      });
    },
  };
}

(async function () {
  console.log('-- build (milestone 5) --');
  if (!fs.existsSync(WASM_PATH)) {
    console.log('esbuild-wasm: not installed yet - click "Install deps" first');
    return;
  }
  const bytes = fs.readFileSync(WASM_PATH);
  const esbuild = require('esbuild-wasm');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'esbuild-wasm', 'package.json'), 'utf8')).version;
  console.log('tool        : esbuild-wasm v' + version + ' (' + (bytes.length / 1048576).toFixed(1) + ' MB wasm)');

  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(bytes), worker: false });
  console.log('wasm        : compiled + service started in ' + (Date.now() - t0) + 'ms');

  const t1 = Date.now();
  const result = await esbuild.build({
    entryPoints: [ROOT + '/src/app.ts'],
    bundle: true,
    format: 'cjs',
    target: 'es2020',
    write: false,
    plugins: [vfsPlugin()],
  });
  const code = result.outputFiles[0].text;
  fs.mkdirSync(ROOT + '/dist', { recursive: true });
  fs.writeFileSync(ROOT + '/dist/app.js', code);
  console.log('bundle      : ' + code.length + ' bytes in ' + (Date.now() - t1) + 'ms');
  console.log('written     : /project/dist/app.js');
  console.log('');
  console.log(code.trim());
})().catch(function (err) {
  console.log('build failed : ' + err.message);
});
`,"/project/app/text.js":`// A plain ES module, consumed by rollup (see bundle.js).
export const TITLE = 'web-node';

export function slugify(value) {
  return String(value).toLowerCase();
}

// Dead code: never imported, so rollup drops it from the bundle (tree-shaking).
export function explode() {
  throw new Error('never called');
}
`,"/project/app/main.js":`// ESM entry point for the rollup build.
import { slugify, TITLE } from './text.js';

const parts = ['Web', 'Node', 'Bundled'];

export const heading = TITLE + ': ' + parts.map(function (p) { return slugify(p); }).join('-');
`,"/project/bundle.js":`// Click "Bundle" to run this: it bundles app/main.js with rollup-wasm.
const fs = require('fs');
const path = require('path');

const ROOT = '/project';
const OUT = path.join(ROOT, 'dist', 'app.esm.js');

(async function () {
  console.log('-- bundle (milestone 5b) --');
  if (!fs.existsSync(path.join(ROOT, 'node_modules', '@rollup', 'wasm-node'))) {
    console.log('rollup: not installed yet - click "Install deps" first');
    return;
  }
  const rollup = require('@rollup/wasm-node');
  console.log('tool        : rollup v' + rollup.VERSION + ' (official WASM build)');

  const t0 = Date.now();
  const bundle = await rollup.rollup({
    input: path.join(ROOT, 'app', 'main.js'),
    onwarn: function () {},
  });
  const result = await bundle.generate({ format: 'es', compact: true });
  const code = result.output[0].code;

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(OUT, code);
  console.log('bundle      : ' + code.length + ' bytes in ' + (Date.now() - t0) + 'ms');
  console.log('tree-shaken : ' + (code.indexOf('explode') === -1 ? 'yes (dead export dropped)' : 'no'));
  console.log('written     : /project/dist/app.esm.js');
  console.log('');
  console.log(code.trim());
})().catch(function (err) {
  console.log('bundle failed : ' + (err && err.message ? err.message : err));
});
`,"/project/vite-build.mjs":`// Click "Vite build" to run this: Vite bundles site/ inside the tab.
// Vite is loaded with a dynamic import() so the guard below can run first;
// a static import would be evaluated eagerly and fail before the check.
import fs from 'fs';
import path from 'path';

const ROOT = '/project';
const SITE = path.join(ROOT, 'site');
const NM = path.join(ROOT, 'node_modules');

(async function () {
  console.log('-- vite build (milestone 5c) --');
  if (!fs.existsSync(path.join(NM, 'vite'))) {
    console.log('vite: not installed yet - click "Install deps" first');
    return;
  }
  const vite = await import('vite');
  console.log('tool        : vite v' + vite.version + ' (running in the tab)');

  // Vite expects the native esbuild addon. A tab cannot load one, so the runtime
  // aliases 'esbuild' to its WASM build, which must be started explicitly first.
  const esbuild = await import('esbuild');
  const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
  console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

  const t1 = Date.now();
  const result = await vite.build({
    root: SITE,
    logLevel: 'silent',
    build: { write: false, minify: false },
  });
  const bundle = Array.isArray(result) ? result[0] : result;

  for (const chunk of bundle.output) {
    const dest = path.join(SITE, 'dist', chunk.fileName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, chunk.type === 'asset' ? String(chunk.source) : chunk.code);
  }
  console.log('built in    : ' + (Date.now() - t1) + 'ms');
  console.log('written     : /project/site/dist/');
  for (const chunk of bundle.output) console.log('  ' + chunk.fileName);
})().catch(function (err) {
  console.log('vite failed : ' + (err && err.message ? err.message : err));
});
`,"/project/site/index.html":`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>web-node · vite</title>
  </head>
  <body>
    <h1 id="app"></h1>
    <script type="module" src="/src/main.js"><\/script>
  </body>
</html>
`,"/project/site/src/main.js":`import { greet } from './message.js';
import './style.css';

const el = document.getElementById('app');
el.textContent = greet('vite');

// Accept updates to message.js and re-render in place - no full reload. The
// callback gets the *new* module, so read the fresh export from it (the old
// \`greet\` binding inside this module is not re-executed).
if (import.meta.hot) {
  import.meta.hot.accept('./message.js', function (mod) {
    el.textContent = mod.greet('vite');
  });
}
`,"/project/site/src/style.css":`/* Edited by the HMR CSS button: Vite sends a css-update and the preview
   restyles in place - no reload, no lost page state. */
#app {
  color: #5ef1a5;
  font: 600 22px/1.4 ui-monospace, Menlo, monospace;
}
`,"/project/site/src/message.js":`export function greet(who) {
  return 'Hello from ' + who + ', bundled in the browser';
}
`,"/project/vite-dev.mjs":`// Click "Vite dev" to run: Vite's dev server serves site/ in the tab (HMR on).
import fs from 'fs';
import path from 'path';

const ROOT = '/project';
const SITE = path.join(ROOT, 'site');
const NM = path.join(ROOT, 'node_modules');
const PORT = 5173;
// One HMR channel per port, so two dev servers on different ports never see
// each other's clients. Must match the name the preview shim builds
// (web-node-hmr:<port> in public/sw.js).
const HMR_CHANNEL = 'web-node-hmr:' + PORT;

// The object Vite treats as its HMR server (the shape createWebSocketServer
// returns: send / on / off / clients / close). The transport underneath is a
// BroadcastChannel to the preview iframe, not a socket.
function createHmrBridge() {
  const channel = new BroadcastChannel(HMR_CHANNEL);
  const clients = new Set();
  let onConnection = null;
  channel.onmessage = function (event) {
    const msg = event.data;
    if (!msg) return;
    if (msg.t === 'open') {
      clients.add(msg.id);
      channel.postMessage({ t: 'open', id: msg.id });
      // Vite's client waits for "connected" before flushing queued operations.
      channel.postMessage({ t: 'message', id: msg.id, data: JSON.stringify({ type: 'connected' }) });
      console.log('hmr         : preview connected (' + clients.size + ' client/s)');
      if (onConnection) onConnection({ send: function () {} }, {});
    } else if (msg.t === 'send') {
      let parsed = null;
      try { parsed = JSON.parse(msg.data); } catch (e) {}
      if (parsed && parsed.type === 'ping') {
        channel.postMessage({ t: 'message', id: msg.id, data: JSON.stringify({ type: 'pong' }) });
      }
    } else if (msg.t === 'close') {
      clients.delete(msg.id);
    }
  };
  return {
    name: 'web-node-hmr',
    get clients() { return clients; },
    send(payload) {
      const data = JSON.stringify(payload);
      clients.forEach(function (id) { channel.postMessage({ t: 'message', id: id, data: data }); });
    },
    on(event, fn) { if (event === 'connection') onConnection = fn; },
    off(event, fn) { if (event === 'connection' && onConnection === fn) onConnection = null; },
    listen() {},
    close() { clients.clear(); channel.close(); },
    handleUpgrade() {},
  };
}

// Vite's real watcher is chokidar, which wants fs.watch + inotify the tab does
// not have. Watch the VFS ourselves and forward events into Vite's (no-op)
// watcher, which is where the HMR pipeline is wired up.
function vfsWatchPlugin() {
  return {
    name: 'web-node-vfs-watch',
    configureServer(server) {
      const watcher = fs.watch(SITE, { recursive: true }, function (eventType, filename) {
        if (!filename) return;
        console.log('vfs-change  : ' + eventType + ' ' + filename);
        server.watcher.emit(eventType === 'change' ? 'change' : 'add', path.join(SITE, filename));
      });
      if (server.httpServer) server.httpServer.on('close', function () { watcher.close(); });
      console.log('watching    : ' + SITE + ' (VFS events -> Vite HMR)');
    },
  };
}

(async function () {
  console.log('-- vite dev server (milestone 5e) --');
  if (!fs.existsSync(path.join(NM, 'vite'))) {
    console.log('vite: not installed yet - click "Install deps" first');
    return;
  }
  const vite = await import('vite');
  console.log('tool        : vite v' + vite.version + ' dev server (in the tab)');

  const esbuild = await import('esbuild');
  const wasm = fs.readFileSync(path.join(NM, 'esbuild-wasm', 'esbuild.wasm'));
  const t0 = Date.now();
  await esbuild.initialize({ wasmModule: await WebAssembly.compile(wasm), worker: false });
  console.log('esbuild     : wasm started in ' + (Date.now() - t0) + 'ms');

  const server = await vite.createServer({
    root: SITE,
    logLevel: 'error',
    plugins: [vfsWatchPlugin()],
    server: {
      host: '127.0.0.1',
      port: PORT,
      // No chokidar (see vfsWatchPlugin); HMR stays on but rides our bridge.
      watch: null,
      hmr: { protocol: 'ws', host: '127.0.0.1', port: PORT },
    },
  });

  // Replace Vite's WebSocket channel with the BroadcastChannel bridge. Vite
  // reads server.hot on every update, so swapping the reference is enough.
  const bridge = createHmrBridge();
  server.hot = bridge;
  server.ws = bridge;

  await server.listen();

  console.log('listening   : http://127.0.0.1:' + PORT);
  console.log('hmr         : BroadcastChannel "' + HMR_CHANNEL + '" (no WebSocket)');
  console.log('preview     : open Preview (:5173), then edit site/src/message.js');
})().catch(function (err) {
  console.log('vite dev failed : ' + (err && err.message ? err.message : err));
});
`,"/project/notes.md":`# web-node demo project

This project is mounted into an in-browser VFS. Edit any file and hit **Run**.

## What works today (milestone 3 + the streams prerequisite)

- Real Node.js core source (lib/path.js, lib/querystring.js, primordials) vendored and executed
- internalBinding() backed by TypeScript implementations over a virtual file system
- path / fs / buffer / events / util / console / timers / process / os / string_decoder / assert / querystring
- **net + http over a virtual TCP layer** — http.createServer().listen(3000) is reachable at /preview/3000/
- **ServiceWorker bridge** — a browser URL is routed into the runtime's port table
- **stream** — Readable / Writable / Duplex / Transform / PassThrough, real backpressure,
  pipe(), pipeline(), finished(), stream/promises, plus fs.createReadStream and
  fs.createWriteStream; the request is a Readable and the response a Writable,
  so req.pipe(res) works
- **Chunked transfer-encoding** — a response without Content-Length streams as chunked,
  and the client side de-chunks it again
- **npm client (milestone 4)** — "Install deps" fetches the dependencies declared in
  package.json from the registry, gunzips + untars them into the virtual node_modules
  (npm-style hoisting, nesting on version conflicts), after which require('ms') just works
- **npm lockfiles + integrity (milestone 6)** — install records package-lock.json
  (lockfileVersion 3); a second install reuses the locked versions instead of
  re-resolving, and every tarball is checked against the registry's sha512/sha1
  before it is written. Missing peer dependencies are installed at the root too
- **Build tools (milestone 5)** — "Build" runs esbuild (the WASM build, the same
  transformer Vite uses) inside the tab: it compiles src/app.ts, bundles a real
  node_modules dependency, and writes /project/dist/app.js. The browser field in
  package.json is honoured, which is what lets esbuild resolve to its browser build
- **Real bundler (milestone 5b)** — "Bundle" runs rollup (its official WASM build)
  in the tab: it tree-shakes an ES module graph read straight out of the virtual
  file system and writes /project/dist/app.esm.js
- **Vite itself (milestone 5c)** — "Vite build" runs the real Vite (v5) in the tab.
  Vite is pure ESM and reaches for the *native* esbuild addon; the runtime aliases
  esbuild→esbuild-wasm and rollup→@rollup/wasm-node, so Vite boots on the virtual
  file system and produces a real production bundle (site/index.html +
  site/dist/assets/*.js) — no server, no Node process
- CommonJS + a subset of ESM (static import/export)
- In-memory VFS persisted to OPFS (reload the page and your files are still here)

## Not yet

- Subdomain preview routing on a static host (only the dev server has the wildcard DNS)
- Real TLS (the https module is the http surface under a TLS-shaped name)
- Object-mode objectMode edge cases, byte-exact read(n) splitting
- npm lifecycle scripts and .bin shims (both need a process to spawn: no child_process here)
- npm/yarn/pnpm filesystem specs (file:, git+, link:)
- webpack (esbuild, rollup and Vite are milestones 5/5b/5c)
`},z=new X("web-node-project");let $=null,L=null;function U(r){self.postMessage(r)}function lt(r,e){const t=e.lastIndexOf("/");t>0&&r.mkdir(e.slice(0,t),{recursive:!0})}function de(r){return r.snapshot().filter(e=>e.type==="file").map(e=>e.path).sort()}function be(r,e){for(const[t,o]of Object.entries(e))lt(r,t),r.writeFile(t,new TextEncoder().encode(o))}async function to(r,e){return r.realm.require("http")._request(e.port,{method:e.method,path:e.path,headers:e.headers,body:e.body?new Uint8Array(e.body):void 0})}async function no(r){const e=await z.load(),t=!!(e&&e.entries.length>0),o=t?ue.fromSnapshot(e.entries,{cwd:"/project"},e.version>=2?"base64":"text"):new ue({cwd:"/project"});t||be(o,at),L=o,$=new Zr({vfs:o,argv:["/project/index.js"],env:{NODE_ENV:"development",WEB_NODE:"1"},installGlobals:!0,onStdout:n=>U({id:0,type:"stdout",data:n}),onStderr:n=>U({id:0,type:"stderr",data:n})}),z.schedule(o),U({id:r,type:"ready",info:{persistSupported:X.supported,restored:t,files:de(o),bindings:$.realm.bindingIds,vendoredFiles:Object.keys(he).sort()}})}function ro(r,e){if(!$||!L)throw new Error("runtime not initialised");const t=e??"/project/index.js";try{$.runMain(t)}catch(o){if(o instanceof ye){z.schedule(L),U({id:r,type:"exit",code:o.code});return}U({id:0,type:"stderr",data:`
${o.stack??String(o)}
`}),U({id:r,type:"error",message:o.message});return}z.schedule(L),U({id:r,type:"exit",code:$.exitCode??0})}self.onmessage=async r=>{const e=r.data;try{switch(e.type){case"init":await no(e.id);return;case"mount":if(!L)throw new Error("runtime not initialised");be(L,e.files),z.schedule(L),U({id:e.id,type:"ok",result:de(L)});return;case"run":ro(e.id,e.entry);return;case"writeFile":if(!L)throw new Error("runtime not initialised");lt(L,e.path),L.writeFile(e.path,new TextEncoder().encode(e.contents)),z.schedule(L),U({id:e.id,type:"ok",result:de(L)});return;case"readFile":if(!L)throw new Error("runtime not initialised");U({id:e.id,type:"ok",result:new TextDecoder().decode(L.readFile(e.path))});return;case"reset":await z.clear(),L&&(be(L,at),z.schedule(L)),U({id:e.id,type:"ok",result:L?de(L):[]});return;case"describe":if(!$)throw new Error("runtime not initialised");U({id:e.id,type:"ok",result:$.describe()});return;case"npmInstall":{if(!$)throw new Error("runtime not initialised");const t=await $.installDependencies({cwd:e.cwd,includeDev:e.includeDev,onLog:o=>U({id:0,type:"stdout",data:o+`
`})});L&&z.schedule(L),U({id:e.id,type:"ok",result:t});return}case"http":{if(!$)throw new Error("runtime not initialised");const t=await to($,e);U({id:e.id,type:"ok",result:t});return}case"httpStream":{if(!$)throw new Error("runtime not initialised");$.realm.require("http")._stream(e.port,{method:e.method,path:e.path,headers:e.headers,body:e.body?new Uint8Array(e.body):void 0},{onHead:o=>U({id:e.id,type:"httpHead",status:o.status,statusMessage:o.statusMessage,headers:o.headers}),onData:o=>U({id:e.id,type:"httpChunk",data:o}),onEnd:()=>U({id:e.id,type:"httpEnd"}),onError:o=>U({id:e.id,type:"error",message:o.message})});return}}}catch(t){const o=t instanceof Error?`${t.name}: ${t.message}`:String(t),n=t instanceof Error&&t.stack?`
${t.stack}`:"";U({id:0,type:"stderr",data:`[worker:${e.type}] ${o}${n}
`}),U({id:e.id,type:"error",message:o})}};
