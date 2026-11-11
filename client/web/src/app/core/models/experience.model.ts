export interface Experience {
  id: string;
  slug: string;
  title: string;
  category: string;
  tagline: string;
  description: string;
  longDescription?: string;
  image: string;
  /** true quando a mídia é vídeo. */
  video?: boolean;
  gallery?: string[];
  schedule?: string;
  ctaLabel?: string;
  ctaHref?: string;
  highlights?: string[];
  includedInStay: boolean;
  featured: boolean;
  order: number;
}
