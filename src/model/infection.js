// Urinary tract infection: from bacteriuria to the organ that becomes inflamed.
import { clamp, relax } from './core.js';

/**
 * Significant bacteriuria thresholds (cfu/mL) by sample / population (EAU urological infections).
 * Suprapubic aspiration: any growth. ≥3 different organisms in a midstream sample = contamination.
 */
export const BACTERIURIA_THRESHOLDS = {
  suprapubic: 1,
  womanSymptomaticPyuria: 1e2,
  cystitis: 1e3,
  pyelonephritis: 1e4,
  complicatedMan: 1e4,
  complicatedWoman: 1e5,
  asymptomatic: 1e5,
  catheterIndwelling: 1e5,
};

export function significantBacteriuria(cfu, population, organisms = 1) {
  if (organisms >= 3 && population !== 'suprapubic') return { significant: false, contamination: true };
  const thr = BACTERIURIA_THRESHOLDS[population];
  if (thr === undefined) throw new Error('unknown population ' + population);
  return { significant: cfu >= thr, contamination: false, threshold: thr };
}

/** Dipstick: nitrite + leucocyte esterase, sensitivity 71%, specificity 83%. Post-test probability (Bayes). */
export function dipstickPostTest(pretest, positive, sens = 0.71, spec = 0.83) {
  const p = clamp(pretest, 0, 1);
  return positive ? (sens * p) / (sens * p + (1 - spec) * (1 - p)) : ((1 - sens) * p) / ((1 - sens) * p + spec * (1 - p));
}

// ---------------------------------------------------------------------------
// 1. Asymptomatic bacteriuria
// ---------------------------------------------------------------------------

/**
 * Risk of a symptomatic complication over the follow-up window without / with treatment.
 * Pregnancy: untreated pyelonephritis ≈20–35%, treatment RR ≈0.24 (Cochrane 2019).
 * Endoscopic urological procedures breaching mucosa: treat beforehand (EAU, IDSA 2019).
 * Elderly, indwelling catheter, diabetes, kidney transplant >2 months, spinal cord injury, healthy women:
 * no benefit from treatment (IDSA 2019, EAU), only resistance and adverse effects. Risk values: Model.
 */
export const BA_POPULATIONS = {
  pregnant: { treat: true, untreated: 25, treated: 6 },
  endourology: { treat: true, untreated: 30, treated: 5 },
  elderly: { treat: false, untreated: 8, treated: 8 },
  catheter: { treat: false, untreated: 10, treated: 10 },
  diabetes: { treat: false, untreated: 6, treated: 6 },
  transplant: { treat: false, untreated: 8, treated: 8 },
  healthyWoman: { treat: false, untreated: 3, treated: 3 },
};

