// Urological emergencies: what cannot wait.
import { clamp, relax, logistic, interp } from './core.js';

// ---------------------------------------------------------------------------
// 1. Gross haematuria
// ---------------------------------------------------------------------------
export const HEMATURIA_ORIGIN = { initial: 'urethraProstate', terminal: 'bladder', total: 'upperTract' };
/** Intensity: mild = no laboratory repercussion; moderate = falling red cells, up to 6 units; severe = >6 units. */
export function hematuriaIntensity(units, hbDrop) {
  if (units > 6) return 'severe';
  if (units > 0 || hbDrop >= 2) return 'moderate';
  return 'mild';
}
export const hematuria = {
  id: 'hematuria', mode: 'urg', unit: 'h', tMax: 72, dt: 0.25,
  region: ['bladder'],
  params: [
    { key: 'timing', type: 'select', options: ['initial', 'terminal', 'total'], def: 'total' },
    { key: 'bleed', type: 'range', min: 5, max: 150, step: 5, def: 60, unit: 'mL/h' },
    { key: 'clots', type: 'bool', def: true },
    { key: 'anticoag', type: 'bool', def: false },
    { key: 'tTx', type: 'range', min: 0.5, max: 12, step: 0.5, def: 1, unit: 'h' },
  ],
  series: [
    { key: 'hb', unit: 'g/dL', min: 0 },
    { key: 'vol', unit: 'mL', min: 0 },
  ],
  init(p, arm, emit) { emit('origin', { origin: HEMATURIA_ORIGIN[p.timing] }); return { hb: 13.5, clot: 0, vol: 150, cath: false, units: 0, controlled: false, rate: p.bleed, retention: false, intensity: 'mild' }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    if (treated && !st.cath && t >= p.tTx) { st.cath = true; st.clot = 0; st.vol = 100; emit(p.clots ? 'evacuation' : 'irrigation'); }
    if (treated && !st.controlled && t >= 24) { st.controlled = true; emit('etiological'); }
    const base = p.bleed * (p.anticoag ? 1.8 : 1) * Math.exp(-t / 48); // many bleeds slow down on their own (Model)
    st.rate = st.controlled ? relax(st.rate, 0, dt, 2) : base;
    st.hb -= (st.rate / 500) * dt; // ≈1 g/dL per 500 mL
    if (treated && st.hb < 7) { st.hb += 1; st.units += 1; emit('transfusion', { n: st.units }, false); }
    if (p.clots && !st.cath) {
      st.clot = clamp(st.clot + (st.rate / 100) * 0.15 * dt, 0, 1);
      if (st.clot > 0.5) { if (!st.retention) emit('clotRetention'); st.retention = true; }
    }
    st.vol = st.cath ? 100 : st.retention ? Math.min(1400, st.vol + 60 * dt) : 150;
    st.intensity = hematuriaIntensity(st.units, 13.5 - st.hb);
    return st;
  },
  steps(st, p, arm) {
    const k = ['origin', 'intensity'];
    if (p.clots) k.push('clots');
    k.push('workup');
    if (st.cath) k.push('irrigation');
    if (st.controlled) k.push('etiology');
    return k;
  },
  gauges(st) { return [{ key: 'hb', value: st.hb, unit: 'g/dL', lo: 12, hi: 17 }, { key: 'units', value: st.units, unit: 'CH', lo: 0, hi: 10, band: false }]; },
  schematic(st, p) {
    const o = HEMATURIA_ORIGIN[p.timing];
    return {
      sex: 'm', focus: [o === 'upperTract' ? 'kidneyL' : o === 'bladder' ? 'bladder' : 'prostate'],
      kidneys: { L: { bleed: o === 'upperTract' ? st.rate / 150 : 0 }, R: {} }, ureters: { L: {}, R: {} },
      bladder: { vol: clamp(st.vol / 1100, 0.1, 1), blood: clamp(st.rate / 120, 0.1, 1), clots: st.clot, catheter: st.cath ? 'threeWay' : null, bleed: o === 'bladder' ? 1 : 0 },
      prostate: { size: 0.55, bleed: o === 'urethraProstate' ? 1 : 0 },
    };
  },
  outcome(st) { return { hb: st.hb, units: st.units, intensity: st.intensity }; },
};

