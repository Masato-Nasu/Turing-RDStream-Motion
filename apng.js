/* P0.3 strict APNG reader: bounded, CRC/sequence/control checked, all visible frames retained.
   It does not authenticate by CRC: core.js authenticates the transcript and replays every raster. */
(function(root){'use strict';
 const SIG=Uint8Array.of(137,80,78,71,13,10,26,10),te=new TextEncoder(),strideFor=n=>Math.max(1,Math.ceil(119/Math.max(1,n-1))),MAX_KEYS=128,MAX_VISUAL=240,MAX_FILE=160*1024*1024;
 const table=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc(a){let c=0xffffffff;for(const b of a)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
 function concat(...a){const o=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let p=0;for(const x of a){o.set(x,p);p+=x.length;}return o;}
 function chunk(type,data){const out=new Uint8Array(data.length+12),dv=new DataView(out.buffer);dv.setUint32(0,data.length);out.set(te.encode(type),4);out.set(data,8);dv.setUint32(data.length+8,crc(out.subarray(4,data.length+8)));return out;}
 async function compressed(raw){return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());}
 async function compressFrame(src){const N=root.RDStreamCore.N;if(src.length!==N*N)throw Error('raster size');const raw=new Uint8Array((N+1)*N);for(let y=0;y<N;y++)raw.set(src.subarray(y*N,(y+1)*N),y*(N+1)+1);return compressed(raw);}
 async function encode(sheets,durationMs=5000,progress){
   const N=root.RDStreamCore.N;if(!sheets.length||sheets.length>MAX_KEYS||durationMs!==5000)throw Error('Motion resource limit');
   const STRIDE=strideFor(sheets.length),visual=[sheets[0].frames[0]];for(let i=1;i<sheets.length;i++){const d=sheets[i].displayFrames;if(d?.length!==STRIDE)throw Error('Motion cadence');visual.push(...d);}
   const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);v.setUint32(0,N);v.setUint32(4,N);ihdr[8]=8;
   const actl=new Uint8Array(8),a=new DataView(actl.buffer);a.setUint32(0,visual.length);a.setUint32(4,0);
   const parts=[SIG,chunk('IHDR',ihdr),chunk('acTL',actl)];let seq=0;
   for(let i=0;i<visual.length;i++){const f=new Uint8Array(26),d=new DataView(f.buffer);d.setUint32(0,seq++);d.setUint32(4,N);d.setUint32(8,N);d.setUint16(20,Math.round((i+1)*5000/visual.length)-Math.round(i*5000/visual.length));d.setUint16(22,1000);parts.push(chunk('fcTL',f));const z=await compressFrame(visual[i]);if(!i)parts.push(chunk('IDAT',z));else{const b=new Uint8Array(z.length+4);new DataView(b.buffer).setUint32(0,seq++);b.set(z,4);parts.push(chunk('fdAT',b));}if(progress)await progress(i+1,visual.length);}
   parts.push(chunk('IEND',new Uint8Array()));const out=concat(...parts);if(out.length>MAX_FILE)throw Error('Motion file limit');return out;
 }
 async function inflateBounded(data,max){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),out=new Uint8Array(max);let n=0;try{for(;;){const {value,done}=await reader.read();if(done)break;if(n+value.length>max){await reader.cancel();throw Error('Inflation limit');}out.set(value,n);n+=value.length;}}finally{reader.releaseLock();}if(n!==max)throw Error('Raster length');return out;}
 async function decode(input,progress,options={}){
   const b=input instanceof Uint8Array?input:new Uint8Array(input),N=root.RDStreamCore.N,read32=(a,p)=>new DataView(a.buffer,a.byteOffset,a.byteLength).getUint32(p);
   if(b.length<8||b.length>MAX_FILE||!SIG.every((v,i)=>b[i]===v))throw Error('PNG signature / limit');
   let p=8,phase=0,seq=0,expected=0,current=null,ended=false,controls=0;const frames=[];
   while(p<b.length){if(p+12>b.length)throw Error('Truncated chunk');const len=read32(b,p);if(len>b.length-p-12)throw Error('Chunk bounds');const typ=String.fromCharCode(...b.subarray(p+4,p+8)),data=b.subarray(p+8,p+8+len);if(read32(b,p+8+len)!==crc(b.subarray(p+4,p+8+len)))throw Error('PNG CRC');p+=len+12;
    if(typ==='IHDR'){if(phase!==0||len!==13||read32(data,0)!==N||read32(data,4)!==N||data[8]!==8||data.slice(9).some(Boolean))throw Error('IHDR profile');phase=1;}
    else if(typ==='acTL'){if(phase!==1||len!==8)throw Error('acTL order');expected=read32(data,0);const plays=read32(data,4);if(expected<1||expected>MAX_VISUAL||(plays!==0&&plays!==1))throw Error('acTL range');phase=2;}
    else if(typ==='fcTL'){if(phase<2||len!==26||current&&!current.length||controls>=expected)throw Error('fcTL order');if(current)frames.push(current);const d=new DataView(data.buffer,data.byteOffset,len),delay=Math.round((controls+1)*5000/expected)-Math.round(controls*5000/expected);if(d.getUint32(0)!==seq++||d.getUint32(4)!==N||d.getUint32(8)!==N||d.getUint32(12)||d.getUint32(16)||d.getUint16(20)!==delay||d.getUint16(22)!==1000||data[24]||data[25])throw Error('fcTL control');controls++;current=[];phase=3;}
    else if(typ==='IDAT'){if(phase!==3||controls!==1||!len)throw Error('IDAT order');current.push(data);}
    else if(typ==='fdAT'){if(phase!==3||controls<2||len<5||read32(data,0)!==seq++)throw Error('fdAT sequence');current.push(data.subarray(4));}
    else if(typ==='IEND'){if(phase!==3||len||!current?.length||controls!==expected||p!==b.length)throw Error('IEND / trailing data');frames.push(current);ended=true;break;}
    else throw Error('Unsupported chunk');
   }
   if(!ended||frames.length!==expected)throw Error('Incomplete APNG');
   let STRIDE=0,totalInfo=0,sheetSpan=0;const sheets=[];for(let i=0;i<frames.length;i++){const raw=await inflateBounded(concat(...frames[i]),(N+1)*N),gray=new Uint8Array(N*N);for(let y=0;y<N;y++){
     const filter=raw[y*(N+1)];if(filter>4)throw Error('PNG filter profile');
     for(let x=0;x<N;x++){const a=x?gray[y*N+x-1]:0,b=y?gray[(y-1)*N+x]:0,c=x&&y?gray[(y-1)*N+x-1]:0;
      let prediction=0;if(filter===1)prediction=a;else if(filter===2)prediction=b;else if(filter===3)prediction=(a+b)>>1;else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);prediction=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      gray[y*N+x]=(raw[y*(N+1)+x+1]+prediction)&255;
     }
    }
     if(i===0){let localCount=options.infoCount;if(localCount==null){const header=await root.RDStreamCore.readVisibleHeader(gray);totalInfo=header.count;sheetSpan=header.sheetSpan;localCount=Math.min(sheetSpan,totalInfo);}if(!Number.isInteger(localCount)||localCount<1||localCount>MAX_KEYS)throw Error('Information frame limit');STRIDE=strideFor(localCount);if(expected!==1+(localCount-1)*STRIDE)throw Error('Motion cadence');sheets.push({index:0,frames:[gray],displayFrames:[gray]});}else{const ki=Math.ceil(i/STRIDE);if(!sheets[ki])sheets[ki]={index:ki,frames:[],displayFrames:[]};sheets[ki].displayFrames.push(gray);if(i%STRIDE===0)sheets[ki].frames=[gray];}if(progress)await progress(i+1,frames.length);
   }sheets.totalInfo=totalInfo;sheets.sheetSpan=sheetSpan;return sheets;
 }
 root.RDMotionAPNG={encode,decode,strideFor,MAX_KEYS,MAX_FILE};
})(globalThis);
