import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  run, runBoth, defaults, sanitize, indexAt, ENTITIES, ENTITY, MODES, PRESETS,
  obstruction as O, infection as I, emergencies as E,
} from '../src/model.js';

const last = (arr) => arr[arr.length - 1];
const at = (res, key, t) => res.s[key][indexAt(res, t)];
const has = (res, key) => res.events.some((e) => e.key === key);

// ---------------------------------------------------------------------------
// Structure, purity, robustness
// ---------------------------------------------------------------------------
test('every mode has entities and every entity id is unique', () => {
  assert.equal(MODES.length, 3);
  const ids = ENTITIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ENTITIES.length, 26);
});

test('every entity runs both arms with finite, bounded series', () => {
  for (const ent of ENTITIES) {
    for (const arm of ['untreated', 'treated']) {
      const r = run(ent, {}, arm);
      assert.equal(r.t.length, Math.round(ent.tMax / ent.dt) + 1, ent.id);
      for (const sd of ent.series) {
        for (const v of r.s[sd.key]) {
          assert.ok(Number.isFinite(v), `${ent.id}.${sd.key} finite`);
          if (sd.min !== undefined) assert.ok(v >= sd.min, `${ent.id}.${sd.key} ≥ min`);
          if (sd.max !== undefined) assert.ok(v <= sd.max, `${ent.id}.${sd.key} ≤ max`);
        }
      }
      assert.ok(Array.isArray(r.events));
      assert.equal(r.stepsAt.length, r.t.length);
      const sch = ent.schematic(last(r.states), r.p);
      assert.ok(sch && typeof sch === 'object');
    }
  }
});

test('extreme parameter values stay finite (min and max of every range)', () => {
  for (const ent of ENTITIES) {
    for (const edge of ['min', 'max']) {
      const params = {};
      for (const d of ent.params) {
        if (d.type === 'range') params[d.key] = d[edge];
        if (d.type === 'bool') params[d.key] = edge === 'max';
        if (d.type === 'select') params[d.key] = edge === 'min' ? d.options[0] : d.options[d.options.length - 1];
      }
      for (const arm of ['untreated', 'treated']) {
        const r = run(ent, params, arm);
        for (const [k, arr] of Object.entries(r.s)) for (const v of arr) assert.ok(Number.isFinite(v), `${ent.id}.${k} ${edge} ${arm}`);
      }
    }
  }
});

test('run is pure: same input → same output, input object not mutated', () => {
  for (const ent of ENTITIES) {
    const params = defaults(ent);
    const copy = JSON.stringify(params);
    const a = run(ent, params, 'treated');
    const b = run(ent, params, 'treated');
    assert.deepEqual(a.s, b.s, ent.id);
    assert.deepEqual(a.events, b.events, ent.id);
    assert.equal(JSON.stringify(params), copy);
  }
});

test('sanitize clamps ranges, drops unknown keys and rejects invalid options', () => {
  const p = sanitize(O.colic, { size: 999, loc: 'nowhere', bogus: 1, infection: 'true' });
  assert.equal(p.size, 15);
  assert.equal(p.loc, 'iliac');
  assert.equal(p.infection, true);
  assert.ok(!('bogus' in p));
  assert.equal(sanitize(O.colic, { size: 'abc' }).size, 8);
});

// ---------------------------------------------------------------------------
// Obstruction and stones
// ---------------------------------------------------------------------------
test('stone passage: size and location drive it; alpha-blocker helps only >5 mm', () => {
  assert.ok(O.passageProbability(3) > 0.9);
  assert.ok(O.passageProbability(4) > 0.8);
  const p7 = O.passageProbability(7);
  assert.ok(p7 > 0.2 && p7 < 0.5, 'about half or fewer of 5–10 mm stones pass');
  assert.ok(O.passageProbability(10) < 0.1);
  assert.ok(O.passageProbability(6, 'uvj') > O.passageProbability(6, 'upj'));
  assert.equal(O.passageProbability(4, 'iliac', true), O.passageProbability(4, 'iliac', false));
  assert.ok(O.passageProbability(7, 'iliac', true) > O.passageProbability(7, 'iliac', false));
  assert.ok(O.passageTime(2) < O.passageTime(5));
});

