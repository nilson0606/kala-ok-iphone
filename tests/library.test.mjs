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
    for (const model of ['demucs','bs-roformer']) for (const mode of ['all','lead']) {
      const id = cacheKey(ref.videoId,30,mode,model); ids.push(id);
      await library.save(id,{...ref,vocalMode:mode,...(model==='demucs'?{}:{separationModel:model})},source,true);
    }
    assert.equal(new Set(ids).size,4);
    assert.deepEqual(ids.slice(0,2),['M7lc1UVf-VE_30_v1','M7lc1UVf-VE_30_lead_v1']);
    const reopened = new LocalLibrary(library.root);
    assert.equal((await reopened.get(ids[0])).separationModel,'demucs');
    assert.deepEqual((await reopened.list()).map(s=>s.separationModel).sort(),['bs-roformer','bs-roformer','demucs','demucs']);
    await assert.rejects(reopened.save(ids[0],{...ref,separationModel:'bs-roformer'},source,true));
    await writeFile(path.join(source,'vocals.mp3'),'new-vocals');
    await reopened.save(ids[2],{...ref,separationModel:'bs-roformer'},source,true,{replace:true});
    assert.equal((await reopened.audio(ids[2],'vocals')).toString(),'new-vocals');
    for (const id of [ids[0],ids[1],ids[3]]) assert.equal((await reopened.audio(id,'vocals')).toString(),'old-vocals');
    assert.equal(await reopened.audio(ids[2],'lead'),null);
    assert.equal((await reopened.audio(ids[3],'lead')).toString(),'old-lead');
    await reopened.delete(ids[2]);
    assert.equal(await reopened.get(ids[2]),null);
    for (const id of [ids[0],ids[1],ids[3]]) assert.ok(await reopened.get(id));
    assert.throws(()=>cacheKey(ref.videoId,30,'all','unknown'));
  } finally {
    if(path.dirname(path.resolve(dir))===path.resolve(tmpdir()) && path.basename(dir).startsWith('karaoke-library-'))await rm(dir,{recursive:true,force:true});
  }
});
