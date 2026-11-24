import {
  confirmDialog,
  copyText,
  download,
  esc,
  formatBytes,
  formatCompact,
  formatDateTime,
  formatNumber,
  formatRelative,
  icon,
  loadingState,
  send,
  setBusy,
  setHtml,
  toast,
} from '../../ui/shared.js';
import { UNSUPPORTED_OPTIONS } from '../../engine/constants.js';

const PERMISSION_LABELS = {
  storage: 'Armazenar configurações, listas e estatísticas localmente',
  unlimitedStorage: 'Armazenar listas grandes e histórico no IndexedDB',
  tabs: 'Identificar a aba ativa e atualizar o contador do ícone',
  alarms: 'Agendar atualizações automáticas das listas',
  webRequest: 'Observar requisições para estatísticas e bloqueio nativo',
  webRequestBlocking: 'Bloquear requisições pelo motor local (Firefox)',
  declarativeNetRequest: 'Aplicar regras de bloqueio declarativas (Chromium)',
  declarativeNetRequestFeedback: 'Diagnosticar regras declarativas',
  scripting: 'Injetar o CSS cosmético validado nas páginas',
  activeTab: 'Acessar a aba somente quando você interage com a extensão',
  '<all_urls>': 'Filtrar requisições e aplicar cosméticos em sites HTTP(S)',
};

function permissionLabel(permission) {
  return PERMISSION_LABELS[permission] || 'Permissão declarada no manifesto';
}

function targetLabel(target) {
  if (target === 'firefox') return 'Firefox';
  if (target === 'chromium') return 'Chromium (Chrome, Edge, Brave)';
  return target || 'desconhecido';
}

