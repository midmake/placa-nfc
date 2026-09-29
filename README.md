# Gear Go Digital — placa-nfc

MVP de placas físicas com QR dinâmico. Repositório exclusivo: **midmake/placa-nfc**.
NFC é gravado manualmente fora desta aplicação. Não há cadastro público, pagamentos,
comissões, analytics de scans ou editor de arte.

## Arquitetura

- Um Cloudflare Worker TypeScript: API, autenticação, autorização e `/r/<código>-<token>`.
- Workers Assets: HTML/CSS/JavaScript responsivos, sem framework ou CDN.
- D1: usuários, sessões, lotes, placas, estabelecimentos, categorias e auditoria.
- SQL parametrizado e migrations versionadas. Sem dependências de runtime externas.
- Interface, API e redirects na mesma origem. Deploy único em `workers.dev`.

```
src/index.ts          API e regras de acesso
src/security.ts       senhas, tokens e sessões
src/google-url.ts     política de destinos Google
public/               painel e aviso de privacidade
migrations/           schema e proteções de integridade
scripts/create-admin.ts  bootstrap CLI (sem endpoint público)
tests/                validação de URLs e integração com SQLite
```

Estabelecimento é o cadastro comercial principal: contém o destino e pode ter muitas
placas. Alterar seu destino atualiza todas as placas, sem reimprimir. O destino não
é duplicado em cada placa. Cada estabelecimento e suas placas têm um responsável.
Sugestões de duplicidade são limitadas ao mesmo responsável para não revelar dados de
outro usuário. O admin pode ver toda a base. Transferência de placas ativas entre
responsáveis fica bloqueada no MVP; não há fusão automática de empresas.

## Rodar localmente

Use Node.js 22.13+ (testado com Node 24), npm e um terminal na pasta `placa-nfc`.
Antes de qualquer alteração, confira `git remote -v`.

```sh
npm ci
```

Crie **`.dev.vars`** (ignorado pelo Git):

```dotenv
PASSWORD_PEPPER=COLOQUE_UM_SEGREDO_ALEATORIO_COM_PELO_MENOS_32_CARACTERES
```

Gere o valor com um gerenciador de senhas ou `openssl rand -hex 32`.
Não reutilize o segredo local em produção.

```sh
npm run db:local
export GG_ADMIN_EMAIL='seu-email@example.com'
export GG_ADMIN_NAME='Administrador Gear Go'
read -rs -p 'Senha temporária do admin (mínimo 12): ' GG_ADMIN_PASSWORD
export GG_ADMIN_PASSWORD
npm run admin
unset GG_ADMIN_PASSWORD
npm run dev
```

Abra a URL local indicada pelo Wrangler. O primeiro admin também precisa trocar a
senha no primeiro acesso. O script falha se o e-mail já existir; não substitui usuários.
O arquivo SQL temporário é privado, fica em `.wrangler/` e é removido ao terminar.
Não existem credenciais padrão, seed de usuários públicos ou backdoor de instalação.

## Configurar Cloudflare — plano gratuito

A conta e a autenticação Cloudflare são necessárias. Não habilite plano pago.
A aplicação foi projetada para o piloto de 50 placas; gratuidade depende das cotas da
conta. O deploy público e as cotas reais de CPU ainda precisam ser verificados na conta.

```sh
npx wrangler login
npx wrangler whoami
npx wrangler d1 create placa-nfc
```

Copie o `database_id` retornado para a entrada **DB** em `wrangler.jsonc`, substituindo
`00000000-0000-0000-0000-000000000000`. O ID não é uma credencial.
Não aponte esse projeto para banco, Worker ou domínio de outro projeto.

```sh
npm run db:remote
npx wrangler secret put PASSWORD_PEPPER
```

No prompt, informe um segredo exclusivo de produção (mínimo 32 caracteres aleatórios).
Guarde-o num gerenciador de senhas. Ele não vai para o repositório ou front-end.
Para automação futura, use `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` como secrets
do ambiente, com escopo restrito à conta e às operações Workers/D1 necessárias;
nunca no código, em URL ou mensagem de commit.

### Primeiro administrador remoto

Use exatamente o mesmo pepper salvo na Cloudflare, sem imprimi-lo:

