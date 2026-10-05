# Entrega operacional: V2 + usuários profissionais

Exclusivamente `midmake/placa-nfc`, branch `feat/operacao-placas-v2`.
**Este documento substitui a ordem de deploy de DEPLOY_V2.md. Não faça merge/deploy sem autorização.**
O domínio NÃO bloqueia esta entrega. A produção permanece antiga até concluir a migração e publicar.

## Plano de atualização do D1 existente

1. Confirme projeto Worker/D1 `placa-nfc`, binding `DB`, repositório e branch. Reserve uma janela sem alterações administrativas. Anote contagens e backup/ponto de restauração D1 antes de qualquer escrita.
2. Faça a pré-verificação de [DEPLOY_V2.md](DEPLOY_V2.md). Não use `d1 migrations apply --remote`: o schema inicial foi aplicado manualmente.
3. Aplique uma única vez [0002_operations.sql](../migrations/0002_operations.sql), sem editar seu conteúdo. Se o marcador já existir, valide e não reaplique. Se houver aplicação parcial, pare e peça revisão.
4. Valide marcador `0002_operations`, contagens e `PRAGMA foreign_key_check` (deve retornar vazio).
5. Execute a pré-verificação 0003 abaixo. Aplique integralmente [0003_professional_users.sql](../migrations/0003_professional_users.sql), uma única vez, **somente após validar 0002**.
6. Valide 0003 com o SQL abaixo. Não modifique `d1_migrations`, 0001, 0002 ou `PASSWORD_PEPPER`. Não recrie admin.
7. Somente agora, mediante autorização, merge da branch em main e deploy existente: build `npm run build`, deploy `npm run deploy`. O build não executa SQL.
8. Faça o smoke test abaixo usando a URL workers.dev atual. Não é preciso domínio nem Resend para testes internos.

Alternativa pelo terminal autenticado (os comandos remotos **não foram executados nesta rodada**):

```sh
git remote get-url origin
git branch --show-current
npm ci
npm test
npm run typecheck
npm run build
npm run db:remote        # Somente leitura: pré-verificação 0002
# Pare aqui para backup e autorização.
npm run db:v2:remote     # Aplica somente 0002, se faltar
# Valide 0002 e compare contagens antes de continuar.
npm run db:v3:check      # Somente leitura: pré-verificação 0003
npm run db:v3:remote     # Aplica somente 0003, se faltar
# Valide o SQL abaixo. Depois: merge/deploy autorizado.
```

No Console D1, antes de 0003:

```sql
SELECT * FROM schema_versions;
PRAGMA table_xinfo(users);
PRAGMA table_xinfo(batches);
PRAGMA table_xinfo(establishments);
PRAGMA table_xinfo(plates);
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('access_tokens','allocations');
PRAGMA foreign_key_check;
```

Sem marcador 0003, suas novas colunas/tabelas NÃO devem existir: users `commercial_type/state/archived_at`; batches `product/is_test/archived_at`; establishments `is_test/archived_at`; plates `activated_by/activation_type/allocation_id`; tabelas `access_tokens/allocations`. Qualquer estado parcial exige revisão, não repetição do arquivo.

Antes de cada migration e novamente depois, compare:

```sql
SELECT 'users' entidade, COUNT(*) total FROM users
UNION ALL SELECT 'batches',COUNT(*) FROM batches
UNION ALL SELECT 'plates',COUNT(*) FROM plates
UNION ALL SELECT 'establishments',COUNT(*) FROM establishments
UNION ALL SELECT 'audit_log',COUNT(*) FROM audit_log;
```

Após 0003:

```sql
SELECT * FROM schema_versions ORDER BY version;
PRAGMA foreign_key_check;
SELECT role,commercial_type,state,COUNT(*) FROM users GROUP BY 1,2,3;
SELECT product,is_test,COUNT(*) FROM batches GROUP BY 1,2;
SELECT COUNT(*) FROM access_tokens;
SELECT COUNT(*) FROM allocations;
```

