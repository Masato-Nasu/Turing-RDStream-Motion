/* Images-only segmented APNG transport. File names are not cryptographic input. */
(function(root){'use strict';
 const MAX_INPUT=131072,MAX_TOTAL=512*1024*1024;
 async function encode(input,password,options={}){
  if(!input.length||input.length>MAX_INPUT)throw Error('入力は1〜131072 bytesです');
  const packed=await RDMotionPayload.pack(input),files=[],sheetSpan=options.sheetSpan??128;let window=[];
  const encoded=await RDStreamCore.encodeBytes(packed.bytes,password,{sheetSpan,retainSheets:false,progress:options.progress,onSheet:async(sheet,total)=>{
   window.push(sheet);if(window.length===sheetSpan||sheet.index===total-1){const data=await RDMotionAPNG.encode(window,5000);files.push({name:`rdstream-p03-r4-${String(files.length+1).padStart(3,'0')}.apng`,data,infoCount:window.length});window=[];if(files.reduce((n,x)=>n+x.data.length,0)>MAX_TOTAL)throw Error('画像合計が512 MiBを超えています');}
  }});
  return {files,rawBytes:input.length,packedBytes:packed.bytes.length,count:encoded.count,sheetSpan};
 }
 async function readFrames(files,progress){
  if(!files.length||files.length>32||files.reduce((n,x)=>n+x.length,0)>MAX_TOTAL)throw Error('画像数／合計サイズが上限を超えています');
  const all=[],first=await RDMotionAPNG.decode(files[0],progress),total=first.totalInfo,span=first.sheetSpan;
  if(files.length!==Math.ceil(total/span))throw Error('シート欠損／余分なシート');all.push(...first);
  for(let i=1;i<files.length;i++){const count=Math.min(span,total-i*span),s=await RDMotionAPNG.decode(files[i],progress,{infoCount:count});all.push(...s);}
  return all;
 }
 async function decode(files,password,options={}){
  const frames=await readFrames(files,options.imageProgress),r=await RDStreamCore.decodeSheets(frames,password,{progress:options.progress}),bytes=await RDMotionPayload.unpack(r.bytes);let text=null;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
  return {bytes,text,details:r.details,count:frames.length,sheets:files.length};
 }
 root.RDMotionTransport={encode,decode,readFrames,MAX_INPUT,MAX_TOTAL};
})(globalThis);