export const asymptomatic = {
  id: 'asymptomatic', mode: 'uti', unit: 'd', tMax: 60, dt: 0.25,
  region: ['bladder'],
  params: [
    { key: 'population', type: 'select', options: Object.keys(BA_POPULATIONS), def: 'pregnant' },
    { key: 'germ', type: 'select', options: ['ecoli', 'proteus', 'enterococcus'], def: 'ecoli' },
  ],
  series: [
    { key: 'load', unit: 'log₁₀ ufc/mL', min: 0, max: 8 },
    { key: 'risk', unit: '%', min: 0, max: 100 },
  ],
  init(p, arm, emit) {
    emit('colonised');
    if (p.germ === 'proteus') emit('proteus');
    return { load: 5.3, risk: 0, atb: false, recol: false };
  },
  step(st, t, dt, p, arm, emit) {
    const pop = BA_POPULATIONS[p.population];
    const treated = arm === 'treated';
    if (treated && !st.atb && t >= 1) { st.atb = true; emit(pop.treat ? 'treatIndicated' : 'treatNotIndicated'); }
    if (st.atb && t < 8) st.load = relax(st.load, 0, dt, 1.2);
    else if (st.atb && !pop.treat) { // recolonisation after the course in no-benefit populations
      st.load = relax(st.load, 5.3, dt, 6);
      if (st.load > 4.9 && !st.recol) { st.recol = true; emit('recolonised'); }
    } else if (st.atb) st.load = relax(st.load, 0, dt, 2);
    const rmax = treated ? pop.treated : pop.untreated;
    st.risk = rmax * (1 - Math.exp(-t / 25));
    return st;
  },
  steps(st, p) {
    const pop = BA_POPULATIONS[p.population];
    const k = ['colonisation', 'host'];
    k.push(pop.treat ? 'decisionTreat' : 'decisionNoTreat');
    if (p.germ === 'proteus') k.push('stoneCheck');
    if (st.atb) k.push('course');
    return k;
  },
  gauges(st, p) {
    const pop = BA_POPULATIONS[p.population];
    return [
      { key: 'riskUntreated', value: pop.untreated, unit: '%', lo: 0, hi: 40, band: false },
      { key: 'riskTreated', value: pop.treated, unit: '%', lo: 0, hi: 40, band: false },
    ];
  },
  schematic(st, p) {
    return { sex: p.population === 'pregnant' || p.population === 'healthyWoman' ? 'f' : 'm', focus: ['bladder'], bladder: { vol: 0.35, bacteria: st.load / 7, catheter: p.population === 'catheter' ? 'urethral' : null }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } };
  },
  outcome(st, p) { return { risk: st.risk, recommended: BA_POPULATIONS[p.population].treat }; },
};

// ---------------------------------------------------------------------------
// 2. Acute uncomplicated cystitis
// ---------------------------------------------------------------------------

/**
 * Empirical options and approximate community E. coli resistance in Spain (Model, order of magnitude).
 * Avoid empirical use when local resistance >20% (co-trimoxazole). Fluoroquinolones: EMA 2018 restriction,
 * not for uncomplicated cystitis.
 */
export const CYSTITIS_DRUGS = {
  fosfomycin: { r: 0.04, flag: null },
  nitrofurantoin: { r: 0.04, flag: null },
  cefuroxime: { r: 0.1, flag: null },
  amoxiclav: { r: 0.2, flag: 'secondLine' },
  cotrimoxazole: { r: 0.3, flag: 'noEmpiric' },
  ciprofloxacin: { r: 0.28, flag: 'ema' },
};
/** Spontaneous resolution without antibiotics: ~50% within a week (placebo / ibuprofen trials 25–65%). */
export const CYSTITIS_TAU_UNTREATED = 7 / Math.LN2; // days
export function cystitisSymptomatic(t, arm, drug) {
  const un = Math.exp(-t / CYSTITIS_TAU_UNTREATED);
  if (arm !== 'treated') return un;
  const r = CYSTITIS_DRUGS[drug].r;
  const fast = t <= 0.5 ? 1 : Math.exp(-(t - 0.5) / 1.0);
  return (1 - r) * fast + r * un;
}

