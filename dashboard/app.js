import { ICONS, esc, icon, onBackgroundEvent, qs, send, setHtml, statusBadge, toast } from '../ui/shared.js';
import { render as renderOverview } from './pages/overview.js';
import { render as renderStatistics } from './pages/statistics.js';
import { render as renderLists } from './pages/lists.js';
import { render as renderRules } from './pages/rules.js';
import { render as renderBlockList } from './pages/blocklist.js';
import { render as renderWhitelist } from './pages/whitelist.js';
import { render as renderHistory } from './pages/history.js';
import { render as renderCosmetics } from './pages/cosmetics.js';
import { render as renderSettings } from './pages/settings.js';
import { render as renderAbout } from './pages/about.js';

const ROUTES = {
  overview: { title: 'Visão geral', crumb: 'Resumo da proteção em tempo real', render: renderOverview },
  statistics: { title: 'Estatísticas', crumb: 'Dados reais armazenados localmente', render: renderStatistics },
  lists: { title: 'Listas de filtros', crumb: 'Fontes de regras e atualizações', render: renderLists },
  rules: { title: 'Regras personalizadas', crumb: 'Sua lista negra e regras manuais', render: renderRules },
  blocklist: { title: 'Lista de bloqueio', crumb: 'Sites bloqueados ou redirecionados por você', render: renderBlockList },
  whitelist: { title: 'Sites permitidos', crumb: 'Exceções permanentes e temporárias', render: renderWhitelist },
  cosmetics: { title: 'Filtros cosméticos', crumb: 'Ocultação de elementos e seletores', render: renderCosmetics },
  history: { title: 'Histórico', crumb: 'Registros locais de requisições bloqueadas', render: renderHistory },
  settings: { title: 'Configurações', crumb: 'Preferências da extensão', render: renderSettings },
  about: { title: 'Sobre e diagnóstico', crumb: 'Versão, motor e limitações', render: renderAbout },
};

const state = {
  status: null,
  route: 'overview',
  loading: false,
};

let cleanupPage = null;
let renderToken = 0;

const ctx = {
  state,
  send,
  toast,
  refreshStatus,
  getStatus: () => state.status,
  navigate,
};

function currentRoute() {
  const value = location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
  return ROUTES[value] ? value : 'overview';
}

export function navigate(route) {
  location.hash = `#/${route}`;
}

function decorateStaticIcons() {
  setHtml(qs('#brand-mark'), ICONS.shield);
  setHtml(qs('#menu-btn'), ICONS.menu);
  for (const element of document.querySelectorAll('.nav-icon[data-icon]')) {
    setHtml(element, ICONS[element.dataset.icon] || ICONS.info);
  }
}

function protectionKind() {
  if (!state.status?.settings?.enabled) return 'off';
  if (state.status?.paused) return 'paused';
  return 'on';
}

function updateChrome() {
  const status = state.status;
  const pill = qs('#protection-pill');
  const toggle = qs('#btn-protection-toggle');
  const sidebar = qs('#sidebar-status');
  const kind = protectionKind();
  if (pill) setHtml(pill, statusBadge(kind === 'on' ? 'on' : kind));
  if (toggle) {
    toggle.textContent = kind === 'off' ? 'Ativar proteção' : 'Desativar';
    toggle.classList.toggle('btn-danger', kind !== 'off');
    toggle.classList.toggle('btn-primary', kind === 'off');
  }
  if (sidebar) {
    const dotClass = kind === 'on' ? '' : kind === 'paused' ? ' paused' : ' off';
    const label = kind === 'on' ? 'Proteção ativa' : kind === 'paused' ? 'Pausado temporariamente' : 'Proteção desativada';
    const dnr = status?.engine?.dnr;
    const backend = dnr
      ? dnr.supported
        ? `DNR: ${dnr.applied} regras`
        : 'Bloqueio nativo'
      : 'Carregando…';
    sidebar.replaceChildren();
    const dotRow = document.createElement('div');
    const dot = document.createElement('span');
    dot.className = `dot${dotClass}`;
    dotRow.appendChild(dot);
    const labelEl = document.createElement('strong');
    labelEl.textContent = esc(label);
    dotRow.appendChild(labelEl);
    sidebar.appendChild(dotRow);
    const meta = document.createElement('div');
    meta.style.marginTop = '4px';
    meta.textContent = `${esc(backend)} · v${esc(status?.app?.version || '1.0.1')}`;
    sidebar.appendChild(meta);
  }
  if (status?.pause?.paused) {
    const minutes = Math.ceil(status.pause.remainingMs / 60000);
    if (pill) pill.title = `Pausado por mais ${minutes} min`;
  }
}

