# Arquivos necessários para concluir os PDFs comerciais

## Arte oficial azul integrada em 02/10/2026

O primeiro template usa o PDF-base oficial fornecido pelo usuário, sem modificar a arte fixa.
Corte: 100 × 100 mm; documento: 106 × 106 mm; sangria: 3 mm por lado.
A referência mais recente é `placa-google-10x10-exemplo.pdf`, versão 1, atualizada às 15h15.
O símbolo QR preto mede 21,8182 mm, centralizado em X=22,5 / Y=69,9 mm da área de corte;
a caixa branca de proteção mede 26,8 mm. O tamanho do símbolo permanece constante independentemente
da quantidade de módulos, preservando uma zona livre de pelo menos quatro módulos.
O código individual confirmado pelo usuário (não o nome do lote) é centralizado abaixo,
em preto, 6 pt, linha de base Y=85,7 mm. A posição e o QR seguem a última referência.

Arquivo incorporado: `public/print-art/gear-go-oficial-azul.pdf`.
Origem: `placa-google-10x10-base.pdf`, Library `libfile_6e01074dbffc8191a7a159166f877b21`.
Referência: Library `libfile_0c9b50f913288191a21ec5e8e456fb55`, versão 1.

O template azul está habilitado; a segunda cor continua **desabilitada** até receber
arte aprovada. A exportação de produção continua exigindo domínio definitivo.
Antes do lote comercial, aprove uma prova impressa e teste a câmera no material real.

## Segunda cor (opcional para iniciar com azul)

Para a segunda cor, envie a arte correspondente com a mesma geometria da oficial:

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
