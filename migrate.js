import { pool } from "./db.js";

const MAP_SEEDS = [
  { key: "plains", name: "Planície", level_min: 1, difficulty: 1 },
  { key: "forest", name: "Floresta Sombria", level_min: 8, difficulty: 2 },
  { key: "swamp", name: "Pântano", level_min: 15, difficulty: 3 },
  { key: "grave", name: "Cemitério Antigo", level_min: 22, difficulty: 3 },
  { key: "desert", name: "Deserto Escaldante", level_min: 28, difficulty: 4 },
  { key: "mountain", name: "Montanhas Gélidas", level_min: 35, difficulty: 4 },
  { key: "abyss", name: "Abismo", level_min: 45, difficulty: 5 },
];

const MOB_SEEDS = [
  // Plains
  { key: "rat", name: "Rato Gigante", map_key: "plains", rarity: "common", level_min: 1, hp: 30, atk: 3, def: 0, xp_gain: 8, gold_gain: 5 },
  { key: "wolf", name: "Lobo", map_key: "plains", rarity: "common", level_min: 1, hp: 40, atk: 5, def: 1, xp_gain: 12, gold_gain: 8 },
  { key: "spider", name: "Aranha", map_key: "plains", rarity: "common", level_min: 2, hp: 50, atk: 6, def: 2, xp_gain: 15, gold_gain: 10 },
  { key: "bandit", name: "Bandido", map_key: "plains", rarity: "common", level_min: 2, hp: 60, atk: 8, def: 2, xp_gain: 20, gold_gain: 15 },
  { key: "troll", name: "Troll Jovem", map_key: "plains", rarity: "uncommon", level_min: 3, hp: 80, atk: 10, def: 3, xp_gain: 30, gold_gain: 20 },
  { key: "minotaur_scout", name: "Minotauro Batedor", map_key: "plains", rarity: "rare", level_min: 5, hp: 100, atk: 12, def: 4, xp_gain: 50, gold_gain: 35 },
  // Dungeon Plains
  { key: "d_wolf_alpha", name: "Lobo Alfa da Masmorra", map_key: "plains", rarity: "uncommon", level_min: 5, hp: 140, atk: 16, def: 6, xp_gain: 80, gold_gain: 60 },
  { key: "d_spider_rock", name: "Aranha Rochedo", map_key: "plains", rarity: "uncommon", level_min: 6, hp: 160, atk: 18, def: 7, xp_gain: 95, gold_gain: 70 },
  { key: "d_goblin_scout", name: "Goblin Batedor", map_key: "plains", rarity: "rare", level_min: 6, hp: 170, atk: 20, def: 7, xp_gain: 110, gold_gain: 80 },
  { key: "d_rock_lord", name: "Senhor dos Rochedos", map_key: "plains", rarity: "boss_dungeon", level_min: 7, hp: 220, atk: 24, def: 9, xp_gain: 180, gold_gain: 120 },

  // Forest
  { key: "goblin", name: "Goblin", map_key: "forest", rarity: "common", level_min: 8, hp: 90, atk: 12, def: 3, xp_gain: 35, gold_gain: 25 },
  { key: "wasp", name: "Vespa Gigante", map_key: "forest", rarity: "common", level_min: 9, hp: 100, atk: 15, def: 3, xp_gain: 40, gold_gain: 28 },
  { key: "boar", name: "Javali", map_key: "forest", rarity: "common", level_min: 10, hp: 120, atk: 18, def: 4, xp_gain: 45, gold_gain: 30 },
  { key: "elf_rogue", name: "Elfo Saqueador", map_key: "forest", rarity: "uncommon", level_min: 12, hp: 140, atk: 22, def: 5, xp_gain: 60, gold_gain: 45 },
  { key: "bear", name: "Urso", map_key: "forest", rarity: "uncommon", level_min: 13, hp: 170, atk: 24, def: 6, xp_gain: 70, gold_gain: 50 },
  { key: "ent", name: "Guardião da Mata", map_key: "forest", rarity: "boss", level_min: 15, hp: 260, atk: 30, def: 10, xp_gain: 130, gold_gain: 90 },
  // Dungeon Forest
  { key: "d_entling", name: "Ent Jovem (Masmorra)", map_key: "forest", rarity: "uncommon", level_min: 12, hp: 220, atk: 28, def: 8, xp_gain: 90, gold_gain: 70 },
  { key: "d_forest_spider", name: "Aranha da Mata", map_key: "forest", rarity: "uncommon", level_min: 13, hp: 230, atk: 30, def: 8, xp_gain: 105, gold_gain: 80 },
  { key: "d_elf_scout", name: "Batedor Elfo", map_key: "forest", rarity: "rare", level_min: 14, hp: 250, atk: 32, def: 9, xp_gain: 125, gold_gain: 95 },
  { key: "d_forest_guardian", name: "Guardião do Bosque", map_key: "forest", rarity: "boss_dungeon", level_min: 15, hp: 320, atk: 38, def: 12, xp_gain: 190, gold_gain: 140 },

  // Swamp
  { key: "slime", name: "Slime Viscoso", map_key: "swamp", rarity: "common", level_min: 15, hp: 160, atk: 22, def: 5, xp_gain: 70, gold_gain: 60 },
  { key: "leech", name: "Sanguessuga", map_key: "swamp", rarity: "common", level_min: 16, hp: 170, atk: 24, def: 5, xp_gain: 75, gold_gain: 62 },
  { key: "swamp_orc", name: "Orc do Pântano", map_key: "swamp", rarity: "uncommon", level_min: 17, hp: 190, atk: 28, def: 6, xp_gain: 90, gold_gain: 70 },
  { key: "witch", name: "Bruxa do Brejo", map_key: "swamp", rarity: "uncommon", level_min: 19, hp: 210, atk: 32, def: 8, xp_gain: 110, gold_gain: 80 },
  { key: "ghoul", name: "Ghoul", map_key: "swamp", rarity: "uncommon", level_min: 20, hp: 230, atk: 30, def: 7, xp_gain: 120, gold_gain: 85 },
  { key: "hydra_whelp", name: "Filhote de Hidra", map_key: "swamp", rarity: "boss", level_min: 22, hp: 320, atk: 38, def: 10, xp_gain: 200, gold_gain: 150 },
  // Dungeon Swamp
  { key: "d_swamp_orc", name: "Orc do Pântano (Masmorra)", map_key: "swamp", rarity: "uncommon", level_min: 17, hp: 260, atk: 34, def: 9, xp_gain: 130, gold_gain: 100 },
  { key: "d_swamp_witch", name: "Bruxa do Brejo Sombria", map_key: "swamp", rarity: "rare", level_min: 19, hp: 280, atk: 38, def: 10, xp_gain: 150, gold_gain: 120 },
  { key: "d_swamp_leech", name: "Sanguessuga Gigante", map_key: "swamp", rarity: "rare", level_min: 20, hp: 300, atk: 36, def: 11, xp_gain: 165, gold_gain: 135 },
  { key: "d_swamp_hydra", name: "Hidra Menor", map_key: "swamp", rarity: "boss_dungeon", level_min: 22, hp: 380, atk: 44, def: 14, xp_gain: 240, gold_gain: 180 },

  // Grave
  { key: "skeleton", name: "Esqueleto", map_key: "grave", rarity: "common", level_min: 22, hp: 200, atk: 28, def: 7, xp_gain: 110, gold_gain: 90 },
  { key: "zombie", name: "Zumbi", map_key: "grave", rarity: "common", level_min: 23, hp: 220, atk: 30, def: 7, xp_gain: 120, gold_gain: 95 },
  { key: "mummy", name: "Múmia", map_key: "grave", rarity: "uncommon", level_min: 24, hp: 240, atk: 32, def: 8, xp_gain: 135, gold_gain: 100 },
  { key: "necro_apprentice", name: "Necromante Aprendiz", map_key: "grave", rarity: "uncommon", level_min: 25, hp: 230, atk: 36, def: 9, xp_gain: 150, gold_gain: 120 },
  { key: "wraith", name: "Espectro", map_key: "grave", rarity: "rare", level_min: 27, hp: 260, atk: 40, def: 12, xp_gain: 180, gold_gain: 150 },
  { key: "lich", name: "Lich", map_key: "grave", rarity: "boss", level_min: 30, hp: 350, atk: 50, def: 15, xp_gain: 260, gold_gain: 220 },

  // Desert
  { key: "scorpion", name: "Escorpião", map_key: "desert", rarity: "common", level_min: 28, hp: 230, atk: 35, def: 10, xp_gain: 160, gold_gain: 130 },
  { key: "sand_worm", name: "Verme de Areia", map_key: "desert", rarity: "uncommon", level_min: 29, hp: 260, atk: 38, def: 10, xp_gain: 180, gold_gain: 140 },
  { key: "nomad", name: "Nômade", map_key: "desert", rarity: "uncommon", level_min: 30, hp: 240, atk: 42, def: 12, xp_gain: 190, gold_gain: 150 },
  { key: "scarab", name: "Escaravelho", map_key: "desert", rarity: "rare", level_min: 32, hp: 280, atk: 44, def: 13, xp_gain: 210, gold_gain: 170 },
  { key: "fire_imp", name: "Diabrete Flamejante", map_key: "desert", rarity: "rare", level_min: 33, hp: 250, atk: 48, def: 12, xp_gain: 230, gold_gain: 180 },
  { key: "ancient_guard", name: "Guardião Antigo", map_key: "desert", rarity: "boss", level_min: 35, hp: 380, atk: 55, def: 18, xp_gain: 320, gold_gain: 260 },

  // Mountain
  { key: "ice_golem", name: "Golem de Gelo", map_key: "mountain", rarity: "uncommon", level_min: 35, hp: 320, atk: 50, def: 16, xp_gain: 260, gold_gain: 200 },
  { key: "harpy", name: "Harpia", map_key: "mountain", rarity: "uncommon", level_min: 36, hp: 300, atk: 48, def: 14, xp_gain: 250, gold_gain: 190 },
  { key: "yeti", name: "Yeti", map_key: "mountain", rarity: "rare", level_min: 37, hp: 340, atk: 54, def: 17, xp_gain: 280, gold_gain: 220 },
  { key: "wyvern", name: "Wyvern", map_key: "mountain", rarity: "rare", level_min: 38, hp: 360, atk: 58, def: 18, xp_gain: 320, gold_gain: 240 },
  { key: "frost_orc", name: "Orc da Neve", map_key: "mountain", rarity: "uncommon", level_min: 35, hp: 310, atk: 52, def: 15, xp_gain: 260, gold_gain: 200 },
  { key: "dragon_young", name: "Dragão Jovem", map_key: "mountain", rarity: "boss", level_min: 40, hp: 480, atk: 70, def: 22, xp_gain: 420, gold_gain: 320 },

  // Abyss
  { key: "demonling", name: "Demonling", map_key: "abyss", rarity: "rare", level_min: 45, hp: 380, atk: 68, def: 20, xp_gain: 380, gold_gain: 280 },
  { key: "shadow_knight", name: "Cavaleiro Sombrio", map_key: "abyss", rarity: "rare", level_min: 47, hp: 420, atk: 72, def: 22, xp_gain: 420, gold_gain: 300 },
  { key: "hellhound", name: "Cão Infernal", map_key: "abyss", rarity: "rare", level_min: 48, hp: 400, atk: 75, def: 21, xp_gain: 440, gold_gain: 310 },
  { key: "cultist", name: "Cultista", map_key: "abyss", rarity: "rare", level_min: 46, hp: 390, atk: 70, def: 21, xp_gain: 410, gold_gain: 290 },
  { key: "void_spawn", name: "Cria do Vazio", map_key: "abyss", rarity: "rare", level_min: 49, hp: 430, atk: 78, def: 23, xp_gain: 460, gold_gain: 330 },
  { key: "abyss_lord", name: "Lorde do Abismo", map_key: "abyss", rarity: "boss", level_min: 52, hp: 650, atk: 95, def: 28, xp_gain: 620, gold_gain: 480 },
];

