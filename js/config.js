/* Configuração do WS Monitor */

export const APP_VERSION = '1.0';
export const APP_NAME = 'WS Monitor';

/* Porta serial: o manual da WH24C define 9600 bps como padrão ("User Define"), 8 bits, 1 stop, sem paridade */
export const BAUD_RATES = [9600, 4800, 19200, 38400, 57600, 115200];
export const DEFAULT_BAUD = 9600;

/* Recepção: silêncio que encerra uma rajada de bytes (ms) e limites de memória da sessão */
export const DEFAULT_RX = { gapMs: 80, acceptBadSum: false, logChunks: false };
export const MAX_RECORDS = 500;      // pacotes guardados para a tabela e o texto
export const HISTORY_POINTS = 90;    // pontos das mini-séries do dashboard (~24 min a cada 16 s)
export const STALE_FACTOR = 2.5;     // "sem dados" depois de 2,5 períodos (40 s)

/* Senha do Modo Desenvolvedor (SHA-256). A mesma do B2K Flash. É só uma barreira de interface para evitar
   uso acidental: como o app roda inteiro no navegador, não substitui controle de acesso de verdade. */
export const DEV_PASSWORD_SHA256 = '335eac4f3d40e4ffb00fdc85c7609a9fc192dc7289b8f184f48c5e56a43c8cef';

/* Log técnico em arquivo: o servidor local (launcher/serve.ps1) grava em <pasta do app>/log/ */
export const LOG_ENDPOINT = 'api/log';
export const API_HEADER = 'X-WS-Monitor';
