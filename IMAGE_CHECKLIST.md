# Checklist de Imagens do Bot

Guia rápido de upload:
- Mapas: `/setmapimg <key>` (ex.: `plains`, `forest`, `swamp`, `grave`, `desert`, `mountain`, `abyss`).
- Mobs: `/setmobimg <key>` (mobs normais) e `/setmobdimg <key>` (mobs de dungeon, prefixo `d_`).
- Itens: `/setitemimg <key>` (consumíveis, equipamentos, acessórios, chaves).
- Eventos/capas: `/seteventimg <chest|trap|merchant|loot_gold|loot_item|dungeon_plains|dungeon_forest|dungeon_swamp|dungeon_special>`.
- Arena (brasões): `/setarenaimg <arena_rank_sangue_novo|arena_rank_desafiador|arena_rank_veterano|arena_rank_campeao|arena_rank_lenda>`.
- Arena (capas): `arena_cover`, `arena_ranks_cover`, `arena_chests_cover`.
- VIP/Tofus: use `/seteventimg vip_cover`, `/seteventimg vip_tofus_cover`, `/seteventimg vip_buy_cover`.
- Lojas: `/setshopimg <main|vila|matadores|castelo>`.

## Mapas
- [ ] abyss | Abismo
- [ ] desert | Deserto Escaldante
- [ok] forest | Floresta Sombria
- [ ] grave | Cemitério Antigo
- [ ] mountain | Montanhas Gélidas
- [ok] plains | Planície
- [ ] swamp | Pântano

## Mobs (por mapa)
- [ ] abyss_lord | Lorde do Abismo (abyss)
- [ok] bandit | Bandido (plains)
- [ok] bear | Urso (forest)
- [ok] boar | Javali (forest)
- [ ] cultist | Cultista (abyss)
- [ ] demonling | Demonling (abyss)
- [ ] dragon_young | Dragão Jovem (mountain)
- [ok] elf_rogue | Elfo Saqueador (forest)
- [ok] ent | Guardião da Mata (forest)
- [ ] fire_imp | Diabrete Flamejante (desert)
- [ ] frost_orc | Orc da Neve (mountain)
- [ok] ghoul | Ghoul (swamp)
- [ok] goblin | Goblin (forest)
- [ ] harpy | Harpia (mountain)
- [ ] hellhound | Cão Infernal (abyss)
- [ok] hydra_whelp | Filhote de Hidra (swamp)
- [ ] ice_golem | Golem de Gelo (mountain)
- [ok] leech | Sanguessuga (swamp)
- [ ] lich | Lich (grave)
- [ok] minotaur_scout | Minotauro Batedor (plains)
- [ ] mummy | Múmia (grave)
- [ ] necro_apprentice | Necromante Aprendiz (grave)
- [ ] nomad | Nômade (desert)
- [ok] rat | Rato Gigante (plains)
- [ ] sand_worm | Verme de Areia (desert)
- [ ] scorpion | Escorpião (desert)
- [ ] shadow_knight | Cavaleiro Sombrio (abyss)
- [ ] skeleton | Esqueleto (grave)
- [ok] slime | Slime Viscoso (swamp)
- [ok] spider | Aranha (plains)
- [ ] swamp_orc | Orc do Pântano (swamp)
- [ok] troll | Troll Jovem (plains)
- [ ] void_spawn | Cria do Vazio (abyss)
- [ok] wasp | Vespa Gigante (forest)
- [ok] wolf | Lobo (plains)
- [ ] wraith | Espectro (grave)
- [ ] wyvern | Wyvern (mountain)
- [ ] zombie | Zumbi (grave)
- Dungeons (plains): d_wolf_alpha, d_spider_rock, d_goblin_scout, d_rock_lord (boss_dungeon)
- Dungeons (forest): d_entling, d_forest_spider, d_elf_scout, d_forest_guardian (boss_dungeon)
- Dungeons (swamp): d_swamp_orc, d_swamp_witch, d_swamp_leech, d_swamp_hydra (boss_dungeon)

