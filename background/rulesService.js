import { LIMITS, USER_CATEGORIES } from '../engine/constants.js';
import { parseUserRule } from '../engine/parser.js';
import { getCustomRules, normalizeCustomRule, setCustomRules } from '../storage/state.js';
import { emitBackgroundEvent } from './events.js';
import { rebuild, testRuleWithEngine } from './engineRuntime.js';

const MAX_CUSTOM_RULES = 2000;

function makeId() {
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function validateRule(rule, category = 'other') {
  const raw = String(rule || '').trim();
  if (!raw) throw new Error('Informe uma regra.');
  if (raw.length > LIMITS.maxCustomRuleLength) {
    throw new Error(`A regra excede o limite de ${LIMITS.maxCustomRuleLength} caracteres.`);
  }
  const parsed = parseUserRule(raw, {
    listId: 'custom',
    listName: 'Regras personalizadas',
    category: USER_CATEGORIES.includes(category) ? category : 'other',
    source: 'custom',
  });
  if (!parsed.ok) throw new Error(parsed.reason || 'Regra inválida.');
  return { raw, parsed, category: USER_CATEGORIES.includes(category) ? category : 'other' };
}

function summarize(filter) {
  if (!filter) return null;
  if (filter.kind === 'cosmetic') {
    return {
      kind: 'cosmetic',
      selector: filter.selector,
      exception: filter.exception,
      includeDomains: filter.includeDomains,
      excludeDomains: filter.excludeDomains,
      generic: filter.generic,
    };
  }
  return {
    kind: 'network',
    pattern: filter.pattern,
    exception: filter.exception,
    important: filter.important,
    types: filter.types,
    includeDomains: filter.includeDomains,
    excludeDomains: filter.excludeDomains,
    thirdParty: filter.thirdParty,
  };
}

export async function getCustomRulesDetailed() {
  const rules = await getCustomRules();
  return rules.map((rule) => {
    let parsed = null;
    let ok = true;
    let reason = '';
    try {
      const result = parseUserRule(rule.rule, {
        listId: 'custom',
        listName: 'Regras personalizadas',
        category: rule.category,
        source: 'custom',
      });
      if (result.ok) parsed = summarize(result.filter);
      else {
        ok = false;
        reason = result.reason;
      }
    } catch (error) {
      ok = false;
      reason = error.message;
    }
    return { ...rule, ok, reason, parsed };
  });
}

export async function addCustomRule({ rule, category = 'other', note = '', enabled = true } = {}) {
  const rules = await getCustomRules();
  if (rules.length >= MAX_CUSTOM_RULES) throw new Error(`Limite de ${MAX_CUSTOM_RULES} regras atingido.`);
  const validated = validateRule(rule, category);
  if (rules.some((entry) => entry.rule.trim().toLowerCase() === validated.raw.toLowerCase())) {
    throw new Error('Esta regra já existe.');
  }
  const entry = normalizeCustomRule({
    id: makeId(),
    rule: validated.raw,
    enabled,
    category: validated.category,
    note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await setCustomRules([...rules, entry]);
  await rebuild('custom-rule-add');
  emitBackgroundEvent('rules:changed', { action: 'add', id: entry.id });
  return { rule: entry, parsed: summarize(validated.parsed.filter) };
}

export async function updateCustomRule(id, patch = {}) {
  const rules = await getCustomRules();
  const index = rules.findIndex((entry) => entry.id === id);
  if (index === -1) throw new Error('Regra não encontrada.');
  const current = rules[index];
  const nextRule = patch.rule !== undefined ? String(patch.rule).trim() : current.rule;
  const nextCategory = patch.category !== undefined ? patch.category : current.category;
  const validated = validateRule(nextRule, nextCategory);
  if (rules.some((entry) => entry.id !== id && entry.rule.trim().toLowerCase() === nextRule.toLowerCase())) {
    throw new Error('Esta regra já existe.');
  }
  const updated = normalizeCustomRule({
    ...current,
    rule: nextRule,
    category: validated.category,
    note: patch.note !== undefined ? patch.note : current.note,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    updatedAt: Date.now(),
  });
  rules[index] = updated;
  await setCustomRules(rules);
  await rebuild('custom-rule-update');
  emitBackgroundEvent('rules:changed', { action: 'update', id });
  return { rule: updated, parsed: summarize(validated.parsed.filter) };
}

export async function setCustomRuleEnabled(id, enabled) {
  return updateCustomRule(id, { enabled });
}

export async function removeCustomRule(id) {
  const rules = await getCustomRules();
  const next = rules.filter((entry) => entry.id !== id);
  if (next.length === rules.length) throw new Error('Regra não encontrada.');
  await setCustomRules(next);
  await rebuild('custom-rule-remove');
  emitBackgroundEvent('rules:changed', { action: 'remove', id });
  return { id };
}

export async function removeAllCustomRules() {
  await setCustomRules([]);
  await rebuild('custom-rules-cleared');
  emitBackgroundEvent('rules:changed', { action: 'clear' });
  return { removed: true };
}

export function previewCustomRule({ rule, category = 'other' } = {}) {
  try {
    const validated = validateRule(rule, category);
    return { ok: true, category: validated.category, parsed: summarize(validated.parsed.filter) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function testRule({ url, initiator = '', type = 'script' } = {}) {
  return testRuleWithEngine({ url, initiator, type });
}

export { MAX_CUSTOM_RULES };
