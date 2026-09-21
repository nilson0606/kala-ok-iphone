import { mkdir, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

export class LibraryLocation {
  constructor(runtime, home = homedir()) {
    this.runtime = path.resolve(runtime);
    this.home = home;
    this.file = path.join(this.runtime, 'library-settings.json');
  }
  async get() {
    let saved;
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('歌曲庫設定無法讀取，請檢查本機 library-settings.json。'); }
    if (saved && (typeof saved.libraryPath !== 'string' || !path.isAbsolute(saved.libraryPath))) throw new Error('歌曲庫位置設定無效，請重新指定。');
    const legacy = path.join(this.runtime, 'library');
    const existing = await realpath(legacy).catch(() => null);
    return { configured: !!saved, path: saved?.libraryPath || '', suggestedPath: existing || path.join(this.home, 'Music', 'Karaoke'), existingLibrary: !!existing };
  }
  async set(value) {
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) throw new Error('請指定完整的本機資料夾路徑。');
    const requested = path.resolve(value.trim());
    if (requested === path.parse(requested).root) throw new Error('請選擇歌曲庫專用資料夾，不能直接使用磁碟根目錄。');
    for (const name of ['jobs', 'venv', 'models']) {
      const reserved = path.join(this.runtime, name), relative = path.relative(reserved, requested);
      if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('請選擇歌曲庫資料夾，不能使用本機工具的工作目錄。');
    }
    await mkdir(requested, { recursive: true });
    const directory = await realpath(requested);
    const probe = path.join(directory, '.karaoke-write-test-' + randomUUID());
    try { await writeFile(probe, '', { flag: 'wx' }); }
    catch { throw new Error('此資料夾無法寫入，請選擇有寫入權限的位置。'); }
    finally { await rm(probe, { force: true }); }
    await mkdir(this.runtime, { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, libraryPath: directory }), 'utf8');
      await rename(temporary, this.file);
    } finally { await rm(temporary, { force: true }); }
    return this.get();
  }
}
