import {
  ICONS,
  debounce,
  errorState,
  esc,
  formatNumber,
  formatPercent,
  formatRemaining,
  onBackgroundEvent,
  send,
  setBusy,
  setHtml,
  statusBadge,
  toast,
} from '../ui/shared.js';
import { createTab, getApi, queryTabs } from '../utils/browser.js';

const PAUSE_OPTIONS = [
  { value: 5, label: '5 minutos' },
  { value: 15, label: '15 minutos' },
  { value: 60, label: '1 hora' },
  { value: 180, label: '3 horas' },
  { value: 1440, label: '24 horas' },
];

const state = {
  tabId: -1,
  data: null,
  loading: false,
  error: '',
  busy: false,
};

const content = document.getElementById('popup-content');
const statusBox = document.getElementById('popup-status');
const markBox = document.getElementById('popup-mark');
const versionBox = document.getElementById('popup-version');

if (markBox) setHtml(markBox, ICONS.shield);

function pageLabel(url) {
  const value = String(url || '');
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return value;
    const path = `${parsed.pathname || '/'}${parsed.search ? '?…' : ''}`;
    return `${parsed.host}${path}`;
  } catch {
    return value;
  }
}

function pauseOptions() {
  return PAUSE_OPTIONS.map(
    (option) => `<option value="${option.value}">${esc(option.label)}</option>`,
  ).join('');
}

function protectionKind() {
  const data = state.data;
  if (!data) return 'off';
  if (!data.settings?.enabled) return 'off';
  if (data.pause?.paused) return 'paused';
  if (data.site?.whitelisted) return 'whitelisted';
  return 'protected';
}

function renderHeader() {
  setHtml(statusBox, dataProtected() ? statusBadge(protectionKind()) : statusBadge('off'));
}

function dataProtected() {
  return Boolean(state.data);
}

function renderSiteCard(data) {
  const site = data.site || {};
  const host = site.hostname || '';
  const supported = Boolean(host);
  const whitelist = data.whitelist;
  const blocked = Number(site.blocked) || 0;
  const cosmetic = Number(site.cosmetic) || 0;
  const requests = Number(site.requests) || 0;
  const topHosts = Array.isArray(site.topHosts) ? site.topHosts.slice(0, 4) : [];
  const title = host || 'Página não suportada';
  const subtitle = supported
    ? pageLabel(site.pageUrl) || 'Endereço indisponível'
    : 'Abra uma página http(s) para ver as estatísticas deste site.';

  let notice = '';
  if (!data.settings?.enabled) {
    notice = `<div class="notice danger">${ICONS.alert}<div>A proteção global está desativada. Nenhuma requisição será bloqueada.</div></div>`;
  } else if (data.pause?.paused) {
    notice = `<div class="notice">${ICONS.pause}<div>Proteção pausada ${esc(formatRemaining(data.pause.remainingMs))}. As listas continuam instaladas.</div></div>`;
  } else if (site.whitelisted) {
    const detail = whitelist?.mode === 'temporary'
      ? `Permissão temporária por ${esc(formatRemaining(whitelist.remainingMs))}.`
      : 'Permissão permanente neste navegador.';
    notice = `<div class="notice">${ICONS.check}<div><strong>Site permitido</strong>${whitelist?.domain && whitelist.domain !== host ? ` (regra: ${esc(whitelist.domain)})` : ''}. ${detail} Anúncios e rastreadores não são bloqueados aqui.</div></div>`;
  }

  const hosts = topHosts.length
    ? `<div class="top-list">
        <div class="top-head">Principais bloqueios</div>
        ${topHosts.map((item) => `
          <div class="top-item">
            <span class="top-name" title="${esc(item.name)}">${esc(item.name)}</span>
            <span class="top-count">${formatNumber(item.count)}</span>
          </div>`).join('')}
      </div>`
    : '';

  return `
    <section class="site-card">
      <div class="site-row">
        <div class="site-main">
          <div class="site-host" title="${esc(title)}">${esc(title)}</div>
          <div class="site-sub" title="${esc(subtitle)}">${esc(subtitle)}</div>
        </div>
        <button class="btn btn-sm btn-ghost btn-icon" data-action="reload" title="Recarregar esta página" ${state.tabId >= 0 ? '' : 'disabled'}>
          ${ICONS.refresh}<span class="sr-only">Recarregar</span>
        </button>
      </div>
      <div class="site-numbers">
        <div class="num">
          <div class="val">${formatNumber(blocked)}</div>
          <div class="lbl">Bloqueios aqui</div>
        </div>
        <div class="num">
          <div class="val">${formatNumber(cosmetic)}</div>
          <div class="lbl">Elementos ocultos</div>
        </div>
        <div class="num">
          <div class="val">${formatNumber(requests)}</div>
          <div class="lbl">Requisições</div>
        </div>
      </div>
      ${hosts}
      ${notice}
    </section>
  `;
}

