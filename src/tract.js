// Hand-drawn SVG of the urinary tract (frontal view, anatomical convention:
// the patient's right kidney is on the viewer's left). Driven by a plain
// description object produced by each entity's schematic() in the model.

const NS = 'http://www.w3.org/2000/svg';
const W = 300;
const H = 520;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const STONE_FILL = { caox: 'var(--stone-caox)', caP: 'var(--stone-cap)', str: 'var(--stone-str)', ua: 'var(--stone-ua)', cys: 'var(--stone-cys)' };

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Kidney geometry: viewer-left = patient's right (R), viewer-right = patient's left (L).
const KID = { R: { cx: 86, cy: 100, side: 1 }, L: { cx: 214, cy: 100, side: -1 } };
const BLADDER = { cx: 150, cy: 330 };

function kidneyPath(cx, cy, s) {
  // bean with the hilum facing the midline (s = +1 hilum to the right)
  const rx = 30, ry = 50;
  const hx = cx + s * rx * 0.55;
  return `M ${cx} ${cy - ry}
    C ${cx - s * rx * 1.25} ${cy - ry} ${cx - s * rx * 1.25} ${cy + ry} ${cx} ${cy + ry}
    C ${cx + s * rx * 0.9} ${cy + ry} ${cx + s * rx} ${cy + 22} ${hx} ${cy + 10}
    C ${cx + s * rx * 0.3} ${cy + 4} ${cx + s * rx * 0.3} ${cy - 4} ${hx} ${cy - 10}
    C ${cx + s * rx} ${cy - 22} ${cx + s * rx * 0.9} ${cy - ry} ${cx} ${cy - ry} Z`;
}

function ureterPath(side) {
  const k = KID[side];
  const x0 = k.cx + k.side * 20;
  const y0 = k.cy + 22;
  const x1 = BLADDER.cx - k.side * 22;
  const y1 = BLADDER.cy - 18;
  return `M ${x0} ${y0} C ${x0 + k.side * 6} ${y0 + 80} ${x1 - k.side * 30} ${y1 - 120} ${x1} ${y1}`;
}

