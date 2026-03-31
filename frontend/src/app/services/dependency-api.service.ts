import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DependencyGraphRequest, DependencyGraphResponse } from '../models/dependency-graph';

export type ExportFormat = 'json' | 'csv';

@Injectable({ providedIn: 'root' })
export class DependencyApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

  getDependencies(request: DependencyGraphRequest) {
    return this.http.post<DependencyGraphResponse>(`${this.apiBaseUrl}/dependencies`, request);
  }

  exportDependencies(request: DependencyGraphRequest, format: ExportFormat) {
    return this.http.post(`${this.apiBaseUrl}/dependencies/export?format=${format}`, request, {
      responseType: 'blob'
    });
  }

  private resolveApiBaseUrl() {
    if (typeof window === 'undefined') {
      return '/api';
    }

    const { hostname, port } = window.location;
    const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

    if (isLoopbackHost && port !== '5199') {
      const normalizedHost = hostname === '::1' ? '[::1]' : hostname;
      return `http://${normalizedHost}:5199/api`;
    }

    return '/api';
  }
}
