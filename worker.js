importScripts('tables.js?v=0.3.10','transform.js?v=0.3.10','organic.js?v=0.3.10','core.js?v=0.3.10','motion-payload.js?v=0.3.10','apng.js?v=0.3.10','transport.js?v=0.3.10','zip.js?v=0.3.10');
self.postMessage({ready:true});
let running=false;
self.onmessage=async({data:{id,op,args}})=>{
 if(running){self.postMessage({id,error:'処理中です'});return;}running=true;
 try{
  const progress=(current,total)=>self.postMessage({id,progress:{current,total,phase:op==='encode'?'RD模様を生成':'RD状態と表示を検証'}});
  progress(0,0);
  if(op==='encode'){
   const raw=args.bytes?new Uint8Array(args.bytes):new TextEncoder().encode(args.text||''),r=await RDMotionTransport.encode(raw,args.key,{sheetSpan:args.sheetSpan,progress});
   self.postMessage({id,result:r},r.files.map(x=>x.data.buffer));
  }else if(op==='decode'){
   let inputs=args.inputs;if(!inputs?.length)throw Error('画像を選択してください');
   if(inputs.length===1&&/\.zip$/i.test(inputs[0].name)){const entries=await RDStreamZIP.read(new Uint8Array(inputs[0].buffer));inputs=entries.map(x=>({name:x.name,buffer:x.data}));}
   else if(inputs.some(x=>/\.zip$/i.test(x.name)))throw Error('ZIPは1つだけ選択してください');
   const r=await RDMotionTransport.decode(inputs.map(x=>new Uint8Array(x.buffer)),args.key,{progress});self.postMessage({id,result:r},[r.bytes.buffer]);
  }else if(op==='preview'){
   const input=args.inputs?.[0];if(!input)throw Error('APNGがありません');
   const sheets=await RDMotionAPNG.decode(new Uint8Array(input.buffer),null,{infoCount:args.infoCount});
   const frames=[];for(const sheet of sheets)for(const gray of sheet.displayFrames)frames.push(gray.buffer);
   self.postMessage({id,result:{frames,durationMs:5000}},frames);
  }else throw Error('Unknown operation');
 }catch(e){self.postMessage({id,error:e.message||String(e)});}finally{running=false;}
};