function renderTotals(data) {
  const stats = data.stats || {};
  return `
    <div class="totals" role="group" aria-label="Estatísticas gerais">
      <div>
        <div class="lbl">Total</div>
        <div class="val">${formatNumber(stats.totalBlocked)}</div>
      </div>
      <div>
        <div class="lbl">Hoje</div>
        <div class="val">${formatNumber(stats.todayBlocked)}</div>
      </div>
      <div>
        <div class="lbl">Taxa de bloqueio</div>
        <div class="val">${formatPercent(stats.blockRate)}</div>
      </div>
    </div>
  `;
}

function renderActions(data) {
  const enabled = Boolean(data.settings?.enabled);
  const paused = Boolean(data.pause?.paused);
  const site = data.site || {};
  const canAllow = Boolean(site.hostname);
  const whitelisted = Boolean(site.whitelisted);
  const engineLists = data.engine?.lists || {};

  const toggleLabel = enabled ? 'Desativar proteção' : 'Ativar proteção';
  const toggleIcon = enabled ? ICONS.pause : ICONS.zap;

  return `
    <div class="actions">
      <button class="btn ${enabled ? 'btn-danger' : 'btn-primary'} btn-block" data-action="toggle">
        ${toggleIcon}<span>${toggleLabel}</span>
      </button>

      <div class="row">
        <button class="btn" data-action="dashboard">${ICONS.dashboard}<span>Painel</span></button>
        <button class="btn" data-action="update-lists" title="${esc(`${engineLists.enabled || 0} listas ativas`)}">
          ${ICONS.refresh}<span>Atualizar listas</span>
        </button>
      </div>

      <button class="btn ${whitelisted ? 'btn-ghost' : ''}" data-action="allow" ${canAllow ? '' : 'disabled'}>
        ${whitelisted ? ICONS.close : ICONS.check}
        <span>${whitelisted ? 'Remover permissão deste site' : 'Permitir site'}</span>
      </button>

      <div class="pause-row">
        <select class="select" id="pause-duration" aria-label="Duração da pausa" ${paused || !enabled ? 'disabled' : ''}>
          ${pauseOptions()}
        </select>
        <button class="btn ${paused ? 'btn-primary' : ''}" data-action="${paused ? 'resume' : 'pause'}" ${!paused && !enabled ? 'disabled' : ''}>
          ${paused ? ICONS.play : ICONS.pause}<span>${paused ? 'Retomar' : 'Pausar'}</span>
        </button>
      </div>
      ${!enabled ? '<div class="hint">Ative a proteção para usar a pausa temporária.</div>' : ''}
    </div>
  `;
}

function render(data) {
  const lists = data.engine?.lists || {};
  const meta = [
    `${formatNumber(lists.enabled)} de ${formatNumber(lists.total)} listas ativas`,
    data.app?.target === 'firefox' ? 'Firefox · webRequest' : data.app?.target === 'chromium' ? 'Chromium · DNR' : 'Motor local',
  ].join(' · ');
  setHtml(content, `
    ${renderSiteCard(data)}
    ${renderTotals(data)}
    ${renderActions(data)}
    <div class="meta-line">${esc(meta)}</div>
  `);
  if (data.app?.version) versionBox.textContent = `v${data.app.version}`;
}

function renderError(message) {
  setHtml(content, `
    ${errorState(new Error(message || 'Erro desconhecido.'))}
    <div class="actions">
      <button class="btn btn-primary" data-action="retry">${ICONS.refresh}<span>Tentar novamente</span></button>
    </div>
  `);
}

async function currentTabId() {
  const tabs = await queryTabs({ active: true, currentWindow: true });
  const tab = Array.isArray(tabs) ? tabs[0] : null;
  return Number.isInteger(tab?.id) && tab.id >= 0 ? tab.id : -1;
}

async function load({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!silent || !state.data) {
    setHtml(content, '<div class="loading"><span class="spinner"></span>Carregando…</div>');
    statusBox.replaceChildren();
  }
  try {
    state.tabId = await currentTabId();
    state.data = await send('status.get', { tabId: state.tabId });
    state.error = '';
    render(state.data);
    renderHeader();
  } catch (error) {
    state.error = error.message;
    if (!state.data) renderError(error.message);
    setHtml(statusBox, statusBadge('off'));
    if (silent) toast(error.message, 'error');
  } finally {
    state.loading = false;
  }
}

