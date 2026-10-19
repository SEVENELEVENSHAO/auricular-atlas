import { defineConfig } from 'vite';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
function reference(server) {
  server.middlewares.use((req,res,next)=>{
    const match=/^\/reference\/page-(\d+)\.jpg$/.exec(req.url?.split('?')[0]||'');
    if(!match)return next();
    const file=path.resolve('private/reference',`page-${Number(match[1])}.jpg`);
    if(!existsSync(file)){res.statusCode=404;res.end('Local reference page unavailable');return;}
    res.setHeader('Content-Type','image/jpeg');createReadStream(file).pipe(res);
  });
}
export default defineConfig({base:'./',plugins:[{name:'private-book-reference',configureServer:reference,configurePreviewServer:reference}],server:{host:'127.0.0.1',port:4327,strictPort:true}});
