export type GalleryCategory = 'todas' | 'suites' | 'gastronomia' | 'lazer-spa' | 'natureza';

export interface GalleryItem {
  id: string;
  title: string;
  category: GalleryCategory;
  categoryLabel: string;
  imageUrl: string;
  /** true quando a mídia é vídeo (renderizado com <video>). */
  video?: boolean;
  caption?: string;
  aspectRatio: 'landscape' | 'portrait' | 'square' | 'panoramic';
}
