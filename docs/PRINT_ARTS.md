# Arquivos necessários para concluir os PDFs comerciais

O motor de PDF está implementado, mas os dois templates de produção continuam
**desabilitados**. Nenhuma arte comercial foi inventada. A geometria usada nos testes
é somente uma fixture técnica, não um modelo para enviar à gráfica.

Envie **dois arquivos separados**, um para cada cor, com o mesmo layout:

1. Preferência: **PDF vetorial de uma página**, textos convertidos em curvas ou fontes
   incorporadas, na escala final. Sem QR e sem código fixos nos espaços variáveis.
2. Alternativa: SVG vetorial. PNG só se não houver vetor, a 300 dpi no tamanho final.
3. Informe a medida de **corte final em milímetros**, largura × altura (por exemplo,
   se forem realmente 10 × 10 cm, confirme **100 × 100 mm**; não presumimos isso).
4. Informe a sangria exigida pela gráfica. Se for 3 mm por lado e o corte for
   100 × 100 mm, cada arte deve ter **106 × 106 mm**. Não acrescentamos 3 mm sem
   confirmação. Informe também a margem de segurança e o raio dos cantos, se aplicável.
5. Envie uma imagem de referência mostrando os espaços do QR e do código. Não precisa
   saber coordenadas: podemos medi-las e confirmar. Se tiver as medidas, informe:
   - QR: X/Y do canto superior esquerdo e tamanho do quadrado, em mm.
   - Código: X/Y do início da caixa, largura da caixa e tamanho da fonte, em pontos.
     Todas as coordenadas são medidas a partir do canto superior esquerdo da área de
     **corte**, sem incluir a sangria.
6. Confirme se a gráfica quer uma placa por página (implementado) ou imposição em uma
   folha maior. Não há imposição automática nesta rodada. Os PDFs são divididos em
   partes de até 250 páginas para lotes grandes, mantendo tamanho real por página.

O QR terá módulos vetoriais pretos K100, fundo branco e margem livre de quatro módulos
em todos os lados. A área informada para QR inclui essa margem; nada da arte pode
invadi-la. O motor exige módulo de pelo menos 0,35 mm e bloqueia QRs densos demais.
Esses critérios ajudam na leitura, mas ainda é necessário aprovar uma prova impressa
na placa/material real. Leitura por câmera não pode ser garantida só pelo arquivo.

O gerador preserva a arte PDF embutida e as dimensões, com MediaBox, TrimBox e BleedBox.
Não promete conversão de cores/perfil ICC, certificação PDF/X ou acabamento gráfico
automático; confirme essas exigências com a gráfica. Se ela exigir PDF/X, isso deve ser
resolvido na preparação das artes/validação final antes da liberação comercial.

## Integração após receber os arquivos

- Salvar somente as artes aprovadas em `public/print-art/`.
- Preencher `public/print-templates.json` (dois itens, mesma geometria, cores distintas).
- Validar dimensões da página, áreas, contraste e código em cada cor.
- Gerar amostras, renderizar, decodificar os QRs e aprovar uma prova física.
- Só então marcar `ready: true`. O domínio definitivo é uma segunda trava independente.

PDFs de teste levam faixa **TESTE — NÃO ENVIAR À GRÁFICA** sobre parte do QR, de propósito.
Para testar uma leitura agora, use **Testar QR** no painel ou os dados do CSV de teste.
Os CSVs continuam contendo `codigo,url`; o nome do arquivo sinaliza quando são testes.