function drawKidney(g, side, d = {}) {
  const k = KID[side];
  if (d.absent) {
    el('path', { d: kidneyPath(k.cx, k.cy, k.side), class: 'absent' }, g);
    return;
  }
  const fn = d.fn === undefined ? 1 : clamp(d.fn, 0, 1);
  // perirenal haematoma / urinoma halo
  if (d.hematoma > 0.02) el('ellipse', { cx: k.cx, cy: k.cy, rx: 34 + 16 * d.hematoma, ry: 54 + 16 * d.hematoma, class: 'hematoma', opacity: 0.25 + 0.5 * d.hematoma }, g);
  if (d.urinoma > 0.02) el('ellipse', { cx: k.cx + k.side * 14, cy: k.cy + 40, rx: 10 + 22 * d.urinoma, ry: 8 + 14 * d.urinoma, class: 'urinoma' }, g);
  el('path', { d: kidneyPath(k.cx, k.cy, k.side), class: 'kidney', style: `opacity:${0.45 + 0.55 * fn}` }, g);
  // collecting system: calyces + pelvis, scaled by dilation
  const dil = clamp(d.dil || 0, 0, 1);
  const px = k.cx + k.side * 8;
  for (const dy of [-26, 0, 26]) {
    el('ellipse', { cx: k.cx - k.side * 4, cy: k.cy + dy, rx: 4 + 7 * dil, ry: 3 + 6 * dil, class: 'urine' }, g);
    el('line', { x1: k.cx - k.side * 2, y1: k.cy + dy, x2: px, y2: k.cy, class: 'urine-line', 'stroke-width': 2 + 4 * dil }, g);
  }
  el('ellipse', { cx: px + k.side * 4, cy: k.cy + 4, rx: 6 + 13 * dil, ry: 8 + 14 * dil, class: 'urine' }, g);
  if (d.upj) el('line', { x1: k.cx + k.side * 16, y1: k.cy + 18, x2: k.cx + k.side * 24, y2: k.cy + 22, class: 'stricture' }, g);
  if (d.inflame > 0.02) el('path', { d: kidneyPath(k.cx, k.cy, k.side), class: 'inflame', opacity: 0.6 * clamp(d.inflame, 0, 1) }, g);
  if (d.bleed > 0.02) el('path', { d: kidneyPath(k.cx, k.cy, k.side), class: 'bleed', opacity: 0.5 * clamp(d.bleed, 0, 1) }, g);
  if (d.lesion > 0) {
    const depth = 8 + 28 * d.lesion;
    el('path', { d: `M ${k.cx - k.side * 30} ${k.cy - 20} l ${k.side * depth * 0.6} 8 l ${-k.side * 4} 8 l ${k.side * depth * 0.5} 10`, class: 'laceration' }, g);
    if (d.lesion >= 1) el('path', { d: `M ${k.cx - k.side * 26} ${k.cy + 24} l ${k.side * 30} -6 l -6 10 l ${k.side * 22} -4`, class: 'laceration' }, g);
  }
  if (d.abscess) el('circle', { cx: k.cx - k.side * 10, cy: k.cy - 24, r: 8, class: 'abscess' }, g);
  if (d.gas > 0.05) {
    const n = Math.round(3 + 6 * d.gas);
    for (let i = 0; i < n; i++) el('circle', { cx: k.cx - k.side * (6 + (i * 7) % 18), cy: k.cy - 36 + ((i * 13) % 70), r: 2.4, class: 'gas' }, g);
  }
  if (d.bacteria > 0.05) drawBacteria(g, px + k.side * 4, k.cy + 4, 10, d.bacteria);
  if (d.stone) {
    const r = clamp(2.5 + d.stone.size / 2.2, 3, 14);
    if (d.stone.staghorn) {
      el('path', { d: `M ${px + k.side * 4} ${k.cy + 4} L ${k.cx - k.side * 4} ${k.cy - 26} M ${px + k.side * 4} ${k.cy + 4} L ${k.cx - k.side * 4} ${k.cy + 26} M ${px + k.side * 4} ${k.cy + 4} L ${k.cx - k.side * 6} ${k.cy}`, class: 'staghorn', stroke: STONE_FILL.str }, g);
    }
    el('circle', { cx: k.cx - k.side * 4, cy: k.cy - 26, r, class: 'stone', fill: STONE_FILL[d.stone.type] || 'var(--stone-caox)' }, g);
  }
}

function drawBacteria(g, cx, cy, spread, level) {
  const n = Math.round(2 + 10 * clamp(level, 0, 1));
  for (let i = 0; i < n; i++) {
    const a = i * 2.4;
    const r = spread * Math.sqrt((i + 1) / n);
    el('rect', { x: cx + r * Math.cos(a) - 2, y: cy + r * Math.sin(a) - 1, width: 4, height: 2, rx: 1, class: 'bact' }, g);
  }
}

