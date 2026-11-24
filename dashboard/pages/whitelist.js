import {
  confirmDialog,
  emptyState,
  esc,
  formatDateTime,
  formatRelative,
  formatRemaining,
  icon,
  loadingState,
  send,
  setBusy,
  setHtml,
  tempDurationOptions,
  toast,
} from '../../ui/shared.js';

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let entries = [];

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!entries.length) setHtml(view, loadingState('Carregando permissões…'));
      try {
        const data = await send('whitelist.get');
        if (disposed) return;
        entries = data;
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar a lista de permissões.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const active = entries.filter((entry) => entry.active);
    const expired = entries.filter((entry) => !entry.active);
    const temporary = active.filter((entry) => entry.mode === 'temporary');

    setHtml(view, `
      <div class="grid grid-4">
        <div class="card kpi"><div class="kpi-label">${icon('check')}Permissões ativas</div><div class="kpi-value">${esc(String(active.length))}</div><div class="kpi-sub">domínios sem filtragem</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('shield')}Permanentes</div><div class="kpi-value">${esc(String(active.filter((entry) => entry.mode === 'permanent').length))}</div><div class="kpi-sub">não expiram</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('pause')}Temporárias</div><div class="kpi-value">${esc(String(temporary.length))}</div><div class="kpi-sub">expiram automaticamente</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('history')}Expiradas</div><div class="kpi-value">${esc(String(expired.length))}</div><div class="kpi-sub">aguardando limpeza</div></div>
      </div>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Permitir um site</h2><p>A filtragem de rede e cosmética é suspensa para o domínio e seus subdomínios.</p></div></div>
        <div class="inline-form">
          <div class="field" style="flex:2;min-width:220px"><label for="wl-domain">Site, domínio ou URL</label><input class="input" id="wl-domain" placeholder="https://exemplo.com/pagina ou exemplo.com" spellcheck="false"></div>
          <div class="field"><label for="wl-mode">Duração</label><select class="select" id="wl-mode"><option value="permanent">Permanente</option><option value="temporary">Temporária</option></select></div>
          <div class="field" id="wl-duration-wrap" hidden><label for="wl-duration">Tempo</label><select class="select" id="wl-duration">${tempDurationOptions('1h')}</select></div>
          <div class="field"><label for="wl-note">Nota (opcional)</label><input class="input" id="wl-note" maxlength="300" placeholder="Motivo"></div>
          <button class="btn btn-primary" id="wl-add">${icon('plus')}Adicionar</button>
        </div>
        <div class="hint mt-6">Uma URL é convertida com segurança para o hostname e vale para ele e seus subdomínios. Endereços locais podem ser adicionados manualmente, mas só afetam requisições HTTP(S) desse host.</div>
        <div class="notice info mt-10">${icon('info')}<div>Para permitir somente uma URL ou recurso específico, use uma regra de exceção <code>@@</code> em <strong>Regras personalizadas</strong>; por exemplo, <code>@@||exemplo.com/caminho$document</code>. Isso não executa código: apenas cria uma exceção de filtragem.</div><button class="btn btn-sm" id="wl-open-rules">Abrir regras</button></div>
      </section>

      <section class="card mt-16">
        <div class="card-head">
          <div><h2>Lista de permissões</h2><p>${esc(String(active.length))} ativa(s) de ${esc(String(entries.length))} registro(s).</p></div>
          <div class="card-actions">
            <button class="btn btn-sm" id="wl-cleanup" ${expired.length ? '' : 'disabled'}>${icon('trash')}Limpar expiradas</button>
            <button class="btn btn-sm btn-danger" id="wl-clear" ${entries.length ? '' : 'disabled'}>Remover todas</button>
          </div>
        </div>
        ${entries.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Domínio</th><th>Modo</th><th>Estado</th><th>Expira</th><th>Nota</th><th>Origem</th><th>Criada</th><th></th></tr></thead>
            <tbody>${entries.map(renderEntry).join('')}</tbody>
          </table></div>` : emptyState('Nenhum site permitido', 'Adicione um domínio acima ou use o popup enquanto navega.', 'check')}
      </section>

      <div class="notice info mt-16">${icon('info')}<div>Permitir um site remove o bloqueio de rede e a ocultação cosmética nele. Estatísticas continuam contando apenas requisições observadas, nunca o conteúdo das páginas. A limpeza automática remove permissões expiradas na inicialização e nas atualizações.</div></div>
    `);
    bind();
  }

  function renderEntry(entry) {
    const isActive = entry.expiresAt ? entry.expiresAt > Date.now() : true;
    return `<tr>
      <td class="cell-main">${esc(entry.domain)}</td>
      <td>${entry.mode === 'temporary' ? '<span class="badge amber">Temporária</span>' : '<span class="badge gray">Permanente</span>'}</td>
      <td>${isActive ? '<span class="badge green"><span class="dot"></span>Ativa</span>' : '<span class="badge red">Expirada</span>'}</td>
      <td class="nowrap">${entry.expiresAt ? `${esc(formatDateTime(entry.expiresAt))}<div class="tiny muted">${esc(formatRemaining(entry.expiresAt - Date.now()))}</div>` : '—'}</td>
      <td class="truncate" style="max-width:200px">${esc(entry.note || '—')}</td>
      <td>${entry.source === 'popup' ? 'Popup' : 'Painel'}</td>
      <td class="nowrap muted">${esc(formatRelative(entry.createdAt))}</td>
      <td><div class="td-actions"><button class="btn btn-sm btn-danger" data-wl-remove="${esc(entry.id)}" title="Remover permissão">${icon('trash')}</button></div></td>
    </tr>`;
  }

  function bind() {
    const mode = view.querySelector('#wl-mode');
    const durationWrap = view.querySelector('#wl-duration-wrap');
    mode?.addEventListener('change', () => {
      durationWrap.hidden = mode.value !== 'temporary';
    });

    const submit = async () => {
      const domainInput = view.querySelector('#wl-domain');
      const domain = domainInput?.value.trim();
      if (!domain) {
        toast('Informe um domínio.', 'error');
        domainInput?.focus();
        return;
      }
      const button = view.querySelector('#wl-add');
      setBusy(button, true, 'Adicionando');
      try {
        await send('whitelist.add', {
          domain,
          mode: mode.value,
          durationId: view.querySelector('#wl-duration')?.value || '1h',
          note: view.querySelector('#wl-note')?.value.trim() || '',
          source: 'dashboard',
        });
        toast('Site permitido.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(button, false);
      }
    };
    view.querySelector('#wl-add')?.addEventListener('click', submit);
    view.querySelector('#wl-open-rules')?.addEventListener('click', () => {
      window.location.hash = '#/rules';
    });
    view.querySelector('#wl-domain')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });

    view.querySelectorAll('[data-wl-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await send('whitelist.remove', { id: button.dataset.wlRemove });
          toast('Permissão removida.', 'success');
          await load();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    });

    view.querySelector('#wl-cleanup')?.addEventListener('click', async (event) => {
      setBusy(event.currentTarget, true, 'Limpando');
      try {
        const result = await send('whitelist.cleanup');
        toast(result.removed ? `${result.removed} permissão(ões) expirada(s) removida(s).` : 'Nenhuma permissão expirada.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#wl-clear')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Remover todas as permissões',
        message: 'Todos os sites voltarão a ser filtrados. A lista de permissões não pode ser desfeita.',
        confirmLabel: 'Remover todas',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('whitelist.clear');
        toast('Lista de permissões esvaziada.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(whitelist|settings|system)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 250);
    }
  };
  const timer = setInterval(() => {
    if (!disposed && document.visibilityState === 'visible' && entries.some((entry) => entry.expiresAt)) load();
  }, 60000);
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('aegis:event', onEvent);
  };
}