## Itens (equipáveis)
- [ ] amulet_health | Amuleto Vital (amulet, desert)
- [ok] battle_axe | Machado de Batalha (weapon, forest)
- [ ] chain_armor | Cota de Malha (armor, forest)
- [ ] dark_robe | Manto Sombrio (armor, grave)
- [ok] dungeon_key | Chave de Masmorra (key, drop global)
- [ok] hunting_bow | Arco de Caça (weapon, plains)
- [ok] knight_blade | Lâmina do Cavaleiro (weapon, desert)
- [ok] leather_armor | Armadura de Couro (armor, plains)
- [ok] mage_staff | Cajado do Aprendiz (weapon, forest)
- [ok] plate_armor | Armadura de Placas (armor, mountain)
- [ ] ring_protect | Anel de Proteção (ring, grave)
- [ ] sabre | Sabre (weapon, forest)
- [ok] short_sword | Espada Curta (weapon, plains)
- [ ] steel_shield | Escudo de Aço (shield, forest)
- [ok] tower_shield | Escudo Torre (shield, mountain)
- [ok] wooden_shield | Escudo de Madeira (shield, plains)
- [ok] longbow | Arco Longo (weapon, forest)
- [ok] crossbow | Besta Reforçada (weapon, mountain)
- [ok] arcane_wand | Varinha Arcana (weapon, grave)
- [ok] crystal_staff | Cajado de Cristal (weapon, desert)
- [ok] novice_rod | Cajado Novato (weapon, plains)
- [ok] brass_ring | Anel de Latão (ring, plains)
- [ok] sapphire_amulet | Colar de Safira (amulet, plains)
- [ok] leather_boots | Bota de Couro (boots, plains)
- [ok] silver_ring | Anel de Prata (ring, forest)
- [ok] platinum_amulet | Colar de Platina (amulet, forest)
- [ok] iron_boots | Bota de Ferro (boots, forest)

## Consumíveis
- [ok] health_potion | Poção de Vida
- [ok] energy_potion | Poção de Energia (drop raro)
- [ok] atk_tonic | Tônico de Força
- [ok] def_tonic | Tônico de Defesa
- [ok] crit_tonic | Tônico de Precisão

## Eventos / Capas
- [ok] loot_gold | Imagem genérica para drop de gold
- [ ] loot_item | Imagem genérica para drop de item
- [ok] dungeon_plains | Capa da dungeon da Planície
- [ok] dungeon_forest | Capa da dungeon da Floresta
- [ok] dungeon_swamp | Capa da dungeon do Pântano
- [ok] dungeon_special | Capa da dungeon Especial
- [ok] CHEST_IMAGE_ID | Baú encontrado
- [ok] TRAP_IMAGE_ID | Armadilha
- [ok] MERCHANT_IMAGE_ID | Mercador
- Arena (brasões/ranks)
  - [ ] arena_rank_sangue_novo | Sangue-Novo
  - [ ] arena_rank_desafiador | Desafiador
  - [ ] arena_rank_veterano | Veterano
  - [ ] arena_rank_campeao | Campeão
  - [ ] arena_rank_lenda | Lenda
  - [ ] arena_cover | Capa do menu da Arena
  - [ ] arena_ranks_cover | Capa da tela de ranks
  - [ ] arena_chests_cover | Capa da tela de tesouros
- VIP / Tofus
  - [ ] vip_cover | Capa do menu VIP
  - [ ] vip_tofus_cover | Capa da loja de Tofus (PIX/MP)
  - [ ] vip_buy_cover | Capa da compra de VIP

## Lojas
- [ok] shop_main | Capa do menu de lojas
- [ok] shop_vila | Loja da Vila
- [ok] shop_matadores | Loja dos Matadores
- [ok] shop_castelo | Loja do Castelo

Obs.: os `*_IMAGE_ID` em .env funcionam como fallback para eventos/lojas; se não definir, o bot tenta usar a imagem do mapa ou a default do item/mob.