test('irreversible loss after complete obstruction follows the 1–2–4–6 week course', () => {
  assert.equal(O.irreversibleLoss(7), 0);
  assert.ok(Math.abs(O.irreversibleLoss(14) - 0.3) < 1e-9);
  assert.ok(Math.abs(O.irreversibleLoss(28) - 0.7) < 1e-9);
  assert.equal(O.irreversibleLoss(60), 1);
});

test('diversion indications: solitary kidney, infection, refractory pain, persistent complete obstruction', () => {
  assert.deepEqual(O.diversionIndications({ solitary: true, infection: true, refractory: false }, true), ['solitary', 'infection', 'complete']);
  assert.deepEqual(O.diversionIndications({}, false), []);
});

test('renal colic: obstructed kidney loses function; untreated solitary kidney becomes anuric', () => {
  const r = run(O.colic, { size: 8 }, 'untreated');
  assert.ok(at(r, 'fgAff', 3) < 50);
  assert.ok(last(r.s.fgAff) < 10, 'six weeks of complete obstruction destroys the kidney');
  const sol = runBoth(O.colic, { size: 7, solitary: true });
  assert.ok(has(sol.untreated, 'anuria'));
  assert.ok(at(sol.untreated, 'cr', 4) > 4);
  assert.ok(has(sol.treated, 'diversion'));
  assert.ok(last(sol.treated.s.cr) < 1.1);
});

test('renal colic with fever: sepsis without drainage, defervescence after diversion', () => {
  const b = runBoth(O.colic, { size: 6, infection: true });
  assert.ok(has(b.untreated, 'sepsis'));
  assert.ok(at(b.untreated, 'temp', 4) > 39);
  const div = b.treated.events.find((e) => e.key === 'diversion');
  assert.ok(div && div.t <= 0.5);
  assert.ok(at(b.treated, 'temp', 3) < 37.5);
});

test('obstructive anuria: K and creatinine climb; diversion gives post-obstructive polyuria; HD first if contraindicated', () => {
  const b = runBoth(O.anuria, { k0: 5.6 });
  assert.ok(at(b.untreated, 'k', 3) > 6.5);
  assert.ok(at(b.untreated, 'cr', 3) > at(b.untreated, 'cr', 0) + 2);
  assert.ok(has(b.treated, 'polyuria'));
  assert.ok(Math.max(...b.treated.s.diuresis) > 200);
  assert.ok(last(b.treated.s.cr) < 1.2);
  const ac = run(O.anuria, { anticoag: true }, 'treated');
  const hd = ac.events.find((e) => e.key === 'hd');
  const dv = ac.events.find((e) => e.key === 'diversion');
  assert.ok(hd && dv && hd.t < dv.t);
});

test('PUJ obstruction: function falls without surgery, stabilises after pyeloplasty; megacalycosis does not progress', () => {
  const b = runBoth(O.upj, {});
  assert.ok(last(b.untreated.s.split) < 10);
  assert.ok(has(b.treated, 'pyeloplasty'));
  assert.ok(last(b.treated.s.split) > 30);
  const m = run(O.upj, { cause: 'megacalycosis' }, 'untreated');
  assert.equal(last(m.s.split), m.s.split[0]);
  const late = run(O.upj, { tSurg: 8, stenosis: 1 }, 'treated');
  assert.ok(has(late, 'nephrectomy'), 'split function <10% → nephrectomy');
});

test('acute retention: bladder fills with a normal upper tract; catheter empties it', () => {
  const b = runBoth(O.aur, {});
  assert.ok(last(b.untreated.s.vol) > 1000);
  assert.ok(at(b.treated, 'vol', 4) < 50);
  const sp = run(O.aur, { urethralOk: false }, 'treated');
  assert.ok(has(sp, 'cathSuprapubic'));
});

