# Atualização segura da produção — Gear Go Digital

Repositório autorizado: **midmake/placa-nfc**. Branch desta rodada: `feat/operacao-placas-v2`.

## Ordem obrigatória

1. **Não mesclar a branch em main antes de atualizar o banco.** Main dispara o deploy da Cloudflare.
2. No D1 **placa-nfc**, faça export/backup e anote um ponto de restauração Time Travel.
3. Execute a pré-verificação abaixo no Console do D1. Nenhum comando apaga dados.
4. Aplique **somente `migrations/0002_operations.sql`**, uma vez.
5. Verifique o marcador e contagens abaixo.
6. Mescle a branch em main. Mantenha build `npm run build` e deploy `npm run deploy`.
7. Faça o smoke test operacional. Não crie outro admin e não mude o pepper.

## Pré-verificação no Console do D1

```sql
SELECT name, type FROM sqlite_master
WHERE type IN ('table','trigger') ORDER BY type,name;
PRAGMA table_xinfo(plates);
PRAGMA table_xinfo(batches);
PRAGMA table_xinfo(establishments);
SELECT 'users' AS entidade, COUNT(*) AS total FROM users
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions
UNION ALL SELECT 'batches', COUNT(*) FROM batches
UNION ALL SELECT 'plates', COUNT(*) FROM plates
UNION ALL SELECT 'establishments', COUNT(*) FROM establishments
UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log;
```

Antes da primeira aplicação, as colunas `plates.physical_code`, `plates.blocked`,
`batches.physical_prefix/target_quantity/generation_state/request_key/production_origin`
e `establishments.address` **não** devem existir; tampouco `activation_grants` ou
`schema_versions`. As tabelas/triggers iniciais devem estar presentes.
Se houver parte dessas colunas/tabelas, **pare**: é uma migração parcial ou schema
divergente. Não reaplique o arquivo nem apague nada para "corrigir".

## SQL exato

O arquivo [0002_operations.sql](../migrations/0002_operations.sql) é a migration completa,
sem placeholders, sem dados de usuário e sem dependência do histórico Wrangler.
Copie seu conteúdo integral para o Console do D1 **placa-nfc** e execute uma única vez.
Ele apenas adiciona colunas, índices, uma proteção de código físico e tabelas auxiliares.
Os códigos/IDs/tokens originais, clientes, usuários, hashes e logs antigos permanecem.

**Não execute `wrangler d1 migrations apply DB --remote` nesta base inicializada
manualmente.** Isso poderia tentar reaplicar a migration 0001.
O comando antigo `npm run db:remote` agora faz só a pré-verificação.

Alternativa por terminal autenticado, dentro deste repositório:

```sh
npm ci
npm run db:remote       # Apenas verifica. Não altera o banco.
npm run db:v2:remote    # Após backup: verifica e aplica somente 0002, se faltar.
```

O script não modifica `d1_migrations`. Se o marcador da V2 já existir, não reaplica.
Se detectar colunas parciais, interrompe. Não há migration automática no build/deploy.

## Conferência após aplicar

```sql
SELECT * FROM schema_versions WHERE version='0002_operations';
SELECT COUNT(*) AS total, SUM(blocked) AS bloqueadas,
       SUM(physical_code IS NULL) AS codigos_fisicos_pendentes
FROM plates;
PRAGMA foreign_key_check;
```

O marcador deve existir e `foreign_key_check` não deve retornar violações.
Compare as contagens de usuários/lotes/placas/clientes/logs com as anteriores.
Sessões naturalmente podem variar se houver logins simultâneos.
No momento da migration, `blocked=0` em todas as placas existentes. Não é feito
backfill automático de códigos físicos: isso é uma ação auditada do admin após deploy.

## Cloudflare: configurações a manter

- Worker e D1 já existentes: **placa-nfc**. Binding D1: **DB**.
- Build: `npm run build`; deploy: `npm run deploy`.
- **Não alterar, recriar ou resetar `PASSWORD_PEPPER`.**
- Não recriar admin, schema inicial, tabelas ou banco.
- Não conectar nenhum outro repositório.

Nesta rodada não é preciso definir domínio próprio. O teste funciona na origem atual.
Deixe `QR_PRODUCTION_READY` ausente ou `false` por enquanto.

Quando houver domínio definitivo, em Settings → Variables and Secrets do Worker:

```text
PUBLIC_BASE_URL=https://seu-dominio-definitivo
QR_PRODUCTION_READY=true
```

São variáveis comuns, não segredos. Não altere o pepper para isso.
O domínio precisa ser HTTPS e não pode ser workers.dev/pages.dev para exportação final.
O painel exige confirmação e fixa essa origem no lote no primeiro uso de produção.
Trocar a variável depois não troca a origem de lotes já confirmados: preservar o
endereço impresso é intencional. Endereços antigos precisam continuar disponíveis.

## Placas que já existiam

Placas ativas continuam redirecionando com **exatamente a mesma rota/token**, sem
reimpressão e sem troca de cliente/vendedor. O campo antigo `code` permanece intacto.
O novo `physical_code` é uma confirmação separada e nunca faz parte da URL do QR.

Em **Lotes → Preparar códigos físicos**, o admin pode gerar os códigos que faltam em
lotes legados. Essa operação não modifica os QRs e pode ser retomada.
Para ativar uma placa antiga ainda inativa, será preciso acrescentar seu novo código
físico na peça (ex.: etiqueta) ou reimprimir a arte mantendo o mesmo QR.
**Não basta fornecer o antigo código sequencial como prova de posse:** ele é visível
na URL, portanto aceitá-lo enfraqueceria a nova segurança.

As antigas atribuições são preservadas como reservas administrativas. Um vendedor
só verá a placa no seu perfil depois da ativação. Ativações nunca tomam placas de outro.

## Smoke test após deploy

1. Entre com o admin existente; confirme que o acesso e o histórico anterior permanecem.
2. Crie um lote de teste de 50. Confira total = ativa + inativa + bloqueada.
3. Abra o QR de uma placa inativa sem login. Entre, confirme o código físico e cadastre
   um estabelecimento. A placa deve aparecer em Meus clientes do vendedor.
4. Interrompa uma ativação antes da conclusão: a placa deve continuar sem vendedor.
5. Vincule outra placa ao mesmo cliente. Altere o link e confira os dois redirects.
6. Teste código errado e outro vendedor; não deve haver indicação de quem é o dono.
7. Bloqueie e desbloqueie uma placa e depois as placas de um vendedor. Confira QR,
   contadores, vínculos preservados e histórico por natureza.
8. Crie lote de 1.000, interrompa/recarregue e use Continuar geração. Não deve duplicar.
9. Baixe CSV no modo teste. Produção permanece bloqueada sem domínio definitivo.
10. Android: instalar. iPhone/Safari: Compartilhar → Adicionar à Tela de Início.

Esta rodada não aplica SQL remoto nem publica diretamente em produção sem a ordem
acima. Não reverta para o Worker antigo depois de usar bloqueios: a versão antiga não
conhece o flag e poderia voltar a redirecionar placas bloqueadas. Prefira correção
aditiva da V2; qualquer restauração de banco exige avaliação dos dados criados depois.
