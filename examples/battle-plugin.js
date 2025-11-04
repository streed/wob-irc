// RPG MUD-like plugin with persistent characters, exploration, battles, loot, leveling,
// and a small per-character memory buffer for in-character interactions.

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

// RNG helpers
const randInt = (min, max) => crypto.randomInt(min, max + 1);
const choice = (arr) => arr[crypto.randomInt(0, arr.length)];

const DB_PATH = path.resolve(process.cwd(), 'rpg.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nick TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  exp INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100,
  gold INTEGER NOT NULL DEFAULT 0,
  inventory TEXT NOT NULL DEFAULT '[]',
  achievements TEXT NOT NULL DEFAULT '[]',
  memory TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT 'Town',
  equipment TEXT NOT NULL DEFAULT '{}',
  effects TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Quests and achievements tables
db.exec(`
CREATE TABLE IF NOT EXISTS quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active|completed
  progress TEXT NOT NULL DEFAULT '[]',
  reward_gold INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  UNIQUE(character_id, title),
  FOREIGN KEY(character_id) REFERENCES characters(id)
);
CREATE TABLE IF NOT EXISTS achievements_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  details TEXT,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(character_id, name),
  FOREIGN KEY(character_id) REFERENCES characters(id)
);
-- Boards, shops, and enemies for freshness
CREATE TABLE IF NOT EXISTS quest_board_seed (
  location TEXT PRIMARY KEY,
  seed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shop_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT NOT NULL,
  item TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(location, item)
);
CREATE TABLE IF NOT EXISTS enemies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  location TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migrations for existing DBs created before new columns
function ensureColumn(table, name, ddl) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  const found = info.some(c => String(c.name) === String(name));
  if (!found) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
ensureColumn('characters', 'location', "TEXT NOT NULL DEFAULT 'Town'");
ensureColumn('characters', 'equipment', "TEXT NOT NULL DEFAULT '{}' ");
ensureColumn('characters', 'effects', "TEXT NOT NULL DEFAULT '{}' ");
// inventory capacity for stacking/limits
try { ensureColumn('characters', 'capacity', 'INTEGER NOT NULL DEFAULT 20'); } catch (_) {}
// Quests: add target_location for world objectives
try { ensureColumn('quests', 'target_location', 'TEXT'); } catch (_) {}
ensureColumn('characters', 'place', "TEXT DEFAULT NULL");

const getCharByNick = db.prepare(`SELECT * FROM characters WHERE nick=?`);
const getCharById = db.prepare(`SELECT * FROM characters WHERE id=?`);
const insertChar = db.prepare(`
  INSERT INTO characters (nick, name, class, level, exp, hp, max_hp, gold, inventory, achievements, memory, location, equipment, effects, capacity, place)
  VALUES (@nick, @name, @class, @level, @exp, @hp, @max_hp, @gold, @inventory, @achievements, @memory, @location, @equipment, @effects, @capacity, @place)
`);
const updateChar = db.prepare(`
  UPDATE characters
  SET name=@name, class=@class, level=@level, exp=@exp, hp=@hp, max_hp=@max_hp, gold=@gold,
      inventory=@inventory, achievements=@achievements, memory=@memory, location=@location,
      equipment=@equipment, effects=@effects, capacity=@capacity, place=@place,
      updated_at=datetime('now')
  WHERE id=@id
`);
const listChars = db.prepare(`SELECT nick, name, class, level, hp, max_hp, gold FROM characters ORDER BY level DESC, gold DESC LIMIT ?`);

// World map tables and helpers
db.exec(`
CREATE TABLE IF NOT EXISTS world_nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS world_edges (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  biome TEXT NOT NULL,
  travel TEXT NOT NULL,
  distance INTEGER NOT NULL,
  UNIQUE(from_id, to_id)
);
CREATE TABLE IF NOT EXISTS world_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);
const countWorldNodes = db.prepare(`SELECT COUNT(1) as c FROM world_nodes`);
const insertWorldNode = db.prepare(`INSERT OR IGNORE INTO world_nodes (id, name, category, difficulty, x, y) VALUES (?,?,?,?,?,?)`);
const insertWorldEdge = db.prepare(`INSERT OR IGNORE INTO world_edges (from_id, to_id, biome, travel, distance) VALUES (?,?,?,?,?)`);
const getWorldNode = db.prepare(`SELECT * FROM world_nodes WHERE id=?`);
const findWorldNodeByName = db.prepare(`SELECT * FROM world_nodes WHERE lower(replace(name,' ', '_'))=? LIMIT 1`);
const listNeighborEdges = db.prepare(`SELECT to_id as id, biome, travel, distance FROM world_edges WHERE from_id=? ORDER BY distance ASC`);
const getMeta = db.prepare(`SELECT value FROM world_meta WHERE key=?`);
const setMeta = db.prepare(`INSERT INTO world_meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
const listTowns = db.prepare(`SELECT id, name, x, y FROM world_nodes WHERE category='Town'`);
const listCities = db.prepare(`SELECT id, name, x, y FROM world_nodes WHERE category='City'`);
const listDungeons = db.prepare(`SELECT id, name, x, y FROM world_nodes WHERE category='Dungeon'`);
const updateDifficulty = db.prepare(`UPDATE world_nodes SET difficulty=? WHERE id=?`);
const hasDungeonEdge = db.prepare(`SELECT 1 FROM world_edges e JOIN world_nodes n ON n.id=e.to_id WHERE e.from_id=? AND n.category='Dungeon' LIMIT 1`);

// Quest statements
const upsertQuest = db.prepare(`
  INSERT INTO quests (character_id, title, details, status, progress, reward_gold, reward_xp, target_location)
  VALUES (@character_id, @title, @details, @status, @progress, @reward_gold, @reward_xp, @target_location)
  ON CONFLICT(character_id, title) DO UPDATE SET
    details=excluded.details,
    status=excluded.status,
    reward_gold=excluded.reward_gold,
    reward_xp=excluded.reward_xp,
    target_location=COALESCE(excluded.target_location, quests.target_location)
`);
const getQuest = db.prepare(`SELECT * FROM quests WHERE character_id=? AND title=?`);
const setQuestProgress = db.prepare(`UPDATE quests SET progress=@progress WHERE id=@id`);
const completeQuestStmt = db.prepare(`UPDATE quests SET status='completed', completed_at=datetime('now') WHERE id=?`);
const listQuestsByStatus = db.prepare(`
  SELECT title, status, reward_gold, reward_xp, target_location
  FROM quests
  WHERE character_id=@cid AND (@status='all' OR status=@status)
  ORDER BY (status='active') DESC, created_at DESC
  LIMIT @limit
`);

// Achievement statements
const insertAchievement = db.prepare(`
  INSERT INTO achievements_log (character_id, name, details)
  VALUES (@character_id, @name, @details)
  ON CONFLICT(character_id, name) DO NOTHING
`);
const hasAchievementStmt = db.prepare(`SELECT 1 FROM achievements_log WHERE character_id=? AND name=?`);
const listAchievementsStmt = db.prepare(`SELECT name, details, earned_at FROM achievements_log WHERE character_id=? ORDER BY earned_at DESC LIMIT ?`);

// Freshness helpers
const getBoardSeed = db.prepare(`SELECT seed FROM quest_board_seed WHERE location=?`);
const setBoardSeed = db.prepare(`INSERT INTO quest_board_seed (location, seed, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(location) DO UPDATE SET seed=excluded.seed, updated_at=datetime('now')`);
const distinctLocations = db.prepare(`SELECT DISTINCT location FROM characters`);
const getShopStock = db.prepare(`SELECT qty FROM shop_stock WHERE location=? AND item=?`);
const setShopStock = db.prepare(`INSERT INTO shop_stock (location, item, qty, updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(location,item) DO UPDATE SET qty=excluded.qty, updated_at=datetime('now')`);
const decShopStock = db.prepare(`UPDATE shop_stock SET qty = CASE WHEN qty>0 THEN qty-1 ELSE 0 END, updated_at=datetime('now') WHERE location=? AND item=?`);
const deleteEnemiesAt = db.prepare(`DELETE FROM enemies WHERE location=?`);
const insertEnemy = db.prepare(`INSERT INTO enemies (name, level, location, updated_at) VALUES (?,?,?,datetime('now'))`);
const listEnemiesAt = db.prepare(`SELECT id, name, level FROM enemies WHERE location=? ORDER BY level DESC LIMIT ?`);

// Tiered shop catalogs by location category
function getCatalogForLocation(loc) {
  const cat = categoryOf(loc);
  const town = [
    ['Healing Potion', 25, 6],
    ['Traveler Cloak', 40, 4],
    ['Iron Sword', 60, 3],
    ['Leather Armor', 50, 3],
    ['Lucky Charm', 35, 4],
    ['Strength Tonic', 30, 4],
    ['Shield Charm', 45, 3],
  ];
  const city = [
    ...town,
    ['Oak Staff', 55, 4],
    ['Bag +5', 60, 2],
    ['Backpack +10', 120, 1],
    ['Horse', 120, 2],
    ['Boat', 200, 1],
    ['Boat Ticket', 35, 6],
  ];
  if (cat === 'City') return city;
  if (cat === 'Town') return town;
  // No shop elsewhere for now
  return [];
}

function xpForNextLevel(level) { return 100 * level; }
function levelUpIfNeeded(c) {
  let ding = false;
  while (c.exp >= xpForNextLevel(c.level)) {
    c.exp -= xpForNextLevel(c.level);
    c.level += 1;
    c.max_hp += 10;
    c.hp = Math.min(c.max_hp, c.hp + 10);
    ding = true;
  }
  return ding;
}

function baseNickOf(nick) {
  const s = String(nick || '');
  return s.replace(/^M-/i, '');
}

function ensureCharacter(nick, nameOpt, classOpt) {
  let c = getCharByNick.get(nick);
  if (c) return c;
  const classes = ['Warrior', 'Rogue', 'Mage', 'Paladin', 'Ranger'];
  const name = baseNickOf(nick);
  const clazz = (classOpt && String(classOpt).trim()) || choice(classes);
  initWorldIfNeeded();
  // pick a consistent starting Town from world meta
  initWorldIfNeeded();
  let start = getStartNode() || 'Town';
  const initial = {
    nick,
    name,
    class: clazz,
    level: 1,
    exp: 0,
    hp: 100,
    max_hp: 100,
    gold: 0,
    inventory: JSON.stringify([]),
    achievements: JSON.stringify([]),
    memory: '',
    location: start,
    equipment: JSON.stringify({}),
    effects: JSON.stringify({}),
    capacity: 20,
    place: null,
  };
  insertChar.run(initial);
  return getCharByNick.get(nick);
}

function saveCharacter(c) {
  const row = { ...c };
  row.inventory = typeof row.inventory === 'string' ? row.inventory : JSON.stringify(row.inventory || []);
  row.achievements = typeof row.achievements === 'string' ? row.achievements : JSON.stringify(row.achievements || []);
  row.memory = String(row.memory || '');
  row.equipment = typeof row.equipment === 'string' ? row.equipment : JSON.stringify(row.equipment || {});
  row.effects = typeof row.effects === 'string' ? row.effects : JSON.stringify(row.effects || {});
  updateChar.run(row);
}

// World map generation with creative names
function slugify(name) { return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_'); }
function uniqueId(name, used) {
  let base = slugify(name);
  let id = base;
  let i = 2;
  while (used.has(id)) { id = `${base}_${i++}`; }
  used.add(id);
  return id;
}
function pick(arr) { return arr[crypto.randomInt(0, arr.length)]; }
function initWorldIfNeeded() {
  const row = countWorldNodes.get();
  if (row && row.c > 0) { ensureWorldMaintenance(); return; }
  const used = new Set();
  const adj = ['Oak','Silver','Moon','Gold','Shadow','Sun','Storm','Iron','Raven','Bright','Mist','Elder','Red','Green','Frost','Star','Ash','Duskwind','High','Low'];
  const townN = ['brook','hollow','ford','ridge','field','vale','gate','haven','crest','watch','wharf','bridge','grove','meadow','heath','moor'];
  const cityN = ['Crown','Reach','Harbor','Spire','Citadel','Market','Bazaar','Commons','Plaza','Arcade','Garden'];
  const dungeonAdj = ['Ancient','Forgotten','Cursed','Gloom','Sunken','Shattered','Grim','Echoing','Haunted','Silent'];
  const dungeonN = ['Tomb','Vault','Catacombs','Depths','Labyrinth','Sanctum','Pit','Caverns','Crypt','Dungeon'];
  const names = new Set();
  function makeTown(){ const name = `${pick(adj)} ${pick(townN)}`; if(names.has(name)) return makeTown(); names.add(name); return name; }
  function makeCity(){ const name = `${pick(adj)} ${pick(cityN)}`; if(names.has(name)) return makeCity(); names.add(name); return name; }
  function makeDungeon(){ const name = `${pick(dungeonAdj)} ${pick(dungeonN)}`; if(names.has(name)) return makeDungeon(); names.add(name); return name; }
  const nodes = [];
  const rnd = (n) => crypto.randomInt(0, n);
  for (let i=0;i<50;i++){ const name=makeTown(); nodes.push({ id: uniqueId(name, used), name, category:'Town', difficulty:1, x:rnd(1000), y:rnd(1000)}); }
  for (let i=0;i<50;i++){ const name=makeCity(); nodes.push({ id: uniqueId(name, used), name, category:'City', difficulty:2, x:rnd(1000), y:rnd(1000)}); }
  for (let i=0;i<50;i++){ const name=makeDungeon(); nodes.push({ id: uniqueId(name, used), name, category:'Dungeon', difficulty:1+rnd(5), x:rnd(1000), y:rnd(1000)}); }
  for (const n of nodes) insertWorldNode.run(n.id, n.name, n.category, n.difficulty, n.x, n.y);
  const dist=(a,b)=>{const dx=a.x-b.x, dy=a.y-b.y; return Math.max(1, Math.round(Math.hypot(dx,dy))); };
  const biomeFor=(a,b)=>{const d=dist(a,b), r=Math.random(); if(d>400) return r<0.6?'ocean':'river'; if(d>200) return r<0.5?'river':(r<0.8?'forest':'city'); return r<0.7?'forest':'city';};
  const travelFor=(biome)=> biome==='ocean'||biome==='river'?'boat':(Math.random()<0.3?'horse':'walk');
  const towns = nodes.filter(n=>n.category==='Town');
  for (let i=0;i<towns.length;i++){
    const a=towns[i];
    if(i>0){ let best=null,bd=1e9; for(let j=0;j<i;j++){ const b=towns[j]; const d=dist(a,b); if(d<bd){bd=d; best=b;} } const biome=biomeFor(a,best), travel=travelFor(biome); insertWorldEdge.run(a.id,best.id,biome,travel,bd); insertWorldEdge.run(best.id,a.id,biome,travel,bd);} 
    for (let k=0;k<2;k++){ const b=towns[rnd(towns.length)]; if(b.id===a.id) continue; const d=dist(a,b); if(d>600) continue; const biome=biomeFor(a,b), travel=travelFor(biome); insertWorldEdge.run(a.id,b.id,biome,travel,d); insertWorldEdge.run(b.id,a.id,biome,travel,d);} }
  const cities = nodes.filter(n=>n.category==='City');
  for (const a of cities){ const sorted=towns.map(t=>({t,d:dist(a,t)})).sort((x,y)=>x.d-y.d).slice(0,3); const m=1+rnd(2); for(let i=0;i<m && i<sorted.length;i++){ const b=sorted[i].t; const d=sorted[i].d; const biome=biomeFor(a,b), travel=travelFor(biome); insertWorldEdge.run(a.id,b.id,biome,travel,d); insertWorldEdge.run(b.id,a.id,biome,travel,d);} }
  const dungeons = nodes.filter(n=>n.category==='Dungeon');
  for (const a of dungeons){ const sorted=towns.map(t=>({t,d:dist(a,t)})).sort((x,y)=>x.d-y.d).slice(0,2); const m=1+rnd(2); for(let i=0;i<m && i<sorted.length;i++){ const b=sorted[i].t; const d=sorted[i].d; insertWorldEdge.run(a.id,b.id,'forest','walk',d); insertWorldEdge.run(b.id,a.id,'forest','walk',d);} }

  // Choose a start town and store in meta
  const startTown = towns.reduce((best, t) => {
    const cur = (t.x||0)+(t.y||0);
    if (!best) return { t, s: cur };
    return cur < best.s ? { t, s: cur } : best;
  }, null)?.t || towns[0];
  if (startTown) setMeta.run('start_node', startTown.id);

  // Scale difficulties based on distance from start
  scaleDifficultiesFrom(startTown?.id || towns[0]?.id);

  // Ensure each town has a dungeon connection
  ensureTownDungeonAccess();
}

function prettyName(locId) { const n = getWorldNode.get(String(locId)); return n ? n.name : String(locId); }
function categoryOf(locId) { const n = getWorldNode.get(String(locId)); return n ? n.category : 'Town'; }
function neighborEdges(locId) { return listNeighborEdges.all(String(locId)); }
function neighborsOf(locId) { return neighborEdges(locId).map(e => e.id); }
function resolveLocationQuery(input) { if (!input) return null; const q = String(input).trim(); const direct = getWorldNode.get(q); if (direct) return direct.id; const byName = findWorldNodeByName.get(q.toLowerCase().replace(/\s+/g,'_')); return byName ? byName.id : null; }

function getStartNode() {
  const row = getMeta.get('start_node');
  if (row && row.value) return String(row.value);
  // Fallback: pick the first Town and persist
  const ts = listTowns.all();
  if (ts && ts.length) { setMeta.run('start_node', ts[0].id); return ts[0].id; }
  return 'Town';
}

function scaleDifficultiesFrom(startId) {
  if (!startId) return;
  const s = getWorldNode.get(String(startId));
  if (!s) return;
  const dist = (a,b)=>{const dx=(a.x||0)-(b.x||0), dy=(a.y||0)-(b.y||0); return Math.max(1, Math.round(Math.hypot(dx,dy))); };
  const ts = listTowns.all();
  const cs = listCities.all();
  const ds = listDungeons.all();
  for (const t of ts) {
    const d = dist(t, s);
    const lvl = Math.max(1, 1 + Math.floor(d / 200));
    updateDifficulty.run(lvl, t.id);
  }
  for (const c of cs) {
    const d = dist(c, s);
    const lvl = Math.max(2, 2 + Math.floor(d / 180));
    updateDifficulty.run(lvl, c.id);
  }
  for (const dg of ds) {
    const d = dist(dg, s);
    const lvl = Math.max(1, 1 + Math.floor(d / 220));
    updateDifficulty.run(lvl, dg.id);
  }
}

function ensureTownDungeonAccess() {
  const ts = listTowns.all();
  const ds = listDungeons.all();
  if (!ts.length || !ds.length) return;
  const dist = (a,b)=>{const dx=(a.x||0)-(b.x||0), dy=(a.y||0)-(b.y||0); return Math.max(1, Math.round(Math.hypot(dx,dy))); };
  for (const t of ts) {
    const has = hasDungeonEdge.get(t.id);
    if (has) continue;
    // find nearest dungeon
    const nearest = ds.map(dg => ({ dg, d: dist(t, dg) })).sort((a,b)=>a.d-b.d)[0];
    if (!nearest) continue;
    insertWorldEdge.run(t.id, nearest.dg.id, 'forest', 'walk', nearest.d);
    insertWorldEdge.run(nearest.dg.id, t.id, 'forest', 'walk', nearest.d);
  }
}

let worldMaintained = false;
function ensureWorldMaintenance() {
  if (worldMaintained) return;
  worldMaintained = true;
  try {
    const start = getStartNode();
    if (start) scaleDifficultiesFrom(start);
    ensureTownDungeonAccess();
  } catch (_) {}
}

function getNodeCoords(id) {
  const n = getWorldNode.get(String(id));
  if (!n) return null;
  return { x: Number(n.x)||0, y: Number(n.y)||0 };
}

function calcDistance(aId, bId) {
  const a = getWorldNode.get(String(aId));
  const b = getWorldNode.get(String(bId));
  if (!a || !b) return Infinity;
  const dx = (a.x||0) - (b.x||0); const dy = (a.y||0) - (b.y||0);
  return Math.max(1, Math.round(Math.hypot(dx, dy)));
}

function planRoute(fromId, toId, maxNodes = 1000) {
  const start = String(fromId); const goal = String(toId);
  if (start === goal) return [];
  const q = [start];
  const seen = new Set([start]);
  const prev = {}; // prev[node] = { from, travel, distance }
  let steps = 0;
  while (q.length && steps < maxNodes) {
    const cur = q.shift(); steps++;
    const edges = neighborEdges(cur);
    for (const e of edges) {
      const nid = String(e.id);
      if (seen.has(nid)) continue;
      seen.add(nid);
      prev[nid] = { from: cur, travel: e.travel, distance: e.distance };
      if (nid === goal) {
        // reconstruct
        const path = [];
        let p = nid;
        while (p && p !== start) {
          const info = prev[p];
          path.push({ to: p, from: info.from, travel: info.travel, distance: info.distance });
          p = info.from;
        }
        path.reverse();
        return path;
      }
      q.push(nid);
    }
  }
  return null;
}

// In-town/city places
function getPlacesFor(loc) {
  const cat = categoryOf(loc);
  if (cat === 'City') {
    // Ensure at least Tavern, Shop, Blacksmith, Town Square exist
    return ['Tavern','Shop','Blacksmith','Town Square','Guild Hall','Temple of Light','Harbor Docks','Mage Tower'];
  }
  if (cat === 'Town') {
    return ['Tavern','Shop','Blacksmith','Town Square','Chapel','Inn'];
  }
  return [];
}
// Seeded ordering helpers for quest boards
function ensureBoardSeed(loc) {
  const row = getBoardSeed.get(String(loc));
  if (row && typeof row.seed === 'number') return row.seed;
  const seed = crypto.randomInt(0, 1_000_000_000);
  setBoardSeed.run(String(loc), seed);
  return seed;
}

function hashWithSeed(str, seed) {
  let h = seed >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) * 0x45d9f3b;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

function seededOrder(templates, seed) {
  return (templates || [])
    .map(t => ({ t, k: hashWithSeed(t.title || String(t), seed) }))
    .sort((a,b) => a.k - b.k)
    .map(x => x.t);
}

function chooseQuestTarget(loc, quest, seed) {
  // Prefer local for small rewards; neighbors for higher rewards; dungeon for highest if available
  try {
    const xp = Number(quest?.reward_xp || 0);
    const gold = Number(quest?.reward_gold || 0);
    const cur = String(loc);
    if (xp <= 20 && gold <= 15) return cur; // easy/local
    const edges = listNeighborEdges.all(cur) || [];
    if (edges.length === 0) return cur;
    // Category preference
    const neighbors = edges.map(e => ({ id: e.id, cat: categoryOf(e.id) }));
    let pref = [];
    if (xp >= 35 || gold >= 25) {
      pref = neighbors.filter(n => n.cat === 'Dungeon');
    }
    if (pref.length === 0 && (xp >= 25 || gold >= 20)) {
      pref = neighbors.filter(n => n.cat === 'City');
    }
    if (pref.length === 0) pref = neighbors.filter(n => n.cat === 'Town');
    if (pref.length === 0) pref = neighbors;
    const ordered = pref
      .map(n => ({ n, k: hashWithSeed(`${quest?.title || ''}|${n.id}|${seed}`, seed) }))
      .sort((a,b)=> a.k - b.k)
      .map(x => x.n);
    return ordered[0]?.id || cur;
  } catch (_) {
    return String(loc);
  }
}

function addLoot(c, items, gold) {
  try {
    const inv = JSON.parse(c.inventory || '[]');
    for (const it of items) inv.push(it);
    c.inventory = JSON.stringify(inv);
  } catch (_) {
    c.inventory = JSON.stringify(items);
  }
  const curGold = parseInt(c.gold, 10);
  const incGold = parseInt(gold, 10);
  c.gold = (Number.isFinite(curGold) ? curGold : 0) + (Number.isFinite(incGold) ? incGold : 0);
}

function appendMemory(c, line, maxLen = 900) {
  const prev = String(c.memory || '')
    .split('\n')
    .slice(-8)
    .join('\n');
  const next = (prev ? prev + '\n' : '') + String(line || '').slice(0, 200);
  c.memory = next.slice(-maxLen);
}

function parseEquipment(c) {
  try { return JSON.parse(c.equipment || '{}') || {}; } catch { return {}; }
}

function parseEffects(c) {
  try { return JSON.parse(c.effects || '{}') || {}; } catch { return {}; }
}

function setEffect(c, key, value) {
  const eff = parseEffects(c);
  eff[key] = value;
  c.effects = JSON.stringify(eff);
}

function consumeEffect(c, key) {
  const eff = parseEffects(c);
  const val = eff[key];
  if (val !== undefined) {
    delete eff[key];
    c.effects = JSON.stringify(eff);
  }
  return val;
}

function getCombatMods(c) {
  const eq = parseEquipment(c);
  let atkBonus = 0;
  let dmgReduction = 0;
  if (eq.weapon) {
    const lvl = parseUpgradeLevel(eq.weapon);
    const base = baseName(eq.weapon);
    if (base === 'Iron Sword') atkBonus += 4 + lvl;
    if (base === 'Oak Staff') atkBonus += 3 + lvl;
  }
  if (eq.accessory === 'Lucky Charm') atkBonus += 1;
  if (eq.armor) {
    const lvlA = parseUpgradeLevel(eq.armor);
    const baseA = baseName(eq.armor);
    if (baseA === 'Leather Armor') dmgReduction += 2 + Math.floor(lvlA / 1);
    if (baseA === 'Traveler Cloak') dmgReduction += 0; // no battle DR
  }
  if (eq.accessory) {
    const baseX = baseName(eq.accessory);
    if (baseX === 'Shield Charm') dmgReduction += 1;
  }
  const eff = parseEffects(c);
  if (typeof eff.attack_bonus === 'number') atkBonus += eff.attack_bonus;
  return { atkBonus, dmgReduction };
}

function getExploreMods(c) {
  const eq = parseEquipment(c);
  let hpLossReduction = 0;
  if (eq.armor) {
    const lvl = parseUpgradeLevel(eq.armor);
    const base = baseName(eq.armor);
    if (base === 'Traveler Cloak') hpLossReduction += 3 + Math.floor(lvl / 1);
  }
  if (eq.accessory && baseName(eq.accessory) === 'Shield Charm') hpLossReduction += 2;
  const eff = parseEffects(c);
  if (typeof eff.toughness_bonus === 'number') hpLossReduction += eff.toughness_bonus;
  return { hpLossReduction };
}

function hasAchievement(c, name) {
  try { return !!hasAchievementStmt.get(c.id, String(name)); } catch { return false; }
}

function earnAchievement(c, name, details) {
  try { insertAchievement.run({ character_id: c.id, name: String(name), details: details || null }); } catch (_) {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Inline, truncated list formatting for IRC friendliness
function inlineList(items, maxLen = 420) {
  const out = [];
  let total = 0;
  for (const [i, it] of (items || []).entries()) {
    const seg = String(it);
    const addLen = (out.length === 0 ? seg.length : seg.length + 3); // +3 for ' | '
    if (total + addLen > maxLen) { out.push('...'); break; }
    out.push(seg);
    total += addLen;
  }
  return out.join(' | ');
}

async function conciseSay(ctx, channel, lines, maxLines = 6, pacingMs = 0) {
  if (!ctx || !ctx.say || !channel) return;
  const bounded = (lines || []).slice(0, maxLines);
  for (const l of bounded) {
    await ctx.say(channel, l);
    if (pacingMs > 0) await sleep(pacingMs);
  }
}

function makeNPC(level, location) {
  const titlesByLoc = {
    Town: ['Ruffian', 'Brawler', 'Cutpurse'],
    Forest: ['Wolf', 'Bandit', 'Druid'],
    Caves: ['Trog', 'Goblin', 'Tunneler'],
    Ruins: ['Cultist', 'Wraith', 'Knight'],
    Catacombs: ['Skeleton', 'Ghoul', 'Shade'],
    Arena: ['Gladiator', 'Champion', 'Myrmidon'],
  };
  const epithets = ['of Ash', 'of Frost', 'of the Vale', 'of Ruin', 'of Dusk', 'of Dawn'];
  const loc = location || 'Ruins';
  const titles = titlesByLoc[loc] || ['Bandit', 'Cultist', 'Wraith', 'Goblin', 'Knight', 'Sorcerer', 'Golem'];
  const name = `${choice(titles)} ${choice(epithets)}`;
  // Scaling curve by location
  const locFactor = ({ Town: 0.9, Forest: 1.0, Caves: 1.1, Ruins: 1.2, Catacombs: 1.3, Arena: 1.25 }[loc]) || 1.0;
  const effLevel = Math.max(1, Math.round(level * locFactor));
  const base = 60 + 10 * effLevel;
  return {
    name,
    level: effLevel,
    hp: Math.round(base * (0.9 + Math.random() * 0.3)),
    max_hp: Math.round(base * (0.9 + Math.random() * 0.3)),
    weapon: choice(['Rusty Blade', 'Shadow Staff', 'Broken Spear', 'Hexed Dagger', 'War Club']),
  };
}

function simulateBattle(a, b, rounds = 3, aMods = { atkBonus: 0, dmgReduction: 0 }, bMods = { atkBonus: 0, dmgReduction: 0 }) {
  const out = [];
  out.push(`— Battle: ${a.name} (Lv${a.level}) vs ${b.name} (Lv${b.level || 1}) —`);
  for (let r = 1; r <= rounds && a.hp > 0 && b.hp > 0; r++) {
    out.push(`Round ${r}`);
    let d1 = randInt(8, 25) + Math.floor(a.level / 2) + (aMods.atkBonus || 0);
    d1 = Math.max(1, d1 - (bMods.dmgReduction || 0));
    b.hp = Math.max(0, b.hp - d1);
    out.push(`${a.name} strikes for ${d1}. ${b.name} HP ${b.hp}/${b.max_hp}`);
    if (b.hp <= 0) break;
    let d2 = randInt(8, 25) + Math.floor((b.level || 1) / 2) + (bMods.atkBonus || 0);
    d2 = Math.max(1, d2 - (aMods.dmgReduction || 0));
    a.hp = Math.max(0, a.hp - d2);
    out.push(`${b.name} counters for ${d2}. ${a.name} HP ${a.hp}/${a.max_hp}`);
  }
  let winner;
  if (a.hp > 0 && b.hp <= 0) winner = 'a';
  else if (b.hp > 0 && a.hp <= 0) winner = 'b';
  else winner = a.hp >= b.hp ? 'a' : 'b';
  return { out, result: { winner } };
}

function maybeSpawnEncounter(c, locId, ctx) {
  // 35% chance to spawn an urgent encounter, expires in ~60s
  if (Math.random() >= 0.35) return;
  const loc = String(locId);
  // Prefer existing enemies at location; else make an NPC scaling to character level and location category
  let pickEnemy = null;
  try {
    const rows = listEnemiesAt.all(loc, 5) || [];
    if (rows.length > 0) {
      const r = rows[crypto.randomInt(0, rows.length)];
      pickEnemy = { name: r.name, level: Math.max(1, r.level || c.level) };
    }
  } catch(_) {}
  if (!pickEnemy) {
    const cat = categoryOf(loc) || 'Town';
    const base = Math.max(1, c.level + (cat === 'Dungeon' ? 1 : 0));
    const made = makeNPC(base, cat);
    pickEnemy = { name: made.name, level: made.level };
  }
  const ttl = 45 + crypto.randomInt(0, 31); // 45–75s
  const expAt = Math.floor(Date.now()/1000) + ttl;
  upsertEncounter.run({ character_id: c.id, location: loc, enemy_name: pickEnemy.name, enemy_level: pickEnemy.level, expires_at: expAt });
  const line = `Urgent: Encounter — ${pickEnemy.name} (Lv${pickEnemy.level}) appears! fight_now within ~${ttl}s`;
  conciseSay(ctx, ctx?.channel, [ line ], 1, 0);
}

// Location quest templates (by category)
const QUEST_TEMPLATES = {
  Town: [
    { title: 'Lost Purse', details: 'Find the merchant\'s lost purse near the gates.', reward_xp: 20, reward_gold: 15, minLv: 1, maxLv: 3 },
    { title: 'Supply Run', details: 'Deliver herbs to the apothecary.', reward_xp: 18, reward_gold: 12, minLv: 1, maxLv: 4 },
    { title: 'Blacksmith Materials', details: 'Fetch ore or charcoal for the smith.', reward_xp: 22, reward_gold: 14, minLv: 1, maxLv: 5 },
    { title: 'Guard the Road', details: 'Escort travelers along a short stretch.', reward_xp: 24, reward_gold: 16, minLv: 1, maxLv: 5 },
    { title: 'Explore the Cavern', details: 'Scout the nearby cavern and report back.', reward_xp: 36, reward_gold: 26, minLv: 2, maxLv: 6 },
    { title: 'Bounty: Local Ruffian', details: 'Deal with a known troublemaker.', reward_xp: 28, reward_gold: 20, minLv: 2, maxLv: 6 },
  ],
  City: [
    { title: 'Market Duties', details: 'Help inspect wares for the guild.', reward_xp: 26, reward_gold: 18, minLv: 2, maxLv: 6 },
    { title: 'Courier Work', details: 'Deliver sealed letters to a nearby town.', reward_xp: 30, reward_gold: 20, minLv: 2, maxLv: 7 },
    { title: 'Arena Warmup', details: 'Spar with recruits at the arena.', reward_xp: 32, reward_gold: 22, minLv: 3, maxLv: 8 },
    { title: 'Explore the Underworks', details: 'Scout tunnels beneath the city.', reward_xp: 40, reward_gold: 28, minLv: 3, maxLv: 8 },
    { title: 'Bounty: Alley Shade', details: 'Track a lurking menace.', reward_xp: 34, reward_gold: 24, minLv: 3, maxLv: 8 },
  ],
  Dungeon: [
    { title: 'Probe the Depths', details: 'Chart part of the dungeon.', reward_xp: 44, reward_gold: 28, minLv: 3, maxLv: 9 },
    { title: 'Recover Relics', details: 'Retrieve a relic from within.', reward_xp: 46, reward_gold: 30, minLv: 4, maxLv: 10 },
    { title: 'Purge the Foyer', details: 'Clear the entrance chambers.', reward_xp: 42, reward_gold: 26, minLv: 3, maxLv: 8 },
  ],
  Forest: [
    { title: 'Wolf Tracks', details: 'Track the wolves deeper into the woods.', reward_xp: 28, reward_gold: 16, minLv: 2, maxLv: 6 },
    { title: 'Herbalist Aid', details: 'Gather mooncap and duskroot.', reward_xp: 24, reward_gold: 18, minLv: 2, maxLv: 5 },
  ],
  Caves: [
    { title: 'Echoes Below', details: 'Investigate strange sounds from the caverns.', reward_xp: 32, reward_gold: 22, minLv: 3, maxLv: 7 },
    { title: 'Shimmering Veins', details: 'Map glittering ore veins.', reward_xp: 34, reward_gold: 20, minLv: 3, maxLv: 7 },
  ],
  Ruins: [
    { title: 'Shattered Sigils', details: 'Recover an intact sigil stone.', reward_xp: 34, reward_gold: 20, minLv: 3, maxLv: 8 },
    { title: 'Archivist Request', details: 'Sketch carvings within the ruins.', reward_xp: 36, reward_gold: 22, minLv: 3, maxLv: 8 },
  ],
  Catacombs: [
    { title: 'Restless Bones', details: 'Lay a wandering spirit to rest.', reward_xp: 36, reward_gold: 24, minLv: 4, maxLv: 9 },
    { title: 'Candlelight Vigil', details: 'Place candles at old shrines.', reward_xp: 38, reward_gold: 22, minLv: 4, maxLv: 9 },
  ],
  Arena: [
    { title: 'Glory in the Arena', details: 'Win a bout before the crowd.', reward_xp: 30, reward_gold: 25, minLv: 3, maxLv: 10 },
    { title: 'Proving Grounds', details: 'Defeat two challengers in a row.', reward_xp: 40, reward_gold: 28, minLv: 4, maxLv: 10 },
  ],
};

// Location loot tables
const LOOT_TABLES = {
  Town: ['Healing Potion', 'Forge Shard', 'Lucky Charm'],
  Forest: ['Wolfsbane Herb', 'Moonstone Shard', 'Traveler Cloak', 'Healing Potion'],
  Caves: ['Ancient Coin', 'Tarnished Key', 'Iron Sword', 'Forge Shard'],
  Ruins: ['Silver Ring', 'Shattered Sigil', 'Leather Armor', 'Forge Shard'],
  Catacombs: ['Bone Charm', 'Shield Charm', 'Healing Potion', 'Forge Shard'],
  Arena: ['Strength Tonic', 'Lucky Charm', 'Iron Sword'],
};

function pickLootForLocation(location) {
  const table = LOOT_TABLES[location] || ['Ancient Coin'];
  // 60% chance to find one item
  if (Math.random() < 0.6) {
    // Chance for upgraded gear in tougher areas
    const item = choice(table);
    const toughFactor = ({ Town: 0, Forest: 0.2, Caves: 0.35, Ruins: 0.45, Catacombs: 0.55, Arena: 0.5 }[location] || 0.2);
    const roll = Math.random();
    let bonus = 0;
    if (roll < toughFactor * 0.5) bonus = 1;
    if (roll < toughFactor * 0.2) bonus = 2;
    const isUpgradable = /Iron Sword|Oak Staff|Traveler Cloak|Leather Armor|Shield Charm|Lucky Charm/.test(item);
    if (isUpgradable && bonus > 0) return [`${item} +${bonus}`];
    return [item];
  }
  return [];
}

function parseUpgradeLevel(itemName) {
  const m = String(itemName || '').match(/\+(\d+)\s*$/);
  return m ? Math.max(0, parseInt(m[1], 10) || 0) : 0;
}

function baseName(itemName) {
  return String(itemName || '').replace(/\s*\+\d+\s*$/, '').trim();
}

const plugin = {
  name: 'battle',
  description:
    'RPG MUD with SQLite persistence, world map travel, shops/quests/places, index-based menus, and concise single-line IRC output. For freeform user phrases, call the menu tool with the utterance to route to the right numbered-list tool.',
  tools: [
    {
      name: 'list_places',
      description: 'List in-town/city places you can enter (e.g., Tavern, Shop, Square) with indices.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'show_places',
      description: 'Alias for list_places (e.g., when user says "show places").',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'go_to_place',
      description: 'Enter a place in the current Town/City by [index] from list_places (stays in same location).',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'go_to',
      description: 'Alias for go_to_place by index (use when user says "go to 1").',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'goto',
      description: 'Alias for go_to_place by index (use when user says "goto 1").',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'list_shop',
      description: 'List shop items with indices, prices and stock at your location (Town/City).',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'shop_list',
      description: 'Alias for list_shop.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'shop_buy',
      description: 'Buy by item name or [index] from list_shop. Capacity upgrades apply instantly.',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, item: { type: 'string' }, index: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'create_character',
      description: 'Create or return a persistent character bound to a user nick.',
      parameters: {
        type: 'object',
        properties: {
          nick: { type: 'string', description: 'User nick for the character' },
          name: { type: 'string', description: 'Display name (optional)' },
          class: { type: 'string', description: 'Class, e.g., Warrior, Rogue, Mage (optional)' },
        },
        required: ['nick'],
      },
    },
    {
      name: 'get_character',
      description: 'Get a concise summary of a character.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string', description: 'User nick' } },
        required: ['nick'],
      },
    },
    {
      name: 'list_characters',
      description: 'List top characters (by level then gold) briefly.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'string', description: 'Max characters to list (default 10)' } },
        required: [],
      },
    },
    {
      name: 'quest_board',
      description: 'Show quest board for the current location (numbered). Accept via select_quest or accept_quest_template.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'quests',
      description: 'Alias for quest_board.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'available_quests',
      description: 'Alias for quest_board (natural phrasing).',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'show_available_quests',
      description: 'Alias for quest_board (e.g., "show available quests").',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'show_quest_board',
      description: 'Alias for quest_board (e.g., "show the quest board").',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'show_the_quest_board',
      description: 'Alias for quest_board (natural phrasing).',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'questboard',
      description: 'Alias for quest_board.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'accept_quest_template',
      description: 'Accept a quest by title or [index] from the current quest board.',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, title: { type: 'string' }, index: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'select_quest',
      description: 'Alias: accept quest by [index] from the current quest board.',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'selectquest',
      description: 'Alias for select_quest (natural phrasing).',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'select-quest',
      description: 'Alias for select_quest (dash variant).',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'explore_dungeon',
      description: 'Short dungeon foray: concise narration, loot/XP, possible HP loss.',
      parameters: {
        type: 'object',
        properties: {
          nick: { type: 'string', description: 'User nick' },
          theme: { type: 'string', description: 'Optional theme hint (e.g., frost, ruins, forest)' },
        },
        required: ['nick'],
      },
    },
    {
      name: 'battle',
      description: 'Start a concise 2–3 round battle vs NPC or player. Natural: "fight", "challenge <nick>".',
      parameters: {
        type: 'object',
        properties: {
          nick: { type: 'string', description: 'Challenger nick' },
          opponent_nick: { type: 'string', description: 'Opponent character nick (optional)' },
          opponent_type: { type: 'string', description: "'player' | 'npc' | 'random' (default random)", enum: ['player', 'npc', 'random'] },
        },
        required: ['nick'],
      },
    },
    {
      name: 'fight_now',
      description: 'Engage a time-sensitive encounter that just appeared (expires quickly). Natural: "fight now", "engage".',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'accept_encounter',
      description: 'Alias for fight_now when an urgent encounter appears.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'decline_encounter',
      description: 'Dismiss the current time-sensitive encounter (if any). Natural: "skip", "not now".',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'encounter_status',
      description: 'Show the active encounter (if any) with time remaining. Natural: "encounter?", "status", "remind me".',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'show_encounter',
      description: 'Alias for encounter_status.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'menu',
      description: 'Natural-language dispatcher for common menu requests (e.g., "show me the quest board", "show places", "where am I", "what\'s in the shop"). Prefer this for freeform user phrases.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, utterance: { type: 'string' } },
        required: ['nick','utterance'],
      },
    },
    {
      name: 'travel_to',
      description: 'Travel to an adjacent world map node by name/id (enforces horse/boat). Use route_to + travel_index for multi-hop.',
      parameters: {
        type: 'object',
        properties: {
          nick: { type: 'string' },
          destination: { type: 'string', description: 'World node name or id (adjacent only)' },
        },
        required: ['nick', 'destination'],
      },
    },
    {
      name: 'get_location',
      description: 'Return the character\'s current persistent location.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'inspect_inventory',
      description: 'List inventory items concisely.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'shop_buy',
      description: 'Buy at Town: Healing Potion (25g), Traveler Cloak (40g), Iron Sword (60g), Leather Armor (50g), Lucky Charm (35g), Oak Staff (55g), Strength Tonic (30g), Shield Charm (45g).',
      parameters: {
        type: 'object',
        properties: {
          nick: { type: 'string' },
          item: { type: 'string', description: 'Item name (exact)' },
        },
        required: ['nick', 'item'],
      },
    },
    {
      name: 'use_item',
      description: 'Use a consumable from inventory (Healing Potion, Strength Tonic). Applies effect and removes one from inventory.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, item: { type: 'string' } },
        required: ['nick', 'item'],
      },
    },
    {
      name: 'equip_item',
      description: 'Equip an item to a slot (weapon|armor|accessory) if compatible; removes one from inventory.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, item: { type: 'string' }, slot: { type: 'string', enum: ['weapon','armor','accessory'] } },
        required: ['nick','item','slot'],
      },
    },
    {
      name: 'unequip_item',
      description: 'Unequip a slot back to inventory. Natural: "unequip weapon".',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, slot: { type: 'string', enum: ['weapon','armor','accessory'] } }, required: ['nick','slot'] },
    },
    {
      name: 'get_equipment',
      description: 'Show what is equipped (weapon/armor/accessory). Natural: "equipment", "gear".',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'quest_board',
      description: 'Show current location quests as [index] Title XP/gold → Target. Triggers: "show quests", "show quest board". Accept with select_quest.',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, min_level: { type: 'string' }, max_level: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'accept_quest_template',
      description: 'Accept a quest by its exact title. Prefer select_quest [index].',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, title: { type: 'string' } }, required: ['nick','title'] },
    },
    {
      name: 'append_memory',
      description: 'Append a short in-character memory line (keeps ~8 recent).',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, line: { type: 'string' } },
        required: ['nick', 'line'],
      },
    },
    {
      name: 'start_quest',
      description: 'Manually create/upsert a quest (advanced). Prefer quest_board + select_quest for normal flow.',
      parameters: {
        type: 'object',
        properties: {
          nick: { type: 'string' },
          title: { type: 'string' },
          details: { type: 'string' },
          reward_gold: { type: 'string', description: 'Integer gold reward' },
          reward_xp: { type: 'string', description: 'Integer XP reward' },
        },
        required: ['nick', 'title'],
      },
    },
    {
      name: 'update_quest',
      description: 'Append a short progress note to a quest. Natural: "quest update <Title>: note".',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' } },
        required: ['nick', 'title', 'note'],
      },
    },
    {
      name: 'complete_quest',
      description: 'Complete a quest and apply rewards (must be at target). Natural: "complete <Title>".',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, title: { type: 'string' } },
        required: ['nick', 'title'],
      },
    },
    {
      name: 'list_quests',
      description: 'List active/completed/all quests as a compact, single line. Triggers: "show quests", "what quests are active".',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, status: { type: 'string', enum: ['active', 'completed', 'all'] }, limit: { type: 'string' } },
        required: ['nick'],
      },
    },
    {
      name: 'show_quests',
      description: 'Alias for list_quests (active).',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'show_the_quests',
      description: 'Alias for list_quests (active).',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'earn_achievement',
      description: 'Log an achievement for the character (idempotent by name).',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, name: { type: 'string' }, details: { type: 'string' } },
        required: ['nick', 'name'],
      },
    },
    {
      name: 'list_achievements',
      description: 'List recent achievements.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' }, limit: { type: 'string' } },
        required: ['nick'],
      },
    },
    {
      name: 'get_memory',
      description: 'Retrieve the small in-character memory buffer for a character.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' } },
        required: ['nick'],
      },
    },
    {
      name: 'rest',
      description: 'Rest to recover some HP.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' } },
        required: ['nick'],
      },
    },
    {
      name: 'list_neighbors',
      description: 'Show adjacent locations as [index] Name [mode] LvX. Triggers: "where can I travel", "show exits". Select with travel_index 1.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'get_neighbors',
      description: 'Alias for list_neighbors (some LLMs call get_neighbors).',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'neighbors',
      description: 'Alias for list_neighbors.',
      parameters: { type: 'object', properties: { nick: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'travel_index',
      description: 'Travel to a neighbor by [index] (from list_neighbors). Enforces level/horse/boat/ticket.',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, index: { type: 'string' } }, required: ['nick','index'] },
    },
    {
      name: 'find_locations',
      description: 'Search nearby world nodes by name/category (Town/City/Dungeon). Triggers: "find cities", "search for \u003cname\u003e".',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, query: { type: 'string' }, category: { type: 'string', enum: ['Town','City','Dungeon'] }, limit: { type: 'string' } }, required: ['nick'] },
    },
    {
      name: 'route_to',
      description: 'Plan a route to a named destination (does not move). Use with list_neighbors + travel_index to follow.',
      parameters: { type: 'object', properties: { nick: { type: 'string' }, destination: { type: 'string' } }, required: ['nick','destination'] },
    },
    {
      name: 'start_battle',
      description: 'Back-compat alias for a concise battle vs a random NPC.',
      parameters: {
        type: 'object',
        properties: { nick: { type: 'string' } },
        required: ['nick'],
      },
    },
  ],
  execute: async (toolName, parameters, ctx) => {
    try {
      if (toolName === 'menu') {
        const { nick } = parameters;
        const u = String(parameters.utterance || '').toLowerCase();
        // Quest board / quests
        if (u.includes('quest board') || (u.includes('board') && u.includes('quest'))) {
          return await plugin.execute('quest_board', { nick }, ctx);
        }
        if (u.includes('current quests') || (u.includes('show') && u.includes('quests')) || u.includes('available quests')) {
          return await plugin.execute('list_quests', { nick, status: 'active', limit: '10' }, ctx);
        }
        if (u.includes('completed quests')) {
          return await plugin.execute('list_quests', { nick, status: 'completed', limit: '10' }, ctx);
        }
        // Places
        if (u.includes('show places') || u.includes("what's in town") || u.includes('whats in town') || (u.includes('in town') && u.includes('what'))) {
          return await plugin.execute('list_places', { nick }, ctx);
        }
        // Shop
        if (u.includes('shop') && (u.includes('show') || u.includes('list') || u.includes("what's") || u.includes('whats'))) {
          return await plugin.execute('list_shop', { nick }, ctx);
        }
        // Neighbors / travel options
        if (u.includes('neighbors') || u.includes('exits') || u.includes('travel') || u.includes('paths')) {
          return await plugin.execute('list_neighbors', { nick }, ctx);
        }
        // Location
        if (u.includes('where am i') || (u.includes('where') && u.includes('am i')) || u.includes('location')) {
          return await plugin.execute('get_location', { nick }, ctx);
        }
        // Inventory
        if (u.includes('inventory') || u.includes('bag')) {
          return await plugin.execute('inspect_inventory', { nick }, ctx);
        }
        // Encounter status
        if (u.includes('encounter') || u.includes('remind') || u.includes('status')) {
          return await plugin.execute('encounter_status', { nick }, ctx);
        }
        // Fallback to quest board as a helpful default
        return await plugin.execute('quest_board', { nick }, ctx);
      }
      if (toolName === 'create_character') {
        const { nick, name, class: clazz } = parameters;
        const c = ensureCharacter(String(nick), name, clazz);
        return `Created/loaded ${c.name} the ${c.class} (Lv${c.level}) — HP ${c.hp}/${c.max_hp}, Gold ${c.gold}.`;
      }

      if (toolName === 'get_character') {
        const { nick } = parameters;
        const c = getCharByNick.get(String(nick));
        if (!c) return `No character for ${nick}. Use create_character first.`;
        const inv = (() => { try { return JSON.parse(c.inventory || '[]'); } catch (_) { return []; } })();
        return `${c.name} the ${c.class} (Lv${c.level}) — HP ${c.hp}/${c.max_hp}, Gold ${c.gold}, Inv ${inv.length} item(s).`;
      }

      if (toolName === 'list_characters') {
        const limit = Math.max(1, Math.min(30, parseInt(parameters.limit || '10', 10) || 10));
        const rows = listChars.all(limit);
        if (!rows || rows.length === 0) return 'No characters created yet.';
        const items = rows.map((r, i) => `${i + 1}. ${r.name} Lv${r.level} ${r.gold}g`);
        return inlineList(items);
      }

      if (toolName === 'append_memory') {
        const { nick, line } = parameters;
        const c = ensureCharacter(String(nick));
        appendMemory(c, String(line || '').slice(0, 200));
        saveCharacter(c);
        return `Memory updated for ${c.name}.`;
      }

      if (toolName === 'get_memory') {
        const { nick } = parameters;
        const c = getCharByNick.get(String(nick));
        if (!c) return `No character for ${nick}.`;
        const mem = String(c.memory || '').trim();
        return mem ? mem : '(no recent character memory)';
      }

      if (toolName === 'rest') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const heal = randInt(8, 20);
        c.hp = Math.min(c.max_hp, c.hp + heal);
        saveCharacter(c);
        await conciseSay(ctx, ctx?.channel, [ `${c.name} rests by the campfire, recovering ${heal} HP.` ], 1);
        return `${c.name} recovers ${heal} HP (now ${c.hp}/${c.max_hp}).`;
      }

      if (toolName === 'list_neighbors' || toolName === 'get_neighbors' || toolName === 'neighbors') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const cur = c.location || 'Town';
        const edges = listNeighborEdges.all(String(cur));
        if (!edges || edges.length === 0) return 'No neighbors.';
        const items = edges.map((e,i)=>{
          const n = getWorldNode.get(String(e.id));
          const req = n ? n.difficulty : 1;
          return `[${i+1}] ${prettyName(e.id)} [${e.travel}] Lv${req}`;
        });
        return `${inlineList(items)} — travel: travel_index 1`;
      }

      if (toolName === 'travel_index') {
        const { nick, index } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const cur = c.location || 'Town';
        const edges = listNeighborEdges.all(String(cur));
        const i = Math.max(1, parseInt(String(index), 10) || 0) - 1;
        if (i < 0 || i >= edges.length) return 'Invalid neighbor index. Use list_neighbors first.';
        const dest = edges[i];
        const inv = (()=>{ try { return JSON.parse(c.inventory||'[]'); } catch(_) { return []; }})();
        const has = (name)=> inv.some(it => String(it).toLowerCase().startsWith(name.toLowerCase()));
        const destNode = getWorldNode.get(String(dest.id));
        if (destNode && (destNode.category === 'Town' || destNode.category === 'City')) {
          const required = Math.max(1, parseInt(destNode.difficulty || 1, 10) || 1);
          if ((c.level || 1) < required) return `Requires Lv${required} to enter ${destNode.name}.`;
        }
        let travelNote = '';
        if (dest.travel === 'boat') {
          if (!has('Boat')) {
            const idxTicket = inv.findIndex(it => String(it).toLowerCase() === 'boat ticket');
            if (idxTicket === -1) return `Requires a Boat or a Boat Ticket (${prettyName(cur)} → ${prettyName(dest.id)}).`;
            inv.splice(idxTicket, 1);
            c.inventory = JSON.stringify(inv);
            travelNote = ' (used Boat Ticket)';
          }
        }
        if (dest.travel === 'horse' && !has('Horse')) return `Requires a Horse to travel (${prettyName(cur)} → ${prettyName(dest.id)}).`;
        c.location = dest.id;
        c.place = null;
        saveCharacter(c);
        await conciseSay(ctx, ctx?.channel, [ `${c.name} travels to ${prettyName(dest.id)}${travelNote}.` ], 1, 200);
        // Chance for a time-sensitive encounter on arrival
        try {
          maybeSpawnEncounter(c, dest.id, ctx);
        } catch(_) {}
        return `${c.name} is now at ${prettyName(dest.id)}.`;
      }

      if (toolName === 'find_locations') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const cur = c.location || 'Town';
        const qText = (parameters.query || '').toString().trim().toLowerCase();
        const cat = (parameters.category || '').toString().trim();
        const limit = Math.max(1, Math.min(50, parseInt(parameters.limit || '10', 10) || 10));
        const all = db.prepare(`SELECT id, name, category, x, y FROM world_nodes`).all();
        const filtered = all.filter(n => {
          if (n.id === cur) return false;
          if (cat && n.category !== cat) return false;
          if (qText && !(n.name.toLowerCase().includes(qText) || n.id.toLowerCase().includes(qText))) return false;
          return true;
        });
        if (filtered.length === 0) return 'No matching locations found.';
        const withDist = filtered.map(n => ({ n, d: calcDistance(cur, n.id) }));
        withDist.sort((a,b)=> a.d - b.d);
        const items = withDist.slice(0, limit).map(({n,d}, i) => `[${i+1}] ${n.name} (${n.category}) ${d}`);
        return `${inlineList(items)} — route: route_to <name>`;
      }

      if (toolName === 'route_to') {
        const { nick, destination } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const cur = c.location || 'Town';
        const destId = resolveLocationQuery(destination);
        if (!destId) return `Unknown destination: ${destination}`;
        if (destId === cur) return `Already at ${prettyName(destId)}.`;
        const path = planRoute(cur, destId);
        if (!path) return `No route found to ${prettyName(destId)}.`;
        const parts = [];
        let from = cur;
        for (const step of path) {
          parts.push(`${prettyName(from)}→${prettyName(step.to)}(${step.travel})`);
          from = step.to;
        }
        return `${inlineList(parts)} — move: list_neighbors`;
      }

      if (toolName === 'list_places' || toolName === 'show_places') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const loc = c.location || 'Town';
        const places = getPlacesFor(loc);
        if (!places || places.length === 0) return 'No places to enter here.';
        const items = places.map((p,i)=>`[${i+1}] ${p}`);
        return `${inlineList(items)} — enter: go to 1`;
      }

      if (toolName === 'go_to_place' || toolName === 'go_to' || toolName === 'goto') {
        const { nick, index } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const loc = c.location || 'Town';
        const places = getPlacesFor(loc);
        if (!places || places.length === 0) return 'No places to enter here.';
        const i = Math.max(1, parseInt(String(index), 10) || 0) - 1;
        if (i < 0 || i >= places.length) return 'Invalid place index. Use list_places.';
        const place = places[i];
        c.place = place;
        saveCharacter(c);
        await conciseSay(ctx, ctx?.channel, [ `${c.name} enters the ${place}.` ], 1, 150);
        return `${c.name} is at ${place} in ${prettyName(loc)}.`;
      }

      if (toolName === 'explore_dungeon') {
        const { nick, theme } = parameters;
        const c = ensureCharacter(String(nick));
        const flavorHint = theme && String(theme).trim() ? ` of ${String(theme).trim()}` : '';
        const env = c.location || 'Ruins';
        const flavor = flavorHint || ` of ${env}`;
        const baseLoss = randInt(0, 18);
        const { hpLossReduction } = getExploreMods(c);
        const hpLoss = Math.max(0, baseLoss - (hpLossReduction || 0));
        const xp = randInt(12, 28);
        const gold = randInt(5, 30);
        const loot = pickLootForLocation(env);

        c.hp = Math.max(0, c.hp - hpLoss);
        c.exp = (parseInt(c.exp, 10) || 0) + xp;
        addLoot(c, loot, gold);
        const ding = levelUpIfNeeded(c);
        // consume one-time toughness bonus if present
        if (parseEffects(c).toughness_bonus) consumeEffect(c, 'toughness_bonus');
        saveCharacter(c);
        if (!hasAchievement(c, 'Pathfinder')) earnAchievement(c, 'Pathfinder', 'First successful exploration.');

        const lines = [];
        lines.push(`— ${c.name} explores the ${env}${flavor} —`);
        if (hpLoss > 0) lines.push(`Brushes danger (−${hpLoss} HP).`);
        if (loot.length > 0) lines.push(`Finds ${loot.join(', ')} (+${gold}g, +${xp}xp).`); else lines.push(`Gains +${gold}g, +${xp}xp.`);
        if (ding) lines.push(`Level up! Now Lv${c.level}, HP ${c.hp}/${c.max_hp}.`); else lines.push(`HP ${c.hp}/${c.max_hp}.`);
        await conciseSay(ctx, ctx?.channel, lines, 4, 250);

        // Auto-quest: Scout current location (single-step)
        const scoutTitle = `Scout the ${env}`;
        const q = getQuest.get(c.id, scoutTitle);
        if (!q) {
          upsertQuest.run({ character_id: c.id, title: scoutTitle, details: `Survey the ${env}.`, status: 'active', progress: '[]', reward_gold: 10, reward_xp: 12 });
          await conciseSay(ctx, ctx?.channel, [ `${c.name} picks up a local task: ${scoutTitle}.` ], 1, 200);
        } else if (q.status === 'active') {
          completeQuestStmt.run(q.id);
          c.exp = (parseInt(c.exp, 10) || 0) + 12; addLoot(c, [], 10); saveCharacter(c);
          earnAchievement(c, `Quest: ${scoutTitle}`, 'Completed a scouting task.');
          await conciseSay(ctx, ctx?.channel, [ `Quest complete: ${scoutTitle}! (+12xp, +10g)` ], 1, 200);
        }

        return lines.join('\n');
      }

      if (toolName === 'fight_now' || toolName === 'accept_encounter') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const enc = getEncounterForChar.get(c.id);
        if (!enc) return 'No active encounter.';
        const now = Math.floor(Date.now()/1000);
        if (enc.expires_at <= now) { deleteEncounterForChar.run(c.id); return 'Encounter expired.'; }
        const npc = { name: enc.enemy_name, level: enc.enemy_level, hp: 60 + 10*enc.enemy_level, max_hp: 60 + 10*enc.enemy_level };
        const a = { name: c.name, level: c.level, hp: c.hp, max_hp: c.max_hp };
        const aMods = getCombatMods(c);
        const bMods = { atkBonus: 0, dmgReduction: 0 };
        const { out, result } = simulateBattle(a, npc, 3, aMods, bMods);
        await conciseSay(ctx, ctx?.channel, out, 4, 350);
        let xp = 0, gold = 0;
        if (result.winner === 'a') { xp = randInt(16, 34); gold = randInt(8, 20); c.exp = (parseInt(c.exp, 10) || 0) + xp; addLoot(c, [], gold); }
        else { xp = randInt(6, 14); c.exp = (parseInt(c.exp, 10) || 0) + xp; }
        c.hp = a.hp; const ding = levelUpIfNeeded(c); saveCharacter(c);
        deleteEncounterForChar.run(c.id);
        const tail = [];
        if (result.winner === 'a') tail.push(`${c.name} prevails! +${xp}xp, +${gold}g. HP ${c.hp}/${c.max_hp}.`);
        else tail.push(`${c.name} withdraws. +${xp}xp. HP ${c.hp}/${c.max_hp}.`);
        if (ding) tail.push(`Level up! Now Lv${c.level}.`);
        await conciseSay(ctx, ctx?.channel, tail, 2, 250);
        return [...out, ...tail].join('\n');
      }

      if (toolName === 'decline_encounter') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        deleteEncounterForChar.run(c.id);
        return 'Encounter dismissed.';
      }

      if (toolName === 'encounter_status' || toolName === 'show_encounter') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const enc = getEncounterForChar.get(c.id);
        if (!enc) return 'No active encounter.';
        const now = Math.floor(Date.now()/1000);
        if (enc.expires_at <= now) { deleteEncounterForChar.run(c.id); return 'Encounter expired.'; }
        const remain = enc.expires_at - now;
        return `Encounter: ${enc.enemy_name} (Lv${enc.enemy_level}) — expires in ${fmtSecs(remain)} — fight: fight_now`;
      }

      if (toolName === 'battle' || toolName === 'start_battle') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        let target;
        const optType = parameters.opponent_type || (toolName === 'start_battle' ? 'npc' : 'random');
        if (parameters.opponent_nick && String(parameters.opponent_nick).trim()) {
          target = getCharByNick.get(String(parameters.opponent_nick).trim());
          if (!target) return `Opponent ${parameters.opponent_nick} not found.`;
        } else if (optType === 'player') {
          return 'Opponent nick required for player battles.';
        } else {
          target = makeNPC(Math.max(1, c.level + (Math.random() < 0.5 ? 0 : 1)));
        }

        const a = { name: c.name, level: c.level, hp: c.hp, max_hp: c.max_hp };
        const b = target.id ? { name: target.name, level: target.level, hp: target.hp, max_hp: target.max_hp } : target;
        const aMods = getCombatMods(c);
        const bMods = target.id ? getCombatMods(target) : { atkBonus: 0, dmgReduction: 0 };
        const { out, result } = simulateBattle(a, b, 3, aMods, bMods);
        await conciseSay(ctx, ctx?.channel, out, 6, 450);

        let xp = 0, gold = 0;
        if (result.winner === 'a') { xp = randInt(20, 40); gold = randInt(10, 30); c.exp = (parseInt(c.exp, 10) || 0) + xp; addLoot(c, [], gold); }
        else { xp = randInt(8, 18); c.exp = (parseInt(c.exp, 10) || 0) + xp; }
        c.hp = a.hp;
        if (parseEffects(c).attack_bonus) consumeEffect(c, 'attack_bonus');
        const ding = levelUpIfNeeded(c);
        saveCharacter(c);
        if (result.winner === 'a' && !hasAchievement(c, 'First Victory')) earnAchievement(c, 'First Victory', 'Won a battle.');
        if (target.id) { target.hp = b.hp; saveCharacter(target); }

        const tail = [];
        if (result.winner === 'a') tail.push(`${c.name} wins! +${xp}xp, +${gold}g. HP ${c.hp}/${c.max_hp}.`);
        else tail.push(`${c.name} falls short. +${xp}xp. HP ${c.hp}/${c.max_hp}.`);
        if (ding) {
          tail.push(`Level up! Now Lv${c.level}.`);
          if (c.level >= 5 && !hasAchievement(c, 'Seasoned Adventurer')) earnAchievement(c, 'Seasoned Adventurer', 'Reached level 5.');
        }
        await conciseSay(ctx, ctx?.channel, tail, 2, 450);
        return [...out, ...tail].join('\n');
      }

      if (toolName === 'travel_to') {
        const { nick, destination } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const dest = String(destination || '').trim();
        if (!dest) return 'Destination required.';
        const cur = c.location || 'Town';
        const destId = resolveLocationQuery(dest);
        if (!destId) return `Unknown world location: ${dest}. Use find_locations or list_neighbors.`;
        if (String(destId) === String(cur)) return `Already at ${prettyName(destId)}.`;
        const edges = listNeighborEdges.all(String(cur));
        const e = edges.find(x => String(x.id) === String(destId));
        if (!e) {
          const suggestion = `Not adjacent. Use route_to to plan hops, then travel_index to move step-by-step.`;
          return suggestion;
        }
        const inv = (()=>{ try { return JSON.parse(c.inventory||'[]'); } catch(_) { return []; }})();
        const has = (name)=> inv.some(it => String(it).toLowerCase().startsWith(name.toLowerCase()));
        const destNode = getWorldNode.get(String(destId));
        if (destNode && (destNode.category === 'Town' || destNode.category === 'City')) {
          const required = Math.max(1, parseInt(destNode.difficulty || 1, 10) || 1);
          if ((c.level || 1) < required) return `Requires Lv${required} to enter ${destNode.name}.`;
        }
        let travelNote = '';
        if (e.travel === 'boat') {
          if (!has('Boat')) {
            const idxTicket = inv.findIndex(it => String(it).toLowerCase() === 'boat ticket');
            if (idxTicket === -1) return `Requires a Boat or a Boat Ticket (${prettyName(cur)} → ${prettyName(destId)}).`;
            inv.splice(idxTicket, 1);
            c.inventory = JSON.stringify(inv);
            travelNote = ' (used Boat Ticket)';
          }
        }
        if (e.travel === 'horse' && !has('Horse')) return `Requires a Horse to travel (${prettyName(cur)} → ${prettyName(destId)}).`;
        c.location = String(destId);
        c.place = null;
        saveCharacter(c);
        if (!hasAchievement(c, 'Wanderer')) earnAchievement(c, 'Wanderer', 'First journey to a new place.');
        const lines = [ `${c.name} travels to ${prettyName(destId)}${travelNote}.` ];
        await conciseSay(ctx, ctx?.channel, lines, 1, 200);
        try { maybeSpawnEncounter(c, destId, ctx); } catch(_) {}
        return `${c.name} is now at ${prettyName(destId)}.`;
      }

      if (toolName === 'get_location') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        initWorldIfNeeded();
        const loc = c.location || 'Town';
        const place = c.place ? ` — at ${c.place}` : '';
        return `${c.name} is at ${prettyName(loc)} (${categoryOf(loc)})${place}.`;
      }

      if (toolName === 'inspect_inventory') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const inv = (() => { try { return JSON.parse(c.inventory || '[]'); } catch (_) { return []; } })();
        if (inv.length === 0) return 'Inventory is empty.';
        const counts = {};
        for (const it of inv) counts[it] = (counts[it] || 0) + 1;
        const listing = Object.entries(counts).map(([k, v]) => `${k} x${v}`).slice(0, 10).join(', ');
        return listing;
      }

      if (toolName === 'shop_buy') {
        const { nick, item, index } = parameters;
        const c = ensureCharacter(String(nick));
        const loc = String(c.location || 'Town');
        const catalog = getCatalogForLocation(loc);
        if (!catalog || catalog.length === 0) return 'No shop here.';
        let chosen = String(item || '').trim();
        if (!chosen && index) {
          const i = Math.max(1, parseInt(String(index), 10) || 0) - 1;
          if (i < 0 || i >= catalog.length) return `Invalid index. Use list_shop.`;
          chosen = catalog[i][0];
        }
        if (!chosen) return `Specify item or index. Use list_shop.`;
        const found = catalog.find(([name]) => name.toLowerCase() === chosen.toLowerCase());
        if (!found) return `Unknown item. Use list_shop.`;
        const [wanted, price] = found;
        if (c.gold < price) return `Not enough gold. ${wanted} costs ${price}g.`;
        const row = getShopStock.get(loc, wanted);
        const have = row && typeof row.qty === 'number' ? row.qty : 0;
        if (have <= 0) return `${wanted} is out of stock.`;
        decShopStock.run(loc, wanted);
        c.gold -= price;
        if (/^bag \+5$/i.test(wanted)) {
          c.capacity = Math.max(0, parseInt(String(c.capacity||20),10) || 20) + 5;
        } else if (/^backpack \+10$/i.test(wanted)) {
          c.capacity = Math.max(0, parseInt(String(c.capacity||20),10) || 20) + 10;
        } else {
          addLoot(c, [wanted], 0);
        }
        saveCharacter(c);
        await conciseSay(ctx, ctx?.channel, [ `${c.name} buys ${wanted} for ${price}g.` ], 1, 200);
        return `Purchased ${wanted}. Gold now ${c.gold}.`;
      }

      if (toolName === 'list_shop' || toolName === 'shop_list') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const loc = String(c.location || 'Town');
        const catalog = getCatalogForLocation(loc);
        if (!catalog || catalog.length === 0) return 'No shop here.';
        const items = catalog.map(([name, price], i) => {
          const row = getShopStock.get(loc, name);
          const qty = row && typeof row.qty === 'number' ? row.qty : 0;
          return `[${i+1}] ${name} ${price}g (${qty})`;
        });
        return `${inlineList(items)} — buy: shop_buy 1`;
      }

      if (toolName === 'use_item') {
        const { nick, item } = parameters;
        const c = ensureCharacter(String(nick));
        const inv = (() => { try { return JSON.parse(c.inventory || '[]'); } catch (_) { return []; } })();
        const idx = inv.findIndex(it => String(it).toLowerCase() === String(item || '').trim().toLowerCase());
        if (idx === -1) return `${item} not in inventory.`;
        const used = inv.splice(idx, 1)[0];
        c.inventory = JSON.stringify(inv);
        if (String(used).toLowerCase() === 'healing potion') {
          const heal = randInt(18, 30);
          c.hp = Math.min(c.max_hp, c.hp + heal);
          saveCharacter(c);
          await conciseSay(ctx, ctx?.channel, [ `${c.name} drinks a Healing Potion (+${heal} HP).` ], 1, 200);
          return `${c.name} heals ${heal} (now ${c.hp}/${c.max_hp}).`;
        }
        if (String(used).toLowerCase() === 'strength tonic') {
          setEffect(c, 'attack_bonus', 5);
          saveCharacter(c);
          await conciseSay(ctx, ctx?.channel, [ `${c.name} drinks a Strength Tonic (+5 attack next battle).` ], 1, 200);
          return `Attack boosted (+5) for next battle.`;
        }
        saveCharacter(c);
        return `Used ${used}.`;
      }

      if (toolName === 'equip_item') {
        const { nick, item, slot } = parameters;
        const c = ensureCharacter(String(nick));
        const inv = (() => { try { return JSON.parse(c.inventory || '[]'); } catch (_) { return []; } })();
        const wanted = String(item || '').trim();
        const idx = inv.findIndex(it => String(it).toLowerCase() === wanted.toLowerCase());
        if (idx === -1) return `${wanted} not in inventory.`;
        const slotCompat = { weapon: ['Iron Sword','Oak Staff'], armor: ['Traveler Cloak','Leather Armor'], accessory: ['Lucky Charm','Shield Charm'] };
        if (!slotCompat[slot] || !slotCompat[slot].some(n => n.toLowerCase() === wanted.toLowerCase())) return `Cannot equip ${wanted} to ${slot}.`;
        const eq = parseEquipment(c); const prev = eq[slot]; eq[slot] = wanted; c.equipment = JSON.stringify(eq);
        inv.splice(idx, 1); if (prev) inv.push(prev); c.inventory = JSON.stringify(inv);
        saveCharacter(c);
        if (!hasAchievement(c, 'Armed and Ready')) earnAchievement(c, 'Armed and Ready', 'Equipped your first item.');
        return `${c.name} equips ${wanted} (${slot})${prev ? `, stowing ${prev}.` : '.'}`;
      }

      if (toolName === 'unequip_item') {
        const { nick, slot } = parameters;
        const c = ensureCharacter(String(nick));
        const eq = parseEquipment(c); const item = eq[slot]; if (!item) return `Nothing equipped in ${slot}.`;
        const inv = (() => { try { return JSON.parse(c.inventory || '[]'); } catch (_) { return []; } })();
        inv.push(item); c.inventory = JSON.stringify(inv); delete eq[slot]; c.equipment = JSON.stringify(eq);
        saveCharacter(c);
        return `${c.name} unequips ${item} (${slot}).`;
      }

      if (toolName === 'get_equipment') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const eq = parseEquipment(c);
        const w = eq.weapon || '-'; const a = eq.armor || '-'; const x = eq.accessory || '-';
        return `Weapon: ${w}; Armor: ${a}; Accessory: ${x}`;
      }

      if (toolName === 'quest_board' || toolName === 'quests' || toolName === 'show_quest_board' || toolName === 'show_the_quest_board' || toolName === 'questboard' || toolName === 'available_quests' || toolName === 'show_available_quests') {
        const { nick } = parameters;
        const c = ensureCharacter(String(nick));
        const loc = c.location || 'Town';
        const cat = categoryOf(loc) || 'Town';
        let pool = QUEST_TEMPLATES[cat] || QUEST_TEMPLATES['Town'] || [];
        if (!pool || pool.length === 0) {
          try { pool = Object.values(QUEST_TEMPLATES).flat(); } catch(_) { pool = []; }
        }
        if (!pool || pool.length === 0) pool = [{ title: 'Local Help Wanted', reward_xp: 10, reward_gold: 8 }];
        const seed = ensureBoardSeed(loc);
        const ordered = seededOrder(pool, seed).slice(0, 5);
        const items = ordered.map((t,i) => {
          const tgt = chooseQuestTarget(loc, t, seed);
          return `[${i+1}] ${t.title} ${t.reward_xp}xp/${t.reward_gold}g → ${prettyName(tgt)}`;
        });
        if (!items || items.length === 0) return 'No quests available here. Try again shortly.';
        return `${inlineList(items)} — accept: select_quest 1`;
      }

      if (toolName === 'accept_quest_template') {
        const { nick, title, index } = parameters;
        const c = ensureCharacter(String(nick));
        const loc = c.location || 'Town';
        const cat = categoryOf(loc) || 'Town';
        let pool = QUEST_TEMPLATES[cat] || QUEST_TEMPLATES['Town'] || [];
        try { if (!pool || pool.length === 0) pool = Object.values(QUEST_TEMPLATES).flat(); } catch(_) {}
        if (!pool || pool.length === 0) return 'No quests available right now.';
        const seed = ensureBoardSeed(loc);
        const ordered = seededOrder(pool, seed).slice(0, 5);
        let t = null;
        if (index) {
          const i = Math.max(1, parseInt(String(index), 10) || 0) - 1;
          if (i < 0 || i >= ordered.length) return `Invalid quest index. Use 'quest_board' to view options.`;
          t = ordered[i];
        } else if (title) {
          const qTitle = String(title).trim().toLowerCase();
          t = ordered.find(q => q.title.toLowerCase() === qTitle || q.title.toLowerCase().startsWith(qTitle));
        }
        if (!t) return `No such quest at ${loc}.`;
        const target = chooseQuestTarget(loc, t, seed);
        upsertQuest.run({ character_id: c.id, title: t.title, details: t.details || null, status: 'active', progress: '[]', reward_gold: t.reward_gold || 0, reward_xp: t.reward_xp || 0, target_location: target });
        return `Quest accepted: ${t.title}. Rewards: +${t.reward_xp}xp, +${t.reward_gold}g.`;
      }

      if (toolName === 'select_quest' || toolName === 'selectquest' || toolName === 'select-quest') {
        const { nick, index } = parameters;
        // Delegate to accept_quest_template using index
        return await plugin.execute('accept_quest_template', { nick, index });
      }

      if (toolName === 'start_quest') {
        const { nick, title } = parameters;
        const c = ensureCharacter(String(nick));
        const details = String(parameters.details || '').trim() || null;
        const reward_gold = parseInt(parameters.reward_gold || '0', 10) || 0;
        const reward_xp = parseInt(parameters.reward_xp || '0', 10) || 0;
        upsertQuest.run({
          character_id: c.id,
          title: String(title).trim(),
          details,
          status: 'active',
          progress: '[]',
          reward_gold,
          reward_xp,
        });
        await conciseSay(ctx, ctx?.channel, [ `${c.name} begins quest: ${title}.` ], 1, 200);
        return `Quest started: ${title}${details ? ' — ' + details : ''}. Rewards: +${reward_xp}xp, +${reward_gold}g.`;
      }

      if (toolName === 'update_quest') {
        const { nick, title, note } = parameters;
        const c = ensureCharacter(String(nick));
        const q = getQuest.get(c.id, String(title).trim());
        if (!q) return `No such quest: ${title}.`;
        const prog = (() => { try { return JSON.parse(q.progress || '[]'); } catch { return []; } })();
        prog.push(String(note).slice(0, 160));
        setQuestProgress.run({ id: q.id, progress: JSON.stringify(prog.slice(-12)) });
        await conciseSay(ctx, ctx?.channel, [ `Quest progress — ${title}: ${note}` ], 1, 200);
        return `Quest updated: ${title}. (${prog.length} step(s))`;
      }

      if (toolName === 'complete_quest') {
        const { nick, title } = parameters;
        const c = ensureCharacter(String(nick));
        const q = getQuest.get(c.id, String(title).trim());
        if (!q) return `No such quest: ${title}.`;
        if (q.status === 'completed') return `Quest already completed: ${title}.`;
        // Enforce target location if present
        const target = String(q.target_location || '').trim();
        if (target && String(c.location || '') !== target) {
          return `Travel to ${prettyName(target)} to complete '${title}'.`;
        }
        completeQuestStmt.run(q.id);
        const gold = parseInt(q.reward_gold, 10) || 0;
        const xp = parseInt(q.reward_xp, 10) || 0;
        c.exp = (parseInt(c.exp, 10) || 0) + xp;
        addLoot(c, [], gold);
        const ding = levelUpIfNeeded(c);
        saveCharacter(c);
        earnAchievement(c, `Quest: ${title}`, 'Completed a quest.');
        const lines = [ `${c.name} completes quest: ${title}! +${xp}xp, +${gold}g.` ];
        if (ding) lines.push(`Level up! Now Lv${c.level}.`);
        await conciseSay(ctx, ctx?.channel, lines, 2, 250);
        return lines.join('\n');
      }

      if (toolName === 'list_quests' || toolName === 'show_quests' || toolName === 'show_the_quests') {
        const { nick } = parameters;
        const status = parameters.status || 'active';
        const limit = Math.max(1, Math.min(50, parseInt(parameters.limit || '10', 10) || 10));
        const c = ensureCharacter(String(nick));
        const rows = listQuestsByStatus.all({ cid: c.id, status, limit });
        if (!rows || rows.length === 0) return 'No quests found.';
        const items = rows.map(r => {
          const base = `${r.status === 'active' ? '•' : '✓'} ${r.title} ${r.reward_xp}xp/${r.reward_gold}g`;
          if (r.status === 'active' && r.target_location) return `${base} → ${prettyName(r.target_location)}`;
          return base;
        });
        return inlineList(items);
      }

      if (toolName === 'earn_achievement') {
        const { nick, name, details } = parameters;
        const c = ensureCharacter(String(nick));
        earnAchievement(c, String(name).trim(), details ? String(details) : null);
        return `Achievement recorded: ${name}.`;
      }

      if (toolName === 'list_achievements') {
        const { nick } = parameters;
        const limit = Math.max(1, Math.min(50, parseInt(parameters.limit || '10', 10) || 10));
        const c = ensureCharacter(String(nick));
        const rows = listAchievementsStmt.all(c.id, limit);
        if (!rows || rows.length === 0) return 'No achievements yet.';
        const lines = rows.map(r => `★ ${r.name}${r.details ? ' — ' + r.details : ''}`);
        return lines.join('\n');
      }

      return `Unknown tool: ${toolName}`;
    } catch (error) {
      console.error('[rpg] Error:', error);
      return `Error: ${error.message}`;
    }
  },
};

module.exports = plugin;

// Freshness scheduler (5–10 min randomized) — rotates board seeds, restocks shops, refreshes enemies.
(function startFreshnessScheduler() {
  function randMs() { return (5 + Math.floor(Math.random() * 6)) * 60 * 1000; }
  function restockShops() {
    try {
      const rows = distinctLocations.all() || [];
      const locs = rows.length > 0 ? rows.map(r => r.location || 'Town') : ['Town','Forest','Caves','Ruins','Catacombs','Arena'];
      for (const loc of locs) {
        const catalog = getCatalogForLocation(loc);
        for (const [name, , base] of catalog) {
          const row = getShopStock.get(loc, name);
          const have = row && typeof row.qty === 'number' ? row.qty : 0;
          const qty = Math.max(have, base || 4);
          setShopStock.run(loc, name, qty);
        }
      }
    } catch (_) {}
  }
  function rotateBoardSeeds() {
    try {
      const rows = distinctLocations.all() || [];
      const locs = rows.length > 0 ? rows.map(r => r.location || 'Town') : ['Town','Forest','Caves','Ruins','Catacombs','Arena'];
      for (const loc of locs) {
        const seed = crypto.randomInt(0, 1_000_000_000);
        setBoardSeed.run(String(loc), seed);
      }
    } catch (_) {}
  }
  function refreshEnemies() {
    try {
      const rows = distinctLocations.all() || [];
      const locs = rows.length > 0 ? rows.map(r => r.location || 'Town') : ['Town','Forest','Caves','Ruins','Catacombs','Arena'];
      const names = ['Bandit','Wraith','Goblin','Cultist','Wolf','Golem','Rogue'];
      for (const loc of locs) {
        deleteEnemiesAt.run(String(loc));
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i=0;i<count;i++) insertEnemy.run(`${choice(names)} ${i+1}`, 1 + Math.floor(Math.random()*5), String(loc));
      }
    } catch (_) {}
  }
  function tick() {
    try { rotateBoardSeeds(); restockShops(); refreshEnemies(); deleteExpiredEncounters.run(); } catch(_) {}
    setTimeout(tick, randMs());
  }
  setTimeout(tick, randMs());
})();
