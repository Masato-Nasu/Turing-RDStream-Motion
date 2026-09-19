/* Turing RDStream Motion P0.3 + R4 Security-Hardened. */
(function (root) {
  "use strict";
  const N = 512,
    CELL = 512,
    MAX_BYTES = 131084,
    DATA = 144,
    BLOCK = 8,
    PACKET_BYTES = 192,
    LANES = 6,
    CODE_BYTES = 384,
    BITS = 6240,
    MODES = 79,
    NSYM = 32,
    Q = 1048576;
  const te = new TextEncoder(),
    cat = (...a) => {
      let r = new Uint8Array(a.reduce((s, x) => s + x.length, 0)),
        p = 0;
      for (const x of a) {
        r.set(x, p);
        p += x.length;
      }
      return r;
    };
  const eq = (a, b) => { if(a.length !== b.length) return false; let d=0; for(let i=0;i<a.length;i++) d |= a[i]^b[i]; return d===0; };
  const txt = (s) => te.encode(s);
  async function sha(a) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", a));
  }
  const hmacKeys=new WeakMap();
  async function mac(k,a) {
    let key=hmacKeys.get(k);
    if(!key){key=crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,['sign']);hmacKeys.set(k,key);}
    return new Uint8Array(await crypto.subtle.sign('HMAC',await key,a));
  }
  async function master(key, salt) {
    if (typeof key!=='string'||!key) throw Error("合い言葉が必要です");
    for(let i=0;i<key.length;i++){
      const c=key.charCodeAt(i);
      if(c>=0xd800&&c<=0xdbff){const d=key.charCodeAt(++i);if(!(d>=0xdc00&&d<=0xdfff))throw Error('Invalid UTF-16 password');}
      else if(c>=0xdc00&&c<=0xdfff)throw Error('Invalid UTF-16 password');
    }
    const k = await crypto.subtle.importKey("raw", txt(key), "PBKDF2", false, [
      "deriveBits",
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
        k,
        256,
      ),
    );
  }
  // GF(256), primitive polynomial x^8+x^4+x^3+x^2+1. RS(64,32), roots alpha^0..31.
  const EXP = new Uint8Array(512),
    LOG = new Uint8Array(256);
  let gx = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = gx;
    LOG[gx] = i;
    gx <<= 1;
    if (gx & 256) gx ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0),
    div = (a, b) => {
      if (!b) throw Error("GF division by zero");
      return a ? EXP[(LOG[a] - LOG[b] + 255) % 255] : 0;
    };
  function polymul(a, b) {
    const r = new Uint8Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) r[i + j] ^= mul(a[i], b[j]);
    return r;
  }
  let GEN = Uint8Array.of(1);
  for (let i = 0; i < NSYM; i++) GEN = polymul(GEN, Uint8Array.of(1, EXP[i]));
  function rsEncode(data) {
    if (data.length !== 32) throw Error("RS requires 32 bytes");
    const out = new Uint8Array(64);
    out.set(data);
    for (let i = 0; i < 32; i++) {
      const c = out[i];
      if (c) for (let j = 1; j < GEN.length; j++) out[i + j] ^= mul(GEN[j], c);
    }
    out.set(data);
    return out;
  }
  function syndromes(c) {
    return Array.from({ length: NSYM }, (_, j) => {
      let s = 0;
      for (const v of c) s = mul(s, EXP[j]) ^ v;
      return s;
    });
  }
  function rsDecode(input) {
    const c = Uint8Array.from(input),
      s = syndromes(c);
    if (s.every((x) => !x)) return { data: c.slice(0, 32), corrected: 0 };
    let C = [1],
      B = [1],
      L = 0,
      m = 1,
      b = 1;
    for (let n = 0; n < NSYM; n++) {
      let d = s[n];
      for (let i = 1; i <= L; i++) d ^= mul(C[i] || 0, s[n - i]);
      if (!d) {
        m++;
        continue;
      }
      const T = C.slice(),
        coef = div(d, b);
      while (C.length < B.length + m) C.push(0);
      for (let i = 0; i < B.length; i++) C[i + m] ^= mul(coef, B[i]);
      if (2 * L <= n) {
        L = n + 1 - L;
        B = T;
        b = d;
        m = 1;
      } else m++;
    }
    if (L > 16 || L < 1) throw Error("RS correction capacity exceeded");
    const positions = [];
    for (let p = 0; p < c.length; p++) {
      const z = EXP[(255 - (c.length - 1 - p)) % 255];
      let v = 0;
      for (let j = C.length - 1; j >= 0; j--) v = mul(v, z) ^ C[j];
      if (!v) positions.push(p);
    }
    if (positions.length !== L) throw Error("RS locator failure");
    const A = Array.from({ length: L }, (_, r) => {
      const a = new Uint8Array(L + 1);
      for (let j = 0; j < L; j++)
        a[j] = EXP[(r * (c.length - 1 - positions[j])) % 255];
      a[L] = s[r];
      return a;
    });
    for (let j = 0; j < L; j++) {
      let p = j;
      while (p < L && !A[p][j]) p++;
      if (p === L) throw Error("RS singular");
      [A[p], A[j]] = [A[j], A[p]];
      const inv = div(1, A[j][j]);
      for (let k = j; k <= L; k++) A[j][k] = mul(A[j][k], inv);
      for (let r = 0; r < L; r++)
        if (r !== j) {
          const v = A[r][j];
          for (let k = j; k <= L; k++) A[r][k] ^= mul(v, A[j][k]);
        }
    }
    for (let i = 0; i < L; i++) c[positions[i]] ^= A[i][L];
    if (syndromes(c).some(Boolean)) throw Error("RS residual syndrome");
    return { data: c.slice(0, 32), corrected: L };
  }
  function frameEncode(data) {
    if (data.length !== PACKET_BYTES)
      throw Error("frame packet length mismatch");
    const out = new Uint8Array(CODE_BYTES);
    for (let lane = 0; lane < LANES; lane++) {
      const encoded = rsEncode(data.subarray(lane * 32, lane * 32 + 32));
      for (let j = 0; j < 64; j++) out[j * LANES + lane] = encoded[j];
    }
    return out;
  }
  function frameDecode(code) {
    const out = new Uint8Array(PACKET_BYTES),
      lanes = [];
    let corrected = 0;
    for (let lane = 0; lane < LANES; lane++) {
      const c = Uint8Array.from(
        { length: 64 },
        (_, j) => code[j * LANES + lane],
      );
      const d = rsDecode(c);
      out.set(d.data, lane * 32);
      corrected += d.corrected;
      lanes.push(d.corrected);
    }
    return { data: out, corrected, lanes };
  }
  const PREFIX = 'TURING-RDSTREAM-R4/MOTION-P0.3/';
  const u32 = n => {const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;};
  const num = (a,p) => new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(p);
  const domain = s => txt(PREFIX+s+'\0');
  async function keys(password,salt,nonce) {
    const m=await master(password,salt);
    const base=await crypto.subtle.importKey('raw',m,'HKDF',false,['deriveBits']);
    m.fill(0);
    const k={};
    for(const name of ['STREAM','AUTH','CARRIER','STATE','CHECKPOINT']) {
      k[name]=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:nonce,info:txt(PREFIX+name)},base,256));
    }
    return k;
  }
  function wipe(k) {if(k) for(const b of Object.values(k)) b.fill(0);}
  async function expand(k,label,ctx,n) {
    const out=new Uint8Array(n);
    for(let base=0;base<n;base+=2048) {
      await Promise.all(Array.from({length:Math.min(64,Math.ceil((n-base)/32))},async(_,j)=>{
        const p=base+j*32;out.set((await mac(k,cat(domain(label),ctx,u32(p/32)))).subarray(0,Math.min(32,n-p)),p);
      }));
    }
    return out;
  }
  // Full 256-bit HMAC counter stream. No reduction of a secret to a small PRNG state.
  async function randomSource(k,label,ctx) {
    let buf=new Uint8Array(),p=0,counter=0;
    return async bound => {
      const limit=Math.floor(4294967296/bound)*bound;
      for(;;) {
        if(p===buf.length) {buf=await mac(k,cat(domain(label),ctx,u32(counter++)));p=0;}
        const v=num(buf,p);p+=4;
        if(v<limit) return v%bound;
      }
    };
  }
  let publicLayoutPromise;
  function publicLayout() {
    if(!publicLayoutPromise) publicLayoutPromise=(async()=>{
      const m=[];for(let u=1;u<=MODES;u++)for(let v=1;v<=MODES;v++)m.push([u,v]);
      // Public protocol constant, explicitly not a secret key.
      const r=await randomSource(await sha(domain('PUBLIC-CARRIER')),'PUBLIC-LAYOUT',new Uint8Array());
      for(let i=m.length-1;i>0;i--){const j=await r(i+1);[m[i],m[j]]=[m[j],m[i]];}
      const sign=new Uint8Array(BITS);for(let i=0;i<BITS;i++)sign[i]=await r(2);
      return {m:m.slice(0,BITS),sign};
    })();
    return publicLayoutPromise;
  }
  async function layout(k,session,index) {
    const base=await publicLayout(),m=base.m.slice(),sign=base.sign.slice(),slots=[];
    // Only frame zero keeps five public RS lanes to bootstrap the session.
    // Every later frame uses the entire full-field carrier under K_carrier.
    for(let b=0;b<BITS;b++)if(index!==0 || Math.floor(b/1040)>=5)slots.push(b);
    const r=await randomSource(k.CARRIER,'PRIVATE-LAYOUT',cat(session,u32(index)));
    for(let i=slots.length-1;i>0;i--){const j=await r(i+1);[m[slots[i]],m[slots[j]]]=[m[slots[j]],m[slots[i]]];}
    for(const b of slots)sign[b]=await r(2);
    return {m,sign};
  }
  const T=root.RD5Transform, F=root.RDOrganic;
  if(!T||!F)throw Error('transform.js and organic.js must load before core.js');
  function field(code,L) {
    const coeff=new Int32Array(N*N);
    for(let lane=0;lane<LANES;lane++){
      const bits=F.convEncode(Uint8Array.from({length:64},(_,j)=>code[j*LANES+lane]));
      for(let j=0;j<bits.length;j++){const b=lane*1040+j,[u,v]=L.m[b];coeff[v*N+u]=(bits[j]^L.sign[b])?45000:-45000;}
    }
    return T.inverse(coeff);
  }
  function readCode(gray,L) {
    if(!gray||gray.length!==N*N)throw Error('フレーム欠損 / invalid frame size');
    const spectrum=T.forward(gray),code=new Uint8Array(CODE_BYTES);
    for(let lane=0;lane<LANES;lane++){
      const scores=Float64Array.from({length:1040},(_,j)=>{const b=lane*1040+j,[u,v]=L.m[b];return spectrum[v*N+u]*(L.sign[b]?1:-1);});
      const bytes=F.convDecode(scores,64);for(let j=0;j<64;j++)code[j*LANES+lane]=bytes[j];
    }
    return code;
  }
  const initial=F.initial,evolve=F.injectAndEvolve,render=F.render;
  function stateBytes(state) {
    const b=new Uint8Array(N*N*8),dv=new DataView(b.buffer);
    for(let i=0;i<N*N;i++){dv.setInt32(i*8,state.U[i],true);dv.setInt32(i*8+4,state.V[i],true);}return b;
  }
  async function context(state,k,session,index,n) {
    const digest=await sha(stateBytes(state));
    return {digest,stream:await expand(k.STREAM,'STREAM-BLOCK',cat(session,sheetContext(session,index),u32(index),u32(n),digest),n)};
  }
  const xor=(a,b)=>{if(a.length!==b.length)throw Error('XOR length');return Uint8Array.from(a,(v,i)=>v^b[i]);};
  // Header 160 bytes: magic/profile 4, salt16, nonce16, length4, index4,
  // count4, prior-state checkpoint32, whole-message MAC32, checkpoint MAC32, sheet span4, reserved12.
  function capacity(index) {return index===0?0:index%BLOCK===0?80:144;}
  function frameCount(len) {let n=0;while(len>0)len-=capacity(n++);return n;}
  function totalCapacity(count) {let n=0;for(let i=0;i<count;i++)n+=capacity(i);return n;}
  function makeHeader(salt,nonce,len,index,count,cp,tag,sheetSpan=128) {
    const h=new Uint8Array(160);h.set([82,68,4,6]);h.set(salt,4);h.set(nonce,20);
    h.set(u32(len),36);h.set(u32(index),40);h.set(u32(count),44);h.set(cp,48);h.set(tag,80);h.set(u32(sheetSpan),144);return h;
  }
  function parseHeader(h) {
    if(h.length!==160 || !eq(h.slice(0,4),Uint8Array.of(82,68,4,6)) || h.slice(148).some(Boolean)||![8,128].includes(num(h,144)))throw Error('Motion P0.3 R4 header invalid (P0.2非対応)');
    const len=num(h,36),index=num(h,40),count=num(h,44);
    if(len<1||len>MAX_BYTES||count!==frameCount(len)||index!==0)throw Error('Motion P0.3 R4 header range invalid');
    if(h.slice(48,80).some(Boolean))throw Error('Initial checkpoint must be zero');
    return {raw:h,salt:h.slice(4,20),nonce:h.slice(20,36),len,index,count,cp:h.slice(48,80),tag:h.slice(80,112),sheetSpan:num(h,144)};
  }
  function makeMiniHeader(index,count,cp) {
    const h=new Uint8Array(index%BLOCK===0?80:16);h.set([82,68,4,6]);h.set(u32(index),4);h.set(u32(count),8);
    if(index%BLOCK===0)h.set(cp,16);return h;
  }
  function parseMiniHeader(h,index,count) {
    const expected=index%BLOCK===0?80:16;
    if(h.length!==expected||!eq(h.slice(0,4),Uint8Array.of(82,68,4,6))||num(h,4)!==index||num(h,8)!==count||h.slice(12,16).some(Boolean))throw Error('フレーム／シート順序変更・欠損・混入を検出しました');
    return {raw:h,index,count,cp:index%BLOCK===0?h.slice(16,48):new Uint8Array(32)};
  }
  const sessionOf=h=>cat(h.slice(0,40),h.slice(44,48),h.slice(144,148));
  const sheetContext=(session,index)=>cat(u32(Math.floor(index/num(session,44))),u32(Math.ceil(num(session,40)/num(session,44))));
  async function readHeader(gray) {
    const code=readCode(gray,await publicLayout()),out=new Uint8Array(160);
    for(let lane=0;lane<5;lane++)out.set(rsDecode(Uint8Array.from({length:64},(_,j)=>code[j*LANES+lane])).data,lane*32);
    return parseHeader(out);
  }
  async function checkpointTag(k,h){return mac(k.CHECKPOINT,cat(domain('CHECKPOINT-MAC'),h.slice(0,112),h.slice(144,160)));}
  async function syncTag(k,session,h){return mac(k.CHECKPOINT,cat(domain('SYNC-CHECKPOINT-MAC'),session,sheetContext(session,num(h,4)),h.slice(0,48)));}
  async function startState(k,session,index,cp){return initial(await expand(k.STATE,'STATE-RESTART',cat(session,u32(index),cp),65536));}
  async function frameTag(k,session,h,digest,cipher){return mac(k.AUTH,cat(domain('FRAME-MAC'),session,sheetContext(session,h.length===160?0:num(h,4)),h,digest,cipher));}
  async function messageTag(k,session,data){return mac(k.AUTH,cat(domain('MESSAGE-MAC'),session,data));}
  async function encodeBytes(input,password,options={}) {
    const data=Uint8Array.from(input);
    if(!data.length||data.length>MAX_BYTES)throw Error('1〜131084 packed bytesで入力してください');
    if('salt' in options || 'nonce' in options)throw Error('External salt/nonce override is forbidden');
    const salt=crypto.getRandomValues(new Uint8Array(16)),nonce=crypto.getRandomValues(new Uint8Array(16));
    const count=frameCount(data.length),sheetSpan=options.sheetSpan??128;if(![8,128].includes(sheetSpan))throw Error('sheetSpan must be 8 or 128');if(sheetSpan===8&&Math.ceil(count/8)>32)throw Error('小分けの上限です。保存形式を標準にしてください');const empty=new Uint8Array(32),session=sessionOf(makeHeader(salt,nonce,data.length,0,count,empty,empty,sheetSpan));
    
    let k;const sheets=[];
    try {
      k=await keys(password,salt,nonce);const tag=await messageTag(k,session,data);let state,offset=0;
      for(let i=0;i<count;i++) {
        const localCount=Math.min(sheetSpan,count-Math.floor(i/sheetSpan)*sheetSpan);
        const motionCount=Math.max(1,Math.ceil(119/Math.max(1,localCount-1)))-1;
        let cp=empty;
        if(i%BLOCK===0){if(i)cp=await sha(stateBytes(state));if(!i)state=await startState(k,session,i,cp);}
        const h=i===0?makeHeader(salt,nonce,data.length,0,count,cp,tag,sheetSpan):makeMiniHeader(i,count,cp);
        if(i===0)h.set(await checkpointTag(k,h),112);
        else if(i%BLOCK===0)h.set(await syncTag(k,session,h),48);
        const n=capacity(i),ctx=await context(state,k,session,i,n),chunk=new Uint8Array(n);chunk.set(data.subarray(offset,offset+n));offset+=n;
        const cipher=xor(chunk,ctx.stream),packet=cat(h,cipher,await frameTag(k,session,h,ctx.digest,cipher)),L=await layout(k,session,i);
        // Ciphertext controls the RD forcing BEFORE simulation; rendered pixels are only V.
        // Motion P0.3 may capture genuine intermediate RD states for playback.
        // Capture does not mutate the final U/V state. The strict audit decoder also checks displayed rasters.
        const forcing=field(frameEncode(packet),L);
        let motion=[];
        if(motionCount&&i%sheetSpan!==0&&F.injectAndEvolveMotion){
          const tr=F.injectAndEvolveMotion(state,forcing,motionCount);state=tr.state;motion=tr.motion;
        }else state=evolve(state,forcing);
        const gray=render(state);
        let checked;
        try{checked=frameDecode(readCode(gray,L));}catch{throw Error('生成画像の自己検証に失敗しました。新しく生成し直してください');}
        if(!eq(checked.data,packet))throw Error('生成画像の自己検証で不一致を検出しました');
        const sheet={index:i,frames:[gray],displayFrames:i%sheetSpan===0?[gray]:motion.concat([gray])};
        if(options.onSheet)await options.onSheet(sheet,count);
        if(options.retainSheets!==false)sheets.push(sheet);
        if(options.progress)await options.progress(i+1,count);
      }
      return {sheets,bytes:data.length,count};
    } finally {wipe(k);data.fill(0);}
  }
  async function decodeSheets(sheets,password,options={}) {
    if(!sheets.length||sheets.length>frameCount(MAX_BYTES))throw Error('フレーム／シート数が不正です');
    let k,all;const details=[];
    try {
      let first,session,state,offset=0;
      for(let i=0;i<sheets.length;i++){
        if(sheets[i].frames?.length!==1)throw Error('フレーム欠損 / 1 PNG = 1 frame');
        const gray=sheets[i].frames[0];
        if(!i){first=await readHeader(gray);session=sessionOf(first.raw);if(first.count!==sheets.length)throw Error('フレーム／シートが不足しています');k=await keys(password,first.salt,first.nonce);all=new Uint8Array(totalCapacity(first.count));if(!eq(first.raw.slice(112,144),await checkpointTag(k,first.raw)))throw Error('Checkpoint/header MAC error: 合い言葉または改ざん');}
        const L=await layout(k,session,i),r=frameDecode(readCode(gray,L)),headerLength=i===0?160:i%BLOCK===0?80:16;
        const h=i===0?first:parseMiniHeader(r.data.slice(0,headerLength),i,first.count);
        if(i===0&&!eq(r.data.slice(0,160),first.raw))throw Error('Header mismatch');
        if(i%BLOCK===0){if(i&&!eq(h.raw.slice(48,80),await syncTag(k,session,h.raw)))throw Error('Checkpoint MAC error');const expected=i?await sha(stateBytes(state)):new Uint8Array(32);if(!eq(h.cp,expected))throw Error('Checkpoint chain mismatch');if(!i)state=await startState(k,session,i,h.cp);}
        const cipher=r.data.slice(headerLength,160),ctx=await context(state,k,session,i,cipher.length);
        if(!eq(r.data.slice(160),await frameTag(k,session,h.raw,ctx.digest,cipher)))throw Error('Frame MAC error');
        const plain=xor(cipher,ctx.stream);all.set(plain,offset);offset+=plain.length;plain.fill(0);
        const forcing=field(frameEncode(r.data),L);
        const localCount=Math.min(first.sheetSpan,first.count-Math.floor(i/first.sheetSpan)*first.sheetSpan);
        const intermediates=Math.max(1,Math.ceil(119/Math.max(1,localCount-1)))-1;
        const transition=i%first.sheetSpan!==0&&intermediates?F.injectAndEvolveMotion(state,forcing,intermediates):null;
        state=transition?transition.state:evolve(state,forcing);
        const canonical=transition?transition.motion.concat([render(state)]):[render(state)];
        const shown=sheets[i].displayFrames;
        if(!shown||shown.length!==canonical.length||canonical.some((g,j)=>!eq(g,shown[j])))throw Error('画像認証エラー: visible RD frame mismatch');
        details.push({frame:i,correctedBytes:r.corrected,maxLaneErrors:Math.max(...r.lanes),recovered:false});
        if(options.progress)await options.progress(i+1,sheets.length);
      }
      if(all.subarray(first.len).some(Boolean))throw Error('Noncanonical padding');
      const bytes=all.slice(0,first.len);
      if(!eq(await messageTag(k,session,bytes),first.tag)){bytes.fill(0);throw Error('Message MAC error');}
      let text=null;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
      return {bytes,text,details,sheets:sheets.length};
    } finally {wipe(k);if(all)all.fill(0);}
  }
  root.RDStreamCore={N,CELL,MAX_BYTES,DATA,BLOCK,PACKET_BYTES,CODE_BYTES,BITS,MODES,capacity,frameCount,readVisibleHeader:readHeader,encodeBytes,encodeText:(s,k,o)=>encodeBytes(txt(s),k,o),decodeSheets};
  // Explicit test-only opt-in; absent from the normal browser/worker API. Never logs secrets.
  if(root.RDSTREAM_TESTING===true)root.RDStreamCore.testing={keys,sha,mac,cat,txt,u32,domain,sessionOf,makeHeader,parseHeader,makeMiniHeader,parseMiniHeader,readHeader,layout,publicLayout,field,readCode,frameEncode,frameDecode,rsEncode,rsDecode,initial,evolve,render,stateBytes,context,startState,checkpointTag,syncTag,sheetContext,frameTag,messageTag,capacity,frameCount,totalCapacity,eq};
})(typeof window==='undefined'?globalThis:window);
