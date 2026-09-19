/* Motion payload wrapper: exact reversible compression inside visible RD frames. */
(function(root){'use strict';
 const MAX_RAW=131072;
 const MAGIC=Uint8Array.of(82,68,77,49); // RDM1
 const concat=(...a)=>{const o=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let p=0;for(const x of a){o.set(x,p);p+=x.length;}return o;};
 const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 async function deflate(bytes){const s=new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));return new Uint8Array(await new Response(s).arrayBuffer());}
 async function inflate(bytes,len){
  if(len>MAX_RAW)throw Error('Payload limit');const r=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),out=new Uint8Array(len);let n=0;
  try{for(;;){const {value,done}=await r.read();if(done)break;if(n+value.length>len){await r.cancel();throw Error('Payload inflation limit');}out.set(value,n);n+=value.length;}}finally{r.releaseLock();}if(n!==len)throw Error('Payload length');return out;
 }
 async function pack(input){
   const raw=Uint8Array.from(input);if(raw.length>MAX_RAW)throw Error('Payload limit');const zipped=await deflate(raw),compressed=zipped.length<raw.length;
   const h=new Uint8Array(12),dv=new DataView(h.buffer);h.set(MAGIC);h[4]=1;h[5]=compressed?1:0;dv.setUint32(8,raw.length);
   return {bytes:concat(h,compressed?zipped:raw),rawBytes:raw.length,compressedBytes:compressed?zipped.length:raw.length,compressed};
 }
 async function unpack(payload){
   const b=Uint8Array.from(payload);if(b.length<12||!eq(b.slice(0,4),MAGIC)||b[4]!==1||b[6]||b[7])throw Error('Motion payload header invalid');
   const len=new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(8),body=b.slice(12);let raw;
   if(len>MAX_RAW)throw Error('Payload limit');
   if(b[5]===1)raw=await inflate(body,len);else if(b[5]===0)raw=body;else throw Error('Motion payload compression flag invalid');
   if(raw.length!==len)throw Error('Motion payload length mismatch');return raw;
 }
 root.RDMotionPayload={pack,unpack,MAX_RAW};
})(typeof window==='undefined'?globalThis:window);