const ITEM_SEEDS = [
  // Weapons
  { key: "short_sword", name: "Espada Curta", slot: "weapon", rarity: "common", atk_min: 1, atk_max: 5, crit_min: 1, crit_max: 3, drop_rate: 0.03, map_key: "plains" },
  { key: "sabre", name: "Sabre", slot: "weapon", rarity: "uncommon", atk_min: 2, atk_max: 6, crit_min: 1, crit_max: 4, drop_rate: 0.02, map_key: "forest" },
  { key: "battle_axe", name: "Machado de Batalha", slot: "weapon", rarity: "uncommon", atk_min: 3, atk_max: 7, crit_min: 0, crit_max: 2, drop_rate: 0.015, map_key: "forest" },
  { key: "hunting_bow", name: "Arco de Caça", slot: "weapon", rarity: "uncommon", atk_min: 2, atk_max: 5, crit_min: 2, crit_max: 5, drop_rate: 0.02, map_key: "plains" },
  { key: "mage_staff", name: "Cajado do Aprendiz", slot: "weapon", rarity: "uncommon", atk_min: 2, atk_max: 6, crit_min: 2, crit_max: 5, drop_rate: 0.02, map_key: "forest" },
  { key: "novice_rod", name: "Cajado Novato", slot: "weapon", rarity: "common", atk_min: 1, atk_max: 4, crit_min: 1, crit_max: 3, drop_rate: 0.025, map_key: "plains" },
  { key: "knight_blade", name: "Lâmina do Cavaleiro", slot: "weapon", rarity: "rare", atk_min: 4, atk_max: 7, crit_min: 1, crit_max: 4, drop_rate: 0.01, map_key: "swamp" },
  { key: "longbow", name: "Arco Longo", slot: "weapon", rarity: "uncommon", atk_min: 3, atk_max: 7, crit_min: 3, crit_max: 6, drop_rate: 0.015, map_key: "forest" },
  { key: "crossbow", name: "Besta Reforçada", slot: "weapon", rarity: "rare", atk_min: 4, atk_max: 7, crit_min: 1, crit_max: 3, drop_rate: 0.01, map_key: "swamp" },
  { key: "arcane_wand", name: "Varinha Arcana", slot: "weapon", rarity: "uncommon", atk_min: 3, atk_max: 7, crit_min: 2, crit_max: 5, drop_rate: 0.015, map_key: "grave" },
  { key: "crystal_staff", name: "Cajado de Cristal", slot: "weapon", rarity: "rare", atk_min: 4, atk_max: 7, crit_min: 2, crit_max: 4, drop_rate: 0.01, map_key: "swamp" },

  // Armors
  { key: "leather_armor", name: "Armadura de Couro", slot: "armor", rarity: "common", def_min: 1, def_max: 3, hp_min: 0, hp_max: 5, drop_rate: 0.03, map_key: "plains" },
  { key: "chain_armor", name: "Cota de Malha", slot: "armor", rarity: "uncommon", def_min: 2, def_max: 5, hp_min: 0, hp_max: 8, drop_rate: 0.02, map_key: "forest" },
  { key: "plate_armor", name: "Armadura de Placas", slot: "armor", rarity: "rare", def_min: 3, def_max: 6, hp_min: 6, hp_max: 10, drop_rate: 0.01, map_key: "swamp" },
  { key: "dark_robe", name: "Manto Sombrio", slot: "armor", rarity: "rare", def_min: 0, def_max: 2, hp_min: 12, hp_max: 20, drop_rate: 0.008, map_key: "grave" },

  // Shields
  { key: "wooden_shield", name: "Escudo de Madeira", slot: "shield", rarity: "common", def_min: 1, def_max: 3, hp_min: 0, hp_max: 3, drop_rate: 0.03, map_key: "plains" },
  { key: "steel_shield", name: "Escudo de Aço", slot: "shield", rarity: "uncommon", def_min: 2, def_max: 5, hp_min: 0, hp_max: 5, drop_rate: 0.02, map_key: "forest" },
  { key: "tower_shield", name: "Escudo Torre", slot: "shield", rarity: "rare", def_min: 3, def_max: 6, hp_min: 1, hp_max: 6, drop_rate: 0.01, map_key: "swamp" },

  // Acessórios (Plains) - somente boss de masmorra
  { key: "brass_ring", name: "Anel de Latão", slot: "ring", rarity: "uncommon", atk_min: 1, atk_max: 4, crit_min: 1, crit_max: 2, drop_rate: 0.01, map_key: "plains", boss_dungeon_only: true },
  { key: "sapphire_amulet", name: "Colar de Safira", slot: "amulet", rarity: "uncommon", def_min: 1, def_max: 2, hp_min: 1, hp_max: 5, drop_rate: 0.01, map_key: "plains", boss_dungeon_only: true },
  { key: "leather_boots", name: "Bota de Couro", slot: "boots", rarity: "uncommon", def_min: 2, def_max: 5, hp_min: 1, hp_max: 3, drop_rate: 0.01, map_key: "plains", boss_dungeon_only: true },

  // Acessórios (Forest) - somente boss de masmorra
  { key: "silver_ring", name: "Anel de Prata", slot: "ring", rarity: "uncommon", atk_min: 2, atk_max: 7, crit_min: 2, crit_max: 4, drop_rate: 0.01, map_key: "forest", boss_dungeon_only: true },
  { key: "platinum_amulet", name: "Colar de Platina", slot: "amulet", rarity: "uncommon", def_min: 1, def_max: 5, hp_min: 2, hp_max: 7, drop_rate: 0.01, map_key: "forest", boss_dungeon_only: true },
  { key: "iron_boots", name: "Bota de Ferro", slot: "boots", rarity: "uncommon", def_min: 5, def_max: 8, hp_min: 1, hp_max: 4, drop_rate: 0.01, map_key: "forest", boss_dungeon_only: true },

  // Accessories
  { key: "amulet_health", name: "Amuleto Vital", slot: "amulet", rarity: "rare", hp_min: 15, hp_max: 30, drop_rate: 0.008, map_key: "desert" },
  { key: "ring_protect", name: "Anel de Proteção", slot: "ring", rarity: "rare", def_min: 2, def_max: 5, drop_rate: 0.008, map_key: "grave" },

  // Dungeon key
  { key: "dungeon_key", name: "Chave de Masmorra", slot: "key", rarity: "rare", drop_rate: 0.012, map_key: null, boss_only: true },

  // Consumables
  { key: "health_potion", name: "Poção de Vida", slot: "consumable", rarity: "common", drop_rate: 0.05, map_key: null },
  { key: "energy_potion", name: "Poção de Energia", slot: "consumable", rarity: "uncommon", drop_rate: 0.01, map_key: null },
  { key: "atk_tonic", name: "Tônico de Força", slot: "consumable", rarity: "uncommon", drop_rate: 0.025, map_key: null },
  { key: "def_tonic", name: "Tônico de Defesa", slot: "consumable", rarity: "uncommon", drop_rate: 0.025, map_key: null },
  { key: "crit_tonic", name: "Tônico de Precisão", slot: "consumable", rarity: "uncommon", drop_rate: 0.02, map_key: null },
];

