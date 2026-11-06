'use strict';
const CardCelebration = (() => {
  let stopCurrent = null;
  function start(cards) {
    stopCurrent?.();
    const queue = cards.filter(card => card.quantity > 0).slice();
    if (!queue.length) return;
    for (let i=queue.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [queue[i],queue[j]]=[queue[j],queue[i]];
    }
    const previousFocus=document.activeElement;
    const overlay=document.createElement('dialog');
    overlay.className='card-celebration';
    overlay.setAttribute('aria-label','Card celebration. Click anywhere or press Escape to dismiss.');
    const canvas=document.createElement('canvas');
    canvas.setAttribute('aria-hidden','true');
    overlay.append(canvas);document.body.append(overlay);overlay.showModal();
    const width=innerWidth,height=innerHeight,ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
    const cardWidth=Math.min(112,width/4),cardHeight=cardWidth*337/245;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    let stopped=false,frame=0,timer=0,last=0,index=0,pending=0;
    const active=[],loading=new Set();
    const launchOffset=Math.random();
    function stop(event) {
      event?.preventDefault();event?.stopImmediatePropagation();
      if(stopped)return;
      stopped=true;cancelAnimationFrame(frame);clearTimeout(timer);
      for(const img of loading){img.onload=img.onerror=null;img.src='';}
      loading.clear();active.length=0;
      document.removeEventListener('click',stop,true);
      window.removeEventListener('resize',stop);
      overlay.close();overlay.remove();stopCurrent=null;
      if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    }
    stopCurrent=stop;
    document.addEventListener('click',stop,true);
    window.addEventListener('resize',stop);
    overlay.addEventListener('cancel',stop);
    function sprite(card,image) {
      const tile=document.createElement('canvas');tile.width=Math.round(cardWidth*ratio);tile.height=Math.round(cardHeight*ratio);
      const paint=tile.getContext('2d');paint.scale(ratio,ratio);
      paint.beginPath();paint.roundRect(0,0,cardWidth,cardHeight,7);paint.clip();
      if(image)paint.drawImage(image,0,0,cardWidth,cardHeight);
      else {
        paint.fillStyle='#365e68';paint.fillRect(0,0,cardWidth,cardHeight);
        paint.strokeStyle='#eee6c2';paint.lineWidth=3;paint.strokeRect(6,6,cardWidth-12,cardHeight-12);
        paint.fillStyle='#fff';paint.textAlign='center';paint.font='bold 12px Arial';
        const words=card.name.split(' ');let line='',y=cardHeight*.4;
        for(const word of words){const next=(line+' '+word).trim();if(paint.measureText(next).width>cardWidth-20&&line){paint.fillText(line,cardWidth/2,y,cardWidth-20);line=word;y+=16;}else line=next;}
        paint.fillText(line,cardWidth/2,y,cardWidth-20);
      }
      return tile;
    }
    function launch(card,slot) {
      pending++;
      const image=new Image();loading.add(image);
      const ready=ok=>{
        loading.delete(image);image.onload=image.onerror=null;pending--;
        if(stopped)return;
        const tile=sprite(card,ok?image:null);
        if(reduced) {
          const columns=Math.max(1,Math.floor(width/(cardWidth+8)));
          const x=(slot%columns)*(cardWidth+8),y=(Math.floor(slot/columns)*(cardHeight+8))%Math.max(cardHeight,height-cardHeight);
          ctx.drawImage(tile,x,y,cardWidth,cardHeight);
        }else {
          // Golden-ratio spacing visits the entire top edge without fixed launch lanes.
          const x=((launchOffset+slot*.618033988749895)%1)*width-cardWidth/2;
          const direction=Math.random()<.5?-1:1;
          active.push({tile,x,y:-cardHeight/3,vx:direction*(40+Math.random()*320),vy:-40+Math.random()*180});
        }
      };
      image.onload=()=>ready(true);image.onerror=()=>ready(false);
      image.src=`images/${encodeURIComponent(card.id)}`;
    }
    function feed() {
      if(stopped)return;
      if((!reduced||index<queue.length) && pending+active.length<8)launch(queue[index%queue.length],index++);
      // Keep dealing until dismissed, including for small collections.
      if(!reduced||index<queue.length)timer=setTimeout(feed,220);
    }
    function tick(time) {
      if(stopped)return;
      const dt=Math.min((time-(last||time))/1000,1/30);last=time;
      // Deliberately never clear: every frame leaves a classic Solitaire trail.
      for(let i=active.length-1;i>=0;i--) {
        const card=active[i];card.vy+=1100*dt;card.x+=card.vx*dt;card.y+=card.vy*dt;
        if(card.y+cardHeight>=height && card.vy>0){card.y=height-cardHeight;card.vy=-Math.max(220,card.vy*.76);}
        ctx.drawImage(card.tile,card.x,card.y,cardWidth,cardHeight);
        if(card.x>width+cardWidth||card.x<-cardWidth*2)active.splice(i,1);
      }
      frame=requestAnimationFrame(tick);
    }
    feed();if(!reduced)frame=requestAnimationFrame(tick);
  }
  return {start};
})();
