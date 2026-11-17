// Servidor local simples (sem dependências) para rodar o app em http://localhost.
// O login com Google não funciona abrindo o index.html direto (file://).
// Uso: npm start   (ou: node server.js 8080 --open)
//   --open  abre o app no navegador assim que o servidor sobe
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const args = process.argv.slice(2);
const PORT = Number(args.find(a => /^\d+$/.test(a)) || process.env.PORT || 5500);
const OPEN = args.includes('--open');
const URL_APP = `http://localhost:${PORT}/`;

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${URL_APP}"`
    : process.platform === 'darwin' ? `open "${URL_APP}"` : `xdg-open "${URL_APP}"`;
  exec(cmd, err => { if (err) console.log(`Abra no navegador: ${URL_APP}`); });
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  // Usado pelo app aberto como arquivo (file://) para descobrir se este
  // servidor está ligado e se redirecionar para cá.
  if (req.url === '/__ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end('borracharia-ja');
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Requisição inválida');
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  // Bloqueia acesso fora da pasta do app (ex.: /../../arquivo).
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith('.') || /node_modules/.test(file)) {
    res.writeHead(403).end('Proibido');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    // Provavelmente o app já está rodando em outra janela: só abre o navegador.
    console.log(`A porta ${PORT} já está em uso — o app provavelmente já está aberto em ${URL_APP}`);
    if (OPEN) openBrowser();
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  throw err;
});

server.listen(PORT, 'localhost', () => {
  console.log(`Borracharia Já rodando em ${URL_APP}`);
  console.log('Deixe esta janela aberta enquanto usa o app. Pressione Ctrl+C para parar.');
  if (OPEN) openBrowser();
});
