# Acabamento operacional Gear Go

## Arte para gráfica

ADMIN → Lotes → lote READY, sem códigos pendentes → Gerar arte para gráfica.
Selecione Oficial azul e PDF FINAL PARA GRÁFICA para lote comercial.
Confirme a origem app.geargo.com.br no fluxo existente. PDF DE TESTE permanece disponível. Cada arquivo contém até 250
páginas. CSV fica na seção secundária Exportação CSV.

O PDF-base aprovado, print-templates.json, motor pdf-lib/qrcode e URLs/códigos
retornados pelo backend são preservados. Não há migração ou escrita D1 neste
acabamento. O teste inclui marcação e nome de arquivo não comercial.

## Marca

public/gear-go-oficial.png é o PNG transparente oficial fornecido (2172×724).
O login e cabeçalho continuam usando esse PNG transparente. Os ícones usam
assets/brand/pwa-approved.jpeg, arte quadrada escolhida pelo usuário em
2026-10-06 (GEAR branco / GO ciano). pwa-transparent.png remove apenas o
branco exterior com edição de imagem. scripts/render-icons.mjs preserva a composição,
e gera favicon, apple-touch-icon, 192, 512 e maskable com área segura.
Os ícones têm referência versionada para atualização da PWA; atalhos já
instalados podem precisar ser reinstalados pelo sistema operacional.

## Domínio e bloqueio comercial

Wrangler 4 suporta routes com custom_domain:true. A única entrada é
app.geargo.com.br; workers_dev continua ativo. Não gerenciamos DNS raiz,
e-mail nem outros subdomínios. keep_vars preserva variáveis externas.

Em 2026-10-06, o proprietário confirmou via captura do Safari autenticado
que Lotes → A001 → Ver placas → Testar QR abre a confirmação do código físico
em app.geargo.com.br. Esse é o destino esperado para placa não ativada.
O acesso automatizado anterior retornou 403; não foi usado como prova de sucesso.
Com a confirmação real do proprietário, PUBLIC_BASE_URL agora é
https://app.geargo.com.br e QR_PRODUCTION_READY=true.
Permanecem os bloqueios de lote de teste, estado READY, códigos pendentes e
confirmação da origem de produção de cada lote. Nenhuma placa foi ativada para teste.

## Resend

A integração existente envia convite pessoal de uso único, armazena hash e
mantém fallback MANUAL. A tela Usuários informa se o envio está configurado.
Não há senha enviada por e-mail. Para ativar:

- Definir RESEND_API_KEY como Secret do Worker, nunca no repositório.
- Verificar o domínio no Resend usando somente os registros fornecidos por ele.
- Configurar EMAIL_FROM=Gear Go Digital <acesso@geargo.com.br>.
- Configurar EMAIL_REPLY_TO com caixa real monitorada pela empresa.

Nenhuma chave ou registro DNS foi inventado. Sem essas configurações, o ADMIN
copia o link pessoal de convite e o entrega diretamente ao destinatário.
