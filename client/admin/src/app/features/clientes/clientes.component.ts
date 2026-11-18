// UI de clientes — template, estilos e bindings. A lógica vive em clientes.store.ts.
import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { Cliente } from '@core/models/clientes.models';
import { DateInputComponent } from '@shared/components/date-input/date-input.component';
import { FotoCaptureComponent } from '@shared/components/foto-capture/foto-capture.component';
import { DocumentosModalComponent } from './documentos-modal.component';
import { ClientesStore } from './clientes.store';

@Component({
  selector: 'app-clientes',
  host: { '(document:keydown.escape)': 'onEsc()' },
  imports: [
    DatePipe,
    MatPaginatorModule,
    MatIconModule,
    MatMenuModule,
    MatDividerModule,
    ReactiveFormsModule,
    DateInputComponent,
    FotoCaptureComponent,
    DocumentosModalComponent,
  ],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.css',
})
export class ClientesComponent extends ClientesStore {}
