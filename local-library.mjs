import { mkdir, readFile, writeFile, rename, copyFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateReference } from './scoring.mjs';

export function cacheKey(videoId, seconds) {
  if (!/^[\w-]{11}$/.test(videoId) || ![0, 15, 30, 60].includes(seconds)) throw new Error('Invalid cache key');
  return `${videoId}_${seconds}_v1`;
}

export class LocalLibrary {
  constructor(root) { this.root = path.resolve(root); }
  directory(id) {
    if (!/^[\w-]{11}_(0|15|30|60)_v1$/.test(id)) throw new Error('Invalid library ID');
    const dir = path.resolve(this.root, id);
    if (path.dirname(dir) !== this.root) throw new Error('Invalid library path');
    return dir;
  }
  async get(id) {
    const dir = this.directory(id);
    try {
      const value = JSON.parse(await readFile(path.join(dir, 'reference.json'), 'utf8'));
      const reference = validateReference(value);
      if (cacheKey(reference.videoId, value.rangeSeconds) !== id || value.cacheVersion !== 1 || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 905) return null;
      let preview = !!value.hasPreview;
      if (preview) {
        for (const name of ['vocals', 'accompaniment']) preview &&= (await stat(path.join(dir, name + '.mp3')).catch(() => null))?.size > 0;
      }
      return { ...value, ...reference, cacheId: id, hasPreview: preview };
    } catch { return null; }
  }
  async save(id, reference, source, preview, { cancelled = () => false, replace = false } = {}) {
    const dir = this.directory(id);
    validateReference(reference);
    await mkdir(this.root, { recursive: true });
    const existing = await this.get(id);
    const suffix = randomUUID();
    const staging = path.join(this.root, '.pending-' + suffix), backup = path.join(this.root, '.backup-' + suffix);
    if ([staging, backup].some(target => path.dirname(path.resolve(target)) !== this.root)) throw new Error('Invalid staging path');
    let moved = false, committed = false;
    await mkdir(staging);
    try {
      const keepExistingAudio = !replace && !preview && !!existing?.hasPreview;
      if (preview || keepExistingAudio) {
        for (const name of ['vocals', 'accompaniment']) {
          const input = path.join(preview ? source : dir, name + '.mp3');
          if (!(await stat(input)).size) throw new Error('Empty preview file');
          await copyFile(input, path.join(staging, name + '.mp3'));
        }
      }
      const value = { ...reference, cacheVersion: 1, hasPreview: preview || keepExistingAudio, savedAt: new Date().toISOString(), cacheId: id };
      await writeFile(path.join(staging, 'reference.json'), JSON.stringify(value), 'utf8');
      if (cancelled()) throw new Error('Save cancelled');
      // Publish only a complete result. Keep the old directory until replacement succeeds.
      if (await stat(dir).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) { await rename(dir, backup); moved = true; }
      try { await rename(staging, dir); committed = true; }
      catch (error) { if (moved) { await rename(backup, dir); moved = false; } throw error; }
      return value;
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
      if (committed && moved) await rm(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
    }
  }
  async list() {
    await mkdir(this.root, { recursive: true });
    const rows = [];
    for (const id of await readdir(this.root)) {
      if (!/^[\w-]{11}_(0|15|30|60)_v1$/.test(id)) continue;
      const ref = await this.get(id); if (!ref) continue;
      let bytes = 0;
      for (const name of ['reference.json', 'vocals.mp3', 'accompaniment.mp3']) bytes += (await stat(path.join(this.directory(id), name)).catch(() => null))?.size || 0;
      rows.push({ id, videoId: ref.videoId, title: ref.title, seconds: ref.rangeSeconds, duration: ref.duration, hasPreview: ref.hasPreview, savedAt: ref.savedAt, bytes });
    }
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async audio(id, stem) {
    if (!['vocals', 'accompaniment'].includes(stem)) throw new Error('Invalid stem');
    const ref = await this.get(id);
    if (!ref?.hasPreview) return null;
    return readFile(path.join(this.directory(id), stem + '.mp3'));
  }
  async delete(id) { await rm(this.directory(id), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
}
