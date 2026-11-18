# WS Monitor

Leitura e decodificação, pelo navegador, dos pacotes da estação meteorológica **WH24C** (saída RS-485), com exibição em **Dashboard**, **Tabela** ou **Texto**, log técnico e gravação das medições em `.csv` ou `.txt` para auditoria.

Roda no **Google Chrome** ou **Microsoft Edge** (Web Serial), aberto por um atalho que sobe um servidor local em PowerShell (`localhost:8766`). Não precisa de internet, Node ou administrador.

## Para o laboratório

O pacote fica em `dist/`:

- `dist/ws-monitor-v<versão>.zip`: o app (pasta `ws-monitor/`, com `Instalar.cmd` e `README.txt`);
- `dist/README.txt`: instalação, ligação dos fios, uso, gravação, conferência do SHA-256 e problemas comuns.

Resumo: desbloquear o zip, extrair em `C:\`, executar `C:\ws-monitor\Instalar.cmd` e usar o atalho **WS Monitor**.

## Funções

- **Conexão:** porta e baudrate (padrão 9600, 8N1); reabre sozinho se o mesmo conversor USB for reconectado.
- **Validação:** CRC-8 e checksum de cada pacote; pacotes com erro são contados e mostrados, mas não alteram o Dashboard.
- **Dashboard:** valor atual, mínimo/máximo da sessão, exatidão do manual, mini-série com balão, rosa dos ventos, chuva acumulada na sessão (basculadas) e aviso de bateria baixa.
- **Tabela / Texto:** um pacote por linha (com o frame em hex, opcional), detalhamento campo a campo, exportação.
- **Estação:** ID, formato do pacote (17/20 bytes), intervalo, erros de CRC/checksum, pacotes perdidos, bytes descartados.
- **Gravação:** CSV (Excel pt-BR ou internacional) ou TXT, com cabeçalho de identificação (operador, equipamento, fatores de conversão), gravada no disco a cada pacote, com SHA-256 ao final.
- **Relatório do monitoramento:** resumo em .txt ao parar a gravação (identificação, período, arquivo e SHA-256, comunicação, mín./máx./média de cada grandeza, chuva no período, fatores).
- **Conversão igual ao coletor BeWeather:** vento e rajada com fator 1,12 e a curva de calibração do firmware (m/s e km/h); índice UV pela tabela do firmware.
- **Referência:** faixas, exatidão e resolução do manual e o mapa do pacote.
- **Modo Desenvolvedor** (senha): fatores de conversão, separação dos pacotes, pacote manual em hex e simulador da estação.

## Desenvolvimento

Veja `AGENTS.md` (mapa do código, protocolo, regras e testes). Gerar o pacote: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\empacotar.ps1`.
