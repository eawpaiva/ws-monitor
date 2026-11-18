WS Monitor v{VERSAO} - Leitura da estação meteorológica WH24C (RS-485)
=====================================================================

O WS Monitor recebe, pela porta serial do computador, os pacotes que a estação WH24C envia
a cada 16 segundos, confere se cada pacote chegou íntegro (CRC e checksum) e mostra os
valores em três modos: Dashboard, Tabela e Texto. Um monitoramento pode ser gravado em
arquivo (.csv ou .txt) e encerrado com um relatório de resumo, para auditoria.
Os valores são convertidos como no coletor BeWeather (mesmos fatores e curva de vento).


1. REQUISITOS DE INSTALAÇÃO
---------------------------
Computador
- Windows 10 ou 11, com uma porta USB livre.
- Tela de 1366 x 768 ou maior (recomendado 1920 x 1080).
- Disco: 5 MB para o programa, mais cerca de 1 a 2 MB por dia de gravação em CSV.
- Não precisa de internet.
- Em monitoramentos longos, desative a suspensão automática do Windows: ao suspender,
  a porta USB é desligada e os pacotes desse período se perdem.

Navegador
- Microsoft Edge ou Google Chrome atualizado (o programa usa o Web Serial e a gravação
  direta em arquivo desses navegadores). Firefox e Safari não funcionam.

Hardware
- Conversor USB/RS-485 (CH340, CP210x, FTDI...) com o driver instalado.
- Fonte de 4,2 a 6 V DC para a estação (ou 3 pilhas AA recarregáveis).

Permissões de TI (o usuário não precisa ser administrador para usar o programa)
- Driver do conversor USB/RS-485: a instalação costuma exigir administrador.
- PowerShell: o atalho executa os scripts de C:\ws-monitor\launcher com
  "-ExecutionPolicy Bypass", que vale só para esse processo. Se uma política de grupo (GPO)
  bloquear scripts, a TI precisa liberar essa pasta ou assinar os scripts.
- Servidor local: o programa sobe um servidor HTTP do próprio Windows (HttpListener) que
  atende só http://localhost:8766, no próprio computador. Ele não abre porta na rede, não
  pede regra de firewall nem administrador. A porta 8766 precisa estar livre.
- Antivírus/EDR: um PowerShell em segundo plano subindo esse servidor pode ser bloqueado.
  Se acontecer, a TI deve criar uma exceção para C:\ws-monitor\launcher\*.ps1.
- Políticas do Edge/Chrome: o acesso à porta serial (DefaultSerialGuardSetting) e a
  gravação em arquivo (DefaultFileSystemWriteGuardSetting) não podem estar bloqueados para
  http://localhost:8766. Sem a gravação direta, o arquivo só é baixado ao parar a gravação.
- O usuário precisa poder criar a pasta C:\ws-monitor. Se não puder, extraia em outra
  pasta (ex.: Documentos) e execute o Instalar.cmd de lá.


2. INSTALAÇÃO
-------------
1. Botão direito em ws-monitor-v{VERSAO}.zip > Propriedades > marque "Desbloquear" > OK.
2. Botão direito no zip > "Extrair tudo..." > escolha C:\ (cria C:\ws-monitor).
3. Abra C:\ws-monitor e dê dois cliques em Instalar.cmd.
4. O atalho "WS Monitor" é criado na Área de Trabalho e no menu Iniciar, e o programa abre.
Se aparecer um aviso de segurança, não force a execução: confira o passo 1 e fale com o
responsável pelo WS Monitor.

Ligação da estação
  Fio preto ....... GND (terra comum da fonte e do conversor)
  Fio verde ....... VDD, 4,2 a 6 V DC
  Fio vermelho .... RS-485 A -> A (ou D+) do conversor
  Fio amarelo ..... RS-485 B -> B (ou D-) do conversor
Ao ligar, o LED da estação acende por 4 s e depois pisca a cada 16 s (cada pisca é um
pacote). Se nenhum pacote chegar, inverta A e B: a marcação varia entre conversores.


3. COMO TESTAR A ESTAÇÃO
------------------------
1. Ligue a estação e o conversor e abra o programa pelo atalho "WS Monitor".
2. Confira o baudrate 9600 e clique em "Conectar". Na primeira vez, escolha a porta
   (ex.: "USB-SERIAL CH340"). Para trocar de porta, clique no nome dela, na barra superior.
3. Em até 16 s, o quadro "Estação" deve mostrar "Recebendo", intervalo de cerca de 16 s
   e 0 erros. Erros de CRC/checksum ou bytes descartados indicam problema na ligação RS-485.
4. No Dashboard, compare cada sensor com a referência do laboratório. Cada cartão mostra o
   valor, o mínimo e o máximo da sessão, a exatidão do fabricante e uma mini-série (passe o
   mouse para ver hora e valor de cada ponto).
   - Temperatura e umidade: compare com o padrão de referência.
   - Vento: m/s e km/h (o km/h é o valor que o coletor envia). Direção na rosa dos ventos:
     alinhe a marca N com o norte e gire o cata-vento.
   - Chuva: clique em "Zerar Δ", despeje um volume conhecido e confira o "Δ sessão"
     (cada basculada = 0,3 mm).
   - Luminosidade e UV: compare com a fonte de luz de referência.
