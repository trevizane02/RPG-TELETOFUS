# Plano de Masmorras (draft)

Escopo geral
- 4 dungeons: Planície, Floresta, Pântano e Especial. Cada uma com mobs/boss próprios (versões turbinadas dos mapas). Sem drop de tofus.
- Acesso: custa 1 `dungeon_key` por jogador (Especial usa `bone_key`). Nível mínimo alinhado ao mapa (ex.: Planície 5+/8+, Floresta 12+/16+, Pântano 20+/25+, Especial 30+/35+).
- Estrutura: 3 salas + boss. Até 5 jogadores por lobby.
- Ações por turno: Atacar / Defender / Usar poção própria (gasta o turno).
- Loot: drop individual; bosses têm chance de `bone_key` (baixa nas comuns, maior na Especial), poções, itens da região. Mortos recebem -30% na parte deles.

XP (por run, dividido pelo dano em cada sala/boss)
- M1: ~2.400 XP (S1 400, S2 500, S3 600, Boss 900)
- M2: ~3.800 XP (S1 600, S2 800, S3 1.000, Boss 1.400)
- M3: ~5.500 XP (S1 900, S2 1.100, S3 1.300, Boss 2.200)
- Especial: ~8.000 XP (S1 1.200, S2 1.600, S3 2.000, Boss 3.200)

Mobs/boss propostos (exclusivos por dungeon)
- Planície: Lobo Alfa, Aranha Rochedo, Batedor Goblin | Boss: Senhor dos Rochedos.
- Floresta: Ent Jovem, Aranha da Mata, Batedor Elfo | Boss: Guardião do Bosque.
- Pântano: Orc do Pântano, Bruxa do Brejo, Sanguessuga Gigante | Boss: Hidra Menor.
- Especial: Cavaleiro Sombrio, Cultista Abissal, Golem de Osso | Boss: Arquilorde dos Ossos.

Regras de drop
- Boss de qualquer dungeon: chance de `bone_key` (ex.: 1–2% nas comuns, 8–12% na Especial). Poções/itens da região com chance maior; sem tofus.
- Mobs comuns: mais chance de poções/tônicos e itens da própria região.

UX resumido
- Tela “Masmorra de <Mapa>” com imagem/portal do mapa.
- Lobby: Criar/Entrar, Pronto/Despronto, Expulsar, Iniciar, Sair; mostra lista de jogadores e pronto.
- Combate: usa botões Atacar/Defender/Consumíveis; defender aumenta chance de foco e reduz one-shot dividindo parte do dano.
- Tela final: imagem da dungeon, ranking de dano e drops individuais.
