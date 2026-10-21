import {
  handleAuthCallback,
  updateUser,
  acceptInvite,
  requestPasswordRecovery,
  getUser,
  login,
  logout,
} from '@netlify/identity';

// Ponte da Central com o Netlify Identity no navegador.
// Login e logout usam cookies/sessão gerenciados pelo SDK oficial.
// Nunca armazenamos a senha ou o token em variáveis persistentes próprias.
globalThis.TMNetlifyIdentity = {
  handleAuthCallback,
  updateUser,
  acceptInvite,
  requestPasswordRecovery,
  getUser,
  login,
  logout,
};
