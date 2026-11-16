// Supabase de mentira para testar telas sem rede nem login (ver LEIAME.md).
// Lê os dados de window.__FIXTURES = { tabelas: { nome: [linhas] }, rpc: { nome: valor | (args) => valor } }.
// Toda escrita fica em window.__ESCRITAS para o teste conferir.
const copia = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const campo = (l, c) => c.split('.').reduce((o, k) => (o == null ? o : o[k]), l);
const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);
const curinga = (p) => new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');

export function criarSbFalso(fx = {}) {
  fx.tabelas ||= {}; fx.rpc ||= {};
  const escritas = (window.__ESCRITAS ||= []);
  let seq = 1;
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.ord = []; }
    select(_c, o) { if (this.op === 'select') this.conta = o?.count; else this.devolve = true; if (o?.head) this.head = true; return this; }
    insert(v) { this.op = 'insert'; this.v = v; return this; }
    upsert(v) { this.op = 'upsert'; this.v = v; return this; }
    update(v) { this.op = 'update'; this.v = v; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push((l) => String(campo(l, c)) === String(v)); return this; }
    neq(c, v) { this.f.push((l) => String(campo(l, c)) !== String(v)); return this; }
    gt(c, v) { this.f.push((l) => cmp(campo(l, c), v) > 0); return this; }
    gte(c, v) { this.f.push((l) => campo(l, c) != null && cmp(campo(l, c), v) >= 0); return this; }
    lt(c, v) { this.f.push((l) => campo(l, c) != null && cmp(campo(l, c), v) < 0); return this; }
    lte(c, v) { this.f.push((l) => campo(l, c) != null && cmp(campo(l, c), v) <= 0); return this; }
    in(c, vs) { const s = new Set((vs || []).map(String)); this.f.push((l) => s.has(String(campo(l, c)))); return this; }
    is(c, v) { this.f.push((l) => (v === null ? campo(l, c) == null : campo(l, c) === v)); return this; }
    like(c, p) { const r = curinga(p); this.f.push((l) => r.test(String(campo(l, c) ?? ''))); return this; }
    ilike(c, p) { return this.like(c, p); }
    contains(c, v) { this.f.push((l) => [].concat(v).every((x) => (campo(l, c) || []).includes(x))); return this; }
    overlaps(c, v) { this.f.push((l) => [].concat(v).some((x) => (campo(l, c) || []).includes(x))); return this; }
    not(c, op, v) { if (op === 'is' && v === null) this.f.push((l) => campo(l, c) != null);
      else if (op === 'eq') this.f.push((l) => String(campo(l, c)) !== String(v));
      else if (op === 'in') { const s = new Set(String(v).replace(/[()"]/g, '').split(',')); this.f.push((l) => !s.has(String(campo(l, c)))); }
      return this; }
    or() { return this; } filter() { return this; } match(o) { Object.entries(o).forEach(([c, v]) => this.eq(c, v)); return this; }
    textSearch() { return this; } abortSignal() { return this; } returns() { return this; }
    order(c, o) { this.ord.push([c, o?.ascending === false ? -1 : 1]); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rg = [a, b]; return this; }
    single() { this.um = 'single'; return this; }
    maybeSingle() { this.um = 'maybe'; return this; }
    then(ok, erro) { return Promise.resolve().then(() => this.exec()).then(ok, erro); }
    exec() {
      const tab = (fx.tabelas[this.t] ||= []);
      let linhas;
      if (this.op === 'insert' || this.op === 'upsert') {
        linhas = [].concat(this.v).map((l) => ({ id: l.id || `novo-${this.t}-${seq++}`, ...copia(l) }));
        tab.push(...linhas); escritas.push({ op: this.op, tabela: this.t, valores: copia(this.v) });
      } else {
        linhas = tab.filter((l) => this.f.every((f) => f(l)));
        if (this.op === 'update') { linhas.forEach((l) => Object.assign(l, copia(this.v))); escritas.push({ op: 'update', tabela: this.t, valores: copia(this.v), linhas: linhas.length }); }
        if (this.op === 'delete') { fx.tabelas[this.t] = tab.filter((l) => !linhas.includes(l)); escritas.push({ op: 'delete', tabela: this.t, linhas: linhas.length }); }
      }
      const total = linhas.length;
      for (const [c, d] of [...this.ord].reverse()) linhas = [...linhas].sort((a, b) => d * cmp(campo(a, c), campo(b, c)));
      if (this.rg) linhas = linhas.slice(this.rg[0], this.rg[1] + 1);
      if (this.lim != null) linhas = linhas.slice(0, this.lim);
      const r = { error: null, count: this.conta ? total : null, status: 200 };
      if (this.head) return { ...r, data: null };
      if (this.um) { if (!linhas.length && this.um === 'single') return { data: null, error: { message: 'Nenhuma linha (single) em ' + this.t, code: 'PGRST116' }, count: null };
        return { ...r, data: copia(linhas[0] ?? null) }; }
      return { ...r, data: copia(linhas) };
    }
  }
  const arquivo = { upload: async (p) => { escritas.push({ op: 'upload', caminho: p }); return { data: { path: p }, error: null }; },
    download: async () => ({ data: new Blob(['']), error: null }), remove: async () => ({ data: [], error: null }),
    createSignedUrl: async (p) => ({ data: { signedUrl: 'about:blank#' + p }, error: null }), list: async () => ({ data: [], error: null }) };
  const usuario = fx.usuario || { id: 'user-1', email: 'teste@cure.local' };
  return {
    from: (t) => new Q(t),
    rpc: (nome, args) => { const q = { then: (ok, erro) => Promise.resolve().then(() => {
      escritas.push({ op: 'rpc', nome, args: copia(args) });
      if (!(nome in fx.rpc)) return { data: null, error: { message: `RPC sem fixture: ${nome}` } };
      const v = fx.rpc[nome]; return { data: copia(typeof v === 'function' ? v(args, fx) : v), error: null }; }).then(ok, erro) };
      q.single = () => q; q.maybeSingle = () => q; q.select = () => q; return q; },
    auth: { getSession: async () => ({ data: { session: fx.semSessao ? null : { user: usuario, access_token: 'x' } } }),
      getUser: async () => ({ data: { user: usuario } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ error: null }), signOut: async () => ({ error: null }), updateUser: async () => ({ error: null }),
      signUp: async () => ({ error: null }), resetPasswordForEmail: async () => ({ error: null }) },
    storage: { from: () => arquivo },
    functions: { invoke: async (n, o) => { escritas.push({ op: 'funcao', nome: n, corpo: copia(o?.body) }); return { data: fx.funcoes?.[n] ?? {}, error: null }; } },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
  };
}
