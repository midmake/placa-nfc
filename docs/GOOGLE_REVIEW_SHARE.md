# Gerador Google: share.google e KGMID

Rodada de 12/10/2026, exclusivamente `midmake/placa-nfc`, sobre `prelaunch/final-audit` (`a609e3c`). Sem merge/deploy nesta rodada. Domínio, QR, arte, banco, migrations, PASSWORD_PEPPER e Resend não alterados.

## Arquivos

- `src/google-review-link.ts`: resolução manual, orçamento total, cache de sucesso.
- `src/google-review-page.ts`: allowlist específica do conversor, extração URL e parser público isolado.
- `public/review-link.js`: bloco reutilizável compacto, Copiar/Testar, resultado com nome quando encontrado, descarte de resultado obsoleto; fallback manual existente preservado.
- `public/app.js`: bloco no início da home ADMIN e da home de Equipe/Revendedor.
- `public/style.css`: disposição flexível e compacta do bloco.
- `tests/google-review-share.test.ts`, `tests/ui.test.ts`: regressões de resolução, identidade, SSRF, cache, limite de resposta, timeout e UI/fallback.

## Formatos e pipeline

1. Link direto writereview com Place ID, g.page/.../review, parâmetros placeid/place_id/query_place_id, q=place_id: e data=!1sChIJ: retorno imediato quando há um identificador não conflitante.
2. `share.google/<id>` é permitido como origem inicial. Inclui o salto observado `www.google.com/share.google?q=<id>`. Não aceita voltar para um novo share.google dentro da cadeia.
3. `maps.app.goo.gl`, `goo.gl/maps`, g.page: redirects manuais para hosts/paths autorizados.
4. Search Google com um `kgmid=/g/...`: leitura limitada da página pública quando nenhum Place ID já está na URL.
5. O KGMID **não é convertido**. O parser procura o Place ID real ligado ao mesmo KGMID num registro JSON rotulado (`kgmid`/`mid` e `placeId`/`place_id`/`placeid`), nos links estruturados `@id`/`url`/`sameAs` desse registro, ou em atributos do mesmo elemento HTML. Nome, quando exposto, deve corresponder ao nome selecionado. Objetos relacionados não são unidos por proximidade.
6. Dois Place IDs correspondentes, nomes conflitantes, ausência de vínculo, HTML malformado ou CAPTCHA: erro, sem resultado parcial. Nome isolado ou primeiro ChIJ da página nunca bastam.

**Limitação importante:** esses formatos de dados públicos não são uma API oficial. O parser aceita apenas estruturas com associação explícita. Arrays posicionais de AF_initDataCallback e novos formatos opacos não são interpretados por suposição. É suporte condicional a KGMID, não cobertura universal de perfis Google. Fixtures de payload são sintéticas, não captura de HTML do Senac nem comprovação de que esse perfil exponha os campos aceitos.

## Segurança/custo

- HTTPS; hosts e caminhos exatos validados antes de cada fetch, inclusive cada redirect.
- Sem cookies/credenciais encaminhados; sem execução de scripts; sem serviços externos além do próprio Google.
- Máximo cinco requisições, timeout total de seis segundos incluindo leitura do corpo; URL/Location até 2.048 caracteres.
- HTML até 512 KiB lidos do stream, content type verificado; complexidade do JSON limitada (profundidade24, 5.000 nós).
- IP privado, localhost, metadata, domínio semelhante, protocolo diferente, redirects externos e endpoints genéricos de redirecionamento recusados.
- Limite autenticado existente mantido: 20/usuário e 100/IP por 15 minutos, além do limite geral.
- Cache somente de sucesso em memória do isolate, TTL5 minutos, até100 chaves, por URL e KGMID+nome. Não persistente, sem D1/migration; reset do isolate perde cache. Falhas não são cacheadas.
- Validação dos destinos já registrados permanece em `google-url.ts`, inalterada. Falha do conversor não desabilita ativação; campo original fica intacto e pode ser substituído manualmente por link válido.

## Verificação real controlada

Origem: `https://share.google/2iEk4mF5TiTm2VuHn`.

Cadeia observada: share.google HTTP302 → www.google.com/share.google HTTP301 → Google Search com `kgmid=/g/1tdz5_5n` e `q=Senac+Tech` → HTTP302 para `/sorry/index` (bloqueio de tráfego automatizado/CAPTCHA).

Nenhuma tentativa de contornar bloqueio. Nenhum Place ID real do Senac Tech foi obtido. Não foi possível confirmar a abertura da tela de avaliação dessa empresa. O nome e KGMID constam do redirect, mas isso **não valida o link final**. Não haverá sucesso fictício nem ID de fixture utilizado em produção.

## Validação local

- npm ci: PASS.
- npm test: **193 PASS / 0 FAIL** (35 regressões adicionais sobre a suíte anterior de158).
- npm run typecheck: PASS.
- npm run build: PASS (dry-run, não deploy).
- Todos os fetch de testes são simulados. Testes de home cobrem ADMIN, Equipe e Revendedor, Copiar/Testar, limpeza de resultado após editar e preservação exata do campo na falha.

SHARE.GOOGLE SUPORTADO: SIM (cadeia autorizada; Google pode bloquear).

KGMID SUPORTADO: SIM (somente quando HTML/payload contém vínculo explícito aceito pelo parser).

USA IA: NÃO.

USA GOOGLE PLACES API: NÃO.

USA SERVIÇO EXTERNO: NÃO (somente requests ao próprio Google).

CASO SENAC TECH VALIDADO: NÃO.

FALLBACK MANUAL PRESERVADO: SIM.

Antes de afirmar sucesso comercial para Senac Tech, ainda é necessária uma resposta pública sem bloqueio e evidência do Place ID vinculado ao perfil. Não publicar às cegas nem prometer conversão universal.
