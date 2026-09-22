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
