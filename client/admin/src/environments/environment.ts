export const environment = {
  production: false,
  apiUrl: 'https://api-production-19dc.up.railway.app/api/v1',
  // Hub realtime (Phoenix/Elixir) — local: ws://localhost:4000/socket
  realtimeUrl: 'ws://localhost:4000/socket',
  // Serviço MAR IA (FastAPI) — voz + orquestração de IA
  mariaUrl: 'wss://maria-production-b5c4.up.railway.app/ws/maria',
};
