import { ErrorHandler } from '@angular/core';

const RELOAD_FLAG = 'chunk-reload-at';
const RELOAD_COOLDOWN_MS = 60_000;

const CHUNK_FAILURE = /Failed to fetch dynamically imported module|ChunkLoadError|Importing a module script failed|error loading dynamically imported module/i;

/**
 * Quando um lazy chunk falha (ex.: navegador aberto durante um deploy, em que o
 * main.js antigo pede um chunk cujo hash ja nao existe), recarrega a pagina uma
 * unica vez para buscar o index.html atualizado. O cooldown evita loop infinito
 * caso o novo bundle tambem falhe.
 */
export class ChunkReloadErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (CHUNK_FAILURE.test(message)) {
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0);
      if (Date.now() - last > RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
        location.reload();
        return;
      }
    }
    console.error(error);
  }
}
