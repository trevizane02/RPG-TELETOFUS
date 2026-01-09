export const ITEM_SEEDS = [
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
  { key: "arcane_wand", name: "Varinha Arcana", slot: "weapon", rarity: "uncommon", atk_min: 3, atk_max: 7, crit_min: 2, crit_max: 5, drop_rate: 0.015, map_key: "abyss" },
  { key: "crystal_staff", name: "Cajado de Cristal", slot: "weapon", rarity: "rare", atk_min: 4, atk_max: 7, crit_min: 2, crit_max: 4, drop_rate: 0.01, map_key: "swamp" },
  // Grave class weapons
  { key: "grave_war_sword", name: "Espada Tumular", slot: "weapon", rarity: "rare", atk_min: 5, atk_max: 9, crit_min: 0, crit_max: 2, drop_rate: 0.0024, map_key: "grave", class_req: "guerreiro", level_req: 23 },
  { key: "grave_arc_bow", name: "Arco dos Ossos", slot: "weapon", rarity: "rare", atk_min: 5, atk_max: 8, crit_min: 4, crit_max: 7, drop_rate: 0.0024, map_key: "grave", class_req: "arqueiro", level_req: 22 },
  { key: "grave_mag_wand", name: "Varinha Fúnebre", slot: "weapon", rarity: "rare", atk_min: 5, atk_max: 9, crit_min: 3, crit_max: 6, drop_rate: 0.0024, map_key: "grave", class_req: "mago", level_req: 24 },
  // Grave legendary boss weapons
  { key: "grave_war_lichblade", name: "Lâmina do Lich", slot: "weapon", rarity: "legendary", atk_min: 6, atk_max: 10, crit_min: 1, crit_max: 3, drop_rate: 0.0003, map_key: "grave", boss_only: true, class_req: "guerreiro", level_req: 28 },
  { key: "grave_arc_ossuary_bow", name: "Arco do Ossuário", slot: "weapon", rarity: "legendary", atk_min: 6, atk_max: 9, crit_min: 5, crit_max: 8, drop_rate: 0.0003, map_key: "grave", boss_only: true, class_req: "arqueiro", level_req: 28 },
  { key: "grave_mag_lichstaff", name: "Cajado do Lich", slot: "weapon", rarity: "legendary", atk_min: 6, atk_max: 10, crit_min: 4, crit_max: 7, drop_rate: 0.0003, map_key: "grave", boss_only: true, class_req: "mago", level_req: 28 },

  // Armors
  { key: "leather_armor", name: "Armadura de Couro", slot: "armor", rarity: "common", def_min: 1, def_max: 3, hp_min: 0, hp_max: 5, drop_rate: 0.03, map_key: "plains" },
  { key: "chain_armor", name: "Cota de Malha", slot: "armor", rarity: "uncommon", def_min: 2, def_max: 5, hp_min: 0, hp_max: 8, drop_rate: 0.02, map_key: "forest" },
  { key: "plate_armor", name: "Armadura de Placas", slot: "armor", rarity: "rare", def_min: 3, def_max: 6, hp_min: 6, hp_max: 10, drop_rate: 0.01, map_key: "swamp" },
  // Grave class armors
  { key: "grave_war_plate", name: "Couraça do Sepultador", slot: "armor", rarity: "rare", def_min: 4, def_max: 7, hp_min: 10, hp_max: 16, drop_rate: 0.0024, map_key: "grave", class_req: "guerreiro", level_req: 23 },
  { key: "grave_arc_leather", name: "Gibão do Corvo", slot: "armor", rarity: "rare", def_min: 3, def_max: 5, hp_min: 8, hp_max: 14, drop_rate: 0.0024, map_key: "grave", class_req: "arqueiro", level_req: 22 },
  { key: "grave_mag_robe", name: "Manto do Lamento", slot: "armor", rarity: "rare", def_min: 1, def_max: 3, hp_min: 12, hp_max: 20, drop_rate: 0.0024, map_key: "grave", class_req: "mago", level_req: 24 },

  // Shields
  { key: "wooden_shield", name: "Escudo de Madeira", slot: "shield", rarity: "common", def_min: 1, def_max: 3, hp_min: 0, hp_max: 3, drop_rate: 0.03, map_key: "plains" },
  { key: "steel_shield", name: "Escudo de Aço", slot: "shield", rarity: "uncommon", def_min: 2, def_max: 5, hp_min: 0, hp_max: 5, drop_rate: 0.02, map_key: "forest" },
  { key: "tower_shield", name: "Escudo Torre", slot: "shield", rarity: "rare", def_min: 3, def_max: 6, hp_min: 1, hp_max: 6, drop_rate: 0.01, map_key: "swamp" },
  // Grave class shields
  { key: "grave_war_shield", name: "Escudo do Mausoléu", slot: "shield", rarity: "rare", def_min: 4, def_max: 7, hp_min: 3, hp_max: 8, drop_rate: 0.0024, map_key: "grave", class_req: "guerreiro", level_req: 23 },
  { key: "grave_arc_buckler", name: "Broquel Silencioso", slot: "shield", rarity: "rare", def_min: 3, def_max: 5, hp_min: 2, hp_max: 6, drop_rate: 0.0024, map_key: "grave", class_req: "arqueiro", level_req: 22 },
  { key: "grave_mag_talisman", name: "Égide Ritual", slot: "shield", rarity: "rare", def_min: 2, def_max: 4, hp_min: 6, hp_max: 10, drop_rate: 0.0024, map_key: "grave", class_req: "mago", level_req: 24 },

  // Acessórios (Plains) - somente boss de masmorra
  { key: "brass_ring", name: "Anel de Latão", slot: "ring", rarity: "uncommon", atk_min: 1, atk_max: 4, crit_min: 1, crit_max: 2, drop_rate: 0.01, map_key: "plains", boss_dungeon_only: true },
  { key: "sapphire_amulet", name: "Colar de Safira", slot: "amulet", rarity: "uncommon", def_min: 1, def_max: 2, hp_min: 1, hp_max: 5, drop_rate: 0.01, map_key: "plains", boss_dungeon_only: true },
  { key: "leather_boots", name: "Bota de Couro", slot: "boots", rarity: "uncommon", def_min: 2, def_max: 5, hp_min: 1, hp_max: 3, drop_rate: 0.01, map_key: "plains", boss_dungeon_only: true },

  // Acessórios (Forest) - somente boss de masmorra
  { key: "silver_ring", name: "Anel de Prata", slot: "ring", rarity: "uncommon", atk_min: 2, atk_max: 7, crit_min: 2, crit_max: 4, drop_rate: 0.01, map_key: "forest", boss_dungeon_only: true },
  { key: "platinum_amulet", name: "Colar de Platina", slot: "amulet", rarity: "uncommon", def_min: 1, def_max: 5, hp_min: 2, hp_max: 7, drop_rate: 0.01, map_key: "forest", boss_dungeon_only: true },
  { key: "iron_boots", name: "Bota de Ferro", slot: "boots", rarity: "uncommon", def_min: 5, def_max: 8, hp_min: 1, hp_max: 4, drop_rate: 0.01, map_key: "forest", boss_dungeon_only: true },

  // Acessórios (Swamp) - boss do pântano (Hidra)
  { key: "hydra_war_amulet", name: "Colar Pegajoso da Hidra", slot: "amulet", rarity: "legendary", def_min: 3, def_max: 6, hp_min: 8, hp_max: 14, drop_rate: 0.001, map_key: "swamp", boss_dungeon_only: true, class_req: "guerreiro", level_req: 22 },
  { key: "hydra_arc_amulet", name: "Colar de Dentes da Hidra", slot: "amulet", rarity: "legendary", atk_min: 2, atk_max: 4, crit_min: 5, crit_max: 9, hp_min: 3, hp_max: 7, drop_rate: 0.001, map_key: "swamp", boss_dungeon_only: true, class_req: "arqueiro", level_req: 22 },
  { key: "hydra_mag_amulet", name: "Colar da Cabeça da Hidra", slot: "amulet", rarity: "legendary", atk_min: 5, atk_max: 9, crit_min: 2, crit_max: 4, hp_min: 4, hp_max: 8, drop_rate: 0.001, map_key: "swamp", boss_dungeon_only: true, class_req: "mago", level_req: 22 },
  { key: "hydra_war_ring", name: "Anel de Escamas da Hidra", slot: "ring", rarity: "legendary", def_min: 2, def_max: 4, hp_min: 6, hp_max: 10, drop_rate: 0.001, map_key: "swamp", boss_dungeon_only: true, class_req: "guerreiro", level_req: 22 },
  { key: "hydra_arc_ring", name: "Anel da Hidra Caçadora", slot: "ring", rarity: "legendary", atk_min: 2, atk_max: 4, crit_min: 6, crit_max: 10, drop_rate: 0.001, map_key: "swamp", boss_dungeon_only: true, class_req: "arqueiro", level_req: 22 },
  { key: "hydra_mag_ring", name: "Anel do Olho da Hidra", slot: "ring", rarity: "legendary", atk_min: 4, atk_max: 7, crit_min: 2, crit_max: 5, drop_rate: 0.001, map_key: "swamp", boss_dungeon_only: true, class_req: "mago", level_req: 22 },
  { key: "boots_of_haste", name: "Boots of Haste", slot: "boots", rarity: "legendary", def_min: 7, def_max: 11, hp_min: 4, hp_max: 8, drop_rate: 0.0005, map_key: "swamp", boss_dungeon_only: true, level_req: 22 },

  // Accessories
  { key: "amulet_health", name: "Amuleto Vital", slot: "amulet", rarity: "rare", hp_min: 15, hp_max: 30, drop_rate: 0.008, map_key: "desert" },

  // Dungeon key
  { key: "dungeon_key", name: "Chave de Masmorra", slot: "key", rarity: "rare", drop_rate: 0.012, map_key: null, boss_only: true },
  { key: "bone_key", name: "Chave de Ossos", slot: "key", rarity: "rare", drop_rate: 0.005, map_key: "grave" },

  // Consumables
  { key: "health_potion", name: "Poção de Vida", slot: "consumable", rarity: "common", drop_rate: 0.05, map_key: null },
  { key: "energy_potion", name: "Poção de Energia", slot: "consumable", rarity: "uncommon", drop_rate: 0.01, map_key: null },
  { key: "energy_potion_pack", name: "Pacote de Energia (3)", slot: "consumable", rarity: "rare", drop_rate: 0, map_key: null },
  { key: "atk_tonic", name: "Tônico de Força", slot: "consumable", rarity: "uncommon", drop_rate: 0.025, map_key: null },
  { key: "def_tonic", name: "Tônico de Defesa", slot: "consumable", rarity: "uncommon", drop_rate: 0.025, map_key: null },
  { key: "crit_tonic", name: "Tônico de Precisão", slot: "consumable", rarity: "uncommon", drop_rate: 0.02, map_key: null },
  { key: "elixir_xp", name: "Elixir de Sabedoria", slot: "consumable", rarity: "rare", drop_rate: 0, map_key: null },
  { key: "elixir_drop", name: "Elixir da Fortuna", slot: "consumable", rarity: "rare", drop_rate: 0, map_key: null },
];
