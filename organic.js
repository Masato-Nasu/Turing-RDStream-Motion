/* Deterministic Q20 Gray–Scott carrier; rendered values are evolved V only. */
(function(root){'use strict';
// Research-only soft Viterbi, K=9, rate 1/2, octal 557/663.
const P=[0o557,0o663],parity=x=>{x^=x>>>4;x^=x>>>2;x^=x>>>1;return x&1;};
const signs=Array.from({length:512},(_,r)=>P.map(p=>parity(r&p)?1:-1));
const convEncode=bytes=>{let state=0;const out=new Uint8Array((bytes.length*8+8)*2);for(let t=0;t<bytes.length*8+8;t++){const bit=t<bytes.length*8?(bytes[t>>3]>>(7-(t&7)))&1:0;state=((state<<1)|bit)&511;for(let j=0;j<2;j++)out[t*2+j]=(signs[state][j]+1)/2;}return out;};
const convDecode=(scores,nbytes)=>{const steps=nbytes*8+8,path=new Uint8Array(steps*256);let cost=new Float64Array(256).fill(-1e30),next=new Float64Array(256);cost[0]=0;for(let t=0;t<steps;t++){
 for(let st=0;st<256;st++){const a=st>>>1,b=a+128,ra=st,rb=st+256,sa=signs[ra],sb=signs[rb],x=scores[t*2],y=scores[t*2+1],ca=cost[a]+sa[0]*x+sa[1]*y,cb=cost[b]+sb[0]*x+sb[1]*y;next[st]=ca>=cb?ca:cb;path[t*256+st]=ca>=cb?0:1;}[cost,next]=[next,cost];
 }let state=0;const out=new Uint8Array(nbytes);for(let t=steps-1;t>=0;t--){if(t<nbytes*8)out[t>>3]|=(state&1)<<(7-(t&7));state=(state>>>1)+(path[t*256+state]?128:0);}return out;};

const N=512,NN=N*N,Q=1048576,rd=(x,d)=>Math.floor(x/d+.5),clamp=x=>Math.max(0,Math.min(Q,x));
const XP=new Int32Array(N),XN=new Int32Array(N),YP=new Int32Array(N),YN=new Int32Array(N);
for(let i=0;i<N;i++){XP[i]=i?i-1:N-1;XN[i]=i+1<N?i+1:0;YP[i]=(i?i-1:N-1)*N;YN[i]=(i+1<N?i+1:0)*N;}
function tanhQ(x){if(x>=3*Q)return Q;if(x<=-3*Q)return -Q;const square=rd(x*x,Q);return rd(x*(27*Q+square),27*Q+9*square);}
function renderMotion(s){return render(s);}
function evolve(old,E,steps,inject,motionFrames=0){
 let U=old.U.slice(),V=old.V.slice(),U2=new Float64Array(NN),V2=new Float64Array(NN);
 const K=new Float64Array(NN),motion=[];
 for(let i=0;i<NN;i++){const e=E[i];K[i]=rd(15*tanhQ(rd(e,2)),10000);if(inject)V[i]=clamp(V[i]+rd(3*tanhQ(rd(2*e,3)),100));}
 let nextCapture=motionFrames?Math.round(steps/(motionFrames+1)):0;
 for(let t=0;t<steps;t++){
  for(let y=0,row=0;y<N;y++,row+=N){const up=YP[y],dn=YN[y];
   for(let x=0;x<N;x++){const i=row+x,le=row+XP[x],ri=row+XN[x],u=U[i],v=V[i],uvv=rd(rd(u*v,Q)*v,Q),lu=U[up+x]+U[dn+x]+U[le]+U[ri]-4*u,lv=V[up+x]+V[dn+x]+V[le]+V[ri]-4*v;
    U2[i]=clamp(u+rd(18*lu,100)-uvv+rd(29*(Q-u),1000));
    V2[i]=clamp(v+rd(9*lv,100)+uvv-rd(845*v,10000)-rd(K[i]*v,Q));
   }
  }
  const a=U;U=U2;U2=a;const b=V;V=V2;V2=b;
  if(motionFrames&&motion.length<motionFrames&&(t+1)>=nextCapture){motion.push(renderMotion({U,V}));nextCapture=Math.round(steps*(motion.length+1)/(motionFrames+1));}
 }
 return motionFrames?{state:{U,V},motion}:{U,V};
}
/* HMAC-expanded seed -> low-frequency deterministic seed field.
   32x32 coarse values are bilinearly expanded; no small PRNG state is introduced. */
function initial(seed){
 if(seed.length!==65536)throw Error('HMAC-expanded state initialization requires 65536 bytes');
 const G=32,coarse=new Int32Array(G*G);
 for(let gy=0;gy<G;gy++)for(let gx=0;gx<G;gx++){
  let s=0;const p=(gy*G+gx)*16;for(let j=0;j<16;j++)s+=seed[p+j];coarse[gy*G+gx]=s;
 }
 const U=new Float64Array(NN);U.fill(Q);const V=new Float64Array(NN),scale=N/G;
 for(let y=0,row=0;y<N;y++,row+=N){const fy=y%scale,gy=(y/scale)|0,gy1=(gy+1)&(G-1),wy=fy,iy=scale-fy;
  for(let x=0;x<N;x++){const fx=x%scale,gx=(x/scale)|0,gx1=(gx+1)&(G-1),wx=fx,ix=scale-fx;
   const a=coarse[gy*G+gx],b=coarse[gy*G+gx1],c=coarse[gy1*G+gx],d=coarse[gy1*G+gx1];
   const smooth=rd((a*ix+b*wx)*iy+(c*ix+d*wx)*wy,scale*scale);
   if(smooth>2150){const i=row+x;U[i]=Q/2;V[i]=Q/4;}
  }
 }
 return evolve({U,V},new Float64Array(NN),800,false);
}
function render(s){
 const sorted=s.V.slice().sort(),lo=sorted[Math.floor(.02*sorted.length)],hi=sorted[Math.floor(.98*sorted.length)],threshold=sorted[Math.floor(.54*sorted.length)],span=Math.max(1,hi-lo),out=new Uint8Array(NN);
 for(let i=0;i<NN;i++)out[i]=10+rd(235*(Q+tanhQ(rd(14*(s.V[i]-threshold)*Q,span))),2*Q);
 return out;
}
root.RDOrganic={initial,injectAndEvolve:(state,E)=>evolve(state,E,1600,true),injectAndEvolveMotion:(state,E,n=7)=>evolve(state,E,1600,true,n),render,renderMotion,convEncode,convDecode};
})(typeof window==='undefined'?globalThis:window);