// ---------------------------------------------------------------------------
// 2. Fournier's gangrene
// ---------------------------------------------------------------------------
export const fournier = {
  id: 'fournier', mode: 'urg', unit: 'h', tMax: 96, dt: 0.25,
  region: ['scrotum'],
  params: [
    { key: 'origin', type: 'select', options: ['colorectal', 'urogenital', 'skin', 'idiopathic'], def: 'urogenital' },
    { key: 'diabetes', type: 'bool', def: true },
    { key: 'e0', type: 'range', min: 1, max: 15, step: 1, def: 4, unit: '%' },
    { key: 'tDebr', type: 'range', min: 2, max: 48, step: 1, def: 8, unit: 'h' },
  ],
  series: [
    { key: 'necrosis', unit: '%', min: 0, max: 100 },
    { key: 'lactate', unit: 'mmol/L', min: 0 },
    { key: 'mortality', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { E: p.e0, S: 0.05, lactate: 1.4, mortality: 7, necrosis: p.e0, support: false, debrided: false, second: false }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    if (treated && !st.support && t >= 1) { st.support = true; emit('support'); }
    if (treated && !st.debrided && t >= p.tDebr) { st.debrided = true; emit('debridement', { e: Math.round(st.E) }); }
    if (st.debrided && !st.second && t >= p.tDebr + 24) { st.second = true; emit('secondLook'); }
    // Necrosis spreads along the fascial planes (Model: √E grows linearly).
    if (!st.debrided) {
      const k = 0.16 * (p.diabetes ? 1.3 : 1) * (st.support ? 0.8 : 1);
      st.E = clamp(Math.pow(Math.sqrt(st.E) + k * dt, 2), 0, 100);
      st.S = clamp(st.S + 0.012 * (st.E / 20) * (1 - st.S) * dt * (st.support ? 0.5 : 1), 0, 1);
    } else {
      st.S = relax(st.S, 0, dt, 24);
    }
    if (st.E > 10) emit('crepitus');
    if (st.S > 0.5) emit('shock');
    st.lactate = 1 + 7 * st.S;
    st.necrosis = st.E;
    const m = clamp(0.07 + 0.6 * Math.pow(st.S, 1.5) + 0.3 * Math.pow(st.E / 100, 1.5), 0, 0.98);
    st.mortality = Math.max(st.mortality, m * 100); // risk cannot fall below what has happened
    return st;
  },
  steps(st, p, arm) {
    const k = ['origin', 'endarteritis', 'spread'];
    if (st.E > 10) k.push('crepitus');
    if (st.S > 0.3) k.push('toxicity');
    if (st.debrided) k.push('triad');
    return k;
  },
  gauges(st) { return [{ key: 'lactate', value: st.lactate, unit: 'mmol/L', lo: 0.5, hi: 2 }]; },
  schematic(st) { return { sex: 'm', focus: ['scrotum'], scrotum: { side: 'both', necrosis: st.E / 100, testis: { viability: 1 } }, penis: { necrosis: st.E / 140 }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} }, systemic: st.S }; },
  outcome(st) { return { mortality: st.mortality, necrosis: st.E }; },
};

// ---------------------------------------------------------------------------
// 3. Urosepsis
// ---------------------------------------------------------------------------
/** Sepsis-3: septic shock = vasopressor needed for MAP ≥65 mmHg and lactate >2 mmol/L despite fluids. */
export function isSepticShock(onVasopressor, lactate) { return onVasopressor && lactate > 2; }
/** Severe sepsis markers in the urology setting: CRP >60 mg/L, procalcitonin >2 ng/mL (PCT earlier and more specific). */
export const SEPSIS_MARKERS = { crp: 60, pct: 2, lactate: 2, map: 65 };
/** Mortality rises ≈7.6% per hour of hypotension before effective antibiotics (Kumar 2006). Model. */
export const HOURLY_DELAY_MORTALITY = 0.076;

export const sepsis = {
  id: 'sepsis', mode: 'urg', unit: 'h', tMax: 48, dt: 0.05,
  region: ['kidney'],
  params: [
    { key: 'focus', type: 'select', options: ['obstructivePna', 'abscess', 'catheter', 'prostatitis'], def: 'obstructivePna' },
    { key: 'atbDelay', type: 'range', min: 0, max: 12, step: 0.5, def: 1, unit: 'h' },
    { key: 'srcDelay', type: 'range', min: 0, max: 48, step: 1, def: 6, unit: 'h' },
    { key: 'immuno', type: 'bool', def: false },
  ],
  series: [
    { key: 'map', unit: 'mmHg', min: 0 },
    { key: 'lactate', unit: 'mmol/L', min: 0 },
    { key: 'pct', unit: 'ng/mL', min: 0 },
  ],
  init() { return { B: 0.5, map: 74, lactate: 2.2, pct: 3, crp: 90, atb: false, src: false, nor: false, hc: false, hypoMin: 0, hypoNoAtb: 0, mortality: 12, lowSince: null }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    const g = 0.15 * (p.immuno ? 1.3 : 1);
    if (treated && !st.atb && t >= p.atbDelay) { st.atb = true; emit('bundle'); }
    if (treated && !st.src && t >= p.srcDelay) { st.src = true; emit('source', { focus: p.focus }); }
    if (st.src) st.B = relax(st.B, 0, dt, st.atb ? 8 : 20);
    else st.B = clamp(st.B + (g * st.B * (1.2 - st.B) - (st.atb ? 0.06 * st.B : 0)) * dt, 0, 1.2);
    const target = 88 - 42 * st.B + (st.atb ? 8 : 0) + (st.nor ? 16 : 0) + (st.hc ? 5 : 0);
    st.map = relax(st.map, target, dt, 1);
    if (st.map < 65) { st.lowSince ??= t; } else st.lowSince = null;
    if (treated && st.atb && !st.nor && st.lowSince !== null && t - st.lowSince > 1) { st.nor = true; emit('noradrenaline'); }
    if (treated && st.nor && !st.hc && st.lowSince !== null && t - st.lowSince > 4) { st.hc = true; emit('hydrocortisone'); }
    st.lactate = relax(st.lactate, 1 + 7 * Math.max(0, st.B - 0.3), dt, 2);
    st.pct = relax(st.pct, 0.3 + 25 * st.B, dt, 5);
    st.crp = relax(st.crp, 15 + 260 * st.B, dt, 12);
    if (st.map < 65 && !st.atb) st.hypoNoAtb += dt;
    if ((st.nor && st.lactate > 2) || (!treated && st.map < 65 && st.lactate > 4)) emit('shock');
    st.mortality = clamp(12 + 100 * HOURLY_DELAY_MORTALITY * st.hypoNoAtb + 40 * Math.max(0, st.B - 0.8), 0, 97);
    return st;
  },
  steps(st, p, arm) {
    const k = ['endotoxin', 'vasodilation'];
    if (st.lactate > 2) k.push('hypoperfusion');
    k.push('markers');
    if (st.src) k.push('source');
    if (st.atb) k.push('antibiotics');
    if (st.nor) k.push('icu');
    return k;
  },
  gauges(st) {
    return [
      { key: 'crp', value: st.crp, unit: 'mg/L', lo: 0, hi: SEPSIS_MARKERS.crp },
      { key: 'pct', value: st.pct, unit: 'ng/mL', lo: 0, hi: SEPSIS_MARKERS.pct },
      { key: 'lactate', value: st.lactate, unit: 'mmol/L', lo: 0.5, hi: SEPSIS_MARKERS.lactate },
    ];
  },
  schematic(st, p) {
    const k = p.focus === 'obstructivePna';
    return {
      sex: 'm', focus: [k ? 'kidneyL' : p.focus === 'prostatitis' ? 'prostate' : p.focus === 'catheter' ? 'bladder' : 'kidneyL'],
      kidneys: { L: { inflame: k || p.focus === 'abscess' ? Math.min(1, st.B) : 0, dil: k && !st.src ? 0.6 : 0.1, abscess: p.focus === 'abscess' && !st.src }, R: {} },
      ureters: { L: { stone: k ? { pos: 0.5, size: 7 } : null, stent: k && st.src, dil: k && !st.src ? 0.5 : 0 }, R: {} },
      bladder: { vol: 0.3, catheter: p.focus === 'catheter' ? 'urethral' : null, inflame: p.focus === 'catheter' && !st.src ? st.B : 0 },
      prostate: { inflame: p.focus === 'prostatitis' ? Math.min(1, st.B) : 0, size: 0.55 }, systemic: Math.min(1, st.B),
    };
  },
  outcome(st) { return { mortality: st.mortality, map: st.map }; },
};

