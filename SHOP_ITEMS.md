# Tabela de preços das lojas

Fonte: seeds em `migrate.js` (`SHOP_SEEDS`) e configuração de lojas (`SHOP_DEFS` em `index.js`).

## Como adicionar/ajustar
- Inclua um registro em `shop_items` (ou no seed `SHOP_SEEDS`) com `item_key`, `currency`, `buy_price` e opcional `sell_price`.
- Se `sell_price` for `null`, o item não aparece para venda pelo jogador.
- Deixe `stock` em `NULL` para estoque infinito; se usar um número, a compra trava quando chegar a 0.
- Para aparecer em uma loja específica, garanta que o `item_key` está na lista da loja em `SHOP_DEFS` (index.js).
  - Vila: itens básicos/consumíveis.
  - Matadores: armas/armaduras intermediárias.
  - Castelo: itens premium/finais.

## Lista atual (moeda / compra / venda)
- Consumíveis (Gold)
  - health_potion — gold — buy 149 — sell 45
  - energy_potion — gold — buy 5000 — sell 1500
  - atk_tonic — gold — buy 150 — sell 40
  - def_tonic — gold — buy 150 — sell 40
  - crit_tonic — gold — buy 180 — sell 50

- Consumíveis (Arena Coins)
  - health_potion — arena_coins — buy 100 — sell null
  - energy_potion — arena_coins — buy 250 — sell null

- Equipamentos básicos (Gold)
  - short_sword — gold — buy 100 — sell 30
  - wooden_shield — gold — buy 80 — sell 25
  - leather_armor — gold — buy 120 — sell 35
  - novice_rod — gold — buy 90 — sell 28
  - hunting_bow — gold — buy 110 — sell 32

- Itens raros (Arena Coins)
  - knight_blade — arena_coins — buy 500 — sell null
  - plate_armor — arena_coins — buy 600 — sell null
  - tower_shield — arena_coins — buy 450 — sell null
  - crystal_staff — arena_coins — buy 550 — sell null
  - crossbow — arena_coins — buy 520 — sell null

- Chave
  - dungeon_key — gold — buy 500 — sell 150

- Premium (Tofus)
  - amulet_health — tofus — buy 100 — sell null
  - ring_protect — tofus — buy 100 — sell null

Observação: só itens com `sell_price` diferente de `null` aparecem para o jogador vender; para permitir venda de outros (ex.: sabre, longbow etc.), defina um `sell_price` para eles.
Obs: o NPC agora compra qualquer item por Gold; se não houver `sell_price` definido, usa um valor base pela raridade (common 25, uncommon 60, rare 120, epic 250, legendary 400).
