// UI de frigobares — template, estilos e bindings. A lógica vive em frigobares.store.ts.
import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { num } from '@core/utils/num';
import { Frigobar } from '@core/models/frigobares.models';
import { FrigobaresStore } from './frigobares.store';

@Component({
  selector: 'app-frigobares',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [DecimalPipe, ReactiveFormsModule, MatIconModule, MatSelectModule, MatFormFieldModule],
  templateUrl: './frigobares.component.html',
  styleUrl: './frigobares.component.css',
})
export class FrigobaresComponent extends FrigobaresStore {}
