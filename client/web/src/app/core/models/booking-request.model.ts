export interface BookingFilter {
  checkIn: string;
  checkOut: string;
  guests: number;
  accommodationSlug?: string;
}

export interface BookingSubmission {
  checkIn: string;
  checkOut: string;
  guests: number;
  accommodationSlug: string;
  accommodationName: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  specialRequests?: string;
  totalNights?: number;
  estimatedTotal?: number;
}