function buildCurve(base, mult, levels = 50) {
  const out = [];
  let prev = 0;
  for (let l = 1; l <= levels; l++) {
    let xp = Math.round(base * Math.pow(mult, l - 1));
    if (xp <= prev) xp = prev + 1;
    prev = xp;
    out.push({ level: l, xp_to_next: xp });
  }
  return out;
}

function cumulativeBefore(level, curve) {
  return curve.slice(0, Math.max(0, level - 1)).reduce((acc, c) => acc + c.xp_to_next, 0);
}

function findProgress(xp, curve) {
  let acc = 0;
  for (let i = 0; i < curve.length; i++) {
    const seg = curve[i].xp_to_next;
    if (xp >= acc + seg) {
      acc += seg;
      continue;
    }
    const progress = seg ? Math.max(0, Math.min(1, (xp - acc) / seg)) : 0;
    return { level: i + 1, progress };
  }
  return { level: curve.length + 1, progress: 0 };
}

function mapXpToNewCurve(oldXp, oldCurve, newCurve) {
  const oldPos = findProgress(oldXp, oldCurve);
  const targetLevel = Math.min(oldPos.level, newCurve.length);
  const segment = newCurve[targetLevel - 1]?.xp_to_next || 0;
  const start = cumulativeBefore(targetLevel, newCurve);
  const newXp = Math.round(start + segment * oldPos.progress);
  return newXp;
}

