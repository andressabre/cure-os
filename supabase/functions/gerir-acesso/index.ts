// gerir-acesso — a gestora cria e edita acessos (e-mail = login, senha, perfil, profissional, ativo) sem depender de convite por e-mail.
// Segurança: só usuário com perfil 'gestor' ATIVO na clínica informada; a chave de serviço fica só no servidor (variável do Supabase).
// A gestora não pode rebaixar nem desativar a si mesma (evita trancar a clínica). Toda ação vai para a tabela auditoria (sem a senha).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const PERFIS = ['gestor', 'financeiro', 'recepcao', 'profissional'];
const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return resp({ erro: 'Método não permitido' }, 405);
  const adm = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: quem } = await adm.auth.getUser(jwt);
  const eu = quem?.user;
  if (!eu) return resp({ erro: 'Sessão expirada. Entre de novo.' }, 401);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return resp({ erro: 'Pedido inválido' }, 400); }
  const cid = String(b.clinica_id || '');
  const { data: vinc } = await adm.from('usuarios_clinica').select('perfil, ativo').eq('user_id', eu.id).eq('clinica_id', cid).maybeSingle();
  if (!vinc || vinc.perfil !== 'gestor' || !vinc.ativo) return resp({ erro: 'Só a gestão pode gerenciar acessos.' }, 403);

  const auditar = (acao: string, registro: string, dados: Record<string, unknown>) =>
    adm.from('auditoria').insert({ clinica_id: cid, user_id: eu.id, tabela: 'acessos', registro_id: registro, acao, dados });
  const todosUsuarios = async () => {
    const r: any[] = [];
    for (let page = 1; page < 20; page++) {
      const { data, error } = await adm.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      r.push(...data.users); if (data.users.length < 200) break;
    }
    return r;
  };

  try {
    if (b.acao === 'listar') {
      const [{ data: vs }, us] = await Promise.all([
        adm.from('usuarios_clinica').select('user_id, perfil, profissional_id, ativo, profissionais(nome)').eq('clinica_id', cid),
        todosUsuarios()]);
      const porId = new Map(us.map((u) => [u.id, u]));
      return resp({ usuarios: (vs || []).map((v: any) => { const u: any = porId.get(v.user_id) || {};
        return { user_id: v.user_id, email: u.email || '(sem e-mail)', nome: u.user_metadata?.nome || '', perfil: v.perfil, profissional_id: v.profissional_id,
          profissional: v.profissionais?.nome || null, ativo: v.ativo, ultimo_acesso: u.last_sign_in_at || null, criado_em: u.created_at || null, eu: v.user_id === eu.id }; }) });
    }

    if (b.acao === 'criar') {
      const email = String(b.email || '').trim().toLowerCase(), senha = String(b.senha || ''), perfil = String(b.perfil || '');
      const prof = b.profissional_id || null, nome = String(b.nome || '').trim();
      if (!emailOk(email)) return resp({ erro: 'E-mail inválido.' }, 400);
      if (!PERFIS.includes(perfil)) return resp({ erro: 'Perfil inválido.' }, 400);
      if (perfil === 'profissional' && !prof) return resp({ erro: 'Escolha o profissional vinculado.' }, 400);
      if (senha.length < 8) return resp({ erro: 'A senha precisa de pelo menos 8 caracteres.' }, 400);
      const existe = (await todosUsuarios()).find((u) => (u.email || '').toLowerCase() === email);
      // Convite (o gatilho vincula na hora se o e-mail já tem conta; senão libera o cadastro abaixo)
      const { error: ec } = await adm.from('convites').upsert({ clinica_id: cid, email, perfil, profissional_id: prof, usado_em: null }, { onConflict: 'clinica_id,email' });
      if (ec) throw ec;
      if (existe) {
        await adm.from('usuarios_clinica').upsert({ user_id: existe.id, clinica_id: cid, perfil, profissional_id: prof, ativo: true }, { onConflict: 'user_id,clinica_id' });
        await adm.from('convites').update({ usado_em: new Date().toISOString() }).eq('clinica_id', cid).eq('email', email);
        await auditar('vincular_existente', existe.id, { email, perfil, profissional_id: prof });
        return resp({ ok: true, ja_existia: true, aviso: 'Este e-mail já tinha conta: o acesso foi vinculado e a senha atual foi mantida. Use "Editar" para trocar a senha.' });
      }
      const { data: nu, error: eu2 } = await adm.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
      if (eu2) throw eu2;
      await auditar('criar', nu.user.id, { email, perfil, profissional_id: prof });
      return resp({ ok: true, user_id: nu.user.id });
    }

    if (b.acao === 'editar') {
      const uid = String(b.user_id || '');
      const { data: alvo } = await adm.from('usuarios_clinica').select('perfil, ativo').eq('user_id', uid).eq('clinica_id', cid).maybeSingle();
      if (!alvo) return resp({ erro: 'Acesso não encontrado nesta clínica.' }, 404);
      const perfil = b.perfil ?? alvo.perfil, ativo = b.ativo ?? alvo.ativo;
      if (!PERFIS.includes(perfil)) return resp({ erro: 'Perfil inválido.' }, 400);
      if (uid === eu.id && (perfil !== 'gestor' || !ativo)) return resp({ erro: 'Você não pode tirar o seu próprio perfil de gestora nem se desativar.' }, 400);
      if (perfil === 'profissional' && !b.profissional_id) return resp({ erro: 'Escolha o profissional vinculado.' }, 400);
      const authUpd: Record<string, unknown> = {};
      if (b.email) { const e = String(b.email).trim().toLowerCase(); if (!emailOk(e)) return resp({ erro: 'E-mail inválido.' }, 400); authUpd.email = e; authUpd.email_confirm = true; }
      if (b.senha) { if (String(b.senha).length < 8) return resp({ erro: 'A senha precisa de pelo menos 8 caracteres.' }, 400); authUpd.password = String(b.senha); }
      if (b.nome !== undefined) authUpd.user_metadata = { nome: String(b.nome).trim() };
      // Desativar: bloqueia o login só se a pessoa não tem outro vínculo ativo
      const { data: outros } = await adm.from('usuarios_clinica').select('clinica_id').eq('user_id', uid).eq('ativo', true).neq('clinica_id', cid);
      if (!outros?.length) authUpd.ban_duration = ativo ? 'none' : '876000h';
      if (Object.keys(authUpd).length) { const { error } = await adm.auth.admin.updateUserById(uid, authUpd); if (error) throw error; }
      const { error: ev } = await adm.from('usuarios_clinica').update({ perfil, ativo, ...(b.profissional_id !== undefined ? { profissional_id: b.profissional_id || null } : {}) })
        .eq('user_id', uid).eq('clinica_id', cid);
      if (ev) throw ev;
      await auditar('editar', uid, { perfil, ativo, profissional_id: b.profissional_id || null, email: authUpd.email || undefined, senha_trocada: !!b.senha });
      return resp({ ok: true });
    }
    return resp({ erro: 'Ação desconhecida' }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return resp({ erro: /already|registered|exists/i.test(msg) ? 'Já existe uma conta com este e-mail.' : msg }, 400);
  }
});
