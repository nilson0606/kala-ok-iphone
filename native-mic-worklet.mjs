class LocalMicProcessor extends AudioWorkletProcessor {
 constructor(){super();this.buffer=new Float32Array(48000);this.read=0;this.write=0;this.count=0;this.started=false;this.missing=0;this.failed=false;
  this.port.onmessage=({data})=>{if(this.failed)return;const a=data;if(!(a instanceof Float32Array))return;
   if(this.count+a.length>12000){this.fail('本機收音累積延遲過大，已停止，請重新開啟。');return;}
   for(const sample of a){this.buffer[this.write]=sample;this.write=(this.write+1)%this.buffer.length;}this.count+=a.length;
  };
 }
 fail(message){if(!this.failed){this.failed=true;this.port.postMessage({error:message});}}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;
  if(!this.started&&this.count>=1920){this.started=true;this.port.postMessage({ready:true});}
  for(let i=0;i<out.length;i++){
   if(this.started&&!this.failed&&this.count){out[i]=this.buffer[this.read];this.read=(this.read+1)%this.buffer.length;this.count--;this.missing=0;}
   else{out[i]=0;if(this.started&&!this.failed&&++this.missing>12000)this.fail('本機收音暫時中斷，已停止，請重新開啟。');}
  }return true;
 }
}
registerProcessor('local-microphone',LocalMicProcessor);
