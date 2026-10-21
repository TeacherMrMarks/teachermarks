/** Teacher Marks V388 — correção de token do Blobs e renovação da sessão Identity.
 * Mantém o store teacher-marks-cloud-v370 e todos os snapshots/versionamentos.
 * Abre o store dentro de cada requisição, sem guardar acesso na memória global.
 */
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import * as identitySession from '@netlify/identity';
import { getStore } from '@netlify/blobs';

const MAX_CHUNK_CHARS = 500000, MAX_PARTS = 400, MAX_SIZE = 150 * 1024 * 1024;
const json = (v, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const safeId = v => String(v || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100);
const prefix = user => `users/${safeId(user.id)}`;
const pointer = user => `${prefix(user)}/current.json`;
const readPointer = async (store, user) => await store.getWithMetadata(pointer(user), { type: 'json', consistency: 'strong' });
const current = async (store, user) => (await readPointer(store, user))?.data || null;


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

export default async req => {
  try {
    const user = await restoredUser();
    if (!user?.id) return json({ ok: false, error: 'Não autenticado.' }, 401);
    // Netlify configura o acesso a Blobs no contexto de cada requisição.
    // Não manter uma instância com credenciais possivelmente vencidas entre invocações.
    const store = getStore({ name: 'teacher-marks-cloud-v370', consistency: 'strong' });
    const url = new URL(req.url), p = prefix(user);
    if (req.method === 'GET') {
      const action = url.searchParams.get('action') || 'manifest';
      if (action === 'manifest') return json({ ok: true, manifest: await current(store, user) });
      if (action === 'chunk') {
        const syncId = safeId(url.searchParams.get('syncId')),
          index = Number(url.searchParams.get('index')),
          m = await current(store, user);
        // Somente o snapshot publicado pode ser lido pela interface cliente.
        // Versões antigas continuam armazenadas, sem serem expostas automaticamente.
        if (!m || m.syncId !== syncId) return json({ ok: false, error: 'A cópia solicitada não é mais a atual.' }, 409);
        if (!syncId || !Number.isInteger(index) || index < 0 || index >= Number(m.total))
          return json({ ok: false, error: 'Parte inválida.' }, 400);
        const data = await store.get(`${p}/sync/${syncId}/${index}.txt`, { type: 'text', consistency: 'strong' });
        if (data == null) return json({ ok: false, error: 'Parte não encontrada.' }, 404);
        return json({ ok: true, data });
      }
      return json({ ok: false, error: 'Ação inválida.' }, 400);
    }
    if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido.' }, 405);
    verifyRequestOrigin(req);
    const body = await req.json(), action = String(body?.action || ''), syncId = safeId(body?.syncId);
    if (!syncId || syncId !== String(body?.syncId || ''))
      return json({ ok: false, error: 'Identificador de cópia inválido.' }, 400);
    if (action === 'begin') {
      // Não aceita clientes antigos que ignoravam a revisão base: eles podiam
      // sobrescrever a cópia feita pelo celular sem detectar o conflito.
      if (typeof body.expectedSyncId !== 'string')
        return json({ ok: false, error: 'Atualize a Central para V383 antes de sincronizar.' }, 409);
      const total = Number(body.total), size = Number(body.size);
      if (!Number.isInteger(total) || total < 1 || total > MAX_PARTS ||
          !Number.isSafeInteger(size) || size < 1 || size > MAX_SIZE)
        return json({ ok: false, error: 'Tamanho de backup inválido.' }, 400);
      const latest = await current(store, user);
      if ((latest?.syncId || '') !== body.expectedSyncId)
        return json({ ok: false, conflict: true, manifest: latest, error: 'Há uma cópia mais recente. Atualize os dados antes de enviar.' }, 409);
      await store.set(`${p}/sync/${syncId}/pending.json`, JSON.stringify({
        syncId, total, size, expectedSyncId: body.expectedSyncId,
        startedAt: new Date().toISOString(), centralVersion: String(body.centralVersion || '')
      }));
      return json({ ok: true });
    }
    if (action === 'chunk') {
      const index = Number(body.index), data = body.data;
      if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS ||
          typeof data !== 'string' || data.length > MAX_CHUNK_CHARS)
        return json({ ok: false, error: 'Parte inválida ou acima do limite.' }, 400);
      const pending = await store.get(`${p}/sync/${syncId}/pending.json`, { type: 'json', consistency: 'strong' });
      if (!pending || index >= pending.total) return json({ ok: false, error: 'Envio não iniciado.' }, 409);
      await store.set(`${p}/sync/${syncId}/${index}.txt`, data);
      return json({ ok: true, index });
    }
    if (action === 'commit') {
      const total = Number(body.total), size = Number(body.size);
      const pending = await store.get(`${p}/sync/${syncId}/pending.json`, { type: 'json', consistency: 'strong' });
      if (!pending || pending.total !== total || pending.size !== size ||
          typeof body.expectedSyncId !== 'string' || pending.expectedSyncId !== body.expectedSyncId)
        return json({ ok: false, error: 'Envio inconsistente ou não iniciado.' }, 409);
      let full = '';
      for (let i = 0; i < total; i++) {
        const part = await store.get(`${p}/sync/${syncId}/${i}.txt`, { type: 'text', consistency: 'strong' });
        if (part == null) return json({ ok: false, error: `Falta a parte ${i + 1}.` }, 409);
        full += part;
      }
      if (new TextEncoder().encode(full).length !== size)
        return json({ ok: false, error: 'Backup incompleto: total de bytes não confere.' }, 409);
      let snapshot;
      try { snapshot = JSON.parse(full); } catch { return json({ ok: false, error: 'Backup JSON inválido.' }, 400); }
      if (snapshot?.type !== 'teacher-marks-english-quiz')
        return json({ ok: false, error: 'Formato de backup não reconhecido.' }, 400);
      const prev = await readPointer(store, user), latest = prev?.data || null;
      if ((latest?.syncId || '') !== body.expectedSyncId)
        return json({ ok: false, conflict: true, manifest: latest, error: 'Outro aparelho sincronizou primeiro. Sua cópia local foi preservada.' }, 409);
      const manifest = { syncId, total, size, savedAt: new Date().toISOString(),
        centralVersion: String(pending.centralVersion || ''), revision: Number(latest?.revision || 0) + 1 };
      const options = prev ? { onlyIfMatch: prev.etag } : { onlyIfNew: true };
      const result = await store.set(pointer(user), JSON.stringify(manifest), options);
      if (!result.modified || !result.etag)
        return json({ ok: false, conflict: true, manifest: await current(store, user), error: 'Publicação concorrente ou falha de armazenamento.' }, 409);
      // Confirma a revisão antes de anunciar sucesso. Nunca exclui snapshots antigos.
      const confirmed = await current(store, user);
      if (confirmed?.syncId !== syncId)
        return json({ ok: false, conflict: true, manifest: confirmed, error: 'A publicação não foi confirmada no armazenamento.' }, 409);
      try { await store.delete(`${p}/sync/${syncId}/pending.json`); } catch {}
      return json({ ok: true, manifest });
    }
    return json({ ok: false, error: 'Ação inválida.' }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e || 'Erro de nuvem') }, 500);
  }
};
