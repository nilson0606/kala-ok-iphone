import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalLibrary, cacheKey } from '../local-library.mjs';

test('library persists across instances, upgrades preview and deletes only the selected range', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'karaoke-library-'));
  try {
    const source = path.join(dir, 'source'); await mkdir(source);
    await writeFile(path.join(source, 'vocals.mp3'), 'test-vocals'); await writeFile(path.join(source, 'accompaniment.mp3'), 'test-accompaniment');
    const library = new LocalLibrary(path.join(dir, 'library'));
    const ref = { version: 1, videoId: 'M7lc1UVf-VE', title: 'Test', step: .1, frames: Array(100).fill(440), duration: 10, rangeSeconds: 30 };
    const id = cacheKey(ref.videoId, 30), full = cacheKey(ref.videoId, 0);
    await library.save(id, ref, source, false);
    const reopened = new LocalLibrary(path.join(dir, 'library'));
    assert.equal((await reopened.get(id)).hasPreview, false);
    assert.equal(await reopened.audio(id, 'vocals'), null);
    await reopened.save(id, ref, source, true);
    assert.equal((await reopened.audio(id, 'vocals')).toString(), 'test-vocals');
    const replacement = path.join(dir, 'replacement'); await mkdir(replacement);
    await writeFile(path.join(replacement, 'vocals.mp3'), 'new-vocals');
    // A missing second stem must never partially overwrite the old working song.
    await assert.rejects(reopened.save(id, { ...ref, title:'New' }, replacement, true, { replace:true }));
    assert.equal((await reopened.get(id)).title, 'Test');
    assert.equal((await reopened.audio(id, 'vocals')).toString(), 'test-vocals');
    await writeFile(path.join(replacement, 'accompaniment.mp3'), 'new-accompaniment');
    await assert.rejects(reopened.save(id, { ...ref, title:'Cancelled' }, replacement, true, { replace:true, cancelled:()=>true }));
    assert.equal((await reopened.get(id)).title, 'Test');
    await reopened.save(id, { ...ref, title:'New' }, replacement, true, { replace:true });
    assert.equal((await reopened.get(id)).title, 'New');
    assert.equal((await reopened.audio(id, 'vocals')).toString(), 'new-vocals');
    assert.equal((await reopened.audio(id, 'accompaniment')).toString(), 'new-accompaniment');
    assert.deepEqual((await readdir(reopened.root)).filter(name => name.startsWith('.')), []);
    // An explicit rebuild without previews removes previous stems only after success.
    await reopened.save(id, ref, replacement, false, { replace:true });
    assert.equal((await reopened.get(id)).hasPreview, false);
    assert.equal(await reopened.audio(id, 'vocals'), null);

    await reopened.save(full, { ...ref, rangeSeconds: 0 }, source, false);
    assert.equal((await reopened.list()).length, 2);
    await reopened.delete(id);
    assert.equal(await reopened.get(id), null); assert.ok(await reopened.get(full));
    assert.throws(() => reopened.directory('../outside'));
    assert.throws(() => cacheKey('bad', 30));
  } finally {
    const target = path.resolve(dir);
    if (path.dirname(target) === path.resolve(tmpdir()) && path.basename(target).startsWith('karaoke-library-')) await rm(target, { recursive: true, force: true });
  }
});

