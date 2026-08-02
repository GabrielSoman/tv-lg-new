#!/usr/bin/env node
/* =========================================================
   Trava de segurança antes do push.

   Vasculha tudo que o git está prestes a mandar para o
   repositório atrás de credenciais. Se achar, o publish para
   e diz exatamente qual arquivo e qual linha.

   Roda sozinho dentro de `npm run publish`. Para conferir
   quando quiser:  npm run check
   ========================================================= */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* grupo 1 (ou o casamento inteiro) é o valor que interessa conferir. */
const PADROES = [
  { nome: 'chave SECRETA do Supabase (sb_secret_…) — bypassa o RLS',
    re: /sb_secret_[A-Za-z0-9_-]{10,}/, grave: true },
  { nome: 'token JWT do Supabase (anon ou service_role)',
    re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, grave: true },
  { nome: 'chave publicável do Supabase (sb_publishable_…)',
    re: /sb_publishable_[A-Za-z0-9_-]{10,}/, grave: false },
  { nome: 'senha na URL da lista IPTV',
    re: /[?&](?:password|pass)=([^&\s"'`)]{6,})/i, grave: true },
  { nome: 'endereço de projeto Supabase (não é segredo, só um aviso)',
    re: /https:\/\/([a-z0-9]{18,})\.supabase\.co/, grave: false }
];

const IGNORAR_ARQUIVOS = [
  'tools/check-secrets.js',
  'nebula.config.example.json',
  'README.md'
];

/* Valores de exemplo, teste e documentação não são vazamento. */
const PLACEHOLDERS = /^(SEU|SUA|EXEMPLO|EXAMPLE|SENHA|SERVIDOR|PORTA|USUARIO|USER|TESTE|TEST|COLE|xxx+|\.+|…)/i;

function arquivosRastreados() {
  const saida = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return saida.split('\n').map((s) => s.trim()).filter(Boolean);
}

function ehTexto(p) {
  return /\.(js|json|css|html|md|sql|txt|yml|yaml|sh)$/i.test(p);
}

function main() {
  let arquivos;
  try { arquivos = arquivosRastreados(); }
  catch (e) {
    console.log('check-secrets: isto ainda não é um repositório git — nada a conferir.');
    return;
  }

  const achados = [];

  arquivos.forEach((rel) => {
    if (IGNORAR_ARQUIVOS.indexOf(rel) >= 0) return;
    if (!ehTexto(rel)) return;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;

    const linhas = fs.readFileSync(abs, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      PADROES.forEach((p) => {
        const m = linha.match(p.re);
        if (!m) return;
        const valor = m[1] || m[0];
        if (PLACEHOLDERS.test(valor)) return;
        if (/SEU|SUA|EXEMPLO|EXAMPLE|PREENCHA/i.test(linha)) return;
        achados.push({ arquivo: rel, linha: i + 1, tipo: p.nome, grave: p.grave,
                       trecho: valor.slice(0, 24) + (valor.length > 24 ? '…' : '') });
      });
    });
  });

  const graves = achados.filter((a) => a.grave);
  const avisos = achados.filter((a) => !a.grave);

  avisos.forEach((a) => {
    console.log(`check-secrets: aviso — ${a.arquivo}:${a.linha}  ${a.tipo}`);
  });

  if (!graves.length) {
    console.log('check-secrets: nenhuma credencial nos arquivos versionados. Pode publicar.');
    return;
  }

  console.error('\n╔══════════════════════════════════════════════════════════════╗');
  console.error('║  PAREI O PUBLISH — achei credenciais em arquivos do git      ║');
  console.error('╚══════════════════════════════════════════════════════════════╝\n');
  graves.forEach((a) => {
    console.error(`  ${a.arquivo}:${a.linha}`);
    console.error(`    ${a.tipo}  →  ${a.trecho}\n`);
  });
  console.error('  O que fazer:');
  console.error('    1. tire a credencial do arquivo (o lugar dela é nebula.config.json,');
  console.error('       que já está no .gitignore);');
  console.error('    2. se o arquivo for gerado, adicione-o ao .gitignore e rode');
  console.error('       git rm --cached <arquivo>;');
  console.error('    3. rode npm run check de novo.\n');
  process.exit(1);
}

main();
