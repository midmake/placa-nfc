import type { Env } from "./core";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function accessEmail(
  name: string,
  type: string,
  kind: string,
  link: string,
) {
  const reset = kind === "RESET",
    reseller = type === "REVENDEDOR";
  const subject = reset
    ? "Redefina sua senha Gear Go Digital"
    : reseller
      ? "Seu acesso de Revendedor Gear Go Digital"
      : "Você foi convidado para fazer parte da Gear Go Digital";
  const paragraphs = reset
    ? [
        "Recebemos uma solicitação para redefinir sua senha.",
        "O link é pessoal e válido por 30 minutos. Se você não solicitou, ignore este e-mail.",
      ]
    : reseller
      ? [
          "Seu acesso como Revendedor Gear Go Digital está pronto para ser criado.",
          "Pela plataforma, você poderá gerenciar suas placas, ativar os estabelecimentos dos seus clientes e atualizar os destinos quando necessário.",
        ]
      : [
          "Você foi convidado para fazer parte da equipe comercial da Gear Go Digital.",
          "Pela nossa plataforma, você poderá ativar placas, cadastrar seus clientes e acompanhar os estabelecimentos atendidos por você.",
        ];
  const label = reset ? "REDEFINIR MINHA SENHA" : "CRIAR MEU ACESSO";
  return {
    subject,
    text: `Olá, ${name}.\n\n${paragraphs.join("\n\n")}\n\n${label}: ${link}\n\n${reset ? "" : "Este convite é pessoal e possui prazo de validade de 48 horas.\n\n"}Equipe Gear Go Digital`,
    html: `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#f3f6fa;font-family:Arial,sans-serif;color:#172c45"><div style="max-width:560px;margin:24px auto;background:white;border-radius:16px;overflow:hidden"><div style="padding:28px;background:#102747;color:white;font-weight:bold;font-size:23px">GEAR GO DIGITAL</div><div style="padding:28px"><p>Olá, ${escape(name)}.</p>${paragraphs.map((p) => `<p style="line-height:1.6">${escape(p)}</p>`).join("")}<p style="margin:30px 0"><a style="display:inline-block;padding:16px 22px;border-radius:8px;background:#125dde;color:white;text-decoration:none;font-weight:bold" href="${escape(link)}">${label}</a></p>${reset ? "" : '<p style="font-size:13px;color:#526079">Este convite é pessoal e possui prazo de validade de 48 horas.</p>'}<p>Equipe Gear Go Digital</p></div></div></body></html>`,
  };
}
export async function sendAccessEmail(
  env: Env,
  to: string,
  name: string,
  type: string,
  kind: string,
  link: string,
  id: string,
): Promise<"SENT" | "FAILED" | "MANUAL"> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return "MANUAL";
  const content = accessEmail(name, type, kind, link);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        ...content,
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      }),
    });
    // Never log provider payloads: they may echo the private link or recipient.
    return r.ok ? "SENT" : "FAILED";
  } catch {
    return "FAILED";
  }
}