export const cystitis = {
  id: 'cystitis', mode: 'uti', unit: 'd', tMax: 14, dt: 0.05,
  region: ['bladder'],
  params: [
    { key: 'drug', type: 'select', options: Object.keys(CYSTITIS_DRUGS), def: 'fosfomycin' },
    { key: 'triad', type: 'bool', def: true },
    { key: 'pregnantOrDm', type: 'bool', def: false },
  ],
  series: [
    { key: 'symptomatic', unit: '%', min: 0, max: 100 },
    { key: 'pnaRisk', unit: '%', min: 0, max: 100 },
  ],
  init(p, arm, emit) { emit(p.triad ? 'triad' : 'singleSymptom'); return { symptomatic: 100, pnaRisk: 0, given: false }; },
  step(st, t, dt, p, arm, emit) {
    if (arm === 'treated' && !st.given) { st.given = true; emit('atb', { drug: p.drug }); }
    st.symptomatic = 100 * cystitisSymptomatic(t, arm, p.drug);
    // Progression to pyelonephritis is rare (Model: ≈2% untreated over two weeks, scaled by persisting symptoms).
    st.pnaRisk = clamp(st.pnaRisk + 0.15 * (st.symptomatic / 100) * dt * (p.pregnantOrDm ? 2 : 1), 0, 100);
    if (arm === 'treated' && t >= 3) emit(st.symptomatic > 15 ? 'reassessCulture' : 'reassessOk');
    if (arm !== 'treated' && t >= 7) emit('selfLimited');
    return st;
  },
  steps(st, p, arm) {
    const k = ['ascent', 'mucosa', 'diagnosis'];
    if (arm === 'treated') k.push('singleDose');
    if (st.symptomatic < 50) k.push('resolution');
    return k;
  },
  gauges(st, p) {
    return [
      { key: 'resistance', value: CYSTITIS_DRUGS[p.drug].r * 100, unit: '%', lo: 0, hi: 20 },
      { key: 'ppvTriad', value: p.triad ? 90 : 80, unit: '%', lo: 0, hi: 100, band: false },
    ];
  },
  schematic(st, p) {
    return { sex: 'f', focus: ['bladder'], bladder: { vol: 0.3, inflame: st.symptomatic / 100, bacteria: st.symptomatic / 120 }, urethra: { bacteria: 0.4 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } };
  },
  outcome(st) { return { symptomaticDay14: st.symptomatic, pnaRisk: st.pnaRisk }; },
};

// ---------------------------------------------------------------------------
// 3. Recurrent cystitis
// ---------------------------------------------------------------------------

/**
 * Relative risk of each prevention option (meta-analyses): continuous / post-coital antibiotic prophylaxis
 * RR ≈0.15–0.2; vaginal oestrogen in post-menopausal women RR ≈0.4; methenamine ≈0.3 (non-inferior to
 * antibiotics); cranberry RR ≈0.74 (Cochrane 2023); D-mannose: insufficient evidence (RR ≈1 in the largest
 * trial); behavioural (stop spermicide, post-coital voiding). Values rounded: Model.
 */
export const PREVENTION = {
  antibioticContinuous: { rr: 0.15, abxPerYear: 365 },
  antibioticPostcoital: { rr: 0.2, abxPerWeekPerAct: 1 },
  vaginalEstriol: { rr: 0.4, postmenopausalOnly: true },
  methenamine: { rr: 0.3 },
  cranberry: { rr: 0.74 },
  dmannose: { rr: 0.95 },
  behavioural: { rr: 0.9, removesSpermicide: true },
};

/** Annual episode rate from risk factors (Model multipliers on a baseline of 1.2/year). */
export function recurrenceRate(p) {
  let l = 1.2 * (1 + 0.25 * p.sex);
  if (p.spermicide) l *= 1.5;
  if (p.menopause) l *= 1.3;
  if (p.childhoodUti) l *= 1.4;
  if (p.motherUti) l *= 1.3;
  if (p.nonSecretor) l *= 1.3;
  return l;
}
export function isRecurrent(episodeTimesMonths) {
  const inWindow = (w) => episodeTimesMonths.some((t0) => episodeTimesMonths.filter((t) => t >= t0 && t < t0 + w).length >= (w === 6 ? 2 : 3));
  return inWindow(6) || inWindow(12);
}

