# Configurar o login (e-mail/senha e Google)

O app usa o **Firebase Authentication** para o login. Enquanto `js/config.js`
estiver sem a configuração do Firebase, o login funciona em **modo demonstração**
(tudo local, nenhum e-mail é enviado).

## 1. Criar o projeto no Firebase

1. Acesse <https://console.firebase.google.com> e clique em **Adicionar projeto**.
   Pode usar o mesmo projeto do Google Cloud da chave do Maps.
2. No menu lateral, abra **Criação → Authentication** e clique em **Vamos começar**.

## 2. Registrar o app Web e copiar a configuração

1. Clique na engrenagem ⚙️ → **Configurações do projeto**.
2. Em **Seus apps**, clique no ícone **`</>`** (Web), dê um nome (ex.: "Borracharia Já")
   e registre. Não precisa ativar o Hosting agora.
3. Copie os valores do `firebaseConfig` para `js/config.js`:

```js
firebase: {
  apiKey: 'AIza...',
  authDomain: 'seu-projeto.firebaseapp.com',
  projectId: 'seu-projeto',
  appId: '1:123456789:web:abc123',
},
```

## 3. Ativar os métodos de login

Em **Authentication → Método de login** (Sign-in method):

### E-mail e senha
- Clique em **E-mail/senha**, ative a primeira opção e salve.

### Google
- Clique em **Google**, ative, escolha o **e-mail de suporte** e salve.
- Na tela de consentimento que o Google mostra ao usuário, o nome do app aparece como
  "seu-projeto.firebaseapp.com". Para mostrar "Borracharia Já", ajuste em
  **Google Cloud Console → APIs e serviços → Tela de permissão OAuth**.

## 4. Rodar o app

O login com Google **não funciona** abrindo o `index.html` direto. Use o
servidor local:

```bash
npm start
```

Abra <http://localhost:5500>. O `localhost` já vem autorizado no Firebase.

> Se você restringiu a chave do Google Maps por referenciador HTTP, adicione
> `http://localhost:5500/*` na lista dela.

## 5. Ao publicar na internet

- Em **Authentication → Configurações → Domínios autorizados**, adicione o seu domínio
  (ex.: `seusite.com.br`).
- O site precisa estar em **HTTPS** (também exigido pela localização).
- Na **Google Cloud Console → Credenciais**, restrinja a chave `apiKey` do Firebase e a do
  Maps ao seu domínio.

## O que ainda NÃO existe (próxima etapa: banco de dados)

- Favoritos, avaliações, reports e borracharias ainda ficam salvos **só no navegador**.
  Ao entrar com a mesma conta em outro aparelho, esses dados não aparecem.
- Os usuários cadastrados aparecem em **Authentication → Users** no Firebase.
