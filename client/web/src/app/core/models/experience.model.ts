export interface Experience {
  id: string;
  slug: string;
  title: string;
  category: string;
  tagline: string;
  description: string;
  longDescription?: string;
  image: string;
  gallery?: string[];
  schedule?: string;
  highlights?: string[];
  includedInStay: boolean;
  featured: boolean;
  order: number;
}