Os dois marcadores devem existir; nenhuma violação FK. Usuários antigos seguem ACTIVE/EQUIPE_GEAR com role, senha e sessões preservados. Lotes antigos são GOOGLE e reais (`is_test=0`); nunca converta dados antigos em teste para apagá-los. A migration preenche autoria de placas ativas pelo audit log quando disponível, senão pelo proprietário histórico.

Não há rollback destrutivo automático. Se a publicação falhar, interrompa novas operações e investigue; não restaure backup antigo por cima de ativações recentes. O schema é aditivo, mas não mantenha a versão antiga recebendo escritas após começar a usar os novos tipos/saldos.

## E-mail: pronto agora, habilitado depois

Sem `RESEND_API_KEY` ou `EMAIL_FROM`, o ADMIN recebe o link pessoal após convidar/reenviar e pode compartilhá-lo diretamente com o destinatário. Ele não reaparece na listagem: reenviar gera outro e invalida o anterior. Tokens são armazenados somente como hash, com validade de 48 horas, uso único e limitação de tentativas.

Recuperação pública sempre responde genericamente e nunca devolve link/token. Sem e-mail, ADMIN pode usar **Usuários → Recuperar acesso**, confirmando a própria senha, e compartilhar o link de 30 minutos. Trocar/redefinir senha revoga sessões e tokens anteriores. Nunca enviar senha por e-mail.

Para habilitar envio real depois:

1. No Resend, adicionar/verificar o domínio comprado e cadastrar no provedor DNS **os registros exatos fornecidos pelo Resend**. Não inventar valores SPF/DKIM/MX.
2. Criar API key de envio restrita ao domínio quando disponível.
3. No Worker placa-nfc → Settings → Variables and Secrets, adicionar `RESEND_API_KEY` como **Secret**.
4. Definir `EMAIL_FROM` como uma caixa completa verificada, por exemplo `Gear Go Digital <acesso@geargo.com.br>`; `@geargo.com.br` sozinho não é endereço válido. Definir `EMAIL_REPLY_TO` como caixa existente monitorada (opcional).
5. Salvar/publicar a configuração e enviar um convite controlado. Conferir entrega e pasta de spam; falha aparece no painel e permite entrega manual/reenvio.

Nenhuma credencial real ou remetente foi inventado. Os links de acesso usam a origem da requisição, então convites/reset funcionam em workers.dev mesmo enquanto a origem comercial está pendente. HTML responsivo e texto simples estão em `src/email.ts`; requisições Resend usam timeout e chave de idempotência. Não habilitar logs de payload do provedor.

## Operação e segurança

- Equipe Gear ativa unidades livres, sem saldo/estoque. Revendedor usa alocação GOOGLE + lote + quantidade, sem seleção individual de IDs. A alocação reserva capacidade; equipe e reserva manual não podem consumir essa capacidade.
- Ativação, consumo de uma unidade, cliente e auditoria são uma transação D1. Saldo nunca fica negativo; falha/repetição não cria cliente órfão nem consome duas vezes.
- Alocações não são transferidas, reduzidas ou apagadas nesta versão. Lote com alocação não pode ser excluído. Arquivar preserva saldo; impede novas ativações daquele lote.
- Suspender/arquivar conta revoga acesso, não apaga clientes/placas/saldo. Reativar uma conta suspensa preserva senha. ADMIN não pode suspender/arquivar outro ADMIN nesta interface.
- Arquivar lote/cliente não bloqueia QR já ativo. Para interromper o redirect, usar Bloquear. Histórico permanece. Arquivamento não é exclusão e não há botão de restauração nesta rodada.
- Lote marcado como teste na criação usa apenas clientes fictícios classificados automaticamente como teste. Não pode misturar cliente real nem exportar material comercial. Exclusão exige senha ADMIN e frase exata; vínculos com outro lote, cliente real ou alocação impedem excluir. Remoção de placas/clientes de teste é explicitamente auditada; dados reais só podem ser arquivados.
- Produtos Instagram/Pix são apenas “Em breve”; API recusa alocação/criação desses produtos.