function drawUreter(g, side, d = {}, kidneyAbsent) {
  const path = ureterPath(side);
  if (d.absent || kidneyAbsent) { el('path', { d: path, class: 'absent-line' }, g); return; }
  const w = 3 + 9 * clamp(d.dil || 0, 0, 1);
  el('path', { d: path, class: 'ureter-wall', 'stroke-width': w + 3 }, g);
  el('path', { d: path, class: 'ureter', 'stroke-width': w }, g);
  const p = el('path', { d: path, fill: 'none', stroke: 'none' }, g);
  const len = p.getTotalLength ? p.getTotalLength() : 0;
  const pt = (f) => (len ? p.getPointAtLength(len * clamp(f, 0, 1)) : { x: 0, y: 0 });
  if (d.stent) {
    el('path', { d: path, class: 'stent' }, g);
    const a = pt(0); const b = pt(1);
    el('circle', { cx: a.x, cy: a.y - 4, r: 4, class: 'stent-coil' }, g);
    el('circle', { cx: b.x, cy: b.y + 4, r: 4, class: 'stent-coil' }, g);
  }
  if (d.stone) {
    const q = pt(d.stone.pos);
    el('circle', { cx: q.x, cy: q.y, r: clamp(2.5 + d.stone.size / 1.6, 3.5, 11), class: 'stone', fill: 'var(--stone-caox)' }, g);
  }
  if (d.leak > 0.01 || d.third) {
    const f = { proximal: 0.2, middle: 0.5, distal: 0.85 }[d.third] ?? 0.5;
    const q = pt(f);
    if (d.third) el('circle', { cx: q.x, cy: q.y, r: 5, class: 'injury' }, g);
    if (d.leak > 0.01) el('ellipse', { cx: q.x - KID[side].side * 14, cy: q.y, rx: 6 + 22 * d.leak, ry: 5 + 14 * d.leak, class: 'urinoma' }, g);
  }
}

function bladderGeom(d = {}) {
  const v = clamp(d.vol ?? 0.3, 0.03, 1);
  const rx = 22 + 40 * v;
  const ry = 16 + 34 * v;
  return { rx, ry, cy: BLADDER.cy + 12 - ry * 0.2 };
}

function drawBladder(g, d = {}, female) {
  const { rx, ry, cy } = bladderGeom(d);
  const wall = 2 + 7 * clamp(d.wall || 0, 0, 1);
  if (d.leak === 'intra' && d.leakLevel > 0.01) el('path', { d: `M ${150 - 90} ${cy - ry - 4} Q 150 ${cy - ry - 30 - 50 * d.leakLevel} ${150 + 90} ${cy - ry - 4}`, class: 'leak-intra', 'stroke-width': 4 + 14 * d.leakLevel }, g);
  if (d.leak === 'extra' && d.leakLevel > 0.01) el('ellipse', { cx: 150 + rx + 4, cy, rx: 6 + 20 * d.leakLevel, ry: 10 + 24 * d.leakLevel, class: 'urinoma' }, g);
  el('ellipse', { cx: 150, cy, rx: rx + wall / 2, ry: ry + wall / 2, class: 'bladder-wall', 'stroke-width': wall }, g);
  el('ellipse', { cx: 150, cy, rx, ry, class: 'urine' }, g);
  if (d.blood > 0.02) el('ellipse', { cx: 150, cy, rx, ry, class: 'bleed', opacity: 0.25 + 0.6 * clamp(d.blood, 0, 1) }, g);
  if (d.clots > 0.02) {
    const n = Math.round(1 + 6 * d.clots);
    for (let i = 0; i < n; i++) el('circle', { cx: 150 - rx * 0.6 + ((i * 17) % (rx * 1.2)), cy: cy + ry * 0.45 - (i % 3) * 5, r: 3 + 4 * d.clots, class: 'clot' }, g);
  }
  if (d.inflame > 0.02) el('ellipse', { cx: 150, cy, rx: rx + wall / 2, ry: ry + wall / 2, class: 'inflame-ring', opacity: clamp(d.inflame, 0, 1) }, g);
  if (d.bleed > 0) el('circle', { cx: 150 + rx * 0.5, cy: cy - ry * 0.3, r: 4, class: 'bleed-dot' }, g);
  if (d.bacteria > 0.02) drawBacteria(g, 150, cy, rx * 0.6, d.bacteria);
  if (d.pain > 0.3) el('ellipse', { cx: 150, cy, rx: rx + 8, ry: ry + 8, class: 'pain-ring', opacity: clamp(d.pain, 0, 1) }, g);
  const bottom = cy + ry;
  if (d.catheter === 'suprapubic') {
    el('path', { d: `M 150 ${cy - ry} L 150 ${cy - ry - 26} L 196 ${cy - ry - 34}`, class: 'catheter' }, g);
  } else if (d.catheter) {
    el('line', { x1: 150, y1: cy + 2, x2: 150, y2: female ? 410 : 478, class: 'catheter' }, g);
    el('circle', { cx: 150, cy: cy + 6, r: 4, class: 'balloon' }, g);
    if (d.catheter === 'threeWay') el('path', { d: `M 150 ${female ? 410 : 478} l -10 10 M 150 ${female ? 410 : 478} l 0 12 M 150 ${female ? 410 : 478} l 10 10`, class: 'catheter' }, g);
  }
  return bottom;
}

