// Urinary obstruction and urolithiasis.
// Time units: 'd' days, 'h' hours, 'mo' months, 'y' years.
import { clamp, relax, logistic, interp } from './core.js';

// ---------------------------------------------------------------------------
// Shared physiology helpers
// ---------------------------------------------------------------------------

/** Baseline serum creatinine (mg/dL) in a healthy adult. */
export const CR0 = 0.9;
/** Creatinine generation scaled so that anuria raises it ~1.2 mg/dL/day (typical 1–1.5). Model. */
export const CR_PROD = 1.2;
const CR_K = CR_PROD / CR0; // per day per unit GFR fraction

/** One creatinine step. g = total GFR fraction (1 = normal), dtDays. */
export function creatStep(cr, g, dtDays) {
  return clamp(cr + (CR_PROD - CR_K * g * cr) * dtDays, 0.3, 15); // >15 mg/dL: untreated uraemia (display cap)
}

/** Potassium step (mEq/L). u = urine output fraction (0 anuria – 1 normal). Model: +0.5/day in anuria. */
export function potassiumStep(k, u, dtDays) {
  return clamp(k + (0.5 * (1 - u) - 0.8 * u * (k - 4.2)) * dtDays, 2.5, 9);
}

/**
 * Irreversible fraction of function lost after `obDays` of complete obstruction.
 * Classic experimental data (Vaughan & Gillenwater): full recovery if relieved within 7 days,
 * ~70% recovery at 14 days, ~30% at 4 weeks, none after ~6 weeks.
 */
export function irreversibleLoss(obDays) {
  return interp([[0, 0], [7, 0], [14, 0.3], [28, 0.7], [42, 1]], obDays);
}

/** Weight of an obstruction degree O (0–1) towards "complete-obstruction days". Model. */
const obWeight = (O) => Math.pow(clamp((O - 0.5) / 0.5, 0, 1), 2);

// ---------------------------------------------------------------------------
// Ureteral stone passage
// ---------------------------------------------------------------------------

/** Location shifts of the 50% passage size (mm). Distal stones pass more often. Model. */
export const LOC_SHIFT = { upj: -1, iliac: 0, uvj: 1 };

/**
 * Probability of spontaneous passage of a ureteral stone.
 * Calibrated to: 2–4 mm ≈ 95%, ≤5 mm ≈ 68–80%, 5–10 mm ≈ 47%, >10 mm unlikely
 * (AUA/EAU ureteral stones meta-analysis; CT cohorts). Logistic, Model.
 * Medical expulsive therapy (alpha-blocker): RR 1.45 for stones >5 mm, no effect ≤5 mm (Cochrane 2018).
 */
export function passageProbability(sizeMm, loc = 'iliac', met = false) {
  const s50 = 6 + (LOC_SHIFT[loc] ?? 0);
  let pr = 1 / (1 + Math.exp(0.95 * (sizeMm - s50)));
  if (met && sizeMm > 5) pr = Math.min(0.98, pr * 1.45);
  return clamp(pr, 0, 1);
}

/**
 * Expected time to passage (days). Miller & Kane: ≤2 mm ~8 d, 2–4 mm ~12 d, 4–6 mm ~22 d.
 * Alpha-blocker shortens it (~3–4 days). Model.
 */
export function passageTime(sizeMm, loc = 'iliac', met = false) {
  const base = Math.max(3, 4.7 * sizeMm - 1.5);
  const locF = { upj: 1.2, iliac: 1, uvj: 0.8 }[loc] ?? 1;
  return base * locF * (met ? 0.8 : 1);
}

/** Obstruction degree caused by a ureteral stone of a given size (0–1). Model. */
export const stoneObstruction = (sizeMm) => clamp(0.35 + 0.09 * sizeMm, 0, 1);

/** Position (0 = pelvis, 1 = bladder) of each narrowing along the ureter, for the schematic. */
export const LOC_POS = { upj: 0.05, iliac: 0.5, uvj: 0.95 };

/** Indications for urgent urinary diversion in renal colic ("MIRO"). */
export function diversionIndications(p, completePersistent) {
  const r = [];
  if (p.solitary) r.push('solitary');
  if (p.infection) r.push('infection');
  if (p.refractory) r.push('refractory');
  if (completePersistent) r.push('complete');
  return r;
}

