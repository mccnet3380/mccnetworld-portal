import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let text = res.statusText;
    try {
      text = (await res.text()) || res.statusText;
    } catch (e) {
      console.warn('Failed to read response text:', e);
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Get session ID from auth store
  let sessionId = null;
  try {
    const authStore = localStorage.getItem('auth-storage');
    if (authStore) {
      const parsed = JSON.parse(authStore);
      sessionId = parsed?.state?.sessionId || null;
      console.log('Retrieved sessionId from auth-storage:', sessionId ? 'exists' : 'missing');
    } else {
      console.warn('No auth-storage found in localStorage');
    }
  } catch (e) {
    console.warn('Failed to parse auth store:', e);
  }
  
  const headers: Record<string, string> = {};
  if (data && !(data instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (sessionId) {
    headers["Authorization"] = `Bearer ${sessionId}`;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: data instanceof FormData ? data : (data ? JSON.stringify(data) : undefined),
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    console.error('Fetch request failed:', error);
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    console.log('[QueryFn] Fetching:', queryKey[0]);
    
    // Get session ID from auth store
    let sessionId = null;
    try {
      const authStore = localStorage.getItem('auth-storage');
      if (authStore) {
        const parsed = JSON.parse(authStore);
        sessionId = parsed?.state?.sessionId || null;
      }
    } catch (e) {
      console.warn('[QueryFn] Failed to parse auth store:', e);
    }
    
    const headers: Record<string, string> = {};
    if (sessionId) {
      headers["Authorization"] = `Bearer ${sessionId}`;
    }

    console.log('[QueryFn] Fetch starting with headers:', { hasAuth: !!sessionId });

    try {
      const res = await fetch(queryKey[0] as string, {
        headers,
        credentials: "include",
      });

      console.log('[QueryFn] Response received:', res.status, res.ok);

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      const data = await res.json();
      console.log('[QueryFn] Data parsed, count:', Array.isArray(data) ? data.length : 'not-array');
      return data;
    } catch (error) {
      console.error('[QueryFn] Fetch error:', error);
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
