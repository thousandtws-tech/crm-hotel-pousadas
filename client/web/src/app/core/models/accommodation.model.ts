export interface Amenity {
  id: string;
  name: string;
  icon: string;
  highlight?: boolean;
}

export interface Accommodation {
  id: string;
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  shortDescription: string;
  editorialQuote?: string;
  price?: number | null;
  priceLabel: string;
  guests: number;
  beds: string;
  bathrooms: number;
  size?: number | null;
  view: string;
  floor: string;
  coverImage: string;
  images: string[];
  amenities: Amenity[];
  featured: boolean;
  order: number;
}