export async function migrate() {
  try {
    const client = await pool.connect();
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

      // PLAYERS
      await client.query(`
        CREATE TABLE IF NOT EXISTS players (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          telegram_id BIGINT UNIQUE,
          name TEXT,
          xp_total INT NOT NULL DEFAULT 0,
          gold INT NOT NULL DEFAULT 0,
          hp INT NOT NULL DEFAULT 100,
          hp_max INT NOT NULL DEFAULT 100,
          energy INT NOT NULL DEFAULT 20,
          energy_max INT NOT NULL DEFAULT 20,
          current_map_key TEXT DEFAULT 'plains',
          state TEXT NOT NULL DEFAULT 'MENU',
          last_energy_at TIMESTAMPTZ DEFAULT now(),
          class TEXT NOT NULL DEFAULT 'guerreiro',
          trophies INT NOT NULL DEFAULT 0,
          arena_coins INT NOT NULL DEFAULT 0,
          base_atk INT NOT NULL DEFAULT 5,
          base_def INT NOT NULL DEFAULT 2,
          base_crit INT NOT NULL DEFAULT 5,
          temp_atk_buff INT NOT NULL DEFAULT 0,
          temp_def_buff INT NOT NULL DEFAULT 0,
          temp_crit_buff INT NOT NULL DEFAULT 0,
          temp_buff_expires_at TIMESTAMPTZ,
          last_seen TIMESTAMPTZ DEFAULT now(),
          tofus INT NOT NULL DEFAULT 0,
          vip_until TIMESTAMPTZ,
          trade_code TEXT,
          trade_expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='telegram_id') THEN
            ALTER TABLE players ADD COLUMN telegram_id BIGINT UNIQUE;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='phone') THEN
            BEGIN
              ALTER TABLE players ALTER COLUMN phone DROP NOT NULL;
            EXCEPTION WHEN others THEN
              NULL;
            END;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='hp_max') THEN
            ALTER TABLE players ADD COLUMN hp_max INT NOT NULL DEFAULT 100;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='current_map_key') THEN
            ALTER TABLE players ADD COLUMN current_map_key TEXT DEFAULT 'plains';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='state') THEN
            ALTER TABLE players ADD COLUMN state TEXT NOT NULL DEFAULT 'MENU';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='last_energy_at') THEN
            ALTER TABLE players ADD COLUMN last_energy_at TIMESTAMPTZ DEFAULT now();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='base_atk') THEN
            ALTER TABLE players ADD COLUMN base_atk INT NOT NULL DEFAULT 5;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='base_def') THEN
            ALTER TABLE players ADD COLUMN base_def INT NOT NULL DEFAULT 2;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='base_crit') THEN
            ALTER TABLE players ADD COLUMN base_crit INT NOT NULL DEFAULT 5;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='temp_atk_buff') THEN
            ALTER TABLE players ADD COLUMN temp_atk_buff INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='temp_def_buff') THEN
            ALTER TABLE players ADD COLUMN temp_def_buff INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='temp_crit_buff') THEN
            ALTER TABLE players ADD COLUMN temp_crit_buff INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='temp_buff_expires_at') THEN
            ALTER TABLE players ADD COLUMN temp_buff_expires_at TIMESTAMPTZ;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='last_seen') THEN
            ALTER TABLE players ADD COLUMN last_seen TIMESTAMPTZ DEFAULT now();
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='tofus') THEN
            ALTER TABLE players ADD COLUMN tofus INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='vip_until') THEN
            ALTER TABLE players ADD COLUMN vip_until TIMESTAMPTZ;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='gold') THEN
            ALTER TABLE players ADD COLUMN gold INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='hp') THEN
            ALTER TABLE players ADD COLUMN hp INT NOT NULL DEFAULT 100;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='energy') THEN
            ALTER TABLE players ADD COLUMN energy INT NOT NULL DEFAULT 20;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='energy_max') THEN
            ALTER TABLE players ADD COLUMN energy_max INT NOT NULL DEFAULT 20;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='xp_total') THEN
            ALTER TABLE players ADD COLUMN xp_total INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='class') THEN
            ALTER TABLE players ADD COLUMN class TEXT NOT NULL DEFAULT 'guerreiro';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='trophies') THEN
            ALTER TABLE players ADD COLUMN trophies INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='arena_coins') THEN
            ALTER TABLE players ADD COLUMN arena_coins INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='trade_code') THEN
            ALTER TABLE players ADD COLUMN trade_code TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='trade_expires_at') THEN
            ALTER TABLE players ADD COLUMN trade_expires_at TIMESTAMPTZ;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='inventory_slots_used') THEN
            ALTER TABLE players ADD COLUMN inventory_slots_used INT NOT NULL DEFAULT 0;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='inventory_slots_max') THEN
            ALTER TABLE players ADD COLUMN inventory_slots_max INT NOT NULL DEFAULT 20;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='players' AND column_name='rename_free_used') THEN
            ALTER TABLE players ADD COLUMN rename_free_used BOOLEAN NOT NULL DEFAULT false;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='boss_only') THEN
            ALTER TABLE items ADD COLUMN boss_only BOOLEAN NOT NULL DEFAULT false;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='boss_dungeon_only') THEN
            ALTER TABLE items ADD COLUMN boss_dungeon_only BOOLEAN NOT NULL DEFAULT false;
          END IF;
        END $$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS event_images (
          event_key TEXT PRIMARY KEY,
          file_id TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await client.query(`
        UPDATE players
        SET telegram_id = NULLIF(phone, '')::BIGINT
        WHERE telegram_id IS NULL
          AND phone ~ '^[0-9]+$'
      `);
      await client.query(`UPDATE players SET last_energy_at = NOW() WHERE last_energy_at IS NULL`);
      await client.query(`UPDATE players SET hp_max = COALESCE(hp_max, max_hp) WHERE hp_max IS NULL`);

      // LEVEL XP
      await client.query(`
        CREATE TABLE IF NOT EXISTS level_xp (
          level INT PRIMARY KEY,
          xp_to_next INT NOT NULL
        );
      `);

      console.log("Seeding XP curve (rápida no início)...");
      await client.query("TRUNCATE level_xp");

      const baseXp = 60; // L1->L2
      const mult = 1.32; // crescimento moderado
      let prevXp = 0;

      for (let l = 1; l <= 50; l++) {
        let xp = Math.round(baseXp * Math.pow(mult, l - 1));
        if (xp <= prevXp) xp = prevXp + 1;
        prevXp = xp;

        await client.query(
          `
          INSERT INTO level_xp (level, xp_to_next)
          VALUES ($1, $2)
          ON CONFLICT (level) DO UPDATE SET xp_to_next = EXCLUDED.xp_to_next
          `,
          [l, xp]
        );
      }

      // XP RECALC (roda uma vez para adaptar jogadores da curva antiga para a nova)
      await client.query(`
        CREATE TABLE IF NOT EXISTS migration_flags (
          key TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      const recalced = await client.query("SELECT 1 FROM migration_flags WHERE key = 'recalc_xp_v1'");
      if (recalced.rows.length === 0) {
        console.log("Recalculando XP dos jogadores para a nova curva (base 60 / mult 1.32)...");
        const players = await client.query("SELECT id, xp_total FROM players");
        const oldCurve = buildCurve(250, 1.45);
        const newCurve = buildCurve(baseXp, mult);
        for (const p of players.rows) {
          const oldXp = Number(p.xp_total || 0);
          const newXp = mapXpToNewCurve(oldXp, oldCurve, newCurve);
          await client.query("UPDATE players SET xp_total = $1 WHERE id = $2", [newXp, p.id]);
        }
        await client.query("INSERT INTO migration_flags (key) VALUES ('recalc_xp_v1')");
        console.log(`XP recalculado para ${players.rows.length} jogadores.`);
      }

      // MAPS
      await client.query(`
        CREATE TABLE IF NOT EXISTS maps (
          key TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          level_min INT NOT NULL DEFAULT 1,
          difficulty INT NOT NULL DEFAULT 1,
          image_file_id TEXT
        );
      `);

      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='key') THEN
            ALTER TABLE maps RENAME COLUMN id TO key;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='min_level') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='level_min') THEN
            ALTER TABLE maps RENAME COLUMN min_level TO level_min;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='level_min') THEN
            ALTER TABLE maps ADD COLUMN level_min INT NOT NULL DEFAULT 1;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='difficulty') THEN
            ALTER TABLE maps ADD COLUMN difficulty INT NOT NULL DEFAULT 1;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='maps' AND column_name='image_file_id') THEN
            ALTER TABLE maps ADD COLUMN image_file_id TEXT;
          END IF;
        END $$;
      `);

      // ITEMS
      await client.query(`
        CREATE TABLE IF NOT EXISTS items (
          id SERIAL PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          slot TEXT NOT NULL,
          rarity TEXT NOT NULL DEFAULT 'common',
          drop_rate REAL NOT NULL DEFAULT 0.01,
          map_key TEXT,
          atk_min INT DEFAULT 0,
          atk_max INT DEFAULT 0,
          def_min INT DEFAULT 0,
          def_max INT DEFAULT 0,
          hp_min INT DEFAULT 0,
          hp_max INT DEFAULT 0,
          crit_min INT DEFAULT 0,
          crit_max INT DEFAULT 0,
          image_file_id TEXT,
          boss_only BOOLEAN NOT NULL DEFAULT false,
          boss_dungeon_only BOOLEAN NOT NULL DEFAULT false
        );
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='key') THEN
            ALTER TABLE items ADD COLUMN key TEXT UNIQUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='drop_rate') THEN
            ALTER TABLE items ADD COLUMN drop_rate REAL NOT NULL DEFAULT 0.01;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='map_key') THEN
            ALTER TABLE items ADD COLUMN map_key TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='image_file_id') THEN
            ALTER TABLE items ADD COLUMN image_file_id TEXT;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='items_name_key') THEN
            BEGIN
              EXECUTE 'DROP INDEX IF EXISTS items_name_key';
            EXCEPTION WHEN others THEN
              NULL;
            END;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name='items' AND constraint_name='items_name_key') THEN
            BEGIN
              ALTER TABLE items DROP CONSTRAINT items_name_key;
            EXCEPTION WHEN others THEN
              NULL;
            END;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='atk_min') THEN
            ALTER TABLE items ADD COLUMN atk_min INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN atk_max INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN def_min INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN def_max INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN hp_min INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN hp_max INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN crit_min INT DEFAULT 0;
            ALTER TABLE items ADD COLUMN crit_max INT DEFAULT 0;
          END IF;
        END $$;
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS items_key_unique ON items(key)`);

      // INVENTORY (Stats únicos por item)
      await client.query(`
        CREATE TABLE IF NOT EXISTS inventory (
          id SERIAL PRIMARY KEY,
          player_id UUID REFERENCES players(id) ON DELETE CASCADE,
          item_key TEXT NOT NULL,
          slot TEXT, -- weapon, armor, shield, consumable, etc
          qty INT NOT NULL DEFAULT 1,
          equipped BOOLEAN NOT NULL DEFAULT false,
          rolled_atk INT DEFAULT 0,
          rolled_def INT DEFAULT 0,
          rolled_hp INT DEFAULT 0,
          rolled_crit INT DEFAULT 0,
          rolled_rarity TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='rolled_atk') THEN
            ALTER TABLE inventory ADD COLUMN rolled_atk INT DEFAULT 0;
            ALTER TABLE inventory ADD COLUMN rolled_def INT DEFAULT 0;
            ALTER TABLE inventory ADD COLUMN rolled_hp INT DEFAULT 0;
            ALTER TABLE inventory ADD COLUMN rolled_crit INT DEFAULT 0;
            ALTER TABLE inventory ADD COLUMN rolled_rarity TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='item_key') THEN
            ALTER TABLE inventory ADD COLUMN item_key TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='equipped') THEN
            ALTER TABLE inventory ADD COLUMN equipped BOOLEAN NOT NULL DEFAULT false;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='qty') THEN
            ALTER TABLE inventory ADD COLUMN qty INT NOT NULL DEFAULT 1;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='slot') THEN
            ALTER TABLE inventory ADD COLUMN slot TEXT;
          END IF;
          -- backfill item_key from legacy item_id if exists
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='item_id') THEN
            UPDATE inventory inv
            SET item_key = i.key
            FROM items i
            WHERE inv.item_id = i.id AND inv.item_key IS NULL;
          END IF;
        END $$;
      `);
      
      // Backfill slot from items table
      await client.query(`
        UPDATE inventory inv
        SET slot = i.slot
        FROM items i
        WHERE inv.item_key = i.key AND inv.slot IS NULL
      `);
      
      await client.query(`UPDATE inventory SET item_key = 'short_sword' WHERE item_key IS NULL`);
      await client.query(`ALTER TABLE inventory ALTER COLUMN item_key SET NOT NULL`);
      
      // Remove old UNIQUE constraint if exists
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_player_id_item_key_key') THEN
            ALTER TABLE inventory DROP CONSTRAINT inventory_player_id_item_key_key;
          END IF;
        END $$;
      `);
      
      // Drop old unique index if exists
      await client.query(`DROP INDEX IF EXISTS inventory_player_item_key`);
      
      // Normaliza slot consumível e deduplica stacks antes do índice único
      await client.query(`
        UPDATE inventory inv
        SET slot = 'consumable'
        FROM items i
        WHERE inv.item_key = i.key
          AND i.slot = 'consumable'
      `);

      await client.query(`
        WITH cte AS (
          SELECT inv.player_id, inv.item_key, MIN(inv.id) AS keep_id, SUM(inv.qty) AS total
          FROM inventory inv
          JOIN items i ON i.key = inv.item_key
          WHERE i.slot = 'consumable'
          GROUP BY inv.player_id, inv.item_key
          HAVING COUNT(*) > 1
        )
        UPDATE inventory inv
        SET qty = c.total
        FROM cte c
        WHERE inv.id = c.keep_id;
      `);

      await client.query(`
        WITH cte AS (
          SELECT inv.player_id, inv.item_key, MIN(inv.id) AS keep_id
          FROM inventory inv
          JOIN items i ON i.key = inv.item_key
          WHERE i.slot = 'consumable'
          GROUP BY inv.player_id, inv.item_key
          HAVING COUNT(*) > 1
        )
        DELETE FROM inventory inv
        USING cte c
        WHERE inv.player_id = c.player_id
          AND inv.item_key = c.item_key
          AND inv.id <> c.keep_id;
      `);
      
      // Create conditional unique index ONLY for consumables (allows stacking)
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS inventory_consumable_stack 
        ON inventory (player_id, item_key) 
        WHERE slot = 'consumable'
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS inventory_item_key_idx ON inventory(item_key)`);

      // SHOP ITEMS
      await client.query(`
        CREATE TABLE IF NOT EXISTS shop_items (
          id SERIAL PRIMARY KEY,
          item_key TEXT NOT NULL REFERENCES items(key),
          currency TEXT NOT NULL, -- 'gold', 'arena_coins', 'tofus'
          buy_price INT, -- NULL = cannot buy
          sell_price INT, -- NULL = cannot sell
          stock INT DEFAULT -1, -- -1 = infinite
          available BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS shop_items_item_currency ON shop_items(item_key, currency)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS trades (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code TEXT UNIQUE NOT NULL,
          owner_id UUID REFERENCES players(id) ON DELETE CASCADE,
          guest_id UUID REFERENCES players(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          state TEXT NOT NULL DEFAULT 'open' -- open, locked, done, canceled
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS trade_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          trade_id UUID REFERENCES trades(id) ON DELETE CASCADE,
          player_id UUID REFERENCES players(id) ON DELETE CASCADE,
          inventory_id INT REFERENCES inventory(id) ON DELETE CASCADE,
          item_key TEXT NOT NULL,
          qty INT NOT NULL DEFAULT 1
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS arenas (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          challenger_id UUID REFERENCES players(id) ON DELETE CASCADE,
          opponent_id UUID REFERENCES players(id) ON DELETE CASCADE,
          state TEXT NOT NULL DEFAULT 'matchmaking', -- matchmaking, fighting, finished
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS dungeons (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code TEXT UNIQUE NOT NULL,
          password TEXT,
          difficulty INT NOT NULL DEFAULT 1,
          owner_id UUID REFERENCES players(id) ON DELETE CASCADE,
          state TEXT NOT NULL DEFAULT 'open', -- open, running, finished
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS dungeon_members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          dungeon_id UUID REFERENCES dungeons(id) ON DELETE CASCADE,
          player_id UUID REFERENCES players(id) ON DELETE CASCADE
        );
      `);

      // EVENT REWARDS (drop rápido no grupo)
      await client.query(`
        CREATE TABLE IF NOT EXISTS event_rewards (
          id SERIAL PRIMARY KEY,
          chat_id TEXT NOT NULL,
          message_id TEXT,
          item_key TEXT NOT NULL REFERENCES items(key),
          qty INT NOT NULL DEFAULT 1,
          claimed_by UUID REFERENCES players(id),
          claimed_at TIMESTAMPTZ,
          created_by TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);

      // MOBS
      await client.query(`
        CREATE TABLE IF NOT EXISTS mobs (
          id SERIAL PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          level_min INT NOT NULL DEFAULT 1,
          hp INT NOT NULL,
          atk INT NOT NULL,
          def INT NOT NULL DEFAULT 0,
          xp_gain INT NOT NULL,
          gold_gain INT NOT NULL,
          rarity TEXT NOT NULL DEFAULT 'common',
          map_key TEXT NOT NULL,
          image_file_id TEXT
        );
      `);

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='key') THEN
            ALTER TABLE mobs ADD COLUMN key TEXT UNIQUE;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='min_level') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='level_min') THEN
            ALTER TABLE mobs RENAME COLUMN min_level TO level_min;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='def') THEN
            ALTER TABLE mobs ADD COLUMN def INT NOT NULL DEFAULT 0;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='xp') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='xp_gain') THEN
            ALTER TABLE mobs RENAME COLUMN xp TO xp_gain;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='xp_gain') THEN
            ALTER TABLE mobs ADD COLUMN xp_gain INT NOT NULL DEFAULT 5;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='map_id') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='map_key') THEN
            ALTER TABLE mobs RENAME COLUMN map_id TO map_key;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='map_key') THEN
            ALTER TABLE mobs ADD COLUMN map_key TEXT;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='gold_gain') THEN
            ALTER TABLE mobs ADD COLUMN gold_gain INT NOT NULL DEFAULT 5;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='rarity') THEN
            ALTER TABLE mobs ADD COLUMN rarity TEXT NOT NULL DEFAULT 'common';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mobs' AND column_name='image_file_id') THEN
            ALTER TABLE mobs ADD COLUMN image_file_id TEXT;
          END IF;
        END $$;
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS mobs_key_unique ON mobs(key)`);

      // SEED MAPS
      for (const m of MAP_SEEDS) {
        await client.query(
          `
          INSERT INTO maps (key, name, level_min, difficulty)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (key) DO UPDATE
            SET name=EXCLUDED.name,
                level_min=EXCLUDED.level_min,
                difficulty=EXCLUDED.difficulty
          `,
          [m.key, m.name, m.level_min, m.difficulty]
        );
      }

      // SEED MOBS
      for (const m of MOB_SEEDS) {
        await client.query(
          `
          INSERT INTO mobs (key, name, map_key, rarity, level_min, hp, atk, def, xp_gain, gold_gain)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (key) DO UPDATE
          SET name=EXCLUDED.name,
              map_key=EXCLUDED.map_key,
              rarity=EXCLUDED.rarity,
              level_min=EXCLUDED.level_min,
              hp=EXCLUDED.hp,
              atk=EXCLUDED.atk,
              def=EXCLUDED.def,
              xp_gain=EXCLUDED.xp_gain,
              gold_gain=EXCLUDED.gold_gain
          `,
          [m.key, m.name, m.map_key, m.rarity, m.level_min, m.hp, m.atk, m.def, m.xp_gain, m.gold_gain]
        );
      }

      // SEED ITEMS
      for (const it of ITEM_SEEDS) {
        await client.query(
          `
          INSERT INTO items (key, name, slot, rarity, drop_rate, map_key, atk_min, atk_max, def_min, def_max, hp_min, hp_max, crit_min, crit_max, boss_only, boss_dungeon_only)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (key) DO UPDATE
          SET name=EXCLUDED.name,
              slot=EXCLUDED.slot,
              rarity=EXCLUDED.rarity,
              drop_rate=EXCLUDED.drop_rate,
              map_key=EXCLUDED.map_key,
              atk_min=EXCLUDED.atk_min,
              atk_max=EXCLUDED.atk_max,
              def_min=EXCLUDED.def_min,
              def_max=EXCLUDED.def_max,
              hp_min=EXCLUDED.hp_min,
              hp_max=EXCLUDED.hp_max,
              crit_min=EXCLUDED.crit_min,
              crit_max=EXCLUDED.crit_max,
              boss_only=EXCLUDED.boss_only,
              boss_dungeon_only=EXCLUDED.boss_dungeon_only
          `,
          [
            it.key,
            it.name,
            it.slot,
            it.rarity,
            it.drop_rate,
            it.map_key,
            it.atk_min || 0,
            it.atk_max || 0,
            it.def_min || 0,
            it.def_max || 0,
            it.hp_min || 0,
            it.hp_max || 0,
            it.crit_min || 0,
            it.crit_max || 0,
            it.boss_only || false,
            it.boss_dungeon_only || false,
          ]
        );
      }

      // SEED SHOP (Loja)
      const SHOP_SEEDS = [
        // Consumíveis (Gold)
        { item_key: 'health_potion', currency: 'gold', buy_price: 149, sell_price: 45 },
        { item_key: 'health_potion', currency: 'arena_coins', buy_price: 100, sell_price: null },
        { item_key: 'energy_potion', currency: 'gold', buy_price: 5000, sell_price: 1500 },
        { item_key: 'energy_potion', currency: 'arena_coins', buy_price: 250, sell_price: null },
        { item_key: 'atk_tonic', currency: 'gold', buy_price: 150, sell_price: 40 },
        { item_key: 'def_tonic', currency: 'gold', buy_price: 150, sell_price: 40 },
        { item_key: 'crit_tonic', currency: 'gold', buy_price: 180, sell_price: 50 },
        
        // Equipamentos básicos (Gold)
        { item_key: 'short_sword', currency: 'gold', buy_price: 100, sell_price: 30 },
        { item_key: 'wooden_shield', currency: 'gold', buy_price: 80, sell_price: 25 },
        { item_key: 'leather_armor', currency: 'gold', buy_price: 120, sell_price: 35 },
        { item_key: 'novice_rod', currency: 'gold', buy_price: 90, sell_price: 28 },
        { item_key: 'hunting_bow', currency: 'gold', buy_price: 110, sell_price: 32 },
        
        // VIP/Premium (Tofus - moeda premium)
        { item_key: 'amulet_health', currency: 'tofus', buy_price: 100, sell_price: null },
        { item_key: 'ring_protect', currency: 'tofus', buy_price: 100, sell_price: null },
      ];
      
      console.log("Seeding loja...");
      for (const shop of SHOP_SEEDS) {
        await client.query(
          `
          INSERT INTO shop_items (item_key, currency, buy_price, sell_price)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (item_key, currency) DO UPDATE
          SET buy_price = EXCLUDED.buy_price,
              sell_price = EXCLUDED.sell_price
          `,
          [shop.item_key, shop.currency, shop.buy_price, shop.sell_price]
        );
      }

      // Atualiza flags boss_only/boss_dungeon_only para itens existentes
      await client.query(`UPDATE items SET boss_only = true WHERE key = 'dungeon_key'`);
      await client.query(`UPDATE items SET boss_dungeon_only = true WHERE key IN ('brass_ring','sapphire_amulet','leather_boots','silver_ring','platinum_amulet','iron_boots')`);


      // CLEANUP LEGACY DATA (mapas/mobs/itens fora dos seeds)
      const MAP_KEYS = MAP_SEEDS.map((m) => m.key);
      const ITEM_KEYS = ITEM_SEEDS.map((i) => i.key);
      const MOB_KEYS = MOB_SEEDS.map((m) => m.key);

      // Normaliza loot_tables legadas antes de apagar mapas (FK safety)
      await client.query("TRUNCATE loot_tables");
      await client.query(`UPDATE loot_tables SET map_id='plains' WHERE map_id IN ('planicie','planicies','planícies','planícies verdejantes')`);
      await client.query(`DELETE FROM loot_tables WHERE map_id NOT IN (${MAP_KEYS.map((_, i) => `$${i + 1}`).join(",")})`, MAP_KEYS);

      // Atualiza nomes e remove mapas legados
      for (const m of MAP_SEEDS) {
        await client.query(`UPDATE maps SET name=$1 WHERE key=$2`, [m.name, m.key]);
      }
      await client.query(`DELETE FROM maps WHERE key NOT IN (${MAP_KEYS.map((_, i) => `$${i + 1}`).join(",")})`, MAP_KEYS);
      await client.query(`UPDATE players SET current_map_key = 'plains' WHERE current_map_key NOT IN (${MAP_KEYS.map((_, i) => `$${i + 1}`).join(",")})`, MAP_KEYS);

      await client.query(`DELETE FROM mobs WHERE key NOT IN (${MOB_KEYS.map((_, i) => `$${i + 1}`).join(",")})`, MOB_KEYS);
      await client.query(
        `DELETE FROM items WHERE key IS NULL OR key NOT IN (${ITEM_KEYS.map((_, i) => `$${i + 1}`).join(",")})`,
        ITEM_KEYS
      );
      await client.query(
        `DELETE FROM inventory WHERE item_key NOT IN (${ITEM_KEYS.map((_, i) => `$${i + 1}`).join(",")})`,
        ITEM_KEYS
      );

      // MIGRAÇÃO DE DADOS: Dividir itens empilhados em linhas separadas (stats únicos)
      const migrationDone = await client.query("SELECT 1 FROM migration_flags WHERE key = 'split_stacked_items_v1'");
      if (migrationDone.rows.length === 0) {
        console.log("Migrando itens empilhados para stats únicos...");
        
        // Busca todos os itens com qty > 1 que NÃO são consumíveis
        const stackedItems = await client.query(`
          SELECT inv.*, i.slot
          FROM inventory inv
          JOIN items i ON i.key = inv.item_key
          WHERE inv.qty > 1 
          AND i.slot != 'consumable'
        `);
        
        for (const inv of stackedItems.rows) {
          // Cria qty-1 novas linhas (a original já conta como 1)
          for (let i = 1; i < inv.qty; i++) {
            await client.query(`
              INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
              VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
            `, [
              inv.player_id,
              inv.item_key,
              inv.slot,
              inv.rolled_atk,
              inv.rolled_def,
              inv.rolled_hp,
              inv.rolled_crit,
              inv.rolled_rarity
            ]);
          }
          
          // Atualiza o item original para qty = 1
          await client.query(`UPDATE inventory SET qty = 1 WHERE id = $1`, [inv.id]);
        }
        
        await client.query("INSERT INTO migration_flags (key) VALUES ('split_stacked_items_v1')");
        console.log(`✅ ${stackedItems.rows.length} stacks divididos em itens únicos.`);
      }
      
      // Recalcular inventory_slots_used de todos os jogadores
      console.log("Recalculando slots de inventário...");
      await client.query(`
        UPDATE players p
        SET inventory_slots_used = (
          SELECT COUNT(*)
          FROM inventory inv
          WHERE inv.player_id = p.id
          AND inv.equipped = FALSE
        )
      `);

      console.log("✅ Migração Postgres (Roguelike V3) concluída");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Erro na migração DB:", err);
  }
}