test('lead and default modes have separate caches; incomplete lead previews cannot replace a saved result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'karaoke-library-'));
  try {
    const source = path.join(dir, 'source'); await mkdir(source);
    for (const stem of ['vocals','accompaniment','lead','backing']) await writeFile(path.join(source,stem+'.mp3'),stem);
    const library = new LocalLibrary(path.join(dir,'library'));
    const ref={version:1,videoId:'M7lc1UVf-VE',title:'Modes',step:.1,frames:Array(100).fill(440),duration:10,rangeSeconds:30};
    const all=cacheKey(ref.videoId,30),lead=cacheKey(ref.videoId,30,'lead');
    assert.equal(all,'M7lc1UVf-VE_30_v1'); assert.notEqual(all,lead);
    await library.save(all,ref,source,true);
    await library.save(lead,{...ref,vocalMode:'lead'},source,true);
    assert.deepEqual((await library.list()).map(s=>s.vocalMode).sort(),['all','lead']);
    assert.equal(await library.audio(all,'lead'),null);
    assert.equal((await library.audio(lead,'lead')).toString(),'lead');
    assert.equal((await library.audio(lead,'backing')).toString(),'backing');
    await rm(path.join(source,'backing.mp3'));
    await assert.rejects(library.save(lead,{...ref,vocalMode:'lead',title:'Incomplete'},source,true,{replace:true}));
    assert.equal((await library.get(lead)).title,'Modes');
    await assert.rejects(library.save(all,{...ref,vocalMode:'lead'},source,false));
    await library.delete(lead);
    assert.ok(await library.get(all)); assert.equal(await library.get(lead),null);
    assert.throws(()=>cacheKey(ref.videoId,30,'unsupported'));
  } finally {
    if(path.dirname(path.resolve(dir))===path.resolve(tmpdir()) && path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});
  }
});


test('model versions preserve legacy IDs and isolate replacement, preview access and deletion', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'karaoke-library-'));
  try {
    const source = path.join(dir, 'source'); await mkdir(source);
    for (const stem of ['vocals','accompaniment','lead','backing']) await writeFile(path.join(source, stem+'.mp3'), 'old-'+stem);
    const library = new LocalLibrary(path.join(dir,'library'));
    const ref = {version:1,videoId:'M7lc1UVf-VE',title:'Legacy',step:.1,frames:Array(100).fill(440),duration:10,rangeSeconds:30};
    const ids = [];
    for (const model of ['demucs','bs-roformer','mel-roformer']) for (const mode of ['all','lead']) {
      const id = cacheKey(ref.videoId,30,mode,model); ids.push(id);
      await library.save(id,{...ref,vocalMode:mode,...(model==='demucs'?{}:{separationModel:model})},source,true);
    }
    assert.equal(new Set(ids).size,6);
    assert.deepEqual(ids.slice(0,2),['M7lc1UVf-VE_30_v1','M7lc1UVf-VE_30_lead_v1']);
    const reopened = new LocalLibrary(library.root);
    assert.equal((await reopened.get(ids[0])).separationModel,'demucs');
    assert.deepEqual((await reopened.list()).map(s=>s.separationModel).sort(),['bs-roformer','bs-roformer','demucs','demucs','mel-roformer','mel-roformer']);
    await assert.rejects(reopened.save(ids[0],{...ref,separationModel:'bs-roformer'},source,true));
    await writeFile(path.join(source,'vocals.mp3'),'new-vocals');
    await reopened.save(ids[2],{...ref,separationModel:'bs-roformer'},source,true,{replace:true});
    assert.equal((await reopened.audio(ids[2],'vocals')).toString(),'new-vocals');
    for (const id of [ids[0],ids[1],ids[3],ids[4],ids[5]]) assert.equal((await reopened.audio(id,'vocals')).toString(),'old-vocals');
    assert.equal(await reopened.audio(ids[2],'lead'),null);
    assert.equal((await reopened.audio(ids[3],'lead')).toString(),'old-lead');
    await reopened.delete(ids[2]);
    assert.equal(await reopened.get(ids[2]),null);
    for (const id of [ids[0],ids[1],ids[3],ids[4],ids[5]]) assert.ok(await reopened.get(id));
    assert.throws(()=>cacheKey(ref.videoId,30,'all','unknown'));
  } finally {
    if(path.dirname(path.resolve(dir))===path.resolve(tmpdir()) && path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});
  }
});