function drawMale(g, d) {
  const pr = d.prostate || {};
  const size = clamp(pr.size ?? 0.45, 0, 1);
  el('ellipse', { cx: 150, cy: 382, rx: 13 + 13 * size, ry: 9 + 7 * size, class: 'prostate' }, g);
  if (pr.inflame > 0.02) el('ellipse', { cx: 150, cy: 382, rx: 13 + 13 * size, ry: 9 + 7 * size, class: 'inflame', opacity: 0.7 * pr.inflame }, g);
  if (pr.abscess) el('circle', { cx: 158, cy: 384, r: 6, class: 'abscess' }, g);
  if (pr.bleed) el('circle', { cx: 144, cy: 380, r: 4, class: 'bleed-dot' }, g);
  // urethra
  const u = d.urethra || {};
  el('line', { x1: 150, y1: 372, x2: 150, y2: 470, class: 'urethra' }, g);
  // scrotum and testes (viewer-left = patient right)
  const s = d.scrotum || {};
  el('path', { d: 'M 104 404 C 96 468 140 474 150 448 C 160 474 204 468 196 404 Z', class: 'skin' }, g);
  if (s.necrosis > 0.01) el('path', { d: 'M 104 404 C 96 468 140 474 150 448 C 160 474 204 468 196 404 Z', class: 'necrosis', opacity: clamp(s.necrosis * 1.4, 0, 0.9) }, g);
  if (s.hematoma > 0.02) el('ellipse', { cx: 178, cy: 436, rx: 16 + 8 * s.hematoma, ry: 20 + 8 * s.hematoma, class: 'hematoma', opacity: 0.3 + 0.5 * s.hematoma }, g);
  el('ellipse', { cx: 122, cy: 434, rx: 13, ry: 18, class: 'testis' }, g);
  const t = s.testis || {};
  const affected = { cx: 178, cy: 434 };
  if (t.lost) el('ellipse', { cx: affected.cx, cy: affected.cy, rx: 13, ry: 18, class: 'absent' }, g);
  else {
    const tg = el('g', { transform: t.elevated ? `translate(0 -12) rotate(70 ${affected.cx} ${affected.cy})` : '' }, g);
    el('ellipse', { cx: affected.cx, cy: affected.cy, rx: 13, ry: 18, class: 'testis' }, tg);
    const isch = 1 - clamp(t.viability ?? 1, 0, 1);
    if (isch > 0.02) el('ellipse', { cx: affected.cx, cy: affected.cy, rx: 13, ry: 18, class: 'ischemia', opacity: 0.85 * isch }, tg);
    if (s.epid > 0.02) el('path', { d: `M ${affected.cx + 10} ${affected.cy - 16} q 10 16 0 32`, class: 'epid', opacity: 0.4 + 0.6 * s.epid, 'stroke-width': 5 + 4 * s.epid }, tg);
    if (s.blueDot > 0.05) el('circle', { cx: affected.cx - 2, cy: affected.cy - 16, r: 3.5, class: 'bluedot', opacity: clamp(s.blueDot, 0.3, 1) }, tg);
  }
  // spermatic cord (twisted when torsion)
  if (t.twist) el('path', { d: `M 172 404 q 8 4 0 8 q -8 4 0 8 q 8 4 0 8`, class: 'cord-twist' }, g);
  else el('line', { x1: 174, y1: 404, x2: 176, y2: 418, class: 'cord' }, g);
  // penis
  const pe = d.penis || {};
  const swollen = pe.state === 'paraphimosis' ? clamp(pe.edema ?? 0, 0, 1) : 0;
  const erect = pe.state === 'ischemic' || pe.state === 'arterial';
  const shaftW = erect ? 22 : 18;
  el('rect', { x: 150 - shaftW / 2, y: 404, width: shaftW, height: erect ? 66 : 58, rx: 9, class: 'skin' }, g);
  if (pe.state === 'ischemic') el('rect', { x: 150 - shaftW / 2, y: 404, width: shaftW, height: 66, rx: 9, class: 'ischemia', opacity: 0.45 + 0.5 * (pe.level ?? 0) }, g);
  if (pe.state === 'arterial') el('rect', { x: 150 - shaftW / 2, y: 404, width: shaftW, height: 66, rx: 9, class: 'arterial' }, g);
  if (pe.state === 'fracture') el('ellipse', { cx: 150, cy: 438, rx: 12 + 6 * (pe.level ?? 0), ry: 24, class: 'hematoma', opacity: 0.25 + 0.6 * (pe.level ?? 0) }, g);
  if (pe.necrosis > 0.01) el('rect', { x: 141, y: 404, width: 18, height: 58, rx: 9, class: 'necrosis', opacity: clamp(pe.necrosis, 0, 0.8) }, g);
  const gy = erect ? 474 : 466;
  el('ellipse', { cx: 150, cy: gy, rx: 11 + 8 * swollen, ry: 9 + 6 * swollen, class: 'glans' }, g);
  if (pe.state === 'paraphimosis') {
    el('ellipse', { cx: 150, cy: gy - 10 - 4 * swollen, rx: 12 + 9 * swollen, ry: 4 + 2 * swollen, class: pe.reduced ? 'ring-reduced' : 'constrict' }, g);
    const isch = clamp(pe.necrosis ?? 0, 0, 1);
    if (isch > 0.01) el('ellipse', { cx: 150, cy: gy, rx: 11 + 8 * swollen, ry: 9 + 6 * swollen, class: 'necrosis', opacity: isch }, g);
  }
  if (u.inflame > 0.02) el('line', { x1: 150, y1: 404, x2: 150, y2: gy, class: 'urethra-inflame', opacity: clamp(u.inflame, 0, 1) }, g);
  if (u.secretion > 0.05) el('path', { d: `M 150 ${gy + 8} q -5 8 0 ${8 + 10 * u.secretion} q 5 -8 0 ${-8 - 10 * u.secretion}`, class: u.secretion > 0.6 ? 'pus' : 'secretion' }, g);
  if (pe.urethra) el('circle', { cx: 150, cy: 450, r: 4, class: 'injury' }, g);
}

