// UI de maria-widget — template, estilos e bindings. A lógica vive em maria-widget.store.ts.
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MariaWidgetStore } from './maria-widget.store';

@Component({
  selector: 'app-maria',
  imports: [MatIconModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './maria-widget.component.html',
  styleUrl: './maria-widget.component.css',
})
export class MariaWidgetComponent extends MariaWidgetStore {}