test('chronic retention passes through Guyon stages 1 → 2 → 3 and residual rises', () => {
  assert.equal(O.guyonStage(0.5, 30), 1);
  assert.equal(O.guyonStage(1.2, 200), 2);
  assert.equal(O.guyonStage(1.8, 600), 3);
  const r = run(O.chronicRetention, {}, 'untreated');
  const s2 = r.events.find((e) => e.key === 'stage2');
  const s3 = r.events.find((e) => e.key === 'stage3');
  assert.ok(s2 && s3 && s2.t < s3.t);
  assert.ok(last(r.s.residual) > 400);
  const tx = run(O.chronicRetention, {}, 'treated');
  assert.ok(last(tx.s.residual) < last(r.s.residual));
});

test('supersaturation: normal urine is undersaturated; each abnormality raises its own salt', () => {
  const normal = { V: 2, ca: 200, ox: 30, ua: 600, cys: 20, cit: 600, pH: 6, urease: false };
  const n = O.supersaturation(normal);
  for (const k of O.STONE_TYPES) assert.ok(n[k] < 1, k);
  assert.equal(O.dominantStone(n), null);
  assert.equal(O.dominantStone(O.supersaturation({ ...normal, V: 1, ca: 400, ox: 50, cit: 250 })), 'caox');
  assert.equal(O.dominantStone(O.supersaturation({ ...normal, pH: 5 })), 'ua');
  assert.equal(O.dominantStone(O.supersaturation({ ...normal, cys: 800, V: 1.5 })), 'cys');
  assert.equal(O.dominantStone(O.supersaturation({ ...normal, urease: true, pH: 7 })), 'str');
  // more fluid lowers every index
  const dil = O.supersaturation({ ...normal, V: 3 });
  for (const k of ['caox', 'ua', 'cys']) assert.ok(dil[k] < n[k]);
  // alkalinising dissolves uric acid but raises calcium phosphate
  const alk = O.supersaturation({ ...normal, pH: 7 });
  assert.ok(alk.ua < n.ua && alk.caP > n.caP);
});

test('treatment choice follows size, site and composition', () => {
  assert.equal(O.treatmentChoice(12, 'calyx', 'ua'), 'chemolysis');
  assert.equal(O.treatmentChoice(8, 'calyx', 'caox'), 'swlOrUrs');
  assert.equal(O.treatmentChoice(15, 'calyx', 'caox'), 'swlOrEndo');
  assert.equal(O.treatmentChoice(15, 'lowerPole', 'caox'), 'ursOrPcnl');
  assert.equal(O.treatmentChoice(25, 'pelvis', 'caox'), 'pcnl');
  assert.equal(O.treatmentChoice(25, 'pelvis', 'str'), 'pcnlStaghorn');
  assert.equal(O.treatmentChoice(5, 'calyx', 'str'), 'removeInfection');
  assert.equal(O.treatmentChoice(3, 'calyx', 'caox'), 'observe');
});

// ---------------------------------------------------------------------------
// Infection
// ---------------------------------------------------------------------------
test('significant bacteriuria thresholds depend on the sample and population', () => {
  assert.equal(I.significantBacteriuria(10, 'suprapubic').significant, true);
  assert.equal(I.significantBacteriuria(500, 'cystitis').significant, false);
  assert.equal(I.significantBacteriuria(1e3, 'cystitis').significant, true);
  assert.equal(I.significantBacteriuria(1e4, 'pyelonephritis').significant, true);
  assert.equal(I.significantBacteriuria(5e4, 'asymptomatic').significant, false);
  assert.equal(I.significantBacteriuria(1e6, 'asymptomatic', 3).contamination, true);
  assert.throws(() => I.significantBacteriuria(1, 'nope'));
});

test('dipstick post-test probability uses sensitivity 71% and specificity 83%', () => {
  const pos = I.dipstickPostTest(0.5, true);
  const neg = I.dipstickPostTest(0.5, false);
  assert.ok(Math.abs(pos - 0.71 / (0.71 + 0.17)) < 1e-9);
  assert.ok(neg < 0.5 && pos > 0.5);
});

