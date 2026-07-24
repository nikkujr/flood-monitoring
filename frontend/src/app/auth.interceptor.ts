import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ApiService } from './api.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(ApiService).accessToken();
  return next(token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request);
};
