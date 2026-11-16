#!/usr/bin/env node
// Abre uma tela do Cure OS com Supabase de mentira e acusa erro de console. Uso no LEIAME.md.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const a = process.argv.slice(2); const op = (n, d) => { const i = a.indexOf('--' + n); return i < 0 ? d : a[i + 1]; };
const rota = a[0] && !a[0].startsWith('--') ? a[0] : 'agenda';
const fixtures = [path.join(raiz, 'ferramentas/teste-tela/fixtures-base.js'), ...(op('fixtures') ? op('fixtures').split(',') : [])];
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => { const p = path.join(raiz, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(raiz) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': tipos[path.extname(p)] || 'application/octet-stream' }); r.end(fs.readFileSync(p)); });
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${srv.address().port}`;
const nav = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const [larg, alt] = (op('tamanho', '1366x900')).split('x').map(Number);
const ctx = await nav.newContext({ viewport: { width: larg, height: alt }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
const pg = await ctx.newPage(); const erros = [];
pg.on('pageerror', (e) => erros.push('ERRO DE PÁGINA: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) erros.push('console.error: ' + m.text()); });
await pg.route('**/*', (rt) => { const u = rt.request().url();
  if (u.startsWith(base + '/js/core.js')) { let t = fs.readFileSync(path.join(raiz, 'js/core.js'), 'utf8');
    t = t.replace(/import \{ createClient \}[^\n]*\n/, "import { criarSbFalso } from '/ferramentas/teste-tela/sb-falso.js';\n")
         .replace(/export const sb = createClient\([\s\S]*?\);/, 'export const sb = criarSbFalso(window.__FIXTURES);');
    if (!t.includes('criarSbFalso(window')) throw new Error('core.js mudou: ajustar a troca do cliente em rodar.mjs');
    return rt.fulfill({ contentType: 'text/javascript', body: t }); }
  return u.startsWith(base) ? rt.continue() : rt.abort(); });
await pg.addInitScript(`window.__FIXTURES = { tabelas: {}, rpc: {} }; window.__PERFIL = ${JSON.stringify(op('perfil', 'gestor'))}; window.__HOJE = ${JSON.stringify(op('hoje', ''))};`);
for (const f of fixtures) await pg.addInitScript({ path: path.resolve(f) });
if (op('modo')) await pg.addInitScript(`try { localStorage.setItem('modo_user-1', ${JSON.stringify(op('modo'))}); } catch {}`);
await pg.goto(`${base}/index.html#${rota}`); await pg.waitForTimeout(Number(op('espera', 900)));
if (op('modulo')) { await pg.evaluate(async ([m, p]) => { const mod = await import('/' + m); await mod.render(p); }, [op('modulo'), op('params', '')]); await pg.waitForTimeout(Number(op('espera', 900))); }
if (op('script')) { const mod = await import(path.resolve(op('script'))); await mod.default(pg, { base, erros }); await pg.waitForTimeout(300); }
const toastErro = await pg.$eval('#toast', (t) => (!t.hidden && t.classList.contains('erro') ? t.textContent : '')).catch(() => '');
if (toastErro) erros.push('TOAST DE ERRO: ' + toastErro);
if (op('shot')) await pg.screenshot({ path: op('shot'), fullPage: a.includes('--inteira') });
if (a.includes('--texto')) console.log((await pg.$eval('#conteudo', (c) => c.innerText)).slice(0, 4000));
if (a.includes('--escritas')) console.log(JSON.stringify(await pg.evaluate(() => window.__ESCRITAS), null, 1));
await nav.close(); srv.close();
if (erros.length) { console.error(erros.join('\n')); process.exit(1); } else console.log(`ok #${rota} (${op('perfil', 'gestor')})`);