// ---------------------------------------------------------------------------
// 1. Renal colic / ureteral stone
// ---------------------------------------------------------------------------
export const colic = {
  id: 'colic', mode: 'obs', unit: 'd', tMax: 42, dt: 0.125,
  region: ['ureter'],
  params: [
    { key: 'size', type: 'range', min: 2, max: 15, step: 1, def: 8, unit: 'mm' },
    { key: 'loc', type: 'select', options: ['upj', 'iliac', 'uvj'], def: 'iliac' },
    { key: 'infection', type: 'bool', def: false },
    { key: 'solitary', type: 'bool', def: false },
    { key: 'refractory', type: 'bool', def: false },
  ],
  series: [
    { key: 'pain', unit: '/10', min: 0, max: 10 },
    { key: 'fgAff', unit: '%', min: 0, max: 100 },
    { key: 'cr', unit: 'mg/dL', min: 0 },
    { key: 'temp', unit: '°C' },
  ],
  init(p) {
    return {
      stone: true, stonePos: LOC_POS[p.loc], O: stoneObstruction(p.size), D: 0.15,
      ob: 0, L: 0, gAff: 1, cr: CR0, k: 4.2, temp: p.infection ? 38.5 : 36.8,
      pain: 9, sepsis: p.infection ? 0.5 : 0, diverted: false, removed: false, passed: false, analgesia: false,
      met: false, fgAff: 100, diuresis: 60,
    };
  },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    const met = treated && p.size > 5 && p.size <= 10;
    const pPass = passageProbability(p.size, p.loc, met);
    const tPass = passageTime(p.size, p.loc, met);
    if (treated && !st.analgesia) { st.analgesia = true; emit('analgesia'); if (met) emit('met'); }
    // Stone passes on its expected day when passage is more likely than not.
    if (st.stone && pPass >= 0.5 && t >= tPass) { st.stone = false; st.passed = true; emit('passed', { d: Math.round(tPass) }); }
    const completePersistent = st.stone && p.size >= 8 && t >= 2;
    const ind = diversionIndications(p, completePersistent);
    if (treated && st.stone && !st.diverted && ind.length && (t >= 0.25 || ind.includes('complete'))) {
      st.diverted = true; emit('diversion', { why: ind.join(',') });
    }
    // Planned definitive removal when spontaneous passage is unlikely (Model: day 7 after assessment, or day 28 at latest).
    if (treated && st.stone && (pPass < 0.5 ? t >= 7 : t >= 28)) {
      st.stone = false; st.removed = true; emit('urs');
    }
    const obstructing = st.stone && !st.diverted;
    const Otarget = obstructing ? stoneObstruction(p.size) : 0;
    st.O = Otarget;
    st.D = relax(st.D, obstructing ? st.O : 0.05, dt, obstructing ? 0.8 : 3);
    st.ob += dt * obWeight(st.O);
    const Lnew = irreversibleLoss(st.ob);
    if (Lnew > 0 && st.L === 0) emit('irreversible');
    st.L = Lnew;
    const gTarget = (1 - st.L) * (1 - 0.7 * st.O);
    st.gAff = relax(st.gAff, gTarget, dt, st.O > 0 ? 0.5 : 2.5);
    const gOther = p.solitary ? 0 : 1;
    // A solitary kidney carries the whole GFR (compensatory hypertrophy); otherwise each kidney is half.
    // Effective clearance of the obstructed kidney falls with the degree of obstruction (no outflow = no clearance).
    const clAff = st.gAff * (1 - 0.95 * st.O);
    // The contralateral kidney compensates partly (hyperfiltration up to +30%). Model.
    const G = p.solitary ? clAff : (clAff + gOther * (1 + 0.3 * (1 - clAff))) / 2;
    st.cr = creatStep(st.cr, G, dt);
    const flow = st.gAff * (1 - st.O) + gOther;
    st.diuresis = 30 * flow;
    if (p.solitary && obstructing && st.O > 0.9) emit('anuria');
    st.k = potassiumStep(st.k, clamp(flow / (p.solitary ? 1 : 2), 0, 1), dt);
    // Pain: colic peaks early with acute distension and fades as pressure falls; analgesia (NSAID → opioid) ×0.3.
    const colicPain = obstructing ? clamp(9 * st.O * Math.exp(-t / 4) + 2.5 * st.O, 0, 10) : (st.stone ? 1 : 0);
    st.pain = treated ? colicPain * (p.refractory && !st.diverted ? 0.7 : 0.3) : colicPain;
    // Infection behind an obstruction: pyonephrosis → sepsis unless drained (diversion + antibiotics).
    if (p.infection) {
      const drained = !obstructing;
      const rate = drained ? (treated ? -1 : -0.2) : (treated ? 0.08 : 0.35);
      st.sepsis = clamp(st.sepsis + rate * dt * (rate > 0 ? 1 - st.sepsis : Math.max(st.sepsis, 0.05) * 2), 0, 1);
      st.temp = 36.8 + 3.4 * st.sepsis;
      if (st.sepsis > 0.75) emit('sepsis');
    } else {
      st.temp = 36.8 + (obstructing ? 0.2 : 0);
    }
    st.fgAff = st.gAff * 100;
    return st;
  },
  steps(st, p) {
    const k = [];
    if (st.stone) k.push('obstacle');
    if (st.stone && !st.diverted && st.O > 0.4) k.push('pressure', 'gfr');
    if (p.infection && st.stone && !st.diverted) k.push('infection');
    if (st.diverted) k.push('diversion');
    if (st.passed || st.removed) k.push('cleared');
    if (st.L > 0) k.push('damage');
    return k;
  },
  gauges(st, p) {
    return [
      { key: 'passProb', value: passageProbability(p.size, p.loc, false) * 100, unit: '%', lo: 0, hi: 100, band: false },
      { key: 'passProbMet', value: passageProbability(p.size, p.loc, p.size > 5) * 100, unit: '%', lo: 0, hi: 100, band: false },
    ];
  },
  schematic(st, p) {
    return {
      sex: 'm', focus: ['ureterL'],
      kidneys: { L: { dil: st.D, fn: st.gAff, inflame: p.infection ? Math.max(0.3, st.sepsis) : 0 }, R: { dil: 0, fn: p.solitary ? 0.05 : 1, absent: p.solitary } },
      ureters: { L: { dil: st.stone && !st.diverted ? st.D * 0.8 : 0, stone: st.stone ? { pos: LOC_POS[p.loc], size: p.size } : null, stent: st.diverted && st.stone } },
      bladder: { vol: 0.35 }, systemic: p.infection ? st.sepsis : 0,
    };
  },
  outcome(st, p) {
    return { fgFinal: st.gAff * 100, crFinal: st.cr, passed: st.passed, removed: st.removed, diverted: st.diverted };
  },
};