```sh
read -rs -p 'Pepper de produção: ' PASSWORD_PEPPER
export PASSWORD_PEPPER
export GG_ADMIN_EMAIL='seu-email@example.com'
export GG_ADMIN_NAME='Administrador Gear Go'
read -rs -p 'Senha temporária do admin: ' GG_ADMIN_PASSWORD
export GG_ADMIN_PASSWORD
npm run admin -- --remote
unset GG_ADMIN_PASSWORD PASSWORD_PEPPER
```

### Publicar

```sh
npm test
npm run build
npm run deploy
```

O Wrangler informa a URL `https://placa-nfc.<seu-subdominio>.workers.dev`.
Não configure domínio próprio neste piloto. Se o painel oferecer apenas upload de
arquivos estáticos, esse fluxo não basta: é necessário publicar também o Worker/D1.

Opcionalmente configure a variável pública `PUBLIC_BASE_URL` com a origem final
`https://placa-nfc.<seu-subdominio>.workers.dev`, sem caminho, para fixar as URLs dos
CSVs. Por padrão é usada a origem atual da aplicação.

**URLs impressas não migram sozinhas.** Use o endereço temporário em placas de teste.
Se uma placa for vendida com esse endereço, mantenha esse Worker/endereço funcionando
mesmo depois de adicionar domínio próprio. Não renomeie o Worker nem regenere tokens.

## Operação do piloto

1. Entre como admin e troque a senha temporária.
2. Em **Usuários**, crie o responsável e entregue a senha temporária por canal privado.
3. Em **Lotes**, crie `Piloto 01`, quantidade `50`, com ou sem responsável.
4. Atribua o lote ou placas disponíveis individualmente. Lotes com placas ativas
   não podem ser transferidos em conjunto.
5. Baixe o CSV: `codigo,url`, UTF-8 com BOM e linhas CRLF.
6. No Canva, mantenha código e QR da mesma linha. O CSV contém as URLs; ele não é um
   pacote de imagens QR. Gere os QRs a partir dessas URLs usando um fluxo de QR em lote
   compatível com seu Canva e confira a leitura antes de imprimir.
7. Usuário entra, troca senha e ativa a placa. Pode selecionar um cadastro existente
   imediatamente ou preencher o formulário. Possíveis duplicidades exigem escolha.
8. No estabelecimento, use **+ Vincular outra placa** para adicionar mais placas.
9. **Testar QR** abre a mesma URL que será impressa; uma placa não ativada exibe um aviso.
10. Admin pesquisa leads por nome, telefone, cidade, segmento ou código e consulta
    histórico geral ou do estabelecimento.

Não há registro automático de vendas, receitas ou comissões. Até 100 placas por lote,
com inserts agrupados para respeitar limites de consultas e parâmetros no plano Free.
Listas são limitadas a 500 resultados (a interface pede refinar a busca); auditoria
paginada em grupos de 100, sem apagar entradas antigas. Novas categorias podem ser
incluídas pelo admin na API `POST /api/categories` com JSON `{ "name": "Categoria" }`.

## Segurança e integridade

- Token por placa: 24 bytes aleatórios (192 bits) com Web Crypto, além do código sequencial.
- Sessão aleatória de 32 bytes, somente hash SHA-256 no banco, expiração de 12h.
- Cookie HttpOnly, SameSite=Strict e Secure em HTTPS. Nunca localStorage.
- Hash de senha: PBKDF2-SHA256, salt aleatório por usuário, 100.000 iterações,
  precedido por HMAC-SHA256 com pepper exclusivo guardado em secret Cloudflare.
  O fator usa o teto tradicional do WebCrypto no Workers; não equivale à recomendação
  OWASP de 600.000 iterações para PBKDF2-SHA256. O pepper, senhas de pelo menos 12
  caracteres, rate limit e acesso restrito mitigam esse compromisso do MVP.
  Reavaliar KDF e CPU antes de abrir a revendedores externos; não reduzir o custo
  silenciosamente para caber em cota. Perder/alterar o pepper invalida as senhas.
