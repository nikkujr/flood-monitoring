import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { EMPTY, Observable, catchError, finalize, shareReplay, switchMap, throwError } from 'rxjs';
import { ApiService } from './api.service';

let refreshRequest$: Observable<unknown> | null = null;

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(ApiService);
  const token = api.accessToken();
  const isAuthRequest = /\/auth\/(?:login|register|refresh|logout)(?:\?|$)/.test(request.url);
  const authenticatedRequest = token && !isAuthRequest
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authenticatedRequest).pipe(catchError((error: unknown) => {
    if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !token || isAuthRequest) {
      return throwError(() => error);
    }

    if (!refreshRequest$) {
      refreshRequest$ = api.refresh().pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        finalize(() => { refreshRequest$ = null; })
      );
    }

    return refreshRequest$.pipe(
      switchMap(() => {
        const replacementToken = api.accessToken();
        if (!replacementToken) return throwError(() => error);
        return next(request.clone({ setHeaders: { Authorization: `Bearer ${replacementToken}` } }));
      }),
      catchError(() => {
        api.clearSession();
        return EMPTY;
      })
    );
  }));
};