function drawFemale(g, d) {
  const u = d.urethra || {};
  const b = bladderGeom(d.bladder);
  el('line', { x1: 150, y1: b.cy + b.ry - 2, x2: 150, y2: 410, class: 'urethra' }, g);
  el('ellipse', { cx: 150, cy: 412, rx: 4, ry: 2.5, class: 'meatus' }, g);
  if (u.inflame > 0.02) el('line', { x1: 150, y1: b.cy + b.ry, x2: 150, y2: 410, class: 'urethra-inflame', opacity: clamp(u.inflame, 0, 1) }, g);
  if (u.bacteria > 0.05) drawBacteria(g, 150, 404, 8, u.bacteria);
  if (u.secretion > 0.05) el('path', { d: `M 150 416 q -4 6 0 ${6 + 8 * u.secretion} q 4 -6 0 ${-6 - 8 * u.secretion}`, class: 'secretion' }, g);
}

function drawUrethralLesion(g, d, female) {
  const u = d.urethra || {};
  if (!u.lesion) return;
  const b = bladderGeom(d.bladder);
  const y = female ? 400 : u.lesion === 'posterior' ? Math.max(372, b.cy + b.ry + 6) : 440;
  el('circle', { cx: 150, cy: y, r: 7, class: 'injury' }, g);
  if (u.patency !== undefined && u.patency < 0.5) el('line', { x1: 140, y1: y, x2: 160, y2: y, class: 'stricture' }, g);
}

