let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // sesi berakhir saat aplikasi dipakai (bukan saat login atau cek sesi awal)
    if (
      res.status === 401 &&
      !url.startsWith("/api/auth/login") &&
      !url.startsWith("/api/auth/me")
    ) {
      onUnauthorized?.();
    }
    throw new ApiError(res.status, data.message ?? "Terjadi kesalahan");
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  delete: <T>(url: string) => request<T>("DELETE", url),
};
