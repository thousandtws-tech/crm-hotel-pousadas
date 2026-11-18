// UI de shell — template, estilos e bindings. A lógica vive em shell.store.ts.
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MariaWidgetComponent } from '@features/maria/maria-widget.component';
import { filter } from 'rxjs';
import { ShellStore } from './shell.store';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MariaWidgetComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.css',
})
export class ShellComponent extends ShellStore {}
