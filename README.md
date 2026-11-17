# Borracharia Já 🛞

Pneu furou? O app mostra no mapa as borracharias abertas agora, com status (aberta, fechada ou incerta) confirmado por outros motoristas.

**App publicado:** https://borracharia-ja-sigma.vercel.app/

## Funcionalidades
- Entrada sem login (convidado) ou com e-mail/senha e Google (Firebase Authentication)
- Perfis: motorista e borracheiro
- Mapa com status das borracharias, busca, filtros e botão SOS
- Detalhes da borracharia: ligar, rota e perfil; favoritos e avaliações

## Tecnologias
HTML, CSS e JavaScript • Google Maps / OpenStreetMap • Firebase Authentication • Node.js (servidor local) • Vercel

## Rodar localmente
```bash
node server.js
```
Depois abra http://localhost:5500. No Windows, também dá para usar `Abrir Borracharia Ja.bat`.
Para configurar o login, veja [CONFIGURAR-LOGIN.md](CONFIGURAR-LOGIN.md).

## Estrutura
- `index.html`, `css/`, `js/` — app atual
- `prototipo-react/` — primeira versão do projeto (React + Vite)

Projeto acadêmico — Análise e Desenvolvimento de Sistemas, Estácio.
