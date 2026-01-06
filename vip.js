import { Markup } from "telegraf";
import { createTofuPreference, getTofuPack, fetchPayment } from "./services/mp.js";

const VIP_COST = 18;
const EVENT_IMG_KEYS = {
  main: "vip_cover",
  tofus: "vip_tofus_cover",
  buy: "vip_buy_cover",
  chest: "vip_chest_cover",
};

export function registerVip({ bot, app, deps }) {
  const { pool, getPlayer, setPlayerState, sendCard, awardItem, STATES } = deps;
  const imageCache = new Map(); // key -> file_id|null

  async function getEventImage(key) {
    if (imageCache.has(key)) return imageCache.get(key);
    const res = await pool.query("SELECT file_id FROM event_images WHERE event_key = $1", [key]);
    const fileId = res.rows[0]?.file_id || null;
    imageCache.set(key, fileId);
    return fileId;
  }

  function formatDate(dt) {
    if (!dt) return "-";
    const d = new Date(dt);
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const yr = d.getFullYear();
    return `${day}/${mon}/${yr}`;
  }

  function buildBackMenu() {
    return [
      [Markup.button.callback("🏠 Menu", "menu")],
    ];
  }

  function isVip(player) {
    return player.vip_until && new Date(player.vip_until) > new Date();
  }

  function vipChestCooldown(player) {
    const last = player.vip_chest_opened_at ? new Date(player.vip_chest_opened_at) : null;
    if (!last) return { ready: true, remainingMs: 0 };
    const next = new Date(last.getTime() + 7 * 24 * 60 * 60 * 1000);
    const diff = next - new Date();
    return { ready: diff <= 0, remainingMs: diff };
  }

  function formatRemaining(ms) {
    const totalMin = Math.ceil(ms / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  async function pickVipChestReward(playerId) {
    const rewards = [
      { type: "item", key: "energy_potion", qty: 15, label: "15x Poções de Energia", weight: 40 },
      { type: "item", key: "health_potion", qty: 20, label: "20x Poções de Vida", weight: 40 },
      { type: "item", key: "dungeon_key", qty: 4, label: "4x Chaves de Masmorra", weight: 15 },
      { type: "item", key: "bone_key", qty: 1, label: "1x Chave de Ossos", weight: 2 },
      { type: "tofu", qty: 1, label: "1x Tofu", weight: 3 },
    ];
    const total = rewards.reduce((acc, r) => acc + (r.weight || 1), 0);
    let roll = Math.random() * total;
    let chosen = rewards[0];
    for (const r of rewards) {
      roll -= r.weight || 1;
      if (roll <= 0) {
        chosen = r;
        break;
      }
    }
    // Valida item bone_key existente; se não, cai para dungeon_key
    if (chosen.type === "item") {
      const check = await pool.query("SELECT key FROM items WHERE key = $1", [chosen.key]);
      if (check.rows.length === 0) {
        if (chosen.key === "bone_key") {
          chosen = { type: "item", key: "dungeon_key", qty: 2, label: "2x Chaves de Masmorra", weight: 2 };
        }
      }
    }
    if (chosen.type === "item") {
      const itemRow = await pool.query("SELECT * FROM items WHERE key = $1", [chosen.key]);
      const item = itemRow.rows[0];
      if (!item) {
        return { ok: false, message: "Recompensa indisponível." };
      }
      for (let i = 0; i < chosen.qty; i++) {
        const res = await awardItem(playerId, item);
        if (!res?.success) {
          return { ok: true, message: `Inventário cheio. Recompensa convertida em 10 arena coins.`, fallback: true };
        }
      }
      return { ok: true, message: chosen.label };
    }
    if (chosen.type === "tofu") {
      await pool.query("UPDATE players SET tofus = tofus + $1 WHERE id = $2", [chosen.qty, playerId]);
      return { ok: true, message: chosen.label };
    }
    return { ok: false, message: "Recompensa inválida." };
  }

  // --------- VIP SCREENS ---------
  async function showVipMenu(ctx) {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    await setPlayerState(player.id, STATES.MENU);
    const vipActive = isVip(player);
    const expires = vipActive ? formatDate(player.vip_until) : "—";
    const chest = vipChestCooldown(player);
    const chestLine = vipActive ? (chest.ready ? "🎁 Baú VIP: disponível!" : `🎁 Baú VIP: em ${formatRemaining(chest.remainingMs)}`) : "🎁 Baú VIP: exclusivo para VIP";

    const caption =
      `👑 VIP PREMIUM\n` +
      `Status: ${vipActive ? "✅ Ativo" : "❌ Não VIP"}\n` +
      `Válido até: ${expires}\n` +
      `Tofus: ${player.tofus || 0}\n\n` +
      `${chestLine}\n\n` +
      `Benefícios:\n` +
      `🔋 Energia máx 40\n` +
      `🎒 Inventário 30 slots\n` +
      `🏆 5 slots de tesouro na Arena\n` +
      `⚔️ Drop/arena por slots extras\n`;

    const keyboard = [
      [Markup.button.callback("💰 Comprar Tofus", "vip_tofus")],
      [Markup.button.callback(`⭐ Assinar VIP (${VIP_COST} Tofus)`, "vip_buy")],
      [Markup.button.callback("🎁 Baú VIP semanal", "vip_chest")],
      ...buildBackMenu(),
    ];

    await sendCard(ctx, { fileId: await getEventImage(EVENT_IMG_KEYS.main), caption, keyboard });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  }

  bot.command("vip", showVipMenu);
  bot.action("vip", showVipMenu);
  bot.action("vip_menu", showVipMenu);

  // Comprar Tofus
  bot.action("vip_tofus", async (ctx) => {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    await setPlayerState(player.id, STATES.MENU);
    const caption =
      `💎 Loja de Tofus\n` +
      `Saldo atual: ${player.tofus || 0} Tofus\n\n` +
      `Escolha um pacote:`;
    const keyboard = [
      [Markup.button.callback("💰 18 Tofus — R$ 18", "vip_tofus_pack:18")],
      [Markup.button.callback("⭐ 30 Tofus — R$ 28", "vip_tofus_pack:30")],
      [Markup.button.callback("🔥 100 Tofus — R$ 85", "vip_tofus_pack:100")],
      [Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")],
    ];
    await sendCard(ctx, { fileId: await getEventImage(EVENT_IMG_KEYS.tofus), caption, keyboard });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action(/^vip_tofus_pack:(\d+)$/, async (ctx) => {
    const pack = ctx.match[1];
    const packInfo = getTofuPack(pack);
    if (!packInfo) {
      if (ctx.callbackQuery) ctx.answerCbQuery("Pacote inválido").catch(() => {});
      return;
    }
    try {
      const url = await createTofuPreference({ telegramId: String(ctx.from.id), pack });
      const keyboard = [
        [Markup.button.url("🔗 Pagar via PIX (Mercado Pago)", url)],
        [Markup.button.callback("⬅️ Voltar", "vip_tofus"), Markup.button.callback("🏠 Menu", "menu")],
      ];
      const caption =
        `✅ Link gerado para o pacote ${packInfo.qty} Tofus (R$ ${packInfo.price}).\n` +
        `Após o pagamento aprovado, os Tofus serão creditados automaticamente.`;
      await sendCard(ctx, { caption, keyboard });
    } catch (e) {
      console.error("createTofuPreference", e);
      await sendCard(ctx, {
        caption: "❌ Não foi possível criar o link de pagamento. Tente novamente.",
        keyboard: [[Markup.button.callback("⬅️ Voltar", "vip_tofus"), Markup.button.callback("🏠 Menu", "menu")]],
      });
    }
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  // Comprar VIP
  bot.action("vip_buy", async (ctx) => {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    const active = isVip(player);
    const expires = active ? formatDate(player.vip_until) : "—";
    const caption =
      `⭐ VIP 30 dias\n` +
      `Custo: ${VIP_COST} Tofus\n` +
      `Seu saldo: ${player.tofus || 0} Tofus\n` +
      `Status atual: ${active ? `Ativo (até ${expires})` : "Não VIP"}`;
    const keyboard = [
      [Markup.button.callback(`✅ Confirmar (-${VIP_COST} Tofus)`, "vip_buy_confirm")],
      [Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")],
    ];
    await sendCard(ctx, { fileId: await getEventImage(EVENT_IMG_KEYS.buy), caption, keyboard });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("vip_buy_confirm", async (ctx) => {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    try {
      const res = await pool.query(
        `
        UPDATE players
        SET tofus = tofus - $1,
            vip_until = GREATEST(COALESCE(vip_until, NOW()), NOW()) + INTERVAL '30 days',
            energy_max = GREATEST(energy_max, 40),
            inventory_slots_max = GREATEST(inventory_slots_max, 30),
            energy = LEAST(energy, GREATEST(energy_max, 40))
        WHERE id = $2 AND tofus >= $1
        RETURNING vip_until, tofus, energy_max, inventory_slots_max, energy
      `,
        [VIP_COST, player.id]
      );
      if (!res.rows.length) {
        const needed = Math.max(0, VIP_COST - (player.tofus || 0));
        await sendCard(ctx, {
          caption: `❌ Tofus insuficientes.\nFaltam ${needed} Tofus.`,
          keyboard: [
            [Markup.button.callback("💰 Comprar Tofus", "vip_tofus")],
            [Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")],
          ],
        });
        if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
        return;
      }
      const newVip = res.rows[0].vip_until;
      await sendCard(ctx, {
        caption: `🌟 VIP ativado!\nVálido até: ${formatDate(newVip)}\nSaldo: ${res.rows[0].tofus} Tofus`,
        keyboard: [[Markup.button.callback("🏠 Menu", "menu")], [Markup.button.callback("💰 Comprar Tofus", "vip_tofus")]],
      });
    } catch (e) {
      console.error("vip_buy_confirm", e);
      await sendCard(ctx, {
        caption: "❌ Erro ao processar VIP. Tente novamente.",
        keyboard: [[Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")]],
      });
    }
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  // Baú VIP semanal
  bot.action("vip_chest", async (ctx) => {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    await setPlayerState(player.id, STATES.MENU);
    const active = isVip(player);
    const chest = vipChestCooldown(player);
    const caption =
      `🎁 Baú VIP Semanal\n` +
      `Abra uma vez a cada 7 dias e receba uma recompensa VIP.\n\n` +
      `Recompensas possíveis:\n` +
      `• 15x Poções de Energia\n` +
      `• 20x Poções de Vida\n` +
      `• 4x Chaves de Masmorra\n` +
      `• 1x Tofu (raro)\n` +
      `• 1x Chave de Ossos (muito rara)\n\n` +
      `Status: ${active ? (chest.ready ? "Disponível" : `Aguarde ${formatRemaining(chest.remainingMs)}`) : "Exclusivo para VIP"}`;

    const keyboard = [];
    if (active && chest.ready) {
      keyboard.push([Markup.button.callback("🎁 Abrir agora", "vip_chest_open")]);
    }
    keyboard.push([Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")]);

    await sendCard(ctx, { fileId: await getEventImage(EVENT_IMG_KEYS.chest), caption, keyboard });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  bot.action("vip_chest_open", async (ctx) => {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    const active = isVip(player);
    if (!active) {
      await sendCard(ctx, {
        caption: "🚫 Apenas VIP pode abrir o baú semanal.",
        keyboard: [[Markup.button.callback("⭐ Assinar VIP", "vip_buy")], [Markup.button.callback("🏠 Menu", "menu")]],
      });
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }
    const chest = vipChestCooldown(player);
    if (!chest.ready) {
      await sendCard(ctx, {
        caption: `⏳ Aguarde ${formatRemaining(chest.remainingMs)} para abrir novamente.`,
        keyboard: [[Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")]],
      });
      if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
      return;
    }

    const reward = await pickVipChestReward(player.id);
    await pool.query("UPDATE players SET vip_chest_opened_at = NOW() WHERE id = $1", [player.id]);

    await sendCard(ctx, {
      caption: reward.ok ? `🎁 Baú VIP aberto!\n${reward.message}` : reward.message || "Erro ao abrir o baú.",
      keyboard: [[Markup.button.callback("⬅️ Voltar", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
  });

  // --------- WEBHOOK MP (Express) ---------
  if (app) {
    async function handleWebhook(req, res) {
      try {
        const { type, data, action } = req.body || {};
        const paymentId = req.query.id || data?.id || req.body?.id;
        if (!paymentId) {
          console.warn("MP webhook sem paymentId", { query: req.query, body: req.body });
          return res.sendStatus(200);
        }
        let payment;
        try {
          payment = await fetchPayment(paymentId);
        } catch (err) {
          // Ignora notificações com id inválido
          return res.sendStatus(200);
        }
        if (!payment) return res.sendStatus(200);
        if (payment.status !== "approved" || payment.currency_id !== "BRL") {
          return res.sendStatus(200);
        }
        let ref;
        try {
          ref = JSON.parse(payment.external_reference || "{}");
        } catch {
          ref = {};
        }
        const packInfo = getTofuPack(String(ref.pack || ""));
        if (!packInfo || !ref.telegramId) return res.sendStatus(200);

        // Idempotência
        const exists = await pool.query("SELECT 1 FROM payments WHERE payment_id = $1", [String(payment.id)]);
        if (exists.rows.length) return res.sendStatus(200);

        const playerRes = await pool.query("SELECT id FROM players WHERE telegram_id = $1", [String(ref.telegramId)]);
        if (!playerRes.rows.length) return res.sendStatus(200);
        const playerId = playerRes.rows[0].id;

        await pool.query("BEGIN");
        await pool.query(
          `INSERT INTO payments (payment_id, gateway, amount_brl, tofus, telegram_id, status, raw_payload)
           VALUES ($1, 'mercadopago', $2, $3, $4, $5, $6)`,
          [String(payment.id), payment.transaction_amount || 0, packInfo.qty, String(ref.telegramId), payment.status, payment]
        );
        await pool.query("UPDATE players SET tofus = tofus + $1 WHERE id = $2", [packInfo.qty, playerId]);
        await pool.query("COMMIT");

        // Notifica o usuário
        try {
          await bot.telegram.sendMessage(
            String(ref.telegramId),
            `✅ Pagamento confirmado!\n+${packInfo.qty} Tofus\nSaldo atualizado: cheque o menu VIP.`,
            { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("💎 VIP", "vip_menu"), Markup.button.callback("🏠 Menu", "menu")]]).reply_markup }
          );
        } catch (e) {
          console.error("notify payment", e.message);
        }
        return res.sendStatus(200);
      } catch (e) {
        console.error("MP webhook error", e);
        try {
          await pool.query("ROLLBACK");
        } catch {
          // ignore
        }
        return res.sendStatus(500);
      }
    }

    // Mercado Pago pode enviar POST ou GET; tratamos ambos para robustez.
    app.post("/payments/mp/webhook", handleWebhook);
    app.get("/payments/mp/webhook", handleWebhook);
  }
}
