import { Markup } from "telegraf";
import crypto from "crypto";

export function registerDungeon(bot, deps) {
  const {
    pool,
    getPlayer,
    getPlayerStats,
    setPlayerState,
    maybeDropItem,
    useConsumable,
    sendCard,
    getMapByKey,
    makeBar,
    rollDamage,
    hasItemQty,
    consumeItem,
    awardItem,
    STATES,
    getLevelFromTotalXp,
  } = deps;

  const SHOP_ONLY_KEYS = new Set(["elixir_xp", "elixir_drop", "energy_potion_pack"]);

  const sessions = new Map(); // code -> session
  const exitConfirmations = new Map(); // userId -> expires
  const pendingPasswords = new Map(); // userId -> { mode: 'create'|'join', code?, digits: '' }

  const TURN_TIMEOUT = 35000;
  const SOLO_XP_MULT = 0.7;
  const ACTION_ICONS = {
    attack: "⚔️",
    defend: "🛡️",
    cons: "🧪",
    wait: "⌛",
  };

  const FLOOR_SCALING = {
    1: { xpMult: 1.0, goldMult: 1.0, tierBonus: 0, mobHpMult: 1.0, mobAtkMult: 1.0 },
    2: { xpMult: 1.5, goldMult: 1.5, tierBonus: 0.5, mobHpMult: 1.3, mobAtkMult: 1.2 },
    3: { xpMult: 2.0, goldMult: 2.0, tierBonus: 1, mobHpMult: 1.6, mobAtkMult: 1.4 },
    4: { xpMult: 3.0, goldMult: 3.0, tierBonus: 1, mobHpMult: 2.5, mobAtkMult: 1.8 },
  };

  const DUNGEON_DEFS = {
    plains: { name: "Masmorra da Planície", rooms: 3, xp: [400, 500, 600, 900], key: "dungeon_key", boneChance: 0.01, imageKey: "dungeon_plains" },
    forest: { name: "Masmorra da Floresta", rooms: 3, xp: [600, 800, 1000, 1400], key: "dungeon_key", boneChance: 0.01, imageKey: "dungeon_forest" },
    swamp: { name: "Masmorra do Pântano", rooms: 3, xp: [900, 1100, 1300, 2200], key: "dungeon_key", boneChance: 0.01, imageKey: "dungeon_swamp" },
    special: { name: "Masmorra Especial", rooms: 3, xp: [1200, 1600, 2000, 3200], key: "bone_key", boneChance: 0.02, imageKey: "dungeon_special" },
  };

  function mapToDungeonKey(mapKey) {
    if (mapKey === "plains") return "plains";
    if (mapKey === "forest") return "forest";
    if (mapKey === "swamp") return "swamp";
    if (mapKey === "grave") return "special";
    return null;
  }

  function genCode() {
    return crypto.randomBytes(3).toString("hex").toUpperCase();
  }

  async function getDungeonImage(def) {
    if (!def?.imageKey) return null;
    const res = await pool.query("SELECT file_id FROM event_images WHERE event_key = $1", [def.imageKey]);
    return res.rows[0]?.file_id || null;
  }

  async function pickMobForDungeon(mapKey, preferBoss = false) {
    const res = await pool.query("SELECT * FROM mobs WHERE map_key = $1 AND key LIKE 'd_%'", [mapKey]);
    if (!res.rows.length) return null;
    const bosses = res.rows.filter((m) => (m.rarity || "").includes("boss"));
    if (preferBoss && bosses.length) return bosses[Math.floor(Math.random() * bosses.length)];
    const normals = res.rows.filter((m) => !(m.rarity || "").includes("boss"));
    const poolList = preferBoss || !normals.length ? bosses : normals;
    if (!poolList.length) return res.rows[0];
    return poolList[Math.floor(Math.random() * poolList.length)];
  }

  function scaleMobForFloor(baseMob, floor, partySize) {
    const scaling = FLOOR_SCALING[floor] || FLOOR_SCALING[1];
    const partyMult = 1 + 0.4 * Math.max(0, partySize - 1);
    return {
      name: baseMob.name,
      key: baseMob.key,
      hp: Math.max(1, Math.round(baseMob.hp * scaling.mobHpMult * partyMult)),
      hpMax: Math.max(1, Math.round(baseMob.hp * scaling.mobHpMult * partyMult)),
      atk: Math.max(1, Math.round(baseMob.atk * scaling.mobAtkMult)),
      def: baseMob.def || 0,
      rarity: baseMob.rarity || "common",
      image: baseMob.image_file_id,
      xp: baseMob.xp_gain || 0,
      gold: baseMob.gold_gain || 0,
    };
  }

  async function generateDungeonFloors(session) {
    session.floors = [];
    for (let floor = 1; floor <= 4; floor++) {
      const isBoss = floor === 4;
      const baseMob = await pickMobForDungeon(session.mapKey, isBoss);
      if (!baseMob) continue;
      const mob = scaleMobForFloor(baseMob, floor, session.members.size);
      session.floors.push({ number: floor, isBoss, mob, scaling: FLOOR_SCALING[floor] });
    }
  }

  async function ensureSession(ctx) {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    const map = await getMapByKey(player.current_map_key);
    const dungeonKey = mapToDungeonKey(map.key);
    const def = DUNGEON_DEFS[dungeonKey];
    if (!def) {
      await ctx.reply("Não há masmorra neste mapa.");
      return null;
    }
    const cover = await getDungeonImage(def);
    return { player, map, def, dungeonKey, cover };
  }

  function dungeonMenuKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback("➕ Criar sala", "d_create_options")],
      [Markup.button.callback("🔍 Buscar salas", "d_menu_browse")],
      [Markup.button.callback("🏠 Menu", "menu")],
    ]).reply_markup;
  }

  function renderLobby(session) {
    const lines = [];
    for (const uid of session.members) {
      const m = session.memberData.get(uid);
      lines.push(`${m.name}${session.ownerId === uid ? " (líder)" : ""}${m.ready ? " ✅" : ""}`);
    }
    return `🗝️ ${session.name}
Mapa: ${session.mapName}
Senha: ${session.password ? "definida" : "nenhuma"}
Membros (${session.members.size}/5):
${lines.join("\n")}
Comandos: Pronto/Despronto, Iniciar (líder)`;
  }

  async function sendLobby(session) {
    const kb = [
      [Markup.button.callback("✅ Pronto", `d_ready:${session.code}`), Markup.button.callback("❌ Despronto", `d_unready:${session.code}`)],
      [Markup.button.callback("🚀 Iniciar", `d_start:${session.code}`)],
      [Markup.button.callback("🏃 Sair", `d_leave:${session.code}`)],
    ];
    for (const uid of session.members) {
      await bot.telegram.sendMessage(uid, renderLobby(session), { reply_markup: Markup.inlineKeyboard(kb).reply_markup }).catch(() => {});
    }
  }

  async function createSession(ctx, password = null) {
    const base = await ensureSession(ctx);
    if (!base) return;
    const lvlInfo = await getLevelFromTotalXp(base.player.xp_total);
    if (base.def.key === "bone_key" && lvlInfo.level < 22) {
      await ctx.reply("🚫 Requer nível 22 para a Masmorra Especial.");
      return;
    }
    if (base.def.key === "bone_key") {
      if (!(await hasItemQty(base.player.id, "bone_key", 1))) {
        await ctx.reply("Você precisa de 1 Chave de Ossos para criar a Masmorra Especial.");
        return;
      }
    }
    const code = genCode();
    const stats = await getPlayerStats(base.player);
    const session = {
      code,
      name: base.def.name,
      mapKey: base.map.key,
      dungeonKey: base.dungeonKey,
      mapName: base.map.name,
      def: base.def,
      ownerId: String(ctx.from.id),
      members: new Set([String(ctx.from.id)]),
      memberData: new Map(),
      password,
      state: "lobby",
      currentFloor: 0,
      floors: [],
      playerActions: new Map(),
      turnTimer: null,
      turnStartTime: null,
      turnSeq: 0,
      renderChain: null,
      messageIds: new Map(),
      totalDrops: new Map(),
      mapImage: null,
      locked: false,
      bestDrop: null,
      consumablePrompts: new Map(),
      resolvingTurn: false,
      contributionAtk: new Map(),
      contributionDef: new Map(),
    };
    session.memberData.set(String(ctx.from.id), { name: base.player.name || "Aventureiro", ready: true, hp: base.player.hp, maxHp: stats.total_hp, alive: true, dmg: 0, contrib: 0 });
    sessions.set(code, session);
    await ctx.reply(`Dungeon criada: código ${code}. Compartilhe com o grupo.`);
    await sendLobby(session);
  }

  async function joinSession(ctx, code, password = null) {
    const session = sessions.get(code);
    if (!session) {
      await ctx.reply("Sala não encontrada.");
      return;
    }
    if (session.state === "running") {
      await ctx.reply("⚔️ Dungeon já iniciada!");
      return;
    }
    if (session.members.size >= 5) {
      await ctx.reply("Sala cheia.");
      return;
    }
    if (session.password && session.password !== password) {
      await ctx.reply("Sala protegida. Use /dungeon_join <código> <senha> ou clique novamente e digite a senha.");
      return;
    }
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);
    const stats = await getPlayerStats(player);
    session.members.add(userId);
    session.memberData.set(userId, { name: player.name || "Aventureiro", ready: true, hp: player.hp, maxHp: stats.total_hp, alive: true, dmg: 0, contrib: 0 });
    await ctx.reply(`Você entrou na dungeon ${session.name}.`);
    await sendLobby(session);
  }

  async function sendOrEditCard(userId, content, session) {
    const storedId = session.messageIds.get(userId);
    const kb = content.keyboard ? Markup.inlineKeyboard(content.keyboard).reply_markup : undefined;
    const opts = { parse_mode: "HTML" };
    if (kb) opts.reply_markup = kb;

    if (storedId) {
      try {
        if (content.fileId) {
          await bot.telegram.editMessageMedia(
            userId,
            storedId,
            undefined,
            {
              type: "photo",
              media: content.fileId,
              caption: content.caption,
              parse_mode: "HTML",
            },
            { reply_markup: kb }
          );
        } else {
          await bot.telegram.editMessageText(userId, storedId, undefined, content.caption, opts);
        }
        return storedId;
      } catch (err) {
        try {
          await bot.telegram.deleteMessage(userId, storedId);
        } catch (e) {
          // ignore
        }
      }
    }

    try {
      let sent;
      if (content.fileId) {
        sent = await bot.telegram.sendPhoto(userId, content.fileId, { caption: content.caption, ...opts });
      } else {
        sent = await bot.telegram.sendMessage(userId, content.caption, opts);
      }
      if (sent?.message_id) session.messageIds.set(userId, sent.message_id);
      return sent?.message_id;
    } catch (err) {
      console.error("sendOrEditCard error:", err.message);
      return null;
    }
  }

  function renderDungeonState(session) {
    const floor = session.floors[session.currentFloor];
    if (!floor) return { caption: "Dungeon encerrada.", keyboard: [[Markup.button.callback("🏠 Menu", "menu")]] };
    const mob = floor.mob;
    const remaining = session.turnStartTime ? Math.max(0, Math.ceil((TURN_TIMEOUT - (Date.now() - session.turnStartTime)) / 1000)) : TURN_TIMEOUT / 1000;
    const turnSeq = session.turnSeq || 0;
    const lines = [];
    lines.push(`🗝️ ${session.name}`);
    lines.push(`Sala ${floor.number}/4 ${floor.isBoss ? "👑 Boss" : ""}`);
    lines.push(`👹 ${mob.name}`);
    lines.push(`HP ${mob.hp}/${mob.hpMax} ${makeBar(mob.hp, mob.hpMax, 10)}`);
    lines.push("");
    lines.push("👥 Grupo:");
    for (const uid of session.members) {
      const m = session.memberData.get(uid);
      const act = session.playerActions.get(uid);
      const icon = act?.icon || ACTION_ICONS.wait;
      if (!m) continue;
      if (!m.alive) {
        lines.push(`💀 ${m.name}`);
      } else {
        lines.push(`${icon} ${m.name} ${makeBar(m.hp, m.maxHp || m.hp, 8)} ${m.hp}/${m.maxHp || m.hp} | Dano: ${m.dmg || 0}`);
      }
    }
    lines.push("");
    lines.push(`⏱️ Aguardando ações... (${remaining}s)`);
    if (session.lastEvents?.length) {
      lines.push("");
      lines.push("⚡ Resolução anterior:");
      session.lastEvents.forEach((ev) => lines.push(ev));
    }

    const keyboard = [
      [
        Markup.button.callback("⚔️ Atacar", `d_act:${session.code}:${turnSeq}:attack`),
        Markup.button.callback("🛡️ Defender", `d_act:${session.code}:${turnSeq}:defend`),
        Markup.button.callback("🧪 Consumíveis", `d_act:${session.code}:${turnSeq}:cons`),
      ],
      [Markup.button.callback("🚪 Sair", `d_exit_request:${session.code}`)],
    ];
    return { caption: lines.join("\n"), keyboard };
  }

  async function updateDungeonScreen(session) {
    session.renderChain = (session.renderChain || Promise.resolve())
      .then(async () => {
        const floor = session.floors[session.currentFloor];
        const content = renderDungeonState(session);
        const fileId = floor?.mob?.image || session.mapImage;
        const tasks = [...session.members].map((uid) => sendOrEditCard(uid, { ...content, fileId }, session));
        await Promise.all(tasks);
      })
      .catch((err) => {
        console.error("updateDungeonScreen error:", err.message);
      });
    return session.renderChain;
  }

  function clearTurnTimer(session) {
    if (session.turnTimer) {
      clearTimeout(session.turnTimer);
      session.turnTimer = null;
    }
  }

  async function deleteConsumablePrompt(session, uid) {
    const msgId = session.consumablePrompts?.get(uid);
    if (!msgId) return;
    try {
      await bot.telegram.deleteMessage(uid, msgId);
    } catch (e) {
      // ignore
    }
    session.consumablePrompts.delete(uid);
  }

  async function startNewTurn(session) {
    clearTurnTimer(session);
    session.resolvingTurn = false;
    session.playerActions = new Map();
    session.lastEvents = session.lastEvents || [];
    for (const uid of session.members) {
      await deleteConsumablePrompt(session, uid);
    }
    session.turnSeq = (session.turnSeq || 0) + 1;
    session.turnStartTime = Date.now();
    session.turnTimer = setTimeout(async () => {
      await autoResolveTurn(session);
    }, TURN_TIMEOUT);
    await updateDungeonScreen(session);
  }

  async function autoResolveTurn(session) {
    const floor = session.floors[session.currentFloor];
    if (!floor || session.state !== "running" || session.resolvingTurn) return;
    for (const uid of session.members) {
      const member = session.memberData.get(uid);
      if (!member?.alive) continue;
      if (!session.playerActions.has(uid)) {
        session.playerActions.set(uid, { action: "wait", icon: ACTION_ICONS.wait, auto: true });
      }
    }
    await updateDungeonScreen(session);
    await resolveCombatTurn(session);
  }

  async function applyGoldAndXp(playerId, gold, xp) {
    await pool.query("UPDATE players SET gold = gold + $1, xp_total = xp_total + $2 WHERE id = $3", [gold, xp, playerId]);
  }

  async function giveItemByKey(playerId, key, qty = 1) {
    const res = await pool.query("SELECT * FROM items WHERE key = $1 LIMIT 1", [key]);
    const row = res.rows[0];
    if (!row) return null;
    for (let i = 0; i < qty; i++) {
      await awardItem(playerId, row);
    }
    return row;
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getPlayerBuff(player) {
    if (!player?.temp_buff_expires_at) return { xp: 0, drop: 0 };
    const active = new Date(player.temp_buff_expires_at).getTime() > Date.now();
    if (!active) return { xp: 0, drop: 0 };
    return {
      xp: player.temp_xp_buff || 0,
      drop: player.temp_drop_buff || 0,
    };
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function defeatRoomMob(session, floorIndex) {
    const floor = session.floors[floorIndex];
    if (!floor) return;
    const mob = floor.mob;
    const aliveMembers = [...session.members].filter((uid) => session.memberData.get(uid)?.alive);
    const drops = new Map();
    const xpBase = session.def.xp[Math.min(floorIndex, session.def.xp.length - 1)] || 0;
    const xpTotal = Math.round(xpBase * (floor.scaling?.xpMult || 1) * (aliveMembers.length === 1 ? SOLO_XP_MULT : 1));
    const partyMult = 1 + 0.4 * Math.max(0, aliveMembers.length - 1);
    const isSpecial = session.dungeonKey === "special";

    // Contribuição separada para ataque/defesa
    const contribAtk = session.contributionAtk || new Map();
    const contribDef = session.contributionDef || new Map();
    let atkSum = 0;
    let defSum = 0;
    for (const uid of aliveMembers) {
      atkSum += contribAtk.get(uid) || 0;
      defSum += contribDef.get(uid) || 0;
    }
    const atkWeight = 0.7;
    const defWeight = 0.3;

    for (const uid of aliveMembers) {
      const member = session.memberData.get(uid);
      const player = await getPlayer(uid);
      const buff = getPlayerBuff(player);
      const atkShare = atkSum > 0 ? (contribAtk.get(uid) || 0) / atkSum : 0;
      const defShare = defSum > 0 ? (contribDef.get(uid) || 0) / defSum : 0;
      const weight = atkSum + defSum > 0 ? atkWeight * atkShare + defWeight * defShare : 1 / Math.max(1, aliveMembers.length);
      const xpShare = Math.max(1, Math.floor(xpTotal * weight));
      const xpShareBuffed = Math.round(xpShare * (1 + (buff.xp || 0) / 100));
      let gold = randInt(1, floor.isBoss ? 300 : 100);
      gold = Math.round(gold * (floor.scaling?.goldMult || 1) * partyMult);

      await applyGoldAndXp(player.id, gold, xpShareBuffed);
      const loot = { gold, xp: xpShareBuffed, items: [] };

      if (floor.isBoss) {
        const hpPotQty = randInt(1, 5);
        const dropEnergy = Math.random() < 0.5;
        const enPotQty = dropEnergy ? randInt(1, 2) : 0;
        const hpItem = await giveItemByKey(player.id, "health_potion", hpPotQty);
        const enItem = dropEnergy ? await giveItemByKey(player.id, "energy_potion", enPotQty) : null;
        if (hpItem) loot.items.push({ name: `${hpItem.name} x${hpPotQty}`, rarity: hpItem.rarity });
        if (enItem) loot.items.push({ name: `${enItem.name} x${enPotQty}`, rarity: enItem.rarity });

        const dropCount = randInt(1, 4);
        for (let i = 0; i < dropCount; i++) {
          const drop = await maybeDropItem(session.mapKey, Math.min(4, floorIndex + 2), true, { dungeon: true, playerClass: player.class, dropBonusPct: buff.drop || 0 });
          if (drop && !SHOP_ONLY_KEYS.has(drop.key)) {
            await awardItem(player.id, drop);
            loot.items.push(drop);
            if (!session.bestDrop || compareRarity(drop.rarity, session.bestDrop.rarity) > 0) {
              session.bestDrop = drop;
            }
          }
        }

        const boneChance = session.def.boneChance || 0.02;
        if (Math.random() < boneChance) {
          const bone = await giveItemByKey(player.id, "bone_key", 1);
          if (bone) loot.items.push(bone);
        }
        if (session.mapKey === "swamp" && Math.random() < 0.01) {
          const bone = await giveItemByKey(player.id, "bone_key", 1);
          if (bone) loot.items.push(bone);
        }
        if (isSpecial && Math.random() < 0.05) {
          const graveDrop = await maybeDropItem("grave", 3, true, { dungeon: true, playerClass: player.class, dropBonusPct: buff.drop || 0 });
          if (graveDrop && !SHOP_ONLY_KEYS.has(graveDrop.key)) {
            await awardItem(player.id, graveDrop);
            loot.items.push(graveDrop);
          }
        }
      } else {
        const drop = await maybeDropItem(session.mapKey, Math.min(3, floorIndex + 1 + (floor.scaling?.tierBonus || 0)), false, { dungeon: true, playerClass: player.class, dropBonusPct: buff.drop || 0 });
        if (drop && !SHOP_ONLY_KEYS.has(drop.key)) {
          await awardItem(player.id, drop);
          loot.items.push(drop);
        }
      }

      drops.set(uid, loot);
      session.totalDrops.set(uid, [...(session.totalDrops.get(uid) || []), loot]);
    }

    session.contributionAtk = new Map();
    session.contributionDef = new Map();
    session.messageIds = new Map(); // força novo card na próxima sala para manter ordem das mensagens
    await broadcastLoot(session, mob.name, drops, contribAtk, contribDef);
  }

  async function broadcastLoot(session, mobName, drops, contribAtk = new Map(), contribDef = new Map()) {
    const topAtk = [...contribAtk.entries()]
      .map(([uid, val]) => ({ uid, val }))
      .filter((entry) => entry.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 1);
    const topDef = [...contribDef.entries()]
      .map(([uid, val]) => ({ uid, val }))
      .filter((entry) => entry.val > 0)
      .sort((a, b) => b.val - a.val)
      .slice(0, 1);

    let msg = `💀 <b>${mobName}</b> derrotado!\n\n🎁 <b>Recompensas:</b>\n\n`;
    for (const [uid, loot] of drops) {
      const member = session.memberData.get(uid);
      msg += `👤 ${member?.name || uid}\n`;
      msg += `   💰 ${loot.gold} gold\n`;
      msg += `   ⭐ ${loot.xp} XP\n`;
      if (loot.items.length === 0) {
        msg += "   ⚪ Nenhum item\n";
      } else {
        for (const item of loot.items) {
          const rarityIcon = {
            common: "🟢",
            uncommon: "🔵",
            rare: "🟣",
            epic: "🟡",
            legendary: "🟠",
          };
          const icon = rarityIcon[item.rarity] || "⚪";
          msg += `   ${icon} ${item.name}\n`;
        }
      }
      msg += "\n";
    }
    if (topAtk.length || topDef.length) {
      msg += "🏅 Destaques:\n";
      if (topAtk.length) {
        const entry = topAtk[0];
        const name = session.memberData.get(entry.uid)?.name || entry.uid;
        msg += `⚔️ Top ATK: ${name} (${entry.val} dano)\n`;
      }
      if (topDef.length) {
        const entry = topDef[0];
        const name = session.memberData.get(entry.uid)?.name || entry.uid;
        msg += `🛡️ Top DEF: ${name} (${entry.val} defesa)\n`;
      }
      msg += "\n";
    }
    for (const uid of session.members) {
      await bot.telegram.sendMessage(uid, msg, { parse_mode: "HTML" }).catch(() => {});
    }
  }

  function compareRarity(a, b) {
    const order = ["common", "uncommon", "rare", "epic", "legendary"];
    return order.indexOf(a || "common") - order.indexOf(b || "common");
  }

  async function finishDungeon(session) {
    clearTurnTimer(session);
    for (const uid of session.members) {
      await deleteConsumablePrompt(session, uid);
    }
    session.state = "finished";
    const summary = [];
    for (const uid of session.members) {
      const player = await getPlayer(uid);
      const member = session.memberData.get(uid) || {};
      if (!member.alive) {
        const penalty = Math.round((session.def.xp[session.def.xp.length - 1] || 0) * 0.3);
        await pool.query("UPDATE players SET xp_total = GREATEST(0, xp_total - $1) WHERE id = $2", [penalty, player.id]);
      }
      summary.push({
        uid,
        name: member.name || player.name || "Aventureiro",
        dmg: member.dmg || 0,
        alive: member.alive !== false,
      });
      await setPlayerState(player.id, STATES.MENU);
    }

    summary.sort((a, b) => b.dmg - a.dmg);
    const lines = ["🏆 Dungeon concluída!", "📊 Ranking de dano:"];
    summary.forEach((s, idx) => {
      lines.push(`${idx + 1}. ${s.name} — dano: ${s.dmg} ${s.alive ? "" : "(💀)"}`);
    });
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]).reply_markup;
    const photo = session.bestDrop?.image_file_id || session.mapImage;
    for (const uid of session.members) {
      if (photo) {
        await bot.telegram.sendPhoto(uid, photo, { caption: lines.join("\n"), reply_markup: keyboard }).catch(() => {});
      } else {
        await bot.telegram.sendMessage(uid, lines.join("\n"), { reply_markup: keyboard }).catch(() => {});
      }
    }
    sessions.delete(session.code);
  }

  async function resolveCombatTurn(session) {
    if (session.resolvingTurn) return;
    session.resolvingTurn = true;
    const floor = session.floors[session.currentFloor];
    if (!floor || session.state !== "running") return;
    clearTurnTimer(session);
    const mob = floor.mob;
    const aliveMembers = [...session.members].filter((uid) => session.memberData.get(uid)?.alive);
    if (!aliveMembers.length) {
      session.state = "finished";
      for (const uid of session.members) {
        const player = await getPlayer(uid);
        await setPlayerState(player.id, STATES.MENU);
      }
      sessions.delete(session.code);
      return;
    }

    let totalDmg = 0;
    const defenders = [];
    const turnEvents = [];
    for (const uid of aliveMembers) {
      const action = session.playerActions.get(uid) || { action: "wait" };
      const player = await getPlayer(uid);
      const stats = await getPlayerStats(player);
      if (action.action === "attack") {
        const dmg = rollDamage(stats.total_atk, mob.def, Math.random() * 100 < stats.total_crit);
        totalDmg += dmg;
        const md = session.memberData.get(uid);
        md.dmg = (md.dmg || 0) + dmg;
        md.contrib = (md.contrib || 0) + dmg;
        session.memberData.set(uid, md);
        session.contributionAtk.set(uid, (session.contributionAtk.get(uid) || 0) + dmg);
        turnEvents.push(`⚔️ ${md.name} causa ${dmg} em ${mob.name}`);
      } else if (action.action === "defend") {
        defenders.push({ uid, defBonus: action.defBonus || 0 });
        const md = session.memberData.get(uid);
        // crédito de defesa conta para XP, mesmo se o mob não bater nele
        session.contributionDef.set(uid, (session.contributionDef.get(uid) || 0) + (action.defBonus || 0));
        turnEvents.push(`🛡️ ${md.name} defende (+${action.defBonus || 0} DEF)`);
      } else if (action.action === "cons" && action.itemKey) {
        await useConsumable(player, action.itemKey);
        const md = session.memberData.get(uid);
        turnEvents.push(`🧪 ${md.name} usa consumível`);
      } else if (action.action === "cons_pending") {
        const md = session.memberData.get(uid);
        turnEvents.push(`⌛ ${md.name} perdeu a vez`);
      } else if (action.action === "wait") {
        const md = session.memberData.get(uid);
        turnEvents.push(`⌛ ${md.name} perdeu a vez`);
      }
    }

    mob.hp = Math.max(0, mob.hp - totalDmg);

    if (mob.hp > 0) {
      const targetPool = defenders.length ? defenders.map((d) => d.uid) : aliveMembers;
      const targetId = targetPool[Math.floor(Math.random() * targetPool.length)];
      const targetDefBonus = defenders.find((d) => d.uid === targetId)?.defBonus || 0;
      const targetPlayer = await getPlayer(targetId);
      const targetStats = await getPlayerStats(targetPlayer);
      const dmgBase = rollDamage(mob.atk, targetStats.total_def, false);
      const dmg = rollDamage(mob.atk, targetStats.total_def + targetDefBonus, false);
      const mitigated = Math.max(0, dmgBase - dmg);
      const newHp = Math.max(0, targetPlayer.hp - dmg);
      await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [newHp, targetPlayer.id]);
      const md = session.memberData.get(targetId);
      md.hp = newHp;
      if (newHp <= 0) md.alive = false;
      session.memberData.set(targetId, md);
      if (mitigated > 0) session.contributionDef.set(targetId, (session.contributionDef.get(targetId) || 0) + mitigated);
      turnEvents.push(`💥 ${mob.name} causa ${dmg} em ${md.name}`);
    }

    session.lastEvents = turnEvents.slice(-6);
    session.playerActions.clear();

    if (mob.hp <= 0) {
      await defeatRoomMob(session, session.currentFloor);
      await waitMs(1200);
      session.currentFloor += 1;
      if (session.currentFloor >= session.floors.length) {
        await finishDungeon(session);
      } else {
        await startNewTurn(session);
      }
    } else {
      await startNewTurn(session);
    }
    if (session.state === "running") session.resolvingTurn = false;
  }

  async function startSession(ctx, code) {
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery("Sala inexistente").catch(() => {});
    if (session.ownerId !== String(ctx.from.id)) return ctx.answerCbQuery("Apenas o líder inicia").catch(() => {});
    if (session.state !== "lobby") return ctx.answerCbQuery("Já iniciada").catch(() => {});
    if (session.members.size === 0) return ctx.answerCbQuery("Sem membros").catch(() => {});

    const leader = await getPlayer(session.ownerId);
    const leaderHasKey = await hasItemQty(leader.id, session.def.key, 1);
    if (!leaderHasKey) {
      await ctx.reply(`O líder precisa de 1 ${session.def.key} para iniciar.`);
      return;
    }
    await consumeItem(leader.id, session.def.key, 1);

    session.mapImage = await getDungeonImage(session.def);
    session.state = "running";
    session.locked = true;
    session.currentFloor = 0;
    session.playerActions = new Map();
    session.totalDrops = new Map();
    session.contributionAtk = new Map();
    session.contributionDef = new Map();
    session.turnTimer = null;
    for (const uid of session.members) {
      const player = await getPlayer(uid);
      await setPlayerState(player.id, STATES.DUNGEON);
    }
    await generateDungeonFloors(session);
    await ctx.answerCbQuery().catch(() => {});
    await startNewTurn(session);
  }

  // Handlers
  async function showDungeonMenu(ctx, base) {
    const text = `🗝️ ${base.def.name}\nMapa: ${base.map.name}\n\nCrie uma sala para seu grupo ou entre com o código de um amigo.`;
    const keyboard = dungeonMenuKeyboard();
    if (base.cover) {
      await bot.telegram.sendPhoto(ctx.chat.id, base.cover, { caption: text, reply_markup: keyboard, parse_mode: "Markdown" });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }

  bot.command("dungeon", async (ctx) => {
    const base = await ensureSession(ctx);
    if (!base) return;
    await showDungeonMenu(ctx, base);
  });

  bot.action("dungeon_menu", async (ctx) => {
    const base = await ensureSession(ctx);
    if (!base) {
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    await showDungeonMenu(ctx, base);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  function pwdKeyboard(currentDigits = "", backAction = "dungeon_menu") {
    const label = currentDigits.padEnd(4, "_");
    const rows = [
      [Markup.button.callback("1", "d_pwd_digit:1"), Markup.button.callback("2", "d_pwd_digit:2"), Markup.button.callback("3", "d_pwd_digit:3")],
      [Markup.button.callback("4", "d_pwd_digit:4"), Markup.button.callback("5", "d_pwd_digit:5"), Markup.button.callback("6", "d_pwd_digit:6")],
      [Markup.button.callback("7", "d_pwd_digit:7"), Markup.button.callback("8", "d_pwd_digit:8"), Markup.button.callback("9", "d_pwd_digit:9")],
      [Markup.button.callback("0", "d_pwd_digit:0"), Markup.button.callback("⬅️ Sair", backAction)],
    ];
    return { label, keyboard: rows };
  }

  function resetPwd(userId) {
    pendingPasswords.delete(userId);
  }

  bot.command("dungeon_create", async (ctx) => {
    await createSession(ctx);
  });

  bot.action("d_create_options", async (ctx) => {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback("🔓 Aberta", "d_create_open")],
      [Markup.button.callback("🔒 Com senha", "d_create_pwd")],
      [Markup.button.callback("🏠 Menu", "dungeon_menu")],
    ]).reply_markup;
    await ctx.reply("Como deseja criar a sala?", { reply_markup: kb });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("d_create_open", async (ctx) => {
    await createSession(ctx);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("d_create_pwd", async (ctx) => {
    const userId = String(ctx.from.id);
    pendingPasswords.set(userId, { mode: "create", digits: "" });
    const pad = pwdKeyboard("", "dungeon_menu");
    await ctx.reply(`Defina a senha (4 dígitos)\nSenha: ${pad.label}`, { reply_markup: Markup.inlineKeyboard(pad.keyboard).reply_markup });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("d_menu_browse", async (ctx) => {
    const base = await ensureSession(ctx);
    if (!base) {
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    const available = [...sessions.values()].filter((s) => s.state === "lobby" && s.mapKey === base.map.key);
    if (!available.length) {
      await ctx.reply("Nenhuma sala disponível neste mapa. Crie uma sala ou tente mais tarde.", { reply_markup: dungeonMenuKeyboard() });
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    const buttons = available.map((s) => {
      const label = `${s.password ? "🔒 " : ""}${s.name} | ${s.members.size}/5 | ${s.code}`;
      return [Markup.button.callback(label, `d_join:${s.code}`)];
    });
    buttons.push([Markup.button.callback("⬅️ Voltar", "dungeon_menu")]);
    await ctx.reply("Salas disponíveis:", { reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.command("dungeon_join", async (ctx) => {
    const parts = (ctx.message.text || "").split(" ").filter(Boolean);
    const code = parts[1];
    const pwd = parts[2] || null;
    if (!code) return ctx.reply("Use /dungeon_join <código> [senha]");
    await joinSession(ctx, code.trim().toUpperCase(), pwd);
  });

  bot.action("d_menu_join", async (ctx) => {
    await ctx.reply("Digite: /dungeon_join <código>");
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_join:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (session?.password) {
      const userId = String(ctx.from.id);
      pendingPasswords.set(userId, { mode: "join", code, digits: "" });
      const pad = pwdKeyboard("", "dungeon_menu");
      await ctx.reply(`Sala protegida.\nDigite a senha para entrar\nSenha: ${pad.label}`, { reply_markup: Markup.inlineKeyboard(pad.keyboard).reply_markup });
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    await joinSession(ctx, code);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/d_pwd_digit:(\d)/, async (ctx) => {
    const digit = ctx.match[1];
    const userId = String(ctx.from.id);
    const pending = pendingPasswords.get(userId);
    if (!pending) {
      await ctx.answerCbQuery("Nenhuma senha em andamento").catch(() => {});
      return;
    }
    const digits = (pending.digits || "") + digit;
    if (digits.length < 4) {
      pending.digits = digits;
      pendingPasswords.set(userId, pending);
      const pad = pwdKeyboard(digits, "dungeon_menu");
      await ctx.editMessageText(`Senha: ${pad.label}`, { reply_markup: Markup.inlineKeyboard(pad.keyboard).reply_markup }).catch(async () => {
        await ctx.reply(`Senha: ${pad.label}`, { reply_markup: Markup.inlineKeyboard(pad.keyboard).reply_markup });
      });
      await ctx.answerCbQuery().catch(() => {});
      return;
    }
    // complete
    pending.digits = digits.slice(0, 4);
    const code = pending.code;
    const mode = pending.mode;
    resetPwd(userId);
    if (mode === "create") {
      await createSession(ctx, pending.digits);
      await ctx.answerCbQuery("Sala criada com senha").catch(() => {});
      return;
    }
    if (mode === "join" && code) {
      const session = sessions.get(code);
      if (!session) {
        await ctx.reply("Sala não encontrada.").catch(() => {});
        return;
      }
      if (session.password !== pending.digits) {
        await ctx.reply("Senha incorreta.").catch(() => {});
        return;
      }
      await joinSession(ctx, code, pending.digits);
      await ctx.answerCbQuery("Entrou na sala").catch(() => {});
      return;
    }
  });

  bot.action(/^d_ready:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery("Sala não existe").catch(() => {});
    const userId = String(ctx.from.id);
    const m = session.memberData.get(userId);
    if (m) m.ready = true;
    await sendLobby(session);
    await ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_unready:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery("Sala não existe").catch(() => {});
    const userId = String(ctx.from.id);
    const m = session.memberData.get(userId);
    if (m) m.ready = false;
    await sendLobby(session);
    await ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_start:(.+)$/, async (ctx) => startSession(ctx, ctx.match[1]));

  bot.action(/^d_exit_request:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const userId = String(ctx.from.id);
    exitConfirmations.set(userId, Date.now() + 30000);
    await ctx.answerCbQuery();
    await ctx.reply(
      "⚠️ <b>CONFIRMAR SAÍDA</b>\n\n❌ Você perderá:\n• Progresso da dungeon\n• XP e gold não coletados\n• Drops de salas anteriores\n\n🤔 Tem certeza?",
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("✅ Sim, sair", `d_exit_yes:${code}`), Markup.button.callback("❌ Cancelar", "d_exit_no")],
        ]).reply_markup,
      }
    );
  });

  bot.action(/^d_exit_yes:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const userId = String(ctx.from.id);
    if (!exitConfirmations.has(userId)) {
      return ctx.answerCbQuery("⏱️ Confirmação expirou");
    }
    exitConfirmations.delete(userId);
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery("Sala não existe");
    session.members.delete(userId);
    session.memberData.delete(userId);
    session.messageIds.delete(userId);
    const exiting = await getPlayer(userId);
    await setPlayerState(exiting.id, STATES.MENU);
    await ctx.answerCbQuery("👋 Você saiu da dungeon");
    try {
      await ctx.deleteMessage();
    } catch (e) {
      // ignore
    }
    await bot.telegram
      .sendMessage(userId, "Você saiu da masmorra.", { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]).reply_markup })
      .catch(() => {});
    if (session.ownerId === userId) {
      const next = [...session.members][0];
      if (next) session.ownerId = next;
    }
    if (session.members.size === 0) {
      sessions.delete(code);
    } else {
      if (session.state === "running") await updateDungeonScreen(session);
      else await sendLobby(session);
    }
  });

  bot.action("d_exit_no", async (ctx) => {
    await ctx.deleteMessage().catch(() => {});
    await ctx.answerCbQuery("✅ Continuando na dungeon");
  });

  bot.action(/^d_leave:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery().catch(() => {});
    const uid = String(ctx.from.id);
    session.members.delete(uid);
    session.memberData.delete(uid);
    session.messageIds.delete(uid);
    const leaving = await getPlayer(uid);
    await setPlayerState(leaving.id, STATES.MENU);
    await ctx.answerCbQuery("Saiu").catch(() => {});
    await bot.telegram
      .sendMessage(uid, "Você saiu da masmorra.", { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]).reply_markup })
      .catch(() => {});
    if (session.ownerId === uid) {
      const next = [...session.members][0];
      if (next) session.ownerId = next;
    }
    if (session.members.size === 0) {
      sessions.delete(code);
    } else {
      await sendLobby(session);
    }
  });

  bot.action(/^d_act:([^:]+):(?:(\d+):)?(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const turn = ctx.match[2] ? Number(ctx.match[2]) : null;
    const act = ctx.match[3];
    const session = sessions.get(code);
    if (!session || session.state !== "running") return ctx.answerCbQuery("Sala indisponível").catch(() => {});
    const uid = String(ctx.from.id);
    if (!session.members.has(uid)) return ctx.answerCbQuery("Você não está na sala").catch(() => {});
    if (!session.memberData.get(uid)?.alive) return ctx.answerCbQuery("Você está morto").catch(() => {});
    if (!turn || turn !== (session.turnSeq || 0)) {
      return ctx.answerCbQuery("⏱️ Turno expirou", { show_alert: true }).catch(() => {});
    }
    if (session.resolvingTurn) {
      return ctx.answerCbQuery("⏳ Turno resolvendo", { show_alert: true }).catch(() => {});
    }

    if (session.playerActions.has(uid)) return ctx.answerCbQuery("⏳ Aguarde o turno resolver").catch(() => {});

    if (act === "cons") {
      session.playerActions.set(uid, { action: "cons_pending", icon: ACTION_ICONS.cons });
      const player = await getPlayer(uid);
      const items = await pool.query(
        `SELECT inv.item_key, SUM(inv.qty)::int AS qty, i.name FROM inventory inv JOIN items i ON i.key = inv.item_key WHERE inv.player_id = $1 AND inv.slot = 'consumable' AND inv.qty > 0 GROUP BY inv.item_key, i.name ORDER BY i.name`,
        [player.id]
      );
      if (!items.rows.length) {
        session.playerActions.delete(uid);
        await ctx.answerCbQuery("Sem consumíveis").catch(() => {});
        await updateDungeonScreen(session);
        return;
      }
      const turnSeq = session.turnSeq || 0;
      const kb = items.rows.map((it) => [Markup.button.callback(`${it.name} (${it.qty})`, `d_use:${code}:${turnSeq}:${it.item_key}`)]);
      await deleteConsumablePrompt(session, uid);
      const sent = await ctx.reply("🧪 Escolha um consumível (gasta o turno):", { reply_markup: Markup.inlineKeyboard(kb).reply_markup });
      if (sent?.message_id) session.consumablePrompts.set(uid, sent.message_id);
      await ctx.answerCbQuery().catch(() => {});
      await updateDungeonScreen(session);
      return;
    }

    if (act === "defend") {
      const hasShield = await pool.query(
        `
    SELECT i.name, inv.rolled_def
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    WHERE inv.player_id = (SELECT id FROM players WHERE telegram_id = $1)
      AND inv.equipped = TRUE
      AND i.slot = 'shield'
    LIMIT 1
  `,
        [uid]
      );
      if (hasShield.rows.length === 0) {
        return ctx.answerCbQuery("❌ Você precisa de um ESCUDO equipado para defender!", { show_alert: true });
      }
      const shield = hasShield.rows[0];
      const player = await getPlayer(uid);
      const stats = await getPlayerStats(player);
      const defBonus = Math.max(1, Math.floor(stats.total_def * 0.5));
      session.playerActions.set(uid, { action: "defend", icon: ACTION_ICONS.defend, defBonus });
      await ctx.answerCbQuery("🛡️ Defendendo! (+50% DEF)").catch(() => {});
      await updateDungeonScreen(session);
      if (session.playerActions.size >= aliveCount(session) && !session.resolvingTurn) await resolveCombatTurn(session);
      return;
    }

    session.playerActions.set(uid, { action: "attack", icon: ACTION_ICONS.attack });
    await ctx.answerCbQuery("Ação registrada").catch(() => {});
    await updateDungeonScreen(session);

    if (session.playerActions.size >= aliveCount(session) && !session.resolvingTurn) {
      await resolveCombatTurn(session);
    }
  });

  bot.action(/^d_use:([^:]+):(?:(\d+):)?(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const turn = ctx.match[2] ? Number(ctx.match[2]) : null;
    const itemKey = ctx.match[3];
    const session = sessions.get(code);
    if (!session || session.state !== "running") return ctx.answerCbQuery("Sala indisponível").catch(() => {});
    const uid = String(ctx.from.id);
    if (!session.members.has(uid)) return ctx.answerCbQuery("Você não está na sala").catch(() => {});
    if (!turn || turn !== (session.turnSeq || 0)) {
      return ctx.answerCbQuery("⏱️ Turno expirou", { show_alert: true }).catch(() => {});
    }
    if (session.resolvingTurn) {
      return ctx.answerCbQuery("⏳ Turno resolvendo", { show_alert: true }).catch(() => {});
    }
    const currentAction = session.playerActions.get(uid);
    if (currentAction && currentAction.action !== "cons_pending") {
      return ctx.answerCbQuery("⏳ Você já escolheu").catch(() => {});
    }
    const player = await getPlayer(uid);
    const result = await useConsumable(player, itemKey);
    if (!result.ok) {
      await ctx.answerCbQuery(result.message || "Não foi possível usar.").catch(() => {});
      return;
    }
    const refreshed = await getPlayer(uid);
    const stats = await getPlayerStats(refreshed);
    const md = session.memberData.get(uid);
    if (md) {
      md.hp = refreshed.hp;
      md.maxHp = stats.total_hp;
      session.memberData.set(uid, md);
    }
    await deleteConsumablePrompt(session, uid);
    session.playerActions.set(uid, { action: "cons", icon: ACTION_ICONS.cons, itemKey });
    await ctx.answerCbQuery("Consumido").catch(() => {});
    await updateDungeonScreen(session);
    if (session.playerActions.size >= aliveCount(session) && !session.resolvingTurn) {
      await resolveCombatTurn(session);
    }
  });

  function aliveCount(session) {
    return [...session.members].filter((id) => session.memberData.get(id)?.alive).length;
  }
}
