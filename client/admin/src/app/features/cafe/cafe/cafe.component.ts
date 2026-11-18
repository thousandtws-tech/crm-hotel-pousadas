// UI de cafe — template, estilos e bindings. A lógica vive em cafe.store.ts.
import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DateInputComponent } from '@shared/components/date-input.component';
import { CafeStore } from './cafe.store';

@Component({
  selector: 'app-cafe',
  imports: [MatIconModule, DateInputComponent],
  templateUrl: './cafe.component.html',
  styleUrl: './cafe.component.css',
})
export class CafeComponent extends CafeStore {}