## Diagnóstico seguro

Erros inesperados geram `request_id` devolvido na resposta e evento JSON `request_failed` com ID e método. Não registrar URL completa, corpo, cookies, senha, hash, token, API key ou pepper. Registre horário e request_id ao reportar erro, nunca compartilhe links pessoais de convite.

`observability.enabled` continua false deliberadamente: logs automáticos de invocação podem conter a URL com token de convite. Se habilitar Workers Logs depois, mantenha os logs automáticos de invocação desativados e capture somente eventos de console sanitizados; revise também Logpush/APM/proxies antes. Isso não bloqueia deploy ou testes. Não ligue captura ampla de requests para investigar login.

Configuração opcional compatível com o Wrangler instalado, em `wrangler.jsonc`, substituindo apenas o bloco `observability` e publicando depois:

```json
"observability": {
  "enabled": true,
  "logs": { "enabled": true, "head_sampling_rate": 1, "invocation_logs": false },
  "traces": { "enabled": false }
}
```

Esse ajuste não foi aplicado automaticamente. No painel Workers Logs, filtre pelo `request_id` informado na resposta de erro. Revise retenção/limites do plano antes de habilitar.

## Smoke test obrigatório após publicação

1. Login ADMIN antigo, troca de senha, auditoria e redirects antigos preservados.
2. Convidar Equipe Gear e Revendedor sem Resend; abrir links workers.dev anonimamente; definir senha; rejeitar reutilização. Reenviar/cancelar outro convite e confirmar invalidação.
3. Esqueci senha com e-mail existente/inexistente: mesma resposta. ADMIN gera recuperação manual; redefinir e confirmar que outra sessão perdeu acesso.
4. Criar lote **de teste** de 50. Conferir códigos únicos e contadores. Exportar CSV/PDF teste; comercial recusado sem domínio e sempre recusado nesse lote teste.
5. Alocar 20 ao revendedor, ativar uma via QR, conferir 20 compradas/1 ativada/19 disponíveis. Ativar outra pelo painel. Outro revendedor não usa esse saldo/lote sem alocação própria.
6. Equipe ativa uma unidade livre. Interromper formulário não atribui placa. Dois usuários tentando a mesma placa: só um conclui.
7. Vincular duas placas ao mesmo cliente; alterar link Google e testar ambas. Código errado, placa de outro usuário e URL externa devem ser recusados.
8. Suspender revendedor: sessão deixa de operar; clientes e saldo continuam. Reativar e conferir acesso.
9. Bloquear/desbloquear individualmente e por vendedor; mensagem pública neutra e histórico.
10. Dashboard/busca por código/lote/cliente/nome/e-mail; rastreabilidade com produto, origem e alocação; usuário comum não acessa visão administrativa.
11. Criar outro lote teste sem alocação, ativar cliente fictício; excluir com senha/frase. Senha errada recusa. Lote real não pode ser apagado; lote com alocação não pode ser apagado. Arquivar preserva vínculos.
12. Android: instalar PWA. iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Conferir toque, teclado, confirmações e erros em aparelho real. Testes DOM automatizados não substituem essa validação física.
13. PDF teste com arte azul: conferir escala 100%, medida final 100×100 mm e leitura de todos os QRs amostrados. Segunda cor continua opcional/pendente.

## Pendências externas, sem bloquear a plataforma

Domínio/DNS, verificação do domínio no Resend, remetente `EMAIL_FROM`, credenciais de envio real e segunda cor opcional. Quando HTTPS definitivo estiver funcionando:

```dotenv
PUBLIC_BASE_URL=https://dominio-definitivo
QR_PRODUCTION_READY=true
```

Até lá, manter `QR_PRODUCTION_READY=false` ou ausente. A origem workers.dev permite login, PWA, convites manuais, clientes, ativações e PDF/CSV **de teste**. Só exportação comercial é bloqueada. Jamais imprimir comercialmente um QR de teste; QR físico não muda de URL depois.