function drawMarks(g, marks = []) {
  for (const m of marks) {
    if (m === 'pelvicMass') el('ellipse', { cx: 150, cy: 292, rx: 46, ry: 16, class: 'mass' }, g);
    if (m === 'fibrosis') el('rect', { x: 96, y: 212, width: 108, height: 22, rx: 8, class: 'fibrosis' }, g);
    if (m === 'nodes') for (const [x, y] of [[112, 205], [188, 205], [120, 240], [180, 240]]) el('circle', { cx: x, cy: y, r: 8, class: 'node' }, g);
    if (m === 'polarVessel') el('path', { d: 'M 252 96 C 236 118 224 124 196 132', class: 'vessel' }, g);
    if (m === 'urethralStone') el('circle', { cx: 150, cy: 420, r: 4, class: 'stone', fill: 'var(--stone-caox)' }, g);
    if (m === 'stricture') el('path', { d: 'M 143 430 l 5 0 M 152 430 l 5 0', class: 'stricture' }, g);
    if (m === 'pelvicFracture') {
      el('path', { d: 'M 40 300 C 50 380 100 400 132 396 M 260 300 C 250 380 200 400 168 396', class: 'bone' }, g);
      el('path', { d: 'M 236 352 l 10 6 l -6 4 l 10 6', class: 'crack' }, g);
    }
    if (m === 'straddle') el('path', { d: 'M 120 492 L 180 492', class: 'bone' }, g);
  }
}

/**
 * Render the diagram into `host`. `desc` = schematic description; `labels` = { right, left, title }.
 */
export function renderTract(host, desc, labels) {
  host.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': labels.title, class: 'tract' });
  host.appendChild(svg);
  const defs = el('defs', {}, svg);
  const grad = el('radialGradient', { id: 'sysGlow', cx: '50%', cy: '45%', r: '65%' }, defs);
  el('stop', { offset: '55%', 'stop-color': 'var(--critical)', 'stop-opacity': 0 }, grad);
  el('stop', { offset: '100%', 'stop-color': 'var(--critical)', 'stop-opacity': 0.32 }, grad);
  if (desc.systemic > 0.02) el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#sysGlow)', opacity: clamp(desc.systemic, 0, 1), class: 'systemic' }, svg);
  const g = el('g', {}, svg);
  const kid = desc.kidneys || {};
  const ure = desc.ureters || {};
  drawMarks(g, (desc.marks || []).filter((m) => m === 'fibrosis' || m === 'nodes' || m === 'pelvicFracture'));
  drawUreter(g, 'R', ure.R, kid.R?.absent);
  drawUreter(g, 'L', ure.L, kid.L?.absent);
  drawKidney(g, 'R', kid.R);
  drawKidney(g, 'L', kid.L);
  const female = desc.sex === 'f';
  drawMarks(g, (desc.marks || []).filter((m) => m === 'pelvicMass'));
  if (female) drawFemale(g, desc); else drawMale(g, desc);
  drawBladder(g, desc.bladder, female);
  drawUrethralLesion(g, desc, female);
  drawMarks(g, (desc.marks || []).filter((m) => !['fibrosis', 'nodes', 'pelvicFracture', 'pelvicMass'].includes(m)));
  el('text', { x: KID.R.cx, y: 34, class: 'side-label', 'text-anchor': 'middle' }, svg).textContent = labels.right;
  el('text', { x: KID.L.cx, y: 34, class: 'side-label', 'text-anchor': 'middle' }, svg).textContent = labels.left;
  return svg;
}
