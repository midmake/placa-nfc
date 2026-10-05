# Gear Go Digital — placa-nfc

Plataforma de placas de avaliação Google. Repositório exclusivo: **midmake/placa-nfc**.
Worker TypeScript + Assets + D1. Autenticação existente preservada. NFC é configurado
fora da plataforma; o bloqueio vale para qualquer acesso à URL Gear Go, inclusive NFC
gravado com essa URL. NFC gravado diretamente com link Google não passa pelo Worker.

## Rodada operacional V2

Admin cria lote → gráfica imprime → vendedor confirma código físico → ativa cliente.
Não existe estoque de vendedor. A atribuição acontece atomicamente na conclusão.

- Lotes de 1 a 5.000 unidades, geração retomável em partes de 200 e criação idempotente.
- Código físico `A3009-K7Q2`, alfabeto sem O/0/I/1, unicidade no banco e retry de colisões.
- Código físico separado do QR forte. Rotas antigas `/r/A00001-<token>` preservadas.
- QR inativo abre login/ativação; placa permanece no fluxo após login/troca de senha.
- Painel e QR usam os mesmos endpoints de confirmação/ativação, sem atalho por ID.
- Prova de código por sessão, válida por 15 min, uso único e limite de tentativas.
- Vendedor vê seus clientes e placas ativas, inclusive status de bloqueio.
- Admin: lotes, placas agrupadas por vendedor, busca, reserva administrativa excepcional.
- Bloqueio individual/em massa reversível; mensagem pública neutra, sem apagar dados.
- Auditoria imutável com filtros por natureza, snapshots, autor e horário.
- PWA standalone, ícones PNG/SVG, orientação iPhone; sem cache de dados/redirects.
- CSV e dados paginados para PDF. Gerador PDF vetorial no navegador/Web Worker.
- Arte oficial azul integrada (100 × 100 mm + sangria de 3 mm). Segunda cor pendente. PDF comercial exige domínio definitivo e confirmação da origem.
- Produção exige origem definitiva configurada e confirmada; modo teste separado.

## ATENÇÃO: banco de produção inicializado manualmente

**Não reaplique a migration 0001 em produção. Não apague/recrie tabelas ou banco.**

Leia [docs/DEPLOY_FINAL.md](docs/DEPLOY_FINAL.md). A ordem é:
backup → pré-verificação → `0002_operations.sql` → validar → `0003_professional_users.sql` → validar → merge/deploy autorizado.

A branch `feat/operacao-placas-v2` deve ser mesclada em main apenas depois da migration.
O deploy automático atual continua com `npm run build` / `npm run deploy`.
Nenhuma migration roda automaticamente nesses comandos.

`PASSWORD_PEPPER`, contas, senhas, sessões, tokens, clientes e histórico existentes
não devem ser recriados. A V2 **não altera o algoritmo de senha ou o secret**.

## Desenvolvimento local

Node 22.13+ (testado com 24). Na pasta do repositório, confira `git remote -v`.

```sh
npm ci
npm run db:local
npm run dev
```

`db:local` serve para base local nova gerenciada pelo Wrangler. Se uma base local já
tiver o schema inicial aplicado manualmente, use `npm run db:v2:local` seguido de `npm run db:v3:local`.

Crie `.dev.vars` ignorado pelo Git, com pepper aleatório exclusivo de desenvolvimento:

```dotenv
PASSWORD_PEPPER=um-segredo-local-aleatorio-com-pelo-menos-32-caracteres
```

Não copie o secret de produção para testes. Para criar admin apenas em base nova:

```sh
export GG_ADMIN_EMAIL='admin@example.com'
export GG_ADMIN_NAME='Administrador Gear Go'
read -rs -p 'Senha temporária (mínimo 12): ' GG_ADMIN_PASSWORD
export GG_ADMIN_PASSWORD
npm run admin
unset GG_ADMIN_PASSWORD
```

A troca de senha é obrigatória. Produção já possui admin: não execute bootstrap lá.

## Usuários profissionais e operação

Role ADMIN/USER preservada, tipo comercial EQUIPE_GEAR/REVENDEDOR separado e estados
INVITED/ACTIVE/SUSPENDED. Equipe não tem estoque; revendedor recebe unidades por lote,
com reserva de capacidade e consumo transacional na ativação. Convites de 48h e
recuperação de 30min usam hash de token, expiração, uso único e revogação de sessões.
Integração Resend pronta; sem credenciais, ADMIN compartilha link pessoal para testes.
Dashboard, busca paginada, rastreabilidade, suspensão e arquivamento disponíveis.
Exclusão restrita a dados de teste, com senha atual ADMIN e confirmação digitada.
GOOGLE é o produto atual; Instagram/Pix aparecem apenas como “Em breve”.

Domínio não bloqueia testes na origem workers.dev. Instruções de e-mail, migrations,
observabilidade e checklist completo estão em [DEPLOY_FINAL](docs/DEPLOY_FINAL.md).

### Comandos de validação

