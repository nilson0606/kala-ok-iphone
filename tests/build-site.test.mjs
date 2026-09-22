import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSite, assets } from '../build-site.mjs';

test('Pages HTML and all transitive modules use one immutable release, bypassing old bare asset URLs', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'karaoke-build-'));
 try {
  const source=path.join(dir,'source'), output=path.join(dir,'site'); await mkdir(source);
  for(const file of ['index.html','manual.html',...assets])await writeFile(path.join(source,file),await readFile(new URL('../'+file,import.meta.url)));
  const version=await buildSite(output,source);
  const html=await readFile(path.join(output,'index.html'),'utf8');
  const entries=[...html.matchAll(/(?:src|href)="([^"]+\.(?:css|mjs))"/g)].map(m=>m[1]);
  assert.equal(entries.length,3);
  for(const url of entries)assert.ok(url.startsWith('assets/'+version+'/'));
  for(const asset of assets.filter(a=>a.endsWith('.mjs'))){
   const file=path.join(output,'assets',version,asset), content=await readFile(file,'utf8');
   for(const match of content.matchAll(/from\s+['"](.+?\.mjs)['"]/g)){
    const dependency=path.resolve(path.dirname(file),match[1]);
    assert.equal(path.dirname(dependency),path.dirname(file));
    assert.ok((await readFile(dependency)).length>0);
   }
  }
  const oldSession=await readFile(path.join(output,'assets',version,'session.mjs'),'utf8');
  await writeFile(path.join(source,'session.mjs'),oldSession+'\n// changed behavior\n');
  const next=await buildSite(output,source);
  assert.notEqual(next,version);
  assert.equal(await readFile(path.join(output,'assets',version,'session.mjs'),'utf8'),oldSession);
  assert.ok((await readFile(path.join(output,'index.html'),'utf8')).includes('assets/'+next+'/app.mjs'));
  assert.deepEqual((await readdir(output)).sort(),['.nojekyll','assets','index.html','manual.html']);
 } finally {
  if(path.dirname(path.resolve(dir))===path.resolve(tmpdir())&&path.basename(dir).startsWith('karaoke-build-'))await rm(dir,{recursive:true,force:true});
 }
});
