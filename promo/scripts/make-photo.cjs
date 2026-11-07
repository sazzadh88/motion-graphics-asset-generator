const {createCanvas}=require('@napi-rs/canvas');const fs=require('fs'),path=require('path');
const pub=path.resolve(__dirname,'../reel/public/palette');
const W=1080,c=createCanvas(W,W),g=c.getContext('2d');
g.fillStyle='#0B0B1A';g.fillRect(0,0,W,W);
const blob=(x,y,r,col,a)=>{const gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,col+a);gr.addColorStop(1,col+'00');g.fillStyle=gr;g.fillRect(0,0,W,W)};
blob(300,320,620,'#FF3D9A','F0');blob(800,260,560,'#3D7BFF','F0');blob(620,820,600,'#FFC93C','E6');blob(120,900,420,'#FF3D9A','99');blob(950,900,380,'#3D7BFF','88');blob(540,540,300,'#0B0B1A','88');
// soft grain
const id=g.getImageData(0,0,W,W);for(let i=0;i<id.data.length;i+=4){const n=(Math.random()-.5)*10;id.data[i]+=n;id.data[i+1]+=n;id.data[i+2]+=n}g.putImageData(id,0,0);
fs.writeFileSync(path.join(pub,'photo.png'),c.toBuffer('image/png'));
fs.writeFileSync(path.join(pub,'colors.json'),JSON.stringify({primary:'#FF3D9A',colors:['#FF3D9A','#3D7BFF','#FFC93C','#0B0B1A']},null,2));