// ---------------------------------------------------------------------------
// 4. Paraphimosis
// ---------------------------------------------------------------------------
export function paraphimosisTechnique(edema, necrosis) {
  if (necrosis > 0.05 || edema >= 0.85) return 'circumcision';
  if (edema >= 0.5) return 'dorsalSlit';
  return 'manual';
}
export const paraphimosis = {
  id: 'paraphimosis', mode: 'urg', unit: 'h', tMax: 48, dt: 0.1,
  region: ['penis'],
  params: [
    { key: 'cause', type: 'select', options: ['phimosis', 'catheter', 'balanitis'], def: 'catheter' },
    { key: 'tTx', type: 'range', min: 0.5, max: 40, step: 0.5, def: 3, unit: 'h' },
  ],
  series: [
    { key: 'edema', unit: '%', min: 0, max: 100, get: (s) => s.E * 100 },
    { key: 'perfusion', unit: '%', min: 0, max: 100, get: (s) => s.P * 100 },
    { key: 'necrosis', unit: '%', min: 0, max: 100, get: (s) => s.N * 100 },
  ],
  init() { return { E: 0.1, P: 1, N: 0, done: null }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.done && t >= p.tTx) { st.done = paraphimosisTechnique(st.E, st.N); emit(st.done); }
    st.E = st.done ? relax(st.E, 0, dt, 6) : clamp(st.E + 0.07 * (1 - st.E) * dt, 0, 1);
    st.P = st.done ? relax(st.P, 1, dt, 1) : clamp(1 - 0.9 * Math.pow(st.E, 3), 0, 1);
    if (!st.done && st.P < 0.5) { st.N = clamp(st.N + 0.04 * (0.5 - st.P) * 2 * dt, 0, 1); emit('ischemia'); }
    if (st.N > 0.05) emit('necrosis');
    return st;
  },
  steps(st) {
    const k = ['ring', 'edema'];
    if (st.P < 0.5) k.push('arterial');
    if (st.N > 0.05) k.push('necrosis');
    if (st.done) k.push('reduction');
    return k;
  },
  schematic(st) { return { sex: 'm', focus: ['penis'], penis: { state: 'paraphimosis', edema: st.E, necrosis: st.N, reduced: !!st.done }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { necrosis: st.N * 100, technique: st.done }; },
};

// ---------------------------------------------------------------------------
// 5. Priapism
// ---------------------------------------------------------------------------
/**
 * Cavernosal blood gas: ischaemic pO₂ <30, pCO₂ >60 mmHg, pH <7.25; arterial (non-ischaemic) ≈ arterial blood
 * (pO₂ >90, pCO₂ <40, pH 7.40). Doppler: no flow (ischaemic) vs present/high flow (arterial).
 */
export function classifyPriapism({ pO2, pCO2, pH, flow }) {
  const isch = (pO2 < 30 ? 1 : 0) + (pCO2 > 60 ? 1 : 0) + (pH < 7.25 ? 1 : 0) + (flow === false ? 1 : 0);
  const art = (pO2 > 90 ? 1 : 0) + (pCO2 < 40 ? 1 : 0) + (pH >= 7.35 ? 1 : 0) + (flow === true ? 1 : 0);
  if (isch >= 2 && isch > art) return 'ischemic';
  if (art >= 2 && art > isch) return 'arterial';
  return 'indeterminate';
}
/**
 * Risk of permanent erectile dysfunction vs hours of ischaemia. Histology: interstitial oedema at 12 h,
 * endothelial destruction at 24 h, thrombosis and smooth-muscle necrosis at 48 h; >72 h no recovery.
 * Logistic centred at 24 h: Model.
 */
