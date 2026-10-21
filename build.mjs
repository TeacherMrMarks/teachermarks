/** Secure publish boundary. Only copy public UI assets to public_site.
 * Netlify Functions and protected lesson content stay OUT of publish directory.
 */
import fs from 'node:fs/promises';
import { build } from 'esbuild';
const dest='public_site';
await fs.rm(dest,{recursive:true,force:true});await fs.mkdir(dest,{recursive:true});
for(const asset of ['index.html','ativar-conta.html','aluno.html','admin.html','academy.css','academy-app.js','academy-admin.js','guia-academia.html','v406-student.js','video-studio.html','video-studio.js']){
 await fs.copyFile(asset,`${dest}/${asset}`);
}
const common={bundle:true,format:'iife',platform:'browser',target:'es2020',minify:true};
await build({...common,entryPoints:['tm-identity-entry.js'],outfile:`${dest}/tm-identity-browser.js`});
await build({...common,entryPoints:['tm-academy-entry.js'],outfile:`${dest}/tm-academy-browser.js`});
console.log('Teacher Marks Professional V423: arquivos públicos gerados; funções de servidor excluídas de public_site.');
