import {
  CATEGORY_ORDER,
  CATEGORIES,
  categoryInfo,
  emptyState,
  esc,
  formatCompact,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  icon,
  listStatusBadge,
  loadingState,
  send,
  setHtml,
  statusBadge,
  tempDurationOptions,
  toast,
} from '../../ui/shared.js';
import { donutChart, lineChart, barList } from '../../ui/charts.js';

export async function render(view, ctx) {
  let disposed = false;
  let reloading = null;
  const installing = new Set();
  let reloadTimer = null;

  async function load() {
    if (reloading) return reloading;
    reloading = (async () => {
      setHtml(view, loadingState('Carregando visão geral…'));
      try {
        const [status, stats, lists, history] = await Promise.all([
          send('status.get'),
          send('stats.get', { days: 7 }),
          send('lists.get'),
          send('history.query', { page: 1, pageSize: 6 }),
        ]);
        if (disposed) return;
        ctx.state.status = status;
        paint({ status, stats, lists, history });
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar a visão geral.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        reloading = null;
      }
    })();
    return reloading;
  }

  function paint({ status, stats, lists, history }) {
    const settings = status.settings;
    const paused = status.pause?.paused;
    const whitelisted = status.site?.whitelisted;
    const kind = !settings.enabled ? 'off' : paused ? 'paused' : 'on';
    const heroTitle = !settings.enabled
      ? 'Proteção desativada'
      : paused
        ? 'Proteção pausada'
        : 'Você está protegido';
    const heroSub = !settings.enabled
      ? 'Nenhuma requisição está sendo filtrada. Ative quando quiser retomar.'
      : paused
        ? `Pausa temporária ativa por mais ${Math.ceil((status.pause?.remainingMs || 0) / 60000)} minutos.`
        : `${formatNumber(stats.todayBlocked)} bloqueio(s) hoje. Tudo processado localmente, sem telemetria.`;

    const categoryItems = CATEGORY_ORDER.map((id) => ({
      label: CATEGORIES[id].label,
      value: stats.categories.find((entry) => entry.category === id)?.count || 0,
      color: CATEGORIES[id].color,
    })).filter((item) => item.value > 0);

    const enabledLists = lists.lists.filter((list) => list.enabled);
    const errorLists = lists.lists.filter((list) => list.status === 'error');
    const installedRecommended = new Set(lists.lists.map((list) => list.url).filter(Boolean));
    const suggestions = lists.recommended.filter((item) => !installedRecommended.has(item.url)).slice(0, 3);

    setHtml(view, `
      <div class="grid grid-main">
        <section class="card hero">
          <div class="flex-between flex-wrap" style="align-items:flex-start;gap:18px">
            <div class="flex" style="align-items:flex-start;gap:16px">
              <div class="hero-shield">${icon('shield')}</div>
              <div>
                <div class="hero-title">${esc(heroTitle)}</div>
                <div class="hero-sub mt-6">${esc(heroSub)}</div>
                <div class="pill-row mt-10">${statusBadge(kind === 'on' ? 'on' : kind)}${whitelisted ? '<span class="badge gray">Site atual permitido</span>' : ''}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="kpi-label" style="justify-content:flex-end">Hoje</div>
              <div class="kpi-value" style="color:var(--accent)">${esc(formatNumber(stats.todayBlocked))}</div>
              <div class="kpi-sub">bloqueios</div>
            </div>
          </div>
          <div class="mt-24">
            <div class="flex-between tiny muted mb-10"><span>Taxa de bloqueio sobre requisições analisadas</span><strong style="color:var(--text-soft)">${esc(formatPercent(stats.blockRate))}</strong></div>
            <div class="progress"><span style="width:${Math.min(100, Math.max(1, stats.blockRate))}%"></span></div>
          </div>
          <div class="stat-strip mt-24">
            <div><div class="label">Total bloqueado</div><div class="value">${esc(formatCompact(stats.totalBlocked))}</div></div>
            <div><div class="label">Analisadas</div><div class="value">${esc(formatCompact(stats.totalRequests))}</div></div>
            <div><div class="label">Listas ativas</div><div class="value">${esc(String(enabledLists.length))}/${esc(String(lists.lists.length))}</div></div>
            <div><div class="label">Regras</div><div class="value">${esc(formatCompact(status.engine?.build?.totalRules || 0))}</div></div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Ações rápidas</h2><p>Controle a proteção sem sair do painel.</p></div></div>
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            <button class="btn ${settings.enabled ? 'btn-danger' : 'btn-primary'}" id="ov-toggle">${settings.enabled ? 'Desativar proteção' : 'Ativar proteção'}</button>
            <button class="btn" id="ov-update">Atualizar listas</button>
          </div>
          <div class="divider"></div>
          <div class="field">
            <label for="ov-pause-duration">Pausa temporária</label>
            <div class="inline-form">
              <select class="select" id="ov-pause-duration" ${paused ? 'disabled' : ''}>${tempDurationOptions('1h')}</select>
              <button class="btn ${paused ? '' : 'btn-ghost'}" id="ov-pause">${paused ? 'Retomar agora' : 'Pausar'}</button>
            </div>
            <div class="hint">${paused ? `Pausado até ${esc(formatDateTime(status.pause.until))}.` : 'Útil para testar um site sem alterar a lista de permissões.'}</div>
          </div>
          <div class="divider"></div>
          <div class="flex-between">
            <div><div class="small soft">Bloqueios na aba atual</div><div class="tiny muted">${esc(status.site?.hostname || 'Nenhuma aba da web ativa')}</div></div>
            <div class="kpi-value" style="font-size:22px">${esc(formatNumber(status.site?.blocked || 0))}</div>
          </div>
        </section>
      </div>

      <div class="grid grid-4 mt-16">
        <div class="card kpi"><div class="kpi-label">${icon('shield')}Total bloqueado</div><div class="kpi-value">${esc(formatNumber(stats.totalBlocked))}</div><div class="kpi-sub">desde a instalação</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('chart')}Requisições analisadas</div><div class="kpi-value">${esc(formatNumber(stats.totalRequests))}</div><div class="kpi-sub">${esc(formatPercent(stats.blockRate))} bloqueadas</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('zap')}Últimos 7 dias</div><div class="kpi-value">${esc(formatCompact(stats.series.reduce((sum, day) => sum + day.blocked, 0)))}</div><div class="kpi-sub">bloqueios no período</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('lists')}Motor</div><div class="kpi-value">${esc(formatCompact(status.engine?.build?.networkRules || 0))}</div><div class="kpi-sub">regras de rede · ${esc(formatCompact(status.engine?.build?.cosmeticRules || 0))} cosméticas</div></div>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>Atividade dos últimos 7 dias</h2><p>Requisições observadas e bloqueios por dia.</p></div><span class="badge cyan">7 dias</span></div>
          <div class="chart" id="ov-chart"></div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Por categoria</h2><p>Distribuição real dos bloqueios.</p></div></div>
          <div id="ov-donut"></div>
        </section>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>Sites com mais bloqueios</h2><p>Baseado nas estatísticas locais.</p></div><button class="btn btn-sm btn-ghost" data-navigate="statistics">Ver estatísticas</button></div>
          <div id="ov-sites"></div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Saúde das listas</h2><p>${esc(String(enabledLists.length))} ativa(s) de ${esc(String(lists.lists.length))}.</p></div><button class="btn btn-sm btn-ghost" data-navigate="lists">Gerenciar</button></div>
          ${lists.lists.length ? '' : emptyState('Nenhuma lista instalada', 'Adicione uma lista para começar.', 'lists')}
          <div class="timeline-list">
            ${lists.lists
              .slice(0, 5)
              .map(
                (list) => `<div class="timeline-item"><span class="timeline-dot" style="background:${list.status === 'error' ? 'var(--red)' : list.enabled ? 'var(--green)' : 'var(--text-dim)'}"></span><div class="timeline-main"><div class="timeline-title">${esc(list.name)} ${listStatusBadge(list)}</div><div class="timeline-sub">${esc(formatNumber(list.ruleCount))} regras · ${esc(formatRelative(list.lastUpdated))}</div></div></div>`,
              )
              .join('')}
          </div>
          ${errorLists.length ? `<div class="notice danger mt-16">${icon('alert')}<div>${esc(String(errorLists.length))} lista(s) com erro de atualização. A última versão válida foi mantida.</div></div>` : ''}
          ${suggestions.length ? `<div class="divider"></div><div class="tiny muted mb-10">Sugestões</div>${suggestions.map((item) => `<div class="flex-between" style="padding:4px 0"><span class="small truncate">${esc(item.name)}</span>${installing.has(item.id) ? '<button class="btn btn-sm" disabled><span class="spinner"></span>Instalando…</button>' : `<button class="btn btn-sm" data-install="${esc(item.id)}">Instalar</button>`}</div>`).join('')}` : ''}
        </section>
      </div>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Bloqueios recentes</h2><p>Somente o necessário é salvo; parâmetros de consulta são removidos.</p></div><button class="btn btn-sm btn-ghost" data-navigate="history">Abrir histórico</button></div>
        ${history.items.length ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Site</th><th>Recurso</th><th>Tipo</th><th>Regra</th><th>Lista</th></tr></thead><tbody>${history.items
          .map(
            (row) => `<tr><td class="nowrap">${esc(formatRelative(row.ts))}</td><td class="truncate" style="max-width:160px">${esc(row.site || '—')}</td><td><div class="cell-main truncate" style="max-width:260px">${esc(row.url || '—')}</div></td><td>${esc(row.type || '—')}</td><td><span class="rule-code" title="${esc(row.rule)}">${esc(row.rule || '—')}</span></td><td class="truncate" style="max-width:130px">${esc(row.listName || row.listId || '—')}</td></tr>`,
          )
          .join('')}</tbody></table></div>` : emptyState('Nenhum bloqueio registrado', 'Quando algo for bloqueado, os detalhes aparecem aqui.', 'history')}
      </section>
    `);

    lineChart(view.querySelector('#ov-chart'), { series: stats.series, height: 240 });
    donutChart(view.querySelector('#ov-donut'), categoryItems, { totalLabel: 'bloqueios' });
    barList(
      view.querySelector('#ov-sites'),
      stats.topSites.slice(0, 6).map((site) => ({ label: site.site, value: site.blocked, color: 'var(--accent)' })),
      { empty: 'Nenhum site com bloqueios ainda.' },
    );

    bind();
  }

  function bind() {
    const toggle = view.querySelector('#ov-toggle');
    toggle?.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        const enabled = !ctx.state.status?.settings?.enabled;
        await send('protection.toggle', { enabled });
        toast(enabled ? 'Proteção ativada.' : 'Proteção desativada.', 'success');
        await ctx.refreshStatus();
        await load();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        toggle.disabled = false;
      }
    });
    view.querySelector('#ov-update')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      setHtml(button, '<span class="spinner"></span>Atualizando');
      try {
        const result = await send('lists.updateAll', { dueOnly: false });
        toast(`${result.updated} atualizada(s), ${result.failed} falha(s).`, result.failed ? 'error' : 'success');
        await ctx.refreshStatus();
        await load();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Atualizar listas';
      }
    });
    view.querySelector('#ov-pause')?.addEventListener('click', async () => {
      try {
        if (ctx.state.status?.pause?.paused) {
          await send('protection.pause', { minutes: 0 });
          toast('Proteção retomada.', 'success');
        } else {
          const duration = view.querySelector('#ov-pause-duration').value;
          const map = { '1h': 60, '24h': 1440, '7d': 10080 };
          await send('protection.pause', { minutes: map[duration] || 60 });
          toast('Proteção pausada temporariamente.', 'success');
        }
        await ctx.refreshStatus();
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
    view.querySelectorAll('[data-install]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.install;
        if (installing.has(id)) return;
        installing.add(id);
        button.disabled = true;
        setHtml(button, '<span class="spinner"></span>Instalando…');
        try {
          await send('lists.installRecommended', { id });
          toast('Lista instalada.', 'success');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          installing.delete(id);
          await load();
        }
      });
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    const scope = event.detail?.scope || '';
    if (!/^(lists|stats|history|settings|protection|system|whitelist|rules)/.test(scope)) return;
    // Coalesce bursts of background events into a single reload, and never
    // repaint while recommended-list installs are in flight (it would wipe
    // their busy state and cause duplicate submissions).
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (!disposed && installing.size === 0) load();
    }, 300);
  };
  window.addEventListener('aegis:event', onEvent);
  const timer = setInterval(() => {
    if (!disposed && installing.size === 0 && document.visibilityState === 'visible') load();
  }, 20000);

  await load();
  return () => {
    disposed = true;
    clearInterval(timer);
    clearTimeout(reloadTimer);
    window.removeEventListener('aegis:event', onEvent);
  };
}