export const recurrent = {
  id: 'recurrent', mode: 'uti', unit: 'mo', tMax: 12, dt: 0.05,
  region: ['bladder', 'urethra'],
  params: [
    { key: 'sex', type: 'range', min: 0, max: 7, step: 1, def: 3, unit: '/sem' },
    { key: 'spermicide', type: 'bool', def: true },
    { key: 'menopause', type: 'bool', def: false },
    { key: 'childhoodUti', type: 'bool', def: false },
    { key: 'motherUti', type: 'bool', def: false },
    { key: 'nonSecretor', type: 'bool', def: false },
    { key: 'prevention', type: 'select', options: Object.keys(PREVENTION), def: 'antibioticContinuous' },
  ],
  series: [
    { key: 'episodes', unit: 'n', min: 0 },
    { key: 'abxDays', unit: 'días', min: 0 },
  ],
  init() { return { episodes: 0, abxDays: 0, times: [], lambda: 0, flagged: false, n: 0 }; },
  step(st, t, dt, p, arm, emit) {
    let l = recurrenceRate(p);
    let abxRate = 0;
    if (arm === 'treated') {
      const pr = PREVENTION[p.prevention];
      if (pr.removesSpermicide && p.spermicide) l /= 1.5;
      const effective = !pr.postmenopausalOnly || p.menopause;
      l *= effective ? pr.rr : 1;
      if (pr.abxPerYear) abxRate = pr.abxPerYear / 12;
      if (pr.abxPerWeekPerAct) abxRate = (p.sex * 52) / 12;
      if (t <= dt + 1e-9) emit(effective ? 'preventionStart' : 'preventionNotApplicable', { option: p.prevention });
    }
    st.lambda = l;
    st.episodes += (l / 12) * dt;
    // Each expected episode costs ~3 days of treatment (or a single fosfomycin dose ≈1 day).
    st.abxDays += abxRate * dt;
    if (Math.floor(st.episodes) > st.n) {
      st.n = Math.floor(st.episodes);
      st.times.push(t);
      st.abxDays += 3;
      emit('episode', { n: st.n }, false);
      if (!st.flagged && isRecurrent(st.times)) { st.flagged = true; emit('criteria'); }
    }
    return st;
  },
  steps(st, p, arm) {
    const k = ['introitus', 'adhesion'];
    if (st.n >= 1) k.push('episode');
    if (st.flagged) k.push('criteria');
    if (arm === 'treated') k.push('prevention');
    return k;
  },
  gauges(st, p) { return [{ key: 'rate', value: st.lambda || recurrenceRate(p), unit: '/año', lo: 0, hi: 3, band: false }]; },
  schematic(st) {
    const frac = st.episodes % 1;
    return { sex: 'f', focus: ['urethra', 'bladder'], bladder: { vol: 0.3, inflame: frac > 0.85 ? 0.8 : 0.1, bacteria: 0.2 }, urethra: { bacteria: 0.5 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } };
  },
  outcome(st) { return { episodes: st.episodes, recurrent: st.flagged, abxDays: st.abxDays }; },
};

