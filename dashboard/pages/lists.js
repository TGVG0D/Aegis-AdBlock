import {
  categoryOptions,
  confirmDialog,
  emptyState,
  esc,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRelative,
  icon,
  listStatusBadge,
  loadingState,
  modal,
  pickFile,
  send,
  setBusy,
  setHtml,
  toast,
} from '../../ui/shared.js';

const FORMAT_OPTIONS = [
  { id: 'auto', label: 'Detectar automaticamente' },
  { id: 'easylist', label: 'EasyList / Adblock Plus' },
  { id: 'hosts', label: 'Hosts (0.0.0.0 domínio)' },
  { id: 'domains', label: 'Domínios puros' },
];

function sourceLabel(list) {
  if (list.sourceType === 'bundled') return 'Incluída na extensão';
  if (list.sourceType === 'file') return 'Arquivo local';
  if (list.url?.includes('raw.githubusercontent.com')) return `GitHub RAW · ${list.url}`;
  return list.url || 'URL não informada';
}

function formatOptions(selected = 'auto') {
  return FORMAT_OPTIONS.map(
    (format) => `<option value="${format.id}" ${format.id === selected ? 'selected' : ''}>${esc(format.label)}</option>`,
  ).join('');
}

function listCategoryOptions(selected = 'other') {
  return ['ads', 'tracking', 'malware', 'annoyance', 'other', 'mixed']
    .map((id) => {
      const labels = { ads: 'Anúncios', tracking: 'Rastreadores', malware: 'Malware', annoyance: 'Incômodos', other: 'Outros', mixed: 'Mista' };
      return `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(labels[id])}</option>`;
    })
    .join('');
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let snapshot = { lists: [], recommended: [] };
  const installing = new Set();
  let reloadTimer = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const hadContent = Boolean(snapshot.lists.length);
      if (!hadContent) setHtml(view, loadingState('Carregando listas…'));
      try {
        const data = await send('lists.get');
        if (disposed) return;
        snapshot = data;
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar as listas.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const { lists, recommended } = snapshot;
    const settings = ctx.state.status?.settings;
    const installedUrls = new Set(lists.map((list) => list.url).filter(Boolean));
    const available = recommended.filter((item) => !installedUrls.has(item.url));
    const totalRules = lists.filter((list) => list.enabled).reduce((sum, list) => sum + (list.ruleCount || 0), 0);
    const urlLists = lists.filter((list) => list.sourceType === 'url');

    setHtml(view, `
      <div class="toolbar">
        <button class="btn btn-primary" id="ls-add-url">${icon('plus')}Adicionar link RAW/URL</button>
        <button class="btn" id="ls-import">${icon('upload')}Importar arquivo</button>
        <button class="btn" id="ls-paste">${icon('file')}Colar regras</button>
        <span class="spacer"></span>
        <button class="btn" id="ls-update-all" ${urlLists.length ? '' : 'disabled'}>${icon('refresh')}Atualizar todas</button>
      </div>

      <div class="grid grid-4">
        <div class="card kpi"><div class="kpi-label">${icon('lists')}Listas instaladas</div><div class="kpi-value">${esc(String(lists.length))}</div><div class="kpi-sub">${esc(String(lists.filter((list) => list.enabled).length))} ativa(s)</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('rules')}Regras carregadas</div><div class="kpi-value">${esc(formatNumber(totalRules))}</div><div class="kpi-sub">nas listas ativas</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('download')}Fontes por URL</div><div class="kpi-value">${esc(String(urlLists.length))}</div><div class="kpi-sub">${settings?.autoUpdate ? `atualização a cada ${esc(String(settings.updateIntervalHours))} h` : 'atualização automática desligada'}</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('alert')}Com erro</div><div class="kpi-value">${esc(String(lists.filter((list) => list.status === 'error').length))}</div><div class="kpi-sub">última versão válida mantida</div></div>
      </div>

      <section class="card mt-16">
        <div class="card-head">
          <div><h2>Suas listas</h2><p>Ordem de carregamento não altera a precedência de exceções.</p></div>
          <span class="badge gray">${esc(String(lists.length))} fonte(s)</span>
        </div>
        ${lists.length ? lists.map(renderList).join('') : emptyState('Nenhuma lista instalada', 'Adicione um link RAW/URL, importe um arquivo ou cole regras.', 'lists')}
      </section>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Listas recomendadas</h2><p>Fontes públicas conhecidas. Você decide o que instalar.</p></div></div>
        ${available.length ? `<div class="recommended">${available
          .map(
            (item) => `<div class="recommended-card">
              <h3>${esc(item.name)}</h3>
              <p>${esc(item.description)}</p>
              <div class="tiny muted">Licença: ${esc(item.license || 'não informada')} · formato ${esc(item.format)}</div>
              ${installing.has(item.id)
                ? '<button class="btn btn-sm btn-primary" disabled><span class="spinner"></span>Instalando…</button>'
                : `<button class="btn btn-sm btn-primary" data-install="${esc(item.id)}">${icon('plus')}Instalar</button>`}
            </div>`,
          )
          .join('')}</div>` : emptyState('Todas as sugestões já estão instaladas', 'Você ainda pode adicionar qualquer URL compatível.', 'check')}
      </section>

      <div class="notice info mt-16">${icon('info')}<div>Listas são validadas antes de substituir a versão anterior. Falhas de rede ou listas vazias mantêm o último conteúdo válido. Regras com opções não suportadas são descartadas e contabilizadas no diagnóstico.</div></div>
    `);

    bind();
  }

  function renderList(list) {
    const errorNotice = list.status === 'error' && list.error
      ? `<div class="notice danger mt-10">${icon('alert')}<div><strong>Falha na última atualização.</strong><div>${esc(list.error)}</div><div class="tiny">A versão anterior continua ativa.</div></div></div>`
      : '';
    return `
      <div class="list-card">
        <div class="list-card-head">
          <div style="min-width:0">
            <div class="list-card-title">
              ${esc(list.name)}
              ${listStatusBadge(list)}
              ${list.enabled ? '' : '<span class="badge gray">Desativada</span>'}
              ${list.sourceType === 'bundled' ? '<span class="badge cyan">Incluída</span>' : ''}
            </div>
            <div class="list-card-meta">
              <span class="truncate" style="max-width:420px" title="${esc(sourceLabel(list))}">${esc(sourceLabel(list))}</span>
              <span>${esc(formatNumber(list.ruleCount))} regras</span>
              <span>${esc(formatNumber(list.networkCount))} rede · ${esc(formatNumber(list.cosmeticCount))} cosméticas</span>
              <span>${esc(formatBytes(list.size || list.bodySize || 0))}</span>
              <span>Atualizada ${esc(formatRelative(list.lastUpdated))}</span>
              <span>Verificada ${esc(formatRelative(list.lastChecked))}</span>
            </div>
            ${list.invalidCount || list.unsupportedCount ? `<div class="tiny muted mt-6">${esc(formatNumber(list.invalidCount))} inválida(s) · ${esc(formatNumber(list.unsupportedCount))} não suportada(s)</div>` : ''}
          </div>
          <label class="switch" title="${list.enabled ? 'Desativar lista' : 'Ativar lista'}">
            <input type="checkbox" data-toggle="${esc(list.id)}" ${list.enabled ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>
        ${errorNotice}
        <div class="list-card-body">
          ${list.sourceType === 'url' ? `<button class="btn btn-sm" data-update="${esc(list.id)}">${icon('refresh')}Atualizar</button>` : ''}
          <button class="btn btn-sm" data-history="${esc(list.id)}">${icon('history')}Histórico</button>
          <button class="btn btn-sm" data-view="${esc(list.id)}">${icon('eye')}Ver conteúdo</button>
          <button class="btn btn-sm" data-edit="${esc(list.id)}">Editar</button>
          <span class="spacer" style="flex:1"></span>
          <button class="btn btn-sm btn-danger" data-delete="${esc(list.id)}" ${list.sourceType === 'bundled' ? 'disabled title="A lista incluída não pode ser removida"' : ''}>${icon('trash')}Remover</button>
        </div>
        ${list.hash ? `<div class="tiny muted mt-6 mono">hash ${esc(list.hash)} · ${esc(String(list.updateCount || 0))} atualização(ões)</div>` : ''}
      </div>`;
  }

  function bind() {
    view.querySelector('#ls-add-url')?.addEventListener('click', () => openAddUrl());
    view.querySelector('#ls-import')?.addEventListener('click', () => importFile());
    view.querySelector('#ls-paste')?.addEventListener('click', () => openPaste());
    view.querySelector('#ls-update-all')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, 'Atualizando');
      try {
        const result = await send('lists.updateAll', { dueOnly: false });
        toast(`${result.updated} atualizada(s), ${result.notModified} sem mudanças, ${result.failed} falha(s).`, result.failed ? 'error' : 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        setBusy(button, false);
      }
    });

    view.querySelectorAll('[data-toggle]').forEach((input) => {
      input.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await send('lists.toggle', { id: input.dataset.toggle, enabled: input.checked });
          toast(input.checked ? 'Lista ativada.' : 'Lista desativada.', 'success');
          await load();
        } catch (error) {
          toast(error.message, 'error');
          input.checked = !input.checked;
        } finally {
          input.disabled = false;
        }
      });
    });

    view.querySelectorAll('[data-update]').forEach((button) => {
      button.addEventListener('click', async () => {
        setBusy(button, true, 'Atualizando');
        try {
          const result = await send('lists.update', { id: button.dataset.update });
          const status = result.history?.status;
          if (status === 'not-modified') toast('Lista já estava atualizada (304).', 'success');
          else if (status === 'error') toast(`Falha: ${result.history?.error || 'erro desconhecido'}`, 'error');
          else toast(`Lista atualizada: ${formatNumber(result.list.ruleCount)} regras.`, 'success');
          await load();
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          setBusy(button, false);
        }
      });
    });

    view.querySelectorAll('[data-history]').forEach((button) => {
      button.addEventListener('click', () => openHistory(button.dataset.history));
    });
    view.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => openContent(button.dataset.view));
    });
    view.querySelectorAll('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => openEdit(button.dataset.edit));
    });
    view.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => removeList(button.dataset.delete));
    });
    view.querySelectorAll('[data-install]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.install;
        if (installing.has(id)) return;
        installing.add(id);
        paint();
        try {
          await send('lists.installRecommended', { id });
          toast('Lista instalada e analisada.', 'success');
        } catch (error) {
          toast(error.message, 'error');
        } finally {
          installing.delete(id);
          await load();
        }
      });
    });
  }

  function openAddUrl() {
    modal({
      title: 'Adicionar lista por link RAW/URL',
      body: `
        <div class="form-grid">
          <div class="field span-full"><label for="ls-url">Link RAW ou URL direta da lista</label><input class="input" id="ls-url" type="url" placeholder="https://raw.githubusercontent.com/…/lista.txt" spellcheck="false"><div class="hint">Cole o link RAW (por exemplo, do GitHub) ou outra URL HTTP(S) direta. A lista será baixada, validada e salva agora; depois aparecerá o botão <strong>Atualizar</strong>.</div></div>
          <div class="field"><label for="ls-name">Nome (opcional)</label><input class="input" id="ls-name" maxlength="120" placeholder="Minha lista"></div>
          <div class="field"><label for="ls-category">Categoria</label><select class="select" id="ls-category">${listCategoryOptions('other')}</select></div>
          <div class="field"><label for="ls-format">Formato</label><select class="select" id="ls-format">${formatOptions('auto')}</select></div>
          <div class="field span-full"><label class="checkline"><input type="checkbox" id="ls-enabled" checked> Ativar esta lista imediatamente</label></div>
        </div>`,
      actions: [
        { label: 'Cancelar', value: null, className: 'btn-ghost' },
        {
          label: 'Adicionar lista',
          className: 'btn-primary',
          onClick: async ({ dialog, button, close }) => {
            const url = dialog.querySelector('#ls-url').value.trim();
            if (!url) {
              toast('Informe a URL da lista.', 'error');
              return false;
            }
            setBusy(button, true, 'Baixando');
            try {
              await send('lists.addUrl', {
                url,
                name: dialog.querySelector('#ls-name').value.trim(),
                category: dialog.querySelector('#ls-category').value,
                format: dialog.querySelector('#ls-format').value,
                enabled: dialog.querySelector('#ls-enabled').checked,
                refresh: true,
              });
              close(true);
              toast('Lista baixada e adicionada. Use Atualizar quando quiser verificar mudanças.', 'success');
              await load();
              return true;
            } catch (error) {
              toast(error.message, 'error');
              setBusy(button, false);
              return false;
            }
          },
        },
      ],
    });
  }

  async function importFile() {
    const file = await pickFile('.txt,.hosts,.list,text/plain');
    if (!file) return;
    modal({
      title: `Importar “${file.name}”`,
      body: `
        <div class="notice info mb-16">${icon('info')}<div>O arquivo é lido localmente neste dispositivo e salvo no IndexedDB. ${esc(formatNumber(file.text.length))} caracteres.</div></div>
        <div class="form-grid">
          <div class="field"><label for="ls-file-name">Nome da lista</label><input class="input" id="ls-file-name" maxlength="120" value="${esc(file.name.replace(/\.[^.]+$/, ''))}"></div>
          <div class="field"><label for="ls-file-category">Categoria</label><select class="select" id="ls-file-category">${listCategoryOptions('other')}</select></div>
          <div class="field"><label for="ls-file-format">Formato</label><select class="select" id="ls-file-format">${formatOptions('auto')}</select></div>
          <div class="field"><label class="checkline" style="margin-top:24px"><input type="checkbox" id="ls-file-enabled" checked> Ativar imediatamente</label></div>
        </div>`,
      actions: [
        { label: 'Cancelar', value: null, className: 'btn-ghost' },
        {
          label: 'Importar',
          className: 'btn-primary',
          onClick: async ({ dialog, button, close }) => {
            setBusy(button, true, 'Analisando');
            try {
              await send('lists.addRaw', {
                name: dialog.querySelector('#ls-file-name').value.trim(),
                text: file.text,
                category: dialog.querySelector('#ls-file-category').value,
                format: dialog.querySelector('#ls-file-format').value,
                sourceType: 'file',
                enabled: dialog.querySelector('#ls-file-enabled').checked,
              });
              close(true);
              toast('Arquivo importado.', 'success');
              await load();
              return true;
            } catch (error) {
              toast(error.message, 'error');
              setBusy(button, false);
              return false;
            }
          },
        },
      ],
    });
  }

  function openPaste() {
    modal({
      title: 'Colar regras',
      width: 'min(760px, 100%)',
      body: `
        <div class="form-grid">
          <div class="field"><label for="ls-paste-name">Nome da lista</label><input class="input" id="ls-paste-name" maxlength="120" placeholder="Regras locais"></div>
          <div class="field"><label for="ls-paste-category">Categoria</label><select class="select" id="ls-paste-category">${listCategoryOptions('other')}</select></div>
          <div class="field"><label for="ls-paste-format">Formato</label><select class="select" id="ls-paste-format">${formatOptions('auto')}</select></div>
          <div class="field"><label class="checkline" style="margin-top:24px"><input type="checkbox" id="ls-paste-enabled" checked> Ativar imediatamente</label></div>
          <div class="field span-full"><label for="ls-paste-text">Regras</label><textarea class="textarea" id="ls-paste-text" rows="12" spellcheck="false" placeholder="||exemplo.com^&#10;##.banner-intrusivo&#10;@@||meusite.com^"></textarea><div class="hint">Uma regra por linha. Comentários começam com “!”.</div></div>
        </div>`,
      actions: [
        { label: 'Cancelar', value: null, className: 'btn-ghost' },
        {
          label: 'Salvar lista',
          className: 'btn-primary',
          onClick: async ({ dialog, button, close }) => {
            const text = dialog.querySelector('#ls-paste-text').value;
            if (!text.trim()) {
              toast('Cole ao menos uma regra.', 'error');
              return false;
            }
            setBusy(button, true, 'Analisando');
            try {
              await send('lists.addRaw', {
                name: dialog.querySelector('#ls-paste-name').value.trim(),
                text,
                category: dialog.querySelector('#ls-paste-category').value,
                format: dialog.querySelector('#ls-paste-format').value,
                sourceType: 'file',
                enabled: dialog.querySelector('#ls-paste-enabled').checked,
              });
              close(true);
              toast('Lista salva.', 'success');
              await load();
              return true;
            } catch (error) {
              toast(error.message, 'error');
              setBusy(button, false);
              return false;
            }
          },
        },
      ],
    });
  }

  async function openHistory(id) {
    const list = snapshot.lists.find((item) => item.id === id);
    try {
      const entries = await send('lists.history', { id, limit: 30 });
      modal({
        title: `Histórico · ${list?.name || 'lista'}`,
        width: 'min(760px, 100%)',
        body: entries.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Quando</th><th>Status</th><th>Regras</th><th>Adicionadas</th><th>Removidas</th><th>Origem</th></tr></thead>
              <tbody>${entries
                .map(
                  (entry) => `<tr>
                    <td class="nowrap">${esc(formatDateTime(entry.at))}</td>
                    <td><span class="badge ${entry.status === 'ok' ? 'green' : entry.status === 'not-modified' ? 'gray' : 'red'}">${esc(entry.status)}</span></td>
                    <td>${esc(formatNumber(entry.ruleCount))}</td>
                    <td>${entry.added ? `+${esc(formatNumber(entry.added))}` : '—'}</td>
                    <td>${entry.removed ? `−${esc(formatNumber(entry.removed))}` : '—'}</td>
                    <td>${esc(entry.source || '—')}</td>
                  </tr>${entry.error ? `<tr><td colspan="6"><div class="tiny" style="color:var(--red)">${esc(entry.error)}</div></td></tr>` : ''}`,
                )
                .join('')}</tbody></table></div>`
          : emptyState('Sem atualizações registradas', 'O histórico aparece após a primeira verificação.', 'history'),
        actions: [{ label: 'Fechar', value: null, className: 'btn-ghost' }],
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function openContent(id) {
    const list = snapshot.lists.find((item) => item.id === id);
    try {
      const content = await send('lists.content', { id });
      const text = content.text || '';
      modal({
        title: `Conteúdo · ${list?.name || 'lista'}`,
        width: 'min(900px, 100%)',
        body: text
          ? `<div class="tiny muted mb-10">${esc(formatNumber(text.length))} caracteres · ${esc(formatBytes(new Blob([text]).size))} · somente leitura</div>
             <textarea class="textarea" readonly rows="20" spellcheck="false">${esc(text.slice(0, 200000))}</textarea>
             ${text.length > 200000 ? '<div class="hint mt-6">Prévia limitada aos primeiros 200.000 caracteres.</div>' : ''}`
          : emptyState('Conteúdo indisponível', 'O corpo desta lista não está armazenado localmente.', 'file'),
        actions: [
          { label: 'Fechar', value: null, className: 'btn-ghost' },
          ...(text
            ? [{
                label: 'Baixar .txt',
                className: 'btn',
                onClick: ({ close }) => {
                  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = `${(list?.name || 'lista').replace(/[^\w.-]+/g, '-')}.txt`;
                  document.body.appendChild(anchor);
                  anchor.click();
                  anchor.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 3000);
                  close(true);
                  return true;
                },
              }]
            : []),
        ],
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function openEdit(id) {
    const list = snapshot.lists.find((item) => item.id === id);
    if (!list) return;
    modal({
      title: `Editar · ${list.name}`,
      body: `<div class="form-grid">
        <div class="field span-full"><label for="ls-edit-name">Nome</label><input class="input" id="ls-edit-name" maxlength="120" value="${esc(list.name)}"></div>
        <div class="field"><label for="ls-edit-category">Categoria</label><select class="select" id="ls-edit-category">${listCategoryOptions(list.category)}</select></div>
        <div class="field"><label for="ls-edit-format">Formato</label><select class="select" id="ls-edit-format">${formatOptions(list.format)}</select></div>
      </div>`,
      actions: [
        { label: 'Cancelar', value: null, className: 'btn-ghost' },
        {
          label: 'Salvar',
          className: 'btn-primary',
          onClick: async ({ dialog, button, close }) => {
            setBusy(button, true, 'Salvando');
            try {
              await send('lists.edit', {
                id,
                patch: {
                  name: dialog.querySelector('#ls-edit-name').value.trim(),
                  category: dialog.querySelector('#ls-edit-category').value,
                  format: dialog.querySelector('#ls-edit-format').value,
                },
              });
              close(true);
              toast('Lista atualizada.', 'success');
              await load();
              return true;
            } catch (error) {
              toast(error.message, 'error');
              setBusy(button, false);
              return false;
            }
          },
        },
      ],
    });
  }

  async function removeList(id) {
    const list = snapshot.lists.find((item) => item.id === id);
    if (!list) return;
    const confirmed = await confirmDialog({
      title: 'Remover lista',
      message: `“${list.name}” e seu conteúdo armazenado serão removidos. As regras deixam de valer imediatamente.`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await send('lists.delete', { id });
      toast('Lista removida.', 'success');
      await load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(lists|settings|system)/.test(event.detail?.scope || '')) {
      // Coalesce bursts of background events into a single reload.
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (!disposed) load();
      }, 300);
    }
  };
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    clearTimeout(reloadTimer);
    window.removeEventListener('aegis:event', onEvent);
  };
}