// ---------------------------------------------------------------------------
// 2. Obstructive (post-renal) anuria
// ---------------------------------------------------------------------------
export const anuria = {
  id: 'anuria', mode: 'obs', unit: 'd', tMax: 7, dt: 0.02,
  region: ['kidneys', 'ureter'],
  params: [
    { key: 'cause', type: 'select', options: ['stonesBilateral', 'stoneSolitary', 'pelvicCancer', 'retroFibrosis', 'nodes'], def: 'pelvicCancer' },
    { key: 'k0', type: 'range', min: 4, max: 7.5, step: 0.1, def: 5.6, unit: 'mEq/L' },
    { key: 'anticoag', type: 'bool', def: false },
    { key: 'tDeriv', type: 'range', min: 2, max: 72, step: 1, def: 6, unit: 'h' },
  ],
  series: [
    { key: 'diuresis', unit: 'mL/h', min: 0 },
    { key: 'cr', unit: 'mg/dL', min: 0 },
    { key: 'k', unit: 'mEq/L' },
  ],
  init(p) {
    // t = 0 is presentation, about 1 day after the obstruction became complete.
    return { O: 1, D: 0.8, ob: 1, L: 0, g: 0.05, cr: 2.1, k: p.k0, diuresis: 3, hd: false, deriv: false, poly: 0 };
  },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    const tD = p.tDeriv / 24;
    const contraindicated = p.anticoag || p.k0 >= 6.5;
    if (treated && contraindicated && !st.hd && t >= tD) {
      st.hd = true; st.k = 4.5; st.cr = Math.max(1.2, st.cr * 0.45); emit('hd');
    }
    const tDiv = contraindicated ? tD + 1 : tD;
    if (treated && !st.deriv && t >= tDiv) { st.deriv = true; st.poly = 1; emit('diversion'); }
    st.O = st.deriv ? 0 : 1;
    st.D = relax(st.D, st.O ? 0.9 : 0.1, dt, st.O ? 1 : 2);
    st.ob += dt * obWeight(st.O);
    st.L = irreversibleLoss(st.ob);
    st.g = relax(st.g, (1 - st.L) * (st.O ? 0.05 : 1), dt, st.O ? 0.3 : 1);
    // Post-obstructive diuresis after relief: >200 mL/h for the first 1–2 days, then normalises.
    st.poly = st.deriv ? st.poly * Math.exp(-dt / 0.8) : 0;
    st.diuresis = st.O ? 2 : 60 * st.g + 260 * st.poly;
    if (st.deriv && st.diuresis > 200) emit('polyuria');
    st.cr = creatStep(st.cr, st.g, dt);
    st.k = st.hd && t < tDiv ? st.k : potassiumStep(st.k, clamp(st.diuresis / 60, 0, 1), dt);
    if (st.k >= 6.5) emit('hyperK');
    if (st.k >= 7.5) emit('arrhythmia');
    if (st.cr >= 5) emit('uremia');
    if (st.deriv && st.cr < 1.5) emit('recovery');
    return st;
  },
  steps(st, p) {
    const k = ['obstacle', 'noUrine'];
    if (st.O) k.push('azotemia');
    k.push('echo');
    if (st.hd) k.push('hd');
    if (st.deriv) k.push('diversion');
    if (st.deriv && st.diuresis > 200) k.push('polyuria');
    return k;
  },
  gauges(st) {
    return [
      { key: 'k', value: st.k, unit: 'mEq/L', lo: 3.5, hi: 5.5 },
      { key: 'cr', value: st.cr, unit: 'mg/dL', lo: 0.6, hi: 1.2 },
    ];
  },
  schematic(st, p) {
    const solitary = p.cause === 'stoneSolitary';
    const stones = p.cause.startsWith('stone');
    const stoneObj = stones ? { pos: 0.55, size: 7 } : null;
    return {
      sex: p.cause === 'pelvicCancer' ? 'f' : 'm', focus: ['kidneyL', 'kidneyR'],
      kidneys: { L: { dil: st.D, fn: st.g }, R: { dil: solitary ? 0 : st.D, fn: solitary ? 0.05 : st.g, absent: solitary } },
      ureters: { L: { dil: st.O ? 0.7 : 0.1, stone: stoneObj, stent: st.deriv }, R: { dil: solitary ? 0 : (st.O ? 0.7 : 0.1), stone: solitary ? null : stoneObj, stent: st.deriv && !solitary } },
      bladder: { vol: st.O ? 0.05 : 0.3 },
      marks: p.cause === 'pelvicCancer' ? ['pelvicMass'] : p.cause === 'retroFibrosis' ? ['fibrosis'] : p.cause === 'nodes' ? ['nodes'] : [],
    };
  },
  outcome(st) { return { crFinal: st.cr, kFinal: st.k, loss: st.L }; },
};