// ---------------------------------------------------------------------------
// 4. Acute pyelonephritis (uncomplicated, complicated, obstructive, emphysematous)
// ---------------------------------------------------------------------------
const PNA = {
  // growth/day, sepsis drive, kill time constant (days) with antibiotics, undrained kill τ
  uncomplicated: { r: 0.5, k: 0.01, tau: 0.6 },
  complicated: { r: 0.6, k: 0.04, tau: 1.1 },
  obstructive: { r: 0.8, k: 0.35, tau: 0.8, undrainedTau: 6, needsDrain: 'diversion', drainDelay: 0.25 },
  emphysematous: { r: 0.9, k: 0.5, tau: 1.4, undrainedTau: 8, needsDrain: 'drainage', drainDelay: 0.5 },
};
export const pyelonephritis = {
  id: 'pyelonephritis', mode: 'uti', unit: 'd', tMax: 21, dt: 0.05,
  region: ['kidney'],
  params: [
    { key: 'type', type: 'select', options: Object.keys(PNA), def: 'uncomplicated' },
    { key: 'atbDelay', type: 'range', min: 0, max: 72, step: 1, def: 6, unit: 'h' },
  ],
  series: [
    { key: 'temp', unit: '°C' },
    { key: 'pcr', unit: 'mg/L', min: 0 },
    { key: 'sepsis', unit: '%', min: 0, max: 100 },
  ],
  init(p, arm, emit) {
    emit('onset');
    return { B: 0.5, I: 0.6, temp: 38.5, pcr: 60, S: 0, atb: false, tAtb: null, drained: false, afebrile: null, oral: false, done: false, scar: 0, abscess: false, sepsis: 0 };
  },
  step(st, t, dt, p, arm, emit) {
    const cfg = PNA[p.type];
    const treated = arm === 'treated';
    if (treated && !st.atb && t >= p.atbDelay / 24) { st.atb = true; st.tAtb = t; emit('atb'); }
    if (treated && cfg.needsDrain && !st.drained && st.atb && t >= st.tAtb + cfg.drainDelay) { st.drained = true; emit(cfg.needsDrain); }
    if (st.atb) {
      const tau = cfg.needsDrain && !st.drained ? cfg.undrainedTau : cfg.tau;
      st.B = relax(st.B, 0, dt, tau);
    } else {
      st.B = clamp(st.B + cfg.r * st.B * (1 - st.B) * dt, 0, 1);
    }
    st.I = relax(st.I, st.B, dt, 0.7);
    st.temp = 36.8 + 2.9 * st.I;
    st.pcr = relax(st.pcr, 280 * st.I, dt, 1);
    st.S = clamp(st.S + cfg.k * st.I * st.I * (1 - st.S) * dt, 0, 1);
    st.sepsis = st.S * 100;
    st.scar = clamp(st.scar + 0.03 * st.I * dt, 0, 1);
    if (st.S > 0.3) emit('sepsisEvent');
    if (!st.atb && t > 7 && st.B > 0.9 && !st.abscess) { st.abscess = true; emit('abscess'); }
    if (st.atb && t >= st.tAtb + 3 && st.temp >= 38) emit('ct72');
    if (st.atb && st.temp < 37.5 && st.afebrile === null) { st.afebrile = t; emit('afebrile'); }
    if (st.afebrile !== null && !st.oral && t >= st.afebrile + 1) { st.oral = true; emit('oral'); }
    const course = p.type === 'uncomplicated' ? 7 : 14;
    if (st.atb && !st.done && t >= st.tAtb + course) { st.done = true; emit('courseEnd', { d: course }); }
    return st;
  },
  steps(st, p) {
    const k = ['ascent', 'inflammation'];
    if (p.type !== 'uncomplicated') k.push('complicating');
    k.push('diagnosis');
    if (st.atb) k.push('empirical');
    if (st.drained) k.push('drain');
    if (st.atb && st.temp < 37.5) k.push('resolution');
    return k;
  },
  gauges(st) {
    return [
      { key: 'pcr', value: st.pcr, unit: 'mg/L', lo: 0, hi: 20 },
      { key: 'temp', value: st.temp, unit: '°C', lo: 36, hi: 37.5 },
    ];
  },
  schematic(st, p) {
    const obstr = p.type === 'obstructive';
    return {
      sex: p.type === 'uncomplicated' ? 'f' : 'm', focus: ['kidneyL'],
      kidneys: { L: { inflame: st.I, dil: obstr && !st.drained ? 0.6 : 0.1, gas: p.type === 'emphysematous' && !st.drained ? st.I : 0, bacteria: st.B }, R: {} },
      ureters: { L: { dil: obstr && !st.drained ? 0.5 : 0, stone: obstr ? { pos: 0.5, size: 7 } : null, stent: obstr && st.drained }, R: {} },
      bladder: { vol: 0.3, bacteria: 0.3 }, systemic: st.S,
    };
  },
  outcome(st) { return { sepsis: st.sepsis, scar: st.scar, afebrileDay: st.afebrile }; },
};

