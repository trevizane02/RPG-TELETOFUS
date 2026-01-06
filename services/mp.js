import { MercadoPagoConfig, Preference, Payment } from "mercadopago";

const packs = {
  "18": { qty: 18, price: 18 },
  "30": { qty: 30, price: 28 },
  "100": { qty: 100, price: 85 },
};

let mpClient;
let prefClient;
let payClient;

function ensureConfigured() {
  if (mpClient) return;
  if (!process.env.MP_ACCESS_TOKEN) {
    throw new Error("MP_ACCESS_TOKEN ausente");
  }
  mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  prefClient = new Preference(mpClient);
  payClient = new Payment(mpClient);
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
  const res = await prefClient.create({
    body: {
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
    },
    requestOptions: {
      idempotencyKey: `tofu-${telegramId}-${pack}-${Date.now()}`,
    },
  });
  return res?.init_point;
}

export async function fetchPayment(paymentId) {
  ensureConfigured();
  if (!paymentId) throw new Error("paymentId vazio");
  const res = await payClient.get({ id: paymentId });
  return res;
}

export async function createPixPayment({ telegramId, pack }) {
  ensureConfigured();
  const info = packs[pack];
  if (!info) throw new Error("Pacote inválido");
  const baseUrl = process.env.BASE_URL || "";
  const notification_url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/payments/mp/webhook` : undefined;
  const res = await payClient.create({
    body: {
      transaction_amount: info.price,
      description: `Pacote ${info.qty} Tofus`,
      payment_method_id: "pix",
      external_reference: JSON.stringify({ telegramId, pack }),
      notification_url,
    },
    requestOptions: { idempotencyKey: `pix-${telegramId}-${pack}-${Date.now()}` },
  });
  const qr = res?.point_of_interaction?.transaction_data;
  return {
    payment_id: res?.id,
    qr_code: qr?.qr_code,
    qr_base64: qr?.qr_code_base64,
  };
}