// ---------------------------------------------------------------------------
// 3. Chronic hydronephrosis / pelvi-ureteric junction obstruction
// ---------------------------------------------------------------------------
export const upj = {
  id: 'upj', mode: 'obs', unit: 'y', tMax: 10, dt: 0.02,
  region: ['kidney'],
  params: [
    { key: 'cause', type: 'select', options: ['intrinsic', 'polarVessel', 'megacalycosis'], def: 'polarVessel' },
    { key: 'stenosis', type: 'range', min: 0.3, max: 1, step: 0.05, def: 0.75, unit: '' },
    { key: 'f0', type: 'range', min: 15, max: 50, step: 1, def: 42, unit: '%' },
    { key: 'tSurg', type: 'range', min: 0, max: 8, step: 0.5, def: 2, unit: 'y' },
  ],
  series: [
    { key: 'split', unit: '%', min: 0, max: 60 },
    { key: 'grade', unit: '0–4', min: 0, max: 4 },
    { key: 'pain', unit: '/10', min: 0, max: 10 },
  ],
  init(p) {
    const S = p.cause === 'megacalycosis' ? 0 : p.stenosis;
    const D = p.cause === 'megacalycosis' ? 0.7 : 0.4;
    return { S, D, split: p.f0, done: null, stone: false, highD: 0, grade: D * 4, pain: p.cause === 'megacalycosis' ? 0.5 : 6 * S * D };
  },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.done && t >= p.tSurg && p.cause !== 'megacalycosis') {
      // Split function on renography decides: ≥20% worth saving (pyeloplasty, ~95% success); <10% nephrectomy. Model thresholds.
      if (st.split >= 10) { st.done = 'pyeloplasty'; st.S = 0.05; emit(st.split >= 20 ? 'pyeloplasty' : 'pyeloplastyBorderline', { f: Math.round(st.split) }); }
      else { st.done = 'nephrectomy'; emit('nephrectomy', { f: Math.round(st.split) }); }
    }
    if (st.done === 'nephrectomy') { st.split = 0; st.D = 0; st.grade = 0; st.pain = 0; return st; }
    const target = p.cause === 'megacalycosis' ? 0.7 : Math.max(0.05, st.S);
    st.D = relax(st.D, target, dt, st.done ? 1.5 : 1);
    // Function falls only with true obstruction (Model: 20%/y × (S − 0.4)^1.5).
    const loss = 20 * Math.pow(Math.max(0, st.S - 0.4), 1.5);
    st.split = Math.max(0, st.split - loss * dt);
    if (st.split < 40 && p.cause !== 'megacalycosis') emit('fnLow');
    if (st.split < 20 && p.cause !== 'megacalycosis') emit('fn20');
    st.highD = st.D > 0.65 && p.cause !== 'megacalycosis' ? st.highD + dt : 0;
    if (st.highD > 2 && !st.stone) { st.stone = true; emit('stone'); }
    st.grade = clamp(st.D * 4, 0, 4);
    st.pain = p.cause === 'megacalycosis' ? 0.5 : clamp(6 * st.S * st.D, 0, 10);
    return st;
  },
  steps(st, p) {
    if (p.cause === 'megacalycosis') return ['ectasia', 'renogramNormal'];
    const k = ['stenosis', 'dilation'];
    if (st.split < 40) k.push('fnLoss');
    if (st.split < 20) k.push('threshold');
    if (st.stone) k.push('stone');
    if (st.done) k.push(st.done);
    return k;
  },
  gauges(st) { return [{ key: 'split', value: st.split, unit: '%', lo: 20, hi: 50 }]; },
  schematic(st, p) {
    return {
      sex: 'm', focus: ['kidneyL'],
      kidneys: { L: { dil: st.D, fn: st.split / 50, absent: st.done === 'nephrectomy', stone: st.stone ? { size: 6, type: 'caox' } : null, upj: p.cause !== 'megacalycosis' }, R: { dil: 0, fn: 1 } },
      ureters: { L: { dil: 0, absent: st.done === 'nephrectomy' } }, bladder: { vol: 0.3 },
      marks: p.cause === 'polarVessel' ? ['polarVessel'] : [],
    };
  },
  outcome(st) { return { split: st.split, done: st.done }; },
};