test('saved masks survive reopen/rebuild and are shared across models without altering audio or raw melody', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'karaoke-library-'));
  try {
    const source=path.join(dir,'source');await mkdir(source);
    for(const stem of ['vocals','accompaniment'])await writeFile(path.join(source,stem+'.mp3'),'unchanged-'+stem);
    const library=new LocalLibrary(path.join(dir,'library'));
    const ref={version:1,videoId:'M7lc1UVf-VE',title:'Saved masks',step:.1,frames:Array(100).fill(440),duration:10,rangeSeconds:30};
    const id=cacheKey(ref.videoId,30),bs=cacheKey(ref.videoId,30,'all','bs-roformer');
    await library.save(id,ref,source,true);await library.save(bs,{...ref,separationModel:'bs-roformer'},source,true);
    const masks=[{start:1,end:2},{start:4,end:6}];
    await library.setMasks(id,masks);
    const reopened=new LocalLibrary(library.root);
    assert.deepEqual((await reopened.get(id)).masks,masks);
    assert.deepEqual((await reopened.get(bs)).masks,masks);
    assert.deepEqual((await reopened.get(id)).frames,ref.frames);
    assert.equal((await reopened.audio(id,'vocals')).toString(),'unchanged-vocals');
    await assert.rejects(reopened.setMasks(id,[{start:2,end:20}]));
    assert.deepEqual((await reopened.get(id)).masks,masks);
    await reopened.save(id,ref,source,true,{replace:true});
    assert.deepEqual((await reopened.get(id)).masks,masks);
    await reopened.save(id,{...ref,duration:5,frames:Array(50).fill(440)},source,true,{replace:true});
    assert.deepEqual((await reopened.get(id)).masks,[{start:1,end:2},{start:4,end:5}]);
    await reopened.setMasks(id,[]);assert.deepEqual((await reopened.get(id)).masks,[]);assert.deepEqual((await reopened.get(bs)).masks,[]);
    assert.deepEqual((await readdir(reopened.directory(id))).sort(),['accompaniment.mp3','reference.json','vocals.mp3']);
  } finally {
    if(path.dirname(path.resolve(dir))===path.resolve(tmpdir())&&path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});
  }
});


test('YIN and RMVPE caches are separate but share masks only for the same video/range', async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'karaoke-library-'));
  try {
    const library=new LocalLibrary(dir);
    const ref={version:1,videoId:'M7lc1UVf-VE',title:'Pitch variants',step:.1,frames:Array(100).fill(440),duration:10,rangeSeconds:30};
    const yin=cacheKey(ref.videoId,30),rmvpe=cacheKey(ref.videoId,30,'all','demucs','rmvpe'),short=cacheKey(ref.videoId,15);
    assert.equal(yin,'M7lc1UVf-VE_30_v1');assert.equal(rmvpe,'M7lc1UVf-VE_30_rmvpe_v1');
    await library.save(yin,ref,dir,false);await library.save(rmvpe,{...ref,pitchMethod:'rmvpe',frames:Array(100).fill(220)},dir,false);
    await library.save(short,{...ref,rangeSeconds:15},dir,false);
    assert.equal((await library.get(yin)).pitchMethod,'yin');assert.equal((await library.get(rmvpe)).pitchMethod,'rmvpe');
    await library.setMasks(yin,[{start:2,end:4}]);
    assert.deepEqual((await library.get(rmvpe)).masks,[{start:2,end:4}]);assert.deepEqual((await library.get(short)).masks,[]);
    await library.setMasks(rmvpe,[{start:5,end:6}]);assert.deepEqual((await library.get(yin)).masks,[{start:5,end:6}]);
    await library.save(rmvpe,{...ref,pitchMethod:'rmvpe'},dir,false,{replace:true});
    assert.deepEqual((await library.get(rmvpe)).masks,[{start:5,end:6}]);
    await assert.rejects(library.save(yin,{...ref,pitchMethod:'rmvpe'},dir,false));
    assert.throws(()=>cacheKey(ref.videoId,30,'all','demucs','unknown'));
    await library.delete(rmvpe);assert.ok(await library.get(yin));
    await library.save(rmvpe,{...ref,pitchMethod:'rmvpe'},dir,false);assert.deepEqual((await library.get(rmvpe)).masks,[{start:5,end:6}]);
  } finally {if(path.dirname(path.resolve(dir))===path.resolve(tmpdir())&&path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});}
});

