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
  } = deps;

  const sessions = new Map(); // code -> session

  const DUNGEON_DEFS = {
    plains: { name: "Masmorra da Planície", rooms: 3, xp: [400, 500, 600, 900], key: "dungeon_key", boneChance: 0.01, imageKey: "dungeon_plains" },
    forest: { name: "Masmorra da Floresta", rooms: 3, xp: [600, 800, 1000, 1400], key: "dungeon_key", boneChance: 0.01, imageKey: "dungeon_forest" },
    swamp: { name: "Masmorra do Pântano", rooms: 3, xp: [900, 1100, 1300, 2200], key: "dungeon_key", boneChance: 0.015, imageKey: "dungeon_swamp" },
    special: { name: "Masmorra Especial", rooms: 3, xp: [1200, 1600, 2000, 3200], key: "bone_key", boneChance: 0.1, imageKey: "dungeon_special" },
  };

  function mapToDungeonKey(mapKey) {
    if (mapKey === "plains") return "plains";
    if (mapKey === "forest") return "forest";
    if (mapKey === "swamp") return "swamp";
    return "special";
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
    const bosses = res.rows.filter((m) => (m.rarity || '').includes('boss'));
    if (preferBoss && bosses.length) return bosses[Math.floor(Math.random() * bosses.length)];
    const normals = res.rows.filter((m) => !(m.rarity || '').includes('boss'));
    const poolList = preferBoss || !normals.length ? bosses : normals;
    if (!poolList.length) return res.rows[0];
    return poolList[Math.floor(Math.random() * poolList.length)];
  }

  function scaleMob(mob, playersCount, isBoss) {
    const hpMult = isBoss ? 2.2 : 1.8;
    const atkMult = isBoss ? 1.5 : 1.3;
    const partyMult = 1 + 0.4 * Math.max(0, playersCount - 1);
    return {
      name: mob.name,
      key: mob.key,
      hp: Math.max(1, Math.round(mob.hp * hpMult * partyMult)),
      hpMax: Math.max(1, Math.round(mob.hp * hpMult * partyMult)),
      atk: Math.max(1, Math.round(mob.atk * atkMult)),
      def: mob.def || 0,
      rarity: mob.rarity || 'common',
      image: mob.image_file_id,
      xp: mob.xp_gain || 0,
      gold: mob.gold_gain || 0,
    };
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
      [Markup.button.callback('➕ Criar sala', 'd_menu_create')],
      [Markup.button.callback('🔍 Buscar salas', 'd_menu_browse')],
      [Markup.button.callback('🏠 Menu', 'menu')],
    ]).reply_markup;
  }

  function renderLobby(session) {
    const lines = [];
    for (const uid of session.members) {
      const m = session.memberData.get(uid);
      lines.push(`${m.name}${session.ownerId === uid ? ' (líder)' : ''}${m.ready ? ' ✅' : ''}`);
    }
    return `🗝️ ${session.name}
Mapa: ${session.mapName}
Membros (${session.members.size}/5):
${lines.join('\n')}
Comandos: Pronto/Despronto, Iniciar (líder)`;
  }

  async function sendLobby(session) {
    const kb = [
      [Markup.button.callback('✅ Pronto', `d_ready:${session.code}`), Markup.button.callback('❌ Despronto', `d_unready:${session.code}`)],
      [Markup.button.callback('🚀 Iniciar', `d_start:${session.code}`)],
      [Markup.button.callback('🏃 Sair', `d_leave:${session.code}`)],
    ];
    for (const uid of session.members) {
      await bot.telegram.sendMessage(uid, renderLobby(session), { reply_markup: Markup.inlineKeyboard(kb).reply_markup });
    }
  }

  async function createSession(ctx) {
    const base = await ensureSession(ctx);
    if (!base) return;
    const code = genCode();
    const stats = await getPlayerStats(base.player);
    const session = {
      code,
      name: base.def.name,
      mapKey: base.map.key,
      mapName: base.map.name,
      def: base.def,
      ownerId: String(ctx.from.id),
      members: new Set([String(ctx.from.id)]),
      memberData: new Map(),
      state: 'lobby',
      roomIndex: 0,
      rooms: [],
      actions: new Map(),
      log: [],
    };
    session.memberData.set(String(ctx.from.id), { name: base.player.name || 'Aventureiro', ready: true, hp: base.player.hp, maxHp: stats.total_hp, alive: true, dmg: 0 });
    sessions.set(code, session);
    await ctx.reply(`Dungeon criada: código ${code}. Compartilhe com o grupo.`);
    await sendLobby(session);
  }

  async function joinSession(ctx, code) {
    const session = sessions.get(code);
    if (!session) {
      await ctx.reply('Sala não encontrada.');
      return;
    }
    if (session.members.size >= 5) {
      await ctx.reply('Sala cheia.');
      return;
    }
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);
    const stats = await getPlayerStats(player);
    session.members.add(userId);
    session.memberData.set(userId, { name: player.name || 'Aventureiro', ready: true, hp: player.hp, maxHp: stats.total_hp, alive: true, dmg: 0 });
    await ctx.reply(`Você entrou na dungeon ${session.name}.`);
    await sendLobby(session);
  }

  async function startSession(ctx, code) {
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery('Sala inexistente').catch(() => {});
    if (session.ownerId !== String(ctx.from.id)) return ctx.answerCbQuery('Apenas o líder inicia').catch(() => {});
    if (session.state !== 'lobby') return ctx.answerCbQuery('Já iniciada').catch(() => {});
    if (session.members.size === 0) return ctx.answerCbQuery('Sem membros').catch(() => {});

    // Apenas o líder precisa da chave
    const leader = await getPlayer(session.ownerId);
    const leaderHasKey = await hasItemQty(leader.id, session.def.key, 1);
    if (!leaderHasKey) {
      await ctx.reply(`O líder precisa de 1 ${session.def.key} para iniciar.`);
      return;
    }
    await consumeItem(leader.id, session.def.key, 1);

    // Monta salas
    session.rooms = [];
    for (let i = 0; i < session.def.rooms; i++) {
      const mob = await pickMobForDungeon(session.mapKey, false);
      if (!mob) continue;
      session.rooms.push(scaleMob(mob, session.members.size, false));
    }
    const bossMob = await pickMobForDungeon(session.mapKey, true) || session.rooms[session.rooms.length - 1];
    session.boss = scaleMob(bossMob, session.members.size, true);
    session.mapImage = await getDungeonImage(session.def);
    session.state = 'running';
    session.roomIndex = 0;
    session.actions.clear();
    await broadcastState(session, 'Dungeon iniciada!');
    await renderRoom(session);
    await ctx.answerCbQuery().catch(() => {});
  }

  async function broadcastState(session, msg) {
    for (const uid of session.members) {
      await bot.telegram.sendMessage(uid, msg).catch(() => {});
    }
  }

  function roomCaption(session, room, isBoss) {
    const lines = [
      `${isBoss ? '👑 Boss' : '👹 Mob'}: ${room.name}`,
      `HP ${room.hp}/${room.hpMax} ${makeBar(room.hp, room.hpMax, 10)}`,
      `Sala ${isBoss ? 'Boss' : session.roomIndex + 1}/${session.def.rooms}`,
      '👥 Membros:',
      ...[...session.members].map((uid) => {
        const m = session.memberData.get(uid);
        if (!m) return uid;
        if (!m.alive) return `${m.name} (💀)`;
        return `${m.name} ${makeBar(m.hp, m.maxHp || m.hp, 8)} ${m.hp}/${m.maxHp || m.hp} | Dano: ${m.dmg || 0}`;
      }),
    ];
    return lines.join('\n');
  }

  function combatKeyboard(code) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('⚔️ Atacar', `d_act:${code}:attack`), Markup.button.callback('🛡️ Defender', `d_act:${code}:defend`), Markup.button.callback('🧪 Consumíveis', `d_act:${code}:cons`)],
      [Markup.button.callback('🏃 Sair', `d_leave:${code}`)],
    ]).reply_markup;
  }

  async function renderRoom(session) {
    const isBoss = session.roomIndex >= session.def.rooms;
    const room = isBoss ? session.boss : session.rooms[session.roomIndex];
    if (!room) return;
    const caption = roomCaption(session, room, isBoss);
    const keyboard = combatKeyboard(session.code);
    for (const uid of session.members) {
      const fileId = room.image || session.mapImage;
      try {
        if (fileId) {
          await bot.telegram.sendPhoto(uid, fileId, { caption, reply_markup: keyboard, parse_mode: "Markdown" });
        } else {
          await bot.telegram.sendMessage(uid, caption, { reply_markup: keyboard, parse_mode: "Markdown" });
        }
      } catch (e) {
        await bot.telegram.sendMessage(uid, caption, { reply_markup: keyboard, parse_mode: "Markdown" }).catch(() => {});
      }
    }
  }

  async function resolveActions(session) {
    const isBoss = session.roomIndex >= session.def.rooms;
    const room = isBoss ? session.boss : session.rooms[session.roomIndex];
    if (!room) return;

    // Coleta stats dos membros vivos
    const aliveMembers = [...session.members].filter((uid) => session.memberData.get(uid)?.alive);
    if (!aliveMembers.length) {
      session.state = 'finished';
      await broadcastState(session, 'Todos morreram.');
      sessions.delete(session.code);
      return;
    }

    let totalDmg = 0;
    const defenders = [];
    for (const uid of aliveMembers) {
      const action = session.actions.get(uid) || { type: 'attack' };
      const player = await getPlayer(uid);
      const stats = await getPlayerStats(player);
      if (action.type === 'attack') {
        const dmg = rollDamage(stats.total_atk, room.def, Math.random() * 100 < stats.total_crit);
        totalDmg += dmg;
        const md = session.memberData.get(uid);
        md.dmg = (md.dmg || 0) + dmg;
        session.memberData.set(uid, md);
      } else if (action.type === 'defend') {
        defenders.push(uid);
      } else if (action.type === 'cons' && action.itemKey) {
        await useConsumable(player, action.itemKey);
      }
    }

    room.hp = Math.max(0, room.hp - totalDmg);

    // mob ataca
    if (room.hp > 0) {
      const targetPool = defenders.length ? defenders : aliveMembers;
      const targetId = targetPool[Math.floor(Math.random() * targetPool.length)];
      const targetPlayer = await getPlayer(targetId);
      const targetStats = await getPlayerStats(targetPlayer);
      const dmg = rollDamage(room.atk, targetStats.total_def, false);
      const newHp = Math.max(0, targetPlayer.hp - dmg);
      await pool.query('UPDATE players SET hp = $1 WHERE id = $2', [newHp, targetPlayer.id]);
      const md = session.memberData.get(targetId);
      md.hp = newHp;
      if (newHp <= 0) md.alive = false;
      session.memberData.set(targetId, md);
      await bot.telegram.sendMessage(targetId, `💥 ${room.name} causou ${dmg} de dano em você. HP: ${newHp}`);
    }

    session.actions.clear();

    if (room.hp <= 0) {
      // avança sala
      await awardRoomXp(session, session.roomIndex);
      session.roomIndex += 1;
      if (session.roomIndex > session.def.rooms) {
        await finishDungeon(session);
      } else {
        await broadcastState(session, `${room.name} derrotado! Indo para a próxima sala.`);
        await renderRoom(session);
      }
    } else {
      await renderRoom(session);
    }
  }

  async function awardRoomXp(session, roomIdx) {
    const xp = session.def.xp[Math.min(roomIdx, session.def.xp.length - 1)] || 0;
    const aliveMembers = [...session.members].filter((uid) => session.memberData.get(uid)?.alive);
    for (const uid of aliveMembers) {
      await pool.query('UPDATE players SET xp_total = xp_total + $1 WHERE telegram_id = $2', [xp, uid]);
    }
  }

  async function finishDungeon(session) {
    session.state = 'finished';
    const boss = session.boss;
    const msgLines = [`🏆 Dungeon concluída!`, `Boss: ${boss.name}`];
    // XP final (boss index = rooms)
    await awardRoomXp(session, session.def.rooms);

    // Ranking de dano
    const ranking = [...session.memberData.entries()]
      .map(([uid, m]) => ({ uid, name: m.name, dmg: m.dmg || 0 }))
      .sort((a, b) => b.dmg - a.dmg);
    if (ranking.length) {
      msgLines.push('📊 Dano causado:');
      ranking.forEach((r, idx) => {
        msgLines.push(`${idx + 1}. ${r.name}: ${r.dmg}`);
      });
    }

    for (const uid of session.members) {
      const player = await getPlayer(uid);
      if (!session.memberData.get(uid)?.alive) {
        await pool.query('UPDATE players SET xp_total = GREATEST(0, xp_total - $1) WHERE id = $2', [Math.round((session.def.xp[session.def.rooms] || 0) * 0.3), player.id]);
      }
      // Drop individual
      let lootMsg = '';
      const drop = await maybeDropItem(session.mapKey, 3, true);
      if (drop) {
        const result = await awardItem(player.id, drop);
        if (result.success) {
          lootMsg += `Item: ${drop.name}\n`;
        }
      }
      // bone_key chance
      const chance = session.def.boneChance || 0;
      if (Math.random() < chance) {
        const bk = await pool.query("SELECT * FROM items WHERE key = 'bone_key'");
        const itemRow = bk.rows[0];
        if (itemRow) await awardItem(player.id, itemRow);
        lootMsg += 'Chave óssea obtida!\n';
      }
      await bot.telegram.sendMessage(uid, `${msgLines.join('\n')}\n${lootMsg || ''}`);
      await setPlayerState(player.id, STATES.MENU);
    }
    sessions.delete(session.code);
  }

  // Handlers
  async function showDungeonMenu(ctx, base) {
    const text = `🗝️ ${base.def.name}\nMapa: ${base.map.name}\n\nCrie uma sala para seu grupo ou entre com o código de um amigo.`;
    const keyboard = dungeonMenuKeyboard();
    if (base.cover) {
      await bot.telegram.sendPhoto(ctx.chat.id, base.cover, { caption: text, reply_markup: keyboard, parse_mode: 'Markdown' });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }

  bot.command('dungeon', async (ctx) => {
    const base = await ensureSession(ctx);
    if (!base) return;
    await showDungeonMenu(ctx, base);
  });

  bot.action('dungeon_menu', async (ctx) => {
    const base = await ensureSession(ctx);
    if (!base) {
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    await showDungeonMenu(ctx, base);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.command('dungeon_create', async (ctx) => {
    await createSession(ctx);
  });

  bot.action('d_menu_create', async (ctx) => {
    await createSession(ctx);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action('d_menu_browse', async (ctx) => {
    const base = await ensureSession(ctx);
    if (!base) {
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    const available = [...sessions.values()].filter((s) => s.state === 'lobby' && s.mapKey === base.map.key);
    if (!available.length) {
      await ctx.reply('Nenhuma sala disponível neste mapa. Crie uma sala ou tente mais tarde.', { reply_markup: dungeonMenuKeyboard() });
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    const buttons = available.map((s) => [
      Markup.button.callback(`${s.name} | ${s.members.size}/5 | ${s.code}`, `d_join:${s.code}`),
    ]);
    buttons.push([Markup.button.callback('⬅️ Voltar', 'dungeon_menu')]);
    await ctx.reply('Salas disponíveis:', { reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.command('dungeon_join', async (ctx) => {
    const [, code] = (ctx.message.text || '').split(' ');
    if (!code) return ctx.reply('Use /dungeon_join <código>');
    await joinSession(ctx, code.trim().toUpperCase());
  });

  bot.action('d_menu_join', async (ctx) => {
    await ctx.reply('Digite: /dungeon_join <código>');
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_join:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    await joinSession(ctx, code);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_ready:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery('Sala não existe').catch(() => {});
    const userId = String(ctx.from.id);
    const m = session.memberData.get(userId);
    if (m) m.ready = true;
    await sendLobby(session);
    await ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_unready:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery('Sala não existe').catch(() => {});
    const userId = String(ctx.from.id);
    const m = session.memberData.get(userId);
    if (m) m.ready = false;
    await sendLobby(session);
    await ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^d_start:(.+)$/, async (ctx) => startSession(ctx, ctx.match[1]));

  bot.action(/^d_leave:(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const session = sessions.get(code);
    if (!session) return ctx.answerCbQuery().catch(() => {});
    const uid = String(ctx.from.id);
    session.members.delete(uid);
    session.memberData.delete(uid);
    await ctx.answerCbQuery('Saiu').catch(() => {});
    await bot.telegram.sendMessage(uid, 'Você saiu da masmorra.', { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'menu')]]).reply_markup }).catch(() => {});
    if (session.members.size === 0) {
      sessions.delete(code);
    } else {
      await sendLobby(session);
    }
  });

  bot.action(/^d_act:([^:]+):(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const act = ctx.match[2];
    const session = sessions.get(code);
    if (!session || session.state !== 'running') return ctx.answerCbQuery('Sala indisponível').catch(() => {});
    const uid = String(ctx.from.id);
    if (!session.members.has(uid)) return ctx.answerCbQuery('Você não está na sala').catch(() => {});
    if (!session.memberData.get(uid)?.alive) return ctx.answerCbQuery('Você está morto').catch(() => {});

    if (act === 'cons') {
      // lista consumíveis do jogador
      const player = await getPlayer(uid);
      const items = await pool.query(
        `SELECT inv.item_key, SUM(inv.qty)::int AS qty, i.name FROM inventory inv JOIN items i ON i.key = inv.item_key WHERE inv.player_id = $1 AND inv.slot = 'consumable' AND inv.qty > 0 GROUP BY inv.item_key, i.name ORDER BY i.name`,
        [player.id]
      );
      if (!items.rows.length) {
        await ctx.answerCbQuery('Sem consumíveis').catch(() => {});
        return;
      }
      const kb = items.rows.map((it) => [Markup.button.callback(`${it.name} (${it.qty})`, `d_use:${code}:${it.item_key}`)]);
      await ctx.reply('🧪 Escolha um consumível (gasta o turno):', { reply_markup: Markup.inlineKeyboard(kb).reply_markup });
      await ctx.answerCbQuery().catch(() => {});
      return;
    }

    session.actions.set(uid, { type: act });
    await ctx.answerCbQuery('Ação registrada').catch(() => {});

    if (session.actions.size >= [...session.members].filter((id) => session.memberData.get(id)?.alive).length) {
      await resolveActions(session);
    }
  });

  bot.action(/^d_use:([^:]+):(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const itemKey = ctx.match[2];
    const session = sessions.get(code);
    if (!session || session.state !== 'running') return ctx.answerCbQuery('Sala indisponível').catch(() => {});
    const uid = String(ctx.from.id);
    if (!session.members.has(uid)) return ctx.answerCbQuery('Você não está na sala').catch(() => {});
    const player = await getPlayer(uid);
    const result = await useConsumable(player, itemKey);
    if (!result.ok) {
      await ctx.answerCbQuery(result.message || 'Não foi possível usar.').catch(() => {});
      return;
    }
    session.actions.set(uid, { type: 'cons', itemKey });
    await ctx.answerCbQuery('Consumido').catch(() => {});
    if (session.actions.size >= [...session.members].filter((id) => session.memberData.get(id)?.alive).length) {
      await resolveActions(session);
    }
  });
}