// ---------------------------------------------------------------------------
// 4. Acute urinary retention
// ---------------------------------------------------------------------------
export const aur = {
  id: 'aur', mode: 'obs', unit: 'h', tMax: 16, dt: 0.05,
  region: ['bladder', 'urethra'],
  params: [
    { key: 'cause', type: 'select', options: ['bph', 'urethralStone', 'stricture', 'drugs', 'gyn', 'valves'], def: 'bph' },
    { key: 'inflow', type: 'range', min: 30, max: 150, step: 5, def: 70, unit: 'mL/h' },
    { key: 'urethralOk', type: 'bool', def: true },
    { key: 'tCath', type: 'range', min: 0.5, max: 12, step: 0.5, def: 2, unit: 'h' },
  ],
  series: [
    { key: 'vol', unit: 'mL', min: 0 },
    { key: 'pain', unit: '/10', min: 0, max: 10 },
  ],
  init() { return { vol: 450, pain: 3, cath: false, cr: CR0 }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.cath && t >= p.tCath) { st.cath = true; emit(p.urethralOk ? 'cathUrethral' : 'cathSuprapubic'); }
    st.vol = st.cath ? relax(st.vol, 0, dt, 0.08) : st.vol + p.inflow * dt;
    st.pain = clamp((st.vol - 350) / 70, 0, 10);
    if (!st.cath && st.vol > 800) emit('massive');
    return st;
  },
  steps(st) {
    const k = ['obstacle', 'filling'];
    if (st.vol > 500 && !st.cath) k.push('mass');
    k.push('upperNormal');
    if (st.cath) k.push('drain');
    return k;
  },
  schematic(st, p) {
    const female = p.cause === 'gyn';
    return {
      sex: female ? 'f' : 'm', focus: ['bladder'],
      kidneys: { L: { dil: 0 }, R: { dil: 0 } }, ureters: { L: {}, R: {} },
      bladder: { vol: clamp(st.vol / 1100, 0.05, 1), pain: st.pain / 10, catheter: st.cath ? (p.urethralOk ? 'urethral' : 'suprapubic') : null },
      prostate: { size: p.cause === 'bph' ? 0.9 : 0.4 },
      marks: p.cause === 'urethralStone' ? ['urethralStone'] : p.cause === 'stricture' ? ['stricture'] : [],
    };
  },
  outcome(st) { return { vol: st.vol }; },
};