```sh
npm test
npm run typecheck
npm run build
npm run dev
npm run db:remote        # Somente pré-verificação remota, não aplica migrations
npm run db:v2:remote     # Aplica apenas V2 após pré-verificação; faça backup antes
npm run db:v3:check      # Pré-verificação 0003, somente leitura
npm run db:v3:remote     # Somente após validar 0002 e autorizar a atualização
npm run deploy          # Publicação manual quando autorizada, após migration
```

O build empacota o gerador de PDF em `public/print-worker.js`. Esse arquivo gerado
é ignorado pelo Git; bibliotecas são locais, sem CDN. Os ícones raster já são
versionados e derivam do SVG original. `scripts/render-icons.mjs` é helper opcional.

## Organização

- `src/index.ts`: entrada HTTP, autenticação existente, usuários e estabelecimentos.
- `src/core.ts`: helpers compartilhados, autorização, validação, transações.
- `src/operations.ts`: ativação, lotes, atribuição, bloqueio, exports e auditoria.
- `src/physical-code.ts`: formato, alfabeto, aleatoriedade e data de São Paulo.
- `src/security.ts`: hash de senha e tokens existentes, sem mudança de algoritmo.
- `src/google-url.ts`: validação de host/caminho e resolução segura de links curtos.
- `src/print/`: motor de PDF e Web Worker; nenhuma renderização pesada no backend.
- `public/app.js`: login, usuários, edição e histórico.
- `public/operations-ui.js`: painéis operacionais e ativação compartilhada.
- `public/flow.js`: preserva somente identificador QR válido, nunca redirect externo.
- `public/print-templates.json`: oficial azul habilitado e segunda cor aguardando arte.
- `migrations/0002_operations.sql`: alteração aditiva, sem reconstruir tabela.
- `docs/DEPLOY_V2.md`: procedimento exato de produção e limitações de rollback.
- `docs/PRINT_ARTS.md`: arquivos/medidas/áreas necessários para concluir impressão.

## Regras e segurança

Os estados antigos UNASSIGNED/AVAILABLE/ACTIVE permanecem. O bloqueio é um flag
independente. Contadores do lote são exclusivos: ativas sem bloqueio + inativas sem
bloqueio + todas bloqueadas = total. Reservas administrativas inativas não aparecem
como estoque para vendedor.

A prova de código não atribui placa. Ao concluir, o banco consome a prova, verifica
estado/bloqueio/reserva e grava cliente, vínculo, vendedor e auditoria na mesma
transação. Conflitos revertem tudo. Reatribuição/bloqueio invalidam provas pendentes.
A confirmação expira em 15 minutos e é vinculada à sessão que a solicitou.

Acesso server-side, SQL parametrizado, cookies HttpOnly/SameSite/Secure em HTTPS,
sessões com expiração/revogação, proteção de origem, CSP e rate limiting são mantidos.
Novos códigos usam Web Crypto com rejeição de viés e UNIQUE no banco. O QR forte
permanece com token aleatório de 192 bits. O código curto confirma posse; não é token
administrativo nem substitui autenticação. Não há cadastro público.

Senhas continuam com o esquema já implantado PBKDF2-SHA256 100.000 iterações + salt +
pepper HMAC. Esse fator é limitado pelo runtime e inferior à referência OWASP de
600.000 para PBKDF2-SHA256; reavaliar KDF/CPU antes de ampliar o público. Não reduzir
silenciosamente nem trocar o pepper: invalidaria as senhas existentes.

O service worker é network-only. Nem QR, nem clientes, nem sessão, nem exports são
servidos por cache offline. Instalar a PWA não torna ativação possível sem internet.

## Impressão e domínio

Por padrão, exporte em modo teste usando a origem atual. Arquivos de teste são
identificados e não devem ir à gráfica. O PDF de teste tem marca sobre parte do QR.

Para produção futura, configure `PUBLIC_BASE_URL` HTTPS definitivo e
`QR_PRODUCTION_READY=true`. O painel exige confirmação explícita e fixa a origem
no lote. Workers.dev/pages.dev não são aceitos para exportação final.
Não desative a origem antiga de QRs já impressos quando migrar domínio.

PDFs: uma placa por página, medidas exatas, QR vetorial com quiet zone, partes de até
250 páginas. Lote de 1.000 produz quatro PDFs. O navegador faz o trabalho; o Worker
fornece dados paginados. Não há editor gráfico, imposição, Canva nem conversão PDF/X.
Veja [o que enviar para concluir as artes](docs/PRINT_ARTS.md).

## Testes e verificação

A suíte usa handlers reais, SQLite com migrations e triggers, testes de fluxo DOM,
manifest/ícones e PDF. Inclui concorrência, migração legada sem d1_migrations,
1000 códigos e dados paginados, bloqueios, auditoria e isolamento. O teste de PDF
valida a arte oficial e 1.000 páginas em quatro partes com uma fixture técnica.

A aprovação de testes locais não substitui smoke test no D1 remoto, instalação real
em iPhone/Android, CPU no plano Free e prova física da gráfica. Não há analytics,
pagamentos, comissões, ERP ou outro escopo adicional.

## Privacidade

O aviso inicial está em `public/privacidade.html`. Complete identificação do
controlador, canal de atendimento, base legal, retenção e transferências antes de
abrir ao público. Histórico imutável no painel não implica retenção eterna.
