import {
  CATEGORIES,
  categoryOptions,
  confirmDialog,
  emptyState,
  esc,
  formatRelative,
  icon,
  loadingState,
  modal,
  send,
  setBusy,
  setHtml,
  toast,
  typeOptions,
} from '../../ui/shared.js';

const EXAMPLES = [
  { label: 'Bloquear domínio', rule: '||exemplo-de-anuncio.com^' },
  { label: 'Bloquear caminho', rule: '||meusite.com/banner/*$image' },
  { label: 'Exceção', rule: '@@||meusite.com^$document' },
  { label: 'Ocultar elemento', rule: 'meusite.com##.promo-overlay' },
];

function describeParsed(parsed) {
  if (!parsed) return 'Regra não analisada.';
  if (parsed.kind === 'cosmetic') {
    return `Cosmética · seletor ${parsed.selector}${parsed.generic ? ' · genérica' : ''}${parsed.exception ? ' · exceção' : ''}`;
  }
  const parts = [`Rede · padrão ${parsed.pattern}`];
  if (parsed.exception) parts.push('exceção');
  if (parsed.important) parts.push('importante');
  if (parsed.types?.length) parts.push(`tipos: ${parsed.types.join(', ')}`);
  if (parsed.includeDomains?.length) parts.push(`de: ${parsed.includeDomains.join(', ')}`);
  if (parsed.excludeDomains?.length) parts.push(`exceto: ${parsed.excludeDomains.join(', ')}`);
  if (parsed.thirdParty !== null && parsed.thirdParty !== undefined) parts.push(parsed.thirdParty ? 'terceiros' : 'primeira parte');
  return parts.join(' · ');
}

