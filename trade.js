import { Markup } from "telegraf";

export function registerTrade(bot, deps) {
  const { pool, getPlayer, getItemQty, hasItemQty, sendCard, escapeHtml, genCode, STATES } = deps;

  const tradeSessions = new Map(); // code -> trade session
  const pendingQty = new Map(); // userId -> { itemKey, page }
  const pendingTradeJoin = new Set(); // userIds aguardando código via prompt
  const itemCache = new Map(); // item_key -> row

  async function getItemRow(key) {
    if (itemCache.has(key)) return itemCache.get(key);
    const res = await pool.query("SELECT * FROM items WHERE key = $1", [key]);
    const row = res.rows[0] || null;
    itemCache.set(key, row);
    return row;
  }

  async function getAvailableQty(playerId, itemKey) {
    const res = await pool.query(
      "SELECT COALESCE(SUM(qty),0)::int AS qty FROM inventory WHERE player_id = $1 AND item_key = $2 AND equipped = FALSE",
      [playerId, itemKey]
    );
    return Number(res.rows[0]?.qty || 0);
  }

  function formatTradeItemLabel(item) {
    const rarityIcon = {
      common: "🟢",
      uncommon: "🔵",
      rare: "🟣",
      epic: "🟡",
      legendary: "🟠",
      moeda: "💰",
    };
    const icon = rarityIcon[item.rarity] || "⚪";
    const stats = [];
    if (item.atk) stats.push(`ATK ${item.atk}`);
    if (item.def) stats.push(`DEF ${item.def}`);
    if (item.hp) stats.push(`HP ${item.hp}`);
    if (item.crit) stats.push(`CRIT ${item.crit}`);
    const statsText = stats.length ? ` - ${stats.join(" / ")}` : "";
    const qtyText = item.type === "equip" ? "" : ` (x${item.qty})`;
    return `${icon} ${item.name}${statsText}${qtyText}`;
  }

  function findTradeByUser(userId) {
    for (const [code, session] of tradeSessions.entries()) {
      if (session.ownerId === userId || session.guestId === userId) return { code, session };
    }
    return null;
  }

  async function renderTradeHome(ctx) {
    const existing = findTradeByUser(String(ctx.from.id));
    const kb = [
      [Markup.button.callback("➕ Criar troca", "trade_create_btn")],
      [Markup.button.callback("🔑 Entrar com código", "trade_join_prompt")],
    ];
    if (existing) kb.unshift([Markup.button.callback("🔙 Voltar à minha troca", "trade_back")]);
    kb.push([Markup.button.callback("🏠 Menu", "menu")]);
    await sendCard(ctx, { caption: "🤝 Trocas\nCrie uma troca ou entre com um código.", keyboard: kb });
  }

  async function renderTradeInventory(ctx, session, userId, page = 1) {
    const player = await getPlayer(userId, ctx.from.first_name);
    const equipablesRes = await pool.query(
      `
      SELECT inv.id, inv.item_key, inv.qty, inv.rolled_atk AS atk, inv.rolled_def AS def, inv.rolled_hp AS hp, inv.rolled_crit AS crit, inv.rolled_rarity,
             i.name, i.rarity, i.slot
      FROM inventory inv
      JOIN items i ON i.key = inv.item_key
      WHERE inv.player_id = $1 AND inv.qty > 0 AND inv.equipped = FALSE AND i.slot <> 'consumable'
      ORDER BY i.slot ASC, i.rarity DESC, i.name ASC, inv.id ASC
    `,
      [player.id]
    );
    const consumablesRes = await pool.query(
      `
      SELECT inv.item_key, SUM(inv.qty)::int AS qty, i.name, i.rarity, i.slot
      FROM inventory inv
      JOIN items i ON i.key = inv.item_key
      WHERE inv.player_id = $1 AND inv.qty > 0 AND inv.equipped = FALSE AND i.slot = 'consumable'
      GROUP BY inv.item_key, i.name, i.rarity, i.slot
      ORDER BY i.rarity DESC, i.name ASC
    `,
      [player.id]
    );

    const items = [
      ...equipablesRes.rows.map((r) => ({ ...r, type: "equip", invId: r.id, qty: 1 })),
      ...consumablesRes.rows.map((r) => ({ ...r, type: "cons" })),
    ];
    if (player.gold > 0) items.push({ item_key: "__gold", qty: player.gold, name: "Gold", rarity: "moeda", slot: "currency", type: "currency" });
    if ((player.tofus || 0) > 0) items.push({ item_key: "__tofus", qty: player.tofus, name: "Tofus", rarity: "moeda", slot: "currency", type: "currency" });

    if (items.length === 0) {
      await sendCard(ctx, { caption: "Mochila vazia.", keyboard: [[Markup.button.callback("🏠 Menu", "menu")]] });
      if (ctx.callbackQuery) ctx.answerCbQuery();
      return;
    }
    const perPage = 5;
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    const pageNum = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const slice = items.slice((pageNum - 1) * perPage, pageNum * perPage);

    const kb = slice.map((i) => {
      if (i.type === "equip") {
        return [Markup.button.callback(formatTradeItemLabel(i), `trade_offer_pick_item_${i.invId}_p_${pageNum}`)];
      }
      return [Markup.button.callback(formatTradeItemLabel(i), `trade_offer_pick_cons_${i.item_key}_p_${pageNum}`)];
    });
    const nav = [];
    if (pageNum > 1) nav.push(Markup.button.callback("⬅️", `trade_offer_page_${pageNum - 1}`));
    if (pageNum < totalPages) nav.push(Markup.button.callback("➡️", `trade_offer_page_${pageNum + 1}`));
    if (nav.length) kb.push(nav);
    kb.push([Markup.button.callback("🔁 Voltar à troca", "trade_refresh")]);

    await sendCard(ctx, {
      caption: `🧳 Escolha o item para ofertar\nPágina ${pageNum}/${totalPages}`,
      keyboard: kb,
    });
    if (ctx.callbackQuery) ctx.answerCbQuery();
  }

  async function joinTradeByCode(ctx, code, userId) {
    if (!code) {
      await ctx.reply("Use: informe o código da troca.");
      return;
    }
    if (findTradeByUser(userId)) {
      const existing = findTradeByUser(userId);
      await ctx.reply("Você já está em uma troca. Voltando para ela.");
      await renderTrade(ctx, existing.session);
      return;
    }
    const session = tradeSessions.get(code);
    if (!session || session.expires < Date.now()) {
      tradeSessions.delete(code);
      await ctx.reply("Código inválido ou expirado.");
      return;
    }
    if (session.ownerId === userId) {
      await ctx.reply("Você já é o dono desta troca.");
      return;
    }
    session.guestId = userId;
    session.confirmed = { owner: false, guest: false };
    await ctx.reply("Entrou na troca!");
    await renderTrade(ctx, session);
  }

  async function renderTrade(ctx, session) {
    const owner = await getPlayer(session.ownerId);
    const guest = session.guestId ? await getPlayer(session.guestId) : null;
    const viewerSide = session.ownerId === String(ctx.from.id) ? "owner" : "guest";
    const otherOfferKey = viewerSide === "owner" ? session.offers.guest?.item_key : session.offers.owner?.item_key;
    let otherOfferImage = null;
    if (otherOfferKey && !["__gold", "__tofus"].includes(otherOfferKey)) {
      const imgRes = await pool.query("SELECT image_file_id FROM items WHERE key = $1", [otherOfferKey]);
      otherOfferImage = imgRes.rows[0]?.image_file_id || null;
    }
    
    // Busca stats dos itens sendo oferecidos
    const getOfferText = async (playerId, offer) => {
      if (!offer) return "Nenhuma";
      if (offer.item_key === "__gold") return `Gold x${offer.qty}`;
      if (offer.item_key === "__tofus") return `Tofus x${offer.qty}`;

      if (offer.invIds?.length) {
        const itemRes = await pool.query(
          `
          SELECT 
            inv.rolled_atk, inv.rolled_def, inv.rolled_hp, inv.rolled_crit, inv.rolled_rarity,
            i.name, i.rarity
          FROM inventory inv
          JOIN items i ON i.key = inv.item_key
          WHERE inv.id = ANY($1::uuid[])
          LIMIT 1
        `,
          [offer.invIds]
        );
        if (!itemRes.rows.length) return "Item indisponível";
        const item = itemRes.rows[0];
        const rolled = [];
        if (item.rolled_atk) rolled.push(`ATK+${item.rolled_atk}`);
        if (item.rolled_def) rolled.push(`DEF+${item.rolled_def}`);
        if (item.rolled_hp) rolled.push(`HP+${item.rolled_hp}`);
        if (item.rolled_crit) rolled.push(`CRIT+${item.rolled_crit}`);
        const statsText = rolled.length ? ` (${rolled.join(", ")})` : "";
        return `${item.name}${statsText}`;
      }
      
      // Busca um item exemplo com stats
      const itemRes = await pool.query(`
        SELECT 
          inv.rolled_atk, inv.rolled_def, inv.rolled_hp, inv.rolled_crit, inv.rolled_rarity,
          i.name, i.rarity
        FROM inventory inv
        JOIN items i ON i.key = inv.item_key
        WHERE inv.player_id = $1 AND inv.item_key = $2 AND inv.equipped = FALSE
        LIMIT 1
      `, [playerId, offer.item_key]);
      
      if (itemRes.rows.length === 0) return `${offer.item_key} x${offer.qty}`;
      
      const item = itemRes.rows[0];
      const rolled = [];
      if (item.rolled_atk) rolled.push(`ATK+${item.rolled_atk}`);
      if (item.rolled_def) rolled.push(`DEF+${item.rolled_def}`);
      if (item.rolled_hp) rolled.push(`HP+${item.rolled_hp}`);
      if (item.rolled_crit) rolled.push(`CRIT+${item.rolled_crit}`);
      const statsText = rolled.length ? ` (${rolled.join(", ")})` : "";
      
      return `${item.name} x${offer.qty}${statsText}`;
    };
    
    const ownerOfferText = await getOfferText(owner.id, session.offers.owner);
    const guestOfferText = guest ? await getOfferText(guest.id, session.offers.guest) : "Nenhuma";
    
    const caption =
      `🤝 <b>Troca</b>\n` +
      `Código: <code>${escapeHtml(session.code)}</code>\n` +
      `Dono: ${escapeHtml(owner.name)}\n` +
      `Convidado: ${guest ? escapeHtml(guest.name) : "aguardando"}\n\n` +
      `📦 Oferta de ${escapeHtml(owner.name)}:\n${escapeHtml(ownerOfferText)}\n\n` +
      `📦 Oferta de ${guest ? escapeHtml(guest.name) : "???"}:\n${escapeHtml(guestOfferText)}\n\n` +
      `Confirmações: dono ${session.confirmed.owner ? "✅" : "❌"} | convidado ${session.confirmed.guest ? "✅" : "❌"}\n` +
      `Expira em: ${Math.max(0, Math.floor((session.expires - Date.now()) / 60000))} min`;
  
    await sendCard(ctx, {
      caption,
      parse_mode: "HTML",
      fileId: otherOfferImage || undefined,
      keyboard: [
        [Markup.button.callback("🧳 Minha oferta", "trade_offer"), Markup.button.callback("🔁 Atualizar", "trade_refresh")],
        [Markup.button.callback("✅ Confirmar", "trade_confirm"), Markup.button.callback("🧹 Limpar oferta", "trade_clear")],
        [Markup.button.callback("❌ Cancelar", "trade_cancel"), Markup.button.callback("🚪 Sair", "trade_exit")],
        [Markup.button.callback("🏠 Menu", "menu")],
      ],
    });
  }

  // Actions/commands
  bot.action("trade_start", async (ctx) => {
    const userId = String(ctx.from.id);
    const existing = findTradeByUser(userId);
    if (existing) {
      await renderTrade(ctx, existing.session);
    } else {
      await renderTradeHome(ctx);
    }
  });

  bot.action("trade_create_btn", async (ctx) => {
    const userId = String(ctx.from.id);
    const existing = findTradeByUser(userId);
    if (existing) {
      await ctx.answerCbQuery("Já está em troca");
      return renderTrade(ctx, existing.session);
    }
    const code = genCode();
    tradeSessions.set(code, {
      code,
      ownerId: userId,
      guestId: null,
      offers: { owner: null, guest: null },
      confirmed: { owner: false, guest: false },
      expires: Date.now() + 20 * 60 * 1000,
    });
    await ctx.answerCbQuery("Troca criada");
    await renderTrade(ctx, tradeSessions.get(code));
  });

  bot.action("trade_join_prompt", async (ctx) => {
    pendingTradeJoin.add(String(ctx.from.id));
    await ctx.answerCbQuery();
    await ctx.reply("Envie o código da troca agora.", { reply_markup: { force_reply: true } });
  });

  bot.action("trade_back", async (ctx) => {
    const userId = String(ctx.from.id);
    const existing = findTradeByUser(userId);
    if (!existing) {
      await ctx.answerCbQuery("Sem troca");
      return renderTradeHome(ctx);
    }
    await ctx.answerCbQuery();
    return renderTrade(ctx, existing.session);
  });

  bot.on("text", async (ctx, next) => {
    const userId = String(ctx.from.id);
    if (pendingTradeJoin.has(userId) && ctx.message.text && !ctx.message.text.startsWith("/")) {
      pendingTradeJoin.delete(userId);
      const code = (ctx.message.text || "").trim();
      await joinTradeByCode(ctx, code, userId);
      return;
    }
    return next();
  });

  bot.action("trade_offer", async (ctx) => {
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    await renderTradeInventory(ctx, found.session, userId, 1);
  });

  bot.action(/trade_offer_page_(\d+)/, async (ctx) => {
    const page = Number(ctx.match[1] || "1");
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    await renderTradeInventory(ctx, found.session, userId, page);
  });

  bot.action(/trade_offer_pick_item_([^_]+)_p_(\d+)/, async (ctx) => {
    const invId = ctx.match[1];
    const page = Number(ctx.match[2] || "1");
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    const invRow = await pool.query(
      `
      SELECT inv.id, inv.item_key, inv.rolled_atk, inv.rolled_def, inv.rolled_hp, inv.rolled_crit, i.name
      FROM inventory inv
      JOIN items i ON i.key = inv.item_key
      WHERE inv.id = $1 AND inv.player_id = (SELECT id FROM players WHERE telegram_id = $2) AND inv.equipped = FALSE
      LIMIT 1
    `,
      [invId, userId]
    );
    if (!invRow.rows.length) {
      await ctx.answerCbQuery("Item indisponível", { show_alert: true });
      return renderTradeInventory(ctx, found.session, userId, page);
    }
    const side = found.session.ownerId === userId ? "owner" : "guest";
    found.session.offers[side] = { item_key: invRow.rows[0].item_key, qty: 1, invIds: [invId], type: "equip" };
    found.session.confirmed = { owner: false, guest: false };
    await ctx.answerCbQuery("Oferta salva");
    await renderTrade(ctx, found.session);
  });

  bot.action(/trade_offer_pick_cons_(.+)_p_(\d+)/, async (ctx) => {
    const itemKey = ctx.match[1];
    const page = Number(ctx.match[2] || "1");
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    const player = await getPlayer(userId, ctx.from.first_name);
    let qty;
    if (itemKey === "__gold") qty = player.gold || 0;
    else if (itemKey === "__tofus") qty = player.tofus || 0;
    else qty = await getAvailableQty(player.id, itemKey);
    if (qty <= 0) {
      await ctx.answerCbQuery("Sem estoque");
      return renderTradeInventory(ctx, found.session, userId, page);
    }
    await ctx.answerCbQuery();
    const buttons = [
      [
        Markup.button.callback("+1", `trade_offer_set_${itemKey}_1`),
        Markup.button.callback("+5", `trade_offer_set_${itemKey}_5`),
        Markup.button.callback("+10", `trade_offer_set_${itemKey}_10`),
        Markup.button.callback(`Máx (${qty})`, `trade_offer_set_${itemKey}_${qty}`),
      ],
      [Markup.button.callback("✏️ Digitar", `trade_offer_custom_${itemKey}_${page}`)],
      [Markup.button.callback("⬅️ Voltar", `trade_offer_page_${page}`)],
    ];
    await sendCard(ctx, {
      caption: `📦 Selecionar quantidade\nItem: ${escapeHtml(itemKey)}\nVocê tem: ${qty}`,
      keyboard: buttons,
      parse_mode: "HTML",
    });
  });

  bot.action(/trade_offer_set_(.+)_(\d+)/, async (ctx) => {
    const itemKey = ctx.match[1];
    const qty = Number(ctx.match[2] || "1");
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    const player = await getPlayer(userId, ctx.from.first_name);
    let stock;
    if (itemKey === "__gold") stock = player.gold || 0;
    else if (itemKey === "__tofus") stock = player.tofus || 0;
    else stock = await getAvailableQty(player.id, itemKey);

    if (qty < 1 || stock < qty) {
      await ctx.answerCbQuery("Quantidade inválida/sem estoque", { show_alert: true });
      return renderTrade(ctx, found.session);
    }
    await ctx.answerCbQuery("Oferta salva");
    const side = found.session.ownerId === userId ? "owner" : "guest";
    found.session.offers[side] = { item_key: itemKey, qty };
    found.session.confirmed = { owner: false, guest: false };
    await renderTrade(ctx, found.session);
  });

  bot.action(/trade_offer_custom_(.+)_(\d+)/, async (ctx) => {
    const itemKey = ctx.match[1];
    const page = ctx.match[2];
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    pendingQty.set(userId, { itemKey, page });
    await ctx.answerCbQuery();
    await ctx.reply(`Digite a quantidade para ${itemKey}:`, { reply_markup: { force_reply: true } });
  });

  bot.on("text", async (ctx, next) => {
    const userId = String(ctx.from.id);
    const pending = pendingQty.get(userId);
    if (!pending) return next();

    const found = findTradeByUser(userId);
    if (!found) {
      pendingQty.delete(userId);
      return next();
    }
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      pendingQty.delete(userId);
      await ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
      return;
    }

    const qty = parseInt(ctx.message.text.replace(/\D/g, ""), 10);
    if (!qty || qty < 1) {
      await ctx.reply("Quantidade inválida. Digite um número positivo.");
      return;
    }

    const player = await getPlayer(userId, ctx.from.first_name);
    let stock;
    if (pending.itemKey === "__gold") stock = player.gold || 0;
    else if (pending.itemKey === "__tofus") stock = player.tofus || 0;
    else stock = await getAvailableQty(player.id, pending.itemKey);

    if (stock < qty) {
      await ctx.reply("Quantidade maior que o estoque.");
      return;
    }

    const side = found.session.ownerId === userId ? "owner" : "guest";
    found.session.offers[side] = { item_key: pending.itemKey, qty };
    found.session.confirmed = { owner: false, guest: false };
    pendingQty.delete(userId);

    await ctx.reply("Oferta salva.");
    return renderTrade(ctx, found.session);
  });

  bot.action("trade_refresh", async (ctx) => {
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    await ctx.answerCbQuery();
    return renderTrade(ctx, found.session);
  });

  bot.action("trade_clear", async (ctx) => {
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    if (found.session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Troca expirada");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    const { session } = found;
    const side = session.ownerId === userId ? "owner" : "guest";
    session.offers[side] = null;
    session.confirmed[side] = false;
    await ctx.answerCbQuery("Oferta limpa");
    await renderTrade(ctx, session);
  });

  bot.action("trade_cancel", async (ctx) => {
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    tradeSessions.delete(found.code);
    await ctx.answerCbQuery("Troca cancelada");
    await ctx.reply("Troca cancelada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  });

  bot.action("trade_exit", async (ctx) => {
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    const { session } = found;
    if (session.ownerId === userId) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Troca cancelada");
      await ctx.reply("Troca cancelada pelo dono.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
      return;
    }
    // convidado saindo
    session.guestId = null;
    session.offers.guest = null;
    session.confirmed = { owner: false, guest: false };
    await ctx.answerCbQuery("Você saiu");
    await ctx.reply("Você saiu da troca. Dono pode convidar outro.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    return renderTrade(ctx, session);
  });

  bot.action("trade_confirm", async (ctx) => {
    const userId = String(ctx.from.id);
    const found = findTradeByUser(userId);
    if (!found) return ctx.answerCbQuery("Sem troca");
    const { session } = found;
    if (session.expires < Date.now()) {
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Expirou");
      return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    }
    if (!session.guestId) return ctx.answerCbQuery("Sem convidado ainda.");
    const side = session.ownerId === userId ? "owner" : "guest";
    session.confirmed[side] = true;
    if (session.confirmed.owner && session.confirmed.guest) {
      // executar troca
      const owner = await getPlayer(session.ownerId);
      const guest = await getPlayer(session.guestId);
      const ownerOffer = session.offers.owner;
      const guestOffer = session.offers.guest;
      
      if (ownerOffer && ownerOffer.item_key === "__gold" && (owner.gold < ownerOffer.qty)) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Dono sem gold suficiente.");
      }
      if (ownerOffer && ownerOffer.item_key === "__tofus" && ((owner.tofus || 0) < ownerOffer.qty)) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Dono sem tofus suficiente.");
      }
      if (ownerOffer && ownerOffer.invIds?.length) {
        const check = await pool.query(
          "SELECT COUNT(*)::int AS c FROM inventory WHERE player_id = $1 AND id = ANY($2::uuid[]) AND equipped = FALSE",
          [owner.id, ownerOffer.invIds]
        );
        if (Number(check.rows[0]?.c || 0) < ownerOffer.invIds.length) {
          session.confirmed = { owner: false, guest: false };
          return ctx.answerCbQuery("Dono sem item suficiente.");
        }
      } else if (ownerOffer && !["__gold","__tofus"].includes(ownerOffer.item_key) && ((await getAvailableQty(owner.id, ownerOffer.item_key)) < ownerOffer.qty)) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Dono sem item suficiente.");
      }
      if (guestOffer && guestOffer.item_key === "__gold" && (guest.gold < guestOffer.qty)) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Convidado sem gold suficiente.");
      }
      if (guestOffer && guestOffer.item_key === "__tofus" && ((guest.tofus || 0) < guestOffer.qty)) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Convidado sem tofus suficiente.");
      }
      if (guestOffer && guestOffer.invIds?.length) {
        const check = await pool.query(
          "SELECT COUNT(*)::int AS c FROM inventory WHERE player_id = $1 AND id = ANY($2::uuid[]) AND equipped = FALSE",
          [guest.id, guestOffer.invIds]
        );
        if (Number(check.rows[0]?.c || 0) < guestOffer.invIds.length) {
          session.confirmed = { owner: false, guest: false };
          return ctx.answerCbQuery("Convidado sem item suficiente.");
        }
      } else if (guestOffer && !["__gold","__tofus"].includes(guestOffer.item_key) && ((await getAvailableQty(guest.id, guestOffer.item_key)) < guestOffer.qty)) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Convidado sem item suficiente.");
      }
      
      // Valida slots do destinatário
      if (ownerOffer && !["__gold","__tofus"].includes(ownerOffer.item_key)) {
        const guestSlotsRes = await pool.query(`
          SELECT COUNT(*) as used FROM inventory WHERE player_id = $1 AND equipped = FALSE
        `, [guest.id]);
        const guestSlots = parseInt(guestSlotsRes.rows[0].used);
        if (guestSlots + ownerOffer.qty > 20) {
          session.confirmed = { owner: false, guest: false };
          return ctx.answerCbQuery("Inventário do convidado está cheio!");
        }
      }
      if (guestOffer && !["__gold","__tofus"].includes(guestOffer.item_key)) {
        const ownerSlotsRes = await pool.query(`
          SELECT COUNT(*) as used FROM inventory WHERE player_id = $1 AND equipped = FALSE
        `, [owner.id]);
        const ownerSlots = parseInt(ownerSlotsRes.rows[0].used);
        if (ownerSlots + guestOffer.qty > 20) {
          session.confirmed = { owner: false, guest: false };
          return ctx.answerCbQuery("Inventário do dono está cheio!");
        }
      }
      
      // Transfere items COM STATS ORIGINAIS (sem re-roll)
      if (ownerOffer && ownerOffer.item_key === "__gold") {
        await pool.query("UPDATE players SET gold = gold - $1 WHERE id = $2", [ownerOffer.qty, owner.id]);
        await pool.query("UPDATE players SET gold = gold + $1 WHERE id = $2", [ownerOffer.qty, guest.id]);
      } else if (ownerOffer && ownerOffer.item_key === "__tofus") {
        await pool.query("UPDATE players SET tofus = tofus - $1 WHERE id = $2", [ownerOffer.qty, owner.id]);
        await pool.query("UPDATE players SET tofus = tofus + $1 WHERE id = $2", [ownerOffer.qty, guest.id]);
      } else if (ownerOffer) {
        const itemRow = await getItemRow(ownerOffer.item_key);
        if (ownerOffer.invIds?.length && itemRow?.slot !== "consumable") {
          const ownerItemsRes = await pool.query(
            `
            SELECT id, item_key, slot, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity
            FROM inventory
            WHERE player_id = $1 AND id = ANY($2::uuid[]) AND equipped = FALSE
          `,
            [owner.id, ownerOffer.invIds]
          );
          for (const item of ownerItemsRes.rows) {
            await pool.query("DELETE FROM inventory WHERE id = $1", [item.id]);
            await pool.query(
              `
              INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
              VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
            `,
              [guest.id, item.item_key, item.slot, item.rolled_atk, item.rolled_def, item.rolled_hp, item.rolled_crit, item.rolled_rarity]
            );
          }
        } else if (itemRow?.slot === "consumable") {
          const srcRow = await pool.query(
            "SELECT id, qty FROM inventory WHERE player_id = $1 AND item_key = $2 AND slot = 'consumable' AND equipped = FALSE LIMIT 1",
            [owner.id, ownerOffer.item_key]
          );
          const stack = srcRow.rows[0];
          if (!stack || stack.qty < ownerOffer.qty) throw new Error("Stock mismatch");
          const newQty = stack.qty - ownerOffer.qty;
          if (newQty > 0) {
            await pool.query("UPDATE inventory SET qty = $1 WHERE id = $2", [newQty, stack.id]);
          } else {
            await pool.query("DELETE FROM inventory WHERE id = $1", [stack.id]);
          }
          const up = await pool.query(
            "UPDATE inventory SET qty = qty + $1 WHERE player_id = $2 AND item_key = $3 AND slot = 'consumable' AND equipped = FALSE RETURNING id",
            [ownerOffer.qty, guest.id, ownerOffer.item_key]
          );
          if (!up.rows.length) {
            await pool.query(
              "INSERT INTO inventory (player_id, item_key, slot, qty, rolled_rarity, equipped) VALUES ($1, $2, 'consumable', $3, $4, FALSE)",
              [guest.id, ownerOffer.item_key, ownerOffer.qty, itemRow.rarity || null]
            );
          }
        } else {
          const ownerItemsRes = await pool.query(`
            SELECT id, item_key, slot, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity
            FROM inventory
            WHERE player_id = $1 AND item_key = $2 AND equipped = FALSE
            LIMIT $3
          `, [owner.id, ownerOffer.item_key, ownerOffer.qty]);
          
          for (const item of ownerItemsRes.rows) {
            await pool.query('DELETE FROM inventory WHERE id = $1', [item.id]);
            await pool.query(`
              INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
              VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
            `, [guest.id, item.item_key, item.slot, item.rolled_atk, item.rolled_def, item.rolled_hp, item.rolled_crit, item.rolled_rarity]);
          }
        }
      }
      
      if (guestOffer && guestOffer.item_key === "__gold") {
        await pool.query("UPDATE players SET gold = gold - $1 WHERE id = $2", [guestOffer.qty, guest.id]);
        await pool.query("UPDATE players SET gold = gold + $1 WHERE id = $2", [guestOffer.qty, owner.id]);
      } else if (guestOffer && guestOffer.item_key === "__tofus") {
        await pool.query("UPDATE players SET tofus = tofus - $1 WHERE id = $2", [guestOffer.qty, guest.id]);
        await pool.query("UPDATE players SET tofus = tofus + $1 WHERE id = $2", [guestOffer.qty, owner.id]);
      } else if (guestOffer) {
        const itemRow = await getItemRow(guestOffer.item_key);
        if (guestOffer.invIds?.length && itemRow?.slot !== "consumable") {
          const guestItemsRes = await pool.query(
            `
            SELECT id, item_key, slot, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity
            FROM inventory
            WHERE player_id = $1 AND id = ANY($2::uuid[]) AND equipped = FALSE
          `,
            [guest.id, guestOffer.invIds]
          );
          for (const item of guestItemsRes.rows) {
            await pool.query("DELETE FROM inventory WHERE id = $1", [item.id]);
            await pool.query(
              `
              INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
              VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
            `,
              [owner.id, item.item_key, item.slot, item.rolled_atk, item.rolled_def, item.rolled_hp, item.rolled_crit, item.rolled_rarity]
            );
          }
        } else if (itemRow?.slot === "consumable") {
          const srcRow = await pool.query(
            "SELECT id, qty FROM inventory WHERE player_id = $1 AND item_key = $2 AND slot = 'consumable' AND equipped = FALSE LIMIT 1",
            [guest.id, guestOffer.item_key]
          );
          const stack = srcRow.rows[0];
          if (!stack || stack.qty < guestOffer.qty) throw new Error("Stock mismatch");
          const newQty = stack.qty - guestOffer.qty;
          if (newQty > 0) {
            await pool.query("UPDATE inventory SET qty = $1 WHERE id = $2", [newQty, stack.id]);
          } else {
            await pool.query("DELETE FROM inventory WHERE id = $1", [stack.id]);
          }
          const up = await pool.query(
            "UPDATE inventory SET qty = qty + $1 WHERE player_id = $2 AND item_key = $3 AND slot = 'consumable' AND equipped = FALSE RETURNING id",
            [guestOffer.qty, owner.id, guestOffer.item_key]
          );
          if (!up.rows.length) {
            await pool.query(
              "INSERT INTO inventory (player_id, item_key, slot, qty, rolled_rarity, equipped) VALUES ($1, $2, 'consumable', $3, $4, FALSE)",
              [owner.id, guestOffer.item_key, guestOffer.qty, itemRow.rarity || null]
            );
          }
        } else {
          const guestItemsRes = await pool.query(`
            SELECT id, item_key, slot, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity
            FROM inventory
            WHERE player_id = $1 AND item_key = $2 AND equipped = FALSE
            LIMIT $3
          `, [guest.id, guestOffer.item_key, guestOffer.qty]);
          
          for (const item of guestItemsRes.rows) {
            await pool.query('DELETE FROM inventory WHERE id = $1', [item.id]);
            await pool.query(`
              INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
              VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
            `, [owner.id, item.item_key, item.slot, item.rolled_atk, item.rolled_def, item.rolled_hp, item.rolled_crit, item.rolled_rarity]);
          }
        }
      }
      
      // Atualiza contadores de slots (apenas se houve item transferido)
      if (ownerOffer && !["__gold","__tofus"].includes(ownerOffer.item_key)) {
        await pool.query(`
          UPDATE players
          SET inventory_slots_used = (
            SELECT COUNT(*) FROM inventory WHERE player_id = $1 AND equipped = FALSE
          )
          WHERE id = $1
        `, [guest.id]);
      }
      if (guestOffer && !["__gold","__tofus"].includes(guestOffer.item_key)) {
        await pool.query(`
          UPDATE players
          SET inventory_slots_used = (
            SELECT COUNT(*) FROM inventory WHERE player_id = $1 AND equipped = FALSE
          )
          WHERE id = $1
        `, [owner.id]);
      }
      
      tradeSessions.delete(found.code);
      await ctx.answerCbQuery("Troca concluída!");
      await ctx.reply("✅ Troca concluída!", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
    } else {
      await ctx.answerCbQuery("Confirmação registrada");
      await renderTrade(ctx, session);
    }
  });

  bot.command("troca", async (ctx) => {
    const userId = String(ctx.from.id);
    const existing = findTradeByUser(userId);
    if (existing) {
      return renderTrade(ctx, existing.session);
    }
    await renderTradeHome(ctx);
  });

  bot.command("troca_join", async (ctx) => {
    const parts = ctx.message.text.split(" ");
    const code = parts[1];
    const userId = String(ctx.from.id);
    await joinTradeByCode(ctx, code, userId);
  });

  bot.command("troca_oferecer", async (ctx) => {
    const parts = ctx.message.text.split(" ");
    const itemKey = parts[1];
    const qty = parseInt(parts[2] || "1", 10);
    const userId = String(ctx.from.id);
    if (!itemKey || qty <= 0) return ctx.reply("Use: /troca_oferecer <item_key> <qty>");
    const found = findTradeByUser(userId);
    if (!found) return ctx.reply("Você não está em uma troca. Use /troca para criar.");
    const { session } = found;
    if (session.expires < Date.now()) {
      tradeSessions.delete(session.code);
      return ctx.reply("Troca expirada.");
    }
    if (!(await hasItemQty((await getPlayer(userId)).id, itemKey, qty))) {
      return ctx.reply("Quantidade insuficiente desse item.");
    }
    const side = session.ownerId === userId ? "owner" : "guest";
    session.offers[side] = { item_key: itemKey, qty };
    session.confirmed = { owner: false, guest: false };
    await renderTrade(ctx, session);
  });
}
