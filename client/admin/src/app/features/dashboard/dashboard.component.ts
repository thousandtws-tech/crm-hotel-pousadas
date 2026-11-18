// UI de dashboard — template, estilos e bindings. A lógica vive em dashboard.store.ts.
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { EChartComponent } from '@shared/components/echart/echart.component';
import { DashboardStore } from './dashboard.store';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, MatIconModule, EChartComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent extends DashboardStore {}
