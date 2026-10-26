import { Injectable, signal } from '@angular/core';
import { Testimonial } from '../models/testimonial.model';

@Injectable({
  providedIn: 'root'
})
export class TestimonialService {
  // Nenhum depoimento sintético ou não autorizado é exposto ao visitante.
  private readonly testimonialsState = signal<Testimonial[]>([]);

  public readonly testimonials = this.testimonialsState.asReadonly();
}