test('asymptomatic bacteriuria: treatment helps in pregnancy, not in catheterised patients', () => {
  const preg = runBoth(I.asymptomatic, { population: 'pregnant' });
  assert.ok(last(preg.untreated.s.risk) > 3 * last(preg.treated.s.risk));
  const cath = runBoth(I.asymptomatic, { population: 'catheter' });
  assert.equal(last(cath.untreated.s.risk), last(cath.treated.s.risk));
  assert.ok(has(cath.treated, 'recolonised'));
  assert.equal(I.BA_POPULATIONS.diabetes.treat, false);
  assert.ok(has(run(I.asymptomatic, { germ: 'proteus' }), 'proteus'));
});

test('cystitis: half resolve in a week untreated; fosfomycin beats co-trimoxazole empirically', () => {
  const un = run(I.cystitis, {}, 'untreated');
  assert.ok(Math.abs(at(un, 'symptomatic', 7) - 50) < 1);
  const fos = run(I.cystitis, { drug: 'fosfomycin' }, 'treated');
  const ctx = run(I.cystitis, { drug: 'cotrimoxazole' }, 'treated');
  assert.ok(at(fos, 'symptomatic', 3) < 12);
  assert.ok(at(ctx, 'symptomatic', 3) > at(fos, 'symptomatic', 3) + 5);
  assert.ok(I.CYSTITIS_DRUGS.cotrimoxazole.r > 0.2 && I.CYSTITIS_DRUGS.cotrimoxazole.flag === 'noEmpiric');
  assert.ok(has(ctx, 'reassessCulture'));
});

test('recurrent cystitis: risk factors raise the rate; prophylaxis lowers episodes', () => {
  const base = { sex: 0, spermicide: false, menopause: false, childhoodUti: false, motherUti: false, nonSecretor: false };
  assert.ok(I.recurrenceRate({ ...base, sex: 4 }) > I.recurrenceRate(base));
  assert.ok(I.recurrenceRate({ ...base, spermicide: true }) > I.recurrenceRate(base));
  assert.equal(I.isRecurrent([1, 5]), true);
  assert.equal(I.isRecurrent([1, 8]), false);
  assert.equal(I.isRecurrent([1, 8, 11.5]), true);
  const b = runBoth(I.recurrent, {});
  assert.ok(b.untreated.out.recurrent);
  assert.ok(last(b.treated.s.episodes) < last(b.untreated.s.episodes) / 3);
  assert.ok(last(b.treated.s.abxDays) > last(b.untreated.s.abxDays), 'antibiotic prophylaxis = more antibiotic exposure');
  const est = run(I.recurrent, { prevention: 'vaginalEstriol', menopause: false }, 'treated');
  assert.ok(has(est, 'preventionNotApplicable'));
});

test('pyelonephritis: fever resolves within 72 h on antibiotics; obstruction needs drainage', () => {
  const unc = runBoth(I.pyelonephritis, { type: 'uncomplicated' });
  assert.ok(at(unc.untreated, 'temp', 5) > 39);
  assert.ok(at(unc.treated, 'temp', 3) < 37.5);
  assert.ok(!has(unc.treated, 'ct72'));
  const ob = runBoth(I.pyelonephritis, { type: 'obstructive' });
  assert.ok(last(ob.untreated.s.sepsis) > 80);
  assert.ok(has(ob.treated, 'diversion'));
  assert.ok(last(ob.treated.s.sepsis) < 30);
  const late = run(I.pyelonephritis, { type: 'complicated', atbDelay: 72 }, 'treated');
  assert.ok(last(late.s.sepsis) > last(unc.treated.s.sepsis));
});

test('acute prostatitis: a course too short relapses into chronic bacterial prostatitis', () => {
  const full = run(I.prostatitis, { duration: 28 }, 'treated');
  const short = run(I.prostatitis, { duration: 7 }, 'treated');
  assert.ok(!full.out.relapse);
  assert.ok(short.out.relapse);
  assert.ok(has(run(I.prostatitis, {}, 'untreated'), 'abscess'));
});

