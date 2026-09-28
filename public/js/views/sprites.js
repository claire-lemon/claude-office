import { $ } from '../lib/dom.js';

// ---------- pixel animal definitions (rect-based) ----------
const R = (x,y,w,h,fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const DEFAULT_EYES = R(8,16,2,2,'#2b2b2b') + R(14,16,2,2,'#2b2b2b');

export const ANIMALS = {
  cat: {
    head:'#f2b565', body:'#f2b565',
    ears: R(5,4,5,7,'#f2b565')+R(6,1,3,4,'#f2b565')+R(14,4,5,7,'#f2b565')+R(15,1,3,4,'#f2b565'),
    accent: R(9,20,6,3,'#fff8ef')+R(11,20,2,1,'#e07a8b'),
  },
  dog: {
    head:'#d9a066', body:'#d9a066',
    ears: R(0,10,5,10,'#a86b3d')+R(19,10,5,10,'#a86b3d'),
    accent: R(9,20,6,3,'#fff3e0')+R(11,20,2,2,'#2b2b2b'),
  },
  rabbit: {
    head:'#f5eee6', body:'#f5eee6', stroke:'#00000022',
    ears: R(6,0,3,10,'#f5eee6')+R(7,2,1,6,'#f7c9d6')+R(15,0,3,10,'#f5eee6')+R(16,2,1,6,'#f7c9d6'),
    accent: R(11,20,2,1,'#e07a8b'),
  },
  bear: {
    head:'#8a5a37', body:'#8a5a37',
    ears: R(3,7,5,5,'#6b4423')+R(16,7,5,5,'#6b4423'),
    accent: R(8,19,8,4,'#c9a06a')+R(11,20,2,2,'#2b2b2b'),
  },
  penguin: {
    head:'#232830', body:'#232830',
    ears:'',
    eyesUnderlay: R(6,14,5,5,'#ffffff')+R(13,14,5,5,'#ffffff'),
    accent: R(10,20,4,3,'#f2a33d'),
    torsoAccent: R(9,25,6,6,'#ffffff'),
  },
  fox: {
    head:'#e8783c', body:'#e8783c',
    ears: R(5,4,5,7,'#e8783c')+R(6,1,3,4,'#fff8ef')+R(14,4,5,7,'#e8783c')+R(15,1,3,4,'#fff8ef'),
    accent: R(8,19,8,5,'#fff8ef')+R(11,20,2,1,'#2b2b2b'),
  },
  hamster: {
    head:'#e3b98a', body:'#e3b98a',
    ears: R(4,9,4,4,'#c99a67')+R(16,9,4,4,'#c99a67'),
    accent: R(3,18,4,4,'#f3cfa0')+R(17,18,4,4,'#f3cfa0')+R(11,20,2,1,'#c97b4a'),
  },
  panda: {
    head:'#ffffff', body:'#ffffff', stroke:'#00000022',
    ears: R(3,7,5,5,'#2b2b2b')+R(16,7,5,5,'#2b2b2b'),
    eyesUnderlay: R(5,14,6,6,'#2b2b2b')+R(13,14,6,6,'#2b2b2b'),
    eyes: R(6,15,4,4,'#ffffff')+R(14,15,4,4,'#ffffff')+R(7,16,2,2,'#000000')+R(15,16,2,2,'#000000'),
    accent: R(11,20,2,1,'#000000'),
  },
  duck: {
    head:'#f4d35e', body:'#f4d35e', stroke:'#00000022',
    ears:'',
    accent: R(9,20,7,3,'#f2a33d'),
  },
  frog: {
    head:'#7cb342', body:'#7cb342',
    ears:'',
    eyes: R(6,5,6,6,'#eaf6de')+R(8,7,3,3,'#2b2b2b')+R(12,5,6,6,'#eaf6de')+R(14,7,3,3,'#2b2b2b'),
    accent: R(7,21,10,1,'#2b2b2b'),
  },
};
export const ANIMAL_LABELS = {cat:'고양이',dog:'강아지',rabbit:'토끼',bear:'곰',penguin:'펭귄',fox:'여우',hamster:'햄스터',panda:'판다',duck:'오리',frog:'개구리'};
export const safeAnimal = name => (ANIMALS[name] ? name : 'cat');

const buildAnimalInner = cfg => {
  const strokeAttr = cfg.stroke ? ` stroke="${cfg.stroke}" stroke-width="0.6"` : '';
  const head = `<rect x="4" y="10" width="16" height="14" fill="${cfg.head}"${strokeAttr}/>`;
  const torso = `<rect x="6" y="24" width="12" height="8" fill="${cfg.body}"${strokeAttr}/>`;
  const eyes = cfg.eyes || DEFAULT_EYES;
  return `${cfg.ears||''}${head}${cfg.eyesUnderlay||''}${eyes}${cfg.accent||''}${torso}${cfg.torsoAccent||''}`;
};
$('#animal-defs').innerHTML = Object.entries(ANIMALS)
  .map(([name,cfg]) => `<symbol id="animal-${name}" viewBox="0 0 24 34">${buildAnimalInner(cfg)}</symbol>`)
  .join('');
