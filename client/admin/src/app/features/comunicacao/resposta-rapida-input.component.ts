// UI de resposta-rapida-input — template, estilos e bindings.
// A lógica vive em resposta-rapida-input.store.ts.
import { Component, ElementRef, input, model, viewChild } from '@angular/core';
import { RespostaRapida } from '@core/models/comunicacao.models';
import { RespostaRapidaInputStore } from './resposta-rapida-input.store';

@Component({
  selector: 'app-rr-textarea',
  templateUrl: './resposta-rapida-input.component.html',
  styleUrl: './resposta-rapida-input.component.css',
})
export class RespostaRapidaInputComponent extends RespostaRapidaInputStore {
  override readonly texto = model.required<string>();
  override readonly respostas = input<RespostaRapida[]>([]);
  override readonly rows = input(4);
  override readonly placeholder = input('');
  override readonly ta = viewChild<ElementRef<HTMLTextAreaElement>>('ta');
}
