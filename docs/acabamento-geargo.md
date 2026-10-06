# Acabamento operacional Gear Go

## Arte para gráfica

ADMIN → Lotes → lote READY, sem códigos pendentes → Gerar arte para gráfica.
Selecione Oficial azul e Gerar PDF DE TESTE. Cada arquivo contém até 250
páginas. CSV fica na seção secundária Exportação CSV.

O PDF-base aprovado, print-templates.json, motor pdf-lib/qrcode e URLs/códigos
retornados pelo backend são preservados. Não há migração ou escrita D1 neste
acabamento. O teste inclui marcação e nome de arquivo não comercial.

## Marca

public/gear-go-oficial.png é o PNG transparente oficial fornecido (2172×724).
scripts/render-icons.mjs recorta os pixels do primeiro G, sem fonte substituta,
e gera favicon, apple-touch-icon, 192, 512 e maskable com área segura.
Os ícones têm referência versionada para atualização da PWA; atalhos já
instalados podem precisar ser reinstalados pelo sistema operacional.

## Domínio e bloqueio comercial

Wrangler 4 suporta routes com custom_domain:true. A única entrada é
app.geargo.com.br; workers_dev continua ativo. Não gerenciamos DNS raiz,
e-mail nem outros subdomínios. keep_vars preserva variáveis externas.

QR_PRODUCTION_READY permanece false no Wrangler. Antes de mudar para true:
validar HTTPS, assets, login real, navegação autenticada e QR de uma placa
existente em modo teste no domínio. Só então definir
PUBLIC_BASE_URL=https://app.geargo.com.br e liberar produção na configuração.
Não bastam HTTP 200 da página inicial ou testes locais para essa liberação.

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
