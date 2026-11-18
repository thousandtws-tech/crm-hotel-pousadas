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
  guestPhoneDdi?: string;
  specialRequests?: string;
  earlyCheckin?: boolean;
  lateCheckout?: boolean;
  aceitoTermos?: boolean;
  aceitoMarketing?: boolean;
  aceitoWhatsapp?: boolean;
  codigoCorporativo?: string;
  totalNights?: number;
  estimatedTotal?: number;
}
