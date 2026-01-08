import { Markup } from "telegraf";

export function registerEventRewards(bot, deps) {
  const { pool, getPlayer, awardItem, sendCard, escapeHtml } = deps;

  async function isAdmin(chatId, userId) {
    try {
      const member = await bot.telegram.getChatMember(chatId, userId);
      return ["creator", "administrator"].includes(member.status);
    } catch (e) {
      console.error("getChatMember failed", e.message);
      return false;
    }
  }

  async function getItemInfo(key) {
    const res = await pool.query("SELECT * FROM items WHERE key = $1", [key]);
    return res.rows[0] || null;
  }

  bot.command("event", async (ctx) => {
    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
      return ctx.reply("Use este comando em um grupo.");
    }

    const parts = ctx.message.text.split(" ").filter(Boolean);
    const itemKey = parts[1];
    if (!itemKey) return ctx.reply("Use: /event <item_key>");

    const admin = await isAdmin(ctx.chat.id, ctx.from.id);
    if (!admin) return ctx.reply("Somente admins do grupo podem criar o drop.");

    const item = await getItemInfo(itemKey);
    if (!item) return ctx.reply("Item não encontrado.");

    const insert = await pool.query(
      `INSERT INTO event_rewards (chat_id, item_key, qty, created_by) VALUES ($1, $2, 1, $3) RETURNING id`,
      [String(ctx.chat.id), item.key, ctx.from.first_name || ctx.from.username || String(ctx.from.id)]
    );
    const eventId = insert.rows[0].id;

    const caption =
      `🎁 Drop relâmpago!\n` +
      `Prêmio: <b>${escapeHtml(item.name)}</b>\n` +
      `Apenas o primeiro que clicar resgata.`;

    const msg = await sendCard(ctx, {
      fileId: item.image_file_id || undefined,
      caption,
      parse_mode: "HTML",
      keyboard: [[Markup.button.callback("🎁 Resgatar", `event_claim:${eventId}`)]],
    });

    if (msg?.message_id) {
      await pool.query("UPDATE event_rewards SET message_id = $1 WHERE id = $2", [String(msg.message_id), eventId]);
    }
  });

  bot.action(/event_claim:(\d+)/, async (ctx) => {
    const eventId = Number(ctx.match[1]);
    const userId = String(ctx.from.id);
    const player = await getPlayer(userId, ctx.from.first_name);

    // tenta travar a linha para evitar corrida
    const claimRes = await pool.query(
      `UPDATE event_rewards
       SET claimed_by = $1, claimed_at = now()
       WHERE id = $2 AND claimed_by IS NULL
       RETURNING *`,
      [player.id, eventId]
    );

    if (claimRes.rows.length === 0) {
      if (ctx.callbackQuery) await ctx.answerCbQuery("Esgotado");
      return;
    }

    const reward = claimRes.rows[0];
    const item = await getItemInfo(reward.item_key);
    if (!item) {
      if (ctx.callbackQuery) await ctx.answerCbQuery("Item inválido");
      return;
    }
    const qty = reward.qty && reward.qty > 0 ? reward.qty : 1;
    for (let i = 0; i < qty; i++) {
      const res = await awardItem(player.id, item);
      if (!res?.success) break;
    }
    if (ctx.callbackQuery) await ctx.answerCbQuery("Você pegou!");

    // tenta editar mensagem original para mostrar vencedor
    if (reward.chat_id && reward.message_id) {
      const winner = escapeHtml(player.name || ctx.from.first_name || String(ctx.from.id));
      const caption =
        `🎁 Drop resgatado!\n` +
        `Prêmio: <b>${escapeHtml(item?.name || reward.item_key)}</b>\n` +
        `Vencedor: ${winner}`;
      try {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(`🎉 Resgatado por ${winner}`, "noop_event_claimed")],
        ]).reply_markup;
        await bot.telegram.editMessageCaption(
          reward.chat_id,
          Number(reward.message_id),
          undefined,
          caption,
          {
            parse_mode: "HTML",
            reply_markup: keyboard,
          }
        );
      } catch (e) {
        console.error("event edit caption failed", e.message);
      }
    }
  });
}
