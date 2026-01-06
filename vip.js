import { Markup } from "telegraf";
import { createTofuPreference, getTofuPack, fetchPayment } from "./services/mp.js";

const VIP_COST = 18;
const EVENT_IMG_KEYS = {
  main: "vip_cover",
  tofus: "vip_tofus_cover",
  buy: "vip_buy_cover",
};

export function registerVip({ bot, app, deps }) {
  const { pool, getPlayer, setPlayerState, sendCard, STATES } = deps;
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

  // --------- VIP SCREENS ---------
  async function showVipMenu(ctx) {
    const player = await getPlayer(String(ctx.from.id), ctx.from.first_name);
    await setPlayerState(player.id, STATES.MENU);
    const isVip = player.vip_until && new Date(player.vip_until) > new Date();
    const expires = isVip ? formatDate(player.vip_until) : "—";

    const caption =
      `👑 VIP PREMIUM\n` +
      `Status: ${isVip ? "✅ Ativo" : "❌ Não VIP"}\n` +
      `Válido até: ${expires}\n` +
      `Tofus: ${player.tofus || 0}\n\n` +
      `Benefícios:\n` +
      `🔋 Energia máx 40\n` +
      `🎒 Inventário 30 slots\n` +
      `🏆 5 slots de tesouro na Arena\n` +
      `⚔️ Drop/arena por slots extras\n`;

    const keyboard = [
      [Markup.button.callback("💰 Comprar Tofus", "vip_tofus")],
      [Markup.button.callback(`⭐ Assinar VIP (${VIP_COST} Tofus)`, "vip_buy")],
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
    const isVip = player.vip_until && new Date(player.vip_until) > new Date();
    const expires = isVip ? formatDate(player.vip_until) : "—";
    const caption =
      `⭐ VIP 30 dias\n` +
      `Custo: ${VIP_COST} Tofus\n` +
      `Seu saldo: ${player.tofus || 0} Tofus\n` +
      `Status atual: ${isVip ? `Ativo (até ${expires})` : "Não VIP"}`;
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
            vip_until = GREATEST(COALESCE(vip_until, NOW()), NOW()) + INTERVAL '30 days'
        WHERE id = $2 AND tofus >= $1
        RETURNING vip_until, tofus
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

  // --------- WEBHOOK MP (Express) ---------
  if (app) {
    app.post("/payments/mp/webhook", async (req, res) => {
      try {
        const { type, data } = req.body || {};
        if (type !== "payment" || !data?.id) return res.sendStatus(200);
        const payment = await fetchPayment(data.id);
        if (!payment || payment.status !== "approved" || payment.currency_id !== "BRL") {
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
    });
  }
}