// ---------------------------------------------------------------------------
// 5. Chronic urinary retention — Guyon stages
// ---------------------------------------------------------------------------
export const GUYON = { residualSignificant: 100, distension: 400 }; // mL, Model thresholds
export function guyonStage(fatigue, residual) {
  if (fatigue < 1) return 1;
  return residual <= GUYON.distension ? 2 : 3;
}
export const chronicRetention = {
  id: 'chronicRetention', mode: 'obs', unit: 'y', tMax: 8, dt: 0.02,
  region: ['bladder', 'prostate'],
  params: [
    { key: 'cause', type: 'select', options: ['bph', 'stricture', 'prostateCancer', 'neurogenic'], def: 'bph' },
    { key: 'resistance', type: 'range', min: 0.3, max: 1, step: 0.05, def: 0.75, unit: '' },
    { key: 'tTx', type: 'range', min: 0.5, max: 7.5, step: 0.5, def: 7, unit: 'y' },
  ],
  series: [
    { key: 'residual', unit: 'mL', min: 0, get: (st) => st.R },
    { key: 'detrusor', unit: '%', min: 0, max: 150 },
    { key: 'cr', unit: 'mg/dL', min: 0 },
  ],
  init() { return { F: 0, R: 25, hyp: 0, D: 0, ob: 0, L: 0, cr: CR0, res: null, tx: false, detrusor: 100, stage: 1 }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.tx && t >= p.tTx) { st.tx = true; emit('treatment'); }
    const res = st.tx ? 0.1 : p.resistance;
    // Detrusor fatigue accumulates with outlet resistance (Model: 0.35/y at resistance 1).
    if (!st.tx) st.F += 0.35 * res * dt;
    st.hyp = relax(st.hyp, res, dt, 0.8);
    const decomp = Math.max(0, st.F - 1);
    // Once decompensated, part of the detrusor damage is permanent (Model).
    const residualTarget = st.tx ? 20 + 250 * Math.max(0, decomp - 0.6) : 25 + 650 * decomp;
    st.R = relax(st.R, residualTarget, dt, st.tx ? 0.05 : 0.4);
    const stg = guyonStage(st.F, st.R);
    if (stg >= 2 && st.stage < 2) emit('stage2');
    if (stg >= 3 && st.stage < 3) emit('stage3');
    st.stage = st.tx ? Math.min(st.stage, stg) : Math.max(st.stage, stg);
    // Bilateral uretero-hydronephrosis when the bladder is distended (reflux past the ureteric meatus).
    const Oup = st.R > GUYON.distension ? clamp((st.R - GUYON.distension) / 500, 0, 0.8) : 0;
    st.D = relax(st.D, Oup, dt, 0.3);
    st.ob += dt * 365 * Math.pow(st.D, 3) * 0.02; // slow chronic loss (Model)
    st.L = clamp(st.ob / 60, 0, 0.8);
    const g = (1 - st.L) * (1 - 0.6 * st.D);
    st.cr = relax(st.cr, CR0 / Math.max(0.1, g), dt, 0.1);
    if (st.cr > 1.3) emit('renal');
    st.detrusor = 100 + 40 * st.hyp - 60 * Math.min(1, decomp);
    return st;
  },
  steps(st) {
    const k = ['resistance'];
    if (st.stage === 1) k.push('compensation');
    if (st.stage >= 2) k.push('residual');
    if (st.stage >= 3) k.push('distension');
    if (st.D > 0.15) k.push('uhn');
    if (st.tx) k.push('treatment');
    return k;
  },
  gauges(st) { return [{ key: 'residual', value: st.R, unit: 'mL', lo: 0, hi: GUYON.residualSignificant }, { key: 'stage', value: st.stage, unit: '', lo: 1, hi: 3, band: false }]; },
  schematic(st, p) {
    return {
      sex: 'm', focus: ['bladder'],
      kidneys: { L: { dil: st.D }, R: { dil: st.D } }, ureters: { L: { dil: st.D }, R: { dil: st.D } },
      bladder: { vol: clamp(0.2 + st.R / 900, 0.1, 1), wall: st.hyp, catheter: st.tx ? 'urethral' : null },
      prostate: { size: p.cause === 'bph' || p.cause === 'prostateCancer' ? 0.85 : 0.4 },
      marks: p.cause === 'stricture' ? ['stricture'] : [],
    };
  },
  outcome(st) { return { residual: st.R, stage: st.stage, cr: st.cr }; },
};