async function refreshStatus() {
  try {
    state.status = await send('status.get');
    updateChrome();
    return state.status;
  } catch (error) {
    console.warn('[Aegis] status indisponível', error);
    return null;
  }
}

function updateNav(route) {
  for (const link of document.querySelectorAll('.nav-link')) {
    link.classList.toggle('active', link.dataset.route === route);
  }
  const config = ROUTES[route];
  qs('#page-title').textContent = config.title;
  qs('#page-crumb').textContent = config.crumb;
}

async function renderRoute() {
  const route = currentRoute();
  const config = ROUTES[route];
  const token = ++renderToken;
  closeMenu();
  if (cleanupPage) {
    try {
      cleanupPage();
    } catch {
      // ignore cleanup failures
    }
    cleanupPage = null;
  }
  state.route = route;
  updateNav(route);
  const view = qs('#view');
  setHtml(view, '<div class="loading"><span class="spinner"></span>Carregando…</div>');
  try {
    await refreshStatus();
    if (token !== renderToken) return;
    const cleanup = await config.render(view, ctx);
    if (token !== renderToken) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    cleanupPage = typeof cleanup === 'function' ? cleanup : null;
  } catch (error) {
    console.error('[Aegis] página falhou', route, error);
    if (token === renderToken) {
      view.replaceChildren();
    const notice = document.createElement('div');
    notice.className = 'notice danger';
    view.appendChild(notice);
    const alertIcon = document.createElement('span');
    alertIcon.className = 'icon';
    alertIcon.setAttribute('aria-hidden', 'true');
    alertIcon.textContent = ICONS.alert;
    notice.appendChild(alertIcon);
    const innerDiv = document.createElement('div');
    notice.appendChild(innerDiv);
    const strong = document.createElement('strong');
    strong.textContent = 'Não foi possível abrir esta página.';
    innerDiv.appendChild(strong);
    const msgDiv = document.createElement('div');
    msgDiv.textContent = esc(error.message);
    innerDiv.appendChild(msgDiv);
    }
  }
}

function openMenu() {
  qs('#sidebar').classList.add('open');
  qs('#mobile-overlay').classList.add('show');
}

function closeMenu() {
  qs('#sidebar').classList.remove('open');
  qs('#mobile-overlay').classList.remove('show');
}

async function toggleProtection() {
  const enabled = protectionKind() === 'off';
  const button = qs('#btn-protection-toggle');
  button.disabled = true;
  try {
    await send('protection.toggle', { enabled });
    toast(enabled ? 'Proteção ativada.' : 'Proteção desativada. A navegação não será filtrada.', 'success');
    await refreshStatus();
    window.dispatchEvent(new CustomEvent('aegis:event', { detail: { scope: 'settings:changed' } }));
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function updateAllLists() {
  const button = qs('#btn-update-all');
  const original = button.textContent;
  button.disabled = true;
  setHtml(button, '<span class="spinner"></span>Atualizando');
  try {
    const result = await send('lists.updateAll', { dueOnly: false });
    const summary = `${result.updated} atualizada(s), ${result.notModified} sem mudanças, ${result.failed} falha(s).`;
    toast(summary, result.failed ? 'error' : 'success');
    window.dispatchEvent(new CustomEvent('aegis:event', { detail: { scope: 'lists:changed', result } }));
    await refreshStatus();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function bindChrome() {
  qs('#btn-protection-toggle').addEventListener('click', toggleProtection);
  qs('#btn-update-all').addEventListener('click', updateAllLists);
  qs('#menu-btn').addEventListener('click', openMenu);
  qs('#mobile-overlay').addEventListener('click', closeMenu);
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });
  window.addEventListener('hashchange', renderRoute);
  qs('#view').addEventListener('click', (event) => {
    const target = event.target.closest('[data-navigate]');
    if (target) {
      event.preventDefault();
      navigate(target.dataset.navigate);
    }
  });
  onBackgroundEvent(async (event) => {
    await refreshStatus();
    window.dispatchEvent(new CustomEvent('aegis:event', { detail: event }));
  });
  setInterval(refreshStatus, 30000);
}

decorateStaticIcons();
bindChrome();
if (!location.hash) location.hash = '#/overview';
renderRoute();
