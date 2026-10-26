import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '@core/services/auth.store';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  if (auth.autenticado()) return true;
  return inject(Router).createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  if (!auth.autenticado()) return true;
  return inject(Router).createUrlTree(['/']);
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  if (auth.isAdmin()) return true;
  return inject(Router).createUrlTree(['/']);
};
