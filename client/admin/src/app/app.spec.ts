import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { of } from 'rxjs';
import { App } from './app';

describe('App', () => {
  it('renderiza o shell com outlet, toasts e diálogo de confirmação', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: SwUpdate, useValue: { isEnabled: false, versionUpdates: of() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('router-outlet')).toBeTruthy();
    expect(el.querySelector('app-toasts')).toBeTruthy();
    expect(el.querySelector('app-confirm')).toBeTruthy();
  });

  it('reage a VERSION_READY ativando a atualização do service worker', async () => {
    // activateUpdate pendente evita que .then(document.location.reload) execute
    // no jsdom, onde Location.reload é não-configurável.
    const activateUpdate = vi.fn().mockReturnValue(new Promise<boolean>(() => undefined));

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: SwUpdate,
          useValue: {
            isEnabled: true,
            versionUpdates: of({ type: 'VERSION_READY' }),
            activateUpdate,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    await vi.waitFor(() => expect(activateUpdate).toHaveBeenCalled());
  });
});