- Limite de login por e-mail e IP, usando hashes das chaves, com janela de 15 minutos.
- Reset e troca de senha revogam todas as sessões. Troca temporária obrigatória no servidor.
- Autorização em cada endpoint; não basta esconder botões. Dados de outro responsável
  retornam 404. Histórico e CSV de produção são exclusivos do admin.
- Proteção de origem nas mutações e JSON obrigatório. CSP sem scripts externos/inline.
- Auditoria e mutação na mesma transação D1. Controle de versão evita sobrescrita
  silenciosa de cadastros; guardas SQL abortam operações concorrentes inconsistentes.
- Triggers protegem o histórico, snapshot inicial e identidade/token das placas.
  Um operador com acesso administrativo direto ao banco ainda pode alterar o schema;
  essas proteções não substituem controle de acesso à conta Cloudflare.
- Auditoria guarda snapshots anterior/novo, data e autor. Não registra senhas, hashes
  de senha ou cookies. A ativação inicial preserva `initial_snapshot`.
- Nada de cache nos redirects, respostas autenticadas ou CSV. Nada de analytics de scans.

### Destinos aceitos

`src/google-url.ts` é o ponto único de extensão. Aceita HTTPS com hosts exatos verificados
`google.com` / `google.com.br`, variantes `www`, `maps`, `search`, em caminhos Maps e
`/local/writereview`, além de `maps.app.goo.gl`, `g.page` e `goo.gl/maps`.
Não se aceita qualquer serviço Google: Sites, Docs, Pay, `/url`, credenciais embutidas,
portas não padrão, fragmentos, lookalikes e parâmetros de redirecionamento são recusados.

Links curtos são expandidos na gravação, hop por hop, com timeout, no máximo cinco
redirecionamentos e sem visitar hosts/caminhos não permitidos. Salva-se o destino
Google completo. Se o Google não permitir expansão, o formulário pede o link completo
sem perder os campos. Não há promessa de que o conteúdo ou comportamento futuro de
um serviço externo será imutável; o validador é uma defesa de domínio/caminho.
Os formatos reais fornecidos pelos primeiros clientes devem ser testados em produção.

## Testes e validação

```sh
npm test
npm run typecheck
npm run build
npm run db:local
```

Os testes executam handlers reais com SQLite em memória, schema completo, transações,
triggers e um adaptador da API D1. Cobrem login, senha obrigatória, sessões, isolamento,
lote de 50, atribuição, CSV, ativação, detecção de duplicidade, várias placas por empresa,
redirect antes/depois da edição, histórico imutável, conflitos, reset e URLs maliciosas.
Não são um substituto de teste em D1 remoto e navegador móvel.

Smoke test após deploy:

- Admin: crie dois usuários e atribua placas separadas.
- Usuário 1: tente abrir/editar o ID de estabelecimento ou placa do usuário 2; deve falhar.
- Ative duas placas para a mesma empresa e confirme cadastro único.
- Abra o CSV e teste URLs impressas, antes e depois de editar o destino.
- Confira telefone anterior, novo, autor e horário no histórico.
- Faça logout/reset e confira que o cookie antigo não funciona.
- Teste em Safari/iPhone e Chrome/Android: login, troca obrigatória, ativação, edição,
  busca de segmento e botões sem rolagem horizontal em 360–390px.
- Cole links reais `maps.app.goo.gl` e `g.page` de um estabelecimento; confira destino.
- Verifique erros e CPU no painel Workers, especialmente login no plano gratuito.

### Estado da validação nesta implementação

- Testes automatizados: aprovados.
- TypeScript e build Worker: aprovados.
- Migration em D1 local e criação de admin local: aprovadas.
- Publicação e migration D1 remoto: pendentes de autenticação Cloudflare.
- Navegador/mobile real: pendente; o servidor `wrangler dev` encontrou uma restrição
  do ambiente (`uv_interface_addresses`) durante a validação inicial.

## Privacidade

`public/privacidade.html` é um aviso inicial para teste restrito, ligado ao formulário.
Antes de uso público, complete controlador, contato, base legal, retenção/exclusão e
transferências internacionais. Histórico imutável no painel não significa retenção
eterna nem impede atendimento de obrigações legais por procedimento administrativo.

## Referências técnicas

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
