import { copyFileSync, mkdirSync } from 'node:fs';

// A directly shared survey URL must also open on a static GitHub Pages host.
mkdirSync('dist/confronto',{recursive:true});
copyFileSync('dist/index.html','dist/confronto/index.html');
copyFileSync('dist/index.html','dist/404.html');

