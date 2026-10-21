/** Teacher Marks V388 — sessão persistente para a nuvem.
 * Mantém autenticação por cookies seguros; sem armazenar senha ou token no HTML.
 */
import {
  getUser,
  login,
  logout,
  recoverPassword,
  acceptInvite,
  confirmEmail,
  verifyEmailChange,
  requestPasswordRecovery,
  verifyRequestOrigin,
} from "@netlify/identity";
import * as identitySession from "@netlify/identity";


// A sessão é mantida nos cookies seguros do Netlify Identity.
// Tentar renovar o acesso ANTES de consultar getUser evita pedir a senha
// toda vez que o JWT expira enquanto o navegador está fechado.
async function restoredUser() {
  try {
    if (typeof identitySession.refreshSession === 'function') {
      await identitySession.refreshSession();
    }
  } catch (err) {
    // Uma falha transitória na renovação não deve invalidar um JWT ainda válido.
    console.warn('[Teacher Marks] Não foi possível renovar a sessão neste acesso.');
  }
  // Nunca tratar dados locais como autenticação: getUser valida a sessão real.
  return await getUser();
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function publicUser(user) {
  return user ? { id: user.id, email: user.email } : null;
}

export default async (req) => {
  try {
    if (req.method === "GET") {
      const user = await restoredUser();
      return json({ ok: true, user: publicUser(user) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

    verifyRequestOrigin(req);
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "login") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      if (!email || !password) return json({ ok: false, error: "Informe e-mail e senha." }, 400);
      const user = await login(email, password);
      return json({ ok: true, user: publicUser(user) });
    }

    if (action === "logout") {
      await logout();
      return json({ ok: true });
    }

    if (action === "request-recovery") {
      const email = String(body.email || "").trim();
      if (!email) return json({ ok: false, error: "Informe o e-mail da conta." }, 400);
      await requestPasswordRecovery(email);
      return json({ ok: true });
    }

    if (action === "recover") {
      const token = String(body.token || "").trim();
      const password = String(body.password || "");
      if (!token || password.length < 8) return json({ ok: false, error: "Link inválido ou senha muito curta." }, 400);
      const user = await recoverPassword(token, password);
      return json({ ok: true, user: publicUser(user) });
    }

    if (action === "accept-invite") {
      const token = String(body.token || "").trim();
      const password = String(body.password || "");
      if (!token || password.length < 8) return json({ ok: false, error: "Convite inválido ou senha muito curta." }, 400);
      const user = await acceptInvite(token, password);
      return json({ ok: true, user: publicUser(user) });
    }

    if (action === "confirm-email") {
      const token = String(body.token || "").trim();
      if (!token) return json({ ok: false, error: "Token de confirmação ausente." }, 400);
      const user = await confirmEmail(token);
      return json({ ok: true, user: publicUser(user) });
    }

    if (action === "verify-email-change") {
      const token = String(body.token || "").trim();
      if (!token) return json({ ok: false, error: "Token de alteração de e-mail ausente." }, 400);
      const user = await verifyEmailChange(token);
      return json({ ok: true, user: publicUser(user) });
    }

    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err || "Erro de autenticação") }, 401);
  }
};
