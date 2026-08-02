#!/usr/bin/env node
/* =========================================================
   Junta src/ num pacote publicavel.

     build/app.js        codigo do app inteiro
     build/app.css       visual
     build/manifest.json versao + metadados

   E copia o mesmo pacote para app/fallback/, que e o que
   viaja dentro do .ipk como copia de seguranca.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FILES = require('./files');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const read = (p) => fs.readFileSync(p, 'utf8');
const ensure = (d) => fs.mkdirSync(d, { recursive: true });

function banner(name) {
  return `\n/* ===== ${name} ${'='.repeat(Math.max(0, 58 - name.length))} */\n`;
}

function bundleJS() {
  return FILES.js.map((f) => {
    const p = path.join(ROOT, 'src', 'js', f);
    if (!fs.existsSync(p)) throw new Error(`Arquivo listado em tools/files.js não existe: src/js/${f}`);
    return banner(f) + read(p);
  }).join('\n');
}

function bundleCSS() {
  return FILES.css.map((f) => read(path.join(ROOT, 'src', 'css', f))).join('\n');
}

function main() {
  const notes = process.argv.slice(2).join(' ').trim();

  const js = bundleJS();
  const css = bundleCSS();
  const hash = crypto.createHash('sha1').update(js + css).digest('hex').slice(0, 8);
  const version = `${pkg.version}+${hash}`;

  const manifest = {
    version,
    js: 'app.js',
    css: 'app.css',
    date: new Date().toISOString(),
    notes: notes || `build ${hash}`,
    bytes: { js: Buffer.byteLength(js), css: Buffer.byteLength(css) }
  };

  const out = path.join(ROOT, 'build');
  ensure(out);
  fs.writeFileSync(path.join(out, 'app.js'), js);
  fs.writeFileSync(path.join(out, 'app.css'), css);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  /* Copia de seguranca dentro do .ipk. A linha extra grava a versao
     para que os Ajustes saibam dizer o que esta rodando. */
  const fb = path.join(ROOT, 'app', 'fallback');
  ensure(fb);
  fs.writeFileSync(path.join(fb, 'app.js'),
    `window.NEBULA_FALLBACK_VERSION = ${JSON.stringify(version)};\n` + js);
  fs.writeFileSync(path.join(fb, 'app.css'), css);
  fs.writeFileSync(path.join(fb, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  /* Credenciais embutidas no .ipk (nunca no build/ que vai pro GitHub).
     Servem para o app voltar ja configurado depois de uma reinstalacao. */
  const cfgPath = path.join(ROOT, 'nebula.config.json');
  let defaults = null;
  if (fs.existsSync(cfgPath)) {
    try {
      defaults = JSON.parse(read(cfgPath));
      delete defaults._leia;
    } catch (e) {
      console.error('  ! nebula.config.json existe mas nao e um JSON valido — ignorado.');
      defaults = null;
    }
  }
  fs.writeFileSync(path.join(ROOT, 'app', 'defaults.js'),
    '/* Gerado por tools/build.js a partir de nebula.config.json. Nao edite. */\n' +
    'window.NEBULA_DEFAULTS = ' + JSON.stringify(defaults, null, 2) + ';\n');

  const kb = (n) => (n / 1024).toFixed(1) + ' kB';
  console.log(`Nebula ${version}`);
  console.log(`  build/app.js   ${kb(manifest.bytes.js)}`);
  console.log(`  build/app.css  ${kb(manifest.bytes.css)}`);
  console.log(`  copiado para app/fallback/`);
  console.log(defaults
    ? '  app/defaults.js  com suas credenciais (fora do GitHub)'
    : '  app/defaults.js  vazio — crie nebula.config.json se quiser reinstalacao automatica');
  if (notes) console.log(`  notas: ${notes}`);
}

main();
