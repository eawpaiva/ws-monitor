# AGENTS.md: WS Monitor

Contexto para agentes de código (e pessoas) que vão alterar este repositório. Para uso e instalação, veja o `README.md` e `tools/README-tecnico.txt` (o README do laboratório).

## O que é

O WS Monitor lê, pela porta serial (Web Serial), os pacotes da estação meteorológica **WH24C** (saída RS-485, via conversor USB/RS-485), valida, decodifica e mostra em três modos (**Dashboard**, **Tabela**, **Texto**). Grava as medições em `.csv` ou `.txt` para auditoria (laboratório de calibração).

- Substitui o simulador/terminal em Python (`weather_simulator_desktop`, outro repositório). Atenção: o `weather.py` de lá é um **transmissor** (simula a estação) e mantém o checksum fixo em `0x2C` ao mudar a chuva; esses pacotes aparecem aqui como **ERRO CHECKSUM** (comportamento correto).
- Mesmo modelo do **B2K Flash** (`b2k-flash-main`): sem build, servidor local em PowerShell, atalho que abre o Edge/Chrome em modo app, tela de abertura, menu lateral (gaveta), Modo Desenvolvedor com senha e log técnico em `log/`.
- Paleta: a do B2K Flash com **cinza claro** (`--accent`, `--accent-2`, `--logo-1/2` em `css/app.css`) no lugar do azul.

## Stack e restrições

- **Sem build e sem Node.** HTML, CSS e ES modules puros. Não introduza bundler, npm nem framework sem pedido explícito.
- **Servidor local:** `launcher/serve.ps1`, Windows PowerShell 5.1 + `HttpListener`, só `localhost:8766` (o B2K Flash usa 8765; os dois podem coexistir). Serve os arquivos e `POST /api/log?f=tecnico` (exige o cabeçalho `X-WS-Monitor: 1` e origem localhost; mantenha essa checagem). O Web Serial exige `localhost`/https: por isso o app não abre direto do disco.
- **Gravação de medições:** File System Access API (`showSaveFilePicker`) no navegador, não passa pelo servidor. Cada pacote abre o arquivo com `keepExistingData`, escreve no fim e fecha (o dado fica no disco a cada pacote). Ao parar, SHA-256 do arquivo.
- **Idioma:** interface, comentários, logs e documentação em **português (pt-BR)**. Números na tela com vírgula decimal.
- **Navegadores-alvo:** Chrome/Edge desktop no Windows 10/11.

## Mapa do código

| Arquivo | Responsabilidade |
|---|---|
| `index.html` | Marcação: abertura, cabeçalho (troca rápida Dashboard/Tabela/Texto), barra de conexão, gaveta, colunas (Estação + Gravação · painel do modo · Log técnico), painéis Referência e Desenvolvedor, diálogo. |
| `css/app.css` | Tokens do tema, layout (3 colunas ≥ 1280 px; em Tabela/Texto a coluna da esquerda vai para a direita), componentes, cartões do Dashboard, mini-séries, rosa dos ventos. |
| `js/wh24c.js` | **Protocolo, sem DOM:** CRC-8, checksum, `splitBurst`/`FrameSplitter` (separação por silêncio na linha), `decode`, `assess` (faixas do manual), `FIELDS`, `encodeRaw`/`rawFromValues` (simulador e testes), UVI estimado. |
| `js/format.js` | Linha compacta, detalhamento campo a campo e CSV (estilos `br` e `intl`). |
| `js/views.js` | `Dashboard` (cartões, mini-série com balão, rosa dos ventos), `renderTable`, texto. |
| `js/app.js` | Ponto de entrada: estado `ctx`, recepção (`handleBurst` → `processFrame`), estatísticas da estação, gravação, conexão, modos, Referência, Modo Desenvolvedor (fatores, recepção, pacote manual, simulador). |
| `js/serial.js` | `SerialLink`: abre em 8N1, lê continuamente, reabre sozinho quando o mesmo adaptador USB volta. |
| `js/recorder.js` | `Recorder`: gravação contínua em arquivo e SHA-256 ao parar. |
| `js/logsink.js` | Envia o log técnico ao servidor; guarda no `localStorage` se ele estiver parado. |
| `js/ui.js`, `js/util.js` | Terminal, diálogos, relógio, abertura, caixas minimizáveis; DOM, formatação, `store`, downloads. |
| `js/config.js` | `APP_VERSION`, baudrates, padrões de recepção, hash da senha do Desenvolvedor. |
| `sw.js` | Cache "rede primeiro". **Ao criar um arquivo do app, adicione-o em `SHELL`.** |
| `launcher/` | `serve.ps1`, `WS-Monitor.ps1` (abre o app), `Instalar-Atalho.ps1`; `Instalar.cmd` na raiz. |
| `tools/empacotar.ps1` | Gera `dist/ws-monitor-v<versão>.zip` (pasta `ws-monitor/` + `README.txt`) e `dist/README.txt` a partir de `tools/README-tecnico.txt`. |
| `tests/unit.html` | Testes do protocolo e do CSV (inclui a tabela CRC copiada do `crc_wh24c.py`). |
| `tests/ui.html` | Ponta a ponta sem hardware: injeta pacotes por `handleBurst` e testa a gravação CSV/TXT (com OPFS no lugar do "Salvar como"). |
| `docs/` | Manual da WH24C (PDF do fornecedor; não vai no pacote). |