async function refresh() {
  if (state.loading) return;
  await load({ silent: true });
}

async function runAction(button, task) {
  if (state.busy) return;
  state.busy = true;
  setBusy(button, true, 'Processando…');
  try {
    await task();
  } catch (error) {
    toast(error.message || String(error), 'error', 6000);
  } finally {
    state.busy = false;
    setBusy(button, false);
  }
}

function reloadTab() {
  const api = getApi();
  if (state.tabId < 0 || !api?.tabs?.reload) return Promise.reject(new Error('Não foi possível recarregar esta página.'));
  return new Promise((resolve, reject) => {
    try {
      const result = api.tabs.reload(state.tabId, {}, () => {
        const error = api.runtime?.lastError;
        if (error) reject(new Error(error.message || String(error)));
        else resolve();
      });
      if (result && typeof result.then === 'function') result.then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });
}

async function onAction(action, button) {
  const data = state.data;
  if (!data) return;

  if (action === 'dashboard') {
    const url = getApi()?.runtime?.getURL?.('dashboard/dashboard.html');
    if (!url) return toast('Painel indisponível.', 'error');
    await createTab({ url }).catch(() => {});
    window.close();
    return;
  }

  if (action === 'retry') {
    await load();
    return;
  }

  if (action === 'reload') {
    await reloadTab();
    window.close();
    return;
  }

  if (action === 'toggle') {
    await runAction(button, async () => {
      const enabled = !data.settings?.enabled;
      await send('protection.toggle', { enabled });
      await refresh();
      toast(enabled ? 'Proteção ativada.' : 'Proteção desativada. As listas permanecem salvas.', enabled ? 'success' : 'info');
    });
    return;
  }

  if (action === 'allow') {
    const site = data.site || {};
    if (!site.hostname) {
      toast('Este site não pode ser permitido.', 'error');
      return;
    }
    if (site.whitelisted) {
      const entry = data.whitelist || {};
      await runAction(button, async () => {
        await send('whitelist.remove', { id: entry.id || '', domain: entry.domain || site.hostname });
        await refresh();
        toast('Permissão removida. Recarregue a página para bloquear novamente.', 'success');
      });
    } else {
      await runAction(button, async () => {
        await send('whitelist.add', {
          domain: site.hostname,
          mode: 'permanent',
          source: 'popup',
          note: 'Permitido pelo popup',
        });
        await refresh();
        toast('Site permitido. Recarregue a página para aplicar.', 'success');
      });
    }
    return;
  }

  if (action === 'pause') {
    const select = document.getElementById('pause-duration');
    const minutes = Number(select?.value) || 30;
    await runAction(button, async () => {
      await send('protection.pause', { minutes });
      await refresh();
      toast(`Proteção pausada por ${formatRemaining(minutes * 60000)}.`, 'success');
    });
    return;
  }

  if (action === 'resume') {
    await runAction(button, async () => {
      await send('protection.pause', { minutes: 0, until: 0 });
      await refresh();
      toast('Proteção retomada.', 'success');
    });
    return;
  }

  if (action === 'update-lists') {
    await runAction(button, async () => {
      const result = await send('lists.updateAll', { dueOnly: false });
      await refresh();
      if (!result.checked) {
        toast('Nenhuma lista remota configurada para atualizar.', 'info');
        return;
      }
      const parts = [`${result.updated} atualizada(s)`];
      if (result.notModified) parts.push(`${result.notModified} sem alteração`);
      if (result.failed) parts.push(`${result.failed} com falha`);
      toast(`${parts.join(', ')} de ${result.checked} lista(s).`, result.failed ? 'error' : 'success', 6000);
    });
  }
}

content.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || !content.contains(button)) return;
  event.preventDefault();
  onAction(button.dataset.action, button);
});

const scheduleRefresh = debounce(() => {
  if (!state.busy) refresh();
}, 450);

onBackgroundEvent((event) => {
  const scope = String(event?.scope || '');
  if (!scope) return;
  if (/^(settings|whitelist|lists|protection|system|stats):/.test(scope)) {
    scheduleRefresh();
  }
});

// Blocked requests are intentionally not broadcast (high volume), so refresh
// the visible popup while it is open to keep per-site counters current.
const poll = setInterval(() => {
  if (!document.hidden && !state.busy) refresh();
}, 3000);
window.addEventListener('unload', () => clearInterval(poll), { once: true });

load();
