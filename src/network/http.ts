import {
  SignicError,
  SignicAuthError,
  SignicNetworkError,
  SignicValidationError,
} from '../errors.js';

export interface HttpResponse<T> {
  status: number;
  data: T;
  ok: boolean;
}

async function request<T>(
  url: string,
  options: RequestInit,
  operation: string
): Promise<HttpResponse<T>> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Network request failed';
    throw new SignicNetworkError(
      `Failed to ${operation}: ${message}`,
      operation
    );
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    throw new SignicError(
      `Failed to ${operation}: Invalid JSON response`,
      operation,
      response.status
    );
  }

  if (!response.ok) {
    throw handleApiError(response.status, data, operation);
  }

  return {
    status: response.status,
    data,
    ok: response.ok,
  };
}

export async function httpGet<T>(
  url: string,
  headers: Record<string, string>
): Promise<HttpResponse<T>> {
  return request<T>(
    url,
    { method: 'GET', headers },
    url.split('/').pop() ?? 'get'
  );
}

export async function httpPost<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<HttpResponse<T>> {
  return request<T>(
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    url.split('/').pop() ?? 'post'
  );
}

export async function httpPut<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<HttpResponse<T>> {
  return request<T>(
    url,
    { method: 'PUT', headers, body: JSON.stringify(body) },
    url.split('/').pop() ?? 'put'
  );
}

export function handleApiError(
  status: number,
  responseData: unknown,
  operation: string
): SignicError {
  const data = responseData as Record<string, unknown> | null;
  const errorMessage =
    (data?.error as string) ?? (data?.message as string) ?? 'Unknown error';
  const fullMessage = `Failed to ${operation}: ${errorMessage}`;

  if (status === 401 || status === 403) {
    return new SignicAuthError(fullMessage, operation, status);
  }
  if (status === 400 || status === 422) {
    return new SignicValidationError(fullMessage, operation, status);
  }
  return new SignicError(fullMessage, operation, status);
}