test('residual workflow isolates results, preserves legacy defaults and shares masks', async () => {
 const dir=await mkdtemp(path.join(tmpdir(),'karaoke-library-'));
 try {
  const library=new LocalLibrary(path.join(dir,'library'));
  const ref={version:1,videoId:'M7lc1UVf-VE',title:'Original',step:.1,frames:Array(100).fill(440),duration:10,rangeSeconds:30};
  const old=cacheKey(ref.videoId,30), residual=cacheKey(ref.videoId,30,'all','demucs','yin','residual');
  await writeFile(path.join(dir,'vocals.mp3'),'old');await writeFile(path.join(dir,'accompaniment.mp3'),'backing');
  await library.save(old,ref,dir,true);
  await writeFile(path.join(dir,'vocals.mp3'),'residual');
  await library.save(residual,{...ref,separationMethod:'residual'},dir,true);
  assert.equal((await library.get(old)).separationMethod,'single');
  assert.equal((await library.audio(old,'vocals')).toString(),'old');
  assert.equal((await library.audio(residual,'vocals')).toString(),'residual');
  await library.setMasks(residual,[{start:2,end:4}]);
  assert.deepEqual((await library.get(old)).masks,[{start:2,end:4}]);
  const advanced=cacheKey(ref.videoId,30,'lead','bs-roformer','rmvpe','residual');
  await library.save(advanced,{...ref,vocalMode:'lead',separationModel:'bs-roformer',pitchMethod:'rmvpe',separationMethod:'residual'},dir,false);
  assert.deepEqual((await library.get(advanced)).masks,[{start:2,end:4}]);
  await assert.rejects(library.save(residual,ref,dir,true));
  await assert.rejects(library.save(residual,{...ref,separationMethod:'residual'},path.join(dir,'missing'),true,{replace:true}));
  assert.equal((await library.audio(residual,'vocals')).toString(),'residual');
  assert.equal((await library.list()).length,3);
  assert.throws(()=>cacheKey(ref.videoId,30,'all','demucs','yin','unknown'));
  await library.delete(residual); assert.ok(await library.get(old));assert.ok(await library.get(advanced));
 } finally {if(path.dirname(path.resolve(dir))===path.resolve(tmpdir())&&path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});}
});


test('all 24 model/workflow/vocal/pitch variants share masks but retain their own previews', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'karaoke-library-'));
 try {
  const library=new LocalLibrary(path.join(dir,'library'));
  const base={version:1,videoId:'M7lc1UVf-VE',title:'24 variants',step:.1,frames:Array(100).fill(440),duration:10,rangeSeconds:30};
  const ids=[];
  for(const separationModel of ['demucs','bs-roformer','mel-roformer'])
   for(const separationMethod of ['single','residual'])
    for(const vocalMode of ['all','lead'])
     for(const pitchMethod of ['yin','rmvpe']) {
      const id=cacheKey(base.videoId,30,vocalMode,separationModel,pitchMethod,separationMethod);ids.push(id);
      for(const stem of ['vocals','accompaniment','lead','backing'])await writeFile(path.join(dir,stem+'.mp3'),id+':'+stem);
      await library.save(id,{...base,separationModel,separationMethod,vocalMode,pitchMethod},dir,true);
     }
  assert.equal(new Set(ids).size,24);assert.equal((await library.list()).length,24);
  await library.setMasks(ids[0],[{start:1,end:2}]);
  const reopened=new LocalLibrary(library.root);
  for(const id of ids) {
   assert.deepEqual((await reopened.get(id)).masks,[{start:1,end:2}]);
   assert.equal((await reopened.audio(id,'vocals')).toString(),id+':vocals');
  }
  await reopened.setMasks(ids.at(-1),[{start:3,end:5}]);
  for(const id of ids)assert.deepEqual((await reopened.get(id)).masks,[{start:3,end:5}]);
  const id=ids.at(-1),ref=await reopened.get(id);
  await reopened.save(id,ref,dir,true,{replace:true});
  assert.deepEqual((await reopened.get(id)).masks,[{start:3,end:5}]);
  await reopened.delete(id);
  for(const other of ids.slice(0,-1))assert.deepEqual((await reopened.get(other)).masks,[{start:3,end:5}]);
 } finally {if(path.dirname(path.resolve(dir))===path.resolve(tmpdir())&&path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});}
});
