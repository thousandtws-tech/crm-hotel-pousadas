// UI de kds — template, estilos e bindings. A lógica vive em kds.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { KdsStore } from './kds.store';

@Component({
  selector: 'app-kds',
  imports: [MatIconModule, DatePipe],
  templateUrl: './kds.component.html',
  styleUrl: './kds.component.css',
})
export class KdsComponent extends KdsStore {}
