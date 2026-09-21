import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
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
