import { Injectable, signal, computed } from '@angular/core';
import { BookingFilter, BookingSubmission } from '../models/booking-request.model';
import { HOTEL_CONFIG } from '../config/hotel-config';

@Injectable({
  providedIn: 'root'
})
export class BookingService {
  // Pre-fill with reasonable future dates
  private readonly defaultCheckIn = this.formatDate(new Date(Date.now() + 86400000 * 7));
  private readonly defaultCheckOut = this.formatDate(new Date(Date.now() + 86400000 * 10));

  private readonly filterState = signal<BookingFilter>({
    checkIn: this.defaultCheckIn,
    checkOut: this.defaultCheckOut,
    guests: 2,
    accommodationSlug: ''
  });

  public readonly filter = this.filterState.asReadonly();

  public readonly nights = computed(() => {
    const f = this.filterState();
    if (!f.checkIn || !f.checkOut) return 1;
    const start = new Date(f.checkIn).getTime();
    const end = new Date(f.checkOut).getTime();
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  });

  public updateFilter(partial: Partial<BookingFilter>): void {
    this.filterState.update((current) => ({
      ...current,
      ...partial
    }));
  }

  public get hasConfirmedWhatsApp(): boolean {
    return Boolean(HOTEL_CONFIG.whatsapp);
  }

  public generateWhatsAppUrl(customText?: string): string | null {
    if (!HOTEL_CONFIG.whatsapp) {
      return null;
    }
    const f = this.filterState();
    const baseMessage = customText || HOTEL_CONFIG.whatsappDefaultMessage;
    const details = `\n\nDatas pretendidas: ${f.checkIn} a ${f.checkOut} (${this.nights()} noites)\nHóspedes: ${f.guests}`;
    const accommodation = f.accommodationSlug ? `\nAcomodação: ${f.accommodationSlug}` : '';
    const fullMessage = encodeURIComponent(`${baseMessage}${details}${accommodation}`);
    return `https://wa.me/${HOTEL_CONFIG.whatsapp}?text=${fullMessage}`;
  }

  public async submitBookingRequest(
    _submission: BookingSubmission
  ): Promise<{ success: boolean; message: string }> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      success: true,
      message:
        'Solicitação de disponibilidade registrada. Entre em contato também pelo telefone (22) 2644-3077 para agilizar a confirmação da sua reserva.'
    };
  }

  private formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

