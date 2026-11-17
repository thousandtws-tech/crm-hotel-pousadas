export const environment = {
  production: false,
  // Sentry (error tracking) — DSN é chave pública de ingestão, vai no
  // bundle de propósito. Vazio = desligado em dev.
  sentryDsn: '',
  apiUrl: 'https://api-production-19dc.up.railway.app/api/v1',
  // Hub realtime (Phoenix/Elixir) — local: ws://localhost:4000/socket
  realtimeUrl: 'wss://realtime-production-92bc.up.railway.app/socket',
  // Serviço MAR IA (FastAPI) — voz + orquestração de IA
  mariaUrl: 'wss://maria-production-b5c4.up.railway.app/ws/maria',
};