// ---------------------------------------------------------------------------
// 6. Stone formation: urine chemistry, composition, prevention and treatment choice
// ---------------------------------------------------------------------------

/**
 * Relative supersaturation indices (1 = crystallisation threshold). Model proxies built on
 * the 24-h urine thresholds: calcium >250–300 mg, oxalate >40 mg, uric acid >750 (♀)/800 (♂) mg,
 * cystine >250 mg, citrate <320 mg (hypocitraturia), and the pH dependence of each salt.
 */
export function supersaturation(u) {
  const V = Math.max(0.3, u.V); // L/day
  const citInhib = 2 / (1 + u.cit / 320);
  const caox = (u.ca / V / 125) * (u.ox / V / 20) * citInhib;
  const caP = (u.ca / V / 125) * Math.pow(10, u.pH - 6.6) * citInhib;
  const undissociated = 1 / (1 + Math.pow(10, u.pH - 5.5)); // uric acid pKa ≈ 5.5
  const ua = (u.ua / V) * undissociated / 100;
  const cysSol = u.pH > 7 ? 250 * Math.pow(2, (u.pH - 7) / 0.5) : 250; // mg/L, rises steeply above pH 7
  const cys = (u.cys / V) / cysSol;
  const pHi = u.urease ? Math.max(u.pH, 7.4) : u.pH; // urease splits urea → NH3 → alkaline urine
  const str = u.urease ? 3.5 * clamp((pHi - 6.8) / 0.6, 0, 3) : 0;
  return { caox, caP, ua, cys, str };
}

export const STONE_TYPES = ['caox', 'caP', 'str', 'ua', 'cys'];

export function dominantStone(rss) {
  let best = null, v = 1;
  for (const k of STONE_TYPES) if (rss[k] > v) { v = rss[k]; best = k; }
  return best;
}

/** Urine after specific prevention for a given stone type (EAU urolithiasis metaphylaxis). */
export function preventedUrine(u, type) {
  const r = { ...u, V: Math.max(u.V, 2.5) }; // fluid 2.5–3 L/day for diuresis ≥2–2.5 L
  if (type === 'caox' || type === 'caP') {
    if (u.ca > 250) r.ca = u.ca * 0.6; // thiazide
    if (u.cit < 320) { r.cit = u.cit + 400; r.pH = Math.min(6.6, u.pH + 0.3); } // potassium citrate
    if (u.ox > 40) r.ox = u.ox * 0.75; // diet low in oxalate, normal calcium intake
    if (u.ua > 750) r.ua = u.ua * 0.6; // allopurinol (hyperuricosuric calcium oxalate)
  } else if (type === 'ua') {
    r.pH = 6.8; // alkalinise to pH 6.5–7.2 (citrate / bicarbonate)
    if (u.ua > 750) r.ua = u.ua * 0.6; // allopurinol + less animal protein
  } else if (type === 'str') {
    r.urease = false; r.pH = 6.0; // antibiotics, acetohydroxamic acid, L-methionine; plus complete stone removal
  } else if (type === 'cys') {
    r.V = Math.max(u.V, 3.5); r.pH = 7.5; r.cys = u.cys * 0.5; // high fluids, alkalinise, tiopronin/penicillamine
  }
  return r;
}

/**
 * Active treatment of a renal stone (EAU/AUA): <10 mm SWL or flexible URS; 10–20 mm SWL or endourology
 * (lower pole: URS or PCNL); >20 mm PCNL first line. Uric acid: oral chemolysis. Small asymptomatic calyceal
 * stones may be observed.
 */
