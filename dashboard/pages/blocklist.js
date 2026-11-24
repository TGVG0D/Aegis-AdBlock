import {
  confirmDialog,
  emptyState,
  esc,
  formatRelative,
  formatRemaining,
  icon,
  loadingState,
  modal,
  send,
  setBusy,
  setHtml,
  toast,
} from '../../ui/shared.js';

function actionLabel(entry) {
  return entry.action === 'redirect' ? 'Redirecionar' : 'Bloquear página';
}

function actionBadge(entry) {
  return entry.action === 'redirect'
    ? '<span class="badge cyan"><span class="dot"></span>Redireciona</span>'
    : '<span class="badge red"><span class="dot"></span>Bloqueia</span>';
}

function destinationLabel(entry) {
  if (entry.action !== 'redirect') return 'Página de bloqueio do Aegis';
  return entry.redirectUrl || 'destino inválido — usa a página de bloqueio';
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let entries = [];

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!entries.length) setHtml(view, loadingState('Carregando lista de bloqueio…'));
      try {
        const data = await send('blocklist.get');
        if (disposed) return;
        entries = data;
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar a lista de bloqueio.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const active = entries.filter((entry) => entry.enabled);
    const redirects = active.filter((entry) => entry.action === 'redirect');
    const bypassed = active.filter((entry) => entry.bypass);

    setHtml(view, `
      <div class="toolbar">
        <button class="btn btn-primary" id="bl-add">${icon('plus')}Adicionar site</button>
        <span class="spacer"></span>
        <button class="btn btn-danger" id="bl-clear" ${entries.length ? '' : 'disabled'}>${icon('trash')}Limpar lista</button>
      </div>

      <div class="grid grid-4">
        <div class="card kpi"><div class="kpi-label">${icon('ban')}Sites na lista</div><div class="kpi-value">${esc(String(entries.length))}</div><div class="kpi-sub">${esc(String(active.length))} ativo(s)</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('shield')}Bloqueiam a página</div><div class="kpi-value">${esc(String(active.filter((entry) => entry.action === 'block').length))}</div><div class="kpi-sub">mostram o aviso do Aegis</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('external')}Redirecionam</div><div class="kpi-value">${esc(String(redirects.length))}</div><div class="kpi-sub">para um destino escolhido</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('pause')}Liberados agora</div><div class="kpi-value">${esc(String(bypassed.length))}</div><div class="kpi-sub">por 5 minutos ao prosseguir</div></div>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>Testar um site</h2><p>Verifica se uma URL seria bloqueada ou redirecionada pela sua lista.</p></div></div>
          <div class="inline-form">
            <div class="field" style="flex:2;min-width:240px"><label for="bl-test-url">URL ou domínio</label><input class="input" id="bl-test-url" placeholder="https://exemplo.com/pagina" spellcheck="false"></div>
            <button class="btn btn-primary" id="bl-test">${icon('search')}Testar</button>
          </div>
          <div id="bl-test-result" class="mt-16"></div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Como funciona</h2><p>Sua lista tem prioridade sobre o whitelist e sobre as listas de anúncios.</p></div></div>
          <div class="help-card">
            <ul>
              <li><strong>Bloquear página:</strong> mostra uma página do Aegis com a regra responsável, opção de desbloquear, prosseguir por 5 minutos ou voltar.</li>
              <li><strong>Redirecionar:</strong> envia o site para uma URL HTTP(S) escolhida por você. O destino não pode estar coberto por outra regra da lista.</li>
              <li>O domínio vale para ele e todos os subdomínios. A regra criada é sempre <code>||domínio^$document</code>.</li>
              <li>Desativar a proteção global ou pausar também suspende esta lista. O whitelist não a substitui.</li>
            </ul>
          </div>
        </section>
      </div>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Lista de bloqueio</h2><p>Sites avaliados antes das listas de anúncios e do whitelist.</p></div><span class="badge gray">${esc(String(entries.length))} site(s)</span></div>
        ${entries.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Ativa</th><th>Site</th><th>Ação</th><th>Destino</th><th>Estado</th><th>Nota</th><th>Atualizada</th><th></th></tr></thead>
            <tbody>${entries.map(renderEntry).join('')}</tbody>
          </table></div>` : emptyState('Nenhum site na lista de bloqueio', 'Adicione um site para bloquear a página ou redirecioná-lo para outro endereço.', 'ban')}
      </section>

      <div class="notice info mt-16">${icon('info')}<div>Prosseguir libera o domínio por 5 minutos sem desativar o bloqueio de anúncios e rastreadores. Desbloquear desativa a regra correspondente, mas mantém o registro para reativar depois. Tudo fica somente neste dispositivo.</div></div>
    `);
    bind();
  }

  function renderEntry(entry) {
    const bypass = entry.bypass;
    return `<tr>
      <td><label class="switch"><input type="checkbox" data-bl-toggle="${esc(entry.id)}" ${entry.enabled ? 'checked' : ''}><span class="track"></span></label></td>
      <td class="cell-main" style="max-width:220px">
        <div>${esc(entry.domain)}</div>
        <div class="tiny muted" style="margin-top:3px"><span class="rule-code">${esc(entry.rule)}</span></div>
      </td>
      <td>${actionBadge(entry)}</td>
      <td class="truncate" style="max-width:260px" title="${esc(destinationLabel(entry))}">${esc(destinationLabel(entry))}</td>
      <td>
        ${entry.enabled ? '<span class="badge green"><span class="dot"></span>Ativa</span>' : '<span class="badge gray">Desativada</span>'}
        ${bypass ? `<div class="tiny" style="color:var(--amber);margin-top:5px">liberado por ${esc(formatRemaining(bypass.remainingMs))}</div>` : ''}
      </td>
      <td class="truncate" style="max-width:170px">${esc(entry.note || '—')}</td>
      <td class="nowrap muted">${esc(formatRelative(entry.updatedAt))}</td>
      <td><div class="td-actions">
        ${bypass ? `<button class="btn btn-sm" data-bl-end-bypass="${esc(entry.domain)}" title="Encerrar liberação temporária">${icon('pause')}</button>` : ''}
        <button class="btn btn-sm" data-bl-edit="${esc(entry.id)}">Editar</button>
        <button class="btn btn-sm btn-danger" data-bl-delete="${esc(entry.id)}" title="Remover site">${icon('trash')}</button>
      </div></td>
    </tr>`;
  }

  function bind() {
    view.querySelector('#bl-add')?.addEventListener('click', () => openEntryModal());

    view.querySelectorAll('[data-bl-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = entries.find((item) => item.id === button.dataset.blEdit);
        if (entry) openEntryModal(entry);
      });
    });

    view.querySelectorAll('[data-bl-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteEntry(button.dataset.blDelete));
    });

    view.querySelectorAll('[data-bl-toggle]').forEach((input) => {
      input.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await send('blocklist.toggle', { id: input.dataset.blToggle, enabled: input.checked });
          await load();
        } catch (error) {
          toast(error.message, 'error');
          input.checked = !input.checked;
        } finally {
          input.disabled = false;
        }
      });
    });

    view.querySelectorAll('[data-bl-end-bypass]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await send('blocklist.clearBypass', { domain: button.dataset.blEndBypass });
          toast('Liberação temporária encerrada.', 'success');
          await load();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    });

    view.querySelector('#bl-test')?.addEventListener('click', async (event) => {
      const input = view.querySelector('#bl-test-url');
      const target = input?.value.trim();
      const resultBox = view.querySelector('#bl-test-result');
      if (!target) {
        toast('Informe uma URL ou domínio para testar.', 'error');
        input?.focus();
        return;
      }
      setBusy(event.currentTarget, true, 'Testando');
      try {
        const result = await send('blocklist.test', { url: target });
        if (result.matched) {
          const entry = result.entry || {};
          const bypass = result.bypassed
            ? `<div class="notice mt-10">${icon('pause')}<div>Este domínio está liberado temporariamente por ${esc(formatRemaining(result.bypass?.remainingMs || 0))}. O bloqueio de anúncios continua ativo.</div></div>`
            : '';
          setHtml(resultBox, `
            <div class="result-box ${result.bypassed ? 'allowed' : 'blocked'}">
              <div class="result-title">${icon(result.bypassed ? 'pause' : 'ban')}${result.bypassed ? 'Liberado temporariamente' : (entry.action === 'redirect' ? 'Será redirecionado' : 'Será bloqueado')}</div>
              <div class="small mt-6">Domínio correspondente: <strong>${esc(result.hostname)}</strong></div>
              <div class="mt-10"><div class="tiny muted">Regra responsável</div><span class="rule-code">${esc(result.rule)}</span></div>
              <div class="tiny muted mt-6">${entry.action === 'redirect' ? `Destino: ${esc(result.redirectUrl || '—')}` : 'Ação: mostrar a página de bloqueio do Aegis.'}</div>
              ${bypass}
            </div>`);
        } else {
          setHtml(resultBox, `<div class="result-box allowed"><div class="result-title">${icon('check')}Não corresponde à lista</div><div class="small mt-6">${esc(result.hostname || target)} não seria bloqueado nem redirecionado pela sua lista de bloqueio.</div></div>`);
        }
      } catch (error) {
        setHtml(resultBox, `<div class="notice danger">${icon('alert')}<div>${esc(error.message)}</div></div>`);
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#bl-test-url')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') view.querySelector('#bl-test')?.click();
    });

    view.querySelector('#bl-clear')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Limpar lista de bloqueio',
        message: 'Todos os sites bloqueados ou redirecionados por você serão removidos. As listas de anúncios não serão alteradas.',
        confirmLabel: 'Limpar lista',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('blocklist.clear');
        toast('Lista de bloqueio esvaziada.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  async function deleteEntry(id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    const confirmed = await confirmDialog({
      title: 'Remover site da lista',
      message: `${entry.domain} voltará a abrir normalmente (sujeito às listas de anúncios).`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await send('blocklist.delete', { id });
      toast('Site removido da lista de bloqueio.', 'success');
      await load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openEntryModal(entry = null) {
    const isEdit = Boolean(entry);
    modal({
      title: isEdit ? 'Editar site bloqueado' : 'Adicionar site à lista de bloqueio',
      width: 'min(680px, 100%)',
      body: `
        <div class="form-grid">
          <div class="field span-full">
            <label for="bl-domain">Site ou domínio</label>
            <input class="input" id="bl-domain" value="${esc(entry?.domain || '')}" placeholder="exemplo.com" spellcheck="false" autocomplete="off">
            <div class="hint">Aceita domínio ou URL colada. Vale para o domínio e todos os subdomínios.</div>
          </div>
          <div class="field span-full">
            <label for="bl-action">O que fazer ao abrir este site</label>
            <select class="select" id="bl-action">
              <option value="block" ${entry?.action !== 'redirect' ? 'selected' : ''}>Mostrar a página de bloqueio do Aegis</option>
              <option value="redirect" ${entry?.action === 'redirect' ? 'selected' : ''}>Redirecionar para uma URL escolhida</option>
            </select>
          </div>
          <div class="field span-full" id="bl-redirect-wrap" ${entry?.action === 'redirect' ? '' : 'hidden'}>
            <label for="bl-redirect">URL de destino</label>
            <input class="input" id="bl-redirect" type="url" value="${esc(entry?.redirectUrl || '')}" placeholder="https://exemplo.com/pagina" spellcheck="false" autocomplete="off">
            <div class="hint">Apenas HTTP(S), sem credenciais e sem outro site da lista (evita loop).</div>
          </div>
          <div class="field span-full">
            <label for="bl-note">Nota (opcional)</label>
            <input class="input" id="bl-note" maxlength="300" value="${esc(entry?.note || '')}" placeholder="Motivo ou lembrete">
          </div>
          <div class="field span-full">
            <label class="switch"><input type="checkbox" id="bl-enabled" ${entry?.enabled !== false ? 'checked' : ''}><span class="track"></span><span class="switch-label">Regra ativa</span></label>
          </div>
        </div>
        <div class="notice info mt-16">Regras da lista de bloqueio têm prioridade sobre o whitelist e sobre o bloqueio de anúncios. A regra sempre atua somente no documento principal.</div>
      `,
      actions: [
        { label: 'Cancelar', value: false, className: 'btn-ghost' },
        {
          label: isEdit ? 'Salvar alterações' : 'Adicionar site',
          className: 'btn-primary',
          onClick: async ({ dialog, button }) => {
            const domain = dialog.querySelector('#bl-domain')?.value.trim() || '';
            const action = dialog.querySelector('#bl-action')?.value || 'block';
            const redirectUrl = dialog.querySelector('#bl-redirect')?.value.trim() || '';
            const note = dialog.querySelector('#bl-note')?.value.trim() || '';
            const enabled = dialog.querySelector('#bl-enabled')?.checked !== false;
            if (!domain) {
              toast('Informe o site ou domínio.', 'error');
              dialog.querySelector('#bl-domain')?.focus();
              return false;
            }
            if (action === 'redirect' && !redirectUrl) {
              toast('Informe a URL de destino do redirecionamento.', 'error');
              dialog.querySelector('#bl-redirect')?.focus();
              return false;
            }
            setBusy(button, true, 'Salvando');
            try {
              if (isEdit) {
                await send('blocklist.update', {
                  id: entry.id,
                  patch: { domain, action, redirectUrl, note, enabled },
                });
                toast('Site atualizado.', 'success');
              } else {
                await send('blocklist.add', { domain, action, redirectUrl, note, enabled });
                toast('Site adicionado à lista de bloqueio.', 'success');
              }
              await load();
              return true;
            } catch (error) {
              toast(error.message, 'error', 6500);
              setBusy(button, false);
              return false;
            }
          },
        },
      ],
    }).then((result) => {
      if (result) load();
    });

    const actionSelect = document.querySelector('#aegis-modal #bl-action');
    const redirectWrap = document.querySelector('#aegis-modal #bl-redirect-wrap');
    actionSelect?.addEventListener('change', () => {
      if (redirectWrap) redirectWrap.hidden = actionSelect.value !== 'redirect';
      if (actionSelect.value === 'redirect') {
        document.querySelector('#aegis-modal #bl-redirect')?.focus();
      }
    });
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(siteblock|settings|system)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 250);
    }
  };
  const timer = setInterval(() => {
    if (!disposed && document.visibilityState === 'visible' && entries.some((entry) => entry.bypass)) load();
  }, 60000);
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('aegis:event', onEvent);
  };
}
