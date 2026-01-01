import { pool } from "./db.js";

// Recalcula xp_total dos jogadores para manter nível/progresso
// mapeando da curva antiga (base 250, mult 1.45) para a nova (base 60, mult 1.32).

function buildCurve(base, mult, levels = 50) {
  const out = [];
  let prev = 0;
  for (let l = 1; l <= levels; l++) {
    let xp = Math.round(base * Math.pow(mult, l - 1));
    if (xp <= prev) xp = prev + 1;
    prev = xp;
    out.push({ level: l, xp_to_next: xp });
  }
  return out;
}

const OLD_CURVE = buildCurve(250, 1.45);
const NEW_CURVE = buildCurve(60, 1.32);

function cumulativeBefore(level, curve) {
  return curve.slice(0, Math.max(0, level - 1)).reduce((acc, c) => acc + c.xp_to_next, 0);
}

function findProgress(xp, curve) {
  let accumulated = 0;
  for (const row of curve) {
    if (xp >= accumulated + row.xp_to_next) {
      accumulated += row.xp_to_next;
      continue;
    }
    const progress = row.xp_to_next ? Math.max(0, Math.min(1, (xp - accumulated) / row.xp_to_next)) : 0;
    return { level: row.level, progress, levelStart: accumulated, xpToNext: row.xp_to_next };
  }
  // acima do último nível seedado
  return {
    level: curve.length + 1,
    progress: 0,
    levelStart: curve.reduce((acc, c) => acc + c.xp_to_next, 0),
    xpToNext: 0,
  };
}

function mapXp(oldXp) {
  const oldPos = findProgress(oldXp, OLD_CURVE);
  const newEntry = NEW_CURVE.find((c) => c.level === oldPos.level) || NEW_CURVE[NEW_CURVE.length - 1];
  const newStart = cumulativeBefore(newEntry.level, NEW_CURVE);
  const newXp = Math.round(newStart + (newEntry.xp_to_next || 0) * oldPos.progress);
  const newPos = findProgress(newXp, NEW_CURVE);
  return { newXp, oldLevel: oldPos.level, newLevel: newPos.level };
}

async function run() {
  const client = await pool.connect();
  try {
    const players = await client.query("SELECT id, telegram_id, name, xp_total FROM players");
    console.log(`Recalculando XP para ${players.rows.length} jogadores...`);
    await client.query("BEGIN");
    let updated = 0;
    for (const p of players.rows) {
      const xp = Number(p.xp_total || 0);
      const { newXp, oldLevel, newLevel } = mapXp(xp);
      await client.query("UPDATE players SET xp_total = $1 WHERE id = $2", [newXp, p.id]);
      updated++;
      console.log(
        `${p.name || p.telegram_id || p.id}: XP ${xp} (Lv ${oldLevel}) -> ${newXp} (Lv ${newLevel})`
      );
    }
    await client.query("COMMIT");
    console.log(`✅ Atualizados ${updated} jogadores.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao recalcular XP:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
