import { Injectable, signal, computed } from '@angular/core';
import { BookingFilter, BookingSubmission } from '../models/booking-request.model';
import { HOTEL_CONFIG } from '../config/hotel-config';
import { environment } from '../../../environments/environment';

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
    submission: BookingSubmission
  ): Promise<{ success: boolean; message: string; idreserva?: number | null; token?: string | null }> {
    try {
      const res = await fetch(`${environment.apiUrl}/publico/reservas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: submission.accommodationSlug,
          check_in: submission.checkIn,
          check_out: submission.checkOut,
          hospedes: Number(submission.guests) || 2,
          nome: submission.guestName,
          email: submission.guestEmail,
          telefone: submission.guestPhone,
          observacoes: submission.specialRequests || null,
          early_checkin: submission.earlyCheckin === true,
          late_checkout: submission.lateCheckout === true
        })
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          message: data?.erro?.mensagem || 'Não foi possível registrar a reserva. Verifique os dados informados.'
        };
      }
      return {
        success: true,
        idreserva: data?.idreserva ?? null,
        token: data?.token_publico ?? null,
        message:
          data?.mensagem ||
          'Reserva registrada com sucesso! Nossa recepção já foi notificada em tempo real.'
      };
    } catch {
      return {
        success: false,
        message: 'Falha de conexão com o servidor. Por favor, tente novamente ou fale conosco pelo telefone.'
      };
    }
  }

  private formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

