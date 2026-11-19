import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, ENTITIES, PRESETS, decision } from '../src/model.js';
import { I18N, LANGS } from '../src/i18n.js';

/** Parameter sets that exercise every option and boolean of an entity. */
function variants(ent) {
  const out = [{}];
  for (const d of ent.params) {
    if (d.type === 'select') for (const o of d.options) out.push({ [d.key]: o });
    if (d.type === 'bool') out.push({ [d.key]: !d.def });
    if (d.type === 'range') out.push({ [d.key]: d.min }, { [d.key]: d.max });
  }
  for (const pr of Object.values(PRESETS)) if (pr.entity === ent.id) out.push(pr.params);
  return out;
}

function collect(ent) {
  const steps = new Set(); const events = new Map(); const decisions = new Set();
  for (const params of variants(ent)) {
    for (const arm of ['untreated', 'treated']) {
      const r = run(ent, params, arm);
      r.stepsAt.forEach((ks) => ks.forEach((k) => steps.add(k)));
      r.events.forEach((e) => events.set(e.key, e.vars));
      r.states.forEach((s, i) => { if (i % 10 === 0) decisions.add(decision(ent.id, s, r.p)); });
    }
  }
  return { steps, events, decisions };
}

for (const lang of LANGS) {
  test(`${lang}: every entity has complete strings for params, series, steps, events and decisions`, () => {
    const T = I18N[lang];
    for (const ent of ENTITIES) {
      const E = T.ent[ent.id];
      assert.ok(E, `${lang} ent.${ent.id}`);
      for (const k of ['name', 'short', 'def', 'mech', 'dx', 'tx']) assert.ok(typeof E[k] === 'string' && E[k].length > (k === 'name' ? 3 : 10), `${lang} ${ent.id}.${k}`);
      for (const d of ent.params) {
        assert.ok(E.p?.[d.key], `${lang} ${ent.id}.p.${d.key}`);
        if (d.type === 'select') for (const o of d.options) assert.ok(T.opt[o], `${lang} opt.${o}`);
      }
      for (const s of ent.series) assert.ok(E.s?.[s.key], `${lang} ${ent.id}.s.${s.key}`);
      const { steps, events, decisions } = collect(ent);
      for (const k of steps) assert.ok(E.st?.[k], `${lang} ${ent.id}.st.${k}`);
      for (const [k, vars] of events) {
        const v = E.ev?.[k];
        assert.ok(v, `${lang} ${ent.id}.ev.${k}`);
        const text = typeof v === 'function' ? v(vars, T) : v;
        assert.ok(typeof text === 'string' && !text.includes('undefined'), `${lang} ${ent.id}.ev.${k} renders`);
      }
      for (const d of decisions) assert.ok(E.dec?.[d], `${lang} ${ent.id}.dec.${d}`);
      if (ent.gauges) {
        const r = run(ent, {}, 'untreated');
        for (const g of ent.gauges(r.states[0], r.p)) assert.ok(E.g?.[g.key], `${lang} ${ent.id}.g.${g.key}`);
      }
      assert.ok(Array.isArray(E.ref) && E.ref.length > 0, `${lang} ${ent.id}.ref`);
    }
  });

  test(`${lang}: presets, modes and quiz are complete`, () => {
    const T = I18N[lang];
    for (const k of Object.keys(PRESETS)) assert.ok(T.preset[k], `${lang} preset.${k}`);
    for (const m of ['obs', 'uti', 'urg']) assert.ok(T.mode[m].name && T.mode[m].backbone);
    assert.equal(T.quiz.length, 18);
    for (const q of T.quiz) {
      assert.ok(q.o.length === 4 && q.a >= 0 && q.a < 4 && q.ex && PRESETS[q.preset], q.q);
    }
  });
}

test('Spanish and English have the same structure', () => {
  const shape = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])])) : Array.isArray(o) ? o.length : typeof o);
  assert.deepEqual(shape(I18N.en), shape(I18N.es));
});
