import {
  CATEGORY_ORDER,
  CATEGORIES,
  TYPE_LABELS,
  confirmDialog,
  download,
  emptyState,
  esc,
  formatCompact,
  formatDateTime,
  formatNumber,
  formatPercent,
  icon,
  loadingState,
  send,
  setHtml,
  toast,
} from '../../ui/shared.js';
import { donutChart, lineChart, barList, miniSparkline } from '../../ui/charts.js';

const RANGES = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '90 dias' },
  { days: 365, label: '1 ano' },
];

export async function render(view, ctx) {
  let disposed = false;
  let days = 30;
  let loading = null;
  let lastStats = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      setHtml(view, loadingState('Calculando estatísticas…'));
      try {
        const [stats, status] = await Promise.all([send('stats.get', { days }), send('status.get')]);
        if (disposed) return;
        lastStats = stats;
        ctx.state.status = status;
        paint(stats, status);
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Não foi possível carregar as estatísticas.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint(stats, status) {
    const rangeTotal = stats.series.reduce((sum, day) => sum + day.blocked, 0);
    const rangeRequests = stats.series.reduce((sum, day) => sum + day.requests, 0);
    const rangeRate = rangeRequests ? (rangeTotal / rangeRequests) * 100 : 0;
    const activeDays = stats.series.filter((day) => day.blocked > 0 || day.requests > 0).length;
    const best = stats.series.reduce((top, day) => (!top || day.blocked > top.blocked ? day : top), null);
    const categoryItems = CATEGORY_ORDER.map((id) => ({
      label: CATEGORIES[id].label,
      value: stats.categories.find((entry) => entry.category === id)?.count || 0,
      color: CATEGORIES[id].color,
    })).filter((item) => item.value > 0);
    const spark = stats.series.map((day) => day.blocked);

    setHtml(view, `
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Período das estatísticas">
          ${RANGES.map((range) => `<button type="button" data-days="${range.days}" class="${range.days === days ? 'active' : ''}">${range.label}</button>`).join('')}
        </div>
        <span class="spacer"></span>
        <button class="btn btn-sm" id="st-refresh">${icon('refresh')}Atualizar</button>
        <button class="btn btn-sm" id="st-export">${icon('download')}Exportar JSON</button>
        <button class="btn btn-sm btn-danger" id="st-reset">${icon('trash')}Zerar estatísticas</button>
      </div>

      <div class="grid grid-4">
        <div class="card kpi">
          <div class="kpi-label">${icon('shield')}Bloqueados no período</div>
          <div class="kpi-value">${esc(formatNumber(rangeTotal))}</div>
          <div class="kpi-sub">${esc(formatNumber(activeDays))} dia(s) com atividade</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">${icon('chart')}Requisições no período</div>
          <div class="kpi-value">${esc(formatNumber(rangeRequests))}</div>
          <div class="kpi-sub">${esc(formatPercent(rangeRate))} bloqueadas</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">${icon('zap')}Melhor dia</div>
          <div class="kpi-value">${esc(best && best.blocked ? formatCompact(best.blocked) : '0')}</div>
          <div class="kpi-sub">${esc(best && best.blocked ? best.label : 'Sem bloqueios no período')}</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">${icon('dashboard')}Total desde a instalação</div>
          <div class="kpi-value">${esc(formatNumber(stats.totalBlocked))}</div>
          <div class="kpi-sub">${esc(formatNumber(stats.totalRequests))} analisadas</div>
        </div>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head">
            <div><h2>Bloqueios e requisições</h2><p>Dados reais gravados em <code>storage.local</code>, sem telemetria.</p></div>
            <span class="badge cyan">${esc(RANGES.find((range) => range.days === days)?.label || '')}</span>
          </div>
          <div class="chart" id="st-chart"></div>
          <div class="flex-between mt-16" style="gap:12px;flex-wrap:wrap">
            <div class="tiny muted">Início do registro: ${esc(stats.createdAt ? formatDateTime(stats.createdAt) : 'desconhecido')}</div>
            <div class="tiny muted">Última gravação: ${esc(stats.updatedAt ? formatDateTime(stats.updatedAt) : '—')}</div>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Distribuição por categoria</h2><p>Todo o histórico agregado.</p></div></div>
          <div id="st-donut"></div>
          <div class="divider"></div>
          <div class="flex-between">
            <div>
              <div class="small soft">Tendência recente</div>
              <div class="tiny muted">Bloqueios por dia</div>
            </div>
            <div id="st-spark" aria-hidden="true">${miniSparkline(spark, { color: CATEGORIES.ads.color })}</div>
          </div>
        </section>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>Tipos de recurso</h2><p>O que o motor bloqueou com mais frequência.</p></div></div>
          <div id="st-types"></div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Saúde do motor</h2><p>Regras ativas neste momento.</p></div><button class="btn btn-sm btn-ghost" data-navigate="about">Diagnóstico</button></div>
          <div class="stat-strip" style="grid-template-columns:repeat(2,1fr)">
            <div><div class="label">Regras de rede</div><div class="value">${esc(formatNumber(status.engine?.build?.networkRules || 0))}</div></div>
            <div><div class="label">Cosméticas</div><div class="value">${esc(formatNumber(status.engine?.build?.cosmeticRules || 0))}</div></div>
            <div><div class="label">Inválidas</div><div class="value">${esc(formatNumber(status.engine?.build?.invalidRules || 0))}</div></div>
            <div><div class="label">Não suportadas</div><div class="value">${esc(formatNumber(status.engine?.build?.unsupportedRules || 0))}</div></div>
          </div>
          <div class="divider"></div>
          <dl class="kv">
            <dt>Hoje</dt><dd>${esc(formatNumber(stats.todayBlocked))} bloqueios · ${esc(formatNumber(stats.todayRequests))} requisições</dd>
            <dt>Taxa global</dt><dd>${esc(formatPercent(stats.blockRate))}</dd>
            <dt>Listas ativas</dt><dd>${esc(String(status.engine?.lists?.enabled || 0))} de ${esc(String(status.engine?.lists?.total || 0))}</dd>
            <dt>Backend</dt><dd>${esc(status.engine?.dnr?.supported ? `declarativeNetRequest (${status.engine.dnr.applied} regras)` : 'webRequest nativo')}</dd>
          </dl>
        </section>
      </div>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Sites com mais bloqueios</h2><p>Top 100 domínios por bloqueios acumulados. Apenas o host é registrado.</p></div><span class="badge gray">${esc(String(stats.topSites.length))} sites</span></div>
        ${stats.topSites.length ? `
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Site</th><th>Bloqueados</th><th>Requisições</th><th>Taxa</th><th>Tendência</th></tr></thead>
              <tbody>
                ${stats.topSites
                  .map((site, index) => {
                    const rate = site.requests ? (site.blocked / site.requests) * 100 : 0;
                    return `<tr>
                      <td class="muted">${index + 1}</td>
                      <td class="cell-main">${esc(site.site)}</td>
                      <td><strong>${esc(formatNumber(site.blocked))}</strong></td>
                      <td class="muted">${esc(formatNumber(site.requests))}</td>
                      <td><span class="badge ${rate >= 40 ? 'red' : rate >= 10 ? 'amber' : 'gray'}">${esc(formatPercent(rate))}</span></td>
                      <td style="width:120px">${miniSparkline(stats.series.map((day) => (day.blocked > 0 ? 1 : 0)), { color: site.blocked ? CATEGORIES.ads.color : '#475569', width: 90, height: 22 })}</td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>` : emptyState('Nenhum site registrado', 'Navegue com a proteção ativa para gerar estatísticas por site.', 'chart')}
      </section>
    `);

    lineChart(view.querySelector('#st-chart'), { series: stats.series, height: 260 });
    donutChart(view.querySelector('#st-donut'), categoryItems, { totalLabel: 'bloqueios' });
    barList(
      view.querySelector('#st-types'),
      stats.types.map((entry) => ({
        label: TYPE_LABELS[entry.type] || entry.type,
        value: entry.count,
        color: 'var(--violet)',
      })),
      { empty: 'Nenhum bloqueio por tipo ainda.' },
    );

    bind();
  }

  function bind() {
    view.querySelectorAll('[data-days]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.days);
        if (!RANGES.some((range) => range.days === value) || value === days) return;
        days = value;
        load();
      });
    });

    view.querySelector('#st-refresh')?.addEventListener('click', () => load());

    view.querySelector('#st-export')?.addEventListener('click', () => {
      if (!lastStats) return;
      const payload = {
        kind: 'aegis-adblock-statistics',
        version: 1,
        exportedAt: new Date().toISOString(),
        rangeDays: days,
        stats: lastStats,
      };
      download(`aegis-estatisticas-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
      toast('Estatísticas exportadas.', 'success');
    });

    view.querySelector('#st-reset')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Zerar estatísticas',
        message: 'Todos os contadores agregados serão apagados. O histórico detalhado de bloqueios não será alterado.',
        confirmLabel: 'Zerar',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('stats.reset');
        toast('Estatísticas zeradas.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    const scope = event.detail?.scope || '';
    if (/^(stats|history|lists|settings|system)/.test(scope)) {
      setTimeout(() => {
        if (!disposed) load();
      }, 300);
    }
  };
  window.addEventListener('aegis:event', onEvent);
  const timer = setInterval(() => {
    if (!disposed && document.visibilityState === 'visible') load();
  }, 30000);

  await load();
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('aegis:event', onEvent);
  };
}
