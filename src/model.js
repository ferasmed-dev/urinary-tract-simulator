// Public model API: entities, modes and presets. Pure (no DOM).
export * from './model/core.js';
export * as obstruction from './model/obstruction.js';
export * as infection from './model/infection.js';
export * as emergencies from './model/emergencies.js';
import { OBSTRUCTION } from './model/obstruction.js';
import { INFECTION } from './model/infection.js';
import { EMERGENCIES } from './model/emergencies.js';

export const MODES = [
  { id: 'obs', entities: OBSTRUCTION },
  { id: 'uti', entities: INFECTION },
  { id: 'urg', entities: EMERGENCIES },
];
export const ENTITIES = [...OBSTRUCTION, ...INFECTION, ...EMERGENCIES];
export const ENTITY = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));

/**
 * Teaching presets: generic clinical situations, each with a deep link ?preset=<key>.
 * `expect` documents what the untreated (default) and treated arms should show; the test suite checks it.
 */
export const PRESETS = {
  // Obstruction and stones
  colicSmall: { entity: 'colic', params: { size: 4, loc: 'uvj' } },
  colicLarge: { entity: 'colic', params: { size: 8, loc: 'iliac' } },
  colicFever: { entity: 'colic', params: { size: 6, loc: 'iliac', infection: true } },
  colicSolitary: { entity: 'colic', params: { size: 7, loc: 'upj', solitary: true } },
  anuriaPelvic: { entity: 'anuria', params: { cause: 'pelvicCancer', k0: 5.6 } },
  anuriaAnticoag: { entity: 'anuria', params: { cause: 'stonesBilateral', k0: 6.8, anticoag: true } },
  upjPolar: { entity: 'upj', params: { cause: 'polarVessel', stenosis: 0.75, f0: 42 } },
  megacalycosis: { entity: 'upj', params: { cause: 'megacalycosis' } },
  aurBph: { entity: 'aur', params: { cause: 'bph' } },
  chronicRetentionBph: { entity: 'chronicRetention', params: { cause: 'bph', resistance: 0.75 } },
  stoneHypercalciuria: { entity: 'stones', params: { V: 1.2, ca: 340, ox: 38, ua: 600, cit: 280, pH: 6.0 } },
  stoneUric: { entity: 'stones', params: { V: 1.3, ca: 200, ox: 30, ua: 850, cit: 500, pH: 5.0 } },
  stoneStruvite: { entity: 'stones', params: { V: 1.5, ca: 200, ox: 30, ua: 500, cit: 500, pH: 7.0, urease: true } },
  stoneCystine: { entity: 'stones', params: { V: 1.5, ca: 150, ox: 25, ua: 500, cys: 700, cit: 500, pH: 6.0 } },
  // Infection
  baPregnancy: { entity: 'asymptomatic', params: { population: 'pregnant' } },
  baCatheter: { entity: 'asymptomatic', params: { population: 'catheter' } },
  cystitisFosfomycin: { entity: 'cystitis', params: { drug: 'fosfomycin' } },
  cystitisCotrimoxazole: { entity: 'cystitis', params: { drug: 'cotrimoxazole' } },
  recurrentYoung: { entity: 'recurrent', params: { sex: 3, spermicide: true, prevention: 'antibioticPostcoital' } },
  recurrentPostmenopausal: { entity: 'recurrent', params: { sex: 1, spermicide: false, menopause: true, prevention: 'vaginalEstriol' } },
  pnaUncomplicated: { entity: 'pyelonephritis', params: { type: 'uncomplicated' } },
  pnaObstructive: { entity: 'pyelonephritis', params: { type: 'obstructive' } },
  pnaEmphysematous: { entity: 'pyelonephritis', params: { type: 'emphysematous' } },
  prostatitisShort: { entity: 'prostatitis', params: { duration: 7 } },
  epididymitisYoung: { entity: 'epididymitis', params: { age: 24 } },
  epididymitisOlder: { entity: 'epididymitis', params: { age: 62 } },
  urethritisGonococcal: { entity: 'urethritis', params: { agent: 'gonococcus' } },
  urethritisChlamydiaWoman: { entity: 'urethritis', params: { agent: 'chlamydia', sexPatient: 'f' } },
  // Emergencies
  hematuriaClots: { entity: 'hematuria', params: { timing: 'total', clots: true } },
  fournier: { entity: 'fournier', params: {} },
  sepsisObstructive: { entity: 'sepsis', params: { focus: 'obstructivePna' } },
  paraphimosisCatheter: { entity: 'paraphimosis', params: { cause: 'catheter' } },
  priapismIschemic6h: { entity: 'priapism', params: { type: 'ischemic', tTx: 6 } },
  priapismIschemic40h: { entity: 'priapism', params: { type: 'ischemic', tTx: 40 } },
  priapismArterial: { entity: 'priapism', params: { type: 'arterial', cause: 'perinealTrauma', tTx: 12 } },
  torsionEarly: { entity: 'torsion', params: { tTx: 4 } },
  torsionLate: { entity: 'torsion', params: { tTx: 24 } },
  appendixTorsion: { entity: 'appendix', params: {} },
  renalGrade3: { entity: 'renalTrauma', params: { grade: 3, activeBleed: false } },
  renalGrade5: { entity: 'renalTrauma', params: { grade: 5, activeBleed: true } },
  ureterHysterectomy: { entity: 'ureterTrauma', params: { grade: 3, third: 'distal', cause: 'gyn' } },
  bladderIntra: { entity: 'bladderTrauma', params: { type: 'intraperitoneal' } },
  bladderExtra: { entity: 'bladderTrauma', params: { type: 'extraperitoneal' } },
  urethraPosterior: { entity: 'urethralTrauma', params: { segment: 'posterior', extent: 'complete' } },
  penileFracture: { entity: 'penileFracture', params: {} },
  testicularRupture: { entity: 'scrotalTrauma', params: { rupture: true } },
};
export const modeOf = (entityId) => ENTITY[entityId]?.mode;

