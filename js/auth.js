/* Autenticação: e-mail/senha e conta Google.
 *
 * - Com APP_CONFIG.firebase preenchido e o app aberto por http(s), usa o
 *   Firebase Authentication (login real; senhas ficam com o Firebase).
 * - Sem configuração (ou abrindo o arquivo direto, file://), roda em modo
 *   demonstração: tudo local, só para navegar pelo fluxo.
 *
 * Toda função devolve um perfil no mesmo formato:
 *   { uid, name, email, photo, provider, emailVerified } */
const Auth = (() => {
  const FIREBASE_VERSION = '10.14.1';
  const DEMO_KEY = 'borracharia_demo_auth_v1';

  let mode = 'demo';          // 'firebase' | 'demo'
  let reason = 'sem-config';  // por que está em modo demonstração
  let fb = null;              // módulo firebase/auth
  let auth = null;
  const listeners = [];

  const ERRORS = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/missing-email': 'Informe seu e-mail.',
    'auth/missing-password': 'Informe sua senha.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Toque em “Entrar” ou use “Continuar com Google”.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    'auth/network-request-failed': 'Sem conexão com a internet.',
    'auth/popup-closed-by-user': 'Login cancelado.',
    'auth/cancelled-popup-request': 'Login cancelado.',
    'auth/user-cancelled': 'Login cancelado.',
    'auth/account-exists-with-different-credential':
      'Este e-mail já está cadastrado com outro método (Google ou senha). Entre por ele.',
    'auth/operation-not-allowed': 'Este método de login ainda não foi ativado no Firebase.',
    'auth/unauthorized-domain': 'Este endereço não está autorizado no Firebase (Authentication → Configurações → Domínios autorizados).',
    'auth/configuration-not-found': 'Login não configurado no Firebase. Ative os métodos em Authentication.',
    'auth/invalid-api-key': 'Configuração do Firebase inválida (apiKey).',
  };

  function message(e) {
    if (!e) return 'Não foi possível entrar.';
    if (String(e.code).startsWith('auth/api-key-not-valid')) return ERRORS['auth/invalid-api-key'];
    return ERRORS[e.code] || e.message || 'Não foi possível entrar. Tente de novo.';
  }

  const fail = (code, msg) => Object.assign(new Error(msg || ERRORS[code] || code), { code });

  function fromFirebase(u) {
    if (!u) return null;
    const pid = (u.providerData[0] && u.providerData[0].providerId) || 'password';
    return {
      uid: u.uid,
      name: u.displayName || (u.email ? u.email.split('@')[0] : 'Usuário'),
      email: u.email || '',
      photo: u.photoURL || '',
      provider: pid === 'google.com' ? 'google' : 'password',
      emailVerified: Boolean(u.emailVerified),
    };
  }

  // ------------------------------------------------------- modo demonstração
  const demo = {
    load() {
      try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || { accounts: [], current: null }; }
      catch { return { accounts: [], current: null }; }
    },
    save(d) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* sem espaço */ } },
    async hash(text) {
      if (window.crypto && crypto.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      let h = 0;
      for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
      return 'x' + h;
    },
    profile(a) {
      return { uid: a.uid, name: a.name, email: a.email, photo: '', provider: a.provider, emailVerified: a.provider !== 'password' };
    },
    login(a) {
      const d = this.load();
      d.current = a.uid;
      this.save(d);
      return this.profile(a);
    },
    google() {
      const d = this.load();
      let a = d.accounts.find(x => x.provider === 'google');
      if (!a) {
        a = { uid: 'demo_google', provider: 'google', name: 'Usuário Google', email: 'demo.google@exemplo.com' };
        d.accounts.push(a);
        this.save(d);
      }
      return this.login(a);
    },
  };

  // --------------------------------------------------------------- iniciar
  async function init() {
    const cfg = typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.firebase : null;
    if (!cfg || !cfg.apiKey || !cfg.authDomain) { reason = 'sem-config'; return current(); }
    if (location.protocol === 'file:') { reason = 'arquivo-local'; return current(); }
    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
      const [appMod, authMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
      ]);
      fb = authMod;
      auth = fb.getAuth(appMod.initializeApp(cfg));
      auth.languageCode = 'pt-BR';
      await fb.setPersistence(auth, fb.browserLocalPersistence);
      // Conclui um login feito por redirecionamento (quando o pop-up foi bloqueado).
      try { await fb.getRedirectResult(auth); } catch (e) { console.warn('Login por redirecionamento falhou:', e); }
      await new Promise(resolve => { const off = fb.onAuthStateChanged(auth, () => { off(); resolve(); }); });
      fb.onAuthStateChanged(auth, u => listeners.forEach(fn => fn(fromFirebase(u))));
      mode = 'firebase';
      reason = '';
    } catch (e) {
      console.warn('Firebase indisponível, usando modo demonstração:', e);
      reason = 'erro';
    }
    return current();
  }

  function current() {
    if (mode === 'firebase') return fromFirebase(auth.currentUser);
    const d = demo.load();
    const a = d.accounts.find(x => x.uid === d.current);
    return a ? demo.profile(a) : null;
  }

  // ----------------------------------------------------------------- login
  async function google() {
    if (mode === 'demo') return demo.google();
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' }); // sempre deixa escolher a conta
    try {
      return fromFirebase((await fb.signInWithPopup(auth, provider)).user);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await fb.signInWithRedirect(auth, provider); // a página recarrega e o init() conclui
        return null;
      }
      throw e;
    }
  }

  async function signUp(name, email, password) {
    email = email.trim().toLowerCase();
    if (mode === 'demo') {
      if (password.length < 6) throw fail('auth/weak-password');
      const d = demo.load();
      if (d.accounts.some(a => a.email === email && a.provider === 'password')) throw fail('auth/email-already-in-use');
      const a = { uid: 'demo_' + Math.random().toString(36).slice(2, 10), provider: 'password', name, email,
        hash: await demo.hash(email + ':' + password) };
      d.accounts.push(a);
      demo.save(d);
      return demo.login(a);
    }
    const cred = await fb.createUserWithEmailAndPassword(auth, email, password);
    await fb.updateProfile(cred.user, { displayName: name });
    try { await fb.sendEmailVerification(cred.user); } catch (e) { console.warn('Verificação de e-mail não enviada:', e); }
    return fromFirebase(cred.user);
  }

  async function signIn(email, password) {
    email = email.trim().toLowerCase();
    if (mode === 'demo') {
      const d = demo.load();
      const a = d.accounts.find(x => x.email === email && x.provider === 'password');
      if (!a || a.hash !== await demo.hash(email + ':' + password)) throw fail('auth/invalid-credential');
      return demo.login(a);
    }
    return fromFirebase((await fb.signInWithEmailAndPassword(auth, email, password)).user);
  }

  async function resetPassword(email) {
    email = email.trim().toLowerCase();
    if (mode === 'demo') return; // nada a enviar no modo demonstração
    await fb.sendPasswordResetEmail(auth, email);
  }

  async function signOut() {
    if (mode === 'demo') {
      const d = demo.load();
      d.current = null;
      demo.save(d);
      return;
    }
    await fb.signOut(auth);
  }

  return {
    init,
    current,
    google,
    signUp,
    signIn,
    resetPassword,
    signOut,
    message,
    onChange: fn => listeners.push(fn),
    get mode() { return mode; },
    get reason() { return reason; },
  };
})();