export const priapismDamage = (h) => (h <= 0 ? 0 : logistic(h, 24, 6) - logistic(0, 24, 6)) / (1 - logistic(0, 24, 6));
export function ischemicGas(h) {
  return { pO2: 10 + 30 * Math.exp(-h / 2), pCO2: 45 + 50 * (1 - Math.exp(-h / 6)), pH: 7.35 - 0.45 * (1 - Math.exp(-h / 12)) };
}
/** Escalation for ischaemic priapism by duration (Model on AUA/SMSNA & EAU algorithms). */
export function priapismStep(h) {
  if (h < 24) return 'aspiration';
  if (h < 48) return 'distalShunt';
  return 'proximalShunt';
}
export const priapism = {
  id: 'priapism', mode: 'urg', unit: 'h', tMax: 96, dt: 0.25,
  region: ['penis'],
  params: [
    { key: 'type', type: 'select', options: ['ischemic', 'arterial'], def: 'ischemic' },
    { key: 'cause', type: 'select', options: ['sickle', 'ici', 'drugs', 'perinealTrauma'], def: 'sickle' },
    { key: 'tTx', type: 'range', min: 1, max: 90, step: 1, def: 6, unit: 'h' },
  ],
  series: [
    { key: 'pO2', unit: 'mmHg', min: 0 },
    { key: 'pH', unit: '' },
    { key: 'damage', unit: '%', min: 0, max: 100 },
  ],
  init(p) {
    const g = p.type === 'ischemic' ? ischemicGas(0) : { pO2: 95, pCO2: 38, pH: 7.4 };
    return { ...g, hIsch: 0, rigid: true, resolvedAt: null, plan: null, damage: p.type === 'ischemic' ? 0 : 20, embolized: false };
  },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    if (p.type === 'ischemic') {
      if (treated && !st.plan && t >= p.tTx) {
        st.plan = priapismStep(t);
        st.resolvedAt = t + (st.plan === 'aspiration' ? 0.5 : st.plan === 'distalShunt' ? 2 : 3);
        emit(st.plan, { h: Math.round(t) });
        if (t > 72) emit('noRecovery');
      }
      if (st.rigid && st.resolvedAt !== null && t >= st.resolvedAt) { st.rigid = false; emit('detumescence'); }
      if (st.rigid) { st.hIsch = t; Object.assign(st, ischemicGas(t)); }
      else { st.pO2 = relax(st.pO2, 40, dt, 0.5); st.pCO2 = relax(st.pCO2, 45, dt, 0.5); st.pH = relax(st.pH, 7.36, dt, 0.5); }
      if (st.rigid && t >= 4) emit('fourHours');
      st.damage = priapismDamage(st.hIsch) * 100;
    } else {
      if (treated && !st.plan && t >= p.tTx) { st.plan = 'conservative'; emit('conservative'); }
      if (treated && st.plan && !st.embolized && t >= p.tTx + 24) { st.embolized = true; st.rigid = false; emit('embolization'); }
      st.damage = 20; // erectile function preserved in most (Model)
    }
    return st;
  },
  steps(st, p) {
    if (p.type === 'arterial') return ['fistula', 'partial', 'gasArterial', ...(st.plan ? ['conservative'] : []), ...(st.embolized ? ['embolization'] : [])];
    const k = ['venousBlock', 'acidosis'];
    if (st.hIsch >= 4) k.push('emergency');
    if (st.hIsch >= 24) k.push('necrosisRisk');
    if (st.plan) k.push('escalation');
    return k;
  },
  gauges(st) {
    return [
      { key: 'pO2', value: st.pO2, unit: 'mmHg', lo: 30, hi: 100 },
      { key: 'pCO2', value: st.pCO2, unit: 'mmHg', lo: 35, hi: 60 },
      { key: 'pH', value: st.pH, unit: '', lo: 7.25, hi: 7.45 },
    ];
  },
  schematic(st, p) { return { sex: 'm', focus: ['penis'], penis: { state: st.rigid ? (p.type === 'ischemic' ? 'ischemic' : 'arterial') : 'normal', level: st.damage / 100 }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st, p) {
    const g = p.type === 'ischemic' ? ischemicGas(Math.max(st.hIsch, 4)) : { pO2: 95, pCO2: 38, pH: 7.4 };
    return { damage: st.damage, plan: st.plan, classification: classifyPriapism({ ...g, flow: p.type === 'arterial' }) };
  },
};

// ---------------------------------------------------------------------------
// 6. Testicular torsion (acute scrotum)
// ---------------------------------------------------------------------------
/** Testicular survival vs hours from onset (Mellick et al., systematic review 2019). */
export const TORSION_SURVIVAL = [[0, 100], [3, 97.2], [9.5, 79.3], [15.5, 61.3], [21.5, 42.5], [36.5, 24.4], [60, 7.4], [72, 5]];
/** Effective ischaemic time grows with the number of twists (Model: ∝ √(degrees/720)). */
export const torsionSurvival = (h, degrees = 720) => interp(TORSION_SURVIVAL, h * Math.sqrt(degrees / 720));
/** TWIST-type score from the clinical signs: ≤2 rules torsion out, ≥5 confirms it, 3–4 needs Doppler. */
export function twistScore(s) {
  return (s.nausea ? 1 : 0) + (s.swelling ? 2 : 0) + (s.hard ? 2 : 0) + (s.highRiding ? 1 : 0) + (s.noCremaster ? 1 : 0);
}
export function twistBand(score) { return score <= 2 ? 'low' : score >= 5 ? 'high' : 'intermediate'; }