export function treatmentChoice(sizeMm, site, type) {
  if (sizeMm < 1) return 'none';
  if (type === 'ua') return 'chemolysis';
  if (type === 'str') return sizeMm > 20 ? 'pcnlStaghorn' : 'removeInfection'; // infection stones: complete clearance
  if (sizeMm < 5 && site !== 'pelvis') return 'observe';
  if (sizeMm < 10) return 'swlOrUrs';
  if (sizeMm <= 20) return site === 'lowerPole' ? 'ursOrPcnl' : 'swlOrEndo';
  return 'pcnl';
}

export const stones = {
  id: 'stones', mode: 'obs', unit: 'mo', tMax: 36, dt: 0.25,
  region: ['kidney'],
  params: [
    { key: 'V', type: 'range', min: 0.8, max: 4, step: 0.1, def: 1.2, unit: 'L/d' },
    { key: 'ca', type: 'range', min: 80, max: 500, step: 10, def: 340, unit: 'mg/24 h' },
    { key: 'ox', type: 'range', min: 10, max: 90, step: 1, def: 38, unit: 'mg/24 h' },
    { key: 'ua', type: 'range', min: 200, max: 1400, step: 10, def: 600, unit: 'mg/24 h' },
    { key: 'cys', type: 'range', min: 0, max: 1000, step: 10, def: 20, unit: 'mg/24 h' },
    { key: 'cit', type: 'range', min: 50, max: 900, step: 10, def: 280, unit: 'mg/24 h' },
    { key: 'pH', type: 'range', min: 4.8, max: 8, step: 0.1, def: 6.0, unit: '' },
    { key: 'urease', type: 'bool', def: false },
    { key: 'site', type: 'select', options: ['calyx', 'pelvis', 'lowerPole'], def: 'calyx' },
    { key: 'tProf', type: 'range', min: 0, max: 30, step: 1, def: 6, unit: 'mo' },
  ],
  series: [
    { key: 'size', unit: 'mm', min: 0 },
    { key: 'rss', unit: '×', min: 0 },
  ],
  init(p) {
    const u = { V: p.V, ca: p.ca, ox: p.ox, ua: p.ua, cys: p.cys, cit: p.cit, pH: p.pH, urease: p.urease };
    const rss = supersaturation(u);
    const type = dominantStone(rss);
    return { u, rss: rss[type] ?? Math.max(...Object.values(rss)), all: rss, type, size: 0, prof: false, crystals: false };
  },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.prof && t >= p.tProf && st.type) {
      st.prof = true; st.u = preventedUrine(st.u, st.type); emit('prevention', { type: st.type });
    }
    st.all = supersaturation(st.u);
    const type = st.type;
    st.rss = type ? st.all[type] : Math.max(...Object.values(st.all));
    if (st.rss > 1) { if (!st.crystals) emit('nucleation', { type }); st.crystals = true; }
    // Growth when supersaturated (struvite grows ~3× faster → staghorn). Uric acid dissolves when undersaturated.
    const kGrow = type === 'str' ? 0.36 : 0.12;
    let d = st.rss > 1 ? kGrow * Math.pow(st.rss - 1, 0.8) : 0;
    if (type === 'ua' && st.rss < 0.8 && st.size > 0) { d = -1.5; }
    const before = st.size;
    st.size = clamp(st.size + d * dt, 0, 45);
    if (before < 4 && st.size >= 4) emit('stone4');
    if (before < 20 && st.size >= 20) emit('stone20');
    if (before > 0 && st.size === 0 && type === 'ua') emit('dissolved');
    return st;
  },
  steps(st) {
    const k = [];
    if (st.rss > 1) k.push('saturation');
    if (st.crystals) k.push('nucleation');
    if (st.size > 0.5) k.push('growth');
    if (st.size > 3) k.push('aggregation');
    if (st.prof) k.push('prevention');
    return k;
  },
  gauges(st) {
    return STONE_TYPES.map((key) => ({ key: 'rss_' + key, value: st.all[key], unit: '×', lo: 0, hi: 1 }));
  },
  schematic(st) {
    return {
      sex: 'm', focus: ['kidneyL'],
      kidneys: { L: { dil: 0.1, stone: st.size > 0.3 ? { size: st.size, type: st.type, staghorn: st.type === 'str' && st.size > 15 } : null }, R: { dil: 0 } },
      ureters: { L: {}, R: {} }, bladder: { vol: 0.3 },
    };
  },
  outcome(st, p) { return { size: st.size, type: st.type, choice: treatmentChoice(st.size, p.site, st.type) }; },
};

export const OBSTRUCTION = [colic, anuria, upj, aur, chronicRetention, stones];
