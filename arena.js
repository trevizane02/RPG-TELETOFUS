import { Markup } from "telegraf";

const ARENA_RANKS = [
  { key: "sangue_novo", name: "Sangue-Novo", min: 0, max: 199, imageKey: "arena_rank_sangue_novo" },
  { key: "desafiador", name: "Desafiador", min: 200, max: 599, imageKey: "arena_rank_desafiador" },
  { key: "veterano", name: "Veterano", min: 600, max: 1199, imageKey: "arena_rank_veterano" },
  { key: "campeao", name: "Campeão", min: 1200, max: 1999, imageKey: "arena_rank_campeao" },
  { key: "lenda", name: "Lenda", min: 2000, max: 999999, imageKey: "arena_rank_lenda" },
];

const WIN_COINS = 5;
const SURRENDER_COINS = 3;
const ARENA_MAX_SLOTS = 5;
const ARENA_FREE_SLOTS = 1;
const CHEST_CHANCES = {
  common: 0.1, // 10%
  uncommon: 0.02, // 2%
  legendary: 0.0001, // 0.01%
};
const CHEST_TIMERS_HOURS = {
  common: 4,
  uncommon: 12,
  legendary: 72,
};
const CHEST_FALLBACK_ARENA_COINS = {
  common: 8,
  uncommon: 15,
  legendary: 25,
};
const CHEST_REWARDS = {
  common: [
    { type: "item", key: "energy_potion", qty: [1, 3], weight: 50 },
    { type: "item", key: "health_potion", qty: [2, 5], weight: 30 },
    { type: "item", key: "dungeon_key", qty: [1, 1], weight: 20 },
  ],
  uncommon: [
    { type: "item", key: "energy_potion", qty: [2, 4], weight: 35 },
    { type: "item", key: "health_potion", qty: [3, 8], weight: 25 },
    { type: "item", key: "dungeon_key", qty: [2, 3], weight: 25 },
    { type: "gold", amount: [300, 600], weight: 15 },
  ],
  legendary: [
    { type: "item", key: "energy_potion", qty: [3, 10], weight: 35 },
    { type: "item", key: "health_potion", qty: [4, 10], weight: 25 },
    { type: "gold", amount: [500, 1000], weight: 20 },
    { type: "combo", key: "dungeon_key", qty: [1, 1], gold: [500, 800], weight: 15 },
    { type: "tofu", amount: [1, 1], weight: 5 },
  ],
};