export const torsion = {
  id: 'torsion', mode: 'urg', unit: 'h', tMax: 72, dt: 0.25,
  region: ['scrotum'],
  params: [
    { key: 'degrees', type: 'range', min: 180, max: 1080, step: 90, def: 720, unit: '°' },
    { key: 'tTx', type: 'range', min: 1, max: 70, step: 1, def: 4, unit: 'h' },
    { key: 'nausea', type: 'bool', def: true },
    { key: 'swelling', type: 'bool', def: true },
    { key: 'hard', type: 'bool', def: true },
    { key: 'highRiding', type: 'bool', def: true },
    { key: 'noCremaster', type: 'bool', def: true },
  ],
  series: [
    { key: 'viability', unit: '%', min: 0, max: 100 },
    { key: 'flow', unit: '%', min: 0, max: 100 },
  ],
  init(p) { return { viability: 100, flow: p.degrees >= 360 ? 5 : 40, detorsed: false, surgery: null }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.detorsed && t >= p.tTx) { st.detorsed = true; st.flow = 100; emit('detorsion'); }
    if (st.detorsed && !st.surgery && t >= p.tTx + 1) { st.surgery = st.viability >= 50 ? 'orchidopexy' : 'orchiectomy'; emit(st.surgery, { v: Math.round(st.viability) }); }
    if (!st.detorsed) st.viability = torsionSurvival(t, p.degrees);
    if (!st.detorsed && t >= 6) emit('sixHours');
    if (!st.detorsed && t >= 24) emit('dayOne');
    return st;
  },
  steps(st) {
    const k = ['bellClapper', 'venous', 'arterial', 'signs', 'twist'];
    if (st.detorsed) k.push('detorsion');
    if (st.surgery) k.push('fixation');
    return k;
  },
  gauges(st, p) { return [{ key: 'twist', value: twistScore(p), unit: '/7', lo: 0, hi: 7, band: false }]; },
  schematic(st) { return { sex: 'm', focus: ['scrotum'], scrotum: { side: 'L', testis: { viability: st.viability / 100, elevated: !st.detorsed, twist: !st.detorsed, lost: st.surgery === 'orchiectomy' } }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { viability: st.viability, surgery: st.surgery }; },
};

// ---------------------------------------------------------------------------
// 7. Torsion of a testicular appendage
// ---------------------------------------------------------------------------
export const appendix = {
  id: 'appendix', mode: 'urg', unit: 'd', tMax: 14, dt: 0.05,
  region: ['scrotum'],
  params: [{ key: 'rest', type: 'bool', def: true }],
  series: [{ key: 'pain', unit: '/10', min: 0, max: 10 }],
  init() { return { pain: 5, rx: false }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.rx) { st.rx = true; emit('nsaid'); }
    st.pain = t < 1 ? relax(st.pain, 6, dt, 0.5) : relax(st.pain, 0, dt, st.rx ? 2.5 : 4);
    return st;
  },
  steps(st, p, arm) { return ['subacute', 'blueDot', 'cremaster', ...(arm === 'treated' ? ['conservative'] : [])]; },
  schematic(st) { return { sex: 'm', focus: ['scrotum'], scrotum: { side: 'L', testis: { viability: 1 }, blueDot: st.pain / 6 }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { pain: st.pain }; },
};

