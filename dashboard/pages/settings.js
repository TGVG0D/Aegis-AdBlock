import {
  CATEGORIES,
  CATEGORY_ORDER,
  confirmDialog,
  download,
  esc,
  historyLimitOptions,
  icon,
  loadingState,
  pickJson,
  retentionOptions,
  send,
  setBusy,
  setHtml,
  toast,
  updateIntervalOptions,
} from '../../ui/shared.js';
import { HISTORY_DETAIL_MODES } from '../../engine/constants.js';

function switchRow(id, checked, title, description, extra = '') {
  return `<div class="flex-between" style="padding:7px 0;gap:16px">
    <div><div class="small soft">${esc(title)}</div><div class="tiny muted">${description}</div></div>
    <label class="switch"><input type="checkbox" id="${esc(id)}" ${checked ? 'checked' : ''}><span class="track"></span></label>
  </div>${extra}`;
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let settings = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!settings) setHtml(view, loadingState('Carregando configurações…'));
      try {
        const data = await send('settings.get');
        if (disposed) return;
        settings = data;
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar as configurações.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const history = settings.history || {};
    setHtml(view, `
      <div class="grid grid-main">
        <section class="card">
          <div class="card-head"><div><h2>${icon('shield')}Proteção</h2><p>Controle global de bloqueio e comportamento padrão.</p></div><span class="badge ${settings.enabled ? 'green' : 'red'}">${settings.enabled ? 'Ativa' : 'Desativada'}</span></div>
          ${switchRow('st-enabled', settings.enabled, 'Bloqueio de rede', 'Interrompe anúncios, rastreadores e domínios maliciosos conforme as listas ativas.')}
          <div class="divider"></div>
          ${switchRow('st-cosmetic', settings.cosmeticEnabled, 'Filtros cosméticos', 'Oculta elementos da página com base em seletores CSS validados.')}
          <div class="divider"></div>
          ${switchRow('st-generic', settings.genericCosmetic, 'Seletores genéricos', 'Regras sem domínio são aplicadas com limite por página para evitar danos ao layout.')}
          <div class="divider"></div>
          ${switchRow('st-antiblock', settings.antiBlock, 'Modo anti-detecção', 'Oculta elementos-isca sem usar display:none, reduzindo avisos de “adblock detectado”. Pode alterar o layout de sites que dependem de seletores genéricos.')}
          <div class="divider"></div>
          <div class="field">
            <label>Categorias ativas</label>
            <div class="tiny muted">Listas e regras de categorias desativadas são ignoradas pelo motor.</div>
          </div>
          <div class="mt-10" style="display:grid;gap:2px">
            ${CATEGORY_ORDER.map((id) => switchRow(
              `st-cat-${id}`,
              settings.categories?.[id] !== false,
              CATEGORIES[id].label,
              CATEGORIES[id].description,
            )).join('')}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>${icon('refresh')}Atualizações</h2><p>Frequência das verificações automáticas das listas por URL.</p></div></div>
          ${switchRow('st-autoupdate', settings.autoUpdate, 'Atualização automática', 'Verifica todas as listas por URL no intervalo definido.')}
          <div class="divider"></div>
          <div class="field">
            <label for="st-interval">Intervalo</label>
            <select class="select" id="st-interval">${updateIntervalOptions(settings.updateIntervalHours)}</select>
            <div class="hint">O navegador pode atrasar alarmes enquanto estiver fechado. Listas locais nunca são baixadas.</div>
          </div>
          <div class="divider"></div>
          <div class="field">
            <label for="st-badge">Ícone e contador</label>
          </div>
          ${switchRow('st-badge', settings.showBadge, 'Mostrar contador no ícone', 'Exibe o número de bloqueios da aba nos últimos minutos.')}
          ${switchRow('st-badge-count', settings.badgeShowCount, 'Exibir número em vez de ponto', 'Quando desligado, mostra apenas um indicador de atividade.')}
        </section>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>${icon('history')}Histórico local</h2><p>Registra apenas host e caminho; parâmetros de consulta e credenciais são removidos.</p></div><span class="badge ${history.enabled === false ? 'gray' : 'green'}">${history.enabled === false ? 'Desligado' : 'Ativo'}</span></div>
          ${switchRow('st-history-enabled', history.enabled !== false, 'Registrar bloqueios', 'Cada evento inclui URL sanitizada, tipo, regra, lista e ocorrências.')}
          <div class="divider"></div>
          <div class="form-grid">
            <div class="field"><label for="st-retention">Retenção</label><select class="select" id="st-retention">${retentionOptions(history.retentionDays || 30)}</select></div>
            <div class="field"><label for="st-max">Limite de eventos</label><select class="select" id="st-max">${historyLimitOptions(history.maxEntries || 20000)}</select></div>
            <div class="field"><label for="st-detail">Nível de detalhe</label><select class="select" id="st-detail">${HISTORY_DETAIL_MODES.map((mode) => `<option value="${mode.id}" ${mode.id === history.detail ? 'selected' : ''}>${esc(mode.label)}</option>`).join('')}</select></div>
            <div class="field"><label for="st-stats-retention">Retenção de estatísticas</label><input class="input" id="st-stats-retention" type="number" min="30" max="365" value="${esc(String(settings.statsRetentionDays || 90))}"><div class="hint">Agregados por dia entre 30 e 365 dias.</div></div>
          </div>
          <div class="divider"></div>
          ${switchRow('st-auto-cleanup', history.autoCleanup !== false, 'Limpeza automática', 'Remove eventos expirados na inicialização, nas atualizações e ao abrir o histórico.')}
          <div class="notice mt-16">${icon('info')}<div>O histórico é opcional. Desligá-lo não afeta o bloqueio, apenas deixa de gravar novos eventos. Estatísticas agregadas continuam locais.</div></div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>${icon('download')}Backup e restauração</h2><p>Arquivos JSON gerados no seu dispositivo.</p></div></div>
          <div style="display:grid;gap:8px">
            <button class="btn" id="st-export-settings">${icon('download')}Exportar configurações</button>
            <button class="btn" id="st-import-settings">${icon('upload')}Importar configurações</button>
            <button class="btn" id="st-export-all">${icon('file')}Exportar backup completo</button>
          </div>
          <div class="hint mt-10">O backup completo inclui listas, regras personalizadas, Lista de bloqueio, permissões, estatísticas, metadados e o conteúdo das listas. Ele pode conter dados de navegação agregados; guarde-o com cuidado.</div>
          <div class="divider"></div>
          <div class="small soft mb-10">Manutenção</div>
          <div style="display:grid;gap:8px">
            <button class="btn" id="st-reset-settings">${icon('refresh')}Redefinir configurações</button>
            <button class="btn" id="st-reset-stats">${icon('chart')}Apagar estatísticas</button>
            <button class="btn btn-danger" id="st-clear-history">${icon('trash')}Limpar histórico detalhado</button>
          </div>
          <div class="tiny muted mt-10">Redefinir configurações mantém listas, regras, permissões, histórico e estatísticas.</div>
        </section>
      </div>

      <div class="notice info mt-16">${icon('info')}<div>As preferências são salvas em <code>storage.local</code>. Nenhum dado é enviado para servidores; não há conta, telemetria ou sincronização externa. A extensão só baixa listas quando você instala ou atualiza uma fonte por URL.</div></div>
    `);
    bind();
  }

  function bind() {
    const simpleSwitches = [
      ['st-enabled', 'enabled'],
      ['st-cosmetic', 'cosmeticEnabled'],
      ['st-generic', 'genericCosmetic'],
      ['st-antiblock', 'antiBlock'],
      ['st-autoupdate', 'autoUpdate'],
      ['st-badge', 'showBadge'],
      ['st-badge-count', 'badgeShowCount'],
    ];
    for (const [id, key] of simpleSwitches) {
      view.querySelector(`#${id}`)?.addEventListener('change', async (event) => {
        await save({ [key]: event.target.checked }, 'Configuração salva.');
      });
    }

    for (const id of CATEGORY_ORDER) {
      view.querySelector(`#st-cat-${id}`)?.addEventListener('change', async (event) => {
        await save({ categories: { [id]: event.target.checked } }, 'Categorias atualizadas.');
      });
    }

    view.querySelector('#st-interval')?.addEventListener('change', async (event) => {
      await save({ updateIntervalHours: Number(event.target.value) }, 'Intervalo de atualização salvo.');
    });

    view.querySelector('#st-history-enabled')?.addEventListener('change', async (event) => {
      await save({ history: { enabled: event.target.checked } }, event.target.checked ? 'Histórico ativado.' : 'Novos bloqueios não serão registrados.');
    });
    view.querySelector('#st-retention')?.addEventListener('change', async (event) => {
      await save({ history: { retentionDays: Number(event.target.value) } }, 'Retenção do histórico salva.');
    });
    view.querySelector('#st-max')?.addEventListener('change', async (event) => {
      await save({ history: { maxEntries: Number(event.target.value) } }, 'Limite do histórico salvo.');
    });
    view.querySelector('#st-detail')?.addEventListener('change', async (event) => {
      await save({ history: { detail: event.target.value } }, 'Nível de detalhe salvo.');
    });
    view.querySelector('#st-auto-cleanup')?.addEventListener('change', async (event) => {
      await save({ history: { autoCleanup: event.target.checked } }, 'Limpeza automática atualizada.');
    });
    view.querySelector('#st-stats-retention')?.addEventListener('change', async (event) => {
      const value = Math.max(30, Math.min(365, Number(event.target.value) || 90));
      event.target.value = String(value);
      await save({ statsRetentionDays: value }, 'Retenção de estatísticas salva.');
    });

    view.querySelector('#st-export-settings')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Gerando');
      try {
        const payload = await send('settings.export');
        download(`aegis-configuracoes-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
        toast('Configurações exportadas.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#st-import-settings')?.addEventListener('click', async () => {
      const file = await pickJson();
      if (!file) return;
      let value;
      try {
        value = JSON.parse(file.text);
      } catch (error) {
        toast(`JSON inválido: ${error.message}`, 'error');
        return;
      }
      const confirmed = await confirmDialog({
        title: 'Importar configurações',
        message: 'As preferências atuais serão substituídas pelas do arquivo. Listas, regras personalizadas, permissões e histórico não são alterados.',
        confirmLabel: 'Importar',
      });
      if (!confirmed) return;
      try {
        settings = await send('settings.import', { value });
        toast('Configurações importadas.', 'success');
        await ctx.refreshStatus();
        paint();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    view.querySelector('#st-export-all')?.addEventListener('click', async (event) => {
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

    view.querySelector('#st-reset-settings')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Redefinir configurações',
        message: 'Todas as preferências voltarão aos valores padrão. Listas, regras, permissões, histórico e estatísticas serão mantidos.',
        confirmLabel: 'Redefinir',
        danger: true,
      });
      if (!confirmed) return;
      try {
        settings = await send('settings.reset');
        await ctx.refreshStatus();
        toast('Configurações redefinidas.', 'success');
        paint();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    view.querySelector('#st-reset-stats')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Apagar estatísticas',
        message: 'Contadores totais, séries diárias e ranking de sites serão zerados. O histórico detalhado não é afetado.',
        confirmLabel: 'Apagar estatísticas',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('stats.reset');
        toast('Estatísticas apagadas.', 'success');
        await ctx.refreshStatus();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    view.querySelector('#st-clear-history')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Limpar histórico detalhado',
        message: 'Todos os eventos de bloqueio serão apagados permanentemente. As estatísticas agregadas permanecem.',
        confirmLabel: 'Limpar histórico',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('history.clear');
        toast('Histórico apagado.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function save(patch, message) {
    try {
      settings = await send('settings.update', { patch });
      ctx.state.status = { ...(ctx.state.status || {}), settings };
      toast(message, 'success');
      await load();
    } catch (error) {
      toast(error.message, 'error');
      await load();
    }
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(settings|system|protection)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 300);
    }
  };
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    window.removeEventListener('aegis:event', onEvent);
  };
}