// ---------------------------------------------------------------------------
// 5. Acute bacterial prostatitis
// ---------------------------------------------------------------------------
/** Days of effective antibiotic needed to clear the intraprostatic reservoir (Model). EAU: 2–4 weeks in total. */
export const PROSTATE_CLEAR_DAYS = 14;
export const prostatitis = {
  id: 'prostatitis', mode: 'uti', unit: 'd', tMax: 56, dt: 0.1,
  region: ['prostate'],
  params: [
    { key: 'duration', type: 'range', min: 3, max: 42, step: 1, def: 28, unit: 'd' },
  ],
  series: [
    { key: 'temp', unit: '°C' },
    { key: 'psa', unit: 'ng/mL', min: 0 },
    { key: 'burden', unit: '%', min: 0, max: 100 },
  ],
  init() { return { B: 0.6, R: 1, I: 0.7, temp: 39, psa: 6, burden: 60, onAtb: false, stopped: false, abscess: false, afebrile: false, relapse: false }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    if (treated && !st.onAtb && !st.stopped && t >= 0.25) { st.onAtb = true; emit('atbIv'); }
    if (st.onAtb && t >= 0.25 + p.duration) { st.onAtb = false; st.stopped = true; emit('stop', { d: p.duration }); }
    if (st.onAtb) {
      st.R = Math.max(0, st.R - dt / PROSTATE_CLEAR_DAYS);
      st.B = relax(st.B, 0.12 * st.R, dt, 0.8);
    } else if (st.stopped) {
      if (st.R > 0.02) { st.B = clamp(st.B + 0.35 * Math.max(st.B, 0.02) * (0.5 - st.B) * dt, 0, 0.5); }
      else st.B = relax(st.B, 0, dt, 1);
    } else {
      st.B = clamp(st.B + 0.4 * st.B * (1 - st.B) * dt, 0, 1);
    }
    st.I = relax(st.I, st.B, dt, 0.8);
    st.temp = 36.8 + 3 * st.I;
    st.psa = 1.5 + 9 * st.I;
    st.burden = st.B * 100;
    if (!treated && t > 10 && !st.abscess) { st.abscess = true; emit('abscess'); }
    if (st.onAtb && st.temp < 37.5 && !st.afebrile) { st.afebrile = true; emit('oral'); }
    if (st.stopped && st.B > 0.3 && !st.relapse) { st.relapse = true; emit('chronic'); }
    return st;
  },
  steps(st, p, arm) {
    const k = ['ascent', 'parenchyma', 'psa'];
    if (st.abscess) k.push('abscess');
    if (st.onAtb || st.stopped) k.push('penetration');
    if (st.relapse) k.push('chronic');
    return k;
  },
  gauges(st) { return [{ key: 'psa', value: st.psa, unit: 'ng/mL', lo: 0, hi: 4 }]; },
  schematic(st) { return { sex: 'm', focus: ['prostate'], prostate: { size: 0.55 + 0.3 * st.I, inflame: st.I, abscess: st.abscess }, bladder: { vol: 0.35 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} }, systemic: st.I > 0.8 ? 0.4 : 0 }; },
  outcome(st) { return { relapse: st.relapse, abscess: st.abscess }; },
};