test('epididymo-orchitis: STI organisms under 35, enterobacteria from 35', () => {
  assert.equal(I.epididymitisGerm(24, false), 'sti');
  assert.equal(I.epididymitisGerm(35, false), 'enteric');
  assert.equal(I.epididymitisGerm(50, true), 'mixed');
  const b = runBoth(I.epididymitis, {});
  assert.ok(at(b.treated, 'pain', 7) < at(b.untreated, 'pain', 7));
});

test('urethritis: gonococcal = purulent, chlamydial = watery; women often silent with more complications', () => {
  assert.ok(has(run(I.urethritis, { agent: 'gonococcus' }), 'purulent'));
  assert.ok(has(run(I.urethritis, { agent: 'chlamydia' }), 'watery'));
  const w = runBoth(I.urethritis, { agent: 'chlamydia', sexPatient: 'f' });
  const m = run(I.urethritis, { agent: 'chlamydia', sexPatient: 'm' }, 'untreated');
  assert.ok(w.untreated.s.secretion[0] < m.s.secretion[0]);
  assert.ok(last(w.untreated.s.complication) > last(m.s.complication));
  assert.ok(last(w.treated.s.complication) < 1);
});

// ---------------------------------------------------------------------------
// Emergencies
// ---------------------------------------------------------------------------
test('haematuria: timing gives origin; clots cause retention unless evacuated and irrigated', () => {
  assert.equal(E.HEMATURIA_ORIGIN.initial, 'urethraProstate');
  assert.equal(E.HEMATURIA_ORIGIN.terminal, 'bladder');
  assert.equal(E.HEMATURIA_ORIGIN.total, 'upperTract');
  assert.equal(E.hematuriaIntensity(0, 0.5), 'mild');
  assert.equal(E.hematuriaIntensity(3, 3), 'moderate');
  assert.equal(E.hematuriaIntensity(7, 4), 'severe');
  const b = runBoth(E.hematuria, {});
  assert.ok(has(b.untreated, 'clotRetention'));
  assert.ok(last(b.untreated.s.vol) > 1000);
  assert.ok(last(b.treated.s.vol) <= 150);
  assert.ok(last(b.treated.s.hb) > last(b.untreated.s.hb));
});

test('Fournier: early debridement keeps mortality ≈10%; delay raises it', () => {
  const early = run(E.fournier, { tDebr: 6 }, 'treated');
  const late = run(E.fournier, { tDebr: 36 }, 'treated');
  const un = run(E.fournier, {}, 'untreated');
  assert.ok(last(early.s.mortality) < 15);
  assert.ok(last(late.s.mortality) > last(early.s.mortality) + 10);
  assert.ok(last(un.s.mortality) > 80);
});

test('urosepsis: shock without treatment; source control + antibiotics restore MAP; delay costs lives', () => {
  assert.equal(E.isSepticShock(true, 3), true);
  assert.equal(E.isSepticShock(false, 5), false);
  const b = runBoth(E.sepsis, {});
  assert.ok(has(b.untreated, 'shock'));
  assert.ok(last(b.untreated.s.map) < 65);
  assert.ok(last(b.treated.s.map) >= 65);
  assert.ok(last(b.treated.s.pct) < 2);
  const delayed = run(E.sepsis, { atbDelay: 12, srcDelay: 24 }, 'treated');
  assert.ok(delayed.out.mortality > b.treated.out.mortality + 20);
});

test('paraphimosis: technique escalates with oedema; untreated → necrosis', () => {
  assert.equal(E.paraphimosisTechnique(0.3, 0), 'manual');
  assert.equal(E.paraphimosisTechnique(0.6, 0), 'dorsalSlit');
  assert.equal(E.paraphimosisTechnique(0.9, 0), 'circumcision');
  assert.ok(has(run(E.paraphimosis, {}, 'untreated'), 'necrosis'));
  assert.equal(run(E.paraphimosis, { tTx: 3 }, 'treated').out.technique, 'manual');
  assert.equal(run(E.paraphimosis, { tTx: 14 }, 'treated').out.technique, 'dorsalSlit');
});

