const path=require('path');const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../..');
const jobs=require('./jobs.json');
const only=process.argv[2];
for(const j of jobs){ if(only&&!j.out.includes(only))continue;
 const r=spawnSync(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'src/cli.ts',j.payload,'--format','mp4','--out',j.out],{cwd:path.join(root,'apps/worker'),encoding:'utf8'});
 console.log(r.status===0?'OK  ':'FAIL',j.out.split('public')[1]);
 if(r.status!==0)console.log((r.stdout+r.stderr).slice(-500));}
