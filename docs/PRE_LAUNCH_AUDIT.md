# Pré-lançamento Gear Go — 12/10/2026

## 1. Resumo executivo

**NO-GO para certificar esta rodada como concluída.** Implementação e testes locais concluídos; validação visual real mobile e aceite físico ainda pendentes. Alterações isoladas em `prelaunch/final-audit`, base `826094fb0b120e8f0fccdfd9c0a5c767ecba359b`. Nenhum deploy, migration ou escrita em produção nesta rodada. A versão online já validada pelo proprietário não foi substituída.

O escopo auditado é exclusivamente `midmake/placa-nfc`. Não é certificação independente nem prova de ausência de vulnerabilidades. Testes locais não equivalem à validação da infraestrutura Cloudflare ou do serviço Google real.

## 2. Correções implementadas

| Arquivo | Problema | Correção |
|---|---|---|
| public/app.js, public/style.css | Avisos persistentes/baixo contraste | Mensagem substituída, limpa na navegação e após 5 segundos; texto escuro; campos nativos inválidos continuam validados |
| public/ux.js, src/segments.ts, src/core.ts | Sugestões e Outros | Lista comercial ampliada, combobox acessível, Outros com texto próprio; validação e inserção atômica da categoria |
| src/index.ts | Cidade sem sugestões | Cidades existentes, normalizadas e limitadas a 500, respeitando proprietário; texto livre permitido |
| public/app.js, public/operations-ui.js, src/operations.ts | Coleta de endereço dispensável | Campo removido; endereço antigo preservado quando omitido na edição |
| public/operations-ui.js, src/index.ts | Contadores só informativos | Contadores viram botões com aria-pressed; filtro no servidor; contagens do lote inteiro; paginação mantém filtro; ações locais recarregam lista/contadores |
| public/review-link.js, src/google-review-link.ts, public/index.html | Conversão dependia de ferramenta externa | Tela no menu e conversão opcional junto ao campo de destino, Copiar e Testar |
| public/app.js, public/operations-ui.js | Edição/destino pouco claros | Edição de cliente/link explícita, cópia de link Google e link dinâmico da placa para NFC com rótulos diferentes |
| src/core.ts, src/index.ts, src/professional.ts, src/operations.ts | Abuso de corpo, paginação e rotas secundárias | JSON até 16 KiB; limites de query/offset; rate limits; reautenticação no reset legado; limpeza de limiter limitada a 100 registros por execução |
| .github/workflows/deploy-v2.yml | Secrets disponíveis para npm/testes | Secrets somente no step deploy; checkout do SHA do evento; sem persistir credenciais |
| package.json, package-lock.json | Alertas na ferramenta de desenvolvimento | Atualização compatível de Wrangler/tipos; audit zerado |
| tests/*, scripts/load-local.ts, scripts/mobile-local.mjs, scripts/scan-history.mjs | Regressão e reprodutibilidade | Testes funcionais/isolamento, carga sintética local, roteiro mobile e scanner redigido de histórico |

Não houve alteração de ícones, logo, manifesto, identidade aprovada, algoritmo de senha, pepper, domínio, migrations ou arte oficial. A UI legada userList está fora da navegação; endpoints antigos permanecem por compatibilidade. GET /api/users ainda alimenta atribuição de placas. Reset legado agora exige senha atual do ADMIN; não foi removido cegamente.

## 3. Gerador de link de avaliação

**USA API GOOGLE PAGA: NÃO.**

Estratégias: Place ID explícito em placeid/place_id/query_place_id, q=place_id: e identificador público !1sChIJ em URLs longas; links g.page/.../review existentes preservados. Links maps.app.goo.gl, goo.gl/maps e g.page são resolvidos por redirects HTTPS manuais. CID isolado e feature ID hexadecimal **não são adivinhados**; nem todo compartilhamento Google contém Place ID utilizável.

Limites: no máximo 5 requisições, orçamento total de 6 segundos, URL/Location até 2.048 caracteres, nenhum corpo remoto processado. Host/path allowlist exata a cada salto; rejeita credenciais, portas diferentes, IPs, localhost, metadata, protocolos não HTTPS, hosts semelhantes, parâmetros de redirecionamento arbitrário e destinos externos. Não é proxy aberto. Autenticação e limiter próprios obrigatórios.

Resultado identifica um formato/identificador, não certifica a existência ou identidade comercial da empresa. Botão Testar permite conferência humana. Falha retorna orientação para copiar novamente ou informar link direto; não substitui o campo nem salva resultado inválido. Integração é acionada pelo botão Converter link compartilhado; não força conversão dos destinos Google antigos válidos. Parsing não documentado está isolado no módulo específico.

Fixtures usam Place ID publicado pelo Google para Sydney Opera House; redirects curtos são simulados. **Conversão de um link curto real do proprietário ainda precisa de aceite**, pois URLs públicas podem mudar. Não se afirma cobertura universal do Maps.

## 4. Revendedor

**UM REVENDEDOR REMOTO CONSEGUE OPERAR SEM AJUDA DO ADMIN: SIM, no teste automatizado local após o convite e alocação iniciais.**

Teste cobre convite, definição da própria senha, login, 20 unidades alocadas, 7 ativações, saldo 13, edição própria, recusa de acesso cruzado, recuperação, revogação da sessão antiga e login com nova senha. Resend foi simulado nesse teste; nenhum e-mail real foi enviado. O proprietário já confirmou envio real em produção anteriormente. Aceite remoto com pessoa real após publicar esta branch permanece pendente.

Concorrência/última unidade, replay de grant, vinculação, bloqueio/suspensão e isolamento possuem regressões locais. ADMIN conserva as autorizações existentes. Nenhuma placa impressa foi ativada ou consumida para estes testes.

## 5. Testes

Última execução completa: npm ci PASS; npm audit **0 vulnerabilidades**; npm test **158 pass / 0 fail**; typecheck PASS; build PASS (dry-run Wrangler 4.149.0, não deploy). A contagem inclui testes operacionais importados por fixtures; não são 158 novos cenários distintos.

Cobertura inclui SSRF, redirect externo/loops, formatos Google, grants, concorrência, saldo, IDOR, sessões/reset, UI em DOM, filtros sobre lote de 251 placas, corpo 413, content type 415, entradas 400, autenticação 401/403, objetos 404, conflitos e rate limit 429. Métodos inesperados testados retornam rejeição, não sucesso mutante. Não foi exercitada toda combinação possível de rota/método.

Carga LOCAL: 800 requisições sintéticas, 10/50/100 req/s por um segundo em login/busca/placas/QR/gerador; nenhuma resposta 5xx. Respostas 429 esperadas no login/gerador. SQLite em memória e fetch local: não representa capacidade Cloudflare nem latência real. Não houve carga em produção.

Mobile: testes estruturais/DOM passaram; roteiro Playwright preparado para 320/360/375/390/430 px, mas navegador não executou neste ambiente (instalação/execução bloqueada). **Não considerar as 40 verificações visuais PASS.** Não houve captura reproduzida do convite real com caixa branca; correção de contraste foi validada por código/DOM, não por fluxo remoto real.

Smoke remoto somente leitura, observado nesta rodada: ambas as origens retornaram / 200, /api/me e /api/plates 401 sem sessão, /r/invalid 404, páginas convite/reset inválidos 200 (shell, não aceitação do token), CSP/HSTS presentes. Nenhum login real ou reset de ADMIN executado.

## 6. Segurança

| Nível | Resultado / pendência |
|---|---|
| CRITICAL | Nenhum achado confirmado no escopo; não é garantia de ausência |
| HIGH | Token Cloudflare apareceu em anexo histórico da conversa. SECRET ENCONTRADO: Cloudflare token; LOCAL: conversa, não evidência de commit; ROTACIONAR: SIM se ainda válido. Não reproduzir valor. Não rotacionar PASSWORD_PEPPER |
| MEDIUM | D1 limiter adiciona escritas e limpeza sem índice de expiração; varreduras/listagens amplas; QR público sem proteção de borda específica; Actions ainda referenciam tags e não SHA imutável |
| LOW | Código administrativo legado mantido por compatibilidade; superfície workers.dev ainda pública; cobertura visual real pendente |
| INFO | Repo PUBLIC; recomendar TORNAR PRIVADO, sem mudança automática. Privacidade necessita dados reais do controlador |

Histórico: 49 commits alcançáveis / 149 blobs textuais examinados com heurística redigida; nenhum candidato de secret de alta confiança. Três branches remotas do próprio repo examinadas. Não cobre refs remotas apagadas/inacessíveis ou objetos não alcançáveis. Trinta runs/jobs acessíveis tiveram logs inspecionados sem exibir valores sensíveis; sem candidatos detectados pela heurística; os 30 runs não tinham artifacts. Scripts históricos de recuperação não devem ser reexecutados como rotina de operação.

Autorização: queries vinculadas ao usuário/role e regressões A/B; SQL parametrizado; escape HTML na UI; SameSite Strict, Secure em HTTPS, HttpOnly e expiração de sessão existentes; reset revoga sessões; suspensão impede uso. CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy e Permissions-Policy preservados. Nenhum secret novo em log, arquivo de credenciais ou bundle. Observabilidade ampla não ativada.

## 7. Rate limit e custo por rota

Janela: 15 minutos. Limites específicos somam-se ao geral autenticado: leitura 600/usuário e 3.000/IP; escrita 180/usuário e 900/IP. D1 R/W abaixo descreve custo qualitativo, não billing medido: todo limiter faz upserts e limpeza; uma leitura autenticada deixa de ser somente leitura física.

| Rota/família | Auth / role | D1 R/W / custo | Atual nesta branch | Recomendação |
|---|---|---|---|---|
| login | pública | conta/sessão + limiter; hash de senha | 10/conta, 40/IP, 10/par | Borda adicional contra IPs distribuídos; sem lockout permanente |
| forgot | pública | token + e-mail + limiter | 5/e-mail, 25/IP | Borda e orçamento Resend |
| reset/accept | token | consumo único/sessões + limiter | 12/IP | Manter cooldown e expiração |
| invite/resend | ADMIN | token/auditoria + Resend | 30/ADMIN, 150/IP | Monitorar orçamento, reduzir por operação se necessário |
| ADMIN reauth | ADMIN | senha/limiter | 8/ADMIN, 40/IP | Compartilhar limite entre ações críticas |
| activation verify | autenticada | placa/grant/limiter | 12/usuário, 50/IP | Manter com proteção de borda não agressiva |
| activation complete | autenticada | transação placa/saldo/cliente/audit | 30/usuário, 150/IP | Manter atomicidade e replay negado |
| Google generator | autenticada | limiter + até 5 fetch externos | 20/usuário, 100/IP | Conferir consumo real; sem URL arbitrária |
| clientes/busca/placas/lotes | autenticada; escopo proprietário ou ADMIN | sessão/listagem + limiter | limite geral; query até 2.048; offset até 10.000 | Medir varreduras; paginar listagens ainda amplas |
| exportações | ADMIN | leitura lote + limiter; PDF no cliente | limite geral; lote até 5.000; PDF até 250 páginas/parte | Limite dedicado se uso abusivo observado |
| QR /r/* | pública | lookup token + destino; sem escrita de analytics | validação sintática; sem limiter agressivo | WAF adaptativo após medir, sem quebrar placa real |
| legado criar/reset usuário | ADMIN | conta/hash/audit + limiter | criar20/usuário100/IP; reset exige reauth | Descontinuar somente após comprovar ausência de consumidores |

Limpeza do limiter remove até 100 expirados por execução, inclusive em tentativas negadas. Chaves novas ainda criam linhas; flood distribuído pode superar limpeza e gerar custo. Não foi adicionada migration/índice: EXPLAIN em escala e eventual índice exigem proposta separada. Não afirmar escala ilimitada.

## 8. Cost abuse

| Vetor | Exploração / impacto | Proteção / correção | Residual |
|---|---|---|---|
| Worker/login | brute force e CPU de hash | conta/IP/par, cooldown | IPs distribuídos e requisições negadas custam |
| D1 limiter | criação de chaves e escritas | limpeza limitada + limiares | sem índice de reset_at; requer medição/borda |
| Resend | spam convite/forgot | role/token/limite específico | cota do provedor deve ser acompanhada |
| Google | proxy/redirect chain | allowlist, 5 hops, 6s, sem body, autenticação | formato externo mutável; até 5 fetch por tentativa |
| QR público | enumeração/scraping | token forte, sintaxe antes de lookup | válido custa leitura; WAF não configurado nesta rodada |
| busca/listagens | queries amplas repetidas | escopo auth, limites input/offset/rate | alguns endpoints de lotes/grupos/usuários ainda sem paginação integral |
| PDF/lotes | tamanho extremo | lote5.000, partes250, PDF no navegador | mobile pode ficar pesado; não prometer 5.000 páginas num único PDF |

## 9. QRs impressos

**OS QRs E URLs COMERCIAIS JÁ GERADOS CONTINUAM COMPATÍVEIS: SIM**, por preservação do contrato e regressões locais; não por escaneamento de cada placa física. Domínio, tokens, códigos, IDs e production_origin não alterados. Workers.dev mantido; desabilitar somente após inventário de links antigos e autorização.

## 10. Dados existentes

**ADMIN/SENHAS/CLIENTES/PLACAS/LOTES EXISTENTES FORAM PRESERVADOS: SIM.** Nenhuma escrita remota, migration ou reset. Dados sintéticos exclusivamente em SQLite local. Senhas/pepper/algoritmo intocados.

## 11. Arte

Sem alteração. Antes/depois: documento106×106 mm, corte100×100 mm, sangria3 mm; área QR26,8 mm, símbolo útil21,818 mm; fonte código6 pt. NFC pertence ao PDF-base e não teve bounding box individual medida. QR à esquerda/NFC à direita/OU central preservados. Inspeção renderizada e testes geométricos/vetoriais passaram; **leitura física em impressão100%, iPhone/Android/NFC não executada**. Ajuste proporcional exige medidas/referência aprovadas antes de editar.

## 12. Privacidade

Rafael precisa informar: identificação real do controlador (nome/razão social e dados aplicáveis); canal monitorado para titulares; finalidades e bases legais a confirmar; política/prazos de retenção; procedimento/prazos de eliminação e exceções; operadores e transferências internacionais aplicáveis (Cloudflare/Resend e demais efetivos). Não inventar essas informações nem considerar o texto atual parecer jurídico.

## 13. Pendências

Do proprietário: confirmar rotação do token exposto caso ainda válido; fornecer dados de privacidade; aceite físico QR/NFC em iPhone e Android (inativa/ativa/edição/bloqueio/desbloqueio); autorizar eventual mudança de visibilidade; aprovar medidas apenas se desejar alterar arte.

Técnicas ainda não concluídas (não transferidas indevidamente ao proprietário): execução Playwright em ambiente apto; aceite de link Google real e convite/reset reais após publicação controlada; revisão final da branch, merge/deploy e smoke da nova versão. Não publicar automaticamente com esta documentação como se esses itens tivessem passado.

## 14. GO / NO-GO

**A PLATAFORMA ESTÁ PRONTA PARA COMEÇAR A SER USADA POR VENDEDORES E REVENDEDORES REAIS? NÃO como certificação desta rodada final.** A base online já foi validada pelo proprietário; as melhorias locais passaram, mas a branch ainda precisa ser publicada/validada, mobile real e aceite físico estão pendentes. Não existe motivo nesta auditoria para apagar dados, reconstruir plataforma ou invalidar QRs existentes.