test('priapism: blood gas classification and time-dependent damage (4 · 24 · 48 · 72 h)', () => {
  assert.equal(E.classifyPriapism({ pO2: 20, pCO2: 70, pH: 7.1, flow: false }), 'ischemic');
  assert.equal(E.classifyPriapism({ pO2: 95, pCO2: 38, pH: 7.4, flow: true }), 'arterial');
  const g4 = E.ischemicGas(4);
  assert.ok(g4.pO2 < 30 && g4.pH < 7.25);
  assert.ok(E.priapismDamage(4) < 0.05);
  assert.ok(E.priapismDamage(24) > 0.4 && E.priapismDamage(24) < 0.6);
  assert.ok(E.priapismDamage(72) > 0.99);
  assert.equal(E.priapismStep(6), 'aspiration');
  assert.equal(E.priapismStep(30), 'distalShunt');
  assert.equal(E.priapismStep(60), 'proximalShunt');
  const early = run(E.priapism, { tTx: 6 }, 'treated');
  const late = run(E.priapism, { tTx: 40 }, 'treated');
  assert.ok(last(early.s.damage) < 10 && last(late.s.damage) > 80);
  const art = runBoth(E.priapism, { type: 'arterial' });
  assert.ok(last(art.untreated.s.damage) < 30, 'arterial priapism is not ischaemic');
});

test('testicular torsion: survival by hours (Mellick) and TWIST bands', () => {
  assert.ok(E.torsionSurvival(3) > 95);
  assert.ok(Math.abs(E.torsionSurvival(9.5) - 79.3) < 0.01);
  assert.ok(E.torsionSurvival(48) < 20);
  assert.ok(E.torsionSurvival(10, 360) > E.torsionSurvival(10, 1080));
  const all = { nausea: true, swelling: true, hard: true, highRiding: true, noCremaster: true };
  assert.equal(E.twistScore(all), 7);
  assert.equal(E.twistBand(2), 'low');
  assert.equal(E.twistBand(4), 'intermediate');
  assert.equal(E.twistBand(5), 'high');
  assert.equal(run(E.torsion, { tTx: 4 }, 'treated').out.surgery, 'orchidopexy');
  assert.equal(run(E.torsion, { tTx: 30 }, 'treated').out.surgery, 'orchiectomy');
});

test('renal trauma: observation for low grades; grade V bleeds out unless operated', () => {
  assert.equal(E.renalManagement(3, false, false, false), 'observation');
  assert.equal(E.renalManagement(4, true, false, false), 'embolization');
  assert.equal(E.renalManagement(5, false, false, false), 'surgery');
  assert.equal(E.renalManagement(2, false, false, true), 'surgery');
  assert.equal(E.renalManagement(3, false, true, false), 'exploration');
  const g3 = runBoth(E.renalTrauma, { grade: 3, activeBleed: false });
  assert.ok(last(g3.untreated.s.hb) > 12);
  const g5 = runBoth(E.renalTrauma, { grade: 5 });
  assert.ok(has(g5.untreated, 'exsanguination'));
  assert.ok(last(g5.treated.s.map) > 65);
});

test('ureteral trauma: repair by grade and third; untreated leak → fistula', () => {
  assert.equal(E.ureterRepair(1, 'distal'), 'stent');
  assert.equal(E.ureterRepair(3, 'distal'), 'reimplantPsoas');
  assert.equal(E.ureterRepair(4, 'middle'), 'boari');
  assert.equal(E.ureterRepair(3, 'proximal'), 'ureteroureterostomyProximal');
  assert.equal(E.ureterRepair(5, 'distal'), 'ilealUreter');
  assert.ok(has(run(E.ureterTrauma, {}, 'untreated'), 'fistula'));
});