export async function render(view, ctx) {
  let disposed = false;
  let loading = null;
  let rules = [];

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!rules.length) setHtml(view, loadingState('Carregando regras…'));
      try {
        const data = await send('rules.get');
        if (disposed) return;
        rules = data;
        paint();
      } catch (error) {
        if (!disposed) {
          setHtml(view, `<div class="notice danger">${icon('alert')}<div><strong>Falha ao carregar as regras.</strong><div>${esc(error.message)}</div></div></div>`);
        }
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function paint() {
    const enabled = rules.filter((rule) => rule.enabled);
    const invalid = rules.filter((rule) => !rule.ok);
    setHtml(view, `
      <div class="toolbar">
        <button class="btn btn-primary" id="rl-add">${icon('plus')}Nova regra</button>
        <span class="spacer"></span>
        <button class="btn" id="rl-export">${icon('download')}Exportar regras</button>
        <button class="btn btn-danger" id="rl-clear" ${rules.length ? '' : 'disabled'}>${icon('trash')}Limpar tudo</button>
      </div>

      <div class="grid grid-4">
        <div class="card kpi"><div class="kpi-label">${icon('rules')}Regras personalizadas</div><div class="kpi-value">${esc(String(rules.length))}</div><div class="kpi-sub">${esc(String(enabled.length))} ativa(s)</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('shield')}Bloqueios</div><div class="kpi-value">${esc(String(enabled.filter((rule) => rule.parsed?.kind === 'network' && !rule.parsed.exception).length))}</div><div class="kpi-sub">regras de rede</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('cosmetic')}Cosméticas</div><div class="kpi-value">${esc(String(enabled.filter((rule) => rule.parsed?.kind === 'cosmetic').length))}</div><div class="kpi-sub">seletores CSS</div></div>
        <div class="card kpi"><div class="kpi-label">${icon('alert')}Inválidas</div><div class="kpi-value">${esc(String(invalid.length))}</div><div class="kpi-sub">${invalid.length ? 'corrija ou remova' : 'nenhum problema'}</div></div>
      </div>

      <div class="grid grid-main mt-16">
        <section class="card">
          <div class="card-head"><div><h2>Testar uma URL no motor</h2><p>Avalia a URL contra todas as listas ativas e regras personalizadas.</p></div></div>
          <div class="rule-tester">
            <div class="field"><label for="rl-test-url">URL do recurso</label><input class="input" id="rl-test-url" type="url" placeholder="https://exemplo.com/anuncio.js" spellcheck="false"></div>
            <div class="field"><label for="rl-test-initiator">Site de origem</label><input class="input" id="rl-test-initiator" placeholder="meusite.com" spellcheck="false"></div>
            <div class="field"><label for="rl-test-type">Tipo</label><select class="select" id="rl-test-type">${typeOptions('script').replace('Todos os tipos', 'Selecione…')}</select></div>
            <button class="btn btn-primary" id="rl-test">Testar</button>
          </div>
          <div id="rl-test-result" class="mt-16"></div>
        </section>

        <section class="card">
          <div class="card-head"><div><h2>Como escrever regras</h2><p>Sintaxe Adblock Plus suportada.</p></div></div>
          <div class="code-list">
            ${EXAMPLES.map((example) => `<div class="code-item"><span title="${esc(example.rule)}">${esc(example.rule)}</span><button class="btn btn-sm btn-ghost" data-example="${esc(example.rule)}">Usar</button></div>`).join('')}
          </div>
          <div class="hint mt-10">Uma regra por linha ao importar. Opções como <code>redirect</code>, <code>csp</code>, <code>removeparam</code> e scriptlets não são executadas por segurança.</div>
        </section>
      </div>

      <section class="card mt-16">
        <div class="card-head"><div><h2>Suas regras</h2><p>Regras desativadas continuam salvas, mas não afetam a navegação.</p></div><span class="badge gray">${esc(String(rules.length))} regra(s)</span></div>
        ${rules.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Ativa</th><th>Regra</th><th>Detalhes</th><th>Categoria</th><th>Nota</th><th>Atualizada</th><th></th></tr></thead>
            <tbody>${rules.map(renderRow).join('')}</tbody>
          </table></div>` : emptyState('Nenhuma regra personalizada', 'Adicione uma regra para bloquear domínios específicos ou ocultar elementos.', 'rules')}
      </section>

      ${invalid.length ? `<div class="notice danger mt-16">${icon('alert')}<div><strong>${esc(String(invalid.length))} regra(s) não puderam ser interpretadas.</strong><div>Elas são ignoradas pelo motor. Edite-as para corrigir.</div></div></div>` : ''}
    `);
    bind();
  }

  function renderRow(rule) {
    const kindBadge = rule.parsed?.kind === 'cosmetic'
      ? '<span class="badge violet">Cosmética</span>'
      : rule.parsed?.exception
        ? '<span class="badge green">Exceção</span>'
        : rule.parsed?.important
          ? '<span class="badge amber">Importante</span>'
          : '<span class="badge cyan">Rede</span>';
    return `<tr>
      <td><label class="switch"><input type="checkbox" data-rule-toggle="${esc(rule.id)}" ${rule.enabled ? 'checked' : ''}><span class="track"></span></label></td>
      <td style="max-width:340px"><span class="rule-code" title="${esc(rule.rule)}">${esc(rule.rule)}</span>${rule.ok ? '' : `<div class="tiny" style="color:var(--red);margin-top:4px">${esc(rule.reason || 'inválida')}</div>`}</td>
      <td style="max-width:280px"><div class="cell-sub">${esc(describeParsed(rule.parsed))}</div>${kindBadge}</td>
      <td>${esc(CATEGORIES[rule.category]?.label || rule.category)}</td>
      <td class="truncate" style="max-width:160px">${esc(rule.note || '—')}</td>
      <td class="nowrap muted">${esc(formatRelative(rule.updatedAt))}</td>
      <td><div class="td-actions">
        <button class="btn btn-sm" data-rule-edit="${esc(rule.id)}">Editar</button>
        <button class="btn btn-sm btn-danger" data-rule-delete="${esc(rule.id)}">${icon('trash')}</button>
      </div></td>
    </tr>`;
  }

  function bind() {
    view.querySelector('#rl-add')?.addEventListener('click', () => openRuleModal());
    view.querySelectorAll('[data-example]').forEach((button) => {
      button.addEventListener('click', () => openRuleModal(null, button.dataset.example));
    });
    view.querySelectorAll('[data-rule-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const rule = rules.find((entry) => entry.id === button.dataset.ruleEdit);
        if (rule) openRuleModal(rule);
      });
    });
    view.querySelectorAll('[data-rule-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteRule(button.dataset.ruleDelete));
    });
    view.querySelectorAll('[data-rule-toggle]').forEach((input) => {
      input.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await send('rules.toggle', { id: input.dataset.ruleToggle, enabled: input.checked });
          await load();
        } catch (error) {
          toast(error.message, 'error');
          input.checked = !input.checked;
        } finally {
          input.disabled = false;
        }
      });
    });

    view.querySelector('#rl-test')?.addEventListener('click', async (event) => {
      const url = view.querySelector('#rl-test-url')?.value.trim();
      const resultBox = view.querySelector('#rl-test-result');
      if (!url) {
        toast('Informe a URL a testar.', 'error');
        return;
      }
      setBusy(event.currentTarget, true, 'Testando');
      try {
        const result = await send('rules.test', {
          url,
          initiator: view.querySelector('#rl-test-initiator')?.value.trim() || '',
          type: view.querySelector('#rl-test-type')?.value || 'script',
        });
        if (result.blocked) {
          setHtml(resultBox, `<div class="result-box blocked"><div class="result-title">${icon('shield')}Bloqueado</div><div class="small mt-6">Motivo: ${esc(result.reason)}</div>${result.rule ? `<div class="mt-10"><div class="tiny muted">Regra</div><span class="rule-code">${esc(result.rule.raw)}</span><div class="tiny muted mt-6">Lista: ${esc(result.rule.listName || result.rule.listId || '—')} · categoria ${esc(result.rule.category)}</div>` : ''}</div>`);
        } else {
          setHtml(resultBox, `<div class="result-box allowed"><div class="result-title">${icon('check')}Permitido</div><div class="small mt-6">Motivo: ${esc(result.reason)}</div>${result.rule ? `<div class="tiny muted mt-6">Regra de exceção: ${esc(result.rule.raw)}</div>` : ''}</div>`);
        }
      } catch (error) {
        setHtml(resultBox, `<div class="notice danger">${icon('alert')}<div>${esc(error.message)}</div></div>`);
      } finally {
        setBusy(event.currentTarget, false);
      }
    });

    view.querySelector('#rl-export')?.addEventListener('click', () => {
      const text = rules.map((rule) => rule.rule).join('\n');
      const blob = new Blob([`! Aegis AdBlock - regras personalizadas\n! Exportado em ${new Date().toISOString()}\n${text}\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `aegis-regras-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      toast('Regras exportadas.', 'success');
    });

    view.querySelector('#rl-clear')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Limpar regras personalizadas',
        message: 'Todas as regras manuais serão apagadas. As listas de filtros não serão alteradas.',
        confirmLabel: 'Limpar tudo',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await send('rules.clear');
        toast('Regras removidas.', 'success');
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  function openRuleModal(rule = null, preset = '') {
    const isEdit = Boolean(rule);
    let previewTimer = null;
    modal({
      title: isEdit ? 'Editar regra' : 'Nova regra personalizada',
      width: 'min(720px, 100%)',
      body: `
        <div class="form-grid">
          <div class="field span-full">
            <label for="rl-rule">Regra</label>
            <textarea class="textarea" id="rl-rule" rows="4" spellcheck="false" placeholder="||exemplo.com^">${esc(rule?.rule || preset)}</textarea>
            <div class="hint" id="rl-preview">Digite para validar a sintaxe.</div>
          </div>
          <div class="field"><label for="rl-category">Categoria</label><select class="select" id="rl-category">${categoryOptions(rule?.category || 'ads')}</select></div>
          <div class="field"><label for="rl-note">Nota (opcional)</label><input class="input" id="rl-note" maxlength="300" value="${esc(rule?.note || '')}" placeholder="Por que esta regra existe"></div>
          <div class="field span-full"><label class="checkline"><input type="checkbox" id="rl-enabled" ${rule?.enabled === false ? '' : 'checked'}> Regra ativa</label></div>
        </div>`,
      actions: [
        { label: 'Cancelar', value: null, className: 'btn-ghost' },
        {
          label: isEdit ? 'Salvar alterações' : 'Adicionar regra',
          className: 'btn-primary',
          onClick: async ({ dialog, button, close }) => {
            const value = dialog.querySelector('#rl-rule').value.trim();
            if (!value) {
              toast('Informe a regra.', 'error');
              return false;
            }
            setBusy(button, true, 'Salvando');
            try {
              if (isEdit) {
                await send('rules.update', {
                  id: rule.id,
                  patch: {
                    rule: value,
                    category: dialog.querySelector('#rl-category').value,
                    note: dialog.querySelector('#rl-note').value.trim(),
                    enabled: dialog.querySelector('#rl-enabled').checked,
                  },
                });
              } else {
                await send('rules.add', {
                  rule: value,
                  category: dialog.querySelector('#rl-category').value,
                  note: dialog.querySelector('#rl-note').value.trim(),
                  enabled: dialog.querySelector('#rl-enabled').checked,
                });
              }
              close(true);
              toast(isEdit ? 'Regra atualizada.' : 'Regra adicionada.', 'success');
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

    const dialog = document.querySelector('#aegis-modal .modal');
    const textarea = dialog?.querySelector('#rl-rule');
    const preview = dialog?.querySelector('#rl-preview');
    const updatePreview = async () => {
      const value = textarea.value.trim();
      if (!value) {
        preview.textContent = 'Digite para validar a sintaxe.';
        preview.style.color = '';
        return;
      }
      try {
        const result = await send('rules.preview', { rule: value, category: dialog.querySelector('#rl-category').value });
        if (result.ok) {
          preview.textContent = `✓ ${describeParsed(result.parsed)}`;
          preview.style.color = 'var(--green)';
        } else {
          preview.textContent = `✗ ${result.error}`;
          preview.style.color = 'var(--red)';
        }
      } catch (error) {
        preview.textContent = error.message;
        preview.style.color = 'var(--red)';
      }
    };
    textarea?.addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(updatePreview, 350);
    });
    dialog?.querySelector('#rl-category')?.addEventListener('change', updatePreview);
    if (preset) setTimeout(updatePreview, 50);
    textarea?.focus();
  }

  async function deleteRule(id) {
    const rule = rules.find((entry) => entry.id === id);
    const confirmed = await confirmDialog({
      title: 'Remover regra',
      message: rule ? `A regra “${rule.rule}” será removida.` : 'Esta regra será removida.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await send('rules.delete', { id });
      toast('Regra removida.', 'success');
      await load();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const onEvent = (event) => {
    if (disposed) return;
    if (/^(rules|lists|settings|system)/.test(event.detail?.scope || '')) {
      setTimeout(() => {
        if (!disposed) load();
      }, 250);
    }
  };
  window.addEventListener('aegis:event', onEvent);

  await load();
  return () => {
    disposed = true;
    window.removeEventListener('aegis:event', onEvent);
  };
}