## Protocolo (manual FG-0WN24C-B4U1, seção 6)

- 9600 bps padrão, 8N1. Um pacote a cada 16 s: **17 bytes**, ou **20** com barômetro (3 bytes de pressão após o checksum, ÷100 hPa).
- Byte 0 = `0x24`; byte 1 = ID (muda ao reiniciar); byte 15 = CRC-8 (polinômio 0x31, inicial 0) dos bytes 0–14; byte 16 = soma dos bytes 0–15 sem vai-um.
- Byte 3: b7 DIR_8 · b6-5 fixos `11` · b4 WSP_8 · b3 bateria baixa · b2-0 TMP_10..8. Temperatura = (bruto − 400)/10.
- Inválidos: direção `0x1FF`, temperatura `0x7FF`, umidade `0xFF`, rajada `0xFF`, UV `0xFFFF`, luz `0xFFFFFF`. Vento `0x1FF` não está no manual (família WH24; também é o valor saturado).
- **Fatores (`DEFAULT_FACTORS`) = firmware do coletor** (`beweather-firmware/components/weatherstation/ws_wh24c.c`), para a tela bater com o que o coletor envia: vento = bruto/8 × **1,12** m/s; rajada = bruto × 1,12 m/s; `curve: true` aplica a curva do firmware (limite de 50 m/s e, até 14,5 km/h, y = 2,30403498·x − 0,08951347·x² em km/h); chuva × 0,3 mm; luz × 0,1 lux. O manual da WH24C diz 0,4 m/s para o vento (linear): no Desenvolvedor, fator 0,4 e curva desligada. Mudou o firmware? Atualize `DEFAULT_FACTORS`/`collectorCurve` e a cópia das funções C em `tests/unit.html`.
- Índice UV: tabela de `wh24c_calc_uv_index` do firmware (0 a 15), com uma diferença intencional: de 1843 a 2291 o firmware devolve 4 (degrau repetido); aqui vale 5.
- Diferenças conhecidas do firmware (não copiadas): ele não confere o checksum (byte 16) nem lê a pressão da WH24C; a luz é dividida por 10 em inteiro (perde a casa decimal); em `wh24c_parse_msg`, `bf != NULL || *bf == 0x24` deveria ser `&&`.
- Pacote com CRC ou checksum errado: contado, vai para Tabela/Texto/log e (opcional) para a gravação, mas **não** altera o Dashboard. O Desenvolvedor pode aceitar checksum errado quando o CRC confere.

## Telas, gravação e relatório

- Quadros laterais: Dashboard/Tabela/Texto mostram Estação + Gravação; Referência, nenhum; Desenvolvedor, só a Estação (regras `body[data-tab=...]` em `css/app.css`). Com gravação ativa, o indicador "Gravando" da barra leva ao quadro da gravação.
- A troca de tela só redesenha: `processFrame` grava no arquivo e alimenta o relatório (`trackRec`) em qualquer tela. "Nova sessão" e "Limpar" da Tabela não mexem na gravação.
- Relatório do monitoramento (`buildReport`, botão depois de parar): estatística só dos pacotes da porta serial (simulados/manuais são contados à parte); chuva somada pacote a pacote com o fator vigente; alterações de fatores durante a gravação aparecem no arquivo e no relatório.
- Horários: `FrameSplitter` guarda a hora de chegada de cada pedaço e detecta o silêncio também na chegada (o navegador atrasa temporizadores com a janela minimizada); cada pacote recebe a hora do seu primeiro byte.

## Regras e cuidados

- `log/` e `dist/` não são versionados. As gravações de medições ficam onde o técnico escolher.
- **Senha do Desenvolvedor:** a mesma do B2K Flash (hash SHA-256 em `js/config.js`). Barreira de interface, não segurança real.
- **Versão:** `APP_VERSION` em `js/config.js` (hoje **1.0**). Ela nomeia o cache do service worker e o zip.
- **Scripts PowerShell:** UTF-8 **com BOM** e CRLF (sem BOM, os acentos quebram no PowerShell 5.1).
- **Distribuição:** depois de mudanças, rode `tools\empacotar.ps1`.
- **Hardware:** validado só com testes e pacotes simulados. Antes de liberar uma mudança na recepção ou na decodificação, teste com uma WH24C real.
- **Commits:** não faça commit nem push sem pedido; mudanças passam por revisão humana.

## Como testar

1. Servidor: `powershell -NoProfile -ExecutionPolicy Bypass -File launcher\serve.ps1 -Port 8797` (ou, fora do Windows, `python3 -m http.server 8797 --bind 127.0.0.1`: tudo funciona menos o log em `log/`).
2. `http://localhost:8797/tests/unit.html` → "N ok, 0 falha(s)".
3. `http://localhost:8797/tests/ui.html` → idem. `?view=table|text|ref&shot=1` para capturas.
   Headless: `chrome --headless=new --user-data-dir=<temp> --virtual-time-budget=600000 --dump-dom <url>` e procure `id="summary"`.
4. Sem hardware na interface real: Desenvolvedor > Testes sem a estação > Simulador (pacotes marcados SIMULADO) ou Pacote manual.