test('bladder trauma: extraperitoneal blunt → catheter; intraperitoneal → surgery (creatinine rises untreated)', () => {
  assert.equal(E.bladderManagement('extraperitoneal', false), 'catheter');
  assert.equal(E.bladderManagement('extraperitoneal', true), 'surgery');
  assert.equal(E.bladderManagement('intraperitoneal', false), 'surgery');
  const intra = run(E.bladderTrauma, { type: 'intraperitoneal' }, 'untreated');
  assert.ok(last(intra.s.cr) > 3);
});

test('urethral trauma: complete posterior → suprapubic cystostomy, delayed urethroplasty at 3 months', () => {
  assert.equal(E.urethralManagement('posterior', 'complete', 'm'), 'cystostomyDelayed');
  assert.equal(E.urethralManagement('anterior', 'partial', 'm'), 'catheter');
  assert.equal(E.urethralManagement('posterior', 'partial', 'm'), 'realignment');
  assert.equal(E.urethralManagement('posterior', 'complete', 'f'), 'immediateRepair');
  const b = runBoth(E.urethralTrauma, {});
  assert.ok(has(b.untreated, 'retention'));
  const u = b.treated.events.find((e) => e.key === 'urethroplasty');
  assert.ok(u && u.t >= 90);
  assert.ok(last(b.treated.s.patency) > 90);
});