5. Status de cada valor:
   - OK: dentro da faixa de medição do fabricante;
   - Fora da faixa: fora da faixa do manual (ex.: abaixo de -30 °C);
   - Inválido: a estação enviou o código de "inválido";
   - ERRO CRC / ERRO CHECKSUM: o pacote chegou corrompido. Ele é contado e aparece na
     Tabela, no Texto e na gravação, mas não altera o Dashboard.
6. Tabela (um pacote por linha) e Texto (saída decodificada; "Detalhado" mostra cada campo
   com o valor bruto) servem para conferir pacote a pacote. Referência traz as faixas,
   exatidões e o formato do pacote.


4. COMO GERAR O RELATÓRIO DE UM MONITORAMENTO
---------------------------------------------
1. No quadro "Gravação de medições", preencha Operador, Equipamento / nº de série e
   Observações. Esses campos vão para o arquivo e para o relatório.
2. Escolha o formato:
   - CSV: uma linha por pacote, para planilhas. "Excel pt-BR" (ponto e vírgula e vírgula
     decimal) abre direto no Excel em português; "Internacional" é para outros programas.
   - TXT: texto legível, uma linha por pacote.
3. Clique em "Iniciar gravação" e escolha a pasta e o nome do arquivo. Cada pacote é
   gravado no disco assim que chega: se o computador desligar, o que já foi gravado fica.
4. Deixe o monitoramento correr. Trocar de modo de exibição (Dashboard, Tabela, Texto,
   Referência) não interrompe nem altera a gravação. Não feche o programa (ele avisa se
   houver gravação em andamento).
5. Clique em "Parar gravação". O programa mostra o SHA-256 do arquivo de medições.
6. Clique em "Salvar relatório do monitoramento". O relatório (.txt, salvo ao lado das
   medições com o final "_relatorio") traz: identificação, ID da estação, início, fim e
   duração, nome e SHA-256 do arquivo de medições, qualidade da comunicação (pacotes
   válidos, erros, perdidos, bateria) e, para cada grandeza, N, mínimo, máximo, média,
   inválidos e fora da faixa, além da chuva no período e dos fatores de conversão usados.
   No final há espaço para a assinatura do responsável.
7. Opcional: no "Log técnico", "Salvar .txt" exporta o registro técnico da sessão.
8. Guarde juntos o arquivo de medições e o relatório. Para provar depois que as medições
   não foram alteradas, rode no PowerShell:
       Get-FileHash "C:\caminho\do\arquivo.csv"
   O Hash tem que ser igual ao SHA-256 do relatório (maiúsculas ou minúsculas tanto faz).

Colunas do CSV: data_hora_local, data_hora_utc, seq, origem, status, id, temperatura_c,
umidade_pct, direcao_vento_graus, velocidade_vento_ms, velocidade_vento_kmh, rajada_ms,
rajada_kmh, vento_bruto, rajada_bruta, chuva_mm, chuva_contagem, uv_bruto, indice_uv,
luminosidade_lux, pressao_hpa, bateria_baixa, alertas, frame_hex.
Valor inválido = célula vazia. As linhas que começam com # são o cabeçalho de
identificação; desmarque a opção se o programa de destino não aceitar essas linhas.


5. PROBLEMAS COMUNS
-------------------
- Nenhum pacote ("Nenhum pacote" ou "Sem dados há..."): confira a alimentação (o LED
  pisca a cada 16 s?), inverta A e B no conversor e confira o baudrate (9600).
- Muitos erros de CRC/checksum ou bytes descartados: cabo longo ou sem par trançado, falta
  do GND comum ou ruído. Encurte o cabo, ligue o GND e afaste-o de fontes de ruído.
- "A porta está em uso por outro programa": feche o outro programa que usa a porta
  (terminal serial, script) e clique em Conectar de novo.
- O cabo USB soltou durante o uso: reconecte o mesmo conversor. A porta volta a abrir
  sozinha e a gravação continua no mesmo arquivo.
- O atalho não abre: veja os itens "PowerShell" e "Antivírus/EDR" em Permissões de TI.
- "Bateria baixa": troque ou recarregue as pilhas da estação.
- O ID da estação mudou: a estação reiniciou (o ID muda a cada reinício) ou há outra
  estação na mesma linha.
- Fatores de conversão: só mudam no Modo Desenvolvedor (com senha) e ficam registrados em
  cada gravação e relatório. Fale com o responsável pelo WS Monitor.


6. NOVA VERSÃO
--------------
Feche o programa e repita os passos 1 e 2 da instalação, substituindo os arquivos. O log
técnico (C:\ws-monitor\log\) e as configurações deste computador são mantidos. Não mova a
pasta C:\ws-monitor; se mover, execute Instalar.cmd de novo.