// ---------------------------------------------------------------------------
// Key decision shown for an entity at a given state (pure; returns an i18n key).
// ---------------------------------------------------------------------------
import * as Ob from './model/obstruction.js';
import * as In from './model/infection.js';
import * as Em from './model/emergencies.js';

export function decision(entityId, st, p) {
  switch (entityId) {
    case 'colic': {
      const ind = Ob.diversionIndications(p, p.size >= 8);
      if (ind.length) return 'divert';
      return Ob.passageProbability(p.size, p.loc, p.size > 5 && p.size <= 10) >= 0.5 ? 'expectant' : 'remove';
    }
    case 'anuria': return p.anticoag || p.k0 >= 6.5 ? 'hdFirst' : 'divertNow';
    case 'upj':
      if (p.cause === 'megacalycosis') return 'watch';
      return st.split >= 20 ? 'pyeloplasty' : st.split >= 10 ? 'borderline' : 'nephrectomy';
    case 'aur': return p.urethralOk ? 'urethral' : 'suprapubic';
    case 'chronicRetention': return 'stage' + st.stage;
    case 'stones': return Ob.treatmentChoice(st.size, p.site, st.type);
    case 'asymptomatic': return In.BA_POPULATIONS[p.population].treat ? 'treat' : 'noTreat';
    case 'cystitis': return In.CYSTITIS_DRUGS[p.drug].flag ?? 'ok';
    case 'recurrent': return st.flagged ? 'recurrent' : 'notYet';
    case 'pyelonephritis': return { uncomplicated: 'outpatient', complicated: 'admit', obstructive: 'divert', emphysematous: 'drain' }[p.type];
    case 'prostatitis': return p.duration < In.PROSTATE_CLEAR_DAYS ? 'tooShort' : 'ok';
    case 'epididymitis': return In.epididymitisGerm(p.age, p.analSex);
    case 'urethritis': return p.agent;
    case 'hematuria': return st.intensity;
    case 'fournier': return 'triad';
    case 'sepsis': return Em.isSepticShock(st.nor, st.lactate) || (st.map < 65 && st.lactate > 2) ? 'shock' : 'sepsis';
    case 'paraphimosis': return Em.paraphimosisTechnique(st.E, st.N);
    case 'priapism': return p.type;
    case 'torsion': return Em.twistBand(Em.twistScore(p));
    case 'appendix': return 'conservative';
    case 'renalTrauma': return Em.renalManagement(p.grade, p.activeBleed, p.mechanism === 'penetrating', st.unstable);
    case 'ureterTrauma': return Em.ureterRepair(p.grade, p.third);
    case 'bladderTrauma': return Em.bladderManagement(p.type, p.penetrating);
    case 'urethralTrauma': return Em.urethralManagement(p.segment, p.extent, p.sexPatient);
    case 'penileFracture': return 'surgery';
    case 'scrotalTrauma': return Em.needsScrotalExploration(p) ? 'explore' : 'observe';
    default: return null;
  }
}

/**
 * Parameters and series that are simulator tuning choices or proxies rather than measured clinical values.
 * The UI marks them with a "Modelo" / "Model" tag.
 */
export const MODEL_TAGS = {
  colic: ['pain'],
  upj: ['stenosis', 'grade', 'pain'],
  chronicRetention: ['resistance', 'detrusor'],
  stones: ['rss'],
  asymptomatic: ['risk'],
  cystitis: ['pnaRisk'],
  recurrent: ['episodes', 'abxDays'],
  pyelonephritis: ['sepsis'],
  prostatitis: ['burden'],
  epididymitis: ['pain'],
  urethritis: ['secretion', 'complication'],
  hematuria: [],
  fournier: ['e0', 'necrosis', 'mortality'],
  sepsis: [],
  paraphimosis: ['edema', 'perfusion', 'necrosis'],
  priapism: ['damage'],
  appendix: ['pain'],
  renalTrauma: ['hematoma'],
  ureterTrauma: ['urinoma'],
  bladderTrauma: ['collection'],
  urethralTrauma: ['patency'],
  penileFracture: ['hematoma', 'complication'],
  scrotalTrauma: ['viability'],
};
export const isModelTagged = (entityId, key) => (MODEL_TAGS[entityId] || []).includes(key);
