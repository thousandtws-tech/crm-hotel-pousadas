export const environment = {
  production: true,
  apiUrl: 'https://api-production-19dc.up.railway.app/api/v1',
  // Hub realtime (Phoenix/Elixir) — central de eventos WebSocket
  realtimeUrl: 'wss://realtime-production-92bc.up.railway.app/socket',
  // Serviço MAR IA (FastAPI) — sessão ElevenLabs + tools MCP
  mariaUrl: 'https://maria-production-b5c4.up.railway.app',
};
