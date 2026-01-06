import mercadopago from "mercadopago";

const packs = {
  "18": { qty: 18, price: 18 },
  "30": { qty: 30, price: 28 },
  "100": { qty: 100, price: 85 },
};

function ensureConfigured() {
  if (!process.env.MP_ACCESS_TOKEN) {
    throw new Error("MP_ACCESS_TOKEN ausente");
  }
  mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });
}

export function getTofuPack(packKey) {
  return packs[packKey] || null;
}

export async function createTofuPreference({ telegramId, pack }) {
  ensureConfigured();
  const info = packs[pack];
  if (!info) throw new Error("Pacote inválido");
  const baseUrl = process.env.BASE_URL || "";
  const notification_url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/payments/mp/webhook` : undefined;
  const preference = {
    items: [
      {
        id: `tofu_${pack}`,
        title: `Pacote ${info.qty} Tofus`,
        quantity: 1,
        unit_price: info.price,
        currency_id: "BRL",
      },
    ],
    external_reference: JSON.stringify({ telegramId, pack }),
    notification_url,
  };
  const res = await mercadopago.preferences.create(preference);
  return res.body?.init_point;
}

export async function fetchPayment(paymentId) {
  ensureConfigured();
  if (!paymentId) throw new Error("paymentId vazio");
  const res = await mercadopago.payment.findById(paymentId);
  return res.body;
}