function backendLabel(info) {
  if (info.target === 'firefox') return 'webRequest bloqueante + motor nativo';
  if (info.dnr?.supported) return 'declarativeNetRequest (MV3)';
  return 'Somente motor nativo (DNR indisponível)';
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let info = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!info) setHtml(view, loadingState('Coletando diagnóstico…'));
      try {
        const data = await send('system.info');
        if (disposed) return;
        info = data;
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao coletar o diagnóstico.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const build = info.build || info.engine?.build || {};
    const engineStats = build.engine || {};
    const dnr = info.dnr || {};
    const storage = info.storage || {};
    const db = info.dbCounts || {};
    const history = info.history || {};
    const browser = info.browser || {};
    const usage = Number(storage.usage) || 0;
    const quota = Number(storage.quota) || 0;
    const usageRatio = quota ? Math.min(100, (usage / quota) * 100) : 0;
    const dnrBadge = info.target === 'firefox'
      ? '<span class="badge green">Bloqueio nativo</span>'
      : dnr.supported
        ? `<span class="badge ${dnr.error ? 'amber' : 'green'}">DNR ${dnr.error ? 'parcial' : 'ativo'}</span>`
        : '<span class="badge red">DNR indisponível</span>';

    setHtml(view, `
      <section class="card hero">
        <div class="flex-between flex-wrap" style="align-items:flex-start;gap:18px">
          <div class="flex" style="align-items:flex-start;gap:16px">
            <div class="hero-shield">${icon('shield')}</div>
            <div>
              <div class="hero-title">Aegis AdBlock ${esc(info.app.version)}</div>
              <div class="hero-sub mt-6">Extensão independente de bloqueio de anúncios e rastreadores. Motor próprio, dados locais e nenhuma telemetria.</div>
              <div class="pill-row mt-10">
                <span class="badge cyan">${esc(targetLabel(info.target))}</span>
                <span class="badge gray">Manifest v${esc(String(info.app.manifestVersion || '—'))}</span>
                ${dnrBadge}
              </div>
            </div>
          </div>
          <div class="text-right">
            <div class="kpi-label" style="justify-content:flex-end">Regras no motor</div>
            <div class="kpi-value" style="color:var(--accent)">${esc(formatCompact(build.totalRules || 0))}</div>
            <div class="kpi-sub">${esc(formatNumber(build.networkRules || 0))} de rede · ${esc(formatNumber(build.cosmeticRules || 0))} cosméticas</div>
          </div>
        </div>
        <div class="stat-strip mt-24">
          <div><div class="label">Listas</div><div class="value">${esc(String(info.lists?.enabled || 0))}/${esc(String(info.lists?.total || 0))}</div></div>
          <div><div class="label">Backend</div><div class="value" style="font-size:14px">${esc(backendLabel(info))}</div></div>
          <div><div class="label">Armazenamento</div><div class="value">${esc(formatBytes(usage))}</div></div>
          <div><div class="label">Histórico</div><div class="value">${esc(formatNumber(history.count || 0))}</div></div>
        </div>
      </section>

      <div class="toolbar mt-16">
        <button class="btn" id="ab-backup">${icon('download')}Exportar backup completo</button>
        <button class="btn" id="ab-copy">${icon('copy')}Copiar diagnóstico</button>
        <button class="btn" id="ab-badges">${icon('refresh')}Atualizar ícones</button>
        <button class="btn" id="ab-reschedule">${icon('refresh')}Reagendar atualizações</button>
        <span class="spacer"></span>
        <button class="btn btn-danger" id="ab-reset">${icon('trash')}Redefinir tudo</button>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>${icon('zap')}Diagnóstico do motor</h2><p>Última construção do índice de filtros.</p></div><span class="badge ${info.engine?.ready ? 'green' : 'amber'}">${info.engine?.ready ? 'Pronto' : 'Inicializando'}</span></div>
          <dl class="kv">
            <dt>Motivo da construção</dt><dd>${esc(build.reason || '—')}</dd>
            <dt>Construído em</dt><dd>${esc(build.builtAt ? formatDateTime(build.builtAt) : '—')}${build.builtAt ? ` · ${esc(formatRelative(build.builtAt))}` : ''}</dd>
            <dt>Tempo de construção</dt><dd>${build.buildMs !== undefined ? `${esc(String(build.buildMs))} ms` : '—'}</dd>
            <dt>Listas carregadas</dt><dd>${esc(String(build.listsLoaded ?? 0))} · ${esc(String(build.listsSkipped ?? 0))} ignorada(s)</dd>
            <dt>Cache de listas</dt><dd>${esc(String(build.cacheHits ?? 0))} reaproveitada(s)</dd>
            <dt>Regras de rede</dt><dd>${esc(formatNumber(build.networkRules || 0))}</dd>
            <dt>Regras cosméticas</dt><dd>${esc(formatNumber(build.cosmeticRules || 0))} (${esc(formatNumber(engineStats.cosmeticGeneric || 0))} genéricas, ${esc(formatNumber(engineStats.cosmeticSpecific || 0))} específicas)</dd>
            <dt>Regras personalizadas</dt><dd>${esc(formatNumber(build.customRules || 0))} · ${esc(formatNumber(build.customInvalid || 0))} inválida(s)</dd>
            <dt>Duplicatas removidas</dt><dd>${esc(formatNumber(build.duplicateRules || 0))} (${esc(formatNumber(build.duplicateNetworkRules || 0))} de rede · ${esc(formatNumber(build.duplicateCosmeticRules || 0))} cosméticas)</dd>
            <dt>Regras descartadas</dt><dd>${esc(formatNumber(build.invalidRules || 0))} inválida(s) · ${esc(formatNumber(build.unsupportedRules || 0))} não suportada(s)</dd>
            <dt>Categorias desativadas</dt><dd>${esc((build.disabledCategories || []).join(', ') || 'nenhuma')}</dd>
            <dt>DNR</dt><dd>${dnr.supported ? `${esc(String(dnr.applied || 0))} regra(s) aplicada(s) · ${esc(String(dnr.failed || 0))} rejeitada(s)` : 'não utilizado neste navegador'}</dd>
            ${dnr.error ? `<dt>Erro DNR</dt><dd style="color:var(--red)">${esc(dnr.error)}</dd>` : ''}
          </dl>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>${icon('info')}Ambiente</h2><p>Navegador, versão e armazenamento.</p></div></div>
          <dl class="kv">
            <dt>Aplicativo</dt><dd>${esc(info.app.name)} ${esc(info.app.version)}</dd>
            <dt>Manifest</dt><dd>v${esc(String(info.app.manifestVersion || '—'))}</dd>
            <dt>Plataforma</dt><dd>${esc(targetLabel(info.target))}</dd>
            <dt>Navegador</dt><dd>${esc(browser.name ? `${browser.name} ${browser.version || ''}` : (navigator.userAgent || 'desconhecido'))}</dd>
            <dt>Motor de bloqueio</dt><dd>${esc(backendLabel(info))}</dd>
            <dt>Listas com erro</dt><dd>${esc(String(info.lists?.errors || 0))}</dd>
            <dt>Permissões</dt><dd>${esc(String((info.permissions || []).length))} · ${esc(String((info.hostPermissions || []).length))} host(s)</dd>
            <dt>IndexedDB</dt><dd>${esc(String(db.listBodies ?? 0))} corpo(s) · ${esc(String(db.listHistory ?? 0))} versão(ões) · ${esc(String(db.history ?? 0))} evento(s) · ${esc(String(db.engineCache ?? 0))} cache(s)</dd>
            <dt>Armazenamento usado</dt><dd>${esc(formatBytes(usage))}${quota ? ` de ${esc(formatBytes(quota))}` : ''}</dd>
            <dt>Histórico mais antigo</dt><dd>${history.oldest ? esc(formatDateTime(history.oldest)) : '—'}</dd>
            <dt>Histórico mais recente</dt><dd>${history.newest ? esc(formatDateTime(history.newest)) : '—'}</dd>
            <dt>Permissões de site</dt><dd>${esc(String(info.whitelist || 0))} registro(s)</dd>
          </dl>
          <div class="mt-16">
            <div class="flex-between tiny muted mb-10"><span>Uso de armazenamento</span><strong class="soft">${esc(usageRatio.toFixed(1))}%</strong></div>
            <div class="progress"><span style="width:${Math.max(1, usageRatio)}%"></span></div>
          </div>
        </section>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>${icon('rules')}Compatibilidade de filtros</h2><p>O motor implementa sintaxe EasyList/Adblock Plus para rede e cosméticos.</p></div></div>
          <div class="help-grid">
            <div class="help-card">
              <h3 class="small soft">Suportado</h3>
              <ul>
                <li>Padrões <code>||domínio^</code>, curingas e âncoras de URL.</li>
                <li>Expressões regulares delimitadas por <code>/</code>.</li>
                <li>Exceções <code>@@</code> e regras <code>$important</code>.</li>
                <li>Tipos de recurso (<code>script</code>, <code>image</code>, <code>xmlhttprequest</code>…).</li>
                <li>Domínios de origem e destino (<code>domain=</code>, <code>denyallow</code> não).</li>
                <li>Primeira/terceira parte, <code>~</code> e listas hosts/domínios.</li>
                <li>Cosméticos <code>##</code>, <code>#@#</code> e escopo por domínio.</li>
              </ul>
            </div>
            <div class="help-card">
              <h3 class="small soft">Não executado por segurança</h3>
              <ul>
                <li>Scriptlets e injeção de JavaScript (<code>#$#</code>).</li>
                <li>Seletores procedurais estendidos e <code>:has()</code>.</li>
                <li>Opções: <code>${esc(UNSUPPORTED_OPTIONS.slice(0, 12).join('</code>, <code>'))}</code> e outras.</li>
                <li>Substituição de respostas, redirecionamentos e cabeçalhos.</li>
                <li>Regras cosméticas genéricas muito amplas são recusadas.</li>
              </ul>
            </div>
          </div>
          <div class="notice info mt-16">${icon('info')}<div>Regras não suportadas são contabilizadas no diagnóstico e ignoradas — nunca executadas. A lista anterior é mantida quando uma atualização falha ou fica vazia.</div></div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>${icon('shield')}Privacidade</h2><p>Projetado para não coletar nada.</p></div></div>
          <div class="help-card">
            <ul>
              <li>Sem telemetria, analytics, conta ou servidor da extensão.</li>
              <li>Listas são baixadas apenas de URLs que você instala ou atualiza.</li>
              <li>Histórico e estatísticas ficam em <code>storage.local</code> e IndexedDB.</li>
              <li>URLs do histórico descartam parâmetros, fragmentos e credenciais.</li>
              <li>Conteúdo de páginas não é lido nem enviado; apenas CSS validado é injetado.</li>
              <li>Permissões são declaradas no manifesto e explicadas abaixo.</li>
            </ul>
          </div>
          <div class="divider"></div>
          <div class="small soft mb-10">Permissões declaradas</div>
          <div class="code-list" style="max-height:220px;overflow:auto">
            ${[...(info.permissions || []), ...(info.hostPermissions || [])]
              .map((permission) => `<div class="code-item"><span title="${esc(permission)}">${esc(permission)}</span><span class="tiny muted" style="flex:0 0 auto;max-width:55%;text-align:right">${esc(permissionLabel(permission))}</span></div>`)
              .join('') || '<div class="tiny muted">Nenhuma permissão declarada.</div>'}
          </div>
        </section>
      </div>

      <div class="notice mt-16">${icon('alert')}<div><strong>Redefinir tudo</strong> apaga configurações, listas, regras, permissões, histórico, estatísticas e caches. A lista essencial incluída é reinstalada. Esta ação não pode ser desfeita.</div></div>
    `);
    bind();
  }

  function diagnosticText() {
    const report = {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      info,
    };
    return JSON.stringify(report, null, 2);
  }

  function bind() {
    view.querySelector('#ab-backup')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Gerando backup');
      try {
        const payload = await send('system.exportConfig', { includeLists: true });
        download(`aegis-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
        toast('Backup completo exportado.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#ab-copy')?.addEventListener('click', async () => {
      await copyText(diagnosticText());
    });

    view.querySelector('#ab-badges')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Atualizando');
      try {
        await send('system.refreshBadges');
        toast('Contadores do ícone atualizados.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#ab-reschedule')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Reagendando');
      try {
        await send('system.reschedule');
        toast('Agendamento de atualizações renovado.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#ab-reset')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Redefinir tudo',
        message: 'Configurações, listas, regras personalizadas, permissões, histórico, estatísticas e caches serão apagados. A lista essencial será reinstalada. Não é possível desfazer.',
        confirmLabel: 'Apagar tudo',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('system.reset');
        toast('Extensão redefinida. Recarregue as abas abertas para reaplicar os cosméticos.', 'success');
        await ctx.refreshStatus();
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(lists|rules|settings|system|protection|whitelist|history)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 400);
    }
  };
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    window.removeEventListener('aegis:event', onEvent);
  };
}
