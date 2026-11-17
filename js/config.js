/* Configuração do app.
 * googleMapsKey: chave da Maps JavaScript API. Como roda no navegador ela fica
 * visível para quem abrir o site — restrinja no Google Cloud Console
 * (referenciadores HTTP + somente a Maps JavaScript API).
 * Deixe vazia para usar o OpenStreetMap. */
const APP_CONFIG = {
  googleMapsKey: 'AIzaSyD1hMbbQs9CvWqxPogkkWVOv0n8nw-7RSg',

  // Login (Firebase Authentication). Copie do Console do Firebase:
  // Configurações do projeto → Seus apps → app Web → "firebaseConfig".
  // Enquanto estiver vazio, o login roda em modo demonstração.
  // Passo a passo em CONFIGURAR-LOGIN.md.
  firebase: {
    apiKey: 'AIzaSyBdVmLO6DjgQ7g5e_B4azmSqWa2fWAbh6s',
    authDomain: 'appborracharia2026.firebaseapp.com',
    projectId: 'appborracharia2026',
    storageBucket: 'appborracharia2026.firebasestorage.app',
    messagingSenderId: '63274802326',
    appId: '1:63274802326:web:10528c0a46becb2a3076b7',
    measurementId: 'G-6BC8JLT21Y',
  },
};
