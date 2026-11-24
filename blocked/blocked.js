import {
  ICONS,
  esc,
  formatDateTime,
  formatRemaining,
  icon,
  send,
  setBusy,
  setHtml,
  toast,
} from '../ui/shared.js';
import { getUrl } from '../utils/browser.js';

const params = new URLSearchParams(location.search);
const entryParam = params.get('entry') || '';
const urlParam = params.get('url') || '';
const dashboardUrl = getUrl('dashboard/dashboard.html#/blocklist');

const card = document.getElementById('blocked-card');
const mark = document.getElementById('blocked-mark');
const dashboardLink = document.getElementById('blocked-dashboard');

if (mark) setHtml(mark, ICONS.shield);
if (dashboardLink) dashboardLink.href = dashboardUrl;

let info = null;
let busy = false;

function parseHostname(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function displayUrl(raw) {
  const value = String(raw || '');
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return value.slice(0, 300);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 300);
  } catch {
    return value.slice(0, 300);
  }
}

function fallbackInfo(error = null) {
  const hostname = parseHostname(urlParam);
  return {
    found: Boolean(entryParam || urlParam),
    error: error?.message || '',
    url: urlParam,
    hostname,
    domain: hostname,
    entryId: entryParam,
    entry: null,
    rule: '',
    listName: 'Lista de bloqueio',
    blockedAt: 0,
    active: true,
    bypass: null,
  };
}

async function load() {
  try {
    info = await send('blockpage.context', {
      entryId: entryParam,
      url: urlParam,
    });
  } catch (error) {
    info = fallbackInfo(error);
  }
  render();
}

function stateBox(kind, title, text, iconName = 'info') {
  return `<div class="blocked-state ${kind}">${icon(iconName)}<div><strong>${esc(title)}</strong><div>${esc(text)}</div></div></div>`;
}

function actionButtons({ proceed = true, unblock = true } = {}) {
  return `
    <div class="blocked-actions">
      ${proceed ? `<button class="btn btn-warn btn-primary" id="bp-proceed">${icon('pause')}Prosseguir por 5 minutos</button>` : ''}
      ${unblock ? `<button class="btn" id="bp-unblock">${icon('check')}Desbloquear este site</button>` : ''}
      <button class="btn btn-ghost" id="bp-back">Voltar</button>
    </div>
  `;
}

