import { auth } from './firebase';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

class ApiClient {
  private async getToken(): Promise<string | null> {
    try {
      return await auth.currentUser?.getIdToken() || null;
    } catch {
      return null;
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retries = 1,
  ): Promise<ApiResponse<T>> {
    const token = await this.getToken();
    const headers: Record<string, string> = {};

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await res.json().catch(() => ({}));

      // Token might be expired, try refreshing it once
      if (res.status === 401 && retries > 0) {
        if (auth.currentUser) {
          await auth.currentUser.getIdToken(true); // Force refresh
          return this.request<T>(method, path, body, retries - 1);
        }
      }

      if (!res.ok) {
        return {
          success: false,
          error: data.error || { code: 'UNKNOWN', message: res.statusText || 'Unknown error' },
        };
      }

      return data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message },
      };
    }
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

export const api = new ApiClient();