// ---------------------------------------------------------------------------
// 8. Renal trauma
// ---------------------------------------------------------------------------
const RENAL_BLEED = [0, 3, 12, 40, 300]; // mL/h at presentation by AAST grade I–V (Model)
export function renalManagement(grade, activeBleed, penetrating, unstable) {
  if (unstable || grade === 5) return 'surgery';
  if (penetrating && grade >= 3) return 'exploration';
  if (activeBleed) return 'embolization';
  return 'observation';
}
export const renalTrauma = {
  id: 'renalTrauma', mode: 'urg', unit: 'h', tMax: 72, dt: 0.25,
  region: ['kidney'],
  params: [
    { key: 'grade', type: 'range', min: 1, max: 5, step: 1, def: 4, unit: 'AAST' },
    { key: 'mechanism', type: 'select', options: ['blunt', 'penetrating'], def: 'blunt' },
    { key: 'activeBleed', type: 'bool', def: true },
    { key: 'tTx', type: 'range', min: 0.5, max: 24, step: 0.5, def: 2, unit: 'h' },
  ],
  series: [
    { key: 'hb', unit: 'g/dL', min: 0 },
    { key: 'map', unit: 'mmHg', min: 0 },
    { key: 'hematoma', unit: 'mL', min: 0 },
  ],
  init(p) { return { hb: 14 - p.grade / 10, map: 85, hematoma: 50 * p.grade, loss: 50 * p.grade, urinoma: 0, plan: null, stopped: false, stent: false, unstable: false, rate: 0, tx: 0 }; },
  step(st, t, dt, p, arm, emit) {
    const g = p.grade;
    const treated = arm === 'treated';
    const pen = p.mechanism === 'penetrating';
    let rate = RENAL_BLEED[g - 1] * (p.activeBleed ? 2.5 : 1) * (pen ? 1.5 : 1);
    rate *= g === 5 ? 1 : Math.exp(-t / 12); // tamponade within Gerota's fascia except grade V
    if (st.map < 65 && !st.unstable) { st.unstable = true; emit('unstable'); }
    if (treated && !st.plan && (t >= p.tTx || st.unstable)) {
      st.plan = renalManagement(g, p.activeBleed, pen, st.unstable);
      emit(st.plan);
      if (st.plan !== 'observation') st.stopped = true;
    }
    st.rate = st.stopped ? 0 : rate;
    st.loss = Math.min(3500, st.loss + st.rate * dt); // >2 L lost: class IV haemorrhage, death if not controlled
    if (st.loss > 2000) emit('exsanguination');
    st.hematoma = st.loss;
    // Restrictive transfusion (Hb <7 g/dL) in the managed arm.
    if (treated && st.hb < 7) { st.tx += 1; emit('transfusion', { n: st.tx }, false); }
    st.hb = Math.max(3, 14 - st.loss / 500 + st.tx);
    st.map = Math.max(0, relax(st.map, 85 - Math.max(0, st.loss - 700) / 30 + (st.stopped ? 20 : 0) + 3 * st.tx, dt, 0.5));
    if (g >= 4) {
      st.urinoma += (st.stent ? -st.urinoma * 0.2 : 15) * dt;
      if (st.urinoma > 500) emit('urinoma');
      if (treated && !st.stent && t >= 48 && st.plan !== 'surgery') { st.stent = true; emit('stent'); }
    }
    return st;
  },
  steps(st, p) {
    const k = ['mechanism', 'grade', 'ct'];
    if (st.unstable) k.push('instability');
    if (st.plan) k.push('management');
    return k;
  },
  gauges(st) { return [{ key: 'hb', value: st.hb, unit: 'g/dL', lo: 12, hi: 17 }, { key: 'map', value: st.map, unit: 'mmHg', lo: 65, hi: 110 }]; },
  schematic(st, p) { return { sex: 'm', focus: ['kidneyL'], kidneys: { L: { lesion: p.grade / 5, hematoma: clamp(st.hematoma / 2000, 0, 1), urinoma: clamp(st.urinoma / 1000, 0, 1), absent: st.plan === 'surgery' && p.grade === 5 }, R: {} }, ureters: { L: { stent: st.stent }, R: {} }, bladder: { vol: 0.3 }, systemic: st.unstable ? 0.6 : 0 }; },
  outcome(st) { return { hb: st.hb, plan: st.plan, unstable: st.unstable }; },
};

// ---------------------------------------------------------------------------
// 9. Ureteral trauma
// ---------------------------------------------------------------------------
/** Repair by AAST grade and third (EAU urotrauma). */
export function ureterRepair(grade, third) {
  if (grade <= 2) return 'stent';
  if (grade === 5) return 'ilealUreter';
  return { proximal: 'ureteroureterostomyProximal', middle: 'boari', distal: 'reimplantPsoas' }[third];
}
export const ureterTrauma = {
  id: 'ureterTrauma', mode: 'urg', unit: 'd', tMax: 14, dt: 0.05,
  region: ['ureter'],
  params: [
    { key: 'grade', type: 'range', min: 1, max: 5, step: 1, def: 3, unit: 'AAST' },
    { key: 'third', type: 'select', options: ['proximal', 'middle', 'distal'], def: 'distal' },
    { key: 'cause', type: 'select', options: ['gyn', 'colorectal', 'urologic', 'gunshot', 'blunt'], def: 'gyn' },
    { key: 'intraop', type: 'bool', def: false },
  ],
  series: [
    { key: 'urinoma', unit: 'mL', min: 0 },
    { key: 'temp', unit: '°C' },
  ],
  init() { return { urinoma: 0, temp: 36.8, dx: false, repaired: null, infected: 0, fistula: false }; },
  step(st, t, dt, p, arm, emit) {
    const leak = [0, 0.2, 0.5, 1, 1][p.grade - 1];
    const treated = arm === 'treated';
    const tDx = p.intraop ? 0 : 2;
    if (treated && !st.dx && t >= tDx) { st.dx = true; emit(p.intraop ? 'intraop' : 'ctExtravasation'); st.repaired = ureterRepair(p.grade, p.third); emit('repair', { how: st.repaired }); }
    if (st.repaired) st.urinoma = relax(st.urinoma, 0, dt, 1);
    else st.urinoma = Math.max(0, st.urinoma + (600 * leak - 0.2 * st.urinoma) * dt);
    st.infected = st.repaired ? relax(st.infected, 0, dt, 1.5) : clamp(st.infected + (st.urinoma > 300 && t > 3 ? 0.25 : 0) * dt, 0, 1);
    st.temp = 36.8 + 2.4 * st.infected;
    if (st.temp > 38) emit('fever');
    if (!st.repaired && t > 7 && leak >= 0.5 && !st.fistula) { st.fistula = true; emit('fistula', { cause: p.cause }); }
    return st;
  },
  steps(st, p) {
    const k = ['mechanism', 'silent'];
    if (st.dx) k.push('imaging');
    if (st.repaired) k.push('repair');
    if (st.fistula) k.push('fistula');
    return k;
  },
  schematic(st, p) { return { sex: p.cause === 'gyn' ? 'f' : 'm', focus: ['ureterL'], kidneys: { L: { dil: st.repaired ? 0.1 : 0.35 }, R: {} }, ureters: { L: { leak: clamp(st.urinoma / 1500, 0, 1), third: p.third, stent: !!st.repaired }, R: {} }, bladder: { vol: 0.3 }, systemic: st.infected * 0.5 }; },
  outcome(st) { return { repaired: st.repaired, fistula: st.fistula }; },
};

