import "dotenv/config";
import express from "express";
import { Telegraf, Markup } from "telegraf";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";
import { registerDungeon } from "./dungeon.js";

// --------------------------------------
// Bootstrap HTTP (health) + migrations
// --------------------------------------
const app = express();
app.use(express.json());

migrate();

app.get("/health/db", async (req, res) => {
  try {
    const maps = await pool.query("SELECT count(*) FROM maps");
    const mobs = await pool.query("SELECT count(*) FROM mobs");
    res.json({ status: "ok", maps: maps.rows[0].count, mobs: mobs.rows[0].count });
  } catch (err) {
    console.error("Health Check DB Error:", err);
    res.status(500).json({ status: "error", message: err.message, code: err.code });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server (Health Check) on :${PORT}`));

// --------------------------------------
// GAME CONSTANTS & STATE
// --------------------------------------
const REGEN_MINUTES = 12;
const ONLINE_WINDOW_MINUTES = 20;
const STATES = {
  MENU: "MENU",
  TRAVEL: "TRAVEL",
  RUN: "RUN",
  COMBAT: "COMBAT",
  INVENTORY: "INVENTORY",
  CLASS: "CLASS",
};
const CLASS_CONFIG = {
  guerreiro: { hp_max: 130, base_atk: 6, base_def: 4, base_crit: 4, desc: "Mais HP/DEF, segura dano e mantém consistência" },
  arqueiro: { hp_max: 110, base_atk: 7, base_def: 2, base_crit: 10, desc: "CRIT alto, dano estável e chance de explosões" },
  mago: { hp_max: 105, base_atk: 8, base_def: 2, base_crit: 9, desc: "ATK/CRIT altos, depende de evitar dano" },
};
const CLASS_WEAPONS = {
  guerreiro: ["short_sword", "sabre", "battle_axe", "knight_blade"],
  arqueiro: ["hunting_bow", "longbow", "crossbow"],
  mago: ["novice_rod", "mage_staff", "arcane_wand", "crystal_staff"],
};

const SHOP_DEFS = {
  vila: {
    name: "Loja da Vila",
    items: ["health_potion", "energy_potion", "atk_tonic", "def_tonic", "crit_tonic", "dungeon_key", "novice_rod", "hunting_bow", "short_sword", "wooden_shield", "leather_armor"],
  },
  matadores: {
    name: "Loja dos Matadores",
    items: ["sabre", "battle_axe", "longbow", "crossbow", "mage_staff", "arcane_wand", "plate_armor", "steel_shield", "tower_shield"],
  },
  castelo: {
    name: "Loja do Castelo",
    items: ["knight_blade", "crystal_staff", "amulet_health", "ring_protect"],
  },
};

const RARITY_ROLL = {
  common: [0.35, 0.65],
  uncommon: [0.55, 0.85],
  rare: [0.75, 1.0],
  epic: [0.9, 1.05],
  legendary: [1.0, 1.15],
};

const CONSUMABLE_EFFECTS = {
  health_potion: "Cura todo o HP",
  energy_potion: "Restaura 5⚡ (até o máximo)",
  atk_tonic: "+5 ATK por 30 minutos",
  def_tonic: "+5 DEF por 30 minutos",
  crit_tonic: "+8% CRIT por 30 minutos",
};

const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((i) => i.trim())
    .filter(Boolean)
);

const COMMUNITY_URL = "https://t.me/teletofusrpg";
let EVENT_IMAGES = {
  chest: process.env.CHEST_IMAGE_ID,
  trap: process.env.TRAP_IMAGE_ID,
  merchant: process.env.MERCHANT_IMAGE_ID,
  loot_gold: process.env.LOOT_GOLD_IMAGE_ID,
  loot_item: process.env.LOOT_ITEM_IMAGE_ID,
};
const SHOP_IMAGES = {
  vila: process.env.SHOP_IMG_VILA,
  matadores: process.env.SHOP_IMG_MATADORES,
  castelo: process.env.SHOP_IMG_CASTELO,
  main: process.env.SHOP_IMG_MAIN,
};

function makeGreenBar(current, max, size = 10) {
  const safeMax = Math.max(1, max);
  const pct = Math.min(1, Math.max(0, current / safeMax));
  const filled = Math.floor(pct * size);
  return "🟩".repeat(filled) + "⬜".repeat(size - filled);
}

let LEVEL_XP_CACHE = [];
const fights = new Map(); // userId -> fight state
const events = new Map(); // userId -> merchant pending
const pendingUploads = new Map(); // chatId -> { type, key }
const tradeSessions = new Map(); // code -> trade session
const pendingTradeJoin = new Set(); // userIds aguardando código via prompt
const arenaQueue = []; // array of player ids waiting
const arenaFights = new Map(); // userId -> fight data (pvp)
const dungeons = new Map(); // code -> dungeon session

// --------------------------------------
// HELPERS
// --------------------------------------
function genCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function loadLevelCache() {
  if (LEVEL_XP_CACHE.length > 0) return;
  const res = await pool.query("SELECT level, xp_to_next FROM level_xp ORDER BY level ASC");
  LEVEL_XP_CACHE = res.rows.map((r) => ({ level: r.level, xp_to_next: r.xp_to_next }));
}

async function loadEventImages() {
  try {
    const res = await pool.query("SELECT event_key, file_id FROM event_images");
    for (const row of res.rows) {
      if (row.event_key && row.event_key.startsWith("shop_")) {
        const k = row.event_key.replace("shop_", "");
        SHOP_IMAGES[k] = row.file_id;
      } else {
        EVENT_IMAGES[row.event_key] = row.file_id;
      }
    }
  } catch (err) {
    console.error("Erro ao carregar event_images:", err.message);
  }
}

async function getLevelFromTotalXp(xpTotal) {
  await loadLevelCache();

  let currentLevel = 1;
  let accumulatedXp = 0;
  let xpToNext = null;

  for (const data of LEVEL_XP_CACHE) {
    if (xpTotal >= accumulatedXp + data.xp_to_next) {
      accumulatedXp += data.xp_to_next;
      currentLevel++;
    } else {
      xpToNext = data.xp_to_next;
      break;
    }
  }

  return {
    level: currentLevel,
    level_xp_start: accumulatedXp,
    xp_to_next: xpToNext,
  };
}

function makeBar(current, max, size = 10) {
  const safeMax = Math.max(1, max);
  const pct = Math.min(1, Math.max(0, current / safeMax));
  const filled = Math.floor(pct * size);
  return "🟥".repeat(filled) + "⬜".repeat(size - filled);
}

async function regenEnergy(player) {
  const now = new Date();
  const last = player.last_energy_at ? new Date(player.last_energy_at) : new Date();
  const diffMin = Math.floor((now - last) / 60000);
  const gained = Math.floor(diffMin / REGEN_MINUTES);

  if (gained > 0 && player.energy < player.energy_max) {
    const newEnergy = Math.min(player.energy_max, player.energy + gained);
    const newLast = new Date(last.getTime() + gained * REGEN_MINUTES * 60000);
    await pool.query("UPDATE players SET energy = $1, last_energy_at = $2 WHERE id = $3", [
      newEnergy,
      newLast,
      player.id,
    ]);
    player.energy = newEnergy;
    player.last_energy_at = newLast;
  } else if (player.energy >= player.energy_max && diffMin > REGEN_MINUTES) {
    await pool.query("UPDATE players SET last_energy_at = NOW() WHERE id = $1", [player.id]);
    player.last_energy_at = new Date();
  }
  return player;
}

async function getPlayer(telegramId, name = "Aventureiro") {
  let res = await pool.query("SELECT * FROM players WHERE telegram_id = $1", [telegramId]);
  if (res.rows.length === 0) {
    const cls = "guerreiro";
    const cfg = CLASS_CONFIG[cls];
    await pool.query(
      `
      INSERT INTO players (telegram_id, name, hp, hp_max, energy, energy_max, current_map_key, state, last_energy_at, base_atk, base_def, base_crit, class)
      VALUES ($1, $2, $3, $4, 20, 20, 'plains', 'CLASS', NOW(), $5, $6, $7, $8)
      ON CONFLICT (telegram_id) DO NOTHING
    `,
      [telegramId, name, cfg.hp_max, cfg.hp_max, cfg.base_atk, cfg.base_def, cfg.base_crit, cls]
    );
    res = await pool.query("SELECT * FROM players WHERE telegram_id = $1", [telegramId]);
  }
  let player = await regenEnergy(res.rows[0]);
  const buff = getActiveBuff(player);
  if (buff.expired) {
    await pool.query(
      "UPDATE players SET temp_atk_buff = 0, temp_def_buff = 0, temp_crit_buff = 0, temp_buff_expires_at = NULL WHERE id = $1",
      [player.id]
    );
    player.temp_atk_buff = 0;
    player.temp_def_buff = 0;
    player.temp_crit_buff = 0;
    player.temp_buff_expires_at = null;
  }
  if (player.hp <= 0) {
    await applyDeathPenalty(player);
    const updated = await pool.query("SELECT * FROM players WHERE id = $1", [player.id]);
    player = updated.rows[0];
  }
  await pool.query("UPDATE players SET last_seen = NOW(), name = COALESCE($2, name) WHERE id = $1", [
    player.id,
    name,
  ]);
  return player;
}

async function setPlayerState(playerId, state) {
  await pool.query("UPDATE players SET state = $1 WHERE id = $2", [state, playerId]);
}

async function getMapByKey(key) {
  let res = await pool.query("SELECT * FROM maps WHERE key = $1", [key]);
  if (res.rows.length === 0) res = await pool.query("SELECT * FROM maps ORDER BY level_min ASC LIMIT 1");
  return res.rows[0];
}

async function getMapList() {
  const res = await pool.query("SELECT * FROM maps ORDER BY level_min ASC");
  return res.rows;
}

async function getPlayerStats(player) {
  const buff = getActiveBuff(player);
  const res = await pool.query(
    `
    SELECT 
      COALESCE(SUM(COALESCE(NULLIF(inv.rolled_atk,0), i.atk_max, i.atk_min, 0)), 0) as atk_bonus,
      COALESCE(SUM(COALESCE(NULLIF(inv.rolled_def,0), i.def_max, i.def_min, 0)), 0) as def_bonus,
      COALESCE(SUM(COALESCE(NULLIF(inv.rolled_hp,0), i.hp_max, i.hp_min, 0)), 0) as hp_bonus,
      COALESCE(SUM(COALESCE(NULLIF(inv.rolled_crit,0), i.crit_max, i.crit_min, 0)), 0) as crit_bonus
    FROM inventory inv
    JOIN items i ON inv.item_key = i.key
    WHERE inv.player_id = $1 AND inv.equipped = true
    `,
    [player.id]
  );

  const bonus = res.rows[0] || { atk_bonus: 0, def_bonus: 0, hp_bonus: 0, crit_bonus: 0 };
  return {
    total_atk: player.base_atk + Number(bonus.atk_bonus || 0) + (buff.atk || 0),
    total_def: player.base_def + Number(bonus.def_bonus || 0) + (buff.def || 0),
    total_hp: player.hp_max + Number(bonus.hp_bonus || 0),
    total_crit: player.base_crit + Number(bonus.crit_bonus || 0) + (buff.crit || 0),
  };
}

async function applyDeathPenalty(player) {
  const xpLoss = Math.floor(player.xp_total * 0.1);
  const newXp = Math.max(0, player.xp_total - xpLoss);
  const newEnergy = Math.max(0, player.energy - 1);
  const newHp = Math.max(1, Math.floor((player.hp_max || 100) * 0.5));

  await pool.query("UPDATE players SET xp_total = $1, energy = $2, hp = $3 WHERE id = $4", [
    newXp,
    newEnergy,
    newHp,
    player.id,
  ]);

  return { xpLoss, newHp, newEnergy };
}

function isAdmin(userId) {
  return ADMIN_IDS.has(String(userId));
}

function getActiveBuff(player) {
  if (!player.temp_buff_expires_at) return { atk: 0, def: 0, crit: 0 };
  const expires = new Date(player.temp_buff_expires_at);
  const active = expires.getTime() > Date.now();
  if (!active) return { atk: 0, def: 0, crit: 0, expired: true };
  return {
    atk: player.temp_atk_buff || 0,
    def: player.temp_def_buff || 0,
    crit: player.temp_crit_buff || 0,
  };
}

async function applyTempBuff(playerId, buff, minutes = 30) {
  const expiresAt = new Date(Date.now() + minutes * 60000);
  await pool.query(
    `
    UPDATE players
    SET temp_atk_buff = $1, temp_def_buff = $2, temp_crit_buff = $3, temp_buff_expires_at = $4
    WHERE id = $5
  `,
    [buff.atk || 0, buff.def || 0, buff.crit || 0, expiresAt, playerId]
  );
  return expiresAt;
}

function rollStat(min, max, rarity = "common") {
  const rangeMin = Math.min(min || 0, max || 0);
  const rangeMax = Math.max(min || 0, max || 0);
  if (rangeMax <= 0) return 0;
  const [rMin, rMax] = RARITY_ROLL[rarity] || RARITY_ROLL.common;
  const roll = Math.random() * (rMax - rMin) + rMin;
  const val = Math.round(rangeMin + (rangeMax - rangeMin) * roll);
  return Math.max(rangeMin, Math.min(val, Math.round(rangeMax * 1.2)));
}

function rollItemStats(item) {
  const rarity = item.rarity || "common";
  return {
    atk: rollStat(item.atk_min, item.atk_max, rarity),
    def: rollStat(item.def_min, item.def_max, rarity),
    hp: rollStat(item.hp_min, item.hp_max, rarity),
    crit: rollStat(item.crit_min, item.crit_max, rarity),
    rarity,
  };
}

async function consumeItem(playerId, itemKey, qty = 1) {
  const res = await pool.query(
    "SELECT qty FROM inventory WHERE player_id = $1 AND item_key = $2",
    [playerId, itemKey]
  );
  if (res.rows.length === 0 || res.rows[0].qty < qty) return false;
  await pool.query(
    "UPDATE inventory SET qty = qty - $1 WHERE player_id = $2 AND item_key = $3",
    [qty, playerId, itemKey]
  );
  await pool.query("DELETE FROM inventory WHERE qty <= 0");
  return true;
}

async function hasItemQty(playerId, itemKey, qty = 1) {
  const res = await pool.query(
    "SELECT qty FROM inventory WHERE player_id = $1 AND item_key = $2",
    [playerId, itemKey]
  );
  return res.rows.length > 0 && Number(res.rows[0].qty) >= qty;
}

async function getItemQty(playerId, itemKey) {
  const res = await pool.query("SELECT COALESCE(SUM(qty),0) as qty FROM inventory WHERE player_id = $1 AND item_key = $2", [
    playerId,
    itemKey,
  ]);
  return Number(res.rows[0]?.qty || 0);
}

async function getOnlineStats() {
  const totalRes = await pool.query(
    `SELECT count(*)::int AS total FROM players WHERE last_seen > NOW() - INTERVAL '${ONLINE_WINDOW_MINUTES} minutes'`
  );
  const byMap = await pool.query(
    `SELECT current_map_key, count(*)::int AS qty FROM players WHERE last_seen > NOW() - INTERVAL '${ONLINE_WINDOW_MINUTES} minutes' GROUP BY current_map_key`
  );
  return {
    total: Number(totalRes.rows[0]?.total || 0),
    byMap: byMap.rows,
  };
}

function escapeHtml(str = "") {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function getShopItemsByKey(shopKey) {
  const def = SHOP_DEFS[shopKey];
  if (!def) return [];
  const res = await pool.query(
    `
    SELECT 
      s.item_key, s.currency, s.buy_price, s.sell_price, s.stock, s.available,
      i.name, i.rarity, i.slot
    FROM shop_items s
    JOIN items i ON i.key = s.item_key
    WHERE s.available = TRUE
      AND s.buy_price IS NOT NULL
      AND s.item_key = ANY($1)
    ORDER BY s.currency, i.rarity DESC, i.name
    `,
    [def.items]
  );
  return res.rows;
}

function shopBalanceText(player) {
  return `💰 Gold: ${player.gold}\n🎖️ Arena Coins: ${player.arena_coins}\n🧀 Tofus: ${player.tofus || 0}`;
}

function currencyLabel(cur) {
  if (cur === "arena_coins") return { label: "Arena Coins", icon: "🎖️", field: "arena_coins" };
  if (cur === "tofus") return { label: "Tofus", icon: "🧀", field: "tofus" };
  return { label: "Gold", icon: "💰", field: "gold" };
}

function formatPrice(amount, currency) {
  const info = currencyLabel(currency);
  return `${info.icon} ${amount} ${info.label}`;
}

function shopBalanceHtml(player) {
  return escapeHtml(shopBalanceText(player));
}

function computeSellPrice(row) {
  // Prioriza preço da loja; se não houver, usa fallback por raridade
  if (row.shop_sell_price !== null && row.shop_sell_price !== undefined) return Number(row.shop_sell_price);
  const fallbackByRarity = { legendary: 400, epic: 250, rare: 120, uncommon: 60, common: 25 };
  const rarity = row.rarity || "common";
  const baseFallback = fallbackByRarity[rarity] || 20;
  if (row.buy_price) {
    const derived = Math.floor(Number(row.buy_price) * 0.35);
    return Math.max(baseFallback, derived, 5);
  }
  return baseFallback;
}

function formatItemPreview(item) {
  const parts = [];
  if (item.atk_min || item.atk_max) parts.push(`ATK ${item.atk_min || 0}-${item.atk_max || 0}`);
  if (item.def_min || item.def_max) parts.push(`DEF ${item.def_min || 0}-${item.def_max || 0}`);
  if (item.hp_min || item.hp_max) parts.push(`HP ${item.hp_min || 0}-${item.hp_max || 0}`);
  if (item.crit_min || item.crit_max) parts.push(`CRIT ${item.crit_min || 0}-${item.crit_max || 0}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function formatRolledStats(rolled) {
  if (!rolled) return "";
  const parts = [];
  if (rolled.atk) parts.push(`ATK+${rolled.atk}`);
  if (rolled.def) parts.push(`DEF+${rolled.def}`);
  if (rolled.hp) parts.push(`HP+${rolled.hp}`);
  if (rolled.crit) parts.push(`CRIT+${rolled.crit}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

async function renderShopHome(ctx, player) {
  const keyboard = [
    [Markup.button.callback("🏘️ Vila", "shop_open:vila"), Markup.button.callback("⚔️ Matadores", "shop_open:matadores")],
    [Markup.button.callback("🏰 Castelo", "shop_open:castelo")],
    [Markup.button.callback("🏠 Menu", "menu")],
  ];
  const text = `<b>🏪 Lojas</b>\n\nEscolha uma loja:\n${shopBalanceHtml(player)}`;
  const fileId = SHOP_IMAGES.main;
  if (fileId) {
    return sendCard(ctx, { fileId, caption: text, keyboard, parse_mode: "HTML" });
  }
  return ctx.reply(text, { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard(keyboard).reply_markup });
}

async function renderShopView(ctx, player, shopKey) {
  const def = SHOP_DEFS[shopKey];
  if (!def) {
    return ctx.reply("❌ Loja não encontrada.");
  }
  const keyboard = [
    [Markup.button.callback("🛒 Comprar", `shop_buylist:${shopKey}`), Markup.button.callback("💰 Vender", "shop_selllist")],
    [Markup.button.callback("⬅️ Lojas", "loja_menu"), Markup.button.callback("🏠 Menu", "menu")],
  ];
  const caption = `<b>${escapeHtml(def.name)}</b>\n${shopBalanceHtml(player)}\n\nEscolha uma opção.`;
  const fileId = SHOP_IMAGES[shopKey];
  if (fileId) {
    return sendCard(ctx, { fileId, caption, keyboard, parse_mode: "HTML" });
  }
  return ctx.reply(caption, { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard(keyboard).reply_markup });
}

async function renderShopBuyList(ctx, player, shopKey) {
  const def = SHOP_DEFS[shopKey];
  if (!def) return ctx.reply("❌ Loja não encontrada.");
  const items = await getShopItemsByKey(shopKey);
  if (!items.length) {
    return ctx.reply("Nenhum item disponível nesta loja agora.");
  }
  const lines = items.map((i) => `• ${escapeHtml(i.name)} — ${formatPrice(i.buy_price, i.currency)}`);
  const keyboard = items.map((i) => [Markup.button.callback(`${i.name} (${i.buy_price})`, `shop_item:${shopKey}:${i.item_key}`)]);
  keyboard.push([Markup.button.callback("⬅️ Loja", `shop_open:${shopKey}`)]);
  const text = `<b>${escapeHtml(def.name)}</b>\n🛒 <b>Comprar</b>\n\n${lines.join("\n")}`;
  return ctx.reply(text, { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard(keyboard).reply_markup });
}

async function renderShopItemDetail(ctx, player, shopKey, itemKey) {
  const def = SHOP_DEFS[shopKey];
  if (!def || !def.items.includes(itemKey)) {
    return ctx.reply("❌ Item indisponível nesta loja.");
  }
  const res = await pool.query(
    `
    SELECT s.*, i.name, i.slot, i.rarity,
           i.atk_min, i.atk_max, i.def_min, i.def_max, i.hp_min, i.hp_max, i.crit_min, i.crit_max
    FROM shop_items s
    JOIN items i ON i.key = s.item_key
    WHERE s.item_key = $1 AND s.available = TRUE AND s.buy_price IS NOT NULL
    `,
    [itemKey]
  );
  if (!res.rows.length) return ctx.reply("❌ Item não encontrado ou indisponível.");
  const item = res.rows[0];
  const priceText = formatPrice(item.buy_price, item.currency);
  const stockText = item.stock ? `Estoque: ${item.stock}` : "Estoque: ∞";
  const stats = formatItemPreview(item);
  const info = currencyLabel(item.currency);
  const detail = `<b>${escapeHtml(item.name)}</b>${stats}\nPreço: ${priceText}\n${stockText}\n\n${shopBalanceHtml(player)}`;
  const keyboard = [
    [Markup.button.callback(`Comprar 1 (${info.icon}${item.buy_price})`, `shop_buy:${shopKey}:${itemKey}:1`)],
    [Markup.button.callback(`Comprar 5 (${info.icon}${item.buy_price * 5})`, `shop_buy:${shopKey}:${itemKey}:5`)],
    [Markup.button.callback("⬅️ Voltar", `shop_buylist:${shopKey}`), Markup.button.callback("🏪 Lojas", "loja_menu")],
  ];
  return ctx.reply(detail, { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard(keyboard).reply_markup });
}

async function useConsumable(player, itemKey) {
  const raw = (itemKey || "").trim().toLowerCase();
  const compact = raw.replace(/[\s_-]/g, "");
  const key =
    Object.keys(CONSUMABLE_EFFECTS).find(
      (k) => k === raw || k.replace(/_/g, "") === compact
    ) || raw;

  if (!(await hasItemQty(player.id, key, 1))) {
    return { ok: false, message: "Você não tem essa poção/tônico." };
  }

  if (key === "health_potion") {
    const stats = await getPlayerStats(player);
    if (player.hp >= stats.total_hp) return { ok: false, message: "Seu HP já está cheio." };
    await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [stats.total_hp, player.id]);
    await consumeItem(player.id, key, 1);
    return { ok: true, message: `❤️ HP totalmente restaurado (${stats.total_hp}).` };
  }

  if (key === "energy_potion") {
    const newEnergy = Math.min(player.energy_max, player.energy + 5);
    if (newEnergy === player.energy_max && player.energy === player.energy_max) {
      return { ok: false, message: "Sua energia já está cheia." };
    }
    await pool.query("UPDATE players SET energy = $1, last_energy_at = NOW() WHERE id = $2", [newEnergy, player.id]);
    await consumeItem(player.id, key, 1);
    return { ok: true, message: `⚡ Energia agora ${newEnergy}/${player.energy_max}` };
  }

  if (key === "atk_tonic") {
    await applyTempBuff(player.id, { atk: 5 }, 30);
    await consumeItem(player.id, key, 1);
    return { ok: true, message: "🗡️ Tônico de Força: +5 ATK por 30 minutos." };
  }

  if (key === "def_tonic") {
    await applyTempBuff(player.id, { def: 5 }, 30);
    await consumeItem(player.id, key, 1);
    return { ok: true, message: "🛡️ Tônico de Defesa: +5 DEF por 30 minutos." };
  }

  if (key === "crit_tonic") {
    await applyTempBuff(player.id, { crit: 8 }, 30);
    await consumeItem(player.id, key, 1);
    return { ok: true, message: "🎯 Tônico de Precisão: +8% CRIT por 30 minutos." };
  }

  return { ok: false, message: "Este consumível ainda não tem efeito." };
}

async function sendCard(ctx, { fileId, caption, keyboard, parse_mode = "Markdown" }) {
  const opts = { parse_mode };
  if (keyboard) opts.reply_markup = Markup.inlineKeyboard(keyboard).reply_markup;

  if (fileId) {
    try {
      return await ctx.replyWithPhoto(fileId, { ...opts, caption });
    } catch (e) {
      console.error("sendCard photo fallback:", e.message);
    }
  }
  return ctx.reply(caption, opts);
}

async function maybeDropItem(mapKey, difficulty = 1, isBoss = false) {
  const res = await pool.query("SELECT * FROM items WHERE map_key = $1 OR map_key IS NULL", [mapKey]);
  const items = res.rows;
  if (items.length === 0) return null;

  const drops = [];
  for (const item of items) {
    const base = Number(item.drop_rate || 0.01);
    const difficultyBonus = 1 + Math.max(0, difficulty - 1) * 0.35;
    const bonusFactor =
      isBoss && ["rare", "epic", "legendary"].includes(item.rarity || "common") ? 4 : 1;
    const chance = Math.min(0.6, base * difficultyBonus * bonusFactor);
    if (Math.random() < chance) drops.push(item);
  }

  if (drops.length) return drops[Math.floor(Math.random() * drops.length)];

  if (isBoss) {
    const rarePool = items.filter((i) =>
      ["rare", "epic", "legendary", "uncommon"].includes(i.rarity || "common")
    );
    if (rarePool.length) return rarePool[Math.floor(Math.random() * rarePool.length)];
  }
  return null;
}

function buildCombatKeyboard() {
  return [
    [
      Markup.button.callback("⚔️ Atacar", "combat_attack"),
      Markup.button.callback("🧪 Consumíveis", "combat_consumables"),
      Markup.button.callback("🏃 Fugir", "combat_flee"),
    ],
  ];
}

async function awardItem(playerId, item) {
  // Verifica se o inventário está cheio (20 slots máximo, equipados NÃO contam)
  const slotsRes = await pool.query(`
    SELECT COUNT(*) as used
    FROM inventory
    WHERE player_id = $1
    AND equipped = FALSE
  `, [playerId]);
  
  const slotsUsed = parseInt(slotsRes.rows[0]?.used || 0);
  
  // Se consumível, tenta stackar (não verifica slots ainda)
  if (item.slot === 'consumable') {
    const existingRes = await pool.query(`
      SELECT id, qty FROM inventory
      WHERE player_id = $1 AND item_key = $2 AND slot = 'consumable'
    `, [playerId, item.key]);
    
    if (existingRes.rows.length > 0) {
      // Stack existente, apenas incrementa qty
      await pool.query(`
        UPDATE inventory
        SET qty = qty + 1
        WHERE id = $1
      `, [existingRes.rows[0].id]);
      return { success: true, stacked: true };
    }
  }
  
  // Valida limite de slots (para novos itens, não stacks)
  if (slotsUsed >= 20) {
    return { success: false, reason: 'inventory_full' };
  }
  
  // Rola stats do item
  const rolled = rollItemStats(item);
  
  // Insere novo item (equipáveis SEMPRE nova linha, consumíveis só se não existir)
  await pool.query(`
    INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity)
    VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)
  `, [playerId, item.key, item.slot, rolled.atk, rolled.def, rolled.hp, rolled.crit, rolled.rarity]);
  
  // Atualiza contador de slots
  await pool.query(`
    UPDATE players
    SET inventory_slots_used = (
      SELECT COUNT(*)
      FROM inventory
      WHERE player_id = $1 AND equipped = FALSE
    )
    WHERE id = $1
  `, [playerId]);
  
  return { success: true, stacked: false, rolled };
}

function rollDamage(atk, def, isCrit = false) {
  const baseRand = Math.floor(Math.random() * 5) + 2; // 2..6
  const net = Math.max(1, atk - Math.floor(def * 0.6));
  let total = baseRand + net;
  if (isCrit) total = Math.floor(total * 1.5);
  return Math.max(1, total);
}

function formatCooldown(player) {
  const nextTime = new Date(new Date(player.last_energy_at).getTime() + REGEN_MINUTES * 60000);
  const diffMs = nextTime - new Date();
  const min = Math.max(0, Math.floor(diffMs / 60000));
  const sec = Math.max(0, Math.floor((diffMs % 60000) / 1000));
  return `${min}:${sec < 10 ? "0" + sec : sec}`;
}

function formatBuffRemaining(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt) - new Date();
  if (diffMs <= 0) return null;
  const min = Math.floor(diffMs / 60000);
  return min <= 0 ? "<1min" : `${min}min`;
}

// --------------------------------------
// TELEGRAM BOT
// --------------------------------------
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}
const bot = new Telegraf(botToken);

bot.use(async (ctx, next) => {
  try {
    if (ctx && typeof ctx.answerCbQuery === "function") {
      const orig = ctx.answerCbQuery.bind(ctx);
      ctx.answerCbQuery = async (...args) => {
        try {
          return await orig(...args);
        } catch (e) {
          const desc = e?.description || e?.message || "";
          if (desc.includes("query is too old")) return;
          console.error("answerCbQuery error:", desc);
        }
      };
    }
    await next();
  } catch (e) {
    console.error("Handler error:", e);
  }
});

// ------------- ADMIN IMAGE UPLOADS -------------
bot.command("setmobimg", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  const [, key] = ctx.message.text.split(" ");
  if (!key) return ctx.reply("Use /setmobimg <mob_key>");
  pendingUploads.set(ctx.chat.id, { type: "mob", key });
  ctx.reply(`Envie a imagem do mob *${key}* agora.`, { parse_mode: "Markdown" });
});

bot.command("setmapimg", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  const [, key] = ctx.message.text.split(" ");
  if (!key) return ctx.reply("Use /setmapimg <map_key>");
  pendingUploads.set(ctx.chat.id, { type: "map", key });
  ctx.reply(`Envie a imagem do mapa *${key}* agora.`, { parse_mode: "Markdown" });
});

bot.command("setitemimg", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  const [, key] = ctx.message.text.split(" ");
  if (!key) return ctx.reply("Use /setitemimg <item_key>");
  pendingUploads.set(ctx.chat.id, { type: "item", key });
  ctx.reply(`Envie a imagem do item *${key}* agora.`, { parse_mode: "Markdown" });
});

bot.command("seteventimg", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  const [, keyRaw] = ctx.message.text.split(" ");
  const key = (keyRaw || "").toLowerCase();
  if (!["chest", "trap", "merchant", "loot_gold", "loot_item", "dungeon_plains", "dungeon_forest", "dungeon_swamp", "dungeon_special"].includes(key)) {
    return ctx.reply("Use /seteventimg <chest|trap|merchant|loot_gold|loot_item|dungeon_plains|dungeon_forest|dungeon_swamp|dungeon_special>");
  }
  pendingUploads.set(ctx.chat.id, { type: "event", key });
  ctx.reply(`Envie a imagem do evento *${key}* agora.`, { parse_mode: "Markdown" });
});

bot.command("setshopimg", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  const [, keyRaw] = ctx.message.text.split(" ");
  const key = (keyRaw || "").toLowerCase();
  if (!["vila", "matadores", "castelo", "main"].includes(key)) {
    return ctx.reply("Use /setshopimg <vila|matadores|castelo|main>");
  }
  pendingUploads.set(ctx.chat.id, { type: "shop", key });
  ctx.reply(`Envie a imagem da loja *${key}* agora.`, { parse_mode: "Markdown" });
});

bot.command("checkimages", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  try {
    const tables = [
      { name: "maps", label: "Mapas" },
      { name: "mobs", label: "Mobs" },
      { name: "items", label: "Itens" },
    ];
    const blocks = [];
    for (const t of tables) {
      const res = await pool.query(`SELECT key, name, image_file_id FROM ${t.name} ORDER BY key`);
      const missing = res.rows.filter((r) => !r.image_file_id);
      const lines = missing.map((m) => `- ${m.key} | ${m.name}`);
      blocks.push(`${t.label}: faltando ${missing.length}${lines.length ? "\n" + lines.join("\n") : ""}`);
    }
    const ev = await pool.query("SELECT event_key, file_id FROM event_images ORDER BY event_key");
    blocks.push(
      `Eventos:${ev.rows.length ? `\n${ev.rows.map((r) => `- ${r.event_key}: ${r.file_id ? "ok" : "faltando"}`).join("\n")}` : "\n- nenhum salvo"}`
    );
    const text = blocks.join("\n\n");
    if (text.length <= 3500) {
      await ctx.reply(text);
    } else {
      // envia em pedaços para evitar limites
      const chunks = [];
      let current = "";
      for (const line of text.split("\n")) {
        if (current.length + line.length + 1 > 3500) {
          chunks.push(current);
          current = "";
        }
        current += (current ? "\n" : "") + line;
      }
      if (current) chunks.push(current);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    }
  } catch (e) {
    console.error("checkimages error:", e);
    await ctx.reply("Erro ao verificar imagens.");
  }
});

bot.command("checklevels", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("🚫 Apenas admin.");
  try {
    const count = await pool.query("SELECT count(*)::int AS c FROM level_xp");
    const first = await pool.query("SELECT level, xp_to_next FROM level_xp ORDER BY level ASC LIMIT 3");
    const last = await pool.query("SELECT level, xp_to_next FROM level_xp ORDER BY level DESC LIMIT 3");
    const lines = [
      `level_xp total: ${count.rows[0]?.c || 0}`,
      "Primeiros:",
      ...first.rows.map((r) => `- L${r.level}: ${r.xp_to_next}`),
      "Últimos:",
      ...last.rows.map((r) => `- L${r.level}: ${r.xp_to_next}`),
    ];
    await ctx.reply(lines.join("\n"));
  } catch (e) {
    console.error("checklevels error:", e);
    await ctx.reply("Erro ao verificar level_xp.");
  }
});

bot.on("photo", async (ctx) => {
  const pending = pendingUploads.get(ctx.chat.id);
  if (!pending) return;

  const photos = ctx.message.photo || [];
  const biggest = photos[photos.length - 1];
  const fileId = biggest?.file_id;
  if (!fileId) return;

  let updated = false;
  if (pending.type === "mob") {
    const res = await pool.query("UPDATE mobs SET image_file_id = $1 WHERE key = $2 RETURNING key", [
      fileId,
      pending.key,
    ]);
    updated = res.rows.length > 0;
  } else if (pending.type === "map") {
    const res = await pool.query("UPDATE maps SET image_file_id = $1 WHERE key = $2 RETURNING key", [
      fileId,
      pending.key,
    ]);
    updated = res.rows.length > 0;
  } else if (pending.type === "item") {
    const res = await pool.query("UPDATE items SET image_file_id = $1 WHERE key = $2 RETURNING key", [
      fileId,
      pending.key,
    ]);
    updated = res.rows.length > 0;
  } else if (pending.type === "event") {
    await pool.query(
      `
      INSERT INTO event_images (event_key, file_id, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (event_key) DO UPDATE SET file_id = EXCLUDED.file_id, updated_at = NOW()
    `,
      [pending.key, fileId]
    );
    EVENT_IMAGES[pending.key] = fileId;
    updated = true;
  } else if (pending.type === "shop") {
    const eventKey = `shop_${pending.key}`;
    await pool.query(
      `
      INSERT INTO event_images (event_key, file_id, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (event_key) DO UPDATE SET file_id = EXCLUDED.file_id, updated_at = NOW()
    `,
      [eventKey, fileId]
    );
    SHOP_IMAGES[pending.key] = fileId;
    updated = true;
  }

  pendingUploads.delete(ctx.chat.id);
  ctx.reply(updated ? `✅ Imagem salva para ${pending.key}` : `⚠️ Chave ${pending.key} não encontrada.`);
});

// ------------- SCREENS -------------
async function renderMenu(ctx) {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const map = await getMapByKey(player.current_map_key);
  const lvlInfo = await getLevelFromTotalXp(player.xp_total);
  const stats = await getPlayerStats(player);
  const online = await getOnlineStats();
  const dungeonKeys = await getItemQty(player.id, "dungeon_key");
  const buff = getActiveBuff(player);

  if (player.state === STATES.CLASS) {
    return renderClass(ctx);
  }

  await setPlayerState(player.id, STATES.MENU);

  const captionLines = [
    `🏰 *${map.name}* (Lv ${map.level_min})`,
    `👥 Online (últimos ${ONLINE_WINDOW_MINUTES} min): ${online.total}`,
    "",
    `⚔️ Classe: ${player.class || "guerreiro"} | Lv ${lvlInfo.level}`,
    `❤️ HP: ${player.hp}/${stats.total_hp} ${makeBar(player.hp, stats.total_hp, 8)}`,
    `⚡ Energia: ${player.energy}/${player.energy_max} ${makeGreenBar(player.energy, player.energy_max, 8)} (regen a cada ${REGEN_MINUTES} min)`,
    `🗝️ Chaves de Masmorra: ${dungeonKeys}`,
    `🏅 Arena coins: ${player.arena_coins || 0}`,
    buff && (buff.atk || buff.def || buff.crit)
      ? `🧪 Buff ativo: +${buff.atk || 0} ATK / +${buff.def || 0} DEF / +${buff.crit || 0}% CRIT (${formatBuffRemaining(player.temp_buff_expires_at) || "até acabar"})`
      : "",
    `💰 Gold: ${player.gold}`,
  ].filter(Boolean);

  const keyboard = [
    [Markup.button.callback("⚔️ Caçar", "action_hunt"), Markup.button.callback("🗺️ Viajar", "travel_page_1")],
    [Markup.button.callback("🧳 Inventário", "inventario"), Markup.button.callback("👤 Perfil", "perfil")],
    [Markup.button.callback("🏪 Loja", "loja_menu"), Markup.button.callback("🤝 Troca", "trade_start")],
    [Markup.button.callback("🏟️ Arena", "arena_queue"), Markup.button.callback("🗝️ Masmorra", "dungeon_menu")],
    [Markup.button.callback(`👥 Online (${online.total})`, "online_stats"), Markup.button.callback("⚡ Energia", "energia")],
    [Markup.button.callback("💎 VIP", "vip")],
  ];
  if (COMMUNITY_URL) {
    keyboard.push([Markup.button.url("💬 Comunidade", COMMUNITY_URL)]);
  }

  await sendCard(ctx, { fileId: map.image_file_id, caption: captionLines.join("\n"), keyboard });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

async function renderEnergy(ctx) {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await setPlayerState(player.id, STATES.MENU);

  let msg = `⚡ *Energia*\n${player.energy}/${player.energy_max} ${makeBar(
    player.energy,
    player.energy_max,
    10
  )}`;
  if (player.energy < player.energy_max) {
    msg += `\n⏳ +1 em ${formatCooldown(player)}`;
  } else {
    msg += `\n🔋 Completa!`;
  }
  const kb = [];
  if (player.hp < player.hp_max && player.energy > 0) {
    kb.push(Markup.button.callback("🛌 Descansar (-1⚡)", "descansar"));
  }
  kb.push(Markup.button.callback("🏠 Menu", "menu"));

  await sendCard(ctx, { caption: msg, keyboard: [kb] });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

async function renderProfile(ctx) {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const buff = getActiveBuff(player);
  const stats = await getPlayerStats(player);
  const lvlInfo = await getLevelFromTotalXp(player.xp_total);
  const xpBar = makeBar(player.xp_total - lvlInfo.level_xp_start, lvlInfo.xp_to_next || 1, 10);
  const map = await getMapByKey(player.current_map_key);
  const buffText =
    buff && (buff.atk || buff.def || buff.crit)
      ? `\n🧪 Buff: +${buff.atk || 0} ATK / +${buff.def || 0} DEF / +${buff.crit || 0}% CRIT (${formatBuffRemaining(player.temp_buff_expires_at) || "até acabar"})`
      : "";

  const caption =
    `📜 *${player.name || "Aventureiro"}*\n` +
    `Classe: ${player.class || "guerreiro"}\n` +
    `Lv ${lvlInfo.level}  XP: ${player.xp_total} ${lvlInfo.xp_to_next ? `(Próx: ${lvlInfo.xp_to_next})` : ""}\n${xpBar}\n\n` +
    `⚔️ ATK ${stats.total_atk}  🛡️ DEF ${stats.total_def}  🎯 CRIT ${stats.total_crit}%\n` +
    `❤️ HP: ${player.hp}/${stats.total_hp} ${makeBar(player.hp, stats.total_hp, 8)}\n` +
    `⚡ Energia: ${player.energy}/${player.energy_max}\n` +
    `💰 Gold: ${player.gold}\n` +
    `🗺️ Mapa: ${map.name}${buffText}`;

  await sendCard(ctx, { caption, keyboard: [[Markup.button.callback("🏠 Menu", "menu")]] });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

async function renderInventory(ctx) {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await setPlayerState(player.id, STATES.INVENTORY);

  const res = await pool.query(
    `
    SELECT inv.id, inv.item_key, inv.qty, inv.equipped, inv.rolled_atk, inv.rolled_def, inv.rolled_hp, inv.rolled_crit, i.name, i.slot, COALESCE(inv.rolled_rarity, i.rarity) as rarity
    FROM inventory inv
    LEFT JOIN items i ON i.key = inv.item_key
    WHERE inv.player_id = $1
    ORDER BY inv.equipped DESC, i.slot, i.name ASC
  `,
    [player.id]
  );
  
  // Conta slots ocupados (equipados NÃO contam)
  const slotsUsed = res.rows.filter(i => !i.equipped).length;
  const slotsMax = player.inventory_slots_max || 20;

  if (res.rows.length === 0) {
    await sendCard(ctx, {
      caption: `🎒 *Inventário (0/${slotsMax})*\n\nMochila vazia.`,
      keyboard: [[Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery();
    return;
  }

  const rarityEmoji = {
    common: "⚪",
    uncommon: "🟢",
    rare: "🔵",
    epic: "🟣",
    legendary: "🟡"
  };

  const lines = res.rows.map((i) => {
    const rolled = [];
    if (i.rolled_atk) rolled.push(`ATK+${i.rolled_atk}`);
    if (i.rolled_def) rolled.push(`DEF+${i.rolled_def}`);
    if (i.rolled_hp) rolled.push(`HP+${i.rolled_hp}`);
    if (i.rolled_crit) rolled.push(`CRIT+${i.rolled_crit}`);
    const statsText = rolled.length ? ` (${rolled.join(", ")})` : "";
    const effect = CONSUMABLE_EFFECTS[i.item_key];
    const consumableText = effect ? ` (${effect})` : "";
    const qtyText = i.qty > 1 ? ` x${i.qty}` : "";
    const emoji = rarityEmoji[i.rarity] || "⚪";
    const equipTag = i.equipped ? " ⭐" : "";
    return `${emoji} ${i.name}${qtyText}${statsText}${consumableText}${equipTag}`;
  });

  const equipables = res.rows.filter((i) => i.slot !== "consumable");
  const consumables = res.rows.filter((i) => i.slot === "consumable" && CONSUMABLE_EFFECTS[i.item_key]);

  const kb = [];
  if (equipables.length) {
    for (const i of equipables) {
      kb.push([Markup.button.callback(`${i.equipped ? "Desequipar" : "Equipar"} ${i.name}`, `equip_${i.id}`)]);
    }
  }
  if (consumables.length) {
    for (const i of consumables) {
      kb.push([Markup.button.callback(`Usar ${i.name} (${i.qty})`, `usec_${i.item_key}`)]);
    }
  }
  kb.push([Markup.button.callback("🏠 Menu", "menu")]);

  await sendCard(ctx, { 
    caption: `🎒 *Inventário (${slotsUsed}/${slotsMax})*\n\n${lines.join("\n")}\n\n💡 Itens equipados (⭐) não ocupam slots.`, 
    keyboard: kb 
  });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

async function renderTravel(ctx, page = 1) {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const lvlInfo = await getLevelFromTotalXp(player.xp_total);
  await setPlayerState(player.id, STATES.TRAVEL);

  const maps = await getMapList();
  const perPage = 3;
  const totalPages = Math.max(1, Math.ceil(maps.length / perPage));
  const pageNum = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const slice = maps.slice((pageNum - 1) * perPage, pageNum * perPage);

  const keyboard = slice.map((m) => {
    const locked = lvlInfo.level < m.level_min;
    const prefix = m.key === player.current_map_key ? "📍" : locked ? "🔒" : "🗺️";
    const label = `${prefix} ${m.name} (Lv ${m.level_min})`;
    return [Markup.button.callback(label, `travel_select_${m.key}`)];
  });

  const nav = [];
  if (pageNum > 1) nav.push(Markup.button.callback("⬅️ Voltar", `travel_page_${pageNum - 1}`));
  if (pageNum < totalPages) nav.push(Markup.button.callback("Próximo ➡️", `travel_page_${pageNum + 1}`));
  if (nav.length) keyboard.push(nav);
  keyboard.push([Markup.button.callback("🏠 Menu", "menu")]);

  const currentMap = maps.find((m) => m.key === player.current_map_key) || maps[0];
  const caption =
    `🗺️ *Viajar*\n` +
    `Atual: ${currentMap.name}\n` +
    `Level ${lvlInfo.level} | Gold ${player.gold}\n` +
    `Página ${pageNum}/${totalPages}`;

  await sendCard(ctx, { fileId: currentMap.image_file_id, caption, keyboard });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

async function renderClass(ctx) {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  if (player.xp_total > 0) {
    await ctx.reply("Classe só pode ser escolhida na criação do personagem.");
    if (ctx.callbackQuery) ctx.answerCbQuery("Classe já definida");
    return;
  }
  const current = player.class || "guerreiro";
  const caption =
    `🎭 *Escolha sua classe*\n` +
    `Atual: ${current}\n\n` +
    `🛡️ Guerreiro: ${CLASS_CONFIG.guerreiro.desc}\n` +
    `🏹 Arqueiro: ${CLASS_CONFIG.arqueiro.desc}\n` +
    `🔮 Mago: ${CLASS_CONFIG.mago.desc}`;

  const keyboard = [
    [Markup.button.callback("🛡️ Guerreiro", "class_set_guerreiro")],
    [Markup.button.callback("🏹 Arqueiro", "class_set_arqueiro")],
    [Markup.button.callback("🔮 Mago", "class_set_mago")],
    [Markup.button.callback("🏠 Menu", "menu")],
  ];
  if (COMMUNITY_URL) keyboard.splice(1, 0, [Markup.button.url("💬 Entrar na comunidade", COMMUNITY_URL)]);

  await sendCard(ctx, { caption, keyboard });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

// ------------- GAME FLOW -------------
async function startRun(ctx, mapKey) {
  const userId = String(ctx.from.id);
  let player = await getPlayer(userId, ctx.from.first_name);
  const map = await getMapByKey(mapKey || player.current_map_key);
  const lvlInfo = await getLevelFromTotalXp(player.xp_total);

  if (lvlInfo.level < map.level_min) {
    await sendCard(ctx, {
      caption: `🚫 Nível insuficiente para ${map.name} (requer Lv ${map.level_min}).`,
      keyboard: [[Markup.button.callback("🗺️ Viajar", "travel_page_1"), Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery("Nível baixo");
    return;
  }

  player = await regenEnergy(player);
  if (player.energy < 1) {
    await sendCard(ctx, {
      caption: "⚡ Sem energia para caçar.",
      keyboard: [[Markup.button.callback("⚡ Energia", "energia"), Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery("Sem energia");
    return;
  }

  await pool.query("UPDATE players SET energy = energy - 1, last_energy_at = NOW(), current_map_key = $1 WHERE id = $2", [
    map.key,
    player.id,
  ]);
  await setPlayerState(player.id, STATES.RUN);

  const roll = Math.random() * 100;

  if (roll < 78) {
    return startCombat(ctx, player, map, false);
  } else if (roll < 80) {
    return startChest(ctx, player, map);
  } else if (roll < 90) {
    return startTrap(ctx, player, map);
  } else if (roll < 95) {
    return startMerchant(ctx, player, map);
  } else {
    return startCombat(ctx, player, map, true);
  }
}

async function startChest(ctx, player, map) {
  const gold = Math.floor(Math.random() * 10 * map.difficulty) + 20 * map.difficulty;
  await pool.query("UPDATE players SET gold = gold + $1 WHERE id = $2", [gold, player.id]);
  await setPlayerState(player.id, STATES.MENU);

  let lootMsg = "";
  const item = await maybeDropItem(map.key, map.difficulty, false);
  if (item) {
    const result = await awardItem(player.id, item);
    if (result.success) {
      lootMsg = `\n🎁 Item: ${item.name}`;
    } else if (result.reason === 'inventory_full') {
      lootMsg = `\n❌ Inventário cheio! Item ${item.name} foi perdido.`;
    }
  }
  // Chance extra de poção de energia
  if (!item && Math.random() < 0.5) {
    const energyPotion = await pool.query("SELECT * FROM items WHERE key = 'energy_potion'");
    if (energyPotion.rows[0]) {
      const result = await awardItem(player.id, energyPotion.rows[0]);
      if (result.success) {
        lootMsg += `\n⚡ Item: ${energyPotion.rows[0].name}`;
      }
    }
  }

  const caption = `📦 *Baú Encontrado!*\n\nVocê abriu um baú antigo.\n💰 +${gold} Gold${lootMsg}`;
  await sendCard(ctx, {
    fileId: EVENT_IMAGES.chest || map.image_file_id,
    caption,
    keyboard: [[Markup.button.callback("⚔️ Caçar de novo", "action_hunt"), Markup.button.callback("🏠 Menu", "menu")]],
  });
  if (ctx.callbackQuery) ctx.answerCbQuery("Baú!");
}

async function startTrap(ctx, player, map) {
  const dmg = Math.floor(Math.random() * (12 * map.difficulty)) + 10;
  const newHp = player.hp - dmg;
  let caption = `⚠️ *Armadilha!*\n💥 -${dmg} HP`;

  if (newHp <= 0) {
    await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [0, player.id]);
    const pen = await applyDeathPenalty(player);
    caption += `\n\n💀 Você morreu!\n📉 -${pen.xpLoss} XP`;
    await setPlayerState(player.id, STATES.MENU);
  } else {
    await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [newHp, player.id]);
    caption += `\n❤️ HP restante: ${newHp}`;
  }

  await setPlayerState(player.id, STATES.MENU);
  await sendCard(ctx, {
    fileId: EVENT_IMAGES.trap || map.image_file_id,
    caption,
    keyboard: [[Markup.button.callback("⚔️ Caçar de novo", "action_hunt"), Markup.button.callback("🏠 Menu", "menu")]],
  });
  if (ctx.callbackQuery) ctx.answerCbQuery("Armadilha");
}

async function startMerchant(ctx, player, map) {
  const cost = 15 * map.difficulty;
  events.set(String(ctx.from.id), { type: "merchant", cost, mapKey: map.key });
  await setPlayerState(player.id, STATES.RUN);

  const caption =
    `🤝 *Mercador Viajante*\n\n` +
    `"Olá viajante! Precisa de cura?"\n\n` +
    `❤️ Cura completa: ${cost} gold\n` +
    `💰 Seu gold: ${player.gold}`;

  const keyboard = [
    [Markup.button.callback(`Comprar (-${cost}g)`, "merch_buy")],
    [Markup.button.callback("Ignorar", "merch_ignore")],
  ];
  await sendCard(ctx, { fileId: EVENT_IMAGES.merchant || map.image_file_id, caption, keyboard });
  if (ctx.callbackQuery) ctx.answerCbQuery("Mercador!");
}

async function pickMob(mapKey, playerLevel, forceRare = false) {
  let res = await pool.query("SELECT * FROM mobs WHERE map_key = $1 AND level_min <= $2", [mapKey, playerLevel]);
  if (res.rows.length === 0) res = await pool.query("SELECT * FROM mobs WHERE map_key = $1 ORDER BY level_min ASC", [mapKey]);
  if (res.rows.length === 0) res = await pool.query("SELECT * FROM mobs LIMIT 1");

  const weights = { common: 1, uncommon: 0.6, rare: 0.3, boss: 0.1 };
  const candidates = res.rows.map((mob) => {
    const rarity = mob.rarity || "common";
    const baseW = weights[rarity] || 1;
    const w = forceRare ? baseW * (rarity === "common" ? 0.2 : 2) : baseW;
    return { mob, weight: w };
  });

  const total = candidates.reduce((acc, c) => acc + c.weight, 0);
  let roll = Math.random() * total;
  for (const c of candidates) {
    if ((roll -= c.weight) <= 0) return c.mob;
  }
  return candidates[0].mob;
}

async function startCombat(ctx, player, map, isRare) {
  const lvlInfo = await getLevelFromTotalXp(player.xp_total);
  const mob = await pickMob(map.key, lvlInfo.level, isRare);
  const stats = await getPlayerStats(player);

  const fight = {
    mobKey: mob.key,
    mobName: mob.name,
    mobHp: mob.hp,
    mobMaxHp: mob.hp,
    mobAtk: mob.atk,
    mobDef: mob.def,
    mobRarity: mob.rarity,
    mobXp: mob.xp_gain,
    mobGold: mob.gold_gain,
    mobImage: mob.image_file_id,
    mapKey: map.key,
    mapDifficulty: map.difficulty || 1,
    turn: 1,
  };

  fights.set(String(ctx.from.id), fight);
  await setPlayerState(player.id, STATES.COMBAT);

  const caption =
    `⚔️ *COMBATE INICIADO*\n` +
    `${mob.rarity === "boss" ? "👑 " : "👹 "} ${mob.name}\n` +
    `❤️ ${mob.hp}/${mob.hp} ${makeBar(mob.hp, mob.hp, 8)}\n\n` +
    `👤 Você\n` +
    `❤️ ${player.hp}/${stats.total_hp} ${makeBar(player.hp, stats.total_hp, 8)}\n` +
    `⚡ Energia: ${player.energy}/${player.energy_max}`;

  const keyboard = buildCombatKeyboard();

  await sendCard(ctx, { fileId: mob.image_file_id, caption, keyboard });
  if (ctx.callbackQuery) ctx.answerCbQuery("Combate!");
}

async function renderCombatStatus(ctx, player, stats, fight, log) {
  const caption =
    `⚔️ *SEU TURNO*\n` +
    `${fight.mobName}\n` +
    `❤️ HP: ${fight.mobHp}/${fight.mobMaxHp}\n${makeBar(fight.mobHp, fight.mobMaxHp, 8)}\n\n` +
    `👤 Você\n` +
    `❤️ HP: ${player.hp}/${stats.total_hp}\n${makeBar(player.hp, stats.total_hp, 8)}\n` +
    `⚡ Energia: ${player.energy}/${player.energy_max}\n` +
    `🎯 Turno: ${fight.turn}\n` +
    (log ? `\n📜 ${log}` : "");

  const keyboard = buildCombatKeyboard();

  try {
    await ctx.editMessageCaption(caption, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard(keyboard),
    });
  } catch (e) {
    await sendCard(ctx, { fileId: fight.mobImage, caption, keyboard });
  }
}

async function handleAttack(ctx) {
  const userId = String(ctx.from.id);
  const fight = fights.get(userId);
  if (!fight) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Luta acabou.");
    return;
  }

  let player = await getPlayer(userId, ctx.from.first_name);
  const stats = await getPlayerStats(player);

  const isCrit = Math.random() * 100 < stats.total_crit;
  const pDmg = rollDamage(stats.total_atk, fight.mobDef, isCrit);
  fight.mobHp -= pDmg;
  let log = `${isCrit ? "🔥 CRÍTICO! " : ""}Você causou ${pDmg} de dano.`;

  if (fight.mobHp <= 0) {
    fights.delete(userId);
    const item = await maybeDropItem(fight.mapKey, fight.mapDifficulty, fight.mobRarity === "boss");
    await pool.query("UPDATE players SET xp_total = xp_total + $1, gold = gold + $2 WHERE id = $3", [
      fight.mobXp,
      fight.mobGold,
      player.id,
    ]);
    
    let itemMsg = "";
    let lootImage = fight.mobImage;
    if (item) {
      const result = await awardItem(player.id, item);
      if (result.success) {
        const statsText = result.rolled ? formatRolledStats(result.rolled) : "";
        itemMsg = `\n🎁 Item: ${item.name}${statsText}`;
        lootImage = item.image_file_id || EVENT_IMAGES.loot_item || lootImage;
      } else if (result.reason === 'inventory_full') {
        itemMsg = `\n❌ Inventário cheio (20/20)! Item ${item.name} foi perdido.`;
      }
    } else if (fight.mobGold > 0 && EVENT_IMAGES.loot_gold) {
      lootImage = EVENT_IMAGES.loot_gold;
    }
    
    await setPlayerState(player.id, STATES.MENU);

    const reward =
      `🏆 *Vitória!*\n` +
      `+${fight.mobXp} XP\n` +
      `+${fight.mobGold} Gold${itemMsg}`;
    await sendCard(ctx, {
      fileId: lootImage,
      caption: reward,
      keyboard: [[Markup.button.callback("⚔️ Caçar de novo", "action_hunt"), Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery("Venceu!");
    return;
  }

  // Mob attack
  const mDmg = rollDamage(fight.mobAtk, stats.total_def, false);
  const newHp = Math.max(0, player.hp - mDmg);
  await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [newHp, player.id]);
  player.hp = newHp;
  log += `\n💔 ${fight.mobName} causou ${mDmg} de dano.`;

  if (newHp <= 0) {
    fights.delete(userId);
    const pen = await applyDeathPenalty(player);
    await setPlayerState(player.id, STATES.MENU);
    await sendCard(ctx, {
      fileId: fight.mobImage,
      caption: `💀 *DERROTA*\nPerdeu ${pen.xpLoss} XP.\nHP restaurado para ${pen.newHp}.`,
      keyboard: [[Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery("Morreu!");
    return;
  }

  fight.turn += 1;
  await renderCombatStatus(ctx, player, stats, fight, log);
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

async function handleFlee(ctx) {
  const userId = String(ctx.from.id);
  fights.delete(userId);
  const player = await getPlayer(userId, ctx.from.first_name);
  await setPlayerState(player.id, STATES.MENU);
  await sendCard(ctx, {
    caption: "🏃 Você fugiu da batalha.",
    keyboard: [[Markup.button.callback("🏠 Menu", "menu")]],
  });
  if (ctx.callbackQuery) ctx.answerCbQuery("Fugiu");
}

async function listConsumables(playerId) {
  const res = await pool.query(
    `
    SELECT inv.item_key, SUM(inv.qty)::int AS qty, i.name
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    WHERE inv.player_id = $1 AND inv.slot = 'consumable' AND inv.qty > 0
    GROUP BY inv.item_key, i.name
    ORDER BY i.name
    `,
    [playerId]
  );
  return res.rows;
}

async function handleConsumables(ctx) {
  const userId = String(ctx.from.id);
  const fight = fights.get(userId);
  if (!fight) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Luta acabou.");
    return;
  }
  const player = await getPlayer(userId, ctx.from.first_name);
  const items = await listConsumables(player.id);
  if (!items.length) {
    await ctx.reply("❌ Você não tem consumíveis.");
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }

  const keyboard = items.map((it) => [Markup.button.callback(`${it.name} (${it.qty})`, `combat_use:${it.item_key}`)]);
  keyboard.push([Markup.button.callback("⬅️ Voltar", "combat_attack")]);

  await ctx.reply("🧪 Escolha um consumível (gasta o turno):", {
    reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
  });
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
}

async function processMobAttack(ctx, fight, player, stats, logPrefix = "") {
  // Mob attack
  const mDmg = rollDamage(fight.mobAtk, stats.total_def, false);
  const newHp = Math.max(0, player.hp - mDmg);
  await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [newHp, player.id]);
  player.hp = newHp;
  let log = logPrefix ? `${logPrefix}\n` : "";
  log += `💔 ${fight.mobName} causou ${mDmg} de dano.`;

  if (newHp <= 0) {
    fights.delete(String(player.telegram_id || ctx.from.id));
    const pen = await applyDeathPenalty(player);
    await setPlayerState(player.id, STATES.MENU);
    await sendCard(ctx, {
      fileId: fight.mobImage,
      caption: `💀 *DERROTA*\nPerdeu ${pen.xpLoss} XP.\nHP restaurado para ${pen.newHp}.`,
      keyboard: [[Markup.button.callback("🏠 Menu", "menu")]],
    });
    if (ctx.callbackQuery) ctx.answerCbQuery("Morreu!").catch(() => {});
    return;
  }

  fight.turn += 1;
  await renderCombatStatus(ctx, player, stats, fight, log);
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
}

async function handleUseConsumable(ctx) {
  const userId = String(ctx.from.id);
  const fight = fights.get(userId);
  if (!fight) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Luta acabou.");
    return;
  }
  const key = ctx.match && ctx.match[1];
  if (!key) {
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }

  let player = await getPlayer(userId, ctx.from.first_name);
  let result;
  try {
    result = await useConsumable(player, key);
  } catch (e) {
    result = { ok: false, message: "Erro ao usar consumível." };
  }

  if (!result.ok) {
    await ctx.reply(result.message || "Não foi possível usar este item.");
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }

  // Atualiza player/stats após uso
  player = await getPlayer(userId, ctx.from.first_name);
  const stats = await getPlayerStats(player);
  const logMsg = `🧪 ${result.message || "Consumível usado."}`;

  // Passa o turno para o mob atacar
  await processMobAttack(ctx, fight, player, stats, logMsg);
}

// ------------- CALLBACKS & COMMANDS -------------
bot.start(renderMenu);
bot.command("menu", renderMenu);
bot.action("menu", renderMenu);

bot.command("energia", renderEnergy);
bot.action("energia", renderEnergy);

bot.command("descansar", async (ctx) => {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const stats = await getPlayerStats(player);
  if (player.energy < 1) return ctx.reply("⚠️ Sem energia para descansar.");
  await pool.query("UPDATE players SET energy = energy - 1, hp = $1 WHERE id = $2", [stats.total_hp, player.id]);
  return renderEnergy(ctx);
});

bot.action("descansar", async (ctx) => {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const stats = await getPlayerStats(player);
  if (player.energy < 1) {
    await ctx.answerCbQuery("Sem energia");
    return renderEnergy(ctx);
  }
  await pool.query("UPDATE players SET energy = energy - 1, hp = $1 WHERE id = $2", [stats.total_hp, player.id]);
  await ctx.answerCbQuery("Descansou");
  return renderEnergy(ctx);
});

bot.command("perfil", renderProfile);
bot.action("perfil", renderProfile);

bot.command("inventario", renderInventory);
bot.action("inventario", renderInventory);

bot.command("classe", renderClass);
bot.action("classe", renderClass);

bot.command("comunidade", async (ctx) => {
  if (!COMMUNITY_URL) return ctx.reply("Link da comunidade não configurado.");
  return ctx.reply(`💬 Entre na comunidade: ${COMMUNITY_URL}`);
});

bot.action("trade_start", async (ctx) => {
  const userId = String(ctx.from.id);
  const existing = findTradeByUser(userId);
  if (existing) {
    await renderTrade(ctx, existing.session);
  } else {
    await renderTradeHome(ctx);
  }
});

bot.action("arena_queue", async (ctx) => {
  const userId = String(ctx.from.id);
  if (isInArenaQueue(userId) || arenaFights.has(userId)) {
    await ctx.answerCbQuery("Você já está na arena.");
    return;
  }
  arenaQueue.push(userId);
  await ctx.answerCbQuery("Fila da arena");
  await ctx.reply("⏳ Aguardando oponente na arena...", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  await tryMatchArena();
});

async function renderOnlineStats(ctx) {
  const maps = await getMapList();
  const mapName = new Map(maps.map((m) => [m.key, m.name]));
  const online = await getOnlineStats();
  const lines = [];
  lines.push(`🌐 Total (últimos ${ONLINE_WINDOW_MINUTES} min): ${online.total}`);
  if (online.byMap.length) {
    lines.push("📍 Por mapa:");
    for (const row of online.byMap) {
      lines.push(`- ${mapName.get(row.current_map_key) || row.current_map_key}: ${row.qty}`);
    }
  }
  await sendCard(ctx, {
    caption: `👥 Jogadores Online\n${lines.join("\n")}`,
    keyboard: [[Markup.button.callback("🏠 Menu", "menu")]],
  });
  if (ctx.callbackQuery) ctx.answerCbQuery();
}

bot.action("online_stats", renderOnlineStats);

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

bot.action(/trade_offer_pick_(.+)/, async (ctx) => {
  const payload = ctx.match[1];
  const last = payload.lastIndexOf("_p_");
  const itemKey = last >= 0 ? payload.slice(0, last) : payload;
  const page = last >= 0 ? Number(payload.slice(last + 3) || "1") : 1;
  const userId = String(ctx.from.id);
  const found = findTradeByUser(userId);
  if (!found) return ctx.answerCbQuery("Sem troca");
  if (found.session.expires < Date.now()) {
    tradeSessions.delete(found.code);
    await ctx.answerCbQuery("Expirou");
    return ctx.reply("Troca expirada.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  }
  const qty = await getItemQty((await getPlayer(userId)).id, itemKey);
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
    [Markup.button.callback("⬅️ Voltar", `trade_offer_page_${page}`)],
  ];
  await sendCard(ctx, {
    caption: `📦 Selecionar quantidade\nItem: ${itemKey}\nVocê tem: ${qty}`,
    keyboard: buttons,
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
  const stock = await getItemQty(player.id, itemKey);
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

bot.action(/class_set_(.+)/, async (ctx) => {
  const cls = ctx.match[1];
  const cfg = CLASS_CONFIG[cls];
  if (!cfg) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Classe inválida");
    return;
  }
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  if (player.xp_total > 0) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Classe já definida");
    return;
  }
  await pool.query(
    `
    UPDATE players
    SET class = $1,
        base_atk = $2,
        base_def = $3,
        base_crit = $4,
        hp_max = $5,
        hp = LEAST(hp, $5)
    WHERE id = $6
    `,
    [cls, cfg.base_atk, cfg.base_def, cfg.base_crit, cfg.hp_max, player.id]
  );
  await setPlayerState(player.id, STATES.MENU);
  await ctx.answerCbQuery(`Classe definida: ${cls}`);
  return renderMenu(ctx);
});

bot.command("usar", async (ctx) => {
  const parts = ctx.message.text.split(" ");
  const itemKey = (parts[1] || "").trim();
  if (!itemKey) return ctx.reply("Use: /usar <item_key>");
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const res = await useConsumable(player, itemKey);
  if (!res.ok) return ctx.reply(res.message);
  await ctx.reply(res.message, Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
});

bot.action(/usec_(.+)/, async (ctx) => {
  const key = ctx.match[1];
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const res = await useConsumable(player, key);
  if (!res.ok) {
    await ctx.answerCbQuery(res.message, { show_alert: true });
    return renderInventory(ctx);
  }
  await ctx.answerCbQuery("Consumido");
  await ctx.reply(res.message, Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  return renderInventory(ctx);
});

// ---------- TRADE (troca entre jogadores) ----------
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
  const res = await pool.query(
    `
    SELECT inv.item_key, SUM(inv.qty) as qty, i.name, i.rarity, i.slot
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    WHERE inv.player_id = $1 AND inv.qty > 0
    GROUP BY inv.item_key, i.name, i.rarity, i.slot
    ORDER BY i.slot ASC, i.rarity DESC, i.name ASC
  `,
    [player.id]
  );
  const items = res.rows;
  if (items.length === 0) {
    await sendCard(ctx, { caption: "Mochila vazia.", keyboard: [[Markup.button.callback("🏠 Menu", "menu")]] });
    if (ctx.callbackQuery) ctx.answerCbQuery();
    return;
  }
  const perPage = 5;
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const pageNum = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const slice = items.slice((pageNum - 1) * perPage, pageNum * perPage);

  const kb = slice.map((i) => [
    Markup.button.callback(`${i.name} x${i.qty} [${i.rarity}]`, `trade_offer_pick_${i.item_key}_p_${pageNum}`),
  ]);
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
  
  // Busca stats dos itens sendo oferecidos
  const getOfferText = async (playerId, offer) => {
    if (!offer) return "Nenhuma";
    
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
    `🤝 *Troca*\n` +
    `Código: \`${session.code}\`\n` +
    `Dono: ${owner.name}\n` +
    `Convidado: ${guest ? guest.name : "aguardando"}\n\n` +
    `📦 Oferta de ${owner.name}:\n${ownerOfferText}\n\n` +
    `📦 Oferta de ${guest ? guest.name : "???"}: \n${guestOfferText}\n\n` +
    `Confirmações: dono ${session.confirmed.owner ? "✅" : "❌"} | convidado ${session.confirmed.guest ? "✅" : "❌"}\n` +
    `Expira em: ${Math.max(0, Math.floor((session.expires - Date.now()) / 60000))} min`;

  await sendCard(ctx, {
    caption,
    keyboard: [
      [Markup.button.callback("🧳 Minha oferta", "trade_offer"), Markup.button.callback("🔁 Atualizar", "trade_refresh")],
      [Markup.button.callback("✅ Confirmar", "trade_confirm"), Markup.button.callback("🧹 Limpar oferta", "trade_clear")],
      [Markup.button.callback("❌ Cancelar", "trade_cancel"), Markup.button.callback("🚪 Sair", "trade_exit")],
      [Markup.button.callback("🏠 Menu", "menu")],
    ],
  });
}

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
    
    if (ownerOffer && !(await hasItemQty(owner.id, ownerOffer.item_key, ownerOffer.qty))) {
      session.confirmed = { owner: false, guest: false };
      return ctx.answerCbQuery("Dono sem item suficiente.");
    }
    if (guestOffer && !(await hasItemQty(guest.id, guestOffer.item_key, guestOffer.qty))) {
      session.confirmed = { owner: false, guest: false };
      return ctx.answerCbQuery("Convidado sem item suficiente.");
    }
    
    // Valida slots do destinatário
    if (ownerOffer) {
      const guestSlotsRes = await pool.query(`
        SELECT COUNT(*) as used FROM inventory WHERE player_id = $1 AND equipped = FALSE
      `, [guest.id]);
      const guestSlots = parseInt(guestSlotsRes.rows[0].used);
      if (guestSlots + ownerOffer.qty > 20) {
        session.confirmed = { owner: false, guest: false };
        return ctx.answerCbQuery("Inventário do convidado está cheio!");
      }
    }
    if (guestOffer) {
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
    if (ownerOffer) {
      // Busca itens do owner com stats
      const ownerItemsRes = await pool.query(`
        SELECT id, item_key, slot, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity
        FROM inventory
        WHERE player_id = $1 AND item_key = $2 AND equipped = FALSE
        LIMIT $3
      `, [owner.id, ownerOffer.item_key, ownerOffer.qty]);
      
      for (const item of ownerItemsRes.rows) {
        // Remove do owner
        await pool.query('DELETE FROM inventory WHERE id = $1', [item.id]);
        
        // Adiciona ao guest COM OS MESMOS STATS
        await pool.query(`
          INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
          VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
        `, [guest.id, item.item_key, item.slot, item.rolled_atk, item.rolled_def, item.rolled_hp, item.rolled_crit, item.rolled_rarity]);
      }
    }
    
    if (guestOffer) {
      // Busca itens do guest com stats
      const guestItemsRes = await pool.query(`
        SELECT id, item_key, slot, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity
        FROM inventory
        WHERE player_id = $1 AND item_key = $2 AND equipped = FALSE
        LIMIT $3
      `, [guest.id, guestOffer.item_key, guestOffer.qty]);
      
      for (const item of guestItemsRes.rows) {
        // Remove do guest
        await pool.query('DELETE FROM inventory WHERE id = $1', [item.id]);
        
        // Adiciona ao owner COM OS MESMOS STATS
        await pool.query(`
          INSERT INTO inventory (player_id, item_key, slot, qty, rolled_atk, rolled_def, rolled_hp, rolled_crit, rolled_rarity, equipped)
          VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, FALSE)
        `, [owner.id, item.item_key, item.slot, item.rolled_atk, item.rolled_def, item.rolled_hp, item.rolled_crit, item.rolled_rarity]);
      }
    }
    
    // Atualiza contadores de slots
    await pool.query(`
      UPDATE players
      SET inventory_slots_used = (
        SELECT COUNT(*) FROM inventory WHERE player_id = $1 AND equipped = FALSE
      )
      WHERE id = $1
    `, [owner.id]);
    
    await pool.query(`
      UPDATE players
      SET inventory_slots_used = (
        SELECT COUNT(*) FROM inventory WHERE player_id = $1 AND equipped = FALSE
      )
      WHERE id = $1
    `, [guest.id]);
    
    tradeSessions.delete(found.code);
    await ctx.answerCbQuery("Troca concluída!");
    await ctx.reply("✅ Troca concluída!", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  } else {
    await ctx.answerCbQuery("Confirmação registrada");
    await renderTrade(ctx, session);
  }
});

// ---------- ARENA (PvP simples) ----------
function isInArenaQueue(userId) {
  return arenaQueue.includes(userId);
}

async function startArenaFight(p1Id, p2Id) {
  const p1 = await getPlayer(p1Id);
  const p2 = await getPlayer(p2Id);
  const s1 = await getPlayerStats(p1);
  const s2 = await getPlayerStats(p2);

  const fight1 = {
    opponentId: p2Id,
    hp: p1.hp,
    maxHp: s1.total_hp,
    atk: s1.total_atk,
    def: s1.total_def,
    crit: s1.total_crit,
    turn: 1,
  };
  const fight2 = {
    opponentId: p1Id,
    hp: p2.hp,
    maxHp: s2.total_hp,
    atk: s2.total_atk,
    def: s2.total_def,
    crit: s2.total_crit,
    turn: 1,
  };
  arenaFights.set(p1Id, fight1);
  arenaFights.set(p2Id, fight2);

  await bot.telegram.sendMessage(
    p1Id,
    `🏟️ Arena iniciada contra ${p2.name}\nHP: ${fight1.hp}/${fight1.maxHp}`,
    { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⚔️ Atacar", "arena_attack"), Markup.button.callback("🏳️ Desistir", "arena_surrender")]]).reply_markup }
  );
  await bot.telegram.sendMessage(
    p2Id,
    `🏟️ Arena iniciada contra ${p1.name}\nHP: ${fight2.hp}/${fight2.maxHp}`,
    { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⚔️ Atacar", "arena_attack"), Markup.button.callback("🏳️ Desistir", "arena_surrender")]]).reply_markup }
  );
}

async function tryMatchArena() {
  if (arenaQueue.length < 2) return;
  const p1Id = arenaQueue.shift();
  const p2Id = arenaQueue.shift();
  await startArenaFight(p1Id, p2Id);
}

async function renderArenaStatus(userId, log) {
  const fight = arenaFights.get(userId);
  if (!fight) return;
  const opponentFight = arenaFights.get(fight.opponentId);
  const user = await getPlayer(userId);
  const opp = await getPlayer(fight.opponentId);
  const caption =
    `🏟️ Arena vs ${opp.name}\n` +
    `Você: ${fight.hp}/${fight.maxHp} ${makeBar(fight.hp, fight.maxHp, 8)}\n` +
    `${opp.name}: ${opponentFight?.hp ?? 0}/${opponentFight?.maxHp ?? 0}\n` +
    (log ? `\n${log}` : "");

  await bot.telegram.sendMessage(
    userId,
    caption,
    { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⚔️ Atacar", "arena_attack"), Markup.button.callback("🏳️ Desistir", "arena_surrender")]]).reply_markup }
  );
}

bot.command("arena", async (ctx) => {
  const userId = String(ctx.from.id);
  if (isInArenaQueue(userId) || arenaFights.has(userId)) return ctx.reply("Você já está na arena.");
  arenaQueue.push(userId);
  await ctx.reply("⏳ Aguardando oponente na arena...");
  await tryMatchArena();
});

bot.command("arena_cancel", async (ctx) => {
  const userId = String(ctx.from.id);
  const idx = arenaQueue.indexOf(userId);
  if (idx >= 0) {
    arenaQueue.splice(idx, 1);
    return ctx.reply("Fila da arena cancelada.");
  }
  ctx.reply("Você não está na fila.");
});

bot.action("arena_attack", async (ctx) => {
  const userId = String(ctx.from.id);
  const fight = arenaFights.get(userId);
  if (!fight) return ctx.answerCbQuery("Sem luta");
  const oppFight = arenaFights.get(fight.opponentId);
  if (!oppFight) {
    arenaFights.delete(userId);
    return ctx.answerCbQuery("Oponente indisponível");
  }

  const isCrit = Math.random() * 100 < fight.crit;
  const dmg = rollDamage(fight.atk, oppFight.def, isCrit);
  oppFight.hp = Math.max(0, oppFight.hp - dmg);

  let log = `${isCrit ? "🔥 CRIT! " : ""}Você causou ${dmg} dano.`;

  if (oppFight.hp <= 0) {
    const winner = await getPlayer(userId);
    const loser = await getPlayer(fight.opponentId);
    const trophyGain = 15;
    const trophyLoss = 10;
    await pool.query("UPDATE players SET trophies = GREATEST(0, trophies + $1), arena_coins = arena_coins + $2 WHERE id = $3", [
      trophyGain,
      5,
      winner.id,
    ]);
    await pool.query("UPDATE players SET trophies = GREATEST(0, trophies - $1) WHERE id = $2", [trophyLoss, loser.id]);
    arenaFights.delete(userId);
    arenaFights.delete(fight.opponentId);
    await ctx.answerCbQuery("Vitória!");
    await ctx.reply(`🏆 Você venceu ${loser.name}!\n+${trophyGain} troféus\n+5 arena coins`);
    await bot.telegram.sendMessage(fight.opponentId, `😵 Você perdeu para ${winner.name}\n-${trophyLoss} troféus`);
    return;
  }

  // Oponente contra-ataca automaticamente
  const oppCrit = Math.random() * 100 < oppFight.crit;
  const oppDmg = rollDamage(oppFight.atk, fight.def, oppCrit);
  fight.hp = Math.max(0, fight.hp - oppDmg);
  log += `\n${oppCrit ? "🔥 CRIT! " : ""}Oponente causou ${oppDmg} dano em você.`;

  if (fight.hp <= 0) {
    const winner = await getPlayer(fight.opponentId);
    const loser = await getPlayer(userId);
    const trophyGain = 15;
    const trophyLoss = 10;
    await pool.query("UPDATE players SET trophies = GREATEST(0, trophies + $1), arena_coins = arena_coins + $2 WHERE id = $3", [
      trophyGain,
      5,
      winner.id,
    ]);
    await pool.query("UPDATE players SET trophies = GREATEST(0, trophies - $1) WHERE id = $2", [trophyLoss, loser.id]);
    arenaFights.delete(userId);
    arenaFights.delete(fight.opponentId);
    await ctx.answerCbQuery("Derrota");
    await ctx.reply(`😵 Você perdeu para ${winner.name}\n-${trophyLoss} troféus`);
    await bot.telegram.sendMessage(fight.opponentId, `🏆 Você venceu ${loser.name}!\n+${trophyGain} troféus\n+5 arena coins`);
    return;
  }

  await ctx.answerCbQuery();
  await renderArenaStatus(userId, log);
  await renderArenaStatus(fight.opponentId, `Você recebeu ${dmg} e causou ${oppDmg}`);
});

bot.action("arena_surrender", async (ctx) => {
  const userId = String(ctx.from.id);
  const fight = arenaFights.get(userId);
  if (!fight) return ctx.answerCbQuery("Sem luta");
  const winner = await getPlayer(fight.opponentId);
  const loser = await getPlayer(userId);
  const trophyGain = 10;
  const trophyLoss = 8;
  await pool.query("UPDATE players SET trophies = GREATEST(0, trophies + $1), arena_coins = arena_coins + $2 WHERE id = $3", [
    trophyGain,
    3,
    winner.id,
  ]);
  await pool.query("UPDATE players SET trophies = GREATEST(0, trophies - $1) WHERE id = $2", [trophyLoss, loser.id]);
  arenaFights.delete(userId);
  arenaFights.delete(fight.opponentId);
  await ctx.answerCbQuery("Desistiu");
  await ctx.reply(`Você desistiu. -${trophyLoss} troféus.`);
  await bot.telegram.sendMessage(fight.opponentId, `Oponente desistiu. +${trophyGain} troféus, +3 arena coins`);
});

// ---------- DUNGEONS (co-op simples) ----------
async function renderDungeonStatus(session) {
  const names = [];
  for (const uid of session.members) {
    const p = await getPlayer(uid);
    names.push(p.name);
  }
  for (const uid of session.members) {
    await bot.telegram.sendMessage(
      uid,
      `🗝️ Masmorra ${session.code} (Dif ${session.difficulty})\nDono: ${session.ownerId === uid ? "você" : ""}\nMembros: ${names.join(", ")}\nEstado: ${session.state}`,
      { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🚀 Começar", `dungeon_start_${session.code}`)], [Markup.button.callback("🏠 Menu", "menu")]]).reply_markup }
    );
  }
}

async function runDungeon(session) {
  session.state = "running";
  const owner = await getPlayer(session.ownerId);
  const map = await getMapByKey(owner.current_map_key);
  const mob = await pickMob(map.key, (await getLevelFromTotalXp(owner.xp_total)).level, session.difficulty >= 3);
  const scale = 1 + 0.5 * (session.members.size - 1);
  const mobHpBase = Math.round(mob.hp * scale * (0.8 + 0.2 * session.difficulty));
  let mobHp = mobHpBase;
  const mobDef = mob.def || 0;
  let log = `👹 ${mob.name} (HP ${mobHpBase})\n`;

  for (const uid of session.members) {
    const p = await getPlayer(uid);
    const stats = await getPlayerStats(p);
    const dmg = rollDamage(stats.total_atk, mobDef, Math.random() * 100 < stats.total_crit);
    mobHp = Math.max(0, mobHp - dmg);
    log += `• ${p.name} causou ${dmg}. HP do chefe: ${mobHp}\n`;
    if (mobHp <= 0) break;
  }

  if (mobHp > 0) {
    // chefe ataca todo mundo leve
    for (const uid of session.members) {
      const p = await getPlayer(uid);
      const dmg = rollDamage(mob.atk, (await getPlayerStats(p)).total_def, false);
      const newHp = Math.max(0, p.hp - dmg);
      await pool.query("UPDATE players SET hp = $1 WHERE id = $2", [newHp, p.id]);
      log += `${p.name} levou ${dmg} (HP agora ${newHp}).\n`;
    }
  }

  if (mobHp <= 0) {
    const rewardXp = Math.round(mob.xp_gain * session.difficulty * scale);
    const rewardGold = Math.round(mob.gold_gain * session.difficulty * scale);
    for (const uid of session.members) {
      const p = await getPlayer(uid);
      await pool.query("UPDATE players SET xp_total = xp_total + $1, gold = gold + $2 WHERE id = $3", [rewardXp, rewardGold, p.id]);
      const item = await maybeDropItem(map.key, map.difficulty, mob.rarity === "boss");
      if (item) await awardItem(p.id, item);
      await bot.telegram.sendMessage(
        uid,
        `🏅 Masmorra concluída!\nRecompensas: +${rewardXp} XP, +${rewardGold} Gold${item ? `\nLoot: ${item.name}` : ""}`
      );
    }
  } else {
    for (const uid of session.members) {
      await bot.telegram.sendMessage(uid, `⚔️ Masmorra falhou!\n${log}`);
    }
  }

  dungeons.delete(session.code);
}

bot.command("dungeon_create", async (ctx) => {
  const parts = ctx.message.text.split(" ");
  const diff = Math.min(5, Math.max(1, parseInt(parts[1] || "1", 10)));
  const password = parts[2] || null;
  const userId = String(ctx.from.id);
  const existing = Array.from(dungeons.values()).find((d) => d.ownerId === userId);
  if (existing) return ctx.reply(`Você já tem uma masmorra: código ${existing.code}`);
  const player = await getPlayer(userId, ctx.from.first_name);
  if (!(await hasItemQty(player.id, "dungeon_key", 1))) return ctx.reply("Você precisa de 1 Chave de Masmorra.");
  await consumeItem(player.id, "dungeon_key", 1);
  const code = genCode(5);
  dungeons.set(code, { code, difficulty: diff, password, ownerId: userId, state: "open", members: new Set([userId]) });
  ctx.reply(`Masmorra criada! Código: ${code}${password ? ` Senha: ${password}` : ""}\nConvide amigos com /dungeon_join ${code} ${password || ""}`);
  await renderDungeonStatus(dungeons.get(code));
});

bot.command("dungeon_join", async (ctx) => {
  const parts = ctx.message.text.split(" ");
  const code = parts[1];
  const password = parts[2] || null;
  const userId = String(ctx.from.id);
  if (!code) return ctx.reply("Use: /dungeon_join <codigo> [senha]");
  const session = dungeons.get(code);
  if (!session) return ctx.reply("Código inválido.");
  if (session.password && session.password !== password) return ctx.reply("Senha incorreta.");
  if (session.state !== "open") return ctx.reply("Masmorra já iniciou.");
  if (session.members.size >= 3) return ctx.reply("Masmorra cheia (máx 3).");
  session.members.add(userId);
  ctx.reply(`Você entrou na masmorra ${code}.`);
  await renderDungeonStatus(session);
});

bot.action(/dungeon_start_(.+)/, async (ctx) => {
  const code = ctx.match[1];
  const session = dungeons.get(code);
  if (!session) return ctx.answerCbQuery("Não existe.");
  if (session.ownerId !== String(ctx.from.id)) return ctx.answerCbQuery("Somente o dono inicia.");
  if (session.state !== "open") return ctx.answerCbQuery("Já iniciada.");
  await ctx.answerCbQuery("Iniciando masmorra");
  await runDungeon(session);
});

bot.action(/travel_page_(.+)/, async (ctx) => {
  const page = ctx.match[1];
  await renderTravel(ctx, page);
});

bot.action("travel", renderTravel);

bot.action(/travel_select_(.+)/, async (ctx) => {
  const key = ctx.match[1];
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const map = await getMapByKey(key);
  const lvlInfo = await getLevelFromTotalXp(player.xp_total);

  if (lvlInfo.level < map.level_min) {
    await ctx.answerCbQuery("Nível insuficiente.");
    return;
  }

  await pool.query("UPDATE players SET current_map_key = $1 WHERE id = $2", [map.key, player.id]);
  await setPlayerState(player.id, STATES.TRAVEL);

  const caption =
    `🧭 Destino definido: *${map.name}*\n` +
    `Requer Lv ${map.level_min}\n` +
    `Dificuldade ${map.difficulty}`;

  const keyboard = [
    [Markup.button.callback("⚔️ Caçar aqui", `hunt_${map.key}`)],
    [Markup.button.callback("⬅️ Voltar", "travel_page_1"), Markup.button.callback("🏠 Menu", "menu")],
  ];
  await sendCard(ctx, { fileId: map.image_file_id, caption, keyboard });
  if (ctx.callbackQuery) ctx.answerCbQuery("Destino salvo");
});

bot.action("action_hunt", async (ctx) => startRun(ctx));
bot.action(/hunt_(.+)/, async (ctx) => {
  const key = ctx.match[1];
  await startRun(ctx, key);
});

bot.action("merch_buy", async (ctx) => {
  const userId = String(ctx.from.id);
  const event = events.get(userId);
  if (!event) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Mercador saiu.");
    return;
  }

  const player = await getPlayer(userId, ctx.from.first_name);
  if (player.gold < event.cost) {
    await ctx.reply("🚫 Gold insuficiente!");
    if (ctx.callbackQuery) ctx.answerCbQuery("Sem gold");
    return;
  }

  await pool.query("UPDATE players SET gold = gold - $1, hp = hp_max WHERE id = $2", [event.cost, player.id]);
  events.delete(userId);
  await setPlayerState(player.id, STATES.MENU);

  await ctx.reply("🤝 Você comprou uma poção e recuperou toda a vida!", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  if (ctx.callbackQuery) ctx.answerCbQuery();
});

bot.action("merch_ignore", async (ctx) => {
  events.delete(String(ctx.from.id));
  await ctx.reply("Você ignorou o mercador.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  if (ctx.callbackQuery) ctx.answerCbQuery();
});

bot.action("combat_attack", handleAttack);
bot.action("combat_flee", handleFlee);
bot.action("combat_consumables", handleConsumables);
bot.action(/^combat_use:(.+)$/, handleUseConsumable);

bot.action(/equip_(.+)/, async (ctx) => {
  const id = ctx.match[1];
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);

  const res = await pool.query(
    `
    SELECT inv.id, inv.equipped, i.slot, i.key as item_key, i.name
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    WHERE inv.id = $1 AND inv.player_id = $2
  `,
    [id, player.id]
  );
  if (res.rows.length === 0) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Item não encontrado");
    return;
  }

  const item = res.rows[0];
  if (item.slot === "weapon") {
    const allowed = CLASS_WEAPONS[player.class] || [];
    if (!allowed.includes(item.item_key)) {
      await ctx.answerCbQuery("Sua classe não pode usar essa arma.");
      return;
    }
  }
  if (item.slot === "consumable") {
    await ctx.answerCbQuery("Use /usar <item> para consumíveis");
    return;
  }
  if (item.equipped) {
    await pool.query("UPDATE inventory SET equipped = false WHERE id = $1", [id]);
    await ctx.answerCbQuery("Item desequipado");
  } else {
    await pool.query(
      "UPDATE inventory inv SET equipped = false FROM items i WHERE inv.player_id = $1 AND inv.item_key = i.key AND i.slot = $2",
      [player.id, item.slot]
    );
    await pool.query("UPDATE inventory SET equipped = true WHERE id = $1", [id]);
    await ctx.answerCbQuery("Item equipado");
  }

  return renderInventory(ctx);
});

// ==================== SISTEMA DE LOJA ====================

bot.command("loja", async (ctx) => {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await renderShopHome(ctx, player);
});

bot.command(["comprar", "vender"], async (ctx) => {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await renderShopHome(ctx, player);
  await ctx.reply("Use os botões da loja para comprar ou vender itens.", { reply_markup: Markup.inlineKeyboard([[Markup.button.callback("🏪 Abrir lojas", "loja_menu")]]).reply_markup });
});

bot.action("loja_menu", async (ctx) => {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await renderShopHome(ctx, player);
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action(/^shop_open:(.+)$/, async (ctx) => {
  const shopKey = ctx.match[1];
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await renderShopView(ctx, player, shopKey);
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action(/^shop_buylist:(.+)$/, async (ctx) => {
  const shopKey = ctx.match[1];
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await renderShopBuyList(ctx, player, shopKey);
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action(/^shop_item:([^:]+):([^:]+)$/, async (ctx) => {
  const [, shopKey, itemKey] = ctx.match;
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  await renderShopItemDetail(ctx, player, shopKey, itemKey);
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action(/^shop_buy:([^:]+):([^:]+):(\d+)$/, async (ctx) => {
  const [, shopKey, itemKey, qtyRaw] = ctx.match;
  const qty = Math.max(1, Math.min(20, parseInt(qtyRaw, 10) || 1));
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);

  const def = SHOP_DEFS[shopKey];
  if (!def || !def.items.includes(itemKey)) {
    if (ctx.callbackQuery) ctx.answerCbQuery("Item indisponível").catch(() => {});
    return;
  }

  const res = await pool.query(
    `
    SELECT s.*, i.name, i.slot, i.rarity, i.atk_min, i.atk_max, i.def_min, i.def_max, i.hp_min, i.hp_max, i.crit_min, i.crit_max
    FROM shop_items s
    JOIN items i ON i.key = s.item_key
    WHERE s.item_key = $1 AND s.available = TRUE AND s.buy_price IS NOT NULL
    `,
    [itemKey]
  );
  if (!res.rows.length) {
    await ctx.reply("❌ Item não encontrado ou indisponível.");
    return;
  }
  const item = res.rows[0];
  const currencyInfo = currencyLabel(item.currency);
  const currencyField = currencyInfo.field;
  const balance = Number(player[currencyField] || 0);
  const totalPrice = item.buy_price * qty;

  if (balance < totalPrice) {
    await ctx.reply(`❌ Saldo insuficiente.\nNecessário: ${totalPrice} ${currencyInfo.label}\nVocê: ${balance} ${currencyInfo.label}`);
    return;
  }

  if (item.slot !== "consumable") {
    const slotsRes = await pool.query(
      `
      SELECT COUNT(*)::int AS used
      FROM inventory
      WHERE player_id = $1 AND equipped = FALSE
    `,
      [player.id]
    );
    const slotsUsed = Number(slotsRes.rows[0]?.used || 0);
    const slotsMax = player.inventory_slots_max || 20;
    if (slotsUsed + qty > slotsMax) {
      await ctx.reply(`❌ Inventário cheio! (${slotsUsed}/${slotsMax}). Este item ocuparia ${qty} slot(s).`);
      return;
    }
  }

  if (item.stock !== null && item.stock !== undefined) {
    if (Number(item.stock) < qty) {
      await ctx.reply(`❌ Estoque insuficiente. Restam ${item.stock}.`);
      return;
    }
  }

  await pool.query(`UPDATE players SET ${currencyField} = ${currencyField} - $1 WHERE id = $2`, [totalPrice, player.id]);

  for (let i = 0; i < qty; i++) {
    const result = await awardItem(player.id, { ...item, key: item.item_key });
    if (!result.success) {
      await pool.query(`UPDATE players SET ${currencyField} = ${currencyField} + $1 WHERE id = $2`, [item.buy_price * (qty - i), player.id]);
      await ctx.reply("❌ Erro ao adicionar item. Valor reembolsado.");
      return;
    }
  }

  if (item.stock !== null && item.stock !== undefined) {
    await pool.query("UPDATE shop_items SET stock = stock - $1 WHERE item_key = $2 AND stock IS NOT NULL", [qty, itemKey]);
  }

  await ctx.reply(
    `✅ Compra realizada!\n${escapeHtml(item.name)} x${qty}\n-${formatPrice(totalPrice, item.currency)}`,
    { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Loja", `shop_open:${shopKey}`)]]) }
  );
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action("shop_selllist", async (ctx) => {
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const invRes = await pool.query(
    `
    SELECT 
      inv.id,
      inv.item_key,
      inv.qty,
      inv.rolled_atk,
      inv.rolled_def,
      inv.rolled_hp,
      inv.rolled_crit,
      i.name,
      i.rarity,
      s.sell_price AS shop_sell_price,
      s.currency,
      s.buy_price
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    LEFT JOIN shop_items s ON s.item_key = inv.item_key
    WHERE inv.player_id = $1
      AND inv.equipped = FALSE
    ORDER BY i.rarity DESC, i.name
    `,
    [player.id]
  );

  if (!invRes.rows.length) {
    await ctx.reply("❌ Você não tem itens vendáveis (não equipados).");
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }

  const rarityEmoji = { common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡" };
  const lines = invRes.rows.map((it) => {
    const price = computeSellPrice(it);
    return `• ${rarityEmoji[it.rarity] || "⚪"} ${escapeHtml(it.name)} x${it.qty} — ${formatPrice(price, "gold")}`;
  });
  const keyboard = invRes.rows.map((it) => {
    const price = computeSellPrice(it);
    return [Markup.button.callback(`${it.name} (${price})`, `shop_sell_item:${it.id}`)];
  });
  keyboard.push([Markup.button.callback("⬅️ Lojas", "loja_menu")]);

  await ctx.reply(`<b>Vender itens</b>\nEscolha o item para vender:\n\n${lines.join("\n")}`, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
  });
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action(/^shop_sell_item:([A-Za-z0-9_-]+)$/, async (ctx) => {
  const invId = ctx.match[1];
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);
  const res = await pool.query(
    `
    SELECT inv.id, inv.qty, i.name, i.rarity, s.sell_price AS shop_sell_price, s.currency, s.buy_price
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    LEFT JOIN shop_items s ON s.item_key = inv.item_key
    WHERE inv.id = $1 AND inv.player_id = $2 AND inv.equipped = FALSE
    `,
    [invId, player.id]
  );
  if (!res.rows.length) {
    await ctx.reply("❌ Item não encontrado ou não vendável.");
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }
  const item = res.rows[0];
  const price = computeSellPrice(item);
  const info = currencyLabel("gold");
  const keyboard = [
    [Markup.button.callback(`Vender 1 (${info.icon}${price})`, `shop_sell_do:${invId}:1`)],
  ];
  if (item.qty > 1) {
    keyboard.push([Markup.button.callback(`Vender ${item.qty} (${info.icon}${price * item.qty})`, `shop_sell_do:${invId}:${item.qty}`)]);
  }
  keyboard.push([Markup.button.callback("⬅️ Itens", "shop_selllist"), Markup.button.callback("🏪 Lojas", "loja_menu")]);

  await ctx.reply(
    `<b>Confirmar venda</b>\n${escapeHtml(item.name)} x${item.qty}\nRecebe: ${formatPrice(price, "gold")}`,
    { parse_mode: "HTML", reply_markup: Markup.inlineKeyboard(keyboard).reply_markup }
  );
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action(/^shop_sell_do:([A-Za-z0-9_-]+):(\d+)$/, async (ctx) => {
  const invId = ctx.match[1];
  const qty = Math.max(1, parseInt(ctx.match[2], 10) || 1);
  const userId = String(ctx.from.id);
  const player = await getPlayer(userId, ctx.from.first_name);

  const res = await pool.query(
    `
    SELECT inv.id, inv.qty, i.name, i.rarity, s.sell_price AS shop_sell_price, s.currency, s.buy_price
    FROM inventory inv
    JOIN items i ON i.key = inv.item_key
    LEFT JOIN shop_items s ON s.item_key = inv.item_key
    WHERE inv.id = $1 AND inv.player_id = $2 AND inv.equipped = FALSE
    `,
    [invId, player.id]
  );
  if (!res.rows.length) {
    await ctx.reply("❌ Item não encontrado ou não vendável.");
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }
  const item = res.rows[0];
  const price = computeSellPrice(item);
  if (qty > item.qty) {
    await ctx.reply(`❌ Você só tem ${item.qty} desse item.`);
    if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
    return;
  }

  const total = price * qty;
  const info = currencyLabel("gold");
  await pool.query(
    qty >= item.qty ? "DELETE FROM inventory WHERE id = $1" : "UPDATE inventory SET qty = qty - $1 WHERE id = $2",
    qty >= item.qty ? [invId] : [qty, invId]
  );
  await pool.query(`UPDATE players SET ${info.field} = ${info.field} + $1 WHERE id = $2`, [total, player.id]);
  await pool.query(
    `
    UPDATE players
    SET inventory_slots_used = (
      SELECT COUNT(*)
      FROM inventory
      WHERE player_id = $1 AND equipped = FALSE
    )
    WHERE id = $1
  `,
    [player.id]
  );

  await ctx.reply(`✅ Venda concluída!\n${escapeHtml(item.name)} x${qty}\n+${formatPrice(total, info.field)}`, {
    parse_mode: "HTML",
    reply_markup: Markup.inlineKeyboard([[Markup.button.callback("⬅️ Loja", "loja_menu")]]).reply_markup,
  });
  if (ctx.callbackQuery) ctx.answerCbQuery().catch(() => {});
});

bot.action("vip", async (ctx) => {
  await ctx.reply("💎 VIP em breve.", Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "menu")]]));
  if (ctx.callbackQuery) ctx.answerCbQuery();
});

// Registra dungeons (co-op)
registerDungeon(bot, {
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
});

// Launch bot
if (botToken) {
  bot
    .launch()
    .then(async () => {
      await loadEventImages();
      console.log("🤖 RPG BOT ON");
    })
    .catch((e) => console.error(e));
  process.once("SIGINT", () => bot.stop("SIGINT"));
}
