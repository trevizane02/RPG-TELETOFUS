# TELETOFUS Telegram RPG – Notas de Implementação

Estas notas resumem o estado atual do projeto, principais decisões de arquitetura e pontos pendentes. Útil para qualquer IA/dev entender rapidamente.

## Stack
- Node.js + Telegraf (bot Telegram) + Express (health check).
- Postgres (Railway).
- `.env`: `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `ADMIN_IDS` (lista de Telegram IDs admins), demais tokens (WhatsApp etc. não usados no fluxo).

## Estrutura principal
- `index.js`: lógica do bot, estados, comandos, eventos, combates, arena, dungeons, trocas.
- `migrate.js`: migração + seeds de mapas/mobs/itens e cleanup de dados legados.
- `db.js`: pool do Postgres.

## Schema (migrate.js)
- `players`: telegram_id, class (guerreiro/arqueiro/mago), xp_total, gold, diamonds (moeda premium), vip_until, hp/hp_max, energy/energy_max, current_map_key, state, last_energy_at, base_atk/def/crit, temp_atk/def/crit_buff + temp_buff_expires_at, last_seen (para contagem online), trophies, arena_coins, trade_code/expira. Auto-migra de phone legacy. Morte: -10% XP, -1 energia, HP ~50%; se logar com HP<=0, penalidade roda.
- `level_xp`: curva com início rápido (base 60, mult 1.32) seedada até 50; migração sempre reaplica.
- `maps`: keys padrão (`plains`, `forest`, `swamp`, `grave`, `desert`, `mountain`, `abyss`) com level_min/difficulty/image_file_id.
- `items`: key, slot, rarity, drop_rate, map_key, faixas min/max de atk/def/hp/crit, image_file_id. Sementes incluem armas/armaduras/escudos/acessórios, `dungeon_key`, consumíveis (`health_potion`, `energy_potion` drop raro, `atk_tonic`, `def_tonic`, `crit_tonic`) e armas novas (arqueiro: `longbow`, `crossbow`; mago: `novice_rod`, `arcane_wand`, `crystal_staff`).
- `inventory`: player_id, item_key, qty, equipped, rolled_atk/def/hp/crit, rolled_rarity.
- `mobs`: mobs por mapa (Tibia-style), raridade, xp_gain, gold_gain, image_file_id.
- Novas tabelas: `trades`/`trade_items` (troca), `arenas` (pvp), `dungeons`/`dungeon_members` (co-op).
- Cleanup automático: remove mapas/mobs/itens/inventory fora dos seeds, corrige current_map_key inválido para `plains`, normaliza/trunca loot_tables legadas antes de apagar mapas (FK safety).

## Seeds
- Mapas: 7 (plains…abyss) com dificuldade 1–5.
- Mobs: lista por mapa (rat, wolf, …, abyss_lord). Planície abre todos os comuns cedo e boss só a partir do Lv5. Imagem via `image_file_id` (admins setam).
- Itens: armas/armaduras/escudos/acessórios + dungeon_key; raridade e faixas min/max; rolls são feitos no drop.

## Bot – Comandos e fluxos (estado atual)
- Básico: `/start`, `/menu`, `/energia`, `/perfil`, `/inventario`, `/classe` (apenas se xp=0), `/descansar` (-1⚡ cura HP).
- Upload de imagens (admin): `/setmobimg <mob_key>`, `/setmapimg <map_key>`, `/setitemimg <item_key>`; próximo envio de foto salva `file_id`.
- Menus em “cards” (foto + caption + inline buttons) com fallback texto.
- Caçar (`action_hunt`): consome 1 energia, rola evento (combate 78%, baú 2% com 50% de chance extra de `energy_potion` se não vier item, armadilha 10%, mercador 5%, boss 5%). Usa `map.image_file_id` se houver ou imagem de evento se setada.
- Combate PvE: estado em memória (`fights`), dano com crit, drop XP/Gold e item (chance escala com dificuldade/boss). Morte aplica penalty (-10% XP, -1 energia, HP reduzido; também se logar com HP<=0).
- Descansar: botão/`/descansar` gasta 1 energia e restaura HP total (considera bônus de itens). Poção de vida também cura até o HP total.
- Energia regenera a cada 12 min (REGEN_MINUTES).
- Inventário: mostra itens equipados e rolls; equipar/desequipar por slot.
- Classes: só na criação (xp=0). Guerreiro/Arqueiro/Mago alteram base_atk/def/crit e hp_max. Restrição de armas por classe (guerreiro: espadas/machado; arqueiro: arcos/besta; mago: cajados/varinhas).
- Trocas: fluxo por botões. `/troca` abre menu (criar/entrar), card da sessão mostra ofertas e confirmações; inventário paginado para escolher item/quantidade; confirmações resetam ao mudar oferta; expira em 10 min. `/troca_join <cod>` ainda funciona.
- Arena PvP: `/arena` entra em fila; match automático; turno simples com “Atacar/Desistir”. Vitória dá troféus + arena coins; derrota perde troféus.
- Dungeons: `/dungeon_create <dif 1-5> [senha]` consome `dungeon_key`, gera código; máx 3 players com `/dungeon_join`. Dono inicia; um chefe único escalado; recompensa XP/Gold/loot; falha se chefe viver.

## Roll de itens
- Usa faixas min/max por atributo e fator por raridade (common/uncommon/rare/epic/legendary). Guarda rolls em `inventory.rolled_*`.

## Imagens
- Usam `file_id` do Telegram (evita URLs externas). Admins setam via comandos acima.
- Combate mostra `mob.image_file_id` se existir; mapas usam `maps.image_file_id` em cards.

## Health check
- Express em `/health/db`: retorna contagem de maps/mobs se DB ok.

- ## Pendências / melhorias futuras
- Trade: hoje rerolla stats; ideal seria transferir a instância (precisa modelar itens como registros únicos).
- Arena: matchmaking simplificado; poderia usar faixa de troféus/elos e custo de entrada.
- Dungeons: atualmente 1 encontro; expandir para múltiplas salas/eventos e rewards graduais. Melhorar UX com lobby (Criar/Entrar, pronto, expulsar, iniciar) e suportar até 5 jogadores. Manter custo em chave (não energia).
- Classes: só na criação; opcional implementar reset de classe com custo/item.
- Consumíveis: implementados (poções e tónicos temporários de ATK/DEF/CRIT). /usar <item> consome.
- Loja de arena (usar arena_coins) e cosméticos/skins.
- VIP/diamantes: adicionar fluxo de compra (Telegram Payments ou checkout externo) que credita `diamonds` e pode marcar `vip_until`. Benefícios sugeridos: +energia máx/regen mais rápida, drop/arena_coins bonus, slots extras de inventário, “reviver” diário, skins. Diamantes podem ser gastos em: poção de energia, dungeon_key, boosts temporários, VIP.
- Logs/observabilidade: adicionar mais logs estruturados ou Sentry.
- Testes automáticos: inexistentes; adicionar unit/integration para core (combate, drop, migração).
- Recalcular XP pós-curva nova: migração já roda automaticamente uma vez (flag `recalc_xp_v1`) para mapear xp_total da curva antiga para a nova. Script manual `npm run recalc:xp` permanece como fallback (requer `DATABASE_URL` válido).

### Ideias futuras – Masmorras
- Lobby com botões (Criar/Entrar, Pronto/Despronto, Expulsar, Iniciar, Cancelar/Sair), até 5 jogadores, custo 1 `dungeon_key`.
- Dificuldades com recomendação: M1 grupo 5+ / solo 8+; M2 grupo 12+ / solo 16+; M3 grupo 20+ / solo 25+; Especial (chave `bone_key` drop a partir da floresta, negociável) grupo 30+ / solo 35+.
- Combate cooperativo por salas (2–3) com botões por jogador (Atacar/Defender/Usar poção própria/Habilidade de classe). Escala de stats: fator = 1 + 0.4*(n-1) * multiplicador da dificuldade. Loot/XP escalados; chave especial só no boss especial.
- Imagens: usar imagem única de lobby/portal e artes de chaves (`dungeon_key`, futura `bone_key`) via `/setitemimg` ou comando dedicado.

## Troubleshooting comum
- Falta `TELEGRAM_BOT_TOKEN`: o bot não sobe (erro “Missing TELEGRAM_BOT_TOKEN”).
- Migração quebra por schema legado: `migrate.js` já tenta ajustar/cleanup; verificar logs do Railway.
- Dados legados de mapas/mobs: agora limpados na migração; se persistir nome antigo, reexecutar migração/redeploy.
- Imagem não aparece: checar se `image_file_id` foi setado para aquela key (`/setmobimg rat`, etc.).