// ---------------------------------------------------------------------------
// 10. Bladder trauma
// ---------------------------------------------------------------------------
export function bladderManagement(type, penetrating) {
  return type === 'extraperitoneal' && !penetrating ? 'catheter' : 'surgery';
}
export const bladderTrauma = {
  id: 'bladderTrauma', mode: 'urg', unit: 'd', tMax: 14, dt: 0.05,
  region: ['bladder'],
  params: [
    { key: 'type', type: 'select', options: ['extraperitoneal', 'intraperitoneal'], def: 'intraperitoneal' },
    { key: 'penetrating', type: 'bool', def: false },
    { key: 'pelvicFracture', type: 'bool', def: true },
  ],
  series: [
    { key: 'collection', unit: 'mL', min: 0 },
    { key: 'cr', unit: 'mg/dL', min: 0 },
  ],
  init() { return { collection: 100, cr: 0.9, plan: null, leak: 1, peritonitis: 0, cysto: false }; },
  step(st, t, dt, p, arm, emit) {
    const intra = p.type === 'intraperitoneal';
    if (arm === 'treated' && !st.plan && t >= 0.25) { st.plan = bladderManagement(p.type, p.penetrating); emit(st.plan); }
    if (st.plan === 'surgery') st.leak = 0;
    else if (st.plan === 'catheter') st.leak = relax(st.leak, 0, dt, 3);
    // Leaking urine: intraperitoneal ≈ all diuresis into the peritoneum (reabsorbed → creatinine rises);
    // extraperitoneal ≈ partial leak into the perivesical space. Model.
    const leakRate = (intra ? 1400 : 600) * st.leak;
    st.collection = Math.max(0, st.collection + (leakRate - (st.plan ? 0.8 : 0.3) * st.collection) * dt);
    st.cr = intra && !st.plan ? Math.min(8, st.cr + 0.4 * dt) : relax(st.cr, 0.9, dt, 1);
    if (intra && !st.plan) { st.peritonitis = clamp(st.peritonitis + 0.35 * dt, 0, 1); if (st.peritonitis > 0.5) emit('peritonitis'); }
    if (!intra && !st.plan && t > 4) emit('pelvicAbscess');
    if (st.plan === 'catheter' && !st.cysto && t >= 10) { st.cysto = true; emit('cystogram'); }
    return st;
  },
  steps(st, p) {
    const k = ['mechanism', p.type === 'intraperitoneal' ? 'intra' : 'extra', 'cystography'];
    if (st.plan) k.push('management');
    return k;
  },
  schematic(st, p) { return { sex: 'm', focus: ['bladder'], bladder: { vol: 0.25, leak: p.type === 'intraperitoneal' ? 'intra' : 'extra', leakLevel: clamp(st.collection / 2500, 0, 1) }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} }, marks: p.pelvicFracture ? ['pelvicFracture'] : [], systemic: st.peritonitis * 0.5 }; },
  outcome(st) { return { plan: st.plan, cr: st.cr }; },
};

// ---------------------------------------------------------------------------
// 11. Urethral trauma
// ---------------------------------------------------------------------------
export function urethralManagement(segment, extent, sex) {
  if (sex === 'f') return 'immediateRepair';
  if (extent === 'partial') return segment === 'anterior' ? 'catheter' : 'realignment';
  return 'cystostomyDelayed';
}
export const urethralTrauma = {
  id: 'urethralTrauma', mode: 'urg', unit: 'd', tMax: 120, dt: 0.25,
  region: ['urethra'],
  params: [
    { key: 'segment', type: 'select', options: ['anterior', 'posterior'], def: 'posterior' },
    { key: 'extent', type: 'select', options: ['partial', 'complete'], def: 'complete' },
    { key: 'sexPatient', type: 'select', options: ['m', 'f'], def: 'm' },
  ],
  series: [
    { key: 'patency', unit: '%', min: 0, max: 100 },
    { key: 'vol', unit: 'mL', min: 0 },
  ],
  init(p) { return { patency: p.extent === 'complete' ? 0 : 50, vol: 300, plan: null, healed: false, repaired: false }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    if (treated && !st.plan && t >= 0.1) { st.plan = urethralManagement(p.segment, p.extent, p.sexPatient); emit(st.plan); }
    const drained = !!st.plan;
    if (st.plan === 'immediateRepair') st.patency = relax(st.patency, 95, dt, 5);
    else if (st.plan === 'catheter' || st.plan === 'realignment') { st.patency = relax(st.patency, 85, dt, 7); if (t >= 21 && !st.healed) { st.healed = true; emit('urethrogram'); } }
    else if (st.plan === 'cystostomyDelayed') {
      if (t >= 90 && !st.repaired) { st.repaired = true; emit('urethroplasty'); }
      st.patency = st.repaired ? relax(st.patency, 95, dt, 3) : relax(st.patency, 0, dt, 10);
    } else st.patency = relax(st.patency, p.extent === 'complete' ? 0 : 15, dt, 20); // untreated: stricture
    const outflow = drained ? 1 : st.patency / 100;
    st.vol = drained ? relax(st.vol, 80, dt, 0.1) : clamp(st.vol + (1400 * (1 - outflow) - 0.05 * st.vol) * dt, 0, 1500);
    if (!drained && st.vol > 800) emit('retention');
    if (!drained && st.patency < 30 && t > 30) emit('stricture');
    return st;
  },
  steps(st, p) {
    const k = ['mechanism', 'signs', 'noBlindCath', 'urethrography'];
    if (st.plan) k.push('drainage');
    if (st.repaired || st.healed) k.push('repair');
    return k;
  },
  schematic(st, p) { return { sex: p.sexPatient, focus: ['urethra'], urethra: { lesion: p.segment, patency: st.patency / 100 }, bladder: { vol: clamp(st.vol / 1100, 0.1, 1), catheter: st.plan === 'cystostomyDelayed' ? 'suprapubic' : st.plan ? 'urethral' : null }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} }, marks: p.segment === 'posterior' ? ['pelvicFracture'] : ['straddle'] }; },
  outcome(st) { return { patency: st.patency, plan: st.plan }; },
};

