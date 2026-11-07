const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..');
const pub=path.join(root,'promo/reel/public');
const P=path.join(root,'promo/payloads');
const mk=(name,templateId,w,h,frames,assets,out)=>{fs.writeFileSync(path.join(P,name+'.json'),JSON.stringify({templateId,settings:{width:w,height:h,fps:30,durationFrames:frames,transparent:false},assets},null,2));return {payload:path.join(P,name+'.json'),out:path.join(pub,out)}};
const jobs=[];
const sd=path.join(root,'packages/engine/src/scenes');
const ids=['product_reveal_v1','sale_burst_v1','stat_counter_v1','testimonial_v1','countdown_v1','logo_sting_v1','quote_card_v1','title_sequence_v1','new_post_v1','event_announcement_v1','bar_chart_v1','milestone_v1','breaking_news_v1','lower_third_v1'];
for(const id of ids){const j=JSON.parse(fs.readFileSync(path.join(sd,id+'.json')));jobs.push(mk(id,id,540,960,Math.min(180,Math.max(120,j.defaultSettings.durationFrames)),{},`clips/${id}.mp4`));}
for(const id of ['kinetic_text_v1','promo_card_v1','banner_v1']){const f={kinetic_text_v1:'kinetic_text',promo_card_v1:'promo_card',banner_v1:'banner'}[id];const s=JSON.parse(fs.readFileSync(path.join(root,'apps/worker/samples',f+'.json')));jobs.push(mk(id,id,540,960,120,s.assets,`clips/${id}.mp4`));}
const pr={eyebrow:'New arrival',productName:'Terra Ceramic Kettle'};
jobs.push(mk('formats_916','product_reveal_v1',1080,1920,120,{},'clips/formats/916.mp4'));
jobs.push(mk('formats_11','product_reveal_v1',1080,1080,120,{},'clips/formats/11.mp4'));
jobs.push(mk('formats_169','product_reveal_v1',1920,1080,120,{},'clips/formats/169.mp4'));
jobs.push(mk('palette_before','product_reveal_v1',1080,1920,120,{},'clips/palette/before.mp4'));
jobs.push(mk('palette_after','product_reveal_v1',1080,1920,120,{bgColor:'#0B0B1A',stageColor:'#3D7BFF',badgeColor:'#FFC93C',textColor:'#FF3D9A'},'clips/palette/after.mp4'));
jobs.push(mk('generated','sale_burst_v1',1080,1920,120,{headline:'AIR NEON',discount:'-30%',offWord:'Off',subline:'Drops Friday',cta:'Get yours',bgColor:'#0B0B1A',burstColor:'#FF3D9A',inkColor:'#39FF14',burstTextColor:'#FFFFFF',showConfetti:true},'clips/generated.mp4'));
fs.writeFileSync(path.join(__dirname,'jobs.json'),JSON.stringify(jobs,null,1));
