import { categories } from './library.mjs';

const top = 'M121 50 89 62 45 103l38 40 26-20 2 96h98l2-96 26 20 38-40-44-41-32-12q-39 33-78 0Z';
const long = 'M123 50 95 61 65 81 43 210l35 11 28-99 1 98h106l1-98 28 99 35-11-22-129-30-20-28-11q-37 29-74 0Z';
const coat = 'M123 43 96 55 69 74 47 216l34 8 25-100-2 120h112l-2-120 25 100 34-8-22-142-27-19-27-12q-37 28-74 0Z';
const bottom = 'M104 29h112l16 211h-56l-16-134-16 134H88Z';
const shorts = 'M96 53h128l20 148h-67l-17-67-17 67H76Z';
const shoe = 'M63 55q24-16 47 1l7 60q17 33 24 68c4 23-10 36-36 37-34 2-51-11-52-35-2-27 8-42 13-65Z';
const bag = 'M74 102h172l12 121H62Z';
const cap = 'M82 159q1-89 78-89 71 4 78 89 23 12 44 36-20 21-58 11l-99-28-42 4Z';
const glasses = 'M44 113q38-16 97 0l-5 36q-10 34-48 29-38-3-41-38Zm135 0q59-16 97 0l-3 27q-3 35-41 38-38 5-48-29Z';
const scarf = 'M101 41h117v124H116Zm15 124h102v54l-100 7Z';

export function apparelIllustration({ category, color, shape, name }) {
  if (!categories.has(category) || !/^#[0-9a-f]{6}$/i.test(color || '')) return null;
  const look = (name + ' ' + shape).slice(0, 300);
  let garment;
  let seams;
  if (category === '下装') {
    const short = /短裤|五分裤|百慕大/.test(look);
    garment = short ? shorts : bottom;
    seams = short ? 'M95 65h130m-66-12v58m-38-40-19 26m96-26 19 26' : 'M104 41h112m-56-12v61m-31-41-19 27m81-27 19 27m-62 18-34 132m58-132 34 132';
    if (/工装|口袋/.test(look) && !short) seams += 'M92 126h41v45H92m94-45h41v45h-41';
  } else if (category === '鞋履') {
    const formal = /德比|乐福|皮鞋|便士|牛津鞋|短靴/.test(look);
    const stitch = formal ? 'M77 96h31m-33 12h34m-37 12h41m-47 46q33-19 66 0' : 'M66 80h44m-44 15h48m-49 14h52m-54 15h57m-61 64q37 24 75 0';
    return frame(color, '<g>' + part(shoe, stitch) + '</g><g transform="translate(120 0)">' + part(shoe, stitch) + '</g>');
  } else if (category === '配饰') {
    if (/镜/.test(look)) {
      return frame(color, '<path d="' + glasses + '" fill="' + (/墨|太阳镜/.test(look) ? 'url(#fabric)' : 'none') + '" stroke="var(--ink)" stroke-width="8"/><path d="M140 126q20-10 40 0m-135-11-24 1m254-1 24 1" stroke="var(--ink)" stroke-width="8" fill="none"/>');
    }
    if (/帽/.test(look)) {
      garment = cap; seams = 'M82 159q71-18 156 0m-73-88q-26 47-21 79m12 17q76 8 104 35';
    } else if (/巾|领带/.test(look)) {
      garment = scarf; seams = 'M101 52h117m-14 177v12m-15-12v9m-16-10v11m-15-10v9m-16-9v10m-15-10v8';
    } else if (/皮带|腰带/.test(look)) {
      return frame(color, '<ellipse cx="153" cy="136" rx="98" ry="43" fill="none" stroke="var(--ink)" stroke-width="29"/><path d="M71 159q79 55 175-15" stroke="url(#fabric)" fill="none" stroke-width="20"/><rect x="73" y="161" width="62" height="35" rx="4" fill="none" stroke="#a89a82" stroke-width="6"/>');
    } else {
      return frame(color, '<path d="M114 125V75a46 46 0 0 1 92 0v50" fill="none" stroke="var(--ink)" stroke-width="10"/>' + part(bag, 'M76 117h168m-148 0v86m128-86v86m-152 7h176'));
    }
  } else {
    const short = /短袖|T恤|POLO/i.test(look) && !/长袖/.test(look);
    const overcoat = category === '外套' && /大衣|长款|长风衣/.test(look);
    const collared = /衬衫|夹克|西装|翻领|大衣|风衣|polo/i.test(look);
    garment = overcoat ? coat : short ? top : long;
    seams = collared ? 'M123 52l12 35 25-16 25 16 12-35m-37 19v148'
      : 'M126 51q34 43 68 0m-65 7q31 25 62 0';
    if (/开衫|拉链|西装|羽绒|绗缝/.test(look)) seams += 'M160 75v145';
    if (/工装|牛仔|军装/.test(look)) seams += 'M112 113h32v31h-32zm64 0h32v31h-32z';
    if (/条纹/.test(look)) seams += 'M112 108h96m-96 17h96m-96 17h96m-96 17h96m-96 17h96m-96 17h96';
    if (/连帽/.test(look)) seams += 'M129 69q-14-29 31-32 45 3 31 32m-44 4v32m26-32v32';
  }
  return frame(color, part(garment, seams));
}

function part(garment, seams) {
  return '<path d="' + garment + '" fill="url(#fabric)" stroke="var(--ink)" stroke-width="1.4"/><path d="' + seams
    + '" fill="none" stroke="var(--ink)" opacity=".4" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
}

function frame(color, drawing) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260" aria-hidden="true" style="--ink:' + color + '">'
    + '<defs><linearGradient id="fabric" x1="0" y1="0" x2="1" y2="1"><stop stop-color="var(--ink)" stop-opacity=".73"/>'
    + '<stop offset=".48" stop-color="var(--ink)" stop-opacity=".97"/><stop offset="1" stop-color="var(--ink)"/></linearGradient>'
    + '<filter id="shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="1" dy="6" stdDeviation="5" flood-color="#473e30" flood-opacity=".14"/></filter></defs>'
    + '<path d="M0 0h320v260H0z" fill="#ebe5db"/><g filter="url(#shadow)">' + drawing + '</g></svg>';
}