test('penile fracture and testicular rupture: early surgery beats conservative management', () => {
  const pf = runBoth(E.penileFracture, {});
  assert.ok(last(pf.untreated.s.complication) > 3 * last(pf.treated.s.complication));
  assert.ok(E.penileComplication(96) > E.penileComplication(6));
  assert.equal(E.needsScrotalExploration({ rupture: false, hematocele: 3.5, dislocation: false }), true);
  assert.equal(E.needsScrotalExploration({ rupture: false, hematocele: 2, dislocation: false }), false);
  const st = runBoth(E.scrotalTrauma, {});
  assert.ok(last(st.treated.s.viability) > last(st.untreated.s.viability) + 30);
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
test('every preset points to an existing entity with valid parameters', () => {
  for (const [key, pr] of Object.entries(PRESETS)) {
    const ent = ENTITY[pr.entity];
    assert.ok(ent, key);
    const p = sanitize(ent, pr.params);
    for (const [k, v] of Object.entries(pr.params)) assert.equal(p[k], v, `${key}.${k} survives sanitize`);
  }
});

const PRESET_EXPECT = {
  colicSmall: (b) => b.untreated.out.passed && b.treated.out.passed,
  colicLarge: (b) => !b.untreated.out.passed && last(b.untreated.s.fgAff) < 10 && b.treated.out.removed,
  colicFever: (b) => has(b.untreated, 'sepsis') && has(b.treated, 'diversion'),
  colicSolitary: (b) => has(b.untreated, 'anuria') && last(b.treated.s.cr) < 1.1,
  anuriaPelvic: (b) => has(b.untreated, 'hyperK') && has(b.treated, 'polyuria'),
  anuriaAnticoag: (b) => b.treated.events.findIndex((e) => e.key === 'hd') < b.treated.events.findIndex((e) => e.key === 'diversion'),
  upjPolar: (b) => b.treated.out.done === 'pyeloplasty' && last(b.untreated.s.split) < last(b.treated.s.split),
  megacalycosis: (b) => last(b.untreated.s.split) === b.untreated.s.split[0],
  aurBph: (b) => last(b.untreated.s.vol) > 1000 && last(b.treated.s.vol) < 50,
  chronicRetentionBph: (b) => b.untreated.out.stage === 3,
  stoneHypercalciuria: (b) => b.untreated.out.type === 'caox' && b.untreated.out.size > b.treated.out.size + 5,
  stoneUric: (b) => b.untreated.out.type === 'ua' && b.treated.out.size === 0,
  stoneStruvite: (b) => b.untreated.out.type === 'str' && b.untreated.out.size > 20,
  stoneCystine: (b) => b.untreated.out.type === 'cys',
  baPregnancy: (b) => last(b.untreated.s.risk) > 3 * last(b.treated.s.risk),
  baCatheter: (b) => last(b.untreated.s.risk) === last(b.treated.s.risk),
  cystitisFosfomycin: (b) => at(b.treated, 'symptomatic', 3) < 12,
  cystitisCotrimoxazole: (b) => at(b.treated, 'symptomatic', 3) > 20,
  recurrentYoung: (b) => b.untreated.out.recurrent && !b.treated.out.recurrent,
  recurrentPostmenopausal: (b) => last(b.treated.s.episodes) < last(b.untreated.s.episodes),
  pnaUncomplicated: (b) => at(b.treated, 'temp', 3) < 37.5,
  pnaObstructive: (b) => last(b.untreated.s.sepsis) > 80 && has(b.treated, 'diversion'),
  pnaEmphysematous: (b) => has(b.treated, 'drainage') && last(b.untreated.s.sepsis) > 90,
  prostatitisShort: (b) => b.treated.out.relapse,
  epididymitisYoung: (b) => b.untreated.events[0].vars.germ === 'sti',
  epididymitisOlder: (b) => b.untreated.events[0].vars.germ === 'enteric',
  urethritisGonococcal: (b) => has(b.untreated, 'purulent'),
  urethritisChlamydiaWoman: (b) => last(b.untreated.s.complication) > 5,
  hematuriaClots: (b) => has(b.untreated, 'clotRetention') && has(b.treated, 'evacuation'),
  fournier: (b) => last(b.treated.s.mortality) < 15 && last(b.untreated.s.mortality) > 80,
  sepsisObstructive: (b) => has(b.untreated, 'shock') && last(b.treated.s.map) >= 65,
  paraphimosisCatheter: (b) => b.treated.out.technique === 'manual' && has(b.untreated, 'necrosis'),
  priapismIschemic6h: (b) => last(b.treated.s.damage) < 10,
  priapismIschemic40h: (b) => last(b.treated.s.damage) > 80 && b.treated.out.plan === 'distalShunt',
  priapismArterial: (b) => has(b.treated, 'embolization') && last(b.untreated.s.damage) < 30,
  torsionEarly: (b) => b.treated.out.surgery === 'orchidopexy',
  torsionLate: (b) => b.treated.out.surgery === 'orchiectomy',
  appendixTorsion: (b) => last(b.untreated.s.pain) < 1,
  renalGrade3: (b) => b.treated.out.plan === 'observation' && last(b.untreated.s.hb) > 12,
  renalGrade5: (b) => b.treated.out.plan === 'surgery' && has(b.untreated, 'exsanguination'),
  ureterHysterectomy: (b) => b.treated.out.repaired === 'reimplantPsoas' && has(b.untreated, 'fistula'),
  bladderIntra: (b) => b.treated.out.plan === 'surgery' && last(b.untreated.s.cr) > 3,
  bladderExtra: (b) => b.treated.out.plan === 'catheter',
  urethraPosterior: (b) => b.treated.out.plan === 'cystostomyDelayed',
  penileFracture: (b) => last(b.untreated.s.complication) > 25,
  testicularRupture: (b) => b.treated.out.plan === 'exploration',
};

test('every preset behaves as documented in both arms', () => {
  assert.deepEqual(Object.keys(PRESET_EXPECT).sort(), Object.keys(PRESETS).sort());
  for (const [key, pr] of Object.entries(PRESETS)) {
    const b = runBoth(ENTITY[pr.entity], pr.params);
    assert.ok(PRESET_EXPECT[key](b), key);
  }
});

test('every entity yields a key decision at every time point', async () => {
  const { decision } = await import('../src/model.js');
  for (const ent of ENTITIES) {
    for (const arm of ['untreated', 'treated']) {
      const r = run(ent, {}, arm);
      for (const i of [0, Math.floor(r.t.length / 2), r.t.length - 1]) {
        const d = decision(ent.id, r.states[i], r.p);
        assert.ok(typeof d === 'string' && d.length > 0, ent.id);
      }
    }
  }
});
