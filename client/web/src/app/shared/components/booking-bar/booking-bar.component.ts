import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  MatCalendarCellClassFunction,
  MatDatepicker,
  MatDatepickerModule
} from '@angular/material/datepicker';
import { MatSelectModule } from '@angular/material/select';
import { BookingService } from '../../../core/services/booking.service';
import { AccommodationService } from '../../../core/services/accommodation.service';

interface GuestOption {
  label: string;
  value: number;
}

@Component({
  selector: 'app-booking-bar',
  imports: [FormsModule, MatDatepickerModule, MatSelectModule],
  templateUrl: './booking-bar.component.html'
})
export class BookingBarComponent {
  private readonly router = inject(Router);
  public readonly bookingService = inject(BookingService);
  public readonly accommodationService = inject(AccommodationService);

  public readonly minDate = new Date();

  public readonly checkIn = signal<Date | null>(
    this.parseDate(this.bookingService.filter().checkIn)
  );
  public readonly checkOut = signal<Date | null>(
    this.parseDate(this.bookingService.filter().checkOut)
  );
  public readonly guests = signal<number>(this.bookingService.filter().guests);
  public readonly accommodationSlug = signal<string>(this.bookingService.filter().accommodationSlug || '');

  public readonly minCheckOutDate = computed<Date>(() => {
    const base = this.checkIn() ?? this.minDate;
    const min = new Date(base);
    min.setHours(0, 0, 0, 0);
    min.setDate(min.getDate() + 1);
    return min;
  });

  public readonly guestOptions: GuestOption[] = [
    { label: '1 Hóspede', value: 1 },
    { label: '2 Hóspedes', value: 2 },
    { label: '3 Hóspedes', value: 3 },
    { label: '4 Hóspedes', value: 4 }
  ];

  public readonly stayRangeDateClass: MatCalendarCellClassFunction<Date> = (cellDate, view) => {
    if (view !== 'month') {
      return '';
    }
    const start = this.checkIn();
    const end = this.checkOut();
    if (!start || !end) {
      return '';
    }

    const cellTime = new Date(
      cellDate.getFullYear(),
      cellDate.getMonth(),
      cellDate.getDate()
    ).getTime();
    const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();

    if (cellTime === startTime) {
      return 'stay-range-edge';
    }
    if (cellTime === endTime) {
      return 'stay-range-edge';
    }
    if (cellTime > startTime && cellTime < endTime) {
      return 'stay-range-middle';
    }
    return '';
  };

  public onCheckInChange(nextCheckIn: Date | null, checkOutPicker: MatDatepicker<Date>): void {
    this.checkIn.set(nextCheckIn);
    if (!nextCheckIn) {
      return;
    }

    const currentCheckOut = this.checkOut();
    if (!currentCheckOut || currentCheckOut.getTime() <= nextCheckIn.getTime()) {
      const nextDay = new Date(nextCheckIn);
      nextDay.setDate(nextDay.getDate() + 1);
      this.checkOut.set(nextDay);
    }

    setTimeout(() => checkOutPicker.open(), 160);
  }

  public readonly dateError = signal<string>('');

  public onCheckAvailability(): void {
    const checkIn = this.formatDate(this.checkIn());
    const checkOut = this.formatDate(this.checkOut());

    if (!checkIn || !checkOut) {
      this.dateError.set('Selecione as datas de chegada e partida para consultar a disponibilidade.');
      return;
    }
    this.dateError.set('');

    this.bookingService.updateFilter({
      checkIn,
      checkOut,
      guests: Number(this.guests()),
      accommodationSlug: this.accommodationSlug()
    });

    this.router.navigate(['/reservar'], {
      queryParams: {
        checkIn,
        checkOut,
        guests: this.guests(),
        suite: this.accommodationSlug() || undefined
      }
    });
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) {
      return null;
    }
    return new Date(year, month - 1, day);
  }

  private formatDate(value: Date | null): string {
    if (!value) {
      return '';
    }
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
