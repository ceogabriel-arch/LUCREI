#!/usr/bin/env node
// Gera .br e .gz ao lado de cada JS/CSS do build web exportado
// (public/_expo/static). Compressão ao vivo (@fastify/compress) tem um bug
// conhecido no Node 24 que devolve corpo vazio em qualquer resposta
// comprimida acima de uns poucos KB (fastify/fastify-compress#393) -
// reproduzido localmente mesmo na versão mais nova do pacote. Em vez de
// arriscar isso numa resposta de verdade, comprime esses arquivos UMA VEZ
// aqui, e o servidor (ver index.ts) serve o .br/.gz pronto quando o
// navegador aceita, sem passar pelo caminho de compressão ao vivo.
//
// Roda depois de `npx expo export` (ver README/CLAUDE.md do fluxo de deploy).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXTENSIONS = new Set(['.js', '.css']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function compressFile(filePath) {
  const content = fs.readFileSync(filePath);

  const gz = zlib.gzipSync(content, { level: zlib.constants.Z_BEST_COMPRESSION });
  fs.writeFileSync(`${filePath}.gz`, gz);

  const br = zlib.brotliCompressSync(content, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length,
    },
  });
  fs.writeFileSync(`${filePath}.br`, br);

  return { original: content.length, gz: gz.length, br: br.length };
}

function main() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    console.error(`Não achei ${PUBLIC_DIR} - rode "npx expo export" no lucrei-mobile primeiro.`);
    process.exit(1);
  }

  const files = walk(path.join(PUBLIC_DIR, '_expo', 'static'));
  if (files.length === 0) {
    console.log('Nenhum .js/.css encontrado em public/_expo/static - nada a comprimir.');
    return;
  }

  let totalOriginal = 0;
  let totalBr = 0;
  for (const file of files) {
    const { original, gz, br } = compressFile(file);
    totalOriginal += original;
    totalBr += br;
    console.log(
      `${path.relative(PUBLIC_DIR, file)}: ${(original / 1024).toFixed(0)}KB -> gz ${(gz / 1024).toFixed(0)}KB, br ${(br / 1024).toFixed(0)}KB`
    );
  }
  console.log(
    `\nTotal: ${(totalOriginal / 1024 / 1024).toFixed(2)}MB -> ${(totalBr / 1024 / 1024).toFixed(2)}MB em brotli (${(100 - (totalBr / totalOriginal) * 100).toFixed(0)}% menor)`
  );
}

main();
