import { RenderMode, ServerRoute } from '@angular/ssr';

// SSR em tudo: conteúdo do CMS sempre fresco e HTML completo pro SEO.
// Se uma página estabilizar, dá pra marcar RenderMode.Prerender depois.
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
