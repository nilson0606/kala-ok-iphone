import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const assets = ['style.css','theme.mjs','app.mjs','navigation.mjs','audio.mjs','session.mjs','scoring.mjs','calibration.mjs','mask-editor.mjs'];
const root = fileURLToPath(new URL('./',import.meta.url));
export async function buildSite(output = path.join(root,'_site'), source = root) {
  const files = new Map();
  for (const file of ['index.html','manual.html',...assets]) files.set(file,(await readFile(path.join(source,file),'utf8')).replaceAll('\r\n','\n'));
  const hash=createHash('sha256');
  for (const [name,content] of files) hash.update(name+'\0'+content+'\0');
  const version=hash.digest('hex').slice(0,16), prefix=`assets/${version}/`;
  await mkdir(path.join(output,prefix),{recursive:true});
  // Each HTML release names an immutable directory. Relative module imports stay
  // inside that directory, so cached CSS or transitive imports cannot cross releases.
  for (const file of assets) await writeFile(path.join(output,prefix,file),files.get(file));
  let html=files.get('index.html');
  for(const asset of assets) html=html.replaceAll(`"${asset}"`,`"${prefix}${asset}"`);
  html=html.replace('</head>',`<meta name="app-build" content="${version}">\n</head>`);
  await writeFile(path.join(output,'index.html'),html);
  await writeFile(path.join(output,'manual.html'),files.get('manual.html'));
  await writeFile(path.join(output,'.nojekyll'),'');
  return version;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log('Built Pages assets:',await buildSite());
