import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { DependencyGraphRequest, DependencyGraphResponse } from '../models/dependency-graph';

export type ExportFormat = 'json' | 'csv';

@Injectable({ providedIn: 'root' })
export class DependencyApiService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = 'http://localhost:5199/api';

  getDependencies(request: DependencyGraphRequest) {
    return this.http.post<DependencyGraphResponse>(`${this.apiBaseUrl}/dependencies`, request);
  }

  exportDependencies(request: DependencyGraphRequest, format: ExportFormat) {
    return this.http.post(`${this.apiBaseUrl}/dependencies/export?format=${format}`, request, {
      responseType: 'blob'
    });
  }
}
