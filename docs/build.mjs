import { mkdir, copyFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = ['index.html', 'editor.html', 'editor.css', 'glass.css', 'waves.svg', 'appearance.js', 'editor.js', 'media-render.js', 'asr-worker.js', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml'];
const root = new URL('./', import.meta.url);
await mkdir(new URL('public/', root), { recursive: true });
for (const file of files) {
  const source = new URL(file, root);
  if (!(await stat(source)).size) throw new Error(`Empty website asset: ${file}`);
  await copyFile(source, new URL(`public/${file}`, root));
}
console.log(`Published ${files.length} static assets to ${fileURLToPath(new URL('public/', root))}`);