// ---------------------------------------------------------------------------
// 6. Epididymo-orchitis
// ---------------------------------------------------------------------------
export function epididymitisGerm(age, analSex) {
  if (analSex) return 'mixed';
  return age < 35 ? 'sti' : 'enteric';
}
export const epididymitis = {
  id: 'epididymitis', mode: 'uti', unit: 'd', tMax: 28, dt: 0.1,
  region: ['scrotum'],
  params: [
    { key: 'age', type: 'range', min: 14, max: 85, step: 1, def: 24, unit: 'años' },
    { key: 'analSex', type: 'bool', def: false },
  ],
  series: [
    { key: 'pain', unit: '/10', min: 0, max: 10 },
    { key: 'temp', unit: '°C' },
  ],
  init(p, arm, emit) { emit('germ', { germ: epididymitisGerm(p.age, p.analSex) }); return { I: 0.3, pain: 3, temp: 37.4, atb: false, abscess: false }; },
  step(st, t, dt, p, arm, emit) {
    const treated = arm === 'treated';
    if (treated && !st.atb && t >= 0.25) { st.atb = true; emit('atb', { germ: epididymitisGerm(p.age, p.analSex) }); }
    if (st.atb) st.I = relax(st.I, 0, dt, 3);
    else st.I = t < 7 ? relax(st.I, 1, dt, 1.2) : relax(st.I, 0.15, dt, 12);
    if (!treated && t > 8 && !st.abscess) { st.abscess = true; emit('complication'); }
    st.pain = 9 * st.I;
    st.temp = 36.8 + 2 * st.I;
    return st;
  },
  steps(st, p, arm) {
    const k = ['route', 'progressive', 'signs', 'ddTorsion'];
    if (arm === 'treated') k.push('regimen');
    return k;
  },
  gauges(st, p) { return [{ key: 'age35', value: p.age, unit: 'años', lo: 0, hi: 85, band: false }]; },
  schematic(st) { return { sex: 'm', focus: ['scrotum'], scrotum: { side: 'L', epid: st.I, testis: { viability: 1 } }, prostate: { size: 0.45 }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { pain: st.pain }; },
};

// ---------------------------------------------------------------------------
// 7. Urethritis
// ---------------------------------------------------------------------------
/**
 * Agents and current European regimens: gonococcus — ceftriaxone 1 g IM + azithromycin 2 g PO (IUSTI 2020);
 * Chlamydia — doxycycline 100 mg/12 h 7 days; M. genitalium — doxycycline then resistance-guided azithromycin
 * or moxifloxacin; Trichomonas — metronidazole; herpes simplex — valaciclovir.
 * Secretion: purulent (gonococcal) vs watery (non-gonococcal). Complication risks: Model.
 */
export const URETHRITIS = {
  gonococcus: { secretion: 8, tauRx: 0.8, tauNo: 60, compM: 5, compF: 20 },
  chlamydia: { secretion: 4, tauRx: 2, tauNo: 60, compM: 3, compF: 15 },
  mgenitalium: { secretion: 3.5, tauRx: 4, tauNo: 60, compM: 2, compF: 8 },
  trichomonas: { secretion: 4, tauRx: 1.5, tauNo: 60, compM: 1, compF: 5 },
  hsv: { secretion: 3, tauRx: 3, tauNo: 5, compM: 1, compF: 1 },
};
export const urethritis = {
  id: 'urethritis', mode: 'uti', unit: 'd', tMax: 21, dt: 0.1,
  region: ['urethra'],
  params: [
    { key: 'agent', type: 'select', options: Object.keys(URETHRITIS), def: 'gonococcus' },
    { key: 'sexPatient', type: 'select', options: ['m', 'f'], def: 'm' },
  ],
  series: [
    { key: 'secretion', unit: '/10', min: 0, max: 10 },
    { key: 'complication', unit: '%', min: 0, max: 100 },
  ],
  init(p, arm, emit) {
    const a = URETHRITIS[p.agent];
    emit(a.secretion >= 6 ? 'purulent' : 'watery');
    const sec = p.sexPatient === 'f' && p.agent !== 'hsv' ? 1 : a.secretion;
    return { secretion: sec, complication: 0, rx: false };
  },
  step(st, t, dt, p, arm, emit) {
    const a = URETHRITIS[p.agent];
    if (arm === 'treated' && !st.rx && t >= 0.5) { st.rx = true; emit('rx', { agent: p.agent }); emit('partner'); }
    st.secretion = relax(st.secretion, 0, dt, st.rx ? a.tauRx : a.tauNo);
    const cmax = p.sexPatient === 'f' ? a.compF : a.compM;
    if (!st.rx) st.complication = cmax * (1 - Math.exp(-t / 30));
    return st;
  },
  steps(st, p, arm) {
    const k = ['transmission', 'mucosa', 'gram'];
    if (p.sexPatient === 'f') k.push('silent');
    if (arm === 'treated') k.push('treatment');
    return k;
  },
  schematic(st, p) { return { sex: p.sexPatient, focus: ['urethra'], urethra: { inflame: st.secretion / 8, secretion: st.secretion / 10 }, bladder: { vol: 0.3 }, kidneys: { L: {}, R: {} }, ureters: { L: {}, R: {} } }; },
  outcome(st) { return { complication: st.complication }; },
};

export const INFECTION = [asymptomatic, cystitis, recurrent, pyelonephritis, prostatitis, epididymitis, urethritis];