export function registerArena(bot, deps) {
  const { pool, getPlayer, getPlayerStats, makeBar, rollDamage, sendCard, setPlayerState, awardItem, STATES } = deps;

  const arenaQueue = [];
  const arenaFights = new Map(); // userId -> fight data
  const exitPrompts = new Map(); // userId -> expires timestamp
  const rankImages = new Map(); // key -> file_id or null
  const coverImages = new Map(); // key -> file_id or null
  const itemCache = new Map(); // item_key -> row

  function isVip(player) {
    if (!player?.vip_until) return false;
    const exp = new Date(player.vip_until);
    return exp.getTime() > Date.now();
  }

  function unlockedSlots(player) {
    // Free: 1 slot. VIP: até 5 slots.
    return isVip(player) ? ARENA_MAX_SLOTS : ARENA_FREE_SLOTS;
  }

  async function getChests(playerId) {
    const res = await pool.query(
      `
      SELECT *
      FROM arena_chests
      WHERE player_id = $1
      ORDER BY slot ASC, created_at ASC
    `,
      [playerId]
    );
    return res.rows;
  }

  function findFreeSlot(chests, unlocked) {
    const limit = Math.min(unlocked, ARENA_MAX_SLOTS);
    for (let i = 0; i < limit; i++) {
      const has = chests.find((c) => c.slot === i && c.state !== "opened");
      if (!has) return i;
    }
    return null;
  }

  function rollChestRarity() {
    const r = Math.random();
    if (r < CHEST_CHANCES.legendary) return "legendary";
    if (r < CHEST_CHANCES.legendary + CHEST_CHANCES.uncommon) return "uncommon";
    if (r < CHEST_CHANCES.legendary + CHEST_CHANCES.uncommon + CHEST_CHANCES.common) return "common";
    return null;
  }

  function formatRemaining(unlockAt) {
    if (!unlockAt) return "";
    const diffMs = new Date(unlockAt) - new Date();
    if (diffMs <= 0) return "pronto";
    const totalMin = Math.ceil(diffMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m}m`;
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  }

  async function maybeDropChest(player) {
    const rarity = rollChestRarity();
    if (!rarity) return { dropped: false };
    const chests = await getChests(player.id);
    const free = findFreeSlot(chests, unlockedSlots(player));
    if (free === null) return { dropped: false, noSlot: true };
    const hours = CHEST_TIMERS_HOURS[rarity] || 4;
    const unlockAt = new Date(Date.now() + hours * 3600 * 1000);
    const ins = await pool.query(
      `
      INSERT INTO arena_chests (player_id, slot, rarity, state, unlock_at)
      VALUES ($1, $2, $3, 'locked', $4)
      RETURNING *
    `,
      [player.id, free, rarity, unlockAt]
    );
    return { dropped: true, rarity, slot: free, unlockInHours: hours, chest: ins.rows[0] };
  }

  function chestLabel(chest) {
    const ready = chest.unlock_at && new Date(chest.unlock_at) <= new Date();
    const name =
      chest.rarity === "legendary"
        ? "Tesouro Lendário"
        : chest.rarity === "uncommon"
        ? "Tesouro Incomum"
        : "Tesouro Comum";
    const slotNum = (chest.slot || 0) + 1;
    if (ready) return `Slot ${slotNum}: ${name} — pronto para abrir`;
    return `Slot ${slotNum}: ${name} — abre em ${formatRemaining(chest.unlock_at)}`;
  }

  async function openChest(player, chestId) {
    const chestRow = await pool.query("SELECT * FROM arena_chests WHERE id = $1 AND player_id = $2", [chestId, player.id]);
    const chest = chestRow.rows[0];
    if (!chest) return { ok: false, message: "Baú não encontrado." };
    const ready = chest.unlock_at && new Date(chest.unlock_at) <= new Date();
    if (!ready) return { ok: false, message: "Ainda não abriu." };

    const res = await pool.query(
      `
      UPDATE arena_chests
      SET state = 'opened', opened_at = NOW(), rewards = $1
      WHERE id = $2 AND player_id = $3 AND opened_at IS NULL AND (unlock_at IS NULL OR unlock_at <= NOW())
      RETURNING *
    `,
      [null, chestId, player.id]
    );
    if (!res.rows.length) return { ok: false, message: "Baú não está pronto ou não existe." };

    const rewardsPool = CHEST_REWARDS[chest.rarity] || CHEST_REWARDS.common;
    const totalWeight = rewardsPool.reduce((acc, r) => acc + (r.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    let picked = rewardsPool[0];
    for (const r of rewardsPool) {
      roll -= r.weight || 1;
      if (roll <= 0) {
        picked = r;
        break;
      }
    }

    const rewardsLog = [];
    let fallbackCoins = CHEST_FALLBACK_ARENA_COINS[chest.rarity] || 10;

    async function giveItem(key, qty) {
      const itemRow = await getItem(key);
      if (!itemRow) return false;
      for (let i = 0; i < qty; i++) {
        const res = await awardItem(player.id, itemRow);
        if (!res?.success) {
          return false;
        }
      }
      return true;
    }

    if (picked.type === "item") {
      const qty = randInt(picked.qty[0], picked.qty[1]);
      const ok = await giveItem(picked.key, qty);
      if (ok) {
        rewardsLog.push(`${qty}x ${picked.key}`);
        await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ item: picked.key, qty }, chestId]);
        return { ok: true, message: `Você recebeu ${qty}x ${picked.key}.` };
      } else {
        await pool.query("UPDATE players SET arena_coins = arena_coins + $1 WHERE id = $2", [fallbackCoins, player.id]);
        await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ arena_coins: fallbackCoins, fallback: true }, chestId]);
        return { ok: true, message: `Inventário cheio. Recebeu ${fallbackCoins} arena coins no lugar.` };
      }
    }

    if (picked.type === "gold") {
      const gold = randInt(picked.amount[0], picked.amount[1]);
      await pool.query("UPDATE players SET gold = gold + $1 WHERE id = $2", [gold, player.id]);
      await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ gold }, chestId]);
      return { ok: true, message: `Você recebeu ${gold} gold.` };
    }

    if (picked.type === "tofu") {
      const tofu = randInt(picked.amount[0], picked.amount[1]);
      await pool.query("UPDATE players SET tofus = tofus + $1 WHERE id = $2", [tofu, player.id]);
      await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ tofus: tofu }, chestId]);
      return { ok: true, message: `Você recebeu ${tofu} Tofus.` };
    }

    if (picked.type === "combo") {
      const qty = randInt(picked.qty[0], picked.qty[1]);
      const gold = randInt(picked.gold[0], picked.gold[1]);
      const ok = await giveItem(picked.key, qty);
      await pool.query("UPDATE players SET gold = gold + $1 WHERE id = $2", [gold, player.id]);
      if (ok) {
        await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ item: picked.key, qty, gold }, chestId]);
        return { ok: true, message: `Você recebeu ${qty}x ${picked.key} e ${gold} gold.` };
      } else {
        await pool.query("UPDATE players SET arena_coins = arena_coins + $1 WHERE id = $2", [fallbackCoins, player.id]);
        await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ arena_coins: fallbackCoins, fallback: true, gold }, chestId]);
        return { ok: true, message: `Inventário cheio. Recebeu ${gold} gold + ${fallbackCoins} arena coins.` };
      }
    }

    await pool.query("UPDATE players SET arena_coins = arena_coins + $1 WHERE id = $2", [fallbackCoins, player.id]);
    await pool.query("UPDATE arena_chests SET rewards = $1 WHERE id = $2", [{ arena_coins: fallbackCoins, fallback: true }, chestId]);
    return { ok: true, message: `Recompensa padrão: ${fallbackCoins} arena coins.` };
  }

  function arenaMenuKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback("⚔️ Batalhar", "arena_queue")],
      [Markup.button.callback("📊 Ranks", "arena_ranks_menu")],
      [Markup.button.callback("🏅 Meu Rank", "arena_my_rank")],
      [Markup.button.callback("💰 Tesouros", "arena_chests")],
      [Markup.button.callback("🏠 Menu", "menu")],
    ]).reply_markup;
  }

  function fightKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback("⚔️ Atacar", "arena_attack"),
        Markup.button.callback("🛡️ Defender", "arena_defend"),
        Markup.button.callback("🏳️ Sair", "arena_exit"),
      ],
      [Markup.button.callback("🏠 Menu", "menu")],
    ]).reply_markup;
  }

  function postFightKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback("🏟️ Arena", "arena_menu"), Markup.button.callback("🏠 Menu", "menu")],
    ]).reply_markup;
  }

  function getRankByTrophies(trophies = 0) {
    return ARENA_RANKS.find((r) => trophies >= r.min && trophies <= r.max) || ARENA_RANKS[ARENA_RANKS.length - 1];
  }

  function getRankByKey(key) {
    return ARENA_RANKS.find((r) => r.key === key);
  }

  async function getRankImage(rank) {
    if (!rank) return null;
    if (rankImages.has(rank.key)) return rankImages.get(rank.key);
    try {
      const res = await pool.query("SELECT file_id FROM event_images WHERE event_key = $1", [rank.imageKey]);
      const fileId = res.rows[0]?.file_id || null;
      rankImages.set(rank.key, fileId);
      return fileId;
    } catch (e) {
      console.error("arena rank image load", e.message);
      rankImages.set(rank.key, null);
      return null;
    }
  }

  async function getCoverImage(key) {
    if (!key) return null;
    if (coverImages.has(key)) return coverImages.get(key);
    try {
      const res = await pool.query("SELECT file_id FROM event_images WHERE event_key = $1", [key]);
      const fileId = res.rows[0]?.file_id || null;
      coverImages.set(key, fileId);
      return fileId;
    } catch (e) {
      console.error("arena cover image load", e.message);
      coverImages.set(key, null);
      return null;
    }
  }

  async function sendToUser(userId, { fileId, caption, keyboard }) {
    const opts = { reply_markup: keyboard, parse_mode: "Markdown" };
    if (fileId) {
      try {
        await bot.telegram.sendPhoto(userId, fileId, { caption, ...opts });
        return;
      } catch (e) {
        console.error("arena sendPhoto", e.message);
      }
    }
    await bot.telegram.sendMessage(userId, caption, opts);
  }

  async function showArenaMenu(ctx) {
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);
    const fileId = await getCoverImage("arena_cover");
    const caption =
      `🏟️ Bem-vindo à Arena!\n` +
      `🏆 Seus troféus: ${player.trophies || 0}\n` +
      `🎖️ Arena coins: ${player.arena_coins || 0}\n` +
      `⚔️ Enfileire para duelar e ganhar troféus, coins e tesouros.`;
    await sendCard(ctx, { fileId, caption, keyboard: arenaMenuKeyboard() });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  }

  bot.action("arena_menu", showArenaMenu);
  bot.action("arena_menu_v2", showArenaMenu);
  // Alias para callbacks/menus antigos
  bot.action("arena", showArenaMenu);

  bot.command("arena", async (ctx) => {
    await showArenaMenu(ctx);
  });

  bot.action("arena_queue", async (ctx) => {
    const userId = String(ctx.from.id);
    if (arenaFights.has(userId)) {
      await ctx.answerCbQuery("Você já está lutando.");
      return;
    }
    if (arenaQueue.includes(userId)) {
      await ctx.answerCbQuery("Você já está na fila.");
      return;
    }
    arenaQueue.push(userId);
    await ctx.answerCbQuery("Fila da arena");
    await ctx.reply("⏳ Aguardando oponente na arena...", { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]).reply_markup });
    await tryMatchArena();
  });

  async function tryMatchArena() {
    while (arenaQueue.length >= 2) {
      const p1Id = arenaQueue.shift();
      const p1 = await getPlayer(p1Id);
      if (!p1) continue;
      let bestIdx = -1;
      let bestDiff = Infinity;
      for (let i = 0; i < arenaQueue.length; i++) {
        const candId = arenaQueue[i];
        const cand = await getPlayer(candId);
        if (!cand) continue;
        const diff = Math.abs((cand.trophies || 0) - (p1.trophies || 0));
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) {
        arenaQueue.unshift(p1Id);
        return;
      }
      const [p2Id] = arenaQueue.splice(bestIdx, 1);
      await startArenaFight(p1Id, p2Id);
    }
  }

  async function startArenaFight(p1Id, p2Id) {
    const [p1, p2] = await Promise.all([getPlayer(p1Id), getPlayer(p2Id)]);
    if (!p1 || !p2) return;
    const [s1, s2] = await Promise.all([getPlayerStats(p1), getPlayerStats(p2)]);
    const r1 = getRankByTrophies(p1.trophies || 0);
    const r2 = getRankByTrophies(p2.trophies || 0);

    const fight1 = {
      opponentId: p2Id,
      name: p1.name || "Aventureiro",
      hp: p1.hp,
      maxHp: s1.total_hp,
      atk: s1.total_atk,
      def: s1.total_def,
      gearDef: s1.gear_def || 0,
      crit: s1.total_crit,
      rank: r1,
      avatar: await getRankImage(r1),
      defBonus: 0,
    };
    const fight2 = {
      opponentId: p1Id,
      name: p2.name || "Aventureiro",
      hp: p2.hp,
      maxHp: s2.total_hp,
      atk: s2.total_atk,
      def: s2.total_def,
      gearDef: s2.gear_def || 0,
      crit: s2.total_crit,
      rank: r2,
      avatar: await getRankImage(r2),
      defBonus: 0,
    };
    arenaFights.set(p1Id, fight1);
    arenaFights.set(p2Id, fight2);

    await sendFightIntro(p1Id, fight1, fight2);
    await sendFightIntro(p2Id, fight2, fight1);
  }

  async function sendFightIntro(userId, fight, opponentFight) {
    const caption =
      `🏟️ Arena contra ${opponentFight.name}\n` +
      `Rank do oponente: ${opponentFight.rank.name}\n` +
      `HP dele: ${opponentFight.hp}/${opponentFight.maxHp}`;
    await sendToUser(userId, { fileId: opponentFight.avatar, caption, keyboard: fightKeyboard() });
  }

  function consumeDefBonus(fight) {
    const bonus = fight.defBonus || 0;
    fight.defBonus = 0;
    return bonus;
  }

  function calcDefBonus(fight) {
    return Math.max(1, Math.floor((fight.gearDef || 0) * 0.5));
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  async function getItem(key) {
    if (itemCache.has(key)) return itemCache.get(key);
    const res = await pool.query("SELECT * FROM items WHERE key = $1", [key]);
    const item = res.rows[0] || null;
    itemCache.set(key, item);
    return item;
  }

  function calcTrophyDelta(winnerTrophies, loserTrophies, { surrender = false } = {}) {
    const diff = loserTrophies - winnerTrophies;
    const expected = 1 / (1 + Math.pow(10, diff / 400));
    const gain = clamp(Math.round(24 + 12 * (1 - expected)), 10, 40);
    const loss = clamp(Math.round(20 + 10 * expected), 10, 35);
    if (surrender) {
      return { gain: Math.max(8, Math.round(gain * 0.7)), loss: Math.max(6, Math.round(loss * 0.6)) };
    }
    return { gain, loss };
  }

  function renderStatusCaption(me, opp, log) {
    return (
      `🏟️ Arena vs ${opp.name}\n` +
      `Rank: ${opp.rank.name}\n` +
      `Você: ${me.hp}/${me.maxHp} ${makeBar(me.hp, me.maxHp, 8)}\n` +
      `${opp.name}: ${opp.hp}/${opp.maxHp} ${makeBar(opp.hp, opp.maxHp, 8)}\n` +
      (log ? `\n${log}` : "")
    );
  }

  async function renderArenaStatus(meId, logMe, oppId, logOpp) {
    const me = arenaFights.get(meId);
    const opp = arenaFights.get(oppId);
    if (!me || !opp) return;
    await sendToUser(meId, { fileId: opp.avatar, caption: renderStatusCaption(me, opp, logMe), keyboard: fightKeyboard() });
    await sendToUser(oppId, { fileId: me.avatar, caption: renderStatusCaption(opp, me, logOpp), keyboard: fightKeyboard() });
  }

  async function finishFight(winnerId, loserId, { surrender = false } = {}) {
    const winner = await getPlayer(winnerId);
    const loser = await getPlayer(loserId);
    const { gain: trophyGain, loss: trophyLoss } = calcTrophyDelta(winner.trophies || 0, loser.trophies || 0, { surrender });
    const coinGain = surrender ? SURRENDER_COINS : WIN_COINS;

    const chestDrop = await maybeDropChest(winner);
    let chestMsgWinner = "";
    if (chestDrop.dropped) {
      const name =
        chestDrop.rarity === "legendary" ? "Tesouro Lendário" : chestDrop.rarity === "uncommon" ? "Tesouro Incomum" : "Tesouro Comum";
      chestMsgWinner = `\n🎁 ${name} enviado ao slot ${chestDrop.slot + 1}. Abre em ${chestDrop.unlockInHours}h.`;
    } else if (chestDrop.noSlot) {
      chestMsgWinner = `\n📦 Sem espaço para tesouro (slots cheios).`;
    }

    await Promise.all([
      pool.query(
        "UPDATE players SET trophies = GREATEST(0, trophies + $1), arena_coins = arena_coins + $2, arena_wins = arena_wins + 1 WHERE id = $3",
        [trophyGain, coinGain, winner.id]
      ),
      pool.query("UPDATE players SET trophies = GREATEST(0, trophies - $1), arena_losses = arena_losses + 1 WHERE id = $2", [trophyLoss, loser.id]),
      setPlayerState(winner.id, STATES.MENU),
      setPlayerState(loser.id, STATES.MENU),
    ]);

    arenaFights.delete(winnerId);
    arenaFights.delete(loserId);

    await sendToUser(winnerId, {
      caption: `🏆 Você venceu ${loser.name}!\n+${trophyGain} troféus\n+${coinGain} arena coins${chestMsgWinner}`,
      keyboard: postFightKeyboard(),
    });
    await sendToUser(loserId, {
      caption: `😵 Você perdeu para ${winner.name}\n-${trophyLoss} troféus`,
      keyboard: postFightKeyboard(),
    });
  }

  async function handleAction(ctx, action) {
    const userId = String(ctx.from.id);
    const fight = arenaFights.get(userId);
    if (!fight) {
      if (ctx.callbackQuery) ctx.answerCbQuery("Sem luta").catch(() => {});
      return;
    }
    const oppFight = arenaFights.get(fight.opponentId);
    if (!oppFight) {
      arenaFights.delete(userId);
      if (ctx.callbackQuery) ctx.answerCbQuery("Oponente indisponível").catch(() => {});
      return;
    }

    let logMe = "";
    let logOpp = "";

    if (action === "attack") {
      const oppDefBonus = consumeDefBonus(oppFight);
      const isCrit = Math.random() * 100 < fight.crit;
      const dmg = rollDamage(fight.atk, oppFight.def + oppDefBonus, isCrit);
      oppFight.hp = Math.max(0, oppFight.hp - dmg);
      logMe = `${isCrit ? "🔥 CRIT! " : ""}Você causou ${dmg} em ${oppFight.name}${oppDefBonus ? " (defendeu parte)" : ""}.`;
      logOpp = `${fight.name} causou ${dmg} em você${oppDefBonus ? " (sua defesa ajudou)" : ""}.`;

      if (oppFight.hp <= 0) {
        await ctx.answerCbQuery("Vitória!").catch(() => {});
        await finishFight(userId, fight.opponentId);
        return;
      }

      const myDefBonus = consumeDefBonus(fight);
      const oppCrit = Math.random() * 100 < oppFight.crit;
      const oppDmg = rollDamage(oppFight.atk, fight.def + myDefBonus, oppCrit);
      fight.hp = Math.max(0, fight.hp - oppDmg);
      logMe += `\n${oppCrit ? "🔥 CRIT! " : ""}${oppFight.name} contra-atacou e causou ${oppDmg}.`;
      logOpp += `\n${oppCrit ? "🔥 CRIT! " : ""}Você contra-atacou e causou ${oppDmg} em ${fight.name}${myDefBonus ? " (ele defendeu parte)" : ""}.`;

      if (fight.hp <= 0) {
        await ctx.answerCbQuery("Derrota").catch(() => {});
        await finishFight(fight.opponentId, userId);
        return;
      }
    } else if (action === "defend") {
      fight.defBonus = calcDefBonus(fight);
      logMe = `🛡️ Você se defende (+${fight.defBonus} DEF por 1 golpe).`;
      logOpp = `${fight.name} está defendendo.`;

      const oppCrit = Math.random() * 100 < oppFight.crit;
      const oppDmg = rollDamage(oppFight.atk, fight.def + consumeDefBonus(fight), oppCrit);
      fight.hp = Math.max(0, fight.hp - oppDmg);
      logMe += `\n${oppCrit ? "🔥 CRIT! " : ""}${oppFight.name} atacou e causou ${oppDmg}.`;
      logOpp += `\n${oppCrit ? "🔥 CRIT! " : ""}Você atacou e causou ${oppDmg} em ${fight.name}.`;

      if (fight.hp <= 0) {
        await ctx.answerCbQuery("Derrota").catch(() => {});
        await finishFight(fight.opponentId, userId);
        return;
      }
    }

    await ctx.answerCbQuery().catch(() => {});
    await renderArenaStatus(userId, logMe, fight.opponentId, logOpp);
  }

  bot.action("arena_attack", async (ctx) => handleAction(ctx, "attack"));
  bot.action("arena_defend", async (ctx) => handleAction(ctx, "defend"));

  bot.action("arena_exit", async (ctx) => {
    const userId = String(ctx.from.id);
    const fight = arenaFights.get(userId);
    if (!fight) {
      if (ctx.callbackQuery) ctx.answerCbQuery("Sem luta").catch(() => {});
      return;
    }
    exitPrompts.set(userId, Date.now() + 30000);
    await ctx.reply("Deseja sair da arena?", {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("✅ Sim, desistir", "arena_exit_yes")],
        [Markup.button.callback("❌ Não", "arena_exit_no")],
      ]).reply_markup,
    });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("arena_exit_no", async (ctx) => {
    const userId = String(ctx.from.id);
    exitPrompts.delete(userId);
    await ctx.answerCbQuery("Continuando").catch(() => {});
  });

  bot.action("arena_exit_yes", async (ctx) => {
    const userId = String(ctx.from.id);
    const fight = arenaFights.get(userId);
    if (!fight) {
      if (ctx.callbackQuery) ctx.answerCbQuery("Sem luta").catch(() => {});
      return;
    }
    const expires = exitPrompts.get(userId) || 0;
    if (Date.now() > expires) {
      if (ctx.callbackQuery) ctx.answerCbQuery("Confirmação expirada").catch(() => {});
      return;
    }
    exitPrompts.delete(userId);
    await ctx.answerCbQuery("Desistiu").catch(() => {});
    await finishFight(fight.opponentId, userId, { surrender: true });
  });

  bot.action("arena_ranks_menu", async (ctx) => {
    const keyboard = ARENA_RANKS.map((r) => [Markup.button.callback(`${r.name} (${r.min}-${r.max === 999999 ? "∞" : r.max})`, `arena_rank_${r.key}`)]);
    keyboard.push([Markup.button.callback("🏟️ Arena", "arena_menu"), Markup.button.callback("🏠 Menu", "menu")]);
    const fileId = await getCoverImage("arena_ranks_cover");
    const caption =
      `📊 Ranks da Arena\n` +
      `• Sangue-Novo (0-199)\n` +
      `• Desafiador (200-599)\n` +
      `• Veterano (600-1199)\n` +
      `• Campeão (1200-1999)\n` +
      `• Lenda (2000+)\n` +
      `▲ Suba com troféus; derrotas retiram troféus.`;
    await sendCard(ctx, { fileId, caption, keyboard: Markup.inlineKeyboard(keyboard).reply_markup });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("arena_my_rank", async (ctx) => {
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);
    const rank = getRankByTrophies(player.trophies || 0);
    const fileId = await getRankImage(rank);
    const caption =
      `🏅 Seu Rank\n` +
      `${rank.name}\n` +
      `Troféus: ${player.trophies || 0}\n` +
      `Vitórias: ${player.arena_wins || 0} | Derrotas: ${player.arena_losses || 0}`;
    await sendCard(ctx, { fileId, caption, keyboard: [[Markup.button.callback("📊 Ranks", "arena_ranks_menu")], [Markup.button.callback("🏠 Menu", "menu")]] });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/arena_rank_(.+)/, async (ctx) => {
    const key = ctx.match[1];
    const rank = getRankByKey(key);
    if (!rank) {
      if (ctx.callbackQuery) ctx.answerCbQuery("Rank inválido").catch(() => {});
      return;
    }
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);
    const fileId = await getRankImage(rank);

    const topRes = await pool.query(
      `
      SELECT name, trophies, arena_wins, arena_losses
      FROM players
      WHERE trophies BETWEEN $1 AND $2
      ORDER BY trophies DESC, arena_wins DESC, arena_losses ASC
      LIMIT 9
    `,
      [rank.min, rank.max]
    );
    const posRes = await pool.query(
      `
      SELECT pos FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY trophies DESC, arena_wins DESC, arena_losses ASC) AS pos
        FROM players
        WHERE trophies BETWEEN $1 AND $2
      ) t WHERE id = $3
    `,
      [rank.min, rank.max, player.id]
    );

    const lines = topRes.rows.map((r, idx) => `${idx + 1} — ${r.trophies}🏆 ${r.name} [V${r.arena_wins || 0}/D${r.arena_losses || 0}]`);
    const pos = posRes.rows[0]?.pos;
    if (pos && pos > 9) {
      lines.push(`…`);
      lines.push(`Você: #${pos} — ${player.trophies}🏆 ${player.name} [V${player.arena_wins || 0}/D${player.arena_losses || 0}]`);
    }
    if (!pos) {
      lines.push(`Você não tem troféus neste rank.`);
    }

    const caption =
      `📊 ${rank.name}\n` +
      `Faixa: ${rank.min} - ${rank.max === 999999 ? "∞" : rank.max} troféus\n\n` +
      (lines.length ? lines.join("\n") : "Sem jogadores ainda.");

    await sendCard(ctx, {
      fileId,
      caption,
      keyboard: [
        [Markup.button.callback("⬅️ Ranks", "arena_ranks_menu")],
        [Markup.button.callback("🏟️ Arena", "arena_menu"), Markup.button.callback("🏠 Menu", "menu")],
      ],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("arena_chests", async (ctx) => {
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);
    const slotsUnlocked = unlockedSlots(player);
    const chests = await getChests(player.id);

    const lines = [
      "💰 Tesouros da Arena",
      "- Ganhe baús ao vencer.",
      "- Cada slot tem um timer; abra quando estiver pronto.",
      "- Sem espaço? vire VIP e ganhe espaços extras!",
      "- Recompensas: poções, chaves, gold/coins (varia pela raridade).",
      "",
    ];
    const keyboard = [];
    for (let i = 0; i < ARENA_MAX_SLOTS; i++) {
      const chest = chests.find((c) => c.slot === i && c.state !== "opened");
      if (i >= slotsUnlocked) {
        lines.push(`Slot ${i + 1}: 🔒 Bloqueado`);
        continue;
      }
      if (!chest) {
        lines.push(`Slot ${i + 1}: Vazio`);
        continue;
      }
      const ready = chest.unlock_at && new Date(chest.unlock_at) <= new Date();
      lines.push(chestLabel(chest));
      if (ready) keyboard.push([Markup.button.callback(`Abrir slot ${i + 1}`, `arena_chest_open:${chest.id}`)]);
    }

    keyboard.push([Markup.button.callback("🏟️ Arena", "arena_menu"), Markup.button.callback("🏠 Menu", "menu")]);
    await sendCard(ctx, {
      fileId: await getCoverImage("arena_chests_cover"),
      caption: `${lines.join("\n") || "Sem slots."}`,
      keyboard,
    });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/arena_chest_open:(.+)/, async (ctx) => {
    const chestId = ctx.match[1];
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    const res = await openChest(player, chestId);
    if (!res.ok) {
      await ctx.answerCbQuery(res.message, { show_alert: true }).catch(() => {});
      return;
    }
    await ctx.answerCbQuery("Tesouro aberto!").catch(() => {});
    await sendCard(ctx, {
      caption: `🎁 Tesouro aberto!\n${res.message}`,
      keyboard: [[Markup.button.callback("💰 Meus Tesouros", "arena_chests")], [Markup.button.callback("🏟️ Arena", "arena_menu")], [Markup.button.callback("🏠 Menu", "menu")]],
    });
  });
}