// ---------------------------------------------------------------------------
// 12. Penile fracture
// ---------------------------------------------------------------------------
/** Long-term complications (curvature, plaque, erectile dysfunction): conservative ≈35%, early repair ≈5–10%,
 *  rising with surgical delay. Model. */
export const penileComplication = (surgeryHours) => (surgeryHours === null ? 35 : clamp(5 + (Math.max(0, surgeryHours - 24) / 24) * 5, 5, 20));
export const penileFracture = {
  id: 'penileFracture', mode: 'urg', unit: 'd', tMax: 60, dt: 0.25,
  region: ['penis'],
  params: [
    { key: 'urethra', type: 'bool', def: false },
    { key: 'tSurg', type: 'range', min: 2, max: 120, step: 2, def: 8, unit: 'h' },
  ],
  series: [
    { key: 'hematoma', unit: '%', min: 0, max: 100 },
    { key: 'complication', unit: '%', min: 0, max: 100 },
  ],
  init() { return { hematoma: 80, complication: 0, operated: false }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.operated && t * 24 >= p.tSurg) { st.operated = true; emit('repair', { h: p.tSurg }); }
    st.hematoma = relax(st.hematoma, 0, dt, st.operated ? 3 : 10);
    const target = st.operated ? penileComplication(p.tSurg) : penileComplication(null);
    st.complication = target * (1 - Math.exp(-t / 20));
    if (p.urethra && !st.operated && t > 0.5) emit('urethraRisk');
    return st;
  },
  steps(st, p) { const k = ['mechanism', 'snap', 'mri']; if (p.urethra) k.push('urethra'); if (st.operated) k.push('repair'); return k; },
  schematic(st, p) { return { sex: 'm', focus: ['penis'], penis: { state: 'fracture', level: st.hematoma / 100, urethra: p.urethra }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { complication: st.complication }; },
};

// ---------------------------------------------------------------------------
// 13. Scrotal and testicular trauma
// ---------------------------------------------------------------------------
/** Explore if tunica albuginea rupture (or doubt), haematocele >3× the contralateral testis, or irreducible dislocation. */
export const needsScrotalExploration = (p) => p.rupture || p.hematocele > 3 || p.dislocation;
export const scrotalTrauma = {
  id: 'scrotalTrauma', mode: 'urg', unit: 'd', tMax: 30, dt: 0.1,
  region: ['scrotum'],
  params: [
    { key: 'rupture', type: 'bool', def: true },
    { key: 'hematocele', type: 'range', min: 1, max: 6, step: 0.5, def: 2.5, unit: '×' },
    { key: 'dislocation', type: 'bool', def: false },
    { key: 'tSurg', type: 'range', min: 2, max: 168, step: 2, def: 12, unit: 'h' },
  ],
  series: [
    { key: 'viability', unit: '%', min: 0, max: 100 },
    { key: 'hematoma', unit: '×', min: 0 },
  ],
  init(p) { return { viability: 100, hematoma: p.hematocele, plan: null }; },
  step(st, t, dt, p, arm, emit) {
    const explore = needsScrotalExploration(p);
    if (arm === 'treated' && !st.plan && t * 24 >= (explore ? p.tSurg : 1)) { st.plan = explore ? 'exploration' : 'observation'; emit(st.plan); }
    // Untreated rupture: progressive loss (Model: salvage falls towards ~35% by day 7; early repair keeps ~90%).
    if (p.rupture && st.plan !== 'exploration') st.viability = relax(st.viability, 35, dt, 3);
    st.hematoma = st.plan === 'exploration' ? relax(st.hematoma, 1, dt, 1) : relax(st.hematoma, 1, dt, 8);
    return st;
  },
  steps(st, p) { const k = ['mechanism', 'ultrasound']; k.push(needsScrotalExploration(p) ? 'criteria' : 'noCriteria'); if (st.plan) k.push('management'); return k; },
  schematic(st) { return { sex: 'm', focus: ['scrotum'], scrotum: { side: 'L', hematoma: clamp((st.hematoma - 1) / 5, 0, 1), testis: { viability: st.viability / 100 } }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { viability: st.viability, plan: st.plan }; },
};

export const EMERGENCIES = [hematuria, fournier, sepsis, paraphimosis, priapism, torsion, appendix, renalTrauma, ureterTrauma, bladderTrauma, urethralTrauma, penileFracture, scrotalTrauma];