function render() {
  if (!card) return;

  if (!info?.found) {
    setHtml(card, `
      <div class="blocked-icon">${ICONS.alert}</div>
      <div class="blocked-kicker">Página de bloqueio</div>
      <h1 class="blocked-title">Não foi possível identificar a regra</h1>
      <p class="blocked-lead">A página de bloqueio abriu sem os detalhes da navegação. Volte e tente novamente, ou gerencie a lista manualmente no painel.</p>
      ${info?.error ? stateBox('danger', 'Detalhe técnico', info.error, 'alert') : ''}
      <div class="blocked-actions">
        <button class="btn btn-ghost" id="bp-back">Voltar</button>
        <a class="btn btn-primary" href="${esc(dashboardUrl)}">Abrir lista de bloqueio</a>
      </div>
    `);
    bind();
    return;
  }

  const domain = info.domain || info.hostname || 'este site';
  const rule = info.rule || '—';
  const targetUrl = displayUrl(info.url);
  const bypass = info.bypass;
  const entry = info.entry;
  const redirectAction = entry?.action === 'redirect';

  if (bypass) {
    setHtml(card, `
      <div class="blocked-icon" style="color:#ffe6a3;background:rgba(251,191,36,.1);border-color:rgba(251,191,36,.3)">${ICONS.pause}</div>
      <div class="blocked-kicker" style="color:#ffd976">Liberação temporária ativa</div>
      <h1 class="blocked-title">${esc(domain)} está liberado por mais ${esc(formatRemaining(bypass.remainingMs))}</h1>
      <p class="blocked-lead">Você escolheu prosseguir com risco. O bloqueio de anúncios e rastreadores continua ativo; apenas a regra da Lista de bloqueio foi suspensa para este domínio.</p>
      <div class="blocked-rule">
        <div class="blocked-rule-label">Regra suspensa temporariamente</div>
        <code>${esc(rule)}</code>
        <div class="blocked-rule-meta">${esc(info.listName || 'Lista de bloqueio')} · até ${esc(formatDateTime(bypass.expiresAt))}</div>
      </div>
      <div class="blocked-actions">
        <button class="btn btn-primary" id="bp-continue">${icon('play')}Continuar para o site</button>
        <button class="btn btn-ghost" id="bp-back">Voltar</button>
      </div>
    `);
    bind();
    return;
  }

  if (entry && entry.enabled === false) {
    setHtml(card, `
      <div class="blocked-icon" style="color:#7df0c5;background:rgba(52,211,153,.1);border-color:rgba(52,211,153,.28)">${ICONS.check}</div>
      <div class="blocked-kicker" style="color:#7df0c5">Regra desativada</div>
      <h1 class="blocked-title">${esc(domain)} não está mais bloqueado</h1>
      <p class="blocked-lead">A regra responsável foi desativada no painel. Você pode continuar para o site; as listas de anúncios continuam sendo aplicadas normalmente.</p>
      <div class="blocked-rule">
        <div class="blocked-rule-label">Regra desativada</div>
        <code>${esc(rule)}</code>
        <div class="blocked-rule-meta">${esc(info.listName || 'Lista de bloqueio')}</div>
      </div>
      <div class="blocked-actions">
        <button class="btn btn-primary" id="bp-continue">${icon('play')}Continuar para o site</button>
        <button class="btn btn-ghost" id="bp-back">Voltar</button>
      </div>
    `);
    bind();
    return;
  }

  setHtml(card, `
    <div class="blocked-icon">${ICONS.ban || ICONS.shield}</div>
    <div class="blocked-kicker">${redirectAction ? 'Redirecionamento não aplicado' : 'Página bloqueada por você'}</div>
    <h1 class="blocked-title">${redirectAction ? 'O destino configurado não pôde ser aberto' : 'Esta página está na sua Lista de bloqueio'}</h1>
    <p class="blocked-lead">${redirectAction
      ? 'A regra desta lista foi acionada, mas o redirecionamento escolhido não pôde ser usado. Você pode desbloquear o site, prosseguir com risco ou voltar.'
      : 'O Aegis impediu o carregamento antes de o site abrir. A decisão abaixo vale apenas para este domínio e fica registrada somente neste dispositivo.'}</p>
    <div class="blocked-domain">${icon('ban')}${esc(domain)}</div>

    <div class="blocked-rule">
      <div class="blocked-rule-label">Regra responsável</div>
      <code>${esc(rule)}</code>
      <div class="blocked-rule-meta">${esc(info.listName || 'Lista de bloqueio')}${targetUrl ? ` · ${esc(targetUrl)}` : ''}</div>
    </div>

    <dl class="blocked-grid">
      <div><dt>Ação configurada</dt><dd>${redirectAction ? `Redirecionar para ${esc(entry?.redirectUrl || 'destino removido')}` : 'Mostrar esta página de bloqueio'}</dd></div>
      <div><dt>Alcance</dt><dd>${esc(domain)} e todos os subdomínios</dd></div>
      <div><dt>Prioridade</dt><dd>Acima do whitelist e das listas de anúncios</dd></div>
      <div><dt>Bloqueado em</dt><dd>${info.blockedAt ? esc(formatDateTime(info.blockedAt)) : 'agora'}</dd></div>
    </dl>

    ${actionButtons()}

    <div class="blocked-risk"><strong>Prosseguir com risco:</strong> libera ${esc(domain)} por 5 minutos. Páginas, scripts e conteúdos desse domínio podem carregar; o bloqueio de anúncios e rastreadores continua ativo. Ao final do prazo, a regra volta a valer automaticamente.</div>
  `);
  bind();
}

function navigate(url) {
  if (!url) {
    toast('O endereço original não está disponível. Use o painel para ajustar a regra.', 'error');
    return;
  }
  location.replace(url);
}

async function run(button, label, task) {
  if (busy) return;
  busy = true;
  setBusy(button, true, label);
  try {
    await task();
  } catch (error) {
    toast(error.message || String(error), 'error', 6500);
  } finally {
    busy = false;
    setBusy(button, false);
  }
}

function bind() {
  card.querySelector('#bp-proceed')?.addEventListener('click', (event) => {
    run(event.currentTarget, 'Liberando', async () => {
      const result = await send('blockpage.proceed', { entryId: info.entryId });
      toast('Domínio liberado por 5 minutos. Abrindo o site…', 'success');
      setTimeout(() => navigate(result.url), 300);
    });
  });

  card.querySelector('#bp-unblock')?.addEventListener('click', (event) => {
    run(event.currentTarget, 'Desbloqueando', async () => {
      const result = await send('blockpage.unblock', { entryId: info.entryId });
      toast('Regra desativada. Abrindo o site…', 'success');
      setTimeout(() => navigate(result.url), 300);
    });
  });

  card.querySelector('#bp-continue')?.addEventListener('click', () => navigate(info.url));

  card.querySelector('#bp-back')?.addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.replace(dashboardUrl);
  });
}

load();
